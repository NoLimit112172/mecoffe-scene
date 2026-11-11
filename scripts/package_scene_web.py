"""Split the canonical embed output and include all published M15 maps."""

import argparse
import json
from pathlib import Path
import re

from scene_split_manifest import VERSION, require_published_catalog, sha256_file, write_artifact


ASSETS = 'mecoffe/assets3d/'
CATALOG = f'{ASSETS}catalog.json'
LEGACY_MAP = 'mecoffe/config-map/'
MAP_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}')
ATLASES = {f'assets/bgrd-{index}.{ext}' for index in range(3) for ext in ('json', 'png')}
DISPLAY_FILES = {
    'index.html', '404.html', 'favicon.svg', 'mecoffe3d/index.html',
    'mecoffe3d/assets/index.html', 'mecoffe-gis/index.html', 'licenses/index.html',
    'licenses/NOTICE.md', 'licenses/MapLibre-BSD-3-Clause.txt',
    'licenses/MapLibre-Dependencies.txt', 'licenses/Three-MIT.txt', 'licenses/YuLan-Apache-2.0.txt',
}
COMPILED_ASSET = re.compile(r'assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2|ttf)')
GIS_FILES = {
    f'gis/{layer}.geojson'
    for layer in ('buildings', 'roads', 'landcover', 'water', 'boundary', 'pois', 'entrances')
}
CORE_MAP_FILES = GIS_FILES | {'campus3d.json', 'asset_assignments.json', 'landcover.json', 'entrances.json'}


def file_tree(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f'Expected a real directory: {root}')
    files = {}
    for path in root.rglob('*'):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError(f'Unsupported file type: {path}')
        if path.is_file():
            files[path.relative_to(root).as_posix()] = path
    return files


def read_object(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'Expected a JSON object: {path}')
    return value


def require_files(files, expected, label):
    missing = expected - files.keys()
    if missing:
        raise ValueError(f'{label} is missing: {", ".join(sorted(missing))}')


def verify_checksums(files, checksums):
    for name, expected in checksums.items():
        if sha256_file(files[name]) != expected:
            raise ValueError(f'SHA-256 mismatch: {files[name]}')


def models_for(files):
    catalog = read_object(files[CATALOG])
    prototypes = catalog.get('prototypes')
    if catalog.get('schema_version') != 'mecoffe.asset-catalog.v1' or not prototypes:
        raise ValueError('Expected the published asset catalog from build:embed')
    model_files = ATLASES | {CATALOG}
    model_ids = {'kenney': set(), 'valid': set()}
    for item in prototypes:
        source_type = item['source']['type']
        params = item['params']
        preview = item['preview']
        if source_type == 'rocketbox' or params.get('person_id'):
            raise ValueError('The published catalog includes a non-public prototype')
        if not re.fullmatch(r'/scene/mecoffe/assets3d/previews/[A-Za-z0-9_.-]+\.svg', preview):
            raise ValueError(f'Unexpected published preview path: {preview}')
        model_files.add(preview.removeprefix('/scene/'))
        if source_type in model_ids and params.get('model_id'):
            model_ids[source_type].add(params['model_id'])

    for library, ids in model_ids.items():
        prefix = f'{ASSETS}{library}/'
        manifest_name = f'{prefix}manifest.json'
        manifest = read_object(files[manifest_name])
        if manifest.get('runtime_base') != f'/scene/{prefix}':
            raise ValueError(f'Unexpected {library} runtime base')
        model_files.update((manifest_name, library_file(prefix, manifest['license_file'])))
        checksums = {}
        for model in manifest['models']:
            if model['id'] not in ids:
                continue
            model_path = library_file(prefix, model.get('fbx') or model['file'])
            checksums[model_path] = model['sha256']
            if model.get('glb'):
                checksums[library_file(prefix, model['glb'])] = model['glb_sha256']
            ids.remove(model['id'])
        if ids:
            raise ValueError(f'Published {library} models missing from the manifest: {sorted(ids)}')
        require_files(files, checksums.keys(), f'{library} library')
        verify_checksums(files, checksums)
        model_files.update(checksums)
    return model_files


