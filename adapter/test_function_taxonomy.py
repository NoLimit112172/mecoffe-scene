"""Version-frozen layered uses and exact pre-change compilation baselines."""
import copy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

from scene_service.common import canonical, digest, SceneError
from scene_service.compiler import compile_scene
from scene_service.checker import check_scene
from scene_service.evidence import enrich_map, tag_evidence
from scene_service.auto_evidence import prepare_ai_review, validate_rules
from scene_service.fixtures.synthetic import sample_request
from scene_service.fixtures.taxonomy import layered_request
from scene_service.maps import load_map
from scene_service.resolver import resolve
from scene_service.taxonomy import FUNCTIONS, NON_PLACEABLE
from scene_service.validation import validate_result
from test_auto_evidence import prediction

ROOT=Path(__file__).resolve().parents[1]


class TaxonomyCase(unittest.TestCase):
    def setUp(self):
        self.request=layered_request();self.package=self.request['map']

    def assertCode(self,code,call):
        with self.assertRaises(SceneError) as caught:call()
        self.assertEqual(caught.exception.code,code)

    def test_hospital_home_services_and_primary_precedence(self):
        package=enrich_map(self.package);b=package['campus']['buildings']
        self.assertEqual(b[0]['functions'],['medical']);self.assertEqual(b[0]['services'],['dining'])
        self.assertEqual(b[1]['functions'],['residential']);self.assertEqual(b[1]['services'],['retail'])
        self.assertEqual(b[6]['functions'],['retail']);self.assertEqual(b[7]['functions'],['research'])
        self.assertEqual(package['quality']['primary_function_counts']['medical'],1)
        self.assertEqual(package['quality']['buildings_with_services'],2)
        self.assertEqual(package['quality']['non_placeable_buildings'],2)
        # A bare plaza name is not enough to assert a mall; concrete mall tags are.
        self.package['campus']['buildings'][6].update(name='合成XX广场',tags={'shop':'mall'},building_type='yes')
        self.assertEqual(enrich_map(self.package)['campus']['buildings'][6]['functions'],['retail'])

    def test_poi_only_primary_is_marked_and_still_needs_ai_review(self):
        b=self.package['campus']['buildings'][3]
        self.package['campus']['pois'].append({'osm_id':'synthetic/only-shop','point':[65,15],'tags':{'shop':'convenience'}})
        enriched=enrich_map(self.package);b=enriched['campus']['buildings'][3]
        self.assertEqual(b['functions'],['retail']);self.assertTrue(b['primary_from_services'])
        self.assertTrue(b['needs_ai_review'])
        self.request['overrides']['brands']['合成品牌乙']=b['osm_id']
        self.request['role_prefs']['synthetic_student']['functions']=['retail']
        self.request['overrides']['entities']['synthetic_student_000']=b['osm_id']
        result=resolve(self.request)
        placed=next(x for x in result['assignments'] if x['entity_id']=='synthetic_student_001')
        # Force the only strict retail primary to be the POI-derived building.
        self.package['campus']['buildings'][6]['name']='合成未知楼'
        result=resolve(self.request)
        self.assertIn('仅据楼内店铺推断',next(x for x in result['assignments'] if x['entity_id']=='synthetic_student_001')['reason'])
        review=prepare_ai_review(self.package,self.package['evidence_rules'])
        self.assertIn(b['osm_id'],{x['building_id'] for x in review['buildings']})
        self.assertEqual(set(review['function_definitions']),set(FUNCTIONS))

    def test_people_primary_only_brands_primary_then_service(self):
        result=resolve(self.request)
        self.assertEqual(result['schema_version'],'scene.result.v3')
        cafe=next(x for x in result['service_points'] if x['brand_name']=='合成品牌甲')
        self.assertEqual(cafe['building_id'],'synthetic/b0');self.assertIn('医疗楼内有餐饮服务',cafe['reason'])
        self.assertTrue(all(e['layer']=='service' for e in cafe['evidence']))
        retail=next(x for x in result['service_points'] if x['brand_name']=='合成品牌乙')
        self.assertEqual(retail['building_id'],'synthetic/b6')
        self.assertTrue(all(e['layer']=='primary' for e in retail['evidence']))
        self.request['role_prefs']['synthetic_student']['functions']=['dining']
        self.assertCode('SCENE_NO_CANDIDATE',lambda:resolve(self.request))

    def test_non_placeable_classes_block_override_and_fallback_unknown_allowed(self):
        for key in NON_PLACEABLE:
            with self.subTest(function=key):
                package=copy.deepcopy(self.package)
                package['campus']['buildings'][3].update(name='',tags={'building':{'transport':'train_station','utility':'gatehouse','construction':'construction'}[key]})
                package['campus']['buildings'][3]['building_type']=package['campus']['buildings'][3]['tags']['building']
                request=copy.deepcopy(self.request);request['map']=package
                request['overrides']['brands']['合成品牌甲']='synthetic/b3'
                self.assertCode('OVERRIDE_INVALID',lambda:resolve(request))
        for p in list(self.request['role_prefs'].values())+list(self.request['brand_prefs'].values()):
            p.update(functions=['hotel'],fallback='any_building_in_scope')
        result=resolve(self.request)
        ids={x['building_id'] for x in result['assignments']+result['service_points']}
        self.assertFalse(ids & {'synthetic/b4','synthetic/b5'})
        self.assertIn('synthetic/b3',ids)

    def test_ai_new_functions_threshold_and_annotation_precedence(self):
        ai=prediction(self.package,{'synthetic/b3':(['hotel'],.8),'synthetic/b6':(['medical'],.799)})
        package=enrich_map(self.package,ai_evidence=ai);b=package['campus']['buildings']
        self.assertEqual(b[3]['functions'],['hotel']);self.assertEqual(b[6]['functions'],['retail'])
        self.assertEqual(b[3]['function_evidence'][0]['confidence_pct'],80)
        ai['buildings']['synthetic/b3']['confidence']=.799
        self.assertEqual(enrich_map(self.package,ai_evidence=ai)['campus']['buildings'][3]['functions'],['unknown'])
        annotations={'map_ref':self.package['map_ref'],'buildings':{'synthetic/b0':{'functions':['office'],'source':'合成审核',
            'reviewer':'合成确认','note':'合成替换测试','mode':'replace'}}}
        b=enrich_map(self.package,annotations)['campus']['buildings'][0]
        self.assertEqual(b['functions'],['office']);self.assertEqual(b['services'],['dining'])

    def test_rules_explicit_values_conflict_and_legacy_retail_unchanged(self):
        rules=self.package['evidence_rules'];validate_rules(rules)
        self.assertEqual(tag_evidence({'building':'commercial','amenity':'university'},'building_tag','x',rules),[])
        self.assertEqual(tag_evidence({'shop':'hairdresser'},'building_tag','x',rules)[0]['function'],'life_service')
        rules=copy.deepcopy(rules);rules['name_rules'].append({'id':'synthetic-conflict','function':'library','pattern':'购物广场$'})
        rules['sha256']=digest({k:v for k,v in rules.items() if k!='sha256'})
        b=enrich_map(self.package,auto_rules=rules)['campus']['buildings'][6]
        self.assertEqual(b['functions'],['unknown'])
        self.assertFalse(any(e['source']=='name_rule' for e in b['function_evidence']))

    def test_v3_layers_reject_forged_people_and_non_placeable_context(self):
        result=resolve(self.request);bad=copy.deepcopy(result)
        bad['assignments'][0]['evidence'][0]['layer']='service'
        bad['result_sha256']=digest({k:v for k,v in bad.items() if k!='result_sha256'})
        self.assertCode('INVALID_SCENE',lambda:validate_result(bad))
        validate_result(result,{'map':enrich_map(self.package),'snapshot':self.request['snapshot'],'plan':self.request['plan']})

    def test_new_frozen_map_rules_ai_bytes_and_result_are_reproducible(self):
        directory=ROOT/'frontend/tests/fixtures/scene-taxonomy'
        bundle=json.loads((directory/'input-v3.json').read_text(encoding='utf-8'))
        package=load_map(directory/'maps/synthetic-taxonomy/1')
        self.assertEqual(compile_scene(bundle['intent'],bundle['snapshot'],bundle['plan'],package,assignment_seed=42),bundle['expected'])
        report=check_scene(bundle['intent'],bundle['snapshot'],bundle['plan'],directory/'maps/synthetic-taxonomy/1',assignment_seed=42)
        self.assertTrue(report['configuration_ok'],report)
        self.assertEqual(report['result'],bundle['expected']['result'])
        self.assertEqual((directory/'maps/synthetic-taxonomy/1/evidence-rules.json').read_bytes(),
                         (ROOT/'adapter/scene_service/evidence_rules_v2.json').read_bytes())
        altered=copy.deepcopy(package['evidence_rules']);altered['ai_min_confidence_pct']=90
        altered['sha256']=digest({k:v for k,v in altered.items() if k!='sha256'})
        self.assertCode('MAP_VERSION_IMMUTABLE',lambda:enrich_map(package,auto_rules=altered))
        generate=runpy.run_path(str(ROOT/'scripts/generate-taxonomy-fixtures.py'))['generate']
        with tempfile.TemporaryDirectory() as temporary:
            generate(temporary)
            for file in directory.rglob('*'):
                if file.is_file():self.assertEqual(file.read_bytes(),(Path(temporary)/file.relative_to(directory)).read_bytes(),str(file))

    def test_name_exclusions_and_concrete_traffic_utility_names(self):
        tests=[('合成校医院','medical'),('合成消防站','government'),('合成火车站','transport'),
               ('合成配电房','utility'),('合成废弃楼','construction'),('原合成医院','unknown'),
               ('合成医院路口','unknown'),('合成北门','unknown')]
        for name,function in tests:
            with self.subTest(name=name):
                package=copy.deepcopy(self.package)
                package['campus']['buildings'][3]['name']=name
                self.assertEqual(enrich_map(package)['campus']['buildings'][3]['functions'],[function])

    def test_non_placeable_service_categories_do_not_become_brand_candidates(self):
        self.package['campus']['pois'].append({'osm_id':'synthetic/utility-poi','point':[5,15],'tags':{'power':'transformer'}})
        self.request['brand_prefs']['合成品牌甲']['functions']=['utility']
        self.assertCode('SCENE_NO_CANDIDATE',lambda:resolve(self.request))


class LegacyBaselineCase(unittest.TestCase):
    def test_all_existing_map_compilations_and_bytes_match_pre_change_baseline(self):
        baseline=json.loads((ROOT/'adapter/scene_service/fixtures/compat/legacy-compile-baseline.json').read_text(encoding='utf-8'))
        for name,sha in baseline['map_files'].items():
            with self.subTest(file=name):self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),sha)
        packages={}
        for case in baseline['cases']:
            with self.subTest(map=case['map'],function=case.get('function')):
                req=sample_request()
                if case['map'] is None:
                    intent=case['intent'];package=None
                else:
                    if case['map'] not in packages:
                        packages[case['map']]=req['map'] if case['map']=='sample_request' else load_map(ROOT/case['map'])
                    package=packages[case['map']]
                    for pref in list(req['role_prefs'].values())+list(req['brand_prefs'].values()):
                        pref.update(functions=[case['function']],fallback='any_building_in_scope')
                    intent={k:v for k,v in req.items() if k not in ('map','snapshot','plan','assignment_seed')}
                actual=compile_scene(intent,req['snapshot'],req['plan'],package,assignment_seed=42)
                self.assertEqual(canonical(actual),canonical(case['expected']))


if __name__=='__main__':unittest.main()
