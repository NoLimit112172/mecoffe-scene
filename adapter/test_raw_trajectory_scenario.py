"""用独立合成输入验证原始 OASIS 轨迹经过转换器后可以完整生成场景包。"""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from adapter.scene_builder.scenario import prepare_scenario


class RawTrajectoryScenarioTests(unittest.TestCase):
    """确保同批快照版本在原始记录、规范化回放和场景清单之间保持一致。"""

    def test_raw_trajectory_and_snapshot_build_reproducible_bundle(self):
        """合成轨迹和快照可走完整生成入口，输入不变，所有产物哈希可复现。"""
        snapshot = {
            "schema_version": "1.0",
            "snapshot_id": "synthetic_snapshot_01",
            "snapshot_revision": 3,
            "selection_request_id": "synthetic_selection_01",
            "dataset_version": "synthetic_test_only",
            "seed": 17,
            "nodes": [{
                "entity_id": "synthetic_person_01",
                "role": "undergraduate_consumer",
                "name": "样例人物 01",
                "static_attributes": {"gender": "female", "age": 20},
                "dynamic_attributes": {"personality": "用于自动测试的合成画像"},
            }],
            "edges": [],
        }
        trajectory = {
            "schema_version": "1.0",
            "kind": "oasis.interaction_trajectory",
            "run_id": "synthetic_run_01",
            "status": "completed",
            "partial": False,
            "metadata": {
                "plan_id": "synthetic_plan_01",
                "snapshot_id": snapshot["snapshot_id"],
                "snapshot_revision": snapshot["snapshot_revision"],
                "completed_steps": 1,
                "total_steps": 1,
                "step_unit": "day",
            },
            "agents": [{"entity_id": "synthetic_person_01"}],
            "initial_relationships": [],
            "objects": {
                "posts": [{"post_id": 1, "author_entity_id": "synthetic_person_01",
                           "content": "合成样例帖子"}],
                "ads": [], "orders": [], "products": [],
            },
            "actions": [{
                "id": "synthetic_action_01", "step": 1, "audit_line": 1,
                "origin": "autonomous", "stage": "social_exchange",
                "actor": {"entity_id": "synthetic_person_01"},
                "action": "create_post", "outcome": "executed",
                "args": {"content": "合成样例帖子"}, "result": {"post_id": 1}, "targets": [],
            }],
            "observations": [],
        }
        campus = {
            "locations": [{
                "location_id": "synthetic_residence",
                "name": "合成样例宿舍",
                "default_for_roles": ["undergraduate_consumer"],
                "buildings": [{"building_id": "synthetic_home"}],
            }],
            "occupancy": {"undergraduate_consumer": [{"building_id": "synthetic_home", "share": 1}]},
        }
        geography = {
            "type": "FeatureCollection",
            "source": {"license": "CC0-1.0", "attribution": "程序生成的合成测试地图"},
            "features": [{
                "type": "Feature", "id": "home",
                "properties": {"building": "dormitory", "name": "合成样例宿舍",
                               "location_id": "synthetic_home", "levels": 3},
                "geometry": {"type": "Polygon", "coordinates": [[
                    [103.773, 1.294], [103.7732, 1.294], [103.7732, 1.2942],
                    [103.773, 1.2942], [103.773, 1.294],
                ]]},
            }, {
                "type": "Feature", "id": "walk",
                "properties": {"highway": "footway", "name": "合成样例步道"},
                "geometry": {"type": "LineString", "coordinates": [
                    [103.773, 1.2939], [103.7732, 1.2939], [103.7734, 1.2939],
                ]},
            }],
        }
        manifest = {
            "id": "synthetic-raw-scenario", "title": "合成原始轨迹回归测试",
            "map": {"type": "geojson", "path": "map.json"},
            "simulation_time": {"start": "2026-01-01T06:00:00+08:00",
                                "timezone": "Asia/Shanghai", "step_unit": "day", "steps": 1},
            "trajectory": "raw-trajectory.json", "population_snapshot": "snapshot.json",
        }

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            inputs = {"raw-trajectory.json": trajectory, "snapshot.json": snapshot,
                      "map.json": geography, "scenario.json": manifest, "scene/campus.json": campus}
            for filename, value in inputs.items():
                target = directory / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            original_bytes = {filename: (directory / filename).read_bytes() for filename in inputs}

            # 原始转换入口当前接受校园配置路径，由隔离目录提供合成配置。
            with patch("adapter.scene_builder.scenario.ROOT", directory):
                result, output = prepare_scenario(directory / "scenario.json", directory / "first")
                repeated, other = prepare_scenario(directory / "scenario.json", directory / "second")

            normalized = json.loads((output / "trajectory.json").read_text(encoding="utf-8"))
            self.assertTrue(result["simulation_data"])
            self.assertEqual(normalized["meta"]["snapshot_id"], snapshot["snapshot_id"])
            self.assertEqual(normalized["meta"]["snapshot_revision"], snapshot["snapshot_revision"])
            self.assertEqual(normalized["people"][0]["name"], "样例人物 01")
            self.assertEqual(normalized["summary"]["events"], 1)
            self.assertEqual(normalized["summary"]["orders"], 0)
            self.assertEqual(result, repeated)
            for filename, expected_hash in result["files"].items():
                with self.subTest(filename=filename):
                    self.assertEqual((output / filename).read_bytes(), (other / filename).read_bytes())
                    self.assertEqual(hashlib.sha256((output / filename).read_bytes()).hexdigest(), expected_hash)
            for filename, expected_bytes in original_bytes.items():
                self.assertEqual((directory / filename).read_bytes(), expected_bytes)


if __name__ == "__main__":
    unittest.main()