def library_file(prefix, name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
        raise ValueError(f'Unexpected library file name: {name}')
    return prefix + name


def partition_embed(embed_dir):
    files = file_tree(embed_dir)
    legacy_files = CORE_MAP_FILES | {'surroundings.json'}
    legacy_paths = {LEGACY_MAP + name for name in legacy_files | {'scenario.json'}}
    require_files(files, DISPLAY_FILES | legacy_paths | ATLASES | {CATALOG}, 'Embed output')
    if b'/scene/assets/' not in files['index.html'].read_bytes():
        raise ValueError('Embed entrypoint does not use the /scene/ asset base')
    legacy = read_object(files[f'{LEGACY_MAP}scenario.json'])
    if (legacy.get('schema_version') != 'mecoffe.scenario.v1'
            or legacy.get('id') != 'ustc-config-map' or legacy.get('simulation_data') is not False
            or not isinstance(legacy.get('files'), dict) or legacy['files'].keys() != legacy_files):
        raise ValueError('Unexpected legacy scenario.json')
    verify_checksums(files, {LEGACY_MAP + name: value for name, value in legacy['files'].items()})
    groups = {
        'display': DISPLAY_FILES | {name for name in files if COMPILED_ASSET.fullmatch(name)},
        'model-library': models_for(files),
        'map-library': legacy_paths,
    }
    allocated = set().union(*groups.values())
    if len(allocated) != sum(map(len, groups.values())):
        raise ValueError('A canonical embed path belongs to multiple artifacts')
    require_files(files, allocated, 'Embed output')
    if extra := files.keys() - allocated:
        raise ValueError(f'Unexpected embed paths: {", ".join(sorted(extra))}')
    return {kind: {f'scene/{name}': files[name] for name in names} for kind, names in groups.items()}


def validate_map(root, published):
    files = file_tree(root)
    required = CORE_MAP_FILES | {'quality.json'}
    require_files(files, required | {'manifest.json'}, 'Versioned map')
    manifest_path = files['manifest.json']
    manifest = read_object(manifest_path)
    map_id, map_version = root.parent.name, root.name
    if (manifest.get('schema_version') != 'scene.map-manifest.v1'
            or not MAP_ID.fullmatch(map_id) or not MAP_ID.fullmatch(map_version)
            or manifest.get('map_id') != map_id or manifest.get('map_version') != map_version
            or not isinstance(manifest.get('title'), str) or not manifest['title'].strip()):
        raise ValueError(f'Versioned map identity must match its directory: {map_id}/{map_version}')
    if (manifest.get('asset_library_version') != published['version']
            or manifest.get('catalog_sha256') != published['catalog_sha256']):
        raise ValueError('Versioned map must reference the exact published asset catalog')
    checksums = manifest.get('files')
    if (not isinstance(checksums, dict) or not required <= checksums.keys() <= required | {'surroundings.json'}
            or files.keys() != checksums.keys() | {'manifest.json'}):
        raise ValueError('Unexpected or missing versioned map file')
    verify_checksums(files, checksums)
    if read_object(files['quality.json']).get('status') != 'ready':
        raise ValueError('Versioned map quality must be ready')
    if (not read_object(files['campus3d.json']).get('buildings')
            or read_object(files['entrances.json']).get('schema_version') != 'mecoffe.entrances.v1'):
        raise ValueError('Versioned map must include buildings and a valid entrance list')
    map_ref = {'map_id': manifest['map_id'], 'map_version': manifest['map_version'],
               'manifest_sha256': sha256_file(manifest_path)}
    prefix = f'scene-maps/{map_id}/{map_version}/'
    return {prefix + name: path for name, path in files.items()}, map_ref


def collect_versioned_maps(root, published):
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f'Expected a real maps directory: {root}')
    files, map_refs = {}, []
    for map_dir in sorted(root.iterdir()):
        if map_dir.is_symlink():
            raise ValueError(f'Unsupported map path: {map_dir}')
        if not map_dir.is_dir():
            continue
        for version_dir in sorted(map_dir.iterdir()):
            if version_dir.is_symlink():
                raise ValueError(f'Unsupported map path: {version_dir}')
            if not version_dir.is_dir():
                continue
            version_files, map_ref = validate_map(version_dir, published)
            files.update(version_files)
            map_refs.append(map_ref)
    if not map_refs:
        raise ValueError(f'No published map versions found: {root}')
    return files, map_refs


def package_web(embed_dir, maps_dir, output_dir, source_commit):
    if any(output_dir.resolve().is_relative_to(source.resolve()) for source in (embed_dir, maps_dir)):
        raise ValueError('Output directory must be outside embed and map input directories')
    groups = partition_embed(embed_dir)
    published = require_published_catalog(groups['model-library'][f'scene/{CATALOG}'])
    versioned_maps, map_refs = collect_versioned_maps(maps_dir, published)
    legacy_sha256 = sha256_file(groups['map-library'][f'scene/{LEGACY_MAP}scenario.json'])
    groups['map-library'].update(versioned_maps)
    catalog_metadata = {'asset_library_version': published['version'], 'catalog_sha256': published['catalog_sha256']}
    model_dependency = {'model-library': {'version': VERSION, **catalog_metadata}}
    display, models, maps = (groups[kind] for kind in ('display', 'model-library', 'map-library'))
    notice = {'NOTICE.md': display['scene/licenses/NOTICE.md']}
    return [
        write_artifact(output_dir, 'display', source_commit, display,
                       requires={**model_dependency, 'map-library': {'version': VERSION}},
                       extra_metadata=catalog_metadata),
        write_artifact(output_dir, 'model-library', source_commit, models,
                       extra_metadata=catalog_metadata,
                       notices={**notice, 'YuLan-Apache-2.0.txt': display['scene/licenses/YuLan-Apache-2.0.txt']}),
        write_artifact(output_dir, 'map-library', source_commit, maps, requires=model_dependency,
                       extra_metadata={**catalog_metadata, 'map_refs': map_refs,
                                       'legacy_scenario_sha256': legacy_sha256}, notices=notice),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--embed-dir', type=Path, required=True)
    parser.add_argument('--maps-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    args = parser.parse_args()
    try:
        artifacts = package_web(args.embed_dir, args.maps_dir, args.output_dir, args.source_commit)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'{parser.prog}: {error}\n')
    for path in artifacts:
        print(path)


if __name__ == '__main__':
    main()
