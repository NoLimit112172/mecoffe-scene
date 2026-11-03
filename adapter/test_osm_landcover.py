import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import osm_landcover as overlay

ROOT = Path(__file__).resolve().parent.parent


class LandcoverCase(unittest.TestCase):
    def test_real_surfaces_are_closed_and_keep_the_existing_snapshot(self):
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'data/osm/ustc_gaoxin.osm', ROOT / 'scene/campus3d.json']}
        data = overlay.extract()
        self.assertTrue(any(item['name'] == '永怀湖' and item['kind'] == 'water' for item in data['features']))
        self.assertTrue(any(item['sport'] == 'soccer' for item in data['features']))
        for item in data['features']:
            self.assertEqual(item['polygon'][0], item['polygon'][-1])
            self.assertGreaterEqual(len(set(map(tuple, item['polygon']))), 3)
            self.assertEqual(item['source'], 'osm')
        self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in before})

    def test_clipping_preserves_closure_without_mutating_input(self):
        ring = [[-2, -2], [3, -2], [3, 3], [-2, 3], [-2, -2]]
        original = copy.deepcopy(ring)
        clipped = overlay.clip_ring(ring, [0, 0, 2, 2])
        self.assertEqual(clipped[0], clipped[-1])
        self.assertTrue(all(0 <= x <= 2 and 0 <= y <= 2 for x, y in clipped))
        self.assertEqual(ring, original)
        self.assertEqual(overlay.clip_ring(ring, [10, 10, 12, 12]), [])

    def test_overlay_rejects_unmatched_osm_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'bad.osm'
            target.write_bytes(b'<osm/>')
            with self.assertRaises(ValueError):
                overlay.extract(target)
