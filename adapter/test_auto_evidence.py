"""Offline automatic evidence, version compatibility and immutable releases."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scene_service import SceneError, digest, enrich_map, resolve, validate_result
from scene_service.auto_evidence import default_rules, prepare_ai_review
from scene_service.fixtures.synthetic import sample_request
from scene_service.map_package import publish_map
from scene_service.maps import load_map
from scene_service.checker import check_scene

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'frontend/public/mecoffe/scenarios/ustc-history'


def prediction(package,values):
    return {'schema_version':'scene.ai-evidence.v1','synthetic':True,'map_ref':copy.deepcopy(package['map_ref']),
            'buildings':{key:{'functions':functions,'confidence':confidence,'rationale':'离线合成判断，仅用于测试用途推断。',
                              'model':'手写离线样例，未调用模型','prompt_version':'synthetic-1','generated_at':'2026-11-11T00:00:00Z'}
                         for key,(functions,confidence) in values.items()}}


class AutoEvidenceCase(unittest.TestCase):
    def setUp(self):
        self.request=sample_request();self.package=self.request['map'];self.rules=default_rules()

    def building(self,package,index=7):
        return package['campus']['buildings'][index]

    def auto(self,ai=None,annotations=None):
        return enrich_map(self.package,annotations,auto_rules=self.rules,ai_evidence=ai)

    def assertCode(self,code,operation):
        with self.assertRaises(SceneError) as error:operation()
        self.assertEqual(error.exception.code,code)

    def test_versioned_names_exclusions_conflicts_and_weak_keywords(self):
        for name,function in [('学生食堂A区','dining'),('教工食堂','dining'),('学生公寓','dormitory'),('第一宿舍楼','dormitory'),('教学楼','education'),('图书馆','library')]:
            self.building(self.package)['name']=name
            self.assertEqual(self.building(self.auto())['functions'],[function])
        for name in ['原教学楼','教学楼旧址','学生公寓路','筹建图书馆','图书馆南门']:
            self.building(self.package)['name']=name
            result=self.auto()
            self.assertFalse(any(e['source']=='name_rule' for e in self.building(result)['function_evidence']))
            self.assertTrue(any(w['code']=='NAME_RULE_EXCLUDED' for w in result['quality']['warnings']))
        self.building(self.package)['name']='合成食堂'
        self.rules['name_rules'].append({'id':'synthetic-conflict','function':'library','pattern':'食堂$'})
        self.rules['sha256']=digest({key:value for key,value in self.rules.items() if key!='sha256'})
        result=self.auto()
        self.assertEqual(self.building(result)['functions'],['unknown'])
        self.assertTrue(any(e['source']=='name_keyword' for e in self.building(result)['function_evidence']))
        self.assertTrue(any(w['code']=='NAME_RULE_CONFLICT' for w in result['quality']['warnings']))
        self.rules['sha256']='0'*64
        self.assertCode('INVALID_EVIDENCE_RULES',lambda:self.auto())

    def test_ai_confidence_and_precedence_do_not_promote_low_confidence(self):
        self.building(self.package)['name']='合成待判断楼'
        ai=prediction(self.package,{'synthetic/b7':(['dormitory'],.8)})
        result=self.auto(ai)
        evidence=next(e for e in self.building(result)['function_evidence'] if e['source']=='ai_inferred')
        self.assertEqual(evidence['confidence_pct'],80)
        self.assertEqual(self.building(result)['functions'],['dormitory'])
        ai['buildings']['synthetic/b7']['confidence']=.799
        result=self.auto(ai);self.assertEqual(self.building(result)['functions'],['unknown'])
        self.assertTrue(result['ai_evidence']['buildings']['synthetic/b7']['confidence']==.799)
        self.assertFalse(any(e['source']=='ai_inferred' for e in self.building(result)['function_evidence']))
        self.assertTrue(any(w['code']=='AI_LOW_CONFIDENCE' for w in result['quality']['warnings']))
        ai['buildings']['synthetic/b7']['confidence']=.9
        self.building(self.package)['name']='合成图书馆'
        result=self.auto(ai)
        self.assertEqual(self.building(result)['functions'],['library'])
        self.assertTrue(any(e['source']=='ai_inferred' for e in self.building(result)['inactive_function_evidence']))
        self.building(self.package)['tags']={'building':'dormitory'}
        result=self.auto(ai)
        self.assertEqual(self.building(result)['functions'],['dormitory'])
        annotation={'map_ref':self.package['map_ref'],'buildings':{'synthetic/b7':{
            'functions':['office'],'source':'合成对话确认','reviewer':'对话中用户确认','note':'合成确认，仅测试','mode':'replace'}}}
        result=self.auto(ai,annotation)
        self.assertEqual(self.building(result)['functions'],['office'])
        self.assertTrue(any(w['code']=='EVIDENCE_CONFLICT' for w in result['quality']['warnings']))

    def test_generic_education_yields_to_specific_names_or_ai(self):
        b=self.building(self.package);b.update(tags={'building':'university'},building_type='university',name='合成食堂')
        result=self.auto();b=self.building(result)
        self.assertEqual(b['functions'],['dining'])
        self.assertTrue(any(e['function']=='education' for e in b['superseded_function_evidence']))
        self.assertFalse(any(e['function']=='education' and e['source']!='name_keyword' for e in b['function_evidence']))
        self.building(self.package)['name']='合成待判断楼'
        result=self.auto(prediction(self.package,{'synthetic/b7':(['residential'],.85)}))
        self.assertEqual(self.building(result)['functions'],['residential'])

    def test_ai_input_errors_are_explicit_and_do_not_mutate_inputs(self):
        good=prediction(self.package,{'synthetic/b7':(['dormitory'],.8)})
        mutations=[
            ('INVALID_AI_EVIDENCE',lambda x:x['buildings'].update(missing=copy.deepcopy(x['buildings']['synthetic/b7']))),
            ('REF_MISMATCH',lambda x:x['map_ref'].update(manifest_sha256='0'*64)),
            ('UNKNOWN_FUNCTION',lambda x:x['buildings']['synthetic/b7'].update(functions=['invented'])),
            ('INVALID_AI_EVIDENCE',lambda x:x['buildings']['synthetic/b7'].pop('model')),
            ('INVALID_AI_EVIDENCE',lambda x:x['buildings']['synthetic/b7'].update(confidence=True)),
            ('INVALID_AI_EVIDENCE',lambda x:x['buildings']['synthetic/b7'].update(generated_at='2026-11-11')),
            ('INVALID_AI_EVIDENCE',lambda x:x.update(population_request={})),
        ]
        for code,change in mutations:
            with self.subTest(code=code):
                value=copy.deepcopy(good);change(value);before=copy.deepcopy(value)
                self.assertCode(code,lambda:self.auto(value));self.assertEqual(value,before)

    def test_review_contains_only_unresolved_map_context_and_nearby_is_not_strong_poi(self):
        self.building(self.package)['name']='待判断楼'
        self.package['campus']['pois']=[{'osm_id':'synthetic/near','name':'合成附近咖啡','tags':{'amenity':'cafe','contact:phone':'not exported'},'point':[145,25]}]
        report=prepare_ai_review(self.package,self.rules)
        self.assertEqual(report['map_ref'],self.package['map_ref'])
        record=next(value for value in report['buildings'] if value['building_id']=='synthetic/b7')
        self.assertEqual(record['area_m2'],100)
        self.assertTrue(record['nearby_pois']);self.assertEqual(record['inside_pois'],[])
        self.assertNotIn('contact:phone',json.dumps(report))
        self.assertNotIn('population',json.dumps(report))
        self.assertEqual(self.building(self.auto())['functions'],['unknown'])

    def test_new_results_always_v2_old_v1_contract_and_fixtures_remain_valid(self):
        self.assertEqual(resolve(self.request)['schema_version'],'scene.result.v2')
        none=copy.deepcopy(self.request);none.update(mode='none',reason='合成不用地图')
        self.assertEqual(resolve(none)['schema_version'],'scene.result.v2')
        self.building(self.package)['name']='合成待判断楼'
        self.package['evidence_rules']=self.rules
        self.package['ai_evidence']=prediction(self.package,{'synthetic/b7':(['retail'],.8)})
        self.request['role_prefs']['synthetic_student']['functions']=['retail']
        result=resolve(self.request)
        self.assertTrue(any('AI 推断（把握 80%）' in a['reason'] for a in result['assignments']))
        validate_result(result,{'snapshot':self.request['snapshot'],'plan':self.request['plan'],'map':self.auto(self.package['ai_evidence'])})
        old=copy.deepcopy(result);old['schema_version']='scene.result.v1';old['result_sha256']=digest({k:v for k,v in old.items() if k!='result_sha256'})
        self.assertCode('INVALID_SCENE',lambda:validate_result(old))
        next(e for a in result['assignments'] for e in a['evidence'] if e['source']=='ai_inferred').pop('confidence_pct')
        result['result_sha256']=digest({k:v for k,v in result.items() if k!='result_sha256'})
        self.assertCode('INVALID_SCENE',lambda:validate_result(result))

    def test_publish_freezes_ai_bytes_rules_and_runs_check_without_manual_review(self):
        source=load_map(SOURCE)
        buildings=source['campus']['buildings']
        unknown=[b['osm_id'] for b in enrich_map(source,auto_rules=self.rules)['campus']['buildings'] if b['functions']==['unknown']]
        ai=prediction(source,{unknown[0]:(['residential'],.8),unknown[1]:(['office'],.4)})
        raw=(json.dumps(ai,ensure_ascii=False,indent=3)+'\n').encode('utf-8')
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);file=root/'ai.json';file.write_bytes(raw);out=root/'synthetic-auto/1'
            no_ai=publish_map(SOURCE,root/'synthetic-names/1','synthetic-names','1','仅名称规则，无人工和 AI',evidence_mode='auto')
            self.assertEqual(no_ai['quality']['status'],'ready')
            self.assertEqual(no_ai['quality']['function_counts']['dining'],3)
            first=publish_map(SOURCE,out,'synthetic-auto','1','合成自动用途演示',evidence_mode='auto',ai_evidence=file)
            before={p.relative_to(out).as_posix():p.read_bytes() for p in out.rglob('*') if p.is_file()}
            publish_map(SOURCE,out,'synthetic-auto','1','合成自动用途演示',evidence_mode='auto',ai_evidence=file)
            self.assertEqual(before,{p.relative_to(out).as_posix():p.read_bytes() for p in out.rglob('*') if p.is_file()})
            self.assertEqual((out/'ai-evidence.json').read_bytes(),raw)
            package=load_map(out);enriched=enrich_map(package)
            self.assertEqual(enriched['quality']['function_counts']['dining'],3)
            changed=copy.deepcopy(package['annotations']);changed['buildings'][unknown[0]]={
                'functions':['office'],'source':'合成确认','reviewer':'对话中用户确认','note':'合成修改','mode':'replace'}
            self.assertCode('MAP_VERSION_IMMUTABLE',lambda:enrich_map(package,changed))
            altered=copy.deepcopy(package['ai_evidence']);altered['buildings'][unknown[0]]['confidence']=.9
            self.assertCode('MAP_VERSION_IMMUTABLE',lambda:enrich_map(package,ai_evidence=altered))
            self.assertEqual(first['quality']['evidence_policy']['sha256'],self.rules['sha256'])
            request=sample_request();intent={k:v for k,v in request.items() if k not in ('snapshot','plan','map')}
            intent['map_ref']=first['map_ref']
            report=check_scene(intent,request['snapshot'],request['plan'],out,assignment_seed=42)
            self.assertTrue(report['configuration_ok'])
            self.assertIn('name_rule',report['evidence_usage']['by_source'])
            self.assertTrue(all(s['evidence'] for s in report['result']['service_points']))
            self.assertNotIn('function_annotation',next(b for b in package['campus']['buildings'] if b['osm_id']==unknown[0]))

    def test_existing_release_bytes_and_v1_contract_fixtures_are_untouched(self):
        paths=subprocess.check_output(['git','ls-tree','-r','--name-only','f2db4bd','--','data/maps/ustc-gaoxin/1',
                                       'data/maps/ustc-gaoxin/2','adapter/scene_service/contract.json','adapter/scene_service/fixtures'],
                                      cwd=ROOT,text=True).splitlines()
        for path in paths:
            self.assertEqual((ROOT/path).read_bytes(),subprocess.check_output(['git','cat-file','--filters','f2db4bd:'+path],cwd=ROOT),path)
        with tempfile.TemporaryDirectory() as temporary:
            env={**os.environ,'PYTHONIOENCODING':'utf-8'}
            for version,extra in [('1',[]),('2',['--annotations',str(ROOT/'data/maps/ustc-gaoxin/review-annotations.v2.json')])]:
                output=Path(temporary)/version
                process=subprocess.run([sys.executable,'scripts/generate-ustc-map.py','--version',version,'--no-template','--out',str(output),*extra],
                                       cwd=ROOT,env=env,capture_output=True,text=True,encoding='utf-8')
                self.assertEqual(process.returncode,0,process.stderr)
                official=ROOT/'data/maps/ustc-gaoxin'/version
                self.assertEqual({p.relative_to(output).as_posix():p.read_bytes() for p in output.rglob('*') if p.is_file()},
                                 {p.relative_to(official).as_posix():p.read_bytes() for p in official.rglob('*') if p.is_file()})

    def test_check_counts_sources_and_ai_share_from_v2_assignments(self):
        folder=ROOT/'frontend/tests/fixtures/scene-auto'
        bundle=json.loads((folder/'input-v2.json').read_text(encoding='utf-8'));result=bundle['scene_result']
        intent={**result['rules'],'mode':'map','config_id':bundle['config_id'],'map_ref':result['map_ref']}
        with patch('scene_service.auto_evidence.default_rules',side_effect=AssertionError('Do not reselect global rules for a frozen map')), \
             patch('scene_service.auto_evidence.apply_auto_evidence',side_effect=AssertionError('Do not reassess a frozen AI threshold')):
            report=check_scene(intent,bundle['snapshot'],bundle['plan'],folder/'maps/synthetic-auto/1',
                               assignment_seed=result['assignment_meta']['assignment_seed'])
        self.assertTrue(report['configuration_ok'])
        self.assertGreater(report['evidence_usage']['ai_count'],0)
        self.assertGreater(report['evidence_usage']['ai_share_pct'],0)
        self.assertGreater(report['evidence_usage']['by_source']['name_rule'],0)
        self.assertEqual(report['result']['schema_version'],'scene.result.v2')
