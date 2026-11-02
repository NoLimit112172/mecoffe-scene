"""适配器测试：用小样例检查各条规则，再用团队真实数据核对总量。

运行：python -X utf8 -m unittest discover -s adapter -v
"""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import oasis_to_scene as adapter

ROOT = Path(__file__).resolve().parent.parent
CAMPUS = ROOT / "scene" / "campus.json"
REAL_TRAJECTORY = ROOT / "data" / "source" / "trajectory.json"
REAL_SNAPSHOT = ROOT / "data" / "source" / "population_snapshot.json"


def actor(entity_id, role):
    return {"entity_id": entity_id, "role": role, "agent_id": 0, "user_id": 0}


def base_inputs():
    snapshot = {
        "snapshot_id": "snap", "snapshot_revision": 1,
        "nodes": [
            {"entity_id": "merchant_001", "role": "merchant", "description": "商家 A", "dynamic_attributes": {}},
            {"entity_id": "merchant_002", "role": "merchant", "description": "商家 B", "dynamic_attributes": {}},
            {"entity_id": "undergraduate_consumer_001", "role": "undergraduate_consumer", "name": "甲",
             "static_attributes": {"gender": "female", "age": 20},
             "dynamic_attributes": {"coffee_budget_30d_cny": 60}},
        ],
    }
    trajectory = {
        "kind": "oasis.interaction_trajectory", "run_id": "run_x", "status": "completed", "partial": False,
        "metadata": {"snapshot_id": "snap", "snapshot_revision": 1, "completed_steps": 2, "total_steps": 2},
        "agents": [{"entity_id": n["entity_id"]} for n in snapshot["nodes"]],
        "initial_relationships": [],
        "objects": {
            "posts": [{"post_id": 1, "author_entity_id": "merchant_001", "content": "广告"}],
            "ads": [{"post_id": 1, "brand_id": "merchant_001", "target_entity_ids": ["undergraduate_consumer_001"]}],
            "orders": [{"order_id": "o1"}],
            "products": [
                {"name": "A 咖啡", "brand_id": "merchant_001"},
                {"name": "B 咖啡", "brand_id": "merchant_002"},
            ],
        },
        "actions": [
            {"id": "a1", "step": 1, "audit_line": 10, "origin": "scripted", "phase": "before_actions",
             "actor": actor("merchant_001", "merchant"), "action": "publish_ad", "outcome": "executed",
             "args": {"content": "广告"}, "result": {"post_id": 1, "cost_fen": 100}, "targets": []},
            {"id": "a2", "step": 1, "audit_line": 12, "origin": "autonomous", "stage": "consumer_purchase",
             "actor": actor("undergraduate_consumer_001", "undergraduate_consumer"), "action": "purchase_product",
             "outcome": "executed", "args": {}, "result": {"order_id": "o1", "amount_fen": 990, "quantity": 1},
             "targets": [{"type": "product", "brand_id": "merchant_001", "owner_entity_id": "merchant_001"}]},
            {"id": "a3", "step": 2, "audit_line": 20, "origin": "autonomous", "stage": "consumer_purchase",
             "actor": actor("undergraduate_consumer_001", "undergraduate_consumer"), "action": "do_nothing",
             "outcome": "noop", "args": {}, "result": {}, "targets": []},
        ],
        "observations": [
            {"step": 1, "audit_line": 11, "actor": actor("undergraduate_consumer_001", "undergraduate_consumer"),
             "returned_post_ids": [1], "sponsored_post_ids": [1]},
            {"step": 2, "audit_line": 19, "actor": actor("undergraduate_consumer_001", "undergraduate_consumer"),
             "returned_post_ids": [], "sponsored_post_ids": []},
        ],
    }
    return trajectory, snapshot


class ConvertCase(unittest.TestCase):
    def convert(self, trajectory, snapshot):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            (folder / "t.json").write_text(json.dumps(trajectory, ensure_ascii=False), encoding="utf-8")
            (folder / "s.json").write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
            return adapter.convert(folder / "t.json", folder / "s.json", CAMPUS)

    def test_basic_conversion_keeps_order_and_people(self):
        scene = self.convert(*base_inputs())
        types = [e["type"] for e in scene["events"]]
        # 按 step、审计行号排序：广告(10) -> 曝光(11) -> 购买(12)
        self.assertEqual(types, ["ad", "exposure", "purchase"])
        self.assertEqual(scene["summary"]["revenue_fen"], 990)
        self.assertEqual(scene["summary"]["noop"], 1)
        self.assertEqual([p["home_location_id"] for p in scene["people"]],
                         ["shop_merchant_001", "shop_merchant_002", "undergraduate_dormitory"])

    def test_noop_only_day_still_on_timeline(self):
        scene = self.convert(*base_inputs())
        self.assertEqual([d["step"] for d in scene["days"]], [0, 1, 2])
        self.assertEqual(scene["days"][2]["noop"], 1)

    def test_exposure_only_from_returned_feed_not_targeting(self):
        trajectory, snapshot = base_inputs()
        trajectory["observations"][0]["sponsored_post_ids"] = []
        scene = self.convert(trajectory, snapshot)
        self.assertNotIn("exposure", [e["type"] for e in scene["events"]])
        ad = next(e for e in scene["events"] if e["type"] == "ad")
        self.assertEqual(ad["targeted"], ["undergraduate_consumer_001"])

    def test_duplicate_order_counted_once(self):
        trajectory, snapshot = base_inputs()
        duplicate = copy.deepcopy(trajectory["actions"][1])
        duplicate["id"], duplicate["audit_line"] = "a2b", 13
        trajectory["actions"].append(duplicate)
        scene = self.convert(trajectory, snapshot)
        self.assertEqual(scene["summary"]["orders"], 1)

    def test_order_table_mismatch_is_rejected(self):
        trajectory, snapshot = base_inputs()
        trajectory["objects"]["orders"].append({"order_id": "ghost"})
        with self.assertRaises(adapter.SceneError):
            self.convert(trajectory, snapshot)

    def test_unknown_person_is_rejected(self):
        trajectory, snapshot = base_inputs()
        trajectory["actions"][0]["actor"]["entity_id"] = "stranger"
        with self.assertRaises(adapter.SceneError):
            self.convert(trajectory, snapshot)

    def test_snapshot_from_another_run_is_rejected(self):
        trajectory, snapshot = base_inputs()
        snapshot["snapshot_revision"] = 2
        with self.assertRaises(adapter.SceneError):
            self.convert(trajectory, snapshot)

    def test_failed_action_kept_but_not_counted_as_comment(self):
        trajectory, snapshot = base_inputs()
        trajectory["actions"].append({
            "id": "a4", "step": 2, "audit_line": 21, "origin": "autonomous", "stage": "social_exchange",
            "actor": actor("undergraduate_consumer_001", "undergraduate_consumer"), "action": "create_comment",
            "outcome": "failed", "args": {"post_id": 1}, "result": "Tool not found", "targets": []})
        scene = self.convert(trajectory, snapshot)
        self.assertEqual(scene["events"][-1]["type"], "failed")
        self.assertNotIn("comment", scene["summary"]["by_type"])


