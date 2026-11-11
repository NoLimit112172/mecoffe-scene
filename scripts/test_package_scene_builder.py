"""Exercise the published Python package independently of the source checkout."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from package_scene_builder import PREPARED_MAP_FILES, ROOT, package_builder, service_files
from scene_split_manifest import ASSET_DIRECTORY, json_bytes


class PackageSceneBuilderTests(unittest.TestCase):
    def test_service_collection_includes_nested_runtime_and_excludes_test_data(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = {
                "__init__.py", "compiler.py", "issue_messages.json", "nested/__init__.py",
                "nested/future.py", "nested/messages.json", "tests/test_service.py",
                "fixtures/generate.py", "fixtures/input.json", "nested/tests/data.json",
                "test_service.py", "tests.py", "service_test.py", "conftest.py", "notes.md",
            }
            for name in names:
                path = root / "adapter/scene_service" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("", encoding="utf-8")
            with patch("package_scene_builder.ROOT", root):
                collected = service_files()
            self.assertEqual(set(collected), {
                "adapter/scene_service/" + name for name in (
                    "__init__.py", "compiler.py", "issue_messages.json", "nested/__init__.py",
                    "nested/future.py", "nested/messages.json",
                )
            })

    def test_extracted_archive_imports_isolated_and_reproduces_official_v1(self):
        with TemporaryDirectory() as temporary:
            work = Path(temporary)
            legacy = work / "legacy-map"
            source = ROOT / "frontend/public/mecoffe/scenarios/ustc-history"
            hashes = {}
            for name in PREPARED_MAP_FILES:
                raw = (source / name).read_bytes()
                if name in {"gis/buildings.geojson", "gis/pois.geojson"}:
                    value = json.loads(raw)
                    value["features"] = [
                        feature for feature in value["features"]
                        if not feature.get("properties", {}).get("illustrative")
                    ]
                    for feature in value["features"]:
                        feature["properties"].pop("location_ids", None)
                        feature["properties"].pop("location_id", None)
                    raw = json_bytes(value)
                path = legacy / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                hashes[name] = hashlib.sha256(raw).hexdigest()
            original = json.loads((source / "scenario.json").read_bytes())
            (legacy / "scenario.json").write_bytes(json_bytes({
                "schema_version": "mecoffe.scenario.v1", "id": "ustc-config-map",
                "simulation_data": False, "style": original["style"], "files": hashes,
            }))
            archive_path = package_builder(ASSET_DIRECTORY / "catalog.json", legacy, work / "release", "a" * 40)
            with ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                self.assertTrue({
                    "payload/adapter/scene_service/compiler.py",
                    "payload/adapter/scene_service/issues.py",
                    "payload/adapter/scene_service/issue_messages.json",
                } <= names)
                self.assertFalse(any(
                    {"tests", "fixtures", "__pycache__"} & set(Path(name).parts) for name in names
                ))
                archive.extractall(work / "extracted")
            payload = work / "extracted/payload"
            isolated_import = """
import importlib
from pathlib import Path
import pkgutil
import sys

payload = Path(sys.argv[1]).resolve()
source = Path(sys.argv[2]).resolve()
assert sys.flags.isolated
assert all(not Path(entry).resolve().is_relative_to(source) for entry in sys.path if entry)
sys.path.insert(0, str(payload))
import adapter.scene_service as service
for info in pkgutil.walk_packages(service.__path__, service.__name__ + '.'):
    module = importlib.import_module(info.name)
    assert Path(module.__file__).resolve().is_relative_to(payload)
assert callable(service.compile_scene)
assert service.describe_issue('INVALID_INPUT')['user_message']
"""
            task = subprocess.run(
                [sys.executable, "-I", "-c", isolated_import, str(payload), str(ROOT)],
                cwd=work, env={**os.environ, "PYTHONPATH": str(ROOT)},
                capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(task.returncode, 0, task.stdout + task.stderr)
            output = work / "regenerated-v1"
            task = subprocess.run(
                [sys.executable, "-I", str(payload / "scripts/generate-ustc-map.py"),
                 "--no-template", "--out", str(output)],
                cwd=work, capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(task.returncode, 0, task.stdout + task.stderr)
            official = ROOT / "data/maps/ustc-gaoxin/1"
            expected = {path.relative_to(official).as_posix(): path.read_bytes()
                        for path in official.rglob("*") if path.is_file()}
            actual = {path.relative_to(output).as_posix(): path.read_bytes()
                      for path in output.rglob("*") if path.is_file()}
            self.assertEqual(actual, expected)
