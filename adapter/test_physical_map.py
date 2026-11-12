"""Offline physical-map acceptance: scopes, exact buffer, limits and legacy bytes."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from adapter.scene_builder.core import _graph
from adapter.scene_builder.io import MapInputError
from adapter.scene_builder.physical_map import PhysicalMapLimits, prepare_physical_map
from adapter.scene_builder.physical_scope import clip_intervals, clip_roads
from adapter.scene_service.evidence import enrich_map
from adapter.scene_service.maps import load_map

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT/'adapter/scene_service/evidence_rules_v2.json'


def geo(p):
    return [100+math.degrees(p[0]/(6371000*math.cos(math.radians(30)))), 30+math.degrees(p[1]/6371000)]


def ring(points):
    return [geo(p) for p in points]


def polygon(points, holes=()):
    return {'type': 'Polygon', 'coordinates': [ring(points), *[ring(h) for h in holes]]}


def fixture(directory):
    """Synthetic OSM, no team/population data and no network dependency."""
    directory = Path(directory)
    osm = ET.Element('osm', version='0.6', generator='synthetic-physical-map-test')
    next_id = 0
    def node(p, tags=None):
        nonlocal next_id
        next_id += 1
        lon, lat = geo(p)
        element = ET.SubElement(osm, 'node', id=str(next_id), lon=str(lon), lat=str(lat))
        for k, v in (tags or {}).items():
            ET.SubElement(element, 'tag', k=k, v=v)
        return str(next_id)
    def way(identifier, points, tags, closed=False):
        ids = [node(p) for p in points]
        if closed:
            ids.append(ids[0])
        element = ET.SubElement(osm, 'way', id=str(identifier))
        for ref in ids:
            ET.SubElement(element, 'nd', ref=ref)
        for k, v in tags.items():
            ET.SubElement(element, 'tag', k=k, v=v)
    for i, (x, y) in enumerate(((30, 130), (130, 130), (290, 130), (430, 130), (220, 230))):
        way(i+1, [[x,y],[x+20,y],[x+20,y+20],[x,y+20]],
            {'building':'dormitory', 'name':f'合成宿舍{i}'}, True)
    way(100, [[x,100] for x in range(-100, 601, 50)], {'highway':'footway', 'name':'合成主路'})
    way(101, [[0,-25],[150,-25],[300,-25]], {'highway':'footway', 'name':'合成缓冲内路'})
    way(102, [[0,-80],[300,-80]], {'highway':'footway', 'name':'合成缓冲外路'})
    node([40,140], {'amenity':'restaurant', 'name':'合成楼内店'})
    raw = ET.tostring(osm, encoding='utf-8', xml_declaration=True)
    directory.mkdir(parents=True, exist_ok=True)
    source = directory/'synthetic.osm'; source.write_bytes(raw)
    metadata = directory/'synthetic.metadata.json'
    metadata.write_text(json.dumps({'synthetic':True, 'sha256':hashlib.sha256(raw).hexdigest(),
        'bbox':[*geo([-150,-150]), *geo([650,450])], 'attribution':'Synthetic fixture; no real place',
        'source_url':'offline:synthetic', 'downloaded_at_utc':'2026-01-01T00:00:00Z'}), encoding='utf-8')
    return source, metadata


RECT = [[0,0],[300,0],[300,300],[0,300],[0,0]]
SCOPES = {
    'concave': polygon([[0,0],[300,0],[300,200],[180,200],[180,300],[0,300],[0,0]]),
    'hole': polygon(RECT, [[[100,120],[180,120],[180,180],[100,180],[100,120]]]),
    'multi': {'type':'MultiPolygon', 'coordinates': [polygon([[0,0],[180,0],[180,300],[0,300],[0,0]])['coordinates'],
                polygon([[240,0],[340,0],[340,300],[240,300],[240,0]])['coordinates']]},
    'crossing': polygon(RECT),
    'buffer': polygon(RECT),
}


def tree_bytes(directory):
    return {p.relative_to(directory).as_posix():p.read_bytes() for p in directory.rglob('*') if p.is_file()}


class PhysicalMapCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.osm, self.metadata = fixture(self.work/'input')

    def prepare(self, scope=None, **options):
        return prepare_physical_map(self.osm, self.metadata, scope or SCOPES['crossing'],
            scope_source={'type':'manual', 'note':'合成样例'}, title='合成物理地图',
            map_id='synthetic-physical', rules_path=options.pop('rules_path',RULES), out=options.pop('out',self.work/'map'), **options)

    def assertCode(self, code, call):
        with self.assertRaises(MapInputError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        self.assertRegex(str(caught.exception), r'[\u4e00-\u9fff]')

    def test_each_scope_publishes_valid_complete_ready_map(self):
        for name, scope in SCOPES.items():
            with self.subTest(scope=name):
                phases = []
                out, draft = self.work/name, self.work/(name+'-draft')
                result = self.prepare(scope, out=out, draft_out=draft, progress=phases.append)
                loaded = load_map(out)
                enriched = enrich_map(loaded)
                self.assertEqual(result['summary']['status'], 'ready')
                self.assertEqual(loaded['quality'], result['quality'])
                # Publication additionally freezes input_map_ref; enrichment's
                # quality policy is intentionally only the rules summary.
                self.assertEqual({k:v for k,v in enriched['quality'].items() if k!='evidence_policy'},
                                 {k:v for k,v in result['quality'].items() if k!='evidence_policy'})
                self.assertEqual([x['phase'] for x in phases],
                    ['reading','geometry','entrances_gis','evidence_quality','publishing'])
                self.assertTrue((draft/'entrances.json').is_file())
                self.assertEqual(len(list((out/'gis').glob('*.geojson'))), 7)
                self.assertFalse((out/'trajectory.json').exists())
                self.assertNotIn('simulation_time', json.loads((out/'manifest.json').read_bytes()))
                buildings = {b['osm_id']:b for b in enriched['campus']['buildings']}
                self.assertTrue(buildings['way/1']['scene_eligible'])
                if name == 'hole':
                    self.assertFalse(buildings['way/2']['scene_eligible'])
                if name == 'concave':
                    self.assertFalse(buildings['way/5']['scene_eligible'])
                if name in ('crossing','hole','concave'):
                    self.assertFalse(buildings['way/3']['scene_eligible'])
                if name == 'multi':
                    self.assertEqual(len(enriched['campus']['boundary_polygons']),2)
                    self.assertTrue(buildings['way/3']['scene_eligible'])
                roads = {r['osm_id'] for r in enriched['campus']['roads']}
                self.assertIn('way/101', roads)
                self.assertNotIn('way/102', roads)
                gis = json.loads((out/'gis/boundary.geojson').read_bytes())['features'][0]['geometry']
                self.assertEqual(gis['type'],'MultiPolygon')
                self.assertEqual(len(gis['coordinates']),len(loaded['campus']['boundary_polygons']))
                self.assertEqual(len(gis['coordinates'][0]),len(loaded['campus']['boundary_polygons'][0]['holes'])+1)
                original=[scope['coordinates']] if scope['type']=='Polygon' else scope['coordinates']
                for expected,actual in zip(original,gis['coordinates']):
                    for expected_ring,actual_ring in zip(expected,actual):
                        self.assertEqual(len(expected_ring),len(actual_ring))
                        for p in actual_ring:
                            self.assertTrue(any(max(abs(p[i]-q[i]) for i in (0,1))<1e-7 for q in expected_ring))
                provenance = loaded['campus']['source']['physical_map']
                self.assertEqual(provenance['rules_version'],'auto-evidence.2')
                self.assertFalse(provenance['ai_used'])
                self.assertEqual(provenance['scope_geometry'],scope)
                self.assertNotIn(str(self.work), json.dumps(provenance))
                self.assertEqual(buildings['way/1']['services'],['dining'])  # POI kept without a model placeholder

    def test_identical_inputs_have_identical_bytes_including_manifest_and_recipe(self):
        a,b = self.work/'a',self.work/'b'
        self.prepare(out=a);self.prepare(out=b)
        self.assertEqual(tree_bytes(a),tree_bytes(b))

    def test_area_and_data_limits_precede_expensive_geometry(self):
        for limits, code in [({'max_area_km2':.001},'MAP_AREA_LIMIT'),
                             ({'max_fetch_area_km2':.001},'MAP_AREA_LIMIT'),
                             ({'max_nodes':1},'MAP_DATA_LIMIT'),({'max_ways':1},'MAP_DATA_LIMIT'),
                             ({'max_xml_bytes':10},'MAP_DATA_LIMIT'),({'max_buildings':1},'MAP_DATA_LIMIT'),
                             ({'max_road_segments':1},'MAP_DATA_LIMIT')]:
            with self.subTest(limits=limits), patch('adapter.scene_builder.physical_map.core.build_from_osm') as build:
                self.assertCode(code,lambda:self.prepare(limits=limits))
                build.assert_not_called()

    def test_invalid_polygons_rejected_without_output(self):
        bad = [polygon([[0,0],[100,100],[0,100],[100,0],[0,0]]),
               {'type':'Polygon','coordinates':[ring([[0,0],[100,0],[100,100],[0,100]])]},
               {'type':'Polygon','coordinates':[[[181,30],[182,30],[182,31],[181,30]]]}]
        for scope in bad:
            with self.subTest(scope=scope):
                self.assertCode('INVALID_SCOPE',lambda:self.prepare(scope))
                self.assertFalse((self.work/'map').exists())

    def test_nonempty_output_rejected_and_original_bytes_preserved(self):
        out = self.work/'map';out.mkdir();(out/'keep').write_bytes(b'original')
        self.assertCode('MAP_OUTPUT_NOT_EMPTY',lambda:self.prepare())
        self.assertEqual(tree_bytes(out),{'keep':b'original'})

    def test_cli_reports_chinese_code_and_has_no_output_on_invalid_scope(self):
        scope=self.work/'bad-scope.json'
        scope.write_text(json.dumps({'type':'Point','coordinates':[100,30]}),encoding='utf-8')
        command=[sys.executable,'-B','-m','adapter.scene_builder','physical-map','--osm',str(self.osm),
                 '--metadata',str(self.metadata),'--scope',str(scope),'--map-id','synthetic-cli',
                 '--title','Synthetic','--rules',str(RULES),'--out',str(self.work/'map')]
        result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
        self.assertNotEqual(result.returncode,0)
        failure=json.loads(result.stderr.splitlines()[-1])
        self.assertEqual(failure['error'],'INVALID_SCOPE')
        self.assertRegex(failure['message'],r'[\u4e00-\u9fff]')
        self.assertIn('Polygon',failure['message'])
        self.assertFalse((self.work/'map').exists())

    def test_overlapping_parts_and_invalid_holes_are_rejected(self):
        scope={'type':'MultiPolygon','coordinates':[SCOPES['crossing']['coordinates'],SCOPES['crossing']['coordinates']]}
        self.assertCode('INVALID_SCOPE',lambda:self.prepare(scope))
        scope=polygon(RECT,[[[400,400],[410,400],[410,410],[400,410],[400,400]]])
        self.assertCode('INVALID_SCOPE',lambda:self.prepare(scope))

    def test_wrong_rules_and_incomplete_archive_are_explicit_errors(self):
        with self.assertRaises(ValueError) as caught:
            self.prepare(rules_path=ROOT/'adapter/scene_service/evidence_rules.json')
        self.assertIn('auto-evidence.2',str(caught.exception))
        self.assertCode('MAP_SOURCE_INCOMPLETE',lambda:self.prepare(road_buffer_m=200))

    def test_nus_archive_end_to_end_uses_handwritten_scope_without_touching_library(self):
        scope = json.loads((ROOT/'adapter/physical_map_examples/nus-scope.geojson').read_bytes())
        result = prepare_physical_map(ROOT/'data/osm/nus.osm',ROOT/'data/osm/nus.metadata.json',scope,
            scope_source={'type':'manual','note':'离线 NUS 归档内手写轮廓，非测绘边界'},
            title='NUS 离线多边形测试',map_id='nus-physical-test',rules_path=RULES,out=self.work/'nus')
        loaded = enrich_map(load_map(self.work/'nus'))
        self.assertEqual({k:v for k,v in loaded['quality'].items() if k!='evidence_policy'},
                         {k:v for k,v in result['quality'].items() if k!='evidence_policy'})
        self.assertEqual(loaded['campus']['source']['sha256'],json.loads((ROOT/'data/osm/nus.metadata.json').read_bytes())['sha256'])
        self.assertGreater(result['summary']['buildings'],100)


class BufferGeometryCase(unittest.TestCase):
    def setUp(self):
        self.parts = [{'outer':[[0,0],[100,0],[100,100],[0,100],[0,0]],'holes':[]}]

    def test_rounded_corner_is_exact_not_bbox_or_octagon(self):
        self.assertEqual(clip_intervals([-45,-45],[-40,-40],self.parts,50),[])
        intervals=clip_intervals([-60,-30],[0,-30],self.parts,50)
        self.assertAlmostEqual(intervals[0][0],1/3,places=10)
        self.assertEqual(intervals[0][1],1)

    def test_hole_buffer_and_zero_buffer_do_not_join_disjoint_intervals(self):
        self.parts[0]['holes']=[[[40,40],[60,40],[60,60],[40,60],[40,40]]]
        self.assertEqual(clip_intervals([0,50],[100,50],self.parts,0),[(0,.4),(.6,1)])
        self.assertEqual(clip_intervals([0,50],[100,50],self.parts,5),[(0,.45),(.55,1)])

    def test_crossing_without_shared_osm_node_never_creates_walk_connection(self):
        roads=[{'osm_id':'a','points':[[-10,50],[110,50]],'node_ids':['a0','a1'],'walkable':True},
               {'osm_id':'b','points':[[50,-10],[50,110]],'node_ids':['b0','b1'],'walkable':True}]
        graph=_graph(clip_roads(roads,self.parts,0))
        self.assertEqual(len(graph['nodes']),4)
        self.assertEqual(len(graph['edges']),2)


if __name__ == '__main__':
    unittest.main()
