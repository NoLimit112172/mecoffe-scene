"""Broad-phase candidates retain the full-scan geometry/evidence conclusions."""
import copy
import json
import random
import unittest
from unittest.mock import patch

from scene_service import SceneError
from scene_service.evidence import enrich_map
from scene_service.fixtures.synthetic import sample_request
from scene_service.fixtures.taxonomy import layered_request
from scene_service.geometry import EPS, in_building
from scene_service.spatial_index import BoundsIndex, coordinate_bounds


def rectangle(west, south, east, north):
    return [[west,south],[east,south],[east,north],[west,north],[west,south]]


class FullScan:
    """Independent oracle: send every record to the unmodified exact predicates."""
    def __init__(self, records, bounds, **kwargs):
        self.records = list(records)

    def query(self, bounds):
        return self.records


class SpatialIndexCase(unittest.TestCase):
    def equivalent(self, package):
        before = copy.deepcopy(package)
        actual = enrich_map(package, min_main_ratio=0)
        with patch('scene_service.evidence.BoundsIndex', FullScan):
            expected = enrich_map(package, min_main_ratio=0)
        self.assertEqual(json.dumps(actual, ensure_ascii=False, sort_keys=True),
                         json.dumps(expected, ensure_ascii=False, sort_keys=True))
        self.assertEqual(package, before)
        return actual

    def test_grid_boundaries_negative_coordinates_stability_and_overflow(self):
        records = [rectangle(64,64,65,65), rectangle(-65,-65,-64,-64),
                   rectangle(-10000,-10000,10000,10000), rectangle(64,64,65,65)]
        index = BoundsIndex(records, coordinate_bounds, max_cells=4)
        # Exact cell edges and the huge polygon are retained in input order.
        self.assertEqual(index.query((64,64,64,64)), [records[i] for i in (0,2,3)])
        self.assertEqual(index.query((-64,-64,-64,-64)), [records[i] for i in (1,2)])
        self.assertEqual(index.query((-1e8,-1e8,1e8,1e8)), records)
        # Local queries do not retain every distant small geometry.
        self.assertEqual(index.query((500,500,500,500)), [records[2]])
        self.assertEqual(BoundsIndex([],coordinate_bounds).query((0,0,0,0)), [])

    def test_tolerance_candidates_cover_every_exact_boundary_match(self):
        building={'polygon':rectangle(0,0,10,10),'holes':[rectangle(3,3,7,7)]}
        index=BoundsIndex([building],lambda b:coordinate_bounds(b['polygon']))
        for p in ([10+EPS*.5,5],[-EPS*.5,5],[5,5],[3,5],[10+EPS*3,5],[1,1]):
            for strict in (True,False):
                with self.subTest(point=p,strict=strict):
                    exact=in_building(p,building,strict)
                    if exact:
                        self.assertIn(building,index.query((*p,*p)))
        self.assertEqual(index.query((10+EPS*3,5,10+EPS*3,5)), [])

    def test_poi_holes_touching_overlap_invalid_points_and_invalid_buildings(self):
        package=sample_request()['map']
        package['campus']['buildings'][0]['holes']=[rectangle(2,12,4,14)]
        duplicate=copy.deepcopy(package['campus']['buildings'][1])
        duplicate['osm_id']='synthetic/overlap'
        invalid=copy.deepcopy(package['campus']['buildings'][0])
        invalid.update(osm_id='synthetic/invalid',polygon=rectangle(900,900,900,900))
        package['campus']['buildings'].extend([duplicate,invalid])
        points=[[6,16],[3,13],[0,15],[10+EPS*.5,15],[25,15],[500,500],[None,1]]
        package['campus']['pois']=[{'osm_id':f'synthetic/p{i}','point':p,'tags':{'amenity':'cafe'}}
                                   for i,p in enumerate(points)]
        result=self.equivalent(package)
        self.assertEqual(result['quality']['poi']['invalid'],1)
        self.assertEqual(result['quality']['poi']['ambiguous'],1)
        self.assertEqual(result['quality']['valid_buildings'],len(package['campus']['buildings'])-1)

    def test_water_islands_courtyards_shores_and_crossing_connectors(self):
        package=sample_request()['map']
        package['campus']['buildings'][2]['holes']=[rectangle(42,12,48,18)]
        package['landcover']['features']=[
            {'kind':'water','polygon':rectangle(-5,-5,35,35),'holes':[rectangle(-1,9,11,21)]},
            {'kind':'water','polygon':rectangle(43,13,47,17)},
            {'kind':'water','polygon':rectangle(70,4,80,6)},
            {'kind':'water','polygon':rectangle(200,200,220,220)},
        ]
        self.equivalent(package)
        # Compare multiple deterministic arrangements rather than a single toy layout.
        rng=random.Random(129)
        for _ in range(6):
            package['landcover']['features']=[{'kind':'water','polygon':rectangle(x,y,x+3,y+3)}
                for x,y in ((rng.randrange(-20,180),rng.randrange(-20,40)) for _ in range(5))]
            self.equivalent(package)

    def test_invalid_water_remains_a_validation_error(self):
        package=sample_request()['map']
        package['landcover']['features']=[{'kind':'water','polygon':[]}]
        for index in (BoundsIndex,FullScan):
            with self.subTest(index=index), patch('scene_service.evidence.BoundsIndex',index):
                with self.assertRaises(SceneError) as error:
                    enrich_map(package)
                self.assertEqual(error.exception.code,'INVALID_MAP')

    def test_layered_primary_services_placeability_and_frozen_evidence_match_full_scan(self):
        package=layered_request()['map']
        result=self.equivalent(package)
        buildings=result['campus']['buildings']
        self.assertEqual(buildings[0]['functions'],['medical'])
        self.assertEqual(buildings[0]['services'],['dining'])
        self.assertEqual(buildings[1]['functions'],['residential'])
        self.assertEqual(buildings[1]['services'],['retail'])
        self.assertFalse(buildings[4]['scene_eligible'])
        self.assertFalse(buildings[5]['scene_eligible'])
        self.assertEqual(result['quality']['non_placeable_buildings'],2)
        self.assertEqual(result['quality']['evidence_policy']['version'],'auto-evidence.2')
        frozen=copy.deepcopy(result)
        frozen['evidence_frozen']=True
        repeated=self.equivalent(frozen)
        self.assertEqual(repeated['campus']['buildings'],result['campus']['buildings'])

    def test_candidate_filter_keeps_current_water_hole_policy_unchanged(self):
        package=sample_request()['map']
        package['landcover']['features']=[{
            'kind':'water','polygon':rectangle(-5,-5,35,35),
            'holes':[rectangle(-1,9,11,21)],
        }]
        result=self.equivalent(package)
        # This port accelerates the current outer-ring water predicates. It
        # must not silently import the other branch's changed hole semantics.
        self.assertFalse(result['campus']['buildings'][0]['scene_eligible'])


if __name__=='__main__':
    unittest.main()
