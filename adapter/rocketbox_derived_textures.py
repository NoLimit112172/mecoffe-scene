"""Import audited MIT openOMSI colour textures without replacing official FBX.

The public 91-person archive is read with bounded HTTP ranges. Each decompressed
JPEG/PNG is checked against the ZIP entry size/CRC, then decoded and resized.
Original TGA hashes are deliberately NOT claimed: these are derivative images.
Existing complete runtime model records are preserved. The checked-in resource
index is the default; --audit can optionally supply the original full audit.
Run rocketbox_assets.py --inventory-only first if the ignored inventory cache
is absent. This does not publish manifest.json; rocketbox_assets.py's owner
assembles the final 115-person list.
"""
from __future__ import annotations

import argparse
import binascii
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import re
import struct
import threading
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
import zlib

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "logs/asset-library"
OUTPUT = ROOT / "frontend/public/mecoffe/assets3d/rocketbox"
RECORDS = LOGS / "rocketbox-model-records"
CACHE = LOGS / "openomsi-derived-cache"
DEFAULT_INDEX = Path(__file__).resolve().parent / "resources/rocketbox-openomsi-index.json"
# Kept as a module alias for local audit scripts written during preparation.
AUDIT = DEFAULT_INDEX
REVISION = "0943055db6ec570bcef9f2c8b41c9e5467c808f9"
RAW = f"https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/{REVISION}/"
ASSET_URL = "https://github.com/openOMSI-org/openOMSI/releases/download/avatars-1/openOMSI-avatars-1.zip"
ASSET_BYTES = 312516588
EXPECTED_ARCHIVE_SHA256 = "ead00bbfbf66165336dcd40323569840c18e148ee79c3e7d097d198ad4b12d6a"
RELEASE_COMMIT = "f4841225a413a32103df312dcaa0e30dc81cbd76"
BUILDER_COMMIT = "07a101ab5d0b5c8f54debefc38ea2584de23695f"
_print_lock = threading.Lock()
_counters = {"downloaded_entries": 0, "cache_hits": 0, "range_bytes": 0}


def log(message: str) -> None:
    with _print_lock:
        print(message, flush=True)


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".derived.tmp")
    temporary.write_bytes(content)
    # Windows readers/virus scanners may briefly hold the destination without
    # delete sharing. A bounded retry preserves the old complete JSON meanwhile.
    for attempt in range(6):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.02 * 2 ** attempt)


def atomic_json(path: Path, value: object) -> None:
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf8"))


def file_hashes(path: Path) -> tuple[int, str, str]:
    data = path.read_bytes()
    return len(data), hashlib.sha256(data).hexdigest(), hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def decoded_entry(payload: bytes, entry: dict) -> bytes:
    """Validate the ZIP local header and exact decompressed file, never extract paths."""
    if len(payload) < 30:
        raise ValueError("Truncated ZIP local header")
    header = struct.unpack_from("<4s5H3I2H", payload)
    signature, _, flags, method = header[:4]
    if signature != b"PK\x03\x04" or flags & 1 or method != entry["method"]:
        raise ValueError("Unsupported or mismatched ZIP local header")
    name_size, extra_size = header[-2:]
    filename = payload[30:30 + name_size].decode("utf8" if flags & 2048 else "cp437")
    if filename != entry["name"]:
        raise ValueError("ZIP entry name differs from audited central directory")
    start = 30 + name_size + extra_size
    compressed = payload[start:start + entry["compressed_size"]]
    if len(compressed) != entry["compressed_size"]:
        raise ValueError("Truncated ZIP compressed payload")
    if method == 8:
        inflater = zlib.decompressobj(-15)
        result = inflater.decompress(compressed, entry["uncompressed_size"] + 1)
        if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
            raise ValueError("Invalid or oversized ZIP deflate stream")
    elif method == 0:
        result = compressed
    else:
        raise ValueError("Unsupported ZIP compression method")
    verify_entry(result, entry)
    return result


def verify_entry(data: bytes, entry: dict) -> None:
    if len(data) != entry["uncompressed_size"] or f"{binascii.crc32(data) & 0xffffffff:08x}" != entry["crc32"]:
        raise ValueError("ZIP entry size/CRC32 mismatch")


def load_index(path: Path = DEFAULT_INDEX) -> dict:
    """Read the versioned minimum index, or the compatible original full audit."""
    audit = json.loads(path.read_text("utf8"))
    if (audit["release_url"] != ASSET_URL or audit["release_bytes"] != ASSET_BYTES
            or audit["release_sha256_from_GitHub_metadata"] != EXPECTED_ARCHIVE_SHA256
            or audit["release_tag_commit"] != RELEASE_COMMIT or audit["builder_commit"] != BUILDER_COMMIT
            or audit.get("canonical_revision", REVISION) != REVISION):
        raise ValueError("Unexpected audited archive or canonical source identity")
    ids = audit["model_ids"]
    matches = audit["required_texture_matches"]
    if len(ids) != 91 or len(set(ids)) != 91 or len(matches) != 258:
        raise ValueError("Incomplete 91-person/258-colour-entry index")
    if any(not re.fullmatch(r"[A-Za-z0-9_]+", model_id) for model_id in ids):
        raise ValueError("Invalid indexed model identifier")
    seen = set()
    for match in matches:
        model_id, source, entry = match["model_id"], PurePosixPath(match["source_path"]), match["archive_entry"]
        name = PurePosixPath(entry["name"])
        identity = (model_id, match["source_path"])
        if (model_id not in ids or identity in seen or len(source.parts) != 6
                or source.parts[:2] != ("Assets", "Avatars")
                or source.parts[2] not in ("Adults", "Children", "Professions")
                or source.parts[3:5] != (model_id, "Textures") or source.suffix.lower() != ".tga"
                or name.parts != (model_id, name.name) or name.stem != source.stem
                or name.suffix.lower() not in (".jpg", ".png")
                or not re.fullmatch(r"[0-9a-f]{40}", match["source_git_blob_expected"])):
            raise ValueError("Unexpected or duplicate texture identity in index")
        seen.add(identity)
    if {model_id for model_id, _ in seen} != set(ids):
        raise ValueError("Index does not cover every declared model")
    notices = {entry["name"]: entry for entry in audit["entries"] if entry["name"] in ("LICENSE.md", "CREDITS.md")}
    if set(notices) != {"LICENSE.md", "CREDITS.md"}:
        raise ValueError("Missing indexed archive notices")
    for entry in [match["archive_entry"] for match in matches] + list(notices.values()):
        if (entry["method"] not in (0, 8) or entry.get("flags", 0) & 1
                or not re.fullmatch(r"[0-9a-f]{8}", entry["crc32"])
                or not 0 < entry["compressed_size"] <= 32 * 1024 * 1024
                or not 0 < entry["uncompressed_size"] <= 32 * 1024 * 1024
                or not 0 <= entry["local_header_offset"] < ASSET_BYTES
                or entry["local_header_offset"] + 30 + len(entry["name"].encode()) + entry["compressed_size"] > ASSET_BYTES):
            raise ValueError("Invalid indexed ZIP range, CRC, size or compression")
    for name, entry in notices.items():
        verify_entry(audit["metadata"][name].encode("utf8"), entry)
    return audit


