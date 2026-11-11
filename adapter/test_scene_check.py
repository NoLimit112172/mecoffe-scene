"""Configuration report checks, without team registration or execution binding."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scene_service.checker import check_scene, render_report
from scene_service.common import digest
from scene_service.compiler import compile_scene
from scene_service.issues import ISSUE_MESSAGES
from scene_service.validation import validate_result

ROOT=Path(__file__).resolve().parent.parent
FIXTURES=ROOT/'adapter/scene_service/fixtures'
MAPS=ROOT/'data/maps/ustc-gaoxin'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def ustc(version='2'):
    return (read(FIXTURES/f'check/intent-ustc-v{version}.json'),
            read(FIXTURES/'snapshot.json'),read(FIXTURES/'plan.json'))


def item(report,key):
    return next(value for value in report['items'] if value['id']==key)


class SceneCheckCase(unittest.TestCase):
    def assertFailure(self,report,code):
        self.assertFalse(report['configuration_ok'])
        self.assertEqual(report['conclusion'],'不通过')
        failures=[value for value in report['items'] if value['status']=='不通过']
        self.assertTrue(failures)
        match=next(value for value in failures if value['issue']['code']==code)
        for key,value in ISSUE_MESSAGES[code].items():self.assertEqual(match['issue'][key],value)
        self.assertEqual(match['reason'],ISSUE_MESSAGES[code]['user_message'])
        self.assertNotIn('result',report)
        return match

    def test_synthetic_prepared_map_and_warnings_remain_unchanged(self):
        bundle=read(ROOT/'frontend/tests/fixtures/scene-render/input-a.json')
        intent=read(FIXTURES/'check/intent-synthetic.json')
        original=copy.deepcopy((intent,bundle))
        directory=ROOT/'frontend/tests/fixtures/scene-render/maps'/intent['map_ref']['map_id']/'1'
        report=check_scene(intent,bundle['snapshot'],bundle['plan'],directory,assignment_seed=intent['assignment_seed'])
        self.assertTrue(report['configuration_ok'])
        self.assertEqual(report['conclusion'],'配置期检查通过，运行绑定待确认')
        self.assertEqual([value['id'] for value in report['items'] if value['status']=='待确认'],
                         ['runtime_binding','actual_plan','storage'])
        self.assertEqual(report['warnings'],report['result']['warnings'])
        self.assertTrue(any(value['code']=='FALLBACK_USED' for value in report['warnings']))
        self.assertTrue(all(value['severity']=='warning' for value in report['warning_explanations']))
        self.assertEqual((intent,bundle),original)
        text=render_report(report)
        self.assertIn('位置示意',text);self.assertIn('警告，不计失败',text)
        self.assertNotIn('全部通过',text)

    def test_ustc_v2_has_canteens_and_v1_cannot_satisfy_same_dining_preferences(self):
        intent,snapshot,plan=ustc();before=copy.deepcopy((intent,snapshot,plan))
        report=check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=42)
        self.assertTrue(report['configuration_ok'])
        self.assertEqual(validate_result(report['result'],{'snapshot':snapshot,'plan':plan}),report['result'])
        stores=report['result']['service_points']
        self.assertEqual(len(stores),2)
        self.assertTrue({store['building_id'] for store in stores}<={'way/1435377504','way/1435377505','way/1435377506'})
        self.assertEqual(len({store['building_id'] for store in stores}),2)
        self.assertEqual((intent,snapshot,plan),before)
        old=copy.deepcopy(intent);old['map_ref']=ustc('1')[0]['map_ref']
        self.assertFailure(check_scene(old,snapshot,plan,MAPS/'1',assignment_seed=42),'SCENE_NO_CANDIDATE')

    def test_none_does_not_inspect_map_or_catalog(self):
        class UnusedMap:
            def __str__(self):
                raise AssertionError('none inspected map argument')
        intent,snapshot,plan=ustc()
        intent={'mode':'none','config_id':intent['config_id'],'reason':'合成实验已明确不用地图'}
        with patch('scene_service.checker.load_map',side_effect=AssertionError('map read')), \
             patch('scene_service.checker.published_asset_library',side_effect=AssertionError('catalog read')):
            report=check_scene(intent,snapshot,plan,UnusedMap(),assignment_seed=42)
        self.assertTrue(report['configuration_ok']);self.assertIsNone(report['result']['map_ref'])
        for key in ('map_manifest','map_files','map_catalog','map_quality'):
            self.assertEqual(item(report,key)['status'],'通过')
            self.assertIn('已跳过',item(report,key)['reason'])
        self.assertEqual(report['result']['assignments'],[])

    def test_explicit_mode_name_seed_and_reference_failures(self):
        mutations=(
            ('INVALID_INPUT',lambda i,s,p:i.pop('mode'),42),
            ('BRAND_NAME_MISMATCH',lambda i,s,p:p['economy']['products'][0].update(product_name='合成改名品牌'),42),
            ('INVALID_INPUT',lambda i,s,p:None,43),
            ('REF_MISMATCH',lambda i,s,p:p['population'].update(snapshot_revision=99),42),
        )
        for code,change,seed in mutations:
            with self.subTest(code=code,seed=seed):
                intent,snapshot,plan=ustc();change(intent,snapshot,plan)
                self.assertFailure(check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=seed),code)
        intent,snapshot,plan=ustc();intent['assignment_seed']=10**400
        self.assertFailure(check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=10**400),'INVALID_INPUT')

    def test_manifest_hash_wrong_or_version_missing_does_not_pick_another(self):
        intent,snapshot,plan=ustc();intent['map_ref']['manifest_sha256']='0'*64
        report=check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=42)
        self.assertFailure(report,'MAP_HASH_MISMATCH')
        self.assertEqual(item(report,'compile')['status'],'待确认')
        intent,snapshot,plan=ustc()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'ustc-gaoxin';shutil.copytree(MAPS/'1',root/'1')
            self.assertFailure(check_scene(intent,snapshot,plan,root/'2',assignment_seed=42),'MAP_FILE_MISSING')
        self.assertFailure(check_scene(intent,snapshot,plan,'//not-a-local-host/ustc-gaoxin/2',assignment_seed=42),'INVALID_MAP_BASE')

    def test_catalog_identity_files_and_quality_fail_without_changing_source_maps(self):
        for kind,code in (('catalog','ASSET_VERSION_MISMATCH'),('identity','MAP_VERSION_MISMATCH'),
                          ('file','REF_MISMATCH'),('quality','MAP_NOT_READY'),('missing-list','INVALID_MAP_MANIFEST')):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                intent,snapshot,plan=ustc();target=Path(directory)/'ustc-gaoxin/2';shutil.copytree(MAPS/'2',target)
                manifest=read(target/'manifest.json')
                if kind=='catalog':manifest['catalog_sha256']='0'*64
                elif kind=='identity':manifest['map_version']='1'
                elif kind=='file':(target/'campus3d.json').write_bytes((target/'campus3d.json').read_bytes()+b' ')
                elif kind=='missing-list':del manifest['files']['gis/roads.geojson']
                else:
                    quality=read(target/'quality.json');quality['status']='preview_only'
                    raw=(json.dumps(quality)+'\n').encode('utf-8');(target/'quality.json').write_bytes(raw)
                    manifest['files']['quality.json']=hashlib.sha256(raw).hexdigest()
                raw=(json.dumps(manifest)+'\n').encode('utf-8');(target/'manifest.json').write_bytes(raw)
                intent['map_ref']['manifest_sha256']=hashlib.sha256(raw).hexdigest()
                self.assertFailure(check_scene(intent,snapshot,plan,target,assignment_seed=42),code)

    def test_repeat_and_result_hash_checks_do_not_merely_trust_compile_success(self):
        intent,snapshot,plan=ustc()
        def different(*args,**kwargs):
            response=compile_scene(*args,**kwargs)
            different.calls+=1
            if different.calls==2:
                result=response['result'];result['assumptions'].append('合成测试：第二次输出意外变化')
                result['result_sha256']=digest({key:value for key,value in result.items() if key!='result_sha256'})
            return response
        different.calls=0
        with patch('scene_service.checker.compile_scene',side_effect=different):
            report=check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=42)
        self.assertFailure(report,'HASH_MISMATCH')
        self.assertEqual(item(report,'repeat')['status'],'不通过')
        def corrupt(*args,**kwargs):
            response=compile_scene(*args,**kwargs);response['result']['result_sha256']='0'*64
            return response
        with patch('scene_service.checker.compile_scene',side_effect=corrupt):
            report=check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=42)
        self.assertFailure(report,'HASH_MISMATCH')
        self.assertEqual(item(report,'validate')['status'],'不通过')
        self.assertEqual(item(report,'hash')['status'],'不通过')
        with patch('scene_service.checker.compile_scene',return_value={'ok':True,'result':None}):
            report=check_scene(intent,snapshot,plan,MAPS/'2',assignment_seed=42)
        self.assertFailure(report,'INVALID_SCENE')
        self.assertEqual(item(report,'compile')['status'],'不通过')

    def test_cli_json_text_files_exit_codes_and_none_skips_missing_map(self):
        env={**os.environ,'PYTHONIOENCODING':'utf-8'}
        def run(*args):
            process=subprocess.run([sys.executable,'-m','adapter.scene_service','check',*map(str,args)],cwd=ROOT,
                                   env=env,capture_output=True,text=True,encoding='utf-8')
            report=json.loads(process.stdout)
            self.assertEqual(process.returncode,1 if any(value['status']=='不通过' for value in report['items']) else 0)
            self.assertIn(report['conclusion'],process.stderr);self.assertIn('示意',process.stderr)
            self.assertNotIn('Traceback',process.stderr)
            return report,process.stderr
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'report.json'
            base=['--snapshot',FIXTURES/'snapshot.json','--plan',FIXTURES/'plan.json','--assignment-seed','42']
            report,text=run('--intent',FIXTURES/'check/intent-ustc-v2.json',*base,'--map',MAPS/'2','--out',output)
            self.assertTrue(report['configuration_ok'])
            self.assertEqual(read(output),report);self.assertEqual(Path(str(output)+'.txt').read_text(encoding='utf-8'),text)
            report,_=run('--intent',FIXTURES/'prefs-none.json',*base,'--map',Path(directory)/'missing-map')
            self.assertTrue(report['configuration_ok'])
            report,_=run('--intent',FIXTURES/'check/intent-ustc-v1.json',*base,'--map',MAPS/'1')
            self.assertFailure(report,'SCENE_NO_CANDIDATE')
            self.assertFailure(run()[0],'INVALID_INPUT')
            self.assertFailure(run('--intent','https://not-read.invalid/intent.json',*base)[0],'INVALID_MAP_BASE')
