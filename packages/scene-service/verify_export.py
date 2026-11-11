"""Verify an unmodified delivery directory before installation. Standard library only."""
import hashlib
import json
from pathlib import Path
import sys

def verify(root):
    root=Path(root)
    manifest=json.loads((root/'EXPORT_MANIFEST.json').read_text(encoding='utf-8'))
    if manifest.get('schema_version')!='scene.service-export.v1':
        raise ValueError('Unknown export manifest')
    expected=manifest['files']
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    if actual!=set(expected)|{'EXPORT_MANIFEST.json'}:
        raise ValueError('Export file set differs: missing='+str(sorted(set(expected)-actual))+
                         ', extra='+str(sorted(actual-set(expected)-{'EXPORT_MANIFEST.json'})))
    for name,digest in expected.items():
        relative=Path(name)
        if relative.is_absolute() or '..' in relative.parts or relative.as_posix()!=name:
            raise ValueError('Invalid manifest path')
        path=root/relative
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise ValueError('Export bytes differ: '+name)
    return {'ok':True,'version':manifest['package']['version'],'files':len(expected),
            'source_commit':manifest['source_commit']}

if __name__=='__main__':
    try:
        print(json.dumps(verify(Path(__file__).resolve().parent),ensure_ascii=False))
    except (OSError,ValueError,KeyError,TypeError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