def fetch_entry(entry: dict, attempts: int = 3) -> bytes:
    key = hashlib.sha256((ASSET_URL + "#" + entry["name"]).encode()).hexdigest()
    cached = CACHE / (key + PurePosixPath(entry["name"]).suffix.lower())
    if cached.is_file():
        try:
            data = cached.read_bytes()
            verify_entry(data, entry)
            with _print_lock:
                _counters["cache_hits"] += 1
            return data
        except ValueError:
            cached.unlink()
    offset = entry["local_header_offset"]
    # The extra allowance covers the local (not central) header's extra fields.
    end = min(ASSET_BYTES - 1, offset + 30 + len(entry["name"].encode()) + entry["compressed_size"] + 1024)
    expected_range = f"bytes {offset}-{end}/{ASSET_BYTES}"
    error = None
    for attempt in range(attempts):
        try:
            request = Request(ASSET_URL, headers={"User-Agent": "MeCoffe-asset-audit", "Range": f"bytes={offset}-{end}"})
            started = time.monotonic()
            with urlopen(request, timeout=35) as response:
                if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                    raise ValueError("Archive server did not honor the exact bounded range")
                pieces = []
                received = 0
                while block := response.read1(64 * 1024):
                    received += len(block)
                    if received > end - offset + 1:
                        raise ValueError("Archive server exceeded requested byte range")
                    pieces.append(block)
                    if time.monotonic() - started > 100:
                        raise TimeoutError("Archive entry exceeded 100 second total transfer bound")
                if received != end - offset + 1:
                    raise ValueError("Archive range is incomplete")
            data = decoded_entry(b"".join(pieces), entry)
            atomic_bytes(cached, data)
            with _print_lock:
                _counters["downloaded_entries"] += 1
                _counters["range_bytes"] += received
            return data
        except Exception as exc:
            error = exc
            log(f"range retry {attempt + 1}/{attempts}: {entry['name']}: {type(exc).__name__}: {exc}")
            if attempt + 1 < attempts:
                time.sleep(min(8, 2 ** attempt))
    raise RuntimeError(f"Failed audited ZIP entry {entry['name']}: {error}")


def validate_record(model: dict) -> dict | None:
    """Skip only complete records whose FBX and PNG bytes remain valid."""
    path = RECORDS / (model["id"] + ".json")
    try:
        record = json.loads(path.read_text("utf8"))
        size, sha256, git = file_hashes(OUTPUT / record["fbx"])
        if record["id"] != model["id"] or git != model["source_git_blob"] or sha256 != record["sha256"] or size != record["bytes"]:
            return None
        expected = {PurePosixPath(t["source_path"]).name: t for t in model["textures"]}
        if len(record["textures"]) != len(expected) or {t["source_name"] for t in record["textures"]} != set(expected):
            return None
        for texture in record["textures"]:
            source = expected[texture["source_name"]]
            local = OUTPUT / texture["path"]
            size, sha256, _ = file_hashes(local)
            if sha256 != texture["sha256"] or size != texture["bytes"] or texture["source_git_blob"] != source["source_git_blob"]:
                return None
            with Image.open(local) as image:
                image.load()
                limit = 1024 if source["kind"] in ("head", "atlas") else 512
                if image.format != "PNG" or image.mode not in ("RGB", "RGBA") or max(image.size) > limit or list(image.size) != [texture["width"], texture["height"]]:
                    return None
        return record
    except (OSError, ValueError, KeyError, TypeError):
        return None


