"""Pure compile boundary, shared explanation coverage and JSON CLI behavior."""
import ast
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scene_service import compile_scene, enrich_map, resolve, validate_result
from scene_service.fixtures.synthetic import sample_request
from scene_service.issues import ISSUE_MESSAGES, describe_issue

ROOT=Path(__file__).resolve().parent.parent


def arguments(request):
    return ({k:copy.deepcopy(v) for k,v in request.items() if k not in ('snapshot','plan','map','assignment_seed')},
            request['snapshot'],request['plan'],request.get('map'))


def compile_request(request):
    return compile_scene(*arguments(request),assignment_seed=request.get('assignment_seed'))


class SceneCompileCase(unittest.TestCase):
    def test_table_exactly_covers_python_and_frontend_codes(self):
        codes=set()
        for path in (ROOT/'adapter/scene_service').glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node,ast.Constant) and isinstance(node.value,str) and re.fullmatch('[A-Z][A-Z0-9_]+',node.value):
                    codes.add(node.value)
        for name in ('sceneMap.js','sceneResult.js','scenePlacement.js'):
            codes.update(re.findall(r"""['"]([A-Z][A-Z0-9_]+)['"]""",(ROOT/'frontend/src/mecoffe'/name).read_text(encoding='utf-8')))
        self.assertEqual(set(ISSUE_MESSAGES),codes)
        self.assertEqual(sum(x['severity']=='warning' for x in ISSUE_MESSAGES.values()),10)
        for entry in ISSUE_MESSAGES.values():
            self.assertIn(entry['severity'],('error','warning'))
            for key in ('user_message','admin_message','rerun_scope'):
                self.assertRegex(entry[key],r'[\u4e00-\u9fff]')
            self.assertTrue(entry['actions'])
            self.assertTrue(all(isinstance(action,str) and action.strip() for action in entry['actions']))

    def test_map_matches_existing_resolver_is_repeatable_and_has_no_call_time_io(self):
        request=sample_request(); before=copy.deepcopy(request)
        with patch('builtins.open',side_effect=AssertionError('compile must not open files')), \
             patch.object(Path,'read_text',side_effect=AssertionError('compile must not read files')):
            first=compile_request(request)
            self.assertEqual(first,compile_request(request))
        self.assertTrue(first['ok'])
        self.assertEqual(first['result'],resolve(request))
        context={'snapshot':request['snapshot'],'plan':request['plan'],'map':enrich_map(request['map'])}
        self.assertEqual(validate_result(first['result'],context),first['result'])
        self.assertEqual(request,before)

    def test_none_ignores_map_even_if_it_cannot_be_copied(self):
        class UnusedMap:
            def __deepcopy__(self,memo):
                raise AssertionError('none inspected map')
        request=sample_request()
        intent={'mode':'none','config_id':request['config_id'],'reason':'已确认的合成纯网络实验'}
        response=compile_scene(intent,request['snapshot'],request['plan'],UnusedMap(),assignment_seed=42)
        self.assertTrue(response['ok'])
        result=response['result']
        self.assertEqual(validate_result(result,{'snapshot':request['snapshot'],'plan':request['plan']}),result)
        self.assertIsNone(result['map_ref']);self.assertEqual(result['assignments'],[]);self.assertEqual(result['service_points'],[])

    def test_failure_codes_and_shared_descriptions_without_automatic_fallback(self):
        changes={
            'SCENE_NO_CANDIDATE':lambda r:r['role_prefs']['synthetic_student'].update(functions=['retail'],fallback='fail'),
            'BRAND_NAME_MISMATCH':lambda r:r['plan']['economy']['products'][0].update(product_name='合成改名品牌'),
            'UNKNOWN_FUNCTION':lambda r:r['role_prefs']['synthetic_student'].update(functions=['not_a_function']),
            'MAP_NOT_READY':lambda r:r['map'].update(quality={'status':'preview_only'}),
            'REF_MISMATCH':lambda r:r['plan']['population'].update(snapshot_revision=99),
        }
        for code,change in changes.items():
            with self.subTest(code=code):
                request=sample_request();change(request);before=copy.deepcopy(request)
                response=compile_request(request)
                self.assertFalse(response['ok']);self.assertNotIn('result',response)
                error=response['error'];self.assertEqual(error['code'],code)
                for key,value in ISSUE_MESSAGES[code].items():self.assertEqual(error[key],value)
                self.assertTrue(error['details']);self.assertEqual(request,before)

    def test_seed_must_be_independent_and_missing_inputs_are_explained(self):
        request=sample_request();intent,snapshot,plan,package=arguments(request)
        self.assertEqual(compile_scene(intent,snapshot,plan,package)['error']['code'],'INVALID_INPUT')
        intent['assignment_seed']=43
        self.assertEqual(compile_scene(intent,snapshot,plan,package,assignment_seed=42)['error']['code'],'INVALID_INPUT')
        self.assertEqual(compile_scene(None,snapshot,plan,package,assignment_seed=42)['error']['code'],'INVALID_INPUT')
        self.assertEqual(compile_scene({'mode':'map'},snapshot,plan,package,assignment_seed=42)['error']['code'],'REF_MISMATCH')

    def test_explanations_are_independent_and_unknown_code_retains_diagnostic_identity(self):
        entry=describe_issue('SCENE_NO_CANDIDATE','original details');entry['actions'].clear()
        self.assertTrue(describe_issue('SCENE_NO_CANDIDATE')['actions'])
        self.assertEqual(describe_issue('UNREGISTERED_CODE')['code'],'UNREGISTERED_CODE')
        self.assertEqual(describe_issue('UNREGISTERED_CODE')['user_message'],ISSUE_MESSAGES['INVALID_INPUT']['user_message'])

    def test_cli_success_none_failures_and_usage_errors_are_json(self):
        env={**os.environ,'PYTHONIOENCODING':'utf-8'}
        def run(*args):
            process=subprocess.run([sys.executable,'-m','adapter.scene_service','compile',*map(str,args)],cwd=ROOT,
                                   env=env,capture_output=True,text=True,encoding='utf-8')
            response=json.loads(process.stdout)
            self.assertEqual(process.stderr,'')
            self.assertEqual(process.returncode,0 if response['ok'] else 2)
            return response
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);request=sample_request();intent,snapshot,plan,package=arguments(request)
            for name,value in (('intent',intent),('snapshot',snapshot),('plan',plan),('map',package)):
                (folder/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
            base=['--intent',folder/'intent.json','--snapshot',folder/'snapshot.json','--plan',folder/'plan.json','--assignment-seed','42']
            output=folder/'output.json'
            response=run(*base,'--map',folder/'map.json','--out',output)
            self.assertTrue(response['ok']);self.assertEqual(json.loads(output.read_text(encoding='utf-8')),response)
            intent.update(mode='none',reason='已确认不启用地图')
            (folder/'intent.json').write_text(json.dumps(intent),encoding='utf-8')
            self.assertTrue(run(*base,'--map',folder/'does-not-exist.json')['ok'])
            intent['reason']=''
            (folder/'intent.json').write_text(json.dumps(intent),encoding='utf-8')
            self.assertEqual(run(*base)['error']['code'],'INVALID_INPUT')
            self.assertEqual(run()['error']['code'],'INVALID_INPUT')
            self.assertEqual(run(*base,'--unknown-flag')['error']['code'],'INVALID_INPUT')
