import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import osm_surroundings as surrounding
from osm_to_campus3d import project, tags_of

ROOT = Path(__file__).resolve().parent.parent


class SurroundingsCase(unittest.TestCase):
    def test_bbox_expands_by_three_hundred_metres_on_each_side(self):
        bbox = [117.1194, 31.8180, 117.1283, 31.8270]
        original = bbox[:]
        west, south, east, north = surrounding.expanded_bbox(bbox)
        lon, lat = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        self.assertAlmostEqual(project(west, lat, bbox[0], lat)[0], -300)
        self.assertAlmostEqual(project(east, lat, bbox[2], lat)[0], 300)
        self.assertAlmostEqual(project(lon, south, lon, bbox[1])[1], -300)
        self.assertAlmostEqual(project(lon, north, lon, bbox[3])[1], 300)
        self.assertEqual(bbox, original)

    def test_real_roads_keep_exact_osm_names_tags_projection_and_input_files(self):
        protected = [ROOT / 'scene/campus3d.json', ROOT / 'data/osm/ustc_gaoxin.osm']
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in protected}
        data = surrounding.extract()
        metadata = json.loads(surrounding.METADATA_PATH.read_text(encoding='utf-8'))
        raw = surrounding.OSM_PATH.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), metadata['sha256'])
        self.assertTrue(metadata['source_url'].startswith('https://api.openstreetmap.org/api/0.6/map?bbox='))
        self.assertEqual(metadata['margin_m'], 300)
        self.assertTrue(metadata['downloaded_at_utc'])
        source = {f"way/{way.get('id')}": tags_of(way) for way in ET.fromstring(raw).findall('way')}
        campus = json.loads(protected[0].read_text(encoding='utf-8'))
        self.assertEqual(data['projection'], campus['projection'])
        self.assertNotIn('walk_graph', data)
        names = {road['name'] for road in data['roads'] if road['name']}
        self.assertIn('习友路', names)
        self.assertIn('石莲南路', names)
        for road in data['roads']:
            self.assertGreaterEqual(len(road['points']), 2)
            tags = source[road['osm_id']]
            for key in ['name', 'highway', 'lanes', 'oneway', 'tunnel', 'layer', 'bridge']:
                self.assertEqual(road[key], tags.get(key, ''))
            self.assertTrue(tags['highway'])
        self.assertEqual(before, {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in protected})

    def test_clipping_keeps_disjoint_spans_and_never_modifies_source(self):
        points = [[-2, 1], [1, 1], [4, 1], [4, 4], [1, 1]]
        before = copy.deepcopy(points)
        parts = surrounding.clip_polyline(points, [0, 0, 2, 2])
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0], [[0., 1.], [1., 1.], [2., 1.]])
        self.assertTrue(all(0 <= x <= 2 and 0 <= y <= 2 for part in parts for x, y in part))
        self.assertEqual(points, before)

    def test_unmatched_download_is_rejected_without_overwriting_existing_output(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.osm'
            path.write_bytes(b'<osm/>')
            with self.assertRaises(ValueError):
                surrounding.extract(osm_path=path)
