"""检验新版输入使用真实关系，同时不借用旧运行的行为结果。"""
import copy
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import snapshot_to_scene as adapter

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / 'data/source/population_snapshot.latest.json'
CAMPUS = ROOT / 'scene/campus.json'


class SnapshotCase(unittest.TestCase):
    def setUp(self):
        self.snapshot = json.loads(SNAPSHOT.read_text(encoding='utf-8'))

    def test_real_snapshot_has_exact_network_and_no_historical_actions(self):
        scene = adapter.convert(SNAPSHOT, CAMPUS)
        self.assertEqual(scene['meta']['snapshot_revision'], 3)
        self.assertEqual(scene['meta']['sources']['snapshot_sha256'], adapter.sha256_of(SNAPSHOT))
        self.assertEqual(scene['meta']['status'], 'not_run')
        self.assertIsNone(scene['meta']['run_id'])
        self.assertEqual(scene['relationships'], self.snapshot['edges'])
        self.assertEqual(len(scene['people']), 100)
        self.assertEqual(scene['events'], [])
        self.assertEqual(scene['posts'], {})
        self.assertEqual(scene['summary']['orders'], 0)
        self.assertEqual(scene['summary']['revenue_fen'], 0)
        self.assertEqual(scene['meta']['completed_steps'], 0)
        self.assertEqual(len(scene['days']), 1)
        self.assertEqual(len(scene['brands']), 2)
        consumer_ids = {n['entity_id'] for n in self.snapshot['nodes'] if n['role'] != 'merchant'}
        peer_edges = [e for e in scene['relationships'] if e['target'] in consumer_ids]
        merchant_edges = [e for e in scene['relationships'] if e['target'] not in consumer_ids]
        self.assertEqual(len(peer_edges), 490)
        self.assertEqual(set(Counter(e['source'] for e in peer_edges).values()), {5})
        self.assertEqual(set(Counter(e['source'] for e in peer_edges)), consumer_ids)
        self.assertEqual(Counter(e['target'] for e in merchant_edges), {'merchant_001': 20, 'merchant_002': 20})

    def test_invalid_networks_are_rejected(self):
        mutations = {
            'duplicate node': lambda s: s['nodes'].append(copy.deepcopy(s['nodes'][0])),
            'unknown target': lambda s: s['edges'][0].update(target='missing'),
            'self relation': lambda s: s['edges'][0].update(target=s['edges'][0]['source']),
            'duplicate relation': lambda s: s['edges'].append(copy.deepcopy(s['edges'][0])),
            'invalid revision': lambda s: s.update(snapshot_revision=0),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                snapshot = copy.deepcopy(self.snapshot)
                mutate(snapshot)
                with self.assertRaises(adapter.SceneError):
                    adapter.validate_snapshot(snapshot)

    def test_failed_cli_keeps_previous_output(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            invalid = directory / 'invalid.json'
            output = directory / 'scene.json'
            invalid.write_text(json.dumps({'snapshot_id': 'broken'}), encoding='utf-8')
            output.write_text('existing output', encoding='utf-8')
            self.assertEqual(adapter.main(['--snapshot', str(invalid), '--output', str(output)]), 1)
            self.assertEqual(output.read_text(encoding='utf-8'), 'existing output')

    def test_atomic_writer_replaces_complete_json(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'new/scene.json'
            scene = adapter.convert(SNAPSHOT, CAMPUS)
            adapter.write_atomic(output, scene)
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), scene)
            self.assertEqual(list(output.parent.glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
