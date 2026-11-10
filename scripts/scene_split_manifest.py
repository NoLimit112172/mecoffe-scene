"""Write deterministic scene split archives and their byte-level manifests."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adapter.scene_builder.asset_library import ASSET_DIRECTORY, published_asset_library


RELEASE_ID = "scene-split.1"
VERSION = "1.0.0"
KINDS = ("display", "model-library", "map-library", "map-builder")


def require_published_catalog(path):
    """Return the registered descriptor if the built catalog matches it byte for byte."""
    descriptor, _ = published_asset_library()
    registered = ASSET_DIRECTORY / descriptor["catalog_file"]
    if Path(path).read_bytes() != registered.read_bytes():
        raise ValueError("catalog does not match the registered published asset library")
    return descriptor


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _entry(name):
    relative = PurePosixPath(name)
    if (not name or name == "." or relative.is_absolute() or relative.as_posix() != name
            or ".." in relative.parts or any(character in name for character in ("\\", ":", "\0"))):
        raise ValueError(f"invalid archive path: {name!r}")
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def _copy_entry(archive, prefix, name, path):
    info = _entry(f"{prefix}/{_entry(name).filename}")
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"not a regular source file: {path}")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source, archive.open(info, "w") as target:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            target.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    return {"path": name, "bytes": size, "sha256": digest.hexdigest()}


def write_artifact(output_dir, kind, source_commit, files, *, requires=None, extra_metadata=None, notices=None):
    """Record hashes over exactly the bytes written under payload/ and notices/."""
    if kind not in KINDS or not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("invalid artifact kind or source commit")
    if not files:
        raise ValueError("artifact payload is empty")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"scene-{kind}-{VERSION}.zip"
    manifest = {"schema_version": "scene.artifact.v1", "kind": kind, "version": VERSION,
                "source_commit": source_commit, "requires": requires or {}}
    if manifest.keys() & (extra_metadata or {}).keys() or {"files", "notices"} & (extra_metadata or {}).keys():
        raise ValueError("extra metadata overlaps reserved manifest fields")
    manifest.update(extra_metadata or {})
    with NamedTemporaryFile(dir=output_dir, prefix=f".{destination.stem}-", suffix=".tmp", delete=False) as temp:
        temporary = Path(temp.name)
    try:
        with ZipFile(temporary, "w") as archive:
            manifest["files"] = [_copy_entry(archive, "payload", name, path) for name, path in sorted(files.items())]
            manifest["notices"] = [_copy_entry(archive, "notices", name, path) for name, path in sorted((notices or {}).items())]
            archive.writestr(_entry("artifact.json"), json_bytes(manifest))
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination
