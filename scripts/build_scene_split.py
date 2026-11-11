"""Build the version-locked scene release in a new local output directory."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from package_scene_web import collect_versioned_maps
from scene_split_manifest import (
    ASSET_DIRECTORY,
    KINDS,
    RELEASE_ID,
    VERSION,
    json_bytes,
    require_published_catalog,
    sha256_file,
)


ROOT = Path(__file__).resolve().parents[1]
CATALOG = "mecoffe/assets3d/catalog.json"
MAPS_DIRECTORY = ROOT / "data/maps"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def run_script(script, *args):
    subprocess.run([sys.executable, str(ROOT / "scripts" / script), *map(str, args)], cwd=ROOT, check=True)


def write_release_lock(directory, source_commit, published):
    artifacts = {}
    descriptors = {}
    for kind in KINDS:
        path = directory / f"scene-{kind}-{VERSION}.zip"
        with ZipFile(path) as archive:
            descriptor = json.loads(archive.read("artifact.json"))
        if (descriptor["kind"], descriptor["version"], descriptor["source_commit"]) != (kind, VERSION, source_commit):
            raise ValueError(f"artifact descriptor does not match release: {path.name}")
        if (descriptor["asset_library_version"], descriptor["catalog_sha256"]) != (
                published["version"], published["catalog_sha256"]):
            raise ValueError(f"artifact does not match published asset library: {path.name}")
        artifacts[kind] = {
            "filename": path.name,
            "version": VERSION,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "requires": descriptor["requires"],
        }
        descriptors[kind] = descriptor
    with ZipFile(directory / artifacts["model-library"]["filename"]) as archive:
        model_catalog = archive.read(f"payload/scene/{CATALOG}")
    with ZipFile(directory / artifacts["map-builder"]["filename"]) as archive:
        builder_catalog = archive.read(f"payload/frontend/public/{CATALOG}")
        registered_path = ASSET_DIRECTORY.relative_to(ROOT) / published["catalog_file"]
        registered_catalog = archive.read(f"payload/{registered_path.as_posix()}")
    if (model_catalog != builder_catalog or model_catalog != registered_catalog
            or hashlib.sha256(model_catalog).hexdigest() != published["catalog_sha256"]):
        raise ValueError("the model and builder archives do not share the published catalog bytes")
    official_files, map_refs = collect_versioned_maps(MAPS_DIRECTORY, published)
    if descriptors["map-library"]["map_refs"] != map_refs:
        raise ValueError("the map artifact does not list every published map version")
    with ZipFile(directory / artifacts["map-library"]["filename"]) as archive:
        expected_names = {f"payload/{name}" for name in official_files}
        actual_names = [name for name in archive.namelist() if name.startswith("payload/scene-maps/")]
        if len(actual_names) != len(expected_names) or set(actual_names) != expected_names:
            raise ValueError("the map archive does not contain every published map file")
        for name, source in official_files.items():
            if archive.read(f"payload/{name}") != source.read_bytes():
                raise ValueError(f"the map archive differs from the published file: {name}")
    lock = {
        "schema_version": "scene.release-lock.v1",
        "release": RELEASE_ID,
        "source_commit": source_commit,
        "artifacts": artifacts,
        "asset_library_version": published["version"],
        "catalog_sha256": published["catalog_sha256"],
        "map_refs": map_refs,
    }
    (directory / "release-lock.json").write_bytes(json_bytes(lock))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "logs" / RELEASE_ID)
    args = parser.parse_args()
    destination = args.output_dir.resolve()
    if destination.exists():
        parser.error(f"output directory already exists: {destination}")
    if git("status", "--porcelain"):
        parser.error("commit the source changes before building a version-locked release")
    source_commit = git("rev-parse", "HEAD")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=f".{RELEASE_ID}-", dir=destination.parent) as temp:
        temporary = Path(temp)
        release = temporary / "release"
        subprocess.run(["npm", "run", "build:embed"], cwd=ROOT / "frontend", check=True,
                       env={**os.environ, "MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT": "false"})
        subprocess.run(["node", "scripts/prepare-scene-assets.mjs", "--dist"], cwd=ROOT, check=True)
        embed = ROOT / "frontend" / "dist-embed"
        catalog = embed / CATALOG
        published = require_published_catalog(catalog)
        run_script("package_scene_web.py", "--embed-dir", embed, "--maps-dir", MAPS_DIRECTORY,
                   "--output-dir", release, "--source-commit", source_commit)
        run_script("package_scene_builder.py", "--catalog", catalog, "--legacy-map-dir", embed / "mecoffe/config-map",
                   "--output-dir", release,
                   "--source-commit", source_commit)
        write_release_lock(release, source_commit, published)
        release.rename(destination)
    print(f"{RELEASE_ID}: {destination}")


if __name__ == "__main__":
    main()
