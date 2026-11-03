"""Verify bundled campus assets, or restore them from already downloaded files.

No network or model execution. Author URLs, revisions and hashes live beside
the assets in their versioned manifests; the original licences are preserved.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent / 'frontend/public/mecoffe/assets3d'


def verify_file(content, record, git_blob=False):
    if len(content) != record['bytes'] or hashlib.sha256(content).hexdigest() != record['sha256']:
        raise ValueError(f"素材大小或 SHA-256 不符: {record['id']}")
    if git_blob and hashlib.sha1(f'blob {len(content)}\0'.encode()+content).hexdigest() != record['source_git_blob']:
        raise ValueError(f"上游 Git blob 不符: {record['id']}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nature-zip', type=Path, help='Kenney Nature Kit 2.1 原始 ZIP')
    parser.add_argument('--valid-dir', type=Path, help='已下载的 VALID 文件目录，可为原始仓库根目录')
    args = parser.parse_args(argv)
    for library in ['kenney', 'valid']:
        folder = ROOT/library
        manifest = json.loads((folder/'manifest.json').read_text(encoding='utf8'))
        if library == 'kenney' and args.nature_zip:
            data=args.nature_zip.read_bytes()
            if hashlib.sha256(data).hexdigest()!=manifest['archive_sha256']:
                raise ValueError('Kenney 原始包 SHA-256 不符，未覆盖任何素材')
            with zipfile.ZipFile(args.nature_zip) as archive:
                for model in manifest['models']:
                    content=archive.read(model['archive_entry']);verify_file(content,model)
                    (folder/model['file']).write_bytes(content)
        for model in manifest['models']:
            name=model.get('fbx') or model['file']
            if library=='valid' and args.valid_dir:
                source=args.valid_dir/name
                if not source.exists():source=args.valid_dir/'Avatars/Asian'/name
                content=source.read_bytes();verify_file(content,model,True)
                if source.resolve()!=(folder/name).resolve():(folder/name).write_bytes(content)
            verify_file((folder/name).read_bytes(),model,library=='valid')
        licence=(folder/manifest['license_file']).read_text(encoding='utf8')
        if ('Creative Commons Zero' if library=='kenney' else 'Tiffany Do') not in licence:
            raise ValueError(f'{library} 许可文件缺失或不符')
        print(f"{library}: {len(manifest['models'])} models verified")
    return 0


if __name__=='__main__':
    raise SystemExit(main())
