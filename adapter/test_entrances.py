import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from adapter.scene_builder.entrances import generate_entrances, project, distance, facade_midpoints
from adapter.scene_builder.scenario import ROOT, prepare_scenario
from adapter.scene_builder.gis import to_local


class EntranceTests(unittest.TestCase):
    def test_collinear_facade_nodes_merge_and_doors_are_at_wall_midpoints_not_corners(self):
        building={'polygon':[[0,0],[10,0],[20,0],[20,10],[0,10],[0,0]]}
        candidates=facade_midpoints(building)
        self.assertEqual(len(candidates),4)
        self.assertIn([10,0],[c[0] for c in candidates])
        self.assertNotIn([20,0],[c[0] for c in candidates])
        for point,normal,(a,b),length in candidates:
            self.assertEqual(point,[(a[0]+b[0])/2,(a[1]+b[1])/2])
            self.assertAlmostEqual((b[0]-a[0])*normal[0]+(b[1]-a[1])*normal[1],0)
    def test_map_without_roads_has_no_invented_graph_or_connector(self):
        campus={'campus_id':'empty','source':{},'projection':{'method':'local_equirectangular','origin_lon':0,'origin_lat':0,'earth_radius_m':6371008.8},
            'buildings':[{'osm_id':'one','polygon':[[0,0],[10,0],[10,10],[0,0]]}],'walk_graph':{'nodes':[],'edges':[]}}
        with tempfile.TemporaryDirectory() as temporary:
            local,_=generate_entrances(campus)
            self.assertFalse(local['entrances'][0]['connected']);self.assertIsNone(local['entrances'][0]['road_node_id']);self.assertEqual(local['entrances'][0]['connector'],[])
    def test_inferred_entrances_preserve_graph_and_snap_to_building_boundaries(self):
        for identifier in ('ustc-history','nus-hourly'):
            folder=ROOT/'frontend/public/mecoffe/scenarios'/identifier
            campus=json.loads((folder/'campus3d.json').read_text(encoding='utf8'));before=copy.deepcopy(campus)
            result,geo=generate_entrances(campus)
            self.assertEqual(campus,before)
            self.assertEqual(set(p['building_id'] for p in result['entrances']),set(b['osm_id'] for b in campus['buildings']))
            self.assertEqual(len(result['entrances']),len(campus['buildings']))
            nodes={p['id']:p for p in campus['walk_graph']['nodes']};buildings={b['osm_id']:b for b in campus['buildings']}
            for entry,feature in zip(result['entrances'],geo['features']):
                rings=[buildings[entry['building_id']]['polygon'],*buildings[entry['building_id']].get('holes',[])]
                self.assertLessEqual(min(distance(entry['point'],project(entry['point'],a,b)) for ring in rings for a,b in zip(ring,ring[1:]+ring[:1])),2.0001)
                self.assertEqual(entry['connector'][0],entry['point']);node=nodes[entry['road_node_id']]
                self.assertLess(distance(entry['connector'][-1],[node['x'],node['y']]),.001)
                self.assertLess(distance(to_local(feature['geometry']['coordinates'],campus['projection']),entry['point']),.5)
            sources=[p['source'] for p in result['entrances']]
            self.assertEqual(set(sources),{'inferred'})

    def test_entry_files_are_reproducible_hashed_and_old_bundle_bytes_remain_identical(self):
        with tempfile.TemporaryDirectory() as temporary:
            for identifier in ('ustc-history','nus-hourly'):
                one,a=prepare_scenario(ROOT/f'scenarios/{identifier}.json',Path(temporary)/'a')
                two,b=prepare_scenario(ROOT/f'scenarios/{identifier}.json',Path(temporary)/'b')
                self.assertEqual(one,two)
                for name in one['files']:
                    self.assertEqual((a/name).read_bytes(),(b/name).read_bytes())
                    self.assertEqual(hashlib.sha256((a/name).read_bytes()).hexdigest(),one['files'][name])


if __name__=='__main__':unittest.main()