def convert_texture(source: dict, match: dict, data: bytes, model_id: str) -> dict:
    entry = match["archive_entry"]
    kind = source["kind"]
    limit = 1024 if kind in ("head", "atlas") else 512
    suffix = PurePosixPath(entry["name"]).suffix.lower()
    with Image.open(BytesIO(data)) as image:
        image.load()
        expected_format = "JPEG" if suffix in (".jpg", ".jpeg") else "PNG"
        if image.format != expected_format or image.mode not in ("RGB", "RGBA") or max(image.size) > 4096:
            raise ValueError(f"Invalid derivative image format/mode/size: {entry['name']}")
        if kind == "opacity" and image.mode != "RGBA":
            raise ValueError(f"Opacity image has no preserved alpha: {entry['name']}")
        source_width, source_height = image.size
        alpha_before = list(image.getchannel("A").getextrema()) if image.mode == "RGBA" else None
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, "PNG", optimize=True)
        png = buffer.getvalue()
        with Image.open(BytesIO(png)) as verify:
            verify.load()
            if verify.mode != image.mode or verify.size != image.size or verify.tobytes() != image.tobytes():
                raise ValueError("Runtime PNG lossless round-trip check failed")
        width, height = image.size
        mode = image.mode
        alpha_after = list(image.getchannel("A").getextrema()) if mode == "RGBA" else None
    target = OUTPUT / model_id / "Textures" / (PurePosixPath(source["source_path"]).stem + ".png")
    atomic_bytes(target, png)
    derivative = {
        "provider": "openOMSI", "release_tag": "avatars-1", "release_tag_commit": RELEASE_COMMIT,
        "asset_url": ASSET_URL, "expected_archive_sha256": EXPECTED_ARCHIVE_SHA256,
        "expected_archive_sha256_origin": "GitHub release asset metadata", "whole_archive_verified": False,
        "builder_commit": BUILDER_COMMIT,
        "builder_url": f"https://github.com/openOMSI-org/openOMSI/blob/{BUILDER_COMMIT}/tools/avatars/build_pack.py",
        "builder_note": "Published after release; archive CREDITS independently confirms original FBX and TGA-to-JPEG/PNG conversion.",
        "entry": entry["name"], "path": entry["name"], "crc32": entry["crc32"], "crc32_verified": True,
        "sha256_actual_entry": hashlib.sha256(data).hexdigest(), "bytes_actual_entry": len(data),
        "compressed_bytes": entry["compressed_size"], "local_header_offset": entry["local_header_offset"],
        "format": expected_format, "width": source_width, "height": source_height,
        "alpha_extrema_before_resize": alpha_before, "alpha_extrema_after_resize": alpha_after,
        "jpeg_lossy_intermediate": expected_format == "JPEG",
        "conversion": f"openOMSI TGA to {expected_format}; JPEG colours already lossy, alpha PNG retained; local LANCZOS resize <= {limit}px, lossless PNG encoding; no UV repacking",
        "license": "MIT", "license_file": "derivatives/openomsi/LICENSE.md", "credits_file": "derivatives/openomsi/CREDITS.md",
    }
    return {
        "source_name": PurePosixPath(source["source_path"]).name, "path": target.relative_to(OUTPUT).as_posix(), "kind": kind,
        "source_url": RAW + quote(source["source_path"]), "source_sha256": None,
        "source_git_blob": source["source_git_blob"], "source_git_blob_locally_verified": False,
        "source_bytes": source["source_bytes"], "source_bytes_basis": "Pinned upstream Git tree metadata, not a downloaded TGA",
        "sha256": hashlib.sha256(png).hexdigest(), "bytes": len(png),
        "original_width": None, "original_height": None, "width": width, "height": height, "mode": mode,
        "conversion": derivative["conversion"], "derivative": derivative,
    }


def prepare_model(model: dict, matches: dict, attempts: int) -> dict:
    existing = validate_record(model)
    if existing:
        return {"id": model["id"], "status": "preserved", "textures": len(existing["textures"])}
    # Do not download or replace FBX. Every runtime FBX must match the official
    # pinned Git tree, regardless of where its derivative colour images came from.
    fbx = OUTPUT / model["id"] / (model["id"] + ".fbx")
    size, sha256, git = file_hashes(fbx)
    if size != model["fbx_bytes"] or git != model["source_git_blob"]:
        raise ValueError(f"Official standard FBX is missing or invalid: {model['id']}")
    record = {k: model[k] for k in ("id", "label", "human", "category", "age_group", "gender")}
    record.update({"fbx": fbx.relative_to(OUTPUT).as_posix(), "source_url": RAW + quote(model["fbx_source"]),
                   "sha256": sha256, "source_git_blob": git, "bytes": size, "textures": []})
    for source in model["textures"]:
        match = matches[(model["id"], source["source_path"])]
        if match["source_git_blob_expected"] != source["source_git_blob"]:
            raise ValueError("Audited derivative does not match the expected original texture identity")
        record["textures"].append(convert_texture(source, match, fetch_entry(match["archive_entry"], attempts), model["id"]))
    atomic_json(RECORDS / (model["id"] + ".json"), record)
    if not validate_record(model):
        raise ValueError(f"Published runtime record validation failed: {model['id']}")
    return {"id": model["id"], "status": "derived", "textures": len(record["textures"])}


