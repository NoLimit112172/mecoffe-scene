import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from adapter.scene_builder.gis import LAYERS, to_local, to_wgs84
from adapter.scene_builder.scenario import ROOT, prepare_scenario
from adapter.scene_builder.io import MapInputError
from adapter.scene_builder.io import write_json


class GisTests(unittest.TestCase):
    def test_idempotent_generation_preserves_archived_bytes_and_windows_reader_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'data.json'
            value={'x': 1}
            target.write_bytes((json.dumps(value, indent=2)+'\n').replace('\n','\r\n').encode())
            before=target.read_bytes();modified=target.stat().st_mtime_ns
            write_json(target,value)
            self.assertEqual(target.read_bytes(),before)
            self.assertEqual(target.stat().st_mtime_ns,modified)
            with patch.object(Path,'replace',side_effect=PermissionError()),patch('adapter.scene_builder.io.time.sleep'):
                write_json(target,{'x': 2})
            self.assertEqual(json.loads(target.read_bytes()),{'x': 2})
            self.assertFalse(target.with_suffix('.json.tmp').exists())

    def test_projection_round_trip_both_campuses_under_half_metre(self):
        for campus in ('ustc-history', 'nus-hourly'):
            data = json.loads((ROOT/f'frontend/public/mecoffe/scenarios/{campus}/campus3d.json').read_text())
            for b in data['buildings']:
                for p in b['polygon']:
                    restored = to_local(to_wgs84(p, data['projection']), data['projection'])
                    self.assertLess(sum((a-b)**2 for a, b in zip(p, restored))**.5, .5)
            with self.assertRaises(MapInputError):
                to_wgs84([0, 0], {'method': 'unknown'})

    def test_layers_reproducible_hashed_and_keep_source_truth(self):
        with tempfile.TemporaryDirectory() as temporary:
            for campus in ('ustc-history', 'nus-hourly'):
                manifest, one = prepare_scenario(ROOT/f'scenarios/{campus}.json', Path(temporary)/'one')
                again, two = prepare_scenario(ROOT/f'scenarios/{campus}.json', Path(temporary)/'two')
                self.assertEqual(manifest, again)
                for layer in LAYERS:
                    name = f'gis/{layer}.geojson'
                    raw = (one/name).read_bytes()
                    self.assertEqual(raw, (two/name).read_bytes())
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), manifest['files'][name])
                    geo = json.loads(raw)
                    self.assertEqual(geo['type'], 'FeatureCollection')
                    self.assertTrue(geo['source'].get('attribution'))
                    self.assertEqual(len(geo['features']), len({f['id'] for f in geo['features']}))
                buildings = json.loads((one/'gis/buildings.geojson').read_bytes())['features']
                source = json.loads((one/'campus3d.json').read_bytes())['buildings']
                self.assertEqual(len(buildings), len(source))
                by_id = {b['osm_id']: b for b in source}
                for b in buildings:
                    self.assertEqual(b['properties']['height_source'], by_id[b['id']]['height_source'])
                    self.assertEqual(b['properties']['height_m'], by_id[b['id']]['height_m'])
                if campus == 'nus-hourly':
                    self.assertNotIn('trajectory.json', manifest['files'])


if __name__ == '__main__':
    unittest.main()
