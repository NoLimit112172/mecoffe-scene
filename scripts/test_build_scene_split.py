"""Check the release lock against the maps actually carried by the archives."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from build_scene_split import CATALOG, ROOT, write_release_lock
from package_scene_web import collect_versioned_maps
from scene_split_manifest import ASSET_DIRECTORY, require_published_catalog, write_artifact


class ReleaseLockTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.commit = "a" * 40
        self.catalog = ASSET_DIRECTORY / "catalog.json"
        self.published = require_published_catalog(self.catalog)
        self.maps, self.refs = collect_versioned_maps(ROOT / "data/maps", self.published)
        self.metadata = {
            "asset_library_version": self.published["version"],
            "catalog_sha256": self.published["catalog_sha256"],
        }

    def package(self, maps, refs):
        payloads = {
            "display": {"scene/index.html": ASSET_DIRECTORY / "asset-library.json"},
            "model-library": {f"scene/{CATALOG}": self.catalog},
            "map-builder": {
                f"frontend/public/{CATALOG}": self.catalog,
                (ASSET_DIRECTORY.relative_to(ROOT) / "catalog.json").as_posix(): self.catalog,
            },
            "map-library": maps,
        }
        for kind, files in payloads.items():
            metadata = dict(self.metadata)
            if kind == "map-library":
                metadata["map_refs"] = refs
            write_artifact(self.directory, kind, self.commit, files, extra_metadata=metadata)

    def test_lock_records_every_published_map_as_a_list(self):
        self.package(self.maps, self.refs)
        write_release_lock(self.directory, self.commit, self.published)
        lock = json.loads((self.directory / "release-lock.json").read_bytes())
        self.assertIsInstance(lock["map_ref"], list)
        self.assertEqual(lock["map_ref"], self.refs)
        self.assertTrue(
            {("ustc-gaoxin", "1"), ("ustc-gaoxin", "2")} <=
            {(ref["map_id"], ref["map_version"]) for ref in lock["map_ref"]}
        )

    def test_missing_version_cannot_be_hidden_by_complete_metadata(self):
        files = {name: path for name, path in self.maps.items()
                 if not name.startswith("scene-maps/ustc-gaoxin/2/")}
        self.package(files, self.refs)
        with self.assertRaisesRegex(ValueError, "every published map file"):
            write_release_lock(self.directory, self.commit, self.published)
        self.assertFalse((self.directory / "release-lock.json").exists())

    def test_changed_map_bytes_cannot_publish_a_lock(self):
        changed = self.directory / "changed-quality.json"
        changed.write_text('{"status":"changed"}', encoding="utf-8")
        files = {**self.maps, "scene-maps/ustc-gaoxin/2/quality.json": changed}
        self.package(files, self.refs)
        with self.assertRaisesRegex(ValueError, "differs from the published file"):
            write_release_lock(self.directory, self.commit, self.published)
        self.assertFalse((self.directory / "release-lock.json").exists())
