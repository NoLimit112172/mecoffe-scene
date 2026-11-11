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
        formal=manifest.get('schema_version')=='scene.map-manifest.v1'
        if formal:
            from adapter.scene_builder.asset_library import published_asset_library
            descriptor,_=published_asset_library()
            require(manifest.get('asset_library_version')==descriptor['version'] and manifest.get('catalog_sha256')==descriptor['catalog_sha256'],
                    'ASSET_VERSION_MISMATCH','地图 catalog 与登记发布版不一致')
            require(all(name in {'campus3d.json','entrances.json','landcover.json','asset_assignments.json','quality.json','surroundings.json','evidence-rules.json','ai-evidence.json',
                                 *[f'gis/{layer}.geojson' for layer in ('buildings','roads','landcover','water','boundary','pois','entrances')]}
                        for name in manifest.get('files',{})),'INVALID_MAP','地图文件清单包含无效路径')
        for name in manifest.get('files',{}) if formal else ('campus3d.json', 'entrances.json', 'landcover.json'):
            expected = manifest.get('files', {}).get(name)
            if expected:
                require(hashlib.sha256((path/name).read_bytes()).hexdigest() == expected,
                        'REF_MISMATCH', f'Archived file hash mismatch: {name}')
        package = {'schema_version':'scene.map.v1',
                   'map_ref': {'map_id': manifest.get('map_id',manifest.get('id', manifest.get('campus_id'))),
                               'map_version': str(manifest.get('map_version', '1')),
                               'manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest()},
                   'campus':read_json(path/'campus3d.json'),
                   'entrances':read_json(path/'entrances.json'),
                   'landcover':read_json(path/'landcover.json')}
        if formal:
            package['quality']=read_json(path/'quality.json')
            package['annotations']={'map_ref':copy.deepcopy(package['map_ref']),'buildings':{
                b['osm_id']:copy.deepcopy(b['function_annotation']) for b in package['campus']['buildings'] if b.get('function_annotation')}}
            policy=manifest.get('evidence_policy')
            if policy is not None:
                from .auto_evidence import validate_rules, validate_ai_file
                require(isinstance(policy,dict) and 'evidence-rules.json' in manifest['files'],
                        'INVALID_EVIDENCE_RULES','Automatic map needs its frozen rules file')
                rules=validate_rules(read_json(path/'evidence-rules.json'))
                require(policy.get('version')==rules['version'] and policy.get('sha256')==rules['sha256'] and
                        policy.get('ai_min_confidence_pct')==rules['ai_min_confidence_pct'] and isinstance(policy.get('input_map_ref'),dict),
                        'INVALID_EVIDENCE_RULES','Manifest policy differs from frozen rules')
                package['evidence_rules']=rules;package['evidence_input_ref']=copy.deepcopy(policy['input_map_ref'])
                package['evidence_frozen']=True
                if 'ai-evidence.json' in manifest['files']:
                    raw=(path/'ai-evidence.json').read_bytes()
                    require(policy.get('ai_evidence_sha256')==hashlib.sha256(raw).hexdigest(),
                            'REF_MISMATCH','AI original bytes differ from manifest policy')
                    package['ai_evidence']=validate_ai_file(read_json(path/'ai-evidence.json'),package['evidence_input_ref'],
                                                          [b['osm_id'] for b in package['campus']['buildings']])
                else:
                    require('ai_evidence_sha256' not in policy,'REF_MISMATCH','Frozen AI input is missing')
            else:
                require(not {'evidence-rules.json','ai-evidence.json'} & set(manifest.get('files',{})),
                        'INVALID_EVIDENCE_RULES','Automatic files need explicit policy metadata')
    require(isinstance(package, dict) and isinstance(package.get('campus'), dict), 'INVALID_MAP', 'Expected a local scene.map.v1 package or prepared map directory')
    require(isinstance(package.get('map_ref'), dict), 'REF_MISMATCH', 'Map reference is required')
    return copy.deepcopy(package)
