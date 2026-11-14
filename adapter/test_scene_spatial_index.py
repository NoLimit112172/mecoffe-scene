"""Compare indexed evidence directly with pinned c51f7bd implementation."""
import copy
import json
import random
import unittest
from unittest.mock import patch

from scene_service.evidence import enrich_map
from scene_service.fixtures.synthetic import sample_request
from scene_service.fixtures.taxonomy import layered_request
from scene_service.geometry import EPS, in_building
from scene_service.spatial_index import BoundsIndex, coordinate_bounds
from physical_map_test_oracle import SEPARATED_SEGMENTS, SOURCE_COMMIT, load_c51f7bd_modules


def rectangle(west, south, east, north):
    return [[west,south],[east,south],[east,north],[west,north],[west,south]]


class CurrentPredicateFullScan:
    """Index-only diagnostic; this is explicitly not the old-version oracle."""
    def __init__(self, records, bounds, **kwargs):
        self.records = list(records)

    def query(self, bounds):
        return self.records


class SpatialIndexCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_geometry,cls.old_evidence=load_c51f7bd_modules()

    def equivalent(self, package):
        before = copy.deepcopy(package)
        actual = enrich_map(package, min_main_ratio=0)
        expected = self.old_evidence.enrich_map(package, min_main_ratio=0)
        self.assertEqual(json.dumps(actual, ensure_ascii=False, sort_keys=True),
                         json.dumps(expected, ensure_ascii=False, sort_keys=True))
        self.assertEqual(package, before)
        return actual

    def separated_triangle_package(self):
        a,b,c,d=copy.deepcopy(SEPARATED_SEGMENTS)
        # Keep the entire building strictly to the left of the water. The two
        # almost-collinear edges alone trigger the old orientation roundoff.
        building={'osm_id':'synthetic/roundoff-building','name':'Synthetic roundoff school',
                  'building_type':'school','tags':{'building':'school'},'holes':[],
                  'polygon':[a,b,[a[0]-20,a[1]+10],a]}
        water={'kind':'water','polygon':[c,d,[d[0]+20,d[1]-10],c]}
        door=[a[0]-10,a[1]+5];road=[door[0]-20,door[1]]
        return {'map_ref':{'map_id':'synthetic-roundoff-water','map_version':'1','manifest_sha256':'0'*64},
            'campus':{'boundary':rectangle(-100,-100,400,400),'buildings':[building],'pois':[],
                'walk_graph':{'nodes':[{'id':'n0','x':road[0],'y':road[1]},
                                       {'id':'n1','x':road[0]-10,'y':road[1]}],
                              'edges':[{'source':'n0','target':'n1'}]}},
            'landcover':{'features':[water]},
            'entrances':{'entrances':[{'id':'door','building_id':building['osm_id'],'point':door,
                'road_node_id':'n0','connector':[door,road],'connected':True}]}}

    def test_separated_near_collinear_water_corrects_old_exclusion_without_hiding_a_difference(self):
        package=self.separated_triangle_package();before=copy.deepcopy(package)
        building=package['campus']['buildings'][0];water=package['landcover']['features'][0]
        self.assertTrue(self.old_geometry.valid_building(building))
        self.assertTrue(self.old_geometry.valid_building(water))
        # The complete polygons have separated X boxes, not merely two edges.
        self.assertLess(max(p[0] for p in building['polygon'])+2*EPS,min(p[0] for p in water['polygon']))
        old_crossings=[(i,j) for i,(a,b) in enumerate(zip(building['polygon'],building['polygon'][1:]))
            for j,(c,d) in enumerate(zip(water['polygon'],water['polygon'][1:]))
            if self.old_geometry.intersects(a,b,c,d)]
        self.assertEqual(old_crossings,[(0,0)])
        self.assertFalse(any(self.old_geometry.inside(p,water['polygon'],False) for p in building['polygon'][:-1]))
        self.assertFalse(any(self.old_geometry.in_building(p,building,False) for p in water['polygon'][:-1]))
        self.assertTrue(self.old_geometry.within_scope(building,{'outer':package['campus']['boundary'],'holes':[]}))
        old=self.old_evidence.enrich_map(package)
        actual=enrich_map(package)
        self.assertFalse(old['campus']['buildings'][0]['scene_eligible'])
        self.assertEqual(old['quality']['status'],'preview_only')
        self.assertEqual(old['quality']['eligible_buildings'],0)
        self.assertEqual([w['code'] for w in old['quality']['warnings']],['BUILDING_EXCLUDED'])
        self.assertTrue(actual['campus']['buildings'][0]['scene_eligible'])
        self.assertEqual(actual['quality']['status'],'ready')
        self.assertEqual(actual['quality']['eligible_buildings'],1)
        self.assertEqual(actual['quality']['warnings'],[])
        for result in [old,actual]:
            self.assertEqual(result['campus']['buildings'][0]['usable_entrance_ids'],['door'])
            self.assertEqual(result['quality']['valid_buildings'],1)
            self.assertEqual(result['quality']['main_component_ratio'],1)
        self.assertEqual(package,before)
        # With new predicates, removing candidate filtering preserves the fix;
        # the current FullScan is diagnostic only, never old-equivalence proof.
        with patch('scene_service.evidence.BoundsIndex',CurrentPredicateFullScan):
            self.assertEqual(enrich_map(package),actual)

    def test_historical_oracle_does_not_import_current_geometry_or_evidence_predicates(self):
        self.assertIn(SOURCE_COMMIT,self.old_geometry.__file__)
        self.assertIn(SOURCE_COMMIT,self.old_evidence.__file__)
        with (patch('scene_service.geometry.intersects',side_effect=AssertionError('current geometry')),
              patch('scene_service.evidence.intersects',side_effect=AssertionError('current evidence'))):
            historical=self.old_evidence.enrich_map(self.separated_triangle_package())
        self.assertEqual(historical['quality']['status'],'preview_only')

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
        for implementation in (enrich_map,self.old_evidence.enrich_map):
            with self.subTest(implementation=implementation.__module__):
                with self.assertRaises(ValueError) as error:
                    implementation(package)
                self.assertEqual(error.exception.code,'INVALID_MAP')

    def test_layered_primary_services_placeability_and_frozen_evidence_match_pinned_old(self):
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