class BuildingCase(unittest.TestCase):
    def test_split_by_share_always_sums_to_count(self):
        for count in range(0, 40):
            parts = adapter.split_by_share(count, [0.36, 0.36, 0.28])
            self.assertEqual(sum(parts), count)
        self.assertEqual(adapter.split_by_share(70, [0.36, 0.36, 0.28]), [25, 25, 20])
        self.assertEqual(adapter.split_by_share(8, [0.6, 0.4]), [5, 3])

    def test_unknown_building_in_occupancy_is_rejected(self):
        campus = adapter.load_json(CAMPUS)
        campus["occupancy"]["undergraduate_consumer"][0]["building_id"] = "nowhere"
        people = [{"id": "u1", "role": "undergraduate_consumer", "home_location_id": "undergraduate_dormitory"}]
        with self.assertRaises(adapter.SceneError):
            adapter.assign_buildings(people, campus)

    def test_role_without_occupancy_is_rejected(self):
        campus = adapter.load_json(CAMPUS)
        people = [{"id": "x1", "role": "alumni", "home_location_id": "library"}]
        with self.assertRaises(adapter.SceneError):
            adapter.assign_buildings(people, campus)

    def test_assignment_is_stable_and_home_follows_building(self):
        campus = adapter.load_json(CAMPUS)
        make = lambda: [{"id": f"undergraduate_consumer_{k:03d}", "role": "undergraduate_consumer",
                         "home_location_id": "undergraduate_dormitory"} for k in range(1, 11)]
        first, second = make(), make()
        adapter.assign_buildings(first, campus)
        adapter.assign_buildings(second, campus)
        self.assertEqual([p["building_id"] for p in first], [p["building_id"] for p in second])
        for person in first:
            expected = "teaching_building" if person["building_id"] == "teaching_main" else "undergraduate_dormitory"
            self.assertEqual(person["home_location_id"], expected)


@unittest.skipUnless(REAL_TRAJECTORY.exists() and REAL_SNAPSHOT.exists(), "缺少团队真实运行数据")
class RealRunCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = adapter.convert(REAL_TRAJECTORY, REAL_SNAPSHOT, CAMPUS)
        cls.trajectory = adapter.load_json(REAL_TRAJECTORY)

    def test_every_order_in_order_table_appears_once(self):
        orders = [e["order_id"] for e in self.scene["events"] if e["type"] == "purchase"]
        self.assertEqual(len(orders), len(set(orders)))
        self.assertEqual(set(orders), {o["order_id"] for o in self.trajectory["objects"]["orders"]})

    def test_revenue_matches_order_table(self):
        expected = sum(o["amount_fen"] for o in self.trajectory["objects"]["orders"])
        self.assertEqual(self.scene["summary"]["revenue_fen"], expected)

    def test_action_counts_match_source(self):
        by_type = self.trajectory["counts"]["actions_by_type"]
        summary = self.scene["summary"]["by_type"]
        self.assertEqual(summary["post"], by_type["create_post"])
        self.assertEqual(summary["follow"], by_type["follow"])
        self.assertEqual(summary["comment"] + summary["failed"], by_type["create_comment"])
        self.assertEqual(self.scene["summary"]["noop"], by_type["do_nothing"])

    def test_everyone_has_a_home_location(self):
        locations = {loc["location_id"] for loc in self.scene["campus"]["locations"]}
        self.assertTrue(all(p["home_location_id"] in locations for p in self.scene["people"]))

    def test_every_building_except_plaza_is_occupied(self):
        occupied = {p["building_id"] for p in self.scene["people"]}
        all_buildings = {b["building_id"] for loc in self.scene["campus"]["locations"] for b in loc.get("buildings", [])}
        self.assertEqual(occupied, all_buildings)


if __name__ == "__main__":
    unittest.main()
