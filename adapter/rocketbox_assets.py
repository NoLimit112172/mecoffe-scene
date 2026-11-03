"""Prepare all 115 standard human avatars from a pinned MIT Rocketbox tree.

python adapter/rocketbox_assets.py [--inventory-only | --fbx-only] [--workers 6]
Official source downloads stay in ignored logs. Standard FBX is unchanged;
diffuse/opacity TGA becomes PNG (heads/shared face atlases 1024 px, other maps
512 px). Animals, facial duplicate exports, authoring sources and motion packs
are excluded. The published manifest changes atomically only after completion.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import base64
import concurrent.futures
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

REPOSITORY = "https://github.com/microsoft/Microsoft-Rocketbox"
REVISION = "0943055db6ec570bcef9f2c8b41c9e5467c808f9"
RAW = f"https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/{REVISION}/"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend/public/mecoffe/assets3d/rocketbox"
CACHE = ROOT / "logs/asset-library/rocketbox-downloads"
LOGS = ROOT / "logs/asset-library"
SPARSE = LOGS / "rocketbox-sparse"
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_auth_token = ""
_downloaded_bytes = 0
_downloaded_count = 0
_download_started = time.monotonic()
_preferred_source = "cdn"
CDN_HOSTS = ("https://fastly.jsdelivr.net", "https://cdn.jsdelivr.net")
_network_limit = 6
_network_active = 0
_network_condition = threading.Condition()
LABELS = {"Female_Adult_01": "粉色上衣 / 牛仔长裤", "Female_Adult_03": "紫色上衣 / 黑色长裤",
          "Male_Adult_01": "条纹短袖 / 短裤", "Male_Adult_14": "衬衫 / 浅色长裤"}


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, path)


def file_hashes(path: Path) -> tuple[int, str, str]:
    size = path.stat().st_size
    sha256 = hashlib.sha256()
    git = hashlib.sha1(f"blob {size}\0".encode())
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha256.update(block)
            git.update(block)
    return size, sha256.hexdigest(), git.hexdigest()


def verified(path: Path, expected: dict) -> bool:
    return path.is_file() and path.stat().st_size == expected["size"] and file_hashes(path)[2] == expected["sha"]


@contextmanager
def network_slot():
    global _network_active
    with _network_condition:
        while _network_active >= _network_limit:
            _network_condition.wait()
        _network_active += 1
    try:
        yield
    finally:
        with _network_condition:
            _network_active -= 1
            _network_condition.notify_all()


class FixedHostRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the existing GitHub credential to another host.
        raise ValueError("Unexpected Git blob API redirect refused")


def download_api_blob(sha: str, temporary: Path, payload_path: Path) -> None:
    headers = {"User-Agent": "MeCoffe-asset-audit", "Accept-Encoding": "gzip"}
    if _auth_token:
        headers["Authorization"] = "Bearer " + _auth_token
    opener = build_opener(FixedHostRedirect())
    started = time.monotonic()
    request = Request(f"https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/blobs/{sha}", headers=headers)
    compressed = payload_path.with_suffix(".gzip.part")
    with opener.open(request, timeout=40) as response, compressed.open("wb") as stream:
        encoding = response.headers.get("Content-Encoding")
        while block := response.read1(128 * 1024):
            stream.write(block)
            if time.monotonic() - started > 180:
                raise TimeoutError("Blob transfer exceeded 180 second total bound")
    if encoding == "gzip":
        with gzip.open(compressed, "rb") as source, payload_path.open("wb") as target:
            shutil.copyfileobj(source, target, 1024 * 1024)
    else:
        os.replace(compressed, payload_path)
    compressed.unlink(missing_ok=True)
    with payload_path.open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    if payload.get("encoding") != "base64" or payload.get("sha") != sha:
        raise ValueError("Invalid official Git blob response")
    encoded = "".join(payload.pop("content").split())
    with temporary.open("wb") as stream:
        for offset in range(0, len(encoded), 4 * 262144):
            stream.write(base64.b64decode(encoded[offset:offset + 4 * 262144]))
    payload_path.unlink(missing_ok=True)


def download_cdn(path: str, expected: dict, temporary: Path) -> str:
    """Resumable uncredentialed transport; only official Git SHA accepts bytes."""
    global _network_limit
    partial = CACHE / ".ranges" / (expected["sha"] + ".part")
    partial.parent.mkdir(parents=True, exist_ok=True)
    size = expected["size"]
    if partial.exists() and partial.stat().st_size > size:
        partial.unlink()
    started = time.monotonic()
    failed = 0
    last_url = ""
    while (partial.stat().st_size if partial.exists() else 0) < size:
        offset = partial.stat().st_size if partial.exists() else 0
        end = min(size - 1, offset + 2 * 1024 * 1024 - 1)
        last_url = CDN_HOSTS[failed % len(CDN_HOSTS)] + f"/gh/microsoft/Microsoft-Rocketbox@{REVISION}/" + quote(path)
        try:
            # Deliberately no Authorization, cookies or private data on mirrors.
            request = Request(last_url, headers={"User-Agent": "MeCoffe-asset-audit", "Range": f"bytes={offset}-{end}"})
            request_started = time.monotonic()
            with network_slot(), urlopen(request, timeout=30) as response, partial.open("ab") as stream:
                request_started = time.monotonic()
                if response.status != 206 or response.headers.get("Content-Range") != f"bytes {offset}-{end}/{size}":
                    raise ValueError("CDN range response does not match requested official blob size/range")
                received = 0
                while block := response.read1(64 * 1024):
                    received += len(block)
                    if received > end - offset + 1:
                        raise ValueError("CDN range exceeded expected length")
                    stream.write(block)
                    if time.monotonic() - request_started > 45:
                        raise TimeoutError("CDN chunk exceeded 45 seconds; retained received bytes")
                if received != end - offset + 1:
                    raise ValueError("Incomplete CDN range; retained received bytes")
            failed = 0
        except Exception as exc:
            failed += 1
            if isinstance(exc, HTTPError) and (exc.code == 429 or 500 <= exc.code <= 599):
                with _network_condition:
                    _network_limit = max(3, _network_limit // 2)
                    print(f"CDN HTTP {exc.code}; reduced network concurrency to {_network_limit}; backoff {min(30, 2 ** failed)}s", flush=True)
                time.sleep(min(30, 2 ** failed))
            if failed >= 4:
                raise
        if time.monotonic() - started > 600:
            raise TimeoutError("CDN blob exceeded 600 seconds total; received ranges remain cached")
    if not verified(partial, expected):
        partial.unlink()
        raise ValueError("CDN data rejected: official Git blob SHA mismatch")
    os.replace(partial, temporary)
    return last_url


def load_tree() -> dict:
    target = LOGS / "rocketbox-tree.json"
    if target.is_file():
        tree = json.loads(target.read_text(encoding="utf-8-sig"))
    else:
        url = f"https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/{REVISION}?recursive=1"
        with urlopen(Request(url, headers={"User-Agent": "MeCoffe-asset-audit"}), timeout=60) as response:
            tree = json.load(response)
        atomic_json(target, tree)
    if tree.get("truncated") or tree.get("sha") != REVISION:
        raise ValueError("Expected complete official tree at pinned revision")
    return {item["path"]: item for item in tree["tree"] if item["type"] == "blob"}


def texture_kind(path: str) -> str:
    name = Path(path).name.lower()
    if "_head_" in name:
        return "head"
    if "_opacity_" in name:
        return "opacity"
    # This avatar has a shared face/body atlas; retain enough face detail.
    return "atlas" if name == "f204_color.tga" else "body"


def inventory(index: dict) -> dict:
    models = []
    for path, entry in index.items():
        match = re.fullmatch(r"Assets/Avatars/(Adults|Children|Professions)/([^/]+)/Export/\2\.fbx", path, re.I)
        if not match:
            continue
        category, model_id = match.groups()
        folder = path.rsplit("/Export/", 1)[0]
        textures = sorted(name for name in index if name.startswith(folder + "/Textures/")
                          and name.lower().endswith(".tga") and "_color" in Path(name).name.lower())
        models.append({"id": model_id, "label": LABELS.get(model_id, model_id.replace("_", " ")),
                       "human": True, "category": category.lower(),
                       "age_group": "child" if category == "Children" else "adult",
                       "gender": "female" if "Female" in model_id else "male",
                       "fbx_source": path, "source_git_blob": entry["sha"], "fbx_bytes": entry["size"],
                       "textures": [{"source_path": name, "source_git_blob": index[name]["sha"],
                                     "source_bytes": index[name]["size"], "kind": texture_kind(name)} for name in textures]})
    models.sort(key=lambda model: (model["category"], model["id"]))
    files = [index[model["fbx_source"]] for model in models] + [index[item["source_path"]] for model in models for item in model["textures"]]
    unique = {item["sha"]: item for item in files}
    summary = {"independent_humans": len(models), "distinct_fbx_blobs": len({model["source_git_blob"] for model in models}),
               "categories": {category: sum(model["category"] == category for model in models) for category in ("adults", "children", "professions")},
               "fbx_bytes": sum(model["fbx_bytes"] for model in models), "texture_files": sum(len(model["textures"]) for model in models),
               "selected_source_bytes": sum(item["size"] for item in files), "unique_source_blobs": len(unique),
               "unique_source_bytes": sum(item["size"] for item in unique.values()), "runtime_estimated_bytes": [220000000, 350000000],
               "runtime_estimate_basis": "FBX unchanged; body/opacity 512 px, head/shared face atlas 1024 px. Estimate; actual bytes recorded after conversion.",
               "excluded_animal_fbx": sum("/Animals/" in path and path.lower().endswith(".fbx") for path in index),
               "excluded_facial_human_fbx": sum(path.lower().endswith("_facial.fbx") and any("/" + category + "/" in path for category in ("Adults", "Children", "Professions")) for path in index),
               "excluded_animation_fbx": sum("/Animations/" in path and path.lower().endswith(".fbx") for path in index),
               "age_note": "Official folders identify children but do not label older adults separately. All adult/profession models are included; no unsupported elderly census."}
    result = {"schema_version": "mecoffe.rocketbox-inventory.v1", "repository": REPOSITORY, "revision": REVISION, "summary": summary, "models": models}
    atomic_json(LOGS / "rocketbox-inventory.json", result)
    return result


def prepare_sparse(plan: dict) -> None:
    """Fetch selected official blobs in a single compressed Git pack, no clone of assets outside the inventory."""
    if not (SPARSE / ".git").is_dir():
        if SPARSE.exists():
            raise ValueError("Sparse cache exists but is not a Git checkout")
        subprocess.run(["git", "clone", "--no-checkout", "--filter=blob:none", "--single-branch", "--depth", "1",
                        REPOSITORY + ".git", str(SPARSE)], check=True)
    head = subprocess.run(["git", "-C", str(SPARSE), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    if head != REVISION:
        subprocess.run(["git", "-C", str(SPARSE), "fetch", "--depth", "1", "--filter=blob:none", "origin", REVISION], check=True)
    paths = ["LICENSE.md", "README.md"] + [model["fbx_source"] for model in plan["models"]] + [item["source_path"] for model in plan["models"] for item in model["textures"]]
    (SPARSE / ".git/info/sparse-checkout").write_text("\n".join("/" + path for path in paths) + "\n", encoding="utf-8")
    for key, value in [("core.sparseCheckout", "true"), ("core.sparseCheckoutCone", "false")]:
        subprocess.run(["git", "-C", str(SPARSE), "config", key, value], check=True)
    subprocess.run(["git", "-C", str(SPARSE), "checkout", "--detach", REVISION], check=True)
    print(f"Sparse source ready: {len(paths)} selected files at {REVISION}", flush=True)


def download(path: str, expected: dict) -> Path:
    """Disk-backed verified blob cache, at most one download for each Git SHA."""
    global _downloaded_bytes, _downloaded_count
    sha = expected["sha"]
    with _locks_guard:
        lock = _locks.setdefault(sha, threading.Lock())
    target = CACHE / path
    blob = CACHE / ".blobs" / sha
    target.parent.mkdir(parents=True, exist_ok=True)
    blob.parent.mkdir(parents=True, exist_ok=True)
    with lock:
        if verified(target, expected):
            if not blob.exists():
                try:
                    os.link(target, blob)
                except OSError:
                    shutil.copyfile(target, blob)
            return target
        sparse_source = SPARSE / path
        if not blob.exists() and verified(sparse_source, expected):
            try:
                os.link(sparse_source, blob)
            except OSError:
                shutil.copyfile(sparse_source, blob)
        if not verified(blob, expected):
            temporary = blob.with_suffix(".part")
            error = None
            for attempt in range(3):
                try:
                    # Credential stays only in this process, requests only the
                    # fixed official API host, and is never logged or persisted.
                    transport = None
                    if _preferred_source == "cdn" and attempt < 2:
                        transport = download_cdn(path, expected, temporary)
                    elif attempt < 2:
                        payload_path = blob.with_suffix(".json.part")
                        download_api_blob(sha, temporary, payload_path)
                    else:
                        request = Request(RAW + quote(path), headers={"User-Agent": "MeCoffe-asset-audit"})
                        with urlopen(request, timeout=180) as response, temporary.open("wb") as stream:
                            shutil.copyfileobj(response, stream, 1024 * 1024)
                    if not verified(temporary, expected):
                        raise ValueError(f"GitHub tree SHA/size mismatch: {path}")
                    os.replace(temporary, blob)
                    if transport:
                        atomic_json(blob.with_suffix(".transport.json"), {"kind": "cdn-range", "url": transport, "verification": "official pinned Git tree SHA-1 blob and size"})
                    with _locks_guard:
                        _downloaded_count += 1
                        _downloaded_bytes += expected["size"]
                        elapsed = max(1, time.monotonic() - _download_started)
                        print(f"blob {_downloaded_count} {path} verified; new_source_MB={_downloaded_bytes / 1e6:.1f} throughput_MBps={_downloaded_bytes / 1e6 / elapsed:.2f}", flush=True)
                    break
                except Exception as exc:
                    error = exc
                    print(f"retry {attempt + 1}/3 {path}: {exc}", flush=True)
                    time.sleep(attempt + 1)
            else:
                raise RuntimeError(f"Download failed: {path}: {error}")
        target.unlink(missing_ok=True)
        try:
            os.link(blob, target)
        except OSError:
            shutil.copyfile(blob, target)
    return target


def copy_fbx(model: dict, index: dict) -> dict:
    path = model["fbx_source"]
    cached = download(path, index[path])
    with cached.open("rb") as stream:
        if not stream.read(18).startswith(b"Kaydara FBX Binary"):
            raise ValueError(f"Not a binary FBX: {model['id']}")
    local = OUTPUT / model["id"] / (model["id"] + ".fbx")
    local.parent.mkdir(parents=True, exist_ok=True)
    if not verified(local, index[path]):
        temporary = local.with_suffix(".fbx.tmp")
        shutil.copyfile(cached, temporary)
        os.replace(temporary, local)
    size, sha256, _ = file_hashes(local)
    return {key: model[key] for key in ("id", "label", "human", "category", "age_group", "gender")} | {
        "fbx": local.relative_to(OUTPUT).as_posix(), "source_url": RAW + quote(path), "sha256": sha256,
        "source_git_blob": index[path]["sha"], "bytes": size, "textures": []}


def prepare_model(model: dict, index: dict) -> dict:
    from PIL import Image
    result = copy_fbx(model, index)
    for source in model["textures"]:
        path = source["source_path"]
        cached = download(path, index[path])
        kind = texture_kind(path)
        limit = 1024 if kind in ("head", "atlas") else 512
        local = OUTPUT / model["id"] / "Textures" / (Path(path).stem + ".png")
        local.parent.mkdir(parents=True, exist_ok=True)
        temporary = local.with_suffix(".png.tmp")
        with Image.open(cached) as image:
            image.load()
            if image.mode not in ("RGB", "RGBA"):
                raise ValueError(f"Unexpected source texture mode {image.mode}: {path}")
            original_width, original_height = image.size
            image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            image.save(temporary, "PNG", optimize=True)
            with Image.open(temporary) as converted:
                if converted.mode != image.mode or converted.size != image.size or converted.tobytes() != image.tobytes():
                    raise ValueError(f"Lossless PNG encoding verification failed: {path}")
            width, height = image.size
            mode = image.mode
        os.replace(temporary, local)
        source_size, source_hash, _ = file_hashes(cached)
        size, sha256, _ = file_hashes(local)
        result["textures"].append({"source_name": Path(path).name, "path": local.relative_to(OUTPUT).as_posix(), "kind": kind,
            "source_url": RAW + quote(path), "source_sha256": source_hash, "source_git_blob": index[path]["sha"],
            "source_bytes": source_size, "sha256": sha256, "bytes": size,
            "original_width": original_width, "original_height": original_height,
            "width": width, "height": height, "mode": mode,
            "conversion": f"TGA to PNG; longest side <= {limit} px; Pillow LANCZOS; RGB/RGBA and alpha retained"})
        transport_path = CACHE / ".blobs" / (index[path]["sha"] + ".transport.json")
        if transport_path.exists():
            result["textures"][-1]["transport"] = json.loads(transport_path.read_text(encoding="utf-8"))
    atomic_json(LOGS / "rocketbox-model-records" / (model["id"] + ".json"), result)
    return result


def aggregate_records(plan: dict) -> list[dict]:
    """Publish only a complete, hash-checked set; preparation jobs may run separately."""
    models = []
    for expected in plan["models"]:
        record_path = LOGS / "rocketbox-model-records" / (expected["id"] + ".json")
        if not record_path.is_file():
            raise ValueError(f"Cannot publish incomplete library: no complete record for {expected['id']}")
        model = json.loads(record_path.read_text(encoding="utf-8"))
        if model.get("id") != expected["id"] or model.get("source_git_blob") != expected["source_git_blob"]:
            raise ValueError(f"Record does not identify expected official FBX: {expected['id']}")
        actual_names = {item["source_name"].lower() for item in model["textures"]}
        expected_names = {Path(item["source_path"]).name.lower() for item in expected["textures"]}
        if actual_names != expected_names or len(model["textures"]) != len(expected_names):
            raise ValueError(f"Incomplete/duplicate texture set for {model['id']}")
        for record, relative in [(model, model["fbx"])] + [(item, item["path"]) for item in model["textures"]]:
            local = (OUTPUT / relative).resolve()
            if not local.is_relative_to(OUTPUT.resolve()):
                raise ValueError("Runtime path is outside the asset library")
            size, sha256, git = file_hashes(local)
            if size != record["bytes"] or sha256 != record["sha256"]:
                raise ValueError(f"Runtime bytes do not match completed record: {relative}")
            if record is model and git != expected["source_git_blob"]:
                raise ValueError(f"FBX differs from the official pinned Git blob: {model['id']}")
        sources = {Path(item["source_path"]).name.lower(): item for item in expected["textures"]}
        for texture in model["textures"]:
            source = sources[texture["source_name"].lower()]
            if texture.get("source_git_blob") != source["source_git_blob"]:
                raise ValueError(f"Texture provenance does not match official inventory: {model['id']}/{texture['source_name']}")
            if texture.get("source_sha256"):
                cached = CACHE / source["source_path"]
                size, sha256, git = file_hashes(cached)
                if (size, sha256, git) != (source["source_bytes"], texture["source_sha256"], source["source_git_blob"]):
                    raise ValueError(f"Canonical TGA cache verification failed: {model['id']}/{texture['source_name']}")
                texture["source_git_blob_locally_verified"] = True
            elif texture.get("derivative"):
                texture["source_git_blob_locally_verified"] = False
            else:
                raise ValueError(f"Texture has neither canonical hash nor declared derivative provenance: {model['id']}")
        models.append(model)
    return models


def main() -> None:
    global _auth_token, _preferred_source, _network_limit
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--fbx-only", action="store_true")
    parser.add_argument("--models-file", type=Path, help="One official model ID per line; requires --defer-manifest")
    parser.add_argument("--defer-manifest", action="store_true", help="Write completed per-model records only, without publishing a partial manifest")
    parser.add_argument("--aggregate-only", action="store_true", help="Verify and atomically publish all 115 existing completed model records; no new downloads")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--source", choices=("cdn", "sparse", "api"), default="cdn",
                        help="Resumable public CDN ranges verified against GitHub SHA; optional sparse Git pack or authenticated API")
    options = parser.parse_args()
    if not 1 <= options.workers <= 24:
        parser.error("workers must be in 1..24")
    if options.models_file and not options.defer_manifest:
        parser.error("--models-file requires --defer-manifest")
    if options.aggregate_only and (options.models_file or options.fbx_only or options.defer_manifest):
        parser.error("--aggregate-only cannot be combined with partial preparation options")
    index = load_tree()
    plan = inventory(index)
    print(json.dumps(plan["summary"], indent=2), flush=True)
    if options.inventory_only:
        return
    selected = plan["models"]
    if options.models_file:
        wanted = {line.strip() for line in options.models_file.read_text(encoding="utf-8-sig").splitlines() if line.strip()}
        unknown = wanted - {model["id"] for model in selected}
        if unknown:
            raise ValueError(f"Unknown human model IDs: {sorted(unknown)}")
        selected = [model for model in selected if model["id"] in wanted]
    _preferred_source = options.source
    _network_limit = options.workers
    if options.source == "sparse" and not options.fbx_only and not options.aggregate_only:
        prepare_sparse({"models": selected})
    if options.source == "api" and not options.aggregate_only and shutil.which("gh"):
        auth = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=15, check=False)
        if auth.returncode == 0:
            _auth_token = auth.stdout.strip()
        del auth
    OUTPUT.mkdir(parents=True, exist_ok=True)
    models = []
    action = copy_fbx if options.fbx_only else prepare_model
    errors = []
    if not options.aggregate_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=options.workers) as pool:
            futures = {pool.submit(action, model, index): model["id"] for model in selected}
            for future in concurrent.futures.as_completed(futures):
                try:
                    result = future.result()
                    models.append(result)
                    print(f"verified {len(models)}/{len(selected)} {result['id']} ({len(result['textures'])} PNG)", flush=True)
                except Exception as exc:
                    errors.append({"id": futures[future], "error": str(exc)})
                    print(f"FAILED {futures[future]}: {exc}", flush=True)
        if errors:
            atomic_json(LOGS / "rocketbox-preparation-errors.json", errors)
            raise RuntimeError(f"{len(errors)} model preparation errors; completed files retained, manifest unchanged")
    if options.fbx_only:
        print("All standard human FBX verified; runtime manifest remains unchanged.", flush=True)
        return
    if options.defer_manifest:
        print(f"{len(models)} completed model records saved; manifest deliberately unchanged.", flush=True)
        return
    models = aggregate_records(plan)
    order = {model["id"]: i for i, model in enumerate(plan["models"])}
    models.sort(key=lambda model: order[model["id"]])
    manifest = {
        "schema_version": "mecoffe.rocketbox-assets.v1", "repository": REPOSITORY, "revision": REVISION,
        "license": "MIT", "license_file": "LICENSE.md",
        "license_basis": "Pinned official root LICENSE.md and README MIT license update; standard human models and diffuse textures only. No animations, animals, facial duplicate exports or authoring sources are included.",
        "attribution": "Microsoft Rocketbox Avatar Library; original avatar creation Rocketbox / Markus Wojcik; contributors listed in UPSTREAM_README.md.",
        "runtime_base": "/mecoffe/assets3d/rocketbox/",
        "preparation": "Original standard human FBX preserved byte-for-byte. All diffuse/opacity colour TGA maps converted to PNG: head/shared face atlas <=1024 px, body/equipment/opacity <=512 px, Pillow LANCZOS, RGB/RGBA and alpha retained. Source TGA stays in ignored verified disk cache. Normal/specular maps and animations are not bundled.",
        "inventory": plan["summary"], "source_files": [], "models": models}
    for remote, local in [("LICENSE.md", "LICENSE.md"), ("README.md", "UPSTREAM_README.md")]:
        cached = CACHE / remote if options.aggregate_only else download(remote, index[remote])
        if not verified(cached, index[remote]):
            raise ValueError(f"Missing verified license/README cache: {remote}")
        shutil.copyfile(cached, OUTPUT / local)
        size, sha256, _ = file_hashes(cached)
        manifest["source_files"].append({"path": local, "source_url": RAW + remote, "sha256": sha256, "bytes": size})
    derived = [texture for model in models for texture in model["textures"] if texture.get("derivative")]
    manifest["texture_provenance_counts"] = {"canonical_tga_verified": sum(bool(texture.get("source_sha256")) for model in models for texture in model["textures"]), "derived_image": len(derived)}
    if derived:
        audit_path = LOGS / "openomsi-avatars-audit.json"
        if not audit_path.is_file():
            audit_path = ROOT / "adapter/resources/rocketbox-openomsi-index.json"
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        manifest["preparation"] = "All standard FBX is original Rocketbox, independently verified against the pinned Git blob SHA. Textures marked source_sha256 are converted from locally verified official TGA. Textures marked derivative are openOMSI MIT JPEG/PNG conversions (JPEG is already lossy), verified by ZIP entry CRC and image SHA-256, then resized locally. Their source_sha256 is null: original TGA was not fetched or locally verified for that entry. Runtime PNG uses <=1024 px for heads/shared face atlases and <=512 px for other maps, Pillow LANCZOS; alpha retained. No derivative FBX, normal/specular maps or motions are bundled."
        manifest["derivative_package"] = {key: audit[key] for key in ("release_url", "release_tag_commit", "builder_commit", "builder_url", "release_sha256_from_GitHub_metadata", "release_sha256_locally_verified")}
        manifest["derivative_package"]["verification"] = "Selected ZIP entries fetched by byte range and CRC checked; the complete upstream release ZIP digest is metadata only, not a locally verified full archive hash."
        for name, archive_name in [("derivatives/openomsi/LICENSE.md", "LICENSE.md"), ("derivatives/openomsi/CREDITS.md", "CREDITS.md"), ("derivatives/openomsi/README.md", None)]:
            local = OUTPUT / name
            if not local.is_file():
                raise ValueError(f"Missing derivative redistribution notice: {name}")
            size, sha256, _ = file_hashes(local)
            metadata = {"path": name, "source_url": audit["release_url"] if archive_name else audit["builder_url"], "sha256": sha256, "bytes": size}
            if archive_name:
                metadata["archive_entry"] = archive_name
            else:
                metadata["generated"] = True
                metadata["description"] = "Local provenance note documenting the pinned upstream conversion pipeline"
            manifest["source_files"].append(metadata)
    diagnostics_path = LOGS / "rocketbox-diagnostics.json"
    if diagnostics_path.is_file():
        diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
        lookup = {item["id"]: item for item in diagnostics["models"]}
        for model in models:
            if model["id"] in lookup:
                item = lookup[model["id"]]
                model["diagnostics"] = {"parser": f"Three.js FBXLoader r{diagnostics['three_revision']}", "bounds": item["bounds"],
                    "bone_names": [bone["name"] for bone in item["bones"]],
                    "lods": [{"name": mesh["name"], "triangles": mesh["triangles"], "vertices": mesh["vertices"], "bone_count": mesh["boneCount"], "uv_count": mesh["uvCount"], "max_weight_error": mesh["maxWeightError"]} for mesh in item["meshes"]],
                    "embedded_animations": item["animations"]}
    manifest["runtime_bytes"] = sum(model["bytes"] + sum(texture["bytes"] for texture in model["textures"]) for model in models)
    atomic_json(OUTPUT / "manifest.json", manifest)
    print(json.dumps({"models": len(models), "textures": sum(len(model["textures"]) for model in models), "runtime_bytes": manifest["runtime_bytes"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
