"""Generic map-input, deterministic asset assignment and archived-source regression."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import scene_builder as builder
from scene_builder.core import load_catalog, match_score
from scene_builder.__main__ import main
import osm_to_campus3d as legacy


ROOT=Path(__file__).resolve().parent.parent


def sample_map():
    return {'type':'FeatureCollection','source':{'license':'LicenseRef-Caller-Test','attribution':'Synthetic test geometry'},'features':[
        {'type':'Feature','id':'dorm','properties':{'building':'dormitory','name':'A dorm','location_id':'dorm_a','levels':4},
         'geometry':{'type':'Polygon','coordinates':[[[103.773,1.294],[103.7732,1.294],[103.7732,1.2942],[103.773,1.2942],[103.773,1.294]]]}},
        {'type':'Feature','id':'walk','properties':{'highway':'footway'},'geometry':{'type':'LineString','coordinates':[[103.773,1.2939],[103.7732,1.2939],[103.7734,1.2939]]}},
        {'type':'Feature','id':'cafe-point','properties':{'amenity':'cafe','name':'Coffee','location_id':'cafe_a'},'geometry':{'type':'Point','coordinates':[103.7734,1.2941]}},
    ]}


class SceneBuilderCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.catalog=load_catalog()

    def test_geojson_projects_wgs84_to_metres_keeps_input_and_explicit_locations(self):
        raw=sample_map();before=copy.deepcopy(raw)
        result=builder.build_from_geojson(raw,seed=13)
        campus=result['campus'];building=campus['buildings'][0]
        self.assertEqual(raw,before)
        self.assertAlmostEqual(building['polygon'][1][0]-building['polygon'][0][0],22.233,delta=.02)
        self.assertAlmostEqual(building['polygon'][2][1]-building['polygon'][1][1],22.239,delta=.02)
        self.assertEqual(building['levels'],4)
        self.assertEqual(building['height_m'],12.8)
        self.assertEqual(result['locations']['mappings']['dorm_a']['feature_ids'],['geojson/dorm'])
        self.assertFalse(result['locations']['mappings']['dorm_a']['illustrative'])
        self.assertEqual(result['assignments']['assignments'][0]['prototype_id'],None) # POI, not a fabricated cafe building
        self.assertEqual(campus['source']['license'],'LicenseRef-Caller-Test')
        self.assertFalse(result['assignments']['simulation_data'])

    def test_geojson_validation_rejects_bad_crs_geometry_rings_coordinates_dimensions_and_ids(self):
        mutations={
            'crs':lambda value:value.update(crs={'type':'name','properties':{'name':'EPSG:3857'}}),
            'geometry':lambda value:value['features'][0]['geometry'].update(type='GeometryCollection'),
            'unclosed':lambda value:value['features'][0]['geometry']['coordinates'][0].pop(),
            'coordinate':lambda value:value['features'][0]['geometry']['coordinates'][0][0].__setitem__(0,190),
            'nan':lambda value:value['features'][0]['geometry']['coordinates'][0][0].__setitem__(0,float('nan')),
            'height':lambda value:value['features'][0]['properties'].update(height=-4),
            'duplicate_id':lambda value:value['features'][1].update(id='dorm'),
            'duplicate_location':lambda value:value['features'][2]['properties'].update(location_id='dorm_a'),
            'bad_tags':lambda value:value['features'][0]['properties'].update(tags=[]),
            'bad_bbox':lambda value:value.update(bbox=[10,10,11,11]),
        }
        for name,change in mutations.items():
            value=sample_map();change(value)
            with self.subTest(name=name),self.assertRaises(builder.MapInputError): builder.build_from_geojson(value)
        for bbox in (None,[],[0,1,0,2],[0,91,1,92],[True,0,1,1]):
            with self.subTest(bbox=bbox),self.assertRaises(builder.MapInputError): builder.validate_bbox(bbox)

    def test_exact_catalog_matching_excludes_components_and_is_cross_language_reproducible(self):
        chosen=builder.select_prototype({'building':'dormitory'},'building',self.catalog,2026,'咖啡楼')
        self.assertEqual(chosen['prototype_id'],'building.procedural.dormitory')
        self.assertEqual(builder.fnv1a('2026|咖啡楼|building.procedural.other'),2519611985)
        self.assertIsNone(match_score({'building':'dormitory'},{}))
        self.assertEqual(match_score({'building':'dormitory'},{'building':'*'}),1)
        self.assertEqual(match_score({'building':'dormitory'},{'building':['dormitory','apartments']}),4)
        self.assertEqual(builder.select_prototype({'building':'yes','amenity':'cafe'},'building',self.catalog)['prototype_id'],'building.procedural.dining')
        self.assertEqual(builder.select_prototype({'highway':'corridor'},'road',self.catalog)['prototype_id'],'road.other')

    def test_fixed_seed_repeats_assets_and_catalog_defaults_are_overridden_only_by_input_dimensions(self):
        raw=sample_map()
        self.assertEqual(builder.build_from_geojson(raw,seed='fixed'),builder.build_from_geojson(raw,seed='fixed'))
        modified=copy.deepcopy(self.catalog)
        dorm=next(item for item in modified['prototypes'] if item['id']=='building.procedural.dormitory')
        dorm['params']['levels']=9;dorm['params']['storey_height_m']=4
        with_explicit=builder.build_from_geojson(raw,catalog=modified)['campus']['buildings'][0]
        self.assertEqual(with_explicit['levels'],4)
        self.assertEqual(with_explicit['height_m'],16)
        raw['features'][0]['properties'].pop('levels')
        defaulted=builder.build_from_geojson(raw,catalog=modified)['campus']['buildings'][0]
        self.assertEqual(defaulted['levels'],9)
        self.assertEqual(defaulted['height_m'],36)
        raw['features'][0]['properties']['height']=25
        self.assertEqual(builder.build_from_geojson(raw,catalog=modified)['campus']['buildings'][0]['height_m'],25)

    def test_location_rules_are_exact_and_ambiguities_are_errors(self):
        raw=sample_map();raw['features'][0]['properties'].pop('location_id')
        result=builder.build_from_geojson(raw,location_rules=[{'location_id':'dorm_slot','name':'A dorm'}])
        self.assertEqual(result['locations']['mappings']['dorm_slot']['method'],'explicit_exact_rule')
        duplicate=copy.deepcopy(raw['features'][0]);duplicate['id']='another';raw['features'].append(duplicate)
        with self.assertRaisesRegex(builder.MapInputError,'ambiguous_location_rule'):
            builder.build_from_geojson(raw,location_rules=[{'location_id':'dorm_slot','name':'A dorm'}])
        with self.assertRaisesRegex(builder.MapInputError,'unresolved_location_rule'):
            builder.build_from_geojson(raw,location_rules=[{'location_id':'dorm_slot','name':'Not present'}])

    def test_building_style_does_not_require_yulan_versions_of_roads_or_landcover(self):
        catalog=copy.deepcopy(self.catalog)
        # Isolate the synthetic style fixture from real YuLan suites added in
        # milestone 3; this test is about category fallback, not tie-breaking.
        catalog['prototypes']=[item for item in catalog['prototypes'] if item.get('style')!='yulan']
        alternate=copy.deepcopy(next(item for item in catalog['prototypes'] if item['id']=='building.procedural.dormitory'))
        alternate.update(id='building.yulan.test-dorm',style='yulan')
        catalog['prototypes'].append(alternate)
        result=builder.build_from_geojson(sample_map(),catalog=catalog,style='yulan')
        assignments={item['feature_id']:item for item in result['assignments']['assignments']}
        self.assertEqual(assignments['geojson/dorm']['prototype_id'],'building.yulan.test-dorm')
        self.assertEqual(assignments['geojson/walk']['prototype_id'],'road.footway')

    def test_road_crossings_without_shared_vertices_never_become_shortcuts(self):
        def roads(points_a,points_b,layer_b=0):
            return {'type':'FeatureCollection','features':[
                {'type':'Feature','id':'a','properties':{'highway':'footway'},'geometry':{'type':'LineString','coordinates':points_a}},
                {'type':'Feature','id':'b','properties':{'highway':'footway','layer':layer_b},'geometry':{'type':'LineString','coordinates':points_b}},
            ]}
        a=[[103.773,1.294],[103.774,1.294]];b=[[103.7735,1.2935],[103.7735,1.2945]]
        disconnected=builder.build_from_geojson(roads(a,b))['campus']
        self.assertEqual(disconnected['stats']['graph_components'],2)
        a.insert(1,[103.7735,1.294]);b.insert(1,[103.7735,1.294])
        self.assertEqual(builder.build_from_geojson(roads(a,b))['campus']['stats']['graph_components'],1)
        self.assertEqual(builder.build_from_geojson(roads(a,b,1))['campus']['stats']['graph_components'],2)

    def test_bundle_writes_manifest_hashes_and_cli_errors_do_not_replace_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);bundle=builder.build_from_geojson(sample_map())
            manifest=builder.write_bundle(bundle,directory/'out')
            for name,digest in manifest['files'].items():
                self.assertEqual(hashlib.sha256((directory/'out'/name).read_bytes()).hexdigest(),digest)
            invalid=directory/'bad.json';invalid.write_text('{"type":"not GeoJSON"}',encoding='utf8')
            before=(directory/'out/campus3d.json').read_bytes()
            self.assertEqual(main(['geojson','--input',str(invalid),'--campus-id','test','--output-dir',str(directory/'out')]),1)
            self.assertEqual((directory/'out/campus3d.json').read_bytes(),before)

    def test_multipolygon_parts_share_the_callers_location_and_preserve_valid_holes(self):
        raw=sample_map();feature=raw['features'][0];outer=feature['geometry']['coordinates'][0]
        hole=[[103.77305,1.29405],[103.7731,1.29405],[103.7731,1.2941],[103.77305,1.2941],[103.77305,1.29405]]
        second=[[point[0]+.0005,point[1]] for point in outer]
        feature['geometry']={'type':'MultiPolygon','coordinates':[[outer,hole],[second]]}
        result=builder.build_from_geojson(raw)
        self.assertEqual(len(result['campus']['buildings']),2)
        self.assertEqual(len(result['campus']['buildings'][0]['holes']),1)
        self.assertEqual(result['locations']['mappings']['dorm_a']['feature_ids'],['geojson/dorm/part/0','geojson/dorm/part/1'])
        self.assertEqual(outer[0],outer[-1])

    def test_osm_clips_crossing_roads_to_extent_without_joining_geometric_crossings(self):
        xml=b'''<osm version="0.6"><node id="1" lon="-0.001" lat="0.0005"/><node id="2" lon="0.002" lat="0.0005"/>
        <node id="3" lon="0.0005" lat="-0.001"/><node id="4" lon="0.0005" lat="0.002"/>
        <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way>
        <way id="11"><nd ref="3"/><nd ref="4"/><tag k="highway" v="footway"/></way></osm>'''
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);osm=directory/'map.osm';metadata=directory/'map.metadata.json'
            osm.write_bytes(xml);metadata.write_text(json.dumps({'bbox':[0,0,.001,.001],'sha256':hashlib.sha256(xml).hexdigest()}),encoding='utf8')
            campus=builder.build_from_osm(osm,metadata)['campus']
            self.assertEqual(campus['stats']['graph_components'],2)
            self.assertEqual(campus['stats']['graph_nodes'],4)
            self.assertTrue(all(node['id'].startswith('clip/') for node in campus['walk_graph']['nodes']))
            self.assertTrue(all(-55.6<=node['x']<=55.6 and -55.6<=node['y']<=55.6 for node in campus['walk_graph']['nodes']))

    def test_ustc_legacy_profile_rebuilds_original_raw_data_exactly_without_reading_accepted_scene(self):
        before=legacy.OUTPUT_PATH.read_bytes()
        result=builder.build_from_osm(legacy.OSM_PATH,legacy.METADATA_PATH,profile='ustc_legacy')
        self.assertEqual(result['campus'],json.loads(before))
        self.assertEqual(legacy.OUTPUT_PATH.read_bytes(),before)
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder);raw=ET.parse(legacy.OSM_PATH)
            building=next(way for way in raw.getroot().findall('way') if legacy.tags_of(way).get('building'))
            ET.SubElement(building,'tag',{'k':'height','v':'77'})
            osm=directory/'changed.osm';raw.write(osm,encoding='utf-8',xml_declaration=True)
            meta=json.loads(legacy.METADATA_PATH.read_text(encoding='utf8'));meta['sha256']=hashlib.sha256(osm.read_bytes()).hexdigest()
            metadata=directory/'meta.json';metadata.write_text(json.dumps(meta),encoding='utf8')
            rebuilt=builder.build_from_osm(osm,metadata,profile='ustc_legacy')['campus']
            feature=next(item for item in rebuilt['buildings'] if item['osm_id']==f'way/{building.get("id")}')
            self.assertEqual(feature['height_m'],77)

    def test_osm_hash_mismatch_fails_and_nus_is_a_real_generic_non_simulation_scene(self):
        with tempfile.TemporaryDirectory() as folder:
            metadata=Path(folder)/'bad.metadata.json'
            metadata.write_text(json.dumps({'bbox':[0,0,1,1],'sha256':'bad'}),encoding='utf8')
            with self.assertRaisesRegex(builder.MapInputError,'source_hash_mismatch'):
                builder.build_from_osm(legacy.OSM_PATH,metadata)
        nus=builder.build_from_osm(ROOT/'data/osm/nus.osm',ROOT/'data/osm/nus.metadata.json',campus_id='nus',seed='2026')
        self.assertEqual(nus['campus']['stats']['buildings'],226)
        self.assertGreater(nus['campus']['stats']['road_segments'],500)
        self.assertEqual(nus['campus']['source']['license'],'ODbL-1.0')
        self.assertNotIn('people',nus['campus'])
        self.assertFalse(nus['assignments']['simulation_data'])
        self.assertEqual(nus['locations']['mappings'],{})


if __name__=='__main__': unittest.main()
