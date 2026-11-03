"""Fetch four explicitly selected MIT Rocketbox avatars, never the full repo.

Run from the repository root: python adapter/rocketbox_assets.py
Pillow is required only for TGA -> 1024 px PNG conversion during asset prep.
Original downloads remain in ignored logs; runtime assets retain hashes and URL
provenance in manifest.json. No animations or third-party motion packs are used.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

REPOSITORY = "https://github.com/microsoft/Microsoft-Rocketbox"
REVISION = "0943055db6ec570bcef9f2c8b41c9e5467c808f9"
RAW = f"https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/{REVISION}/"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend/public/mecoffe/assets3d/rocketbox"
CACHE = ROOT / "logs/asset-library/rocketbox-downloads"
SELECTED = [
    ("Female_Adult_01", "粉色上衣 / 牛仔长裤", "female"),
    ("Female_Adult_03", "紫色上衣 / 黑色长裤", "female"),
    ("Male_Adult_01", "条纹短袖 / 短裤", "male"),
    ("Male_Adult_14", "衬衫 / 浅色长裤", "male"),
]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def download(path: str, expected: dict | None = None) -> tuple[bytes, str]:
    target = CACHE / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file():
        data = target.read_bytes()
        if expected is None or blob_sha(data) == expected["sha"]:
            return data, RAW + path
    error = None
    for attempt in range(4):
        try:
            with urlopen(Request(RAW + path, headers={"User-Agent": "MeCoffe-asset-audit"}), timeout=120) as response:
                data = response.read()
            if expected and (len(data) != expected["size"] or blob_sha(data) != expected["sha"]):
                raise ValueError(f"GitHub tree hash/size mismatch: {path}")
            target.write_bytes(data)
            return data, RAW + path
        except Exception as exc:
            error = exc
            time.sleep(attempt + 1)
    raise RuntimeError(f"Download failed: {path}: {error}")


def main() -> None:
    from PIL import Image

    OUTPUT.mkdir(parents=True, exist_ok=True)
    tree_path = ROOT / "logs/asset-library/rocketbox-tree.json"
    if tree_path.is_file():
        tree = json.loads(tree_path.read_text(encoding="utf-8-sig"))
    else:
        url = f"https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/{REVISION}?recursive=1"
        with urlopen(Request(url, headers={"User-Agent": "MeCoffe-asset-audit"})) as response:
            tree = json.load(response)
        tree_path.parent.mkdir(parents=True, exist_ok=True)
        tree_path.write_text(json.dumps(tree, indent=2), encoding="utf-8")
    if tree.get("truncated"):
        raise ValueError("GitHub tree is truncated")
    index = {item["path"]: item for item in tree["tree"] if item["type"] == "blob"}
    files = ["LICENSE.md", "README.md"]
    for model_id, _, _ in SELECTED:
        folder = f"Assets/Avatars/Adults/{model_id}"
        files.append(f"{folder}/Export/{model_id}.fbx")
        files.extend(path for path in index if path.startswith(folder + "/Textures/") and path.endswith("_color.tga"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {path: pool.submit(download, path, index[path]) for path in files}
        downloads = {}
        for path, future in futures.items():
            downloads[path] = future.result()
            print(f"verified {path} ({len(downloads[path][0]):,} bytes)", flush=True)
    manifest = {
        "schema_version": "mecoffe.rocketbox-assets.v1",
        "repository": REPOSITORY,
        "revision": REVISION,
        "license": "MIT",
        "license_file": "LICENSE.md",
        "license_basis": "Pinned official root LICENSE.md and README MIT license update; the repository tree contains no separate avatar/animation license. No animations are included.",
        "attribution": "Microsoft Rocketbox Avatar Library; original avatar creation Rocketbox / Markus Wojcik; contributors listed in UPSTREAM_README.md.",
        "runtime_base": "/mecoffe/assets3d/rocketbox/",
        "preparation": "Original non-facial FBX preserved byte-for-byte. Only diffuse/opacity colour TGA textures are converted to PNG, longest side limited to 1024 pixels with Pillow LANCZOS; RGB/RGBA mode and alpha channel retained. Original TGA bytes remain in ignored cache, their source hashes are recorded. Normal/specular maps and animations are not bundled.",
        "source_files": [],
        "models": [],
    }
    for remote, local in [("LICENSE.md", "LICENSE.md"), ("README.md", "UPSTREAM_README.md")]:
        data, url = downloads[remote]
        (OUTPUT / local).write_bytes(data)
        manifest["source_files"].append({"path": local, "source_url": url, "sha256": digest(data), "bytes": len(data)})
    for model_id, label, gender in SELECTED:
        folder = f"Assets/Avatars/Adults/{model_id}"
        remote = f"{folder}/Export/{model_id}.fbx"
        data, url = downloads[remote]
        if not data.startswith(b"Kaydara FBX Binary"):
            raise ValueError(f"Expected binary FBX, not a Git LFS pointer: {model_id}")
        model_dir = OUTPUT / model_id
        texture_dir = model_dir / "Textures"
        texture_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / f"{model_id}.fbx").write_bytes(data)
        model = {"id": model_id, "label": label, "gender": gender,
                 "fbx": f"{model_id}/{model_id}.fbx", "source_url": url,
                 "sha256": digest(data), "source_git_blob": index[remote]["sha"],
                 "bytes": len(data), "textures": []}
        for path in files:
            if not path.startswith(folder + "/Textures/"):
                continue
            original, source_url = downloads[path]
            basename = Path(path).name
            local = texture_dir / (Path(path).stem + ".png")
            with Image.open(CACHE / path) as image:
                # The web trial uses 1024 px textures; full source stays cached.
                image.load()
                if image.mode not in ("RGB", "RGBA"):
                    raise ValueError(f"Unexpected source texture mode {image.mode}: {path}")
                original_width, original_height = image.size
                runtime = image.copy()
                runtime.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                runtime.save(local, "PNG", optimize=True)
                with Image.open(local) as converted:
                    if converted.mode != runtime.mode or converted.size != runtime.size or converted.tobytes() != runtime.tobytes():
                        raise ValueError(f"PNG re-encoding failed: {path}")
                width, height = runtime.size
                mode = runtime.mode
            final = local.read_bytes()
            model["textures"].append({"source_name": basename, "path": local.relative_to(OUTPUT).as_posix(),
                "kind": "opacity" if "_opacity_" in basename else "head" if "_head_" in basename else "body",
                "source_url": source_url, "source_sha256": digest(original), "source_git_blob": index[path]["sha"],
                "source_bytes": len(original), "sha256": digest(final), "bytes": len(final),
                "original_width": original_width, "original_height": original_height,
                "width": width, "height": height, "mode": mode,
                "conversion": "TGA to PNG; longest side <= 1024 px; Pillow LANCZOS; RGB/RGBA and alpha retained"})
        manifest["models"].append(model)
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"models": len(manifest["models"]), "textures": sum(len(m["textures"]) for m in manifest["models"]),
                      "runtime_bytes": sum(p.stat().st_size for p in OUTPUT.rglob("*") if p.is_file())}, indent=2), flush=True)


if __name__ == "__main__":
    main()
