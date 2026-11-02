"""核对演示脚本的网络传播、预算和可复现性；不请求模型。"""
import copy
import hashlib
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import build_demo
import snapshot_to_scene


class DemoCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = build_demo.build()

    def test_real_v3_is_used_and_no_history_is_borrowed(self):
        scene = self.scene
        snapshot = json.loads(snapshot_to_scene.DEFAULT_SNAPSHOT.read_text(encoding='utf-8'))
        self.assertEqual(scene['meta']['snapshot_revision'], 3)
        self.assertEqual(scene['relationships'], snapshot['edges'])
        self.assertEqual(len(scene['people']), 100)
        self.assertEqual(len(scene['relationships']), 530)
        self.assertIsNone(scene['meta']['run_id'])
        self.assertEqual(scene['meta']['mode'], 'network_demo')
        self.assertEqual([day['step'] for day in scene['days']], list(range(1, 31)))
        self.assertTrue(all(event['illustrative'] and event['origin'] == 'scripted_demo'
                            for event in scene['events']))
        self.assertFalse(any(event['type'] == 'interview' for event in scene['events']))
        self.assertTrue(any(event['type'] == 'purchase' and event['step'] == 1
                            for event in scene['events']))
        first_day = [event for event in scene['events'] if event['step'] == 1]
        first_purchase = next(i for i, event in enumerate(first_day) if event['type'] == 'purchase')
        self.assertLessEqual(first_purchase / len(first_day), 0.4)

    def test_transmission_precedes_purchases_and_follows_actual_edges(self):
        scene = self.scene
        edges = {(edge['source'], edge['target']) for edge in scene['relationships']
                 if edge['relation'] == 'follow'}
        known = {person['id']: set() for person in scene['people'] if person['role'] != 'merchant'}
        posts = {}
        for event in scene['events']:
            if event['type'] == 'ad':
                for target in event['targeted']:
                    self.assertIn((target, event['actor']), edges)
                posts[event['post_id']] = (event['actor'], event['brand_id'])
            elif event['type'] == 'exposure':
                self.assertIn((event['actor'], event['target']), edges)
                for brand in event['brand_ids']:
                    known[event['actor']].add(brand)
            elif event['type'] == 'purchase':
                self.assertIn(event['brand_id'], known[event['actor']])
            elif event['type'] == 'post':
                posts[event['post_id']] = (event['actor'], event['brand_id'])
            elif event['type'] == 'comment':
                self.assertIn((event['actor'], event['target']), edges)
                self.assertIn(event['post_id'], posts)
                self.assertEqual(posts[event['post_id']], (event['target'], event['brand_id']))
                known[event['actor']].add(event['brand_id'])

    def test_orders_and_revenue_reconcile_without_exceeding_budget(self):
        scene = self.scene
        prices = scene['meta']['demo_config']['prices_fen']
        spent, daily, order_ids = Counter(), Counter(), set()
        total = 0
        purchases = [event for event in scene['events'] if event['type'] == 'purchase']
        for event in purchases:
            self.assertNotIn(event['order_id'], order_ids)
            order_ids.add(event['order_id'])
            self.assertEqual(event['amount_fen'], prices[event['brand_id']] * event['quantity'])
            spent[event['actor']] += event['amount_fen']
            daily[event['step']] += 1
            total += event['amount_fen']
        self.assertEqual(total, scene['summary']['revenue_fen'])
        self.assertEqual(len(order_ids), scene['summary']['orders'])
        self.assertTrue(all(count <= 8 for count in daily.values()))
        for person, budget in scene['meta']['demo_budget_fen'].items():
            self.assertLessEqual(spent[person], budget)
            self.assertEqual(budget - spent[person], scene['meta']['demo_remaining_budget_fen'][person])

    def test_same_seed_is_reproducible_and_does_not_change_source(self):
        path = snapshot_to_scene.DEFAULT_SNAPSHOT
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(self.scene, build_demo.build())
        self.assertEqual(before, hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(before, self.scene['meta']['sources']['snapshot_sha256'])

    def test_removing_an_actual_ad_follow_changes_the_script(self):
        baseline = self.scene
        exposure = next(event for event in baseline['events'] if event['type'] == 'exposure')
        removed = (exposure['actor'], exposure['target'])
        snapshot = json.loads(snapshot_to_scene.DEFAULT_SNAPSHOT.read_text(encoding='utf-8'))
        snapshot['edges'] = [edge for edge in snapshot['edges']
                             if (edge['source'], edge['target']) != removed]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf-8')
            altered = build_demo.build(snapshot_path=path)
        self.assertNotEqual(baseline['events'], altered['events'])
        self.assertFalse(any(event['type'] == 'exposure' and (event['actor'], event['target']) == removed
                             for event in altered['events']))

    def test_demo_configuration_must_be_explicit(self):
        config = copy.deepcopy(self.scene['meta']['demo_config'])
        config['illustrative'] = False
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps(config), encoding='utf-8')
            with self.assertRaises(build_demo.SceneError):
                build_demo.build(config_path=path)


if __name__ == '__main__':
    unittest.main()
