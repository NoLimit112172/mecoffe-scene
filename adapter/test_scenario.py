import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from adapter.scene_builder.scenario import ROOT, prepare_scenario, validate_manifest, validate_time
from adapter.scene_builder.io import MapInputError


class ScenarioTests(unittest.TestCase):
    def manifest(self):
        return json.loads((ROOT/'scenarios/nus-hourly.json').read_text(encoding='utf-8'))

    def test_missing_fields_and_bad_map_and_style(self):
        for key in ('id','title','map','simulation_time'):
            value=self.manifest();del value[key]
            with self.assertRaises(MapInputError):validate_manifest(value)
        for field,value in [('id','../escape'),('map',{'type':'imagery'}),('style',{'characters':'military'})]:
            m=self.manifest();m[field]=value
            with self.assertRaises(MapInputError):validate_manifest(m)

    def test_timezones_reverse_and_missing_time(self):
        base=self.manifest()['simulation_time']
        for changes in ({'timezone':'Mars/Olympus'},{'step_unit':'minute'},{'steps':0},{'start':'2026-99-03T06:00'},
                        {'end':'2026-11-01T06:00:00+08:00'}):
            with self.assertRaises(MapInputError):validate_time({**base,**changes})
        with self.assertRaises(MapInputError):validate_time({})
        with self.assertRaises(MapInputError):validate_time({**base,'steps':1,'intervals':[{'start':base['start'],'end':'2026-11-03T05:00:00+08:00'}]})

    def test_day_hour_and_explicit_intervals(self):
        hourly=validate_time(self.manifest()['simulation_time'])
        self.assertEqual(hourly['intervals'][1]['start'],'2026-11-03T07:00:00+08:00')
        daily=validate_time({**self.manifest()['simulation_time'],'step_unit':'day'})
        self.assertEqual(daily['intervals'][1]['start'],'2026-11-04T06:00:00+08:00')
        utc=validate_time({**self.manifest()['simulation_time'],'start':'2026-11-03T06:00:00Z'})
        self.assertEqual(utc['start'],'2026-11-03T14:00:00+08:00')
        explicit=validate_time({**hourly,'steps':1,'intervals':[{'start':hourly['start'],'end':'2026-11-03T09:00:00+08:00'}]})
        self.assertEqual(explicit['intervals'][0]['end'],'2026-11-03T09:00:00+08:00')
        with self.assertRaises(MapInputError):validate_time({**hourly,'steps':1,'intervals':hourly['intervals'][:2]})

    def test_examples_reproducible_and_history_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            for name in ('ustc-history','nus-hourly'):
                manifest,output=prepare_scenario(ROOT/f'scenarios/{name}.json',Path(temp)/'one')
                again,other=prepare_scenario(ROOT/f'scenarios/{name}.json',Path(temp)/'two')
                self.assertEqual(manifest,again)
                self.assertEqual(manifest['simulation_data'],name=='ustc-history')
                for filename,sha in manifest['files'].items():
                    self.assertEqual((output/filename).read_bytes(),(other/filename).read_bytes())
                    self.assertEqual(hashlib.sha256((output/filename).read_bytes()).hexdigest(),sha)
                if name=='ustc-history':
                    for filename,original in [('trajectory.json','scene.json'),('location_mapping.json','campus3d_mapping.json'),('campus3d.json','campus3d.json'),('landcover.json','campus3d_landcover.json')]:
                        self.assertEqual(json.loads((output/filename).read_text(encoding='utf-8')),json.loads((ROOT/'frontend/public/mecoffe'/original).read_text(encoding='utf-8')))

    def test_geojson_and_unknown_actor_fail_before_output(self):
        # Generic GeoJSON preparation uses the same adapter, not hardcoded USTC.
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp);m=self.manifest();m['map']={'type':'geojson','path':'map.json'}
            geo={'type':'FeatureCollection','metadata':{'source_url':'https://example.org/map','license':'CC0-1.0','attribution':'Fixture'},'features':[{'type':'Feature','id':'b1','properties':{'building':'university'},'geometry':{'type':'Polygon','coordinates':[[[103.77,1.29],[103.771,1.29],[103.771,1.291],[103.77,1.291],[103.77,1.29]]]}}]}
            # Existing GeoJSON contract requires its explicit source record.
            geo['source']=geo.pop('metadata')
            (base/'map.json').write_text(json.dumps(geo),encoding='utf-8')
            (base/'scenario.json').write_text(json.dumps(m),encoding='utf-8')
            result,out=prepare_scenario(base/'scenario.json',base/'output')
            self.assertFalse(result['simulation_data']);self.assertTrue((out/'campus3d.json').exists())

    def test_inconsistent_trajectory_does_not_overwrite_previous_scenario(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)
            manifest=json.loads((ROOT/'scenarios/ustc-history.json').read_text(encoding='utf-8'))
            # Move the manifest without changing the original map/rule inputs.
            for field in ('location_rules','trajectory'):
                manifest[field]=str((ROOT/'scenarios'/manifest[field]).resolve())
            for field in ('landcover','surroundings'):
                manifest['map'][field]=str((ROOT/'scenarios'/manifest['map'][field]).resolve())
            trajectory=json.loads(Path(manifest['trajectory']).read_text(encoding='utf-8'))
            trajectory['events'][0]['actor']='missing-agent'
            (base/'trajectory.json').write_text(json.dumps(trajectory),encoding='utf-8')
            manifest['trajectory']='trajectory.json'
            (base/'scenario.json').write_text(json.dumps(manifest),encoding='utf-8')
            output=base/'output'/'ustc-history';output.mkdir(parents=True)
            sentinel=output/'scenario.json';sentinel.write_text('previous good result',encoding='utf-8')
            with self.assertRaisesRegex(MapInputError,'invalid_actor'):
                prepare_scenario(base/'scenario.json',base/'output')
            self.assertEqual(sentinel.read_text(encoding='utf-8'),'previous good result')


if __name__=='__main__':unittest.main()