def copy_notices(audit: dict) -> None:
    by_name = {e["name"]: e for e in audit["entries"]}
    for name in ("LICENSE.md", "CREDITS.md"):
        content = audit["metadata"][name].encode("utf8")
        verify_entry(content, by_name[name])
        atomic_bytes(OUTPUT / "derivatives/openomsi" / name, content)
    text = (
        "# openOMSI derivative colour textures\n\n"
        "Original models/textures: Microsoft Rocketbox Avatar Library, MIT.\n"
        f"Original repository revision: {REVISION}.\n\n"
        f"Intermediate archive: {ASSET_URL}\n"
        f"Release tag avatars-1 targets {RELEASE_COMMIT}.\n"
        f"GitHub-reported archive SHA-256: {EXPECTED_ARCHIVE_SHA256}.\n"
        "Only selected ZIP entry ranges were fetched; the complete archive hash was not locally verified.\n"
        "Each fetched JPEG/PNG entry is verified by ZIP CRC32, decoded dimensions/format, and recorded actual SHA-256.\n"
        "JPEG colour images are already lossy derivatives; alpha images remain PNG.\n"
        "Local outputs use LANCZOS resizing (head/shared atlas 1024px; body/opacity 512px) and lossless PNG encoding.\n"
        "The original TGA was not downloaded or locally hash-verified for these derivatives.\n"
        "No UV layout was changed. Standard FBX files remain the separately verified original Microsoft files; facial FBX from this package is not used.\n"
        "Per-image model records preserve canonical source URLs and Git blob identities, with source_sha256=null and complete derivative provenance.\n"
        f"Conversion script reference: https://github.com/openOMSI-org/openOMSI/blob/{BUILDER_COMMIT}/tools/avatars/build_pack.py\n"
        "The script was committed after release; archive CREDITS independently describes the same image conversion.\n"
        "Retain LICENSE.md and CREDITS.md with redistributed images.\n"
    )
    atomic_bytes(OUTPUT / "derivatives/openomsi/README.md", text.encode("utf8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", "--audit", dest="index", type=Path, default=DEFAULT_INDEX,
                        help="Versioned ZIP index by default; optionally supply the original full audit JSON")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--model", action="append", help="Only this audited model; repeat to select several")
    options = parser.parse_args()
    if not 1 <= options.workers <= 24 or not 1 <= options.attempts <= 5:
        parser.error("workers must be 1..24 and attempts 1..5")
    audit = load_index(options.index)
    plan = json.loads((LOGS / "rocketbox-inventory.json").read_text("utf8"))
    if plan["revision"] != REVISION:
        raise ValueError("Unexpected canonical source revision")
    eligible = set(audit["model_ids"])
    if options.model and not set(options.model).issubset(eligible):
        parser.error("--model must name an avatar in the audited 91-person archive")
    models = [m for m in plan["models"] if m["id"] in eligible and (not options.model or m["id"] in options.model)]
    for model in models:
        if not re.fullmatch(r"[A-Za-z0-9_]+", model["id"]):
            raise ValueError("Invalid model directory identifier")
    matches = {(m["model_id"], m["source_path"]): m for m in audit["required_texture_matches"]}
    copy_notices(audit)
    log(f"Audited derived import: {len(models)} models; up to {options.workers} concurrent requests; preserve complete existing records")
    results, failures = [], []
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=options.workers) as pool:
        futures = {pool.submit(prepare_model, model, matches, options.attempts): model["id"] for model in models}
        for future in as_completed(futures):
            model_id = futures[future]
            try:
                result = future.result()
                results.append(result)
                log(f"{len(results) + len(failures)}/{len(models)} {result['status']} {model_id}: {result['textures']} PNG")
            except Exception as exc:
                failures.append({"id": model_id, "error": f"{type(exc).__name__}: {exc}"})
                log(f"{len(results) + len(failures)}/{len(models)} FAILED {model_id}: {type(exc).__name__}: {exc}")
            atomic_json(LOGS / "openomsi-derived-progress.json", {"results": results, "failures": failures, "total": len(models), "seconds": round(time.monotonic() - started, 2), **_counters})
    log(json.dumps({"completed": len(results), "failed": len(failures), "seconds": round(time.monotonic() - started, 2), **_counters}))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
