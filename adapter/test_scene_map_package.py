"""Release bytes, immutable public maps and reviewed annotations."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from scene_builder.asset_library import published_asset_library,ASSET_DIRECTORY
from scene_service.common import SceneError
from scene_service.evidence import enrich_map
from scene_service.map_package import publish_map,json_bytes
from scene_service.maps import load_map
from scene_service.resolver import resolve
from scene_service.fixtures.synthetic import sample_request

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'frontend/public/mecoffe/scenarios/ustc-history'


class MapPackageCase(unittest.TestCase):
    def test_release_catalog_is_pinned_and_filtered(self):
        descriptor,catalog=published_asset_library()
        self.assertEqual(descriptor['version'],'mecoffe-embed-v1')
        self.assertEqual(descriptor['catalog_sha256'],hashlib.sha256((ASSET_DIRECTORY/'catalog.json').read_bytes()).hexdigest())
        self.assertTrue(all(p['source']['type']!='rocketbox' and not p['params'].get('person_id') for p in catalog['prototypes']))
        self.assertNotEqual(descriptor['catalog_sha256'],hashlib.sha256((ROOT/'frontend/public/mecoffe/assets3d/catalog.json').read_bytes()).hexdigest())

    def test_repeat_bytes_real_geometry_no_invented_dining_and_immutable_version(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'1';template=Path(temp)/'review.template.json'
            first=publish_map(SOURCE,out,'ustc-gaoxin','1','中科大测试',template_out=template)
            before={p.relative_to(out).as_posix():p.read_bytes() for p in out.rglob('*') if p.is_file()}
            self.assertEqual(first,publish_map(SOURCE,out,'ustc-gaoxin','1','中科大测试',template_out=template))
            self.assertEqual(before,{p.relative_to(out).as_posix():p.read_bytes() for p in out.rglob('*') if p.is_file()})
            package=load_map(out);original=load_map(SOURCE)
            self.assertEqual(package['map_ref'],first['map_ref'])
            self.assertEqual(package['campus']['walk_graph'],original['campus']['walk_graph'])
            self.assertEqual([(b['osm_id'],b['polygon'],b['kind']) for b in package['campus']['buildings']],
                             [(b['osm_id'],b['polygon'],b['kind']) for b in original['campus']['buildings']])
            self.assertEqual(first['quality']['function_counts']['dining'],0)
            request=sample_request();request['map']=package
            with self.assertRaises(SceneError) as missing:resolve(request)
            self.assertEqual(missing.exception.code,'SCENE_NO_CANDIDATE')
            self.assertEqual(first['quality']['buildings'],31)
            review=json.loads(template.read_text(encoding='utf-8'))
            self.assertEqual(len(review['buildings']),3)
            self.assertTrue(all(not e['functions'] and not e['reviewer'] and not e['source'] and not e['note'] for e in review['buildings'].values()))
            self.assertTrue(all(any(w in e['name'] for w in ('食堂','餐厅','咖啡')) for e in review['buildings'].values()))
            with self.assertRaises(SceneError) as error:publish_map(SOURCE,out,'ustc-gaoxin','1','改标题')
            self.assertEqual(error.exception.code,'MAP_VERSION_IMMUTABLE')
            self.assertEqual(before['manifest.json'],(out/'manifest.json').read_bytes())

    def test_unreviewed_template_rejected_reviewed_v2_roundtrips_and_binds_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);template=root/'review.template.json'
            first=publish_map(SOURCE,root/'1','ustc-gaoxin','1','中科大测试',template_out=template)
            with self.assertRaises(SceneError) as error:publish_map(SOURCE,root/'2','ustc-gaoxin','2','中科大测试',template)
            self.assertEqual(error.exception.code,'INVALID_ANNOTATION')
            review=json.loads(template.read_text(encoding='utf-8'));identifier=next(iter(review['buildings']))
            review['buildings']={identifier:{'functions':['dining'],'source':'合成测试审核来源','reviewer':'合成测试审核人','note':'仅本单元测试，不代表现实用途'}}
            reviewed=root/'reviewed.json';reviewed.write_bytes(json_bytes(review))
            publish_map(SOURCE,root/'2','ustc-gaoxin','2','中科大测试',reviewed)
            second=enrich_map(load_map(root/'2'))
            building=next(b for b in second['campus']['buildings'] if b['osm_id']==identifier)
            self.assertIn('dining',building['functions']);self.assertEqual(building['function_annotation']['reviewer'],'合成测试审核人')
            self.assertEqual(load_map(root/'1')['map_ref'],first['map_ref'])
            bad=copy.deepcopy(review);bad['map_ref']['manifest_sha256']='0'*64;reviewed.write_bytes(json_bytes(bad))
            with self.assertRaises(SceneError) as error:publish_map(SOURCE,root/'3','ustc-gaoxin','3','中科大测试',reviewed)
            self.assertEqual(error.exception.code,'REF_MISMATCH')
