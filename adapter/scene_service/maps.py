"""Read local geometry only. This module never imports a download function."""
import copy
import hashlib
from pathlib import Path

from .common import read_json, require


def load_map(path):
    path = Path(path)
    if path.is_file():
        package = read_json(path)
    else:
        manifest_path = path / 'scenario.json'
        if not manifest_path.is_file():
            manifest_path = path / 'manifest.json'
        manifest = read_json(manifest_path)
        for name in ('campus3d.json', 'entrances.json', 'landcover.json'):
            expected = manifest.get('files', {}).get(name)
            if expected:
                require(hashlib.sha256((path/name).read_bytes()).hexdigest() == expected,
                        'REF_MISMATCH', f'Archived file hash mismatch: {name}')
        package = {'schema_version':'scene.map.v1',
                   'map_ref': {'map_id': manifest.get('id', manifest.get('campus_id')),
                               'map_version': str(manifest.get('map_version', '1')),
                               'manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest()},
                   'campus':read_json(path/'campus3d.json'),
                   'entrances':read_json(path/'entrances.json'),
                   'landcover':read_json(path/'landcover.json')}
    require(isinstance(package, dict) and isinstance(package.get('campus'), dict), 'INVALID_MAP', 'Expected a local scene.map.v1 package or prepared map directory')
    require(isinstance(package.get('map_ref'), dict), 'REF_MISMATCH', 'Map reference is required')
    return copy.deepcopy(package)
