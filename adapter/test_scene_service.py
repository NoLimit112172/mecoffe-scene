"""M15 semantic invariants, geometric exclusions, local CLI and shared contracts."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scene_service import SceneError, canonical, digest, enrich_map, resolve, validate_result
from scene_service.fixtures.synthetic import sample_request
from scene_service.geometry import valid_ring, within_scope

ROOT=Path(__file__).resolve().parent.parent
FIXTURES=ROOT/'adapter/scene_service/fixtures'


def placements(result,key='assignments',identity='entity_id'):
    return {x[identity]:x['building_id'] for x in result[key]}


class SceneServiceCase(unittest.TestCase):
    def setUp(self):
        self.request=sample_request()

    def assertCode(self,code,action):
        with self.assertRaises(SceneError) as caught:
            action()
        self.assertEqual(caught.exception.code,code)

    def test_repeat_order_independence_seed_and_no_mutation(self):
        original=copy.deepcopy(self.request); first=resolve(self.request)
        self.assertEqual(resolve(self.request),first)
        self.assertEqual(self.request,original)
        self.request['snapshot']['nodes'].reverse()
        self.request['map']['campus']['buildings'].reverse()
        self.request['map']['entrances']['entrances'].reverse()
        self.assertEqual(resolve(self.request),first)
        self.request['assignment_seed']=43
        other=resolve(self.request)
        self.assertNotEqual(placements(first),placements(other))
        self.assertNotEqual(first['result_sha256'],other['result_sha256'])

    def test_brand_reorder_reissued_ids_owners_and_separate_service_points(self):
        first=resolve(self.request)
        economy=self.request['plan']['economy']
        economy['brands'].reverse(); economy['products'].reverse()
        for i,(brand,product) in enumerate(zip(economy['brands'],economy['products'])):
            brand['brand_id']=product['brand_id']=f'brand_{i+1}'
        other=resolve(self.request)
        self.assertEqual(placements(first,'service_points','brand_name'),placements(other,'service_points','brand_name'))
        self.assertNotEqual(first['service_points'][0]['brand_id'],other['service_points'][0]['brand_id'])
        stores=first['service_points']
        self.assertEqual(len({x['building_id'] for x in stores}),2)
        homes=placements(first)
        self.assertTrue(all(homes[x['owner_entity_id']]!=x['building_id'] for x in stores))

    def test_balanced_add_person_keeps_existing_locations_with_explicit_new_snapshot(self):
        first=resolve(self.request)
        self.request['snapshot']['nodes'].append({'entity_id':'synthetic_new','role':'synthetic_student'})
        self.request['snapshot']['snapshot_revision']=2
        self.request['plan']['population']['snapshot_revision']=2
        other=resolve(self.request)
        self.assertEqual(placements(first),{k:v for k,v in placements(other).items() if k!='synthetic_new'})

    def test_rename_unknown_roles_brands_functions_and_reference_errors(self):
        bad=copy.deepcopy(self.request); bad['plan']['economy']['products'][0]['product_name']='合成品牌改名'
        self.assertCode('BRAND_NAME_MISMATCH',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['role_prefs']['extra']=bad['role_prefs']['synthetic_student']
        self.assertCode('UNKNOWN_ROLE',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['overrides']['brands']['unknown']='synthetic/b3'
        self.assertCode('UNKNOWN_BRAND',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['role_prefs']['synthetic_student']['functions']=['invented']
        self.assertCode('UNKNOWN_FUNCTION',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['overrides']['entities']['synthetic_student_000']='missing'
        self.assertCode('OVERRIDE_INVALID',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['plan']['population']['snapshot_revision']=2
        self.assertCode('REF_MISMATCH',lambda:resolve(bad))
        bad=copy.deepcopy(self.request);bad['map']['quality']={'status':'preview_only'}
        self.assertCode('MAP_NOT_READY',lambda:resolve(bad))

    def test_brand_mapping_requires_bijection_and_snapshot_owner(self):
        for mutate in (lambda e:e['products'].pop(),lambda e:e['products'].append(copy.deepcopy(e['products'][0])),
                       lambda e:e['products'][1].update(product_name=e['products'][0]['product_name'])):
            bad=copy.deepcopy(self.request);mutate(bad['plan']['economy'])
            self.assertCode('BRAND_NAME_MISMATCH',lambda:resolve(bad))
        self.request['plan']['economy']['brands'][0]['owner_entity_id']='missing'
        self.assertCode('REF_MISMATCH',lambda:resolve(self.request))

    def test_fallbacks_are_explicit_complete_and_assumptions_preserved(self):
        self.request['role_prefs']['synthetic_student']['functions']=['retail']
        self.assertCode('SCENE_NO_CANDIDATE',lambda:resolve(self.request))
        self.request['role_prefs']['synthetic_student']['fallback']='out_of_scene'
        result=resolve(self.request)
        self.assertEqual(len(result['assignments']),26)
        self.assertEqual(sum(x['status']=='out_of_scene' for x in result['assignments']),24)
        self.assertEqual(result['assumptions'],self.request['assumptions'])
        self.assertTrue(result['warnings'])
        self.request['role_prefs']['synthetic_student']['fallback']='any_building_in_scope'
        self.assertTrue(all(x['status']=='placed' for x in resolve(self.request)['assignments']))
        self.request['brand_prefs']['合成品牌甲'].update(functions=['retail'],fallback='out_of_scene')
        self.assertEqual(next(x for x in resolve(self.request)['service_points'] if x['brand_name']=='合成品牌甲')['status'],'out_of_scene')

    def test_overrides_shared_stores_and_clustered_defaults(self):
        self.request['overrides']['brands']={name:'synthetic/b3' for name in self.request['brand_prefs']}
        self.request['overrides']['entities']['synthetic_student_000']='synthetic/b7'
        result=resolve(self.request)
        self.assertEqual(len(result['service_points']),2)
        self.assertEqual({x['building_id'] for x in result['service_points']},{'synthetic/b3'})
        self.assertEqual(placements(result)['synthetic_student_000'],'synthetic/b7')
        self.assertEqual(len({x['building_id'] for x in result['assignments'] if x['role']=='synthetic_operator'}),1)

    def test_none_needs_no_map_or_placement_prefs_and_has_integrity(self):
        for k in ('map','role_prefs','brand_prefs','overrides'):
            self.request.pop(k)
        self.request.update(mode='none',reason='已确认的合成网络实验')
        result=resolve(self.request)
        self.assertIsNone(result['map_ref']);self.assertEqual(result['assignments'],[])
        self.assertEqual(result['service_points'],[]);self.assertEqual(result['rules'],{})
        self.assertEqual(validate_result(result),result)

    def test_explicit_tag_values_residential_not_dorm_and_weak_not_strict(self):
        raw=self.request['map']; before=copy.deepcopy(raw)
        b=raw['campus']['buildings'][7]
        b['tags'].update(amenity='university',shop='not_a_real_shop')
        enriched=enrich_map(raw)
        by_id={b['osm_id']:b for b in enriched['campus']['buildings']}
        self.assertEqual(by_id['synthetic/b5']['functions'],['residential'])
        self.assertEqual(by_id['synthetic/b6']['functions'],['dormitory'])
        self.assertEqual(by_id['synthetic/b7']['functions'],['unknown'])
        self.assertTrue(any(e['source']=='name_keyword' for e in by_id['synthetic/b7']['function_evidence']))
        self.assertTrue(all(b['kind']=='legacy-appearance' for b in enriched['campus']['buildings']))
        self.assertEqual(before['campus']['buildings'][0],raw['campus']['buildings'][0])

    def test_poi_unique_strict_containment_holes_boundaries_and_overlaps(self):
        raw=self.request['map']; b=raw['campus']['buildings'][0]
        b['holes']=[[[2,12],[4,12],[4,14],[2,14],[2,12]]]
        duplicate=copy.deepcopy(raw['campus']['buildings'][1]);duplicate.update(osm_id='synthetic/overlap')
        raw['campus']['buildings'].append(duplicate)
        points=[[6,16],[3,13],[0,15],[25,15],[500,500]]
        raw['campus']['pois']=[{'osm_id':f'synthetic/poi{i}','point':p,'tags':{'amenity':'cafe'}} for i,p in enumerate(points)]
        out=enrich_map(raw)
        self.assertEqual(out['quality']['poi'],{'total':5,'associated':1,'ambiguous':1,'unassociated':3,'invalid':0})
        self.assertIn('dining',out['campus']['buildings'][0]['functions'])
        self.assertFalse(any(e['source']=='poi' for e in out['campus']['buildings'][1]['function_evidence']))

    def test_annotations_bind_map_and_retain_override_provenance(self):
        annotations={'map_ref':self.request['map']['map_ref'],'buildings':{'synthetic/b0':{
            'functions':['retail'],'mode':'replace','source':'synthetic reviewed note','reviewer':'synthetic-reviewer','note':'合成补注'}}}
        package=enrich_map(self.request['map'],annotations)
        b=package['campus']['buildings'][0]
        self.assertEqual(b['functions'],['retail'])
        self.assertTrue(b['superseded_function_evidence'])
        self.assertEqual(enrich_map(package)['campus']['buildings'][0],b)
        bad=copy.deepcopy(annotations);bad['map_ref']['map_version']='2'
        self.assertCode('REF_MISMATCH',lambda:enrich_map(self.request['map'],bad))

    def test_unreachable_outside_water_and_connector_crossing_are_excluded(self):
        raw=self.request['map']
        raw['entrances']['entrances'][0]['connected']=False
        raw['campus']['buildings'][1]['polygon']=[[1000,10],[1010,10],[1010,20],[1000,20],[1000,10]]
        raw['landcover']['features']=[{'kind':'water','polygon':[[40,4],[50,4],[50,6],[40,6],[40,4]]}]
        out=enrich_map(raw,min_main_ratio=0)
        by_id={b['osm_id']:b for b in out['campus']['buildings']}
        self.assertTrue(all(not by_id[f'synthetic/b{i}']['scene_eligible'] for i in (0,1,2)))
        self.request['map']=out;self.request['overrides']['entities']['synthetic_student_000']='synthetic/b2'
        self.assertCode('OVERRIDE_INVALID',lambda:resolve(self.request))
        self.assertFalse(valid_ring([[0,0],[10,10],[0,10],[10,0],[0,0]]))

    def test_quality_threshold_and_dangling_graph_do_not_certify_access(self):
        raw=self.request['map'];raw['campus']['walk_graph']['edges']=[]
        out=enrich_map(raw,min_main_ratio=0)
        self.assertEqual(out['quality']['status'],'preview_only')
        self.assertEqual(out['quality']['eligible_buildings'],0)
        self.assertCode('INVALID_THRESHOLD',lambda:enrich_map(raw,min_main_ratio=1.1))

    def test_scope_checks_edges_across_concavities_and_enclosed_scope_holes(self):
        concave={'outer':[[0,0],[10,0],[10,10],[6,10],[6,4],[4,4],[4,10],[0,10],[0,0]],'holes':[]}
        building={'polygon':[[2,6],[8,6],[8,8],[2,8],[2,6]]}
        self.assertFalse(within_scope(building,concave))
        part={'outer':[[0,0],[10,0],[10,10],[0,10],[0,0]],'holes':[[[4,4],[6,4],[6,6],[4,6],[4,4]]]}
        building={'polygon':[[2,2],[8,2],[8,8],[2,8],[2,2]]}
        self.assertFalse(within_scope(building,part))

    def test_graph_duplicate_and_invalid_water_are_explicit_errors(self):
        bad=copy.deepcopy(self.request['map']);bad['campus']['walk_graph']['nodes'].append(copy.deepcopy(bad['campus']['walk_graph']['nodes'][0]))
        self.assertCode('INVALID_MAP',lambda:enrich_map(bad))
        bad=copy.deepcopy(self.request['map']);bad['landcover']['features']=[{'kind':'water','polygon':[]}]
        self.assertCode('INVALID_MAP',lambda:enrich_map(bad))

    def test_shared_fixtures_have_expected_conclusions_and_codes(self):
        index=json.loads((FIXTURES/'index.json').read_text(encoding='utf-8'))
        for name in index['cases']:
            case=json.loads((FIXTURES/name).read_text(encoding='utf-8'))
            context=json.loads((FIXTURES/case['context_ref']).read_text(encoding='utf-8'))
            with self.subTest(name=name):
                if case['valid']:
                    validate_result(case['result'],context)
                else:
                    self.assertCode(case['code'],lambda:validate_result(case['result'],context))

    def test_portable_canonical_unicode_numeric_keys_and_rejections(self):
        value={'10':'十','2':'二','\U00010000':'astral','\ue000':'bmp','n':-0.0,'text':'\r\n\u2028🙂'}
        self.assertEqual(canonical(value),'{"10":"十","2":"二","n":0,"text":"\\r\\n\u2028🙂","\ue000":"bmp","\U00010000":"astral"}')
        for bad in (1.25,9007199254740992,float('nan'),'\ud800'):
            self.assertCode('INVALID_JSON',lambda:canonical(bad))

    def test_cli_resolve_validate_evidence_and_error_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'result.json'
            base=[sys.executable,'-m','adapter.scene_service']
            args=['resolve','--map',str(FIXTURES/'map.json'),'--snapshot',str(FIXTURES/'snapshot.json'),
                  '--plan',str(FIXTURES/'plan.json'),'--prefs',str(FIXTURES/'prefs.json'),'--out',str(target)]
            proc=subprocess.run(base+args,cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(proc.returncode,0,proc.stderr)
            proc=subprocess.run(base+['validate',str(target)],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(proc.returncode,0,proc.stderr)
            proc=subprocess.run(base+['evidence','--map',str(FIXTURES/'map.json'),'--out',str(target)],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(proc.returncode,0,proc.stderr)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['quality']['status'],'ready')
            proc=subprocess.run(base+['validate',str(target)],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(proc.returncode,2)
            self.assertIn('INVALID_JSON',proc.stderr)


if __name__=='__main__':
    unittest.main()
