"""Validate the saved OSM geometry, provenance, walking graph and display mapping."""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import osm_to_campus3d as adapter


ROOT = Path(__file__).resolve().parent.parent


class Campus3DCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.campus = adapter.convert()
        cls.mapping = json.loads(adapter.MAPPING_PATH.read_text(encoding="utf-8"))
        cls.raw = ET.parse(adapter.OSM_PATH).getroot()

    def test_projection_is_local_metric_east_north_with_zero_at_origin(self):
        lon, lat = 117.12384485, 31.82246755
        self.assertEqual(adapter.project(lon, lat, lon, lat), [0, 0])
        east = adapter.project(lon + 0.001, lat, lon, lat)
        north = adapter.project(lon, lat + 0.001, lon, lat)
        self.assertAlmostEqual(east[0], 94.48, delta=0.1)
        self.assertAlmostEqual(east[1], 0, places=8)
        self.assertAlmostEqual(north[0], 0, places=8)
        self.assertAlmostEqual(north[1], 111.195, delta=0.001)
        self.assertLess(adapter.project(lon - 0.001, lat, lon, lat)[0], 0)
        self.assertLess(adapter.project(lon, lat - 0.001, lon, lat)[1], 0)
        projection = self.campus["projection"]
        self.assertEqual(projection["method"], "local_equirectangular")
        self.assertEqual(projection["units"], "metres")
        self.assertIn("radians", projection["formula"])

    def test_building_polygons_are_closed_finite_nonzero_and_osm_backed(self):
        raw_ways = {f"way/{way.get('id')}": way for way in self.raw.findall("way")}
        ids = set()
        for building in self.campus["buildings"]:
            with self.subTest(osm_id=building["osm_id"]):
                self.assertNotIn(building["osm_id"], ids)
                ids.add(building["osm_id"])
                ring = building["polygon"]
                self.assertEqual(ring[0], ring[-1])
                self.assertGreaterEqual(len(set(map(tuple, ring))), 3)
                self.assertGreater(abs(adapter.ring_area(ring)), 1)
                self.assertTrue(all(math.isfinite(value) for point in ring for value in point))
                way = raw_ways[building["osm_id"]]
                self.assertEqual(len(ring), len(way.findall("nd")))
                self.assertTrue(adapter.tags_of(way).get("building"))
                self.assertGreater(building["height_m"], 0)
                self.assertGreater(building["levels"], 0)
        self.assertEqual(len(ids), self.campus["stats"]["buildings"])

    def test_relation_preserves_both_parcels_and_the_inner_exclusion(self):
        polygons = self.campus["boundary_polygons"]
        self.assertEqual(len(polygons), 2)
        self.assertEqual(sum(len(polygon["holes"]) for polygon in polygons), 1)
        self.assertEqual(self.campus["boundary"], polygons[0]["outer"])
        for polygon in polygons:
            self.assertEqual(polygon["outer"][0], polygon["outer"][-1])
            for hole in polygon["holes"]:
                self.assertEqual(hole[0], hole[-1])
                self.assertTrue(adapter.point_in_ring(hole[0], polygon["outer"]))
        # No fabricated bridge joins the campus's two disjoint land parcels.
        outer_a, outer_b = (polygon["outer"] for polygon in polygons)
        self.assertTrue(max(p[1] for p in outer_a) < min(p[1] for p in outer_b)
                        or max(p[1] for p in outer_b) < min(p[1] for p in outer_a))

    def test_mapping_covers_eight_existing_places_and_keeps_disclaimer(self):
        adapter.validate_mapping(self.campus, self.mapping)
        self.assertEqual(set(self.mapping["mappings"]), adapter.REQUIRED_MAPPING_KEYS)
        buildings = {building["osm_id"]: building for building in self.campus["buildings"]}
        for key, entry in self.mapping["mappings"].items():
            self.assertIs(entry["illustrative"], True)
            self.assertTrue(entry["note"])
            self.assertEqual(buildings[entry["osm_id"]]["name"], entry["osm_name"])
            if key.startswith("shop_"):
                self.assertIn("不代表真实门店", entry["note"])
        for mutation in ("missing", "unknown", "not_illustrative"):
            mapping = copy.deepcopy(self.mapping)
            if mutation == "missing":
                mapping["mappings"].pop("ug_dorm_west")
            elif mutation == "unknown":
                mapping["mappings"]["ug_dorm_west"]["osm_id"] = "way/missing"
            else:
                mapping["mappings"]["ug_dorm_west"]["illustrative"] = False
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                adapter.validate_mapping(self.campus, mapping)

    def test_graph_edges_are_real_consecutive_osm_nodes_with_metric_lengths(self):
        raw_ways = {f"way/{way.get('id')}": way for way in self.raw.findall("way")}
        nodes = {node["id"]: node for node in self.campus["walk_graph"]["nodes"]}
        for edge in self.campus["walk_graph"]["edges"]:
            way = raw_ways[edge["osm_way_id"]]
            refs = [f"node/{node.get('ref')}" for node in way.findall("nd")]
            self.assertIn((edge["source"], edge["target"]), list(zip(refs, refs[1:])))
            self.assertTrue(adapter.walking_allowed(adapter.tags_of(way)))
            a, b = nodes[edge["source"]], nodes[edge["target"]]
            self.assertAlmostEqual(edge["length_m"], math.hypot(a["x"] - b["x"], a["y"] - b["y"]), places=5)
            self.assertGreater(edge["length_m"], 0)
        self.assertGreater(len(nodes), 0)
        self.assertGreater(len(self.campus["walk_graph"]["edges"]), 0)

    def test_restrictions_and_relation_join_do_not_create_shortcuts(self):
        self.assertTrue(adapter.walking_allowed({"highway": "footway"}))
        self.assertTrue(adapter.walking_allowed({"highway": "service", "oneway": "yes"}))
        self.assertFalse(adapter.walking_allowed({"highway": "service", "foot": "no"}))
        self.assertFalse(adapter.walking_allowed({"highway": "footway", "access": "private"}))
        self.assertTrue(adapter.walking_allowed({"highway": "service", "access": "private", "foot": "yes"}))
        self.assertFalse(adapter.walking_allowed({"highway": "motorway"}))
        self.assertEqual(adapter.join_rings([["a", "b"], ["c", "b"], ["c", "a"]]), [["a", "b", "c", "a"]])
        with self.assertRaises(ValueError):
            adapter.join_rings([["a", "b"], ["c", "d"]])
        graph = {"nodes": [{"id": name} for name in ["a", "b", "c", "d"]],
                 "edges": [{"source": "a", "target": "b"}, {"source": "c", "target": "d"}]}
        self.assertEqual(len(adapter.graph_components(graph)), 2)

    def test_height_defaults_and_real_osm_tags_have_different_provenance(self):
        for building in self.campus["buildings"]:
            # The saved campus snapshot contains no building height/level tags.
            self.assertEqual(building["levels_source"], "default")
            self.assertEqual(building["height_source"], "default")
            self.assertAlmostEqual(building["height_m"], building["levels"] * 3.2)
        with tempfile.TemporaryDirectory() as folder:
            osm = Path(folder) / "tagged.osm"
            raw = ET.parse(adapter.OSM_PATH)
            building = next(way for way in raw.getroot().findall("way") if "building" in adapter.tags_of(way))
            ET.SubElement(building, "tag", {"k": "building:levels", "v": "7"})
            ET.SubElement(building, "tag", {"k": "height", "v": "24.5 m"})
            raw.write(osm, encoding="utf-8", xml_declaration=True)
            metadata = Path(folder) / "metadata.json"
            adapter.write_json(metadata, {"sha256": adapter.sha256_of(osm)})
            converted = adapter.convert(osm, metadata)
            tagged = next(b for b in converted["buildings"] if b["osm_id"] == f"way/{building.get('id')}")
            self.assertEqual(tagged["levels"], 7)
            self.assertEqual(tagged["height_m"], 24.5)
            self.assertEqual(tagged["levels_source"], "osm")
            self.assertEqual(tagged["height_source"], "osm")

    def test_provenance_public_copies_and_offline_regeneration_match(self):
        source = self.campus["source"]
        self.assertEqual(source["source_url"], adapter.SOURCE_URL)
        self.assertEqual(source["sha256"], adapter.sha256_of(adapter.OSM_PATH))
        self.assertTrue(source["downloaded_at_utc"])
        self.assertEqual(source["license"], "ODbL-1.0")
        self.assertEqual(source["attribution"], "© OpenStreetMap contributors")
        self.assertEqual(json.loads(adapter.OUTPUT_PATH.read_text(encoding="utf-8")), self.campus)
        for name, value in (("campus3d.json", self.campus), ("campus3d_mapping.json", self.mapping)):
            self.assertEqual(json.loads((adapter.PUBLIC_DIR / name).read_text(encoding="utf-8")), value)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "campus.json"
            public = Path(folder) / "public"
            self.assertEqual(adapter.main(["--output", str(output), "--public-dir", str(public)]), 0)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.campus)
            self.assertEqual(json.loads((public / "campus3d.json").read_text(encoding="utf-8")), self.campus)

    def test_metadata_hash_mismatch_does_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            bad_metadata = directory / "metadata.json"
            adapter.write_json(bad_metadata, {"sha256": "bad"})
            output = directory / "campus.json"
            output.write_text("keep previous complete output", encoding="utf-8")
            self.assertEqual(adapter.main(["--metadata", str(bad_metadata), "--output", str(output),
                                           "--public-dir", str(directory / "public")]), 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "keep previous complete output")


if __name__ == "__main__":
    unittest.main()
