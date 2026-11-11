"""Package the Python map builder, evidence service, and local source data."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from scene_split_manifest import ASSET_DIRECTORY, json_bytes, require_published_catalog, sha256_file, write_artifact


ROOT = Path(__file__).resolve().parents[1]
CATALOG = "frontend/public/mecoffe/assets3d/catalog.json"
BUILDER_MODULES = ("__init__", "__main__", "asset_library", "core", "entrances", "gis", "io", "scenario")
OSM_SOURCES = ("ustc_gaoxin", "ustc_gaoxin_surroundings", "nus")
PREPARED_SOURCE = "frontend/public/mecoffe/scenarios/ustc-history"
BUILDINGS_LAYER = "gis/buildings.geojson"
OFFICIAL_MAP = ROOT / "data/maps/ustc-gaoxin/1"
PREPARED_MAP_FILES = (
    "campus3d.json", "asset_assignments.json", "landcover.json", "surroundings.json", "entrances.json",
    *(f"gis/{name}.geojson" for name in ("buildings", "roads", "landcover", "water", "boundary", "pois", "entrances")),
)


def service_files():
    directory = ROOT / "adapter/scene_service"
    files = {}
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if {"tests", "fixtures", "__pycache__"} & set(relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"scene_service contains a symlink: {relative}")
        if (path.is_file() and path.suffix in {".py", ".json"}
                and not path.name.startswith("test_")
                and not path.name.endswith("_test.py")
                and path.name not in {"tests.py", "conftest.py"}):
            files[path.relative_to(ROOT).as_posix()] = path
    return files


def prepared_map_sources(legacy_map_dir, scenario_copy):
    scenario = json.loads((legacy_map_dir / "scenario.json").read_bytes())
    if (not isinstance(scenario, dict) or scenario.get("schema_version") != "mecoffe.scenario.v1"
            or scenario.get("id") != "ustc-config-map" or scenario.get("simulation_data") is not False):
        raise ValueError("expected the geometry-only config-map from build:embed")
    files = {name: legacy_map_dir / name for name in PREPARED_MAP_FILES}
    if scenario.get("files") != {name: sha256_file(path) for name, path in files.items()}:
        raise ValueError("legacy config-map does not match its file manifest")

    # Preserve the formal release's numeric serialization in the buildings layer.
    files[BUILDINGS_LAYER] = OFFICIAL_MAP / BUILDINGS_LAYER
    scenario["files"][BUILDINGS_LAYER] = sha256_file(files[BUILDINGS_LAYER])
    scenario_copy.write_bytes(json_bytes(scenario))
    files["scenario.json"] = scenario_copy
    return {f"{PREPARED_SOURCE}/{name}": path for name, path in files.items()}


def package_builder(catalog, legacy_map_dir, output_dir, source_commit):
    descriptor = require_published_catalog(catalog)
    relative_files = (
        *(f"adapter/scene_builder/{name}.py" for name in BUILDER_MODULES),
        "adapter/osm_to_campus3d.py",
        "adapter/osm_landcover.py",
        "adapter/osm_surroundings.py",
        "scripts/generate-ustc-map.py",
        "data/examples/offline-map.geojson",
    )
    files = {name: ROOT / name for name in relative_files}
    files.update(service_files())
    for source in OSM_SOURCES:
        osm, metadata = (f"data/osm/{source}.{suffix}" for suffix in ("osm", "metadata.json"))
        metadata_path = ROOT / metadata
        data = json.loads(metadata_path.read_bytes())
        if not isinstance(data, dict) or data.get("sha256") != sha256_file(ROOT / osm):
            raise ValueError(f"archived OSM hash does not match {metadata}")
        files.update({osm: ROOT / osm, metadata: metadata_path})
    asset_dir = ASSET_DIRECTORY.relative_to(ROOT).as_posix()
    files.update({
        CATALOG: catalog,
        f"{asset_dir}/catalog.json": catalog,
        f"{asset_dir}/asset-library.json": ASSET_DIRECTORY / "asset-library.json",
        "README.md": ROOT / "docs/scene-builder-offline.md",
    })
    with TemporaryDirectory() as staging:
        files.update(prepared_map_sources(legacy_map_dir, Path(staging) / "scenario.json"))
        return write_artifact(
            output_dir, "map-builder", source_commit, files,
            extra_metadata={
                "asset_library_version": descriptor["version"],
                "catalog_sha256": descriptor["catalog_sha256"],
                "runtime": {"system": "linux", "python": "3.11", "tzdata": True},
            },
            notices={"NOTICE.md": ROOT / "NOTICE.md", "YuLan-Apache-2.0.txt": ROOT / "YULAN_LICENSE"},
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True, help="catalog.json produced by build:embed")
    parser.add_argument("--legacy-map-dir", type=Path, required=True, help="geometry-only config-map from build:embed")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    try:
        print(package_builder(args.catalog, args.legacy_map_dir, args.output_dir, args.source_commit))
    except (OSError, ValueError) as error:
        parser.exit(1, f"map-builder package: {error}\n")


if __name__ == "__main__":
    main()
