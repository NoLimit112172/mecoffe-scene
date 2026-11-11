"""Check split payload ownership and compatibility guards."""

import hashlib
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from package_scene_web import (ASSETS, ATLASES, CATALOG, CORE_MAP_FILES, DISPLAY_FILES,
                               LEGACY_MAP, collect_versioned_maps, file_tree, package_web, partition_embed)
from scene_split_manifest import ASSET_DIRECTORY, VERSION, require_published_catalog


def write_file(root, relative, data):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else (json.dumps(data) + '\r\n').encode())
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PackageSceneWebTests(unittest.TestCase):
    def setUp(self):
        work = TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.embed = Path(work.name) / 'embed'
        self.maps = Path(work.name) / 'maps'
        self.map = self.maps / 'ustc-gaoxin/1'
        self.output = Path(work.name) / 'release'
        for name in DISPLAY_FILES | ATLASES:
            write_file(self.embed, name, b'/scene/assets/index-1234abcd.js\r\n')
        write_file(self.embed, 'assets/index-1234abcd.js', b'export {}\r\n')
        write_file(self.embed, f'{ASSETS}previews/plant.svg', b'<svg/>\r\n')
        for library in ('kenney', 'valid'):
            prefix = f'{ASSETS}{library}/'
            write_file(self.embed, f'{prefix}License.txt', b'License text\r\n')
            model_sha = write_file(self.embed, f'{prefix}model.glb', b'Model bytes\r\n')
            write_file(self.embed, f'{prefix}manifest.json', {'runtime_base': f'/scene/{prefix}',
                       'license_file': 'License.txt',
                       'models': [{'id': 'model', 'file': 'model.glb', 'sha256': model_sha}]})
        self.catalog_sha = write_file(self.embed, CATALOG, {
            'schema_version': 'mecoffe.asset-catalog.v1',
            'prototypes': [{'source': {'type': library}, 'params': {'model_id': 'model'},
                            'preview': f'/scene/{ASSETS}previews/plant.svg'} for library in ('kenney', 'valid')],
        })
        legacy_hashes = {name: write_file(self.embed, LEGACY_MAP + name, {})
                         for name in CORE_MAP_FILES | {'surroundings.json'}}
        self.legacy_sha = write_file(self.embed, LEGACY_MAP + 'scenario.json', {
            'schema_version': 'mecoffe.scenario.v1', 'id': 'ustc-config-map', 'simulation_data': False,
            'files': legacy_hashes,
        })
        values = {'campus3d.json': {'buildings': [{}]},
                  'entrances.json': {'schema_version': 'mecoffe.entrances.v1'},
                  'quality.json': {'status': 'ready'}}
        map_hashes = {name: write_file(self.map, name, values.get(name, {}))
                      for name in CORE_MAP_FILES | {'quality.json'}}
        self.published = {'version': 'mecoffe-embed-v1', 'catalog_sha256': self.catalog_sha}
        self.manifest = {'schema_version': 'scene.map-manifest.v1', 'map_id': 'ustc-gaoxin', 'map_version': '1',
                         'title': '中科大', 'asset_library_version': self.published['version'],
                         'catalog_sha256': self.catalog_sha,
                         'files': map_hashes}
        self.map_sha = write_file(self.map, 'manifest.json', self.manifest)

    def package_fixture(self):
        with patch('package_scene_web.require_published_catalog', return_value=self.published) as require:
            artifacts = package_web(self.embed, self.maps, self.output, 'a' * 40)
            require.assert_called_once_with(self.embed / CATALOG)
            return artifacts

    def test_archive_payloads_cover_embed_bytes_and_bind_both_maps(self):
        artifacts = self.package_fixture()
        embed_bytes = {}
        for artifact in artifacts:
            with ZipFile(artifact) as archive:
                descriptor = json.loads(archive.read('artifact.json'))
                self.assertEqual(descriptor['asset_library_version'], self.published['version'])
                self.assertEqual(descriptor['catalog_sha256'], self.catalog_sha)
                if descriptor['kind'] in {'display', 'map-library'}:
                    self.assertEqual(descriptor['requires']['model-library'], {
                        'version': VERSION, 'asset_library_version': self.published['version'],
                        'catalog_sha256': self.catalog_sha,
                    })
                names = set(archive.namelist())
                mount_files = {name.removeprefix('payload/'): archive.read(name)
                               for name in names if name.startswith('payload/')}
                self.assertNotIn('NOTICE.md', mount_files)
                for name, raw in mount_files.items():
                    if name.startswith('scene/'):
                        embed_path = name.removeprefix('scene/')
                        self.assertNotIn(embed_path, embed_bytes)
                        embed_bytes[embed_path] = raw
                if descriptor['kind'] == 'model-library':
                    self.assertTrue({f'scene/{name}' for name in ATLASES} <= mount_files.keys())
                elif descriptor['kind'] == 'map-library':
                    self.assertIn('notices/NOTICE.md', names)
                    self.assertEqual(descriptor['legacy_scenario_sha256'], self.legacy_sha)
                    self.assertEqual(descriptor['map_refs'], [{'map_id': 'ustc-gaoxin', 'map_version': '1',
                                                               'manifest_sha256': self.map_sha}])
                    self.assertEqual(mount_files['scene-maps/ustc-gaoxin/1/manifest.json'],
                                     (self.map / 'manifest.json').read_bytes())
        self.assertEqual(embed_bytes, {name: path.read_bytes() for name, path in file_tree(self.embed).items()})

    def test_unknown_embed_file_cannot_become_a_display_file(self):
        write_file(self.embed, 'mecoffe/trajectory.json', {})
        with self.assertRaisesRegex(ValueError, 'Unexpected embed paths'):
            partition_embed(self.embed)

    def test_rejects_map_hash_mismatch_before_writing_archives(self):
        write_file(self.map, 'quality.json', {'status': 'changed'})
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.package_fixture()
        self.assertFalse(self.output.exists())

    def test_rejects_map_bound_to_a_different_catalog(self):
        write_file(self.map, 'manifest.json', {**self.manifest, 'catalog_sha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'exact published asset catalog'):
            self.package_fixture()
        self.assertFalse(self.output.exists())

    def test_rejects_previous_asset_library_version_even_with_matching_hash(self):
        write_file(self.map, 'manifest.json', {**self.manifest, 'asset_library_version': 'bundled-v1'})
        with self.assertRaisesRegex(ValueError, 'exact published asset catalog'):
            self.package_fixture()
        self.assertFalse(self.output.exists())

    def test_accepts_all_official_map_versions_with_registered_asset_library(self):
        root = Path(__file__).resolve().parents[1] / 'data/maps'
        published = require_published_catalog(ASSET_DIRECTORY / 'catalog.json')
        files, map_refs = collect_versioned_maps(root, published)
        manifests = sorted(root.glob('*/*/manifest.json'))
        expected = {f'scene-maps/{path.relative_to(root).as_posix()}': path
                    for manifest in manifests for path in manifest.parent.rglob('*') if path.is_file()}
        self.assertEqual(files, expected)
        self.assertEqual(map_refs, [{'map_id': manifest.parent.parent.name, 'map_version': manifest.parent.name,
                                    'manifest_sha256': hashlib.sha256(manifest.read_bytes()).hexdigest()}
                                   for manifest in manifests])
        self.assertTrue({('ustc-gaoxin', '1'), ('ustc-gaoxin', '2')}
                        <= {(item['map_id'], item['map_version']) for item in map_refs})

    def test_packs_all_map_ids_and_versions_without_sidecar_files(self):
        for map_id, version in [('ustc-gaoxin', '2'), ('synthetic-campus', 'release-3')]:
            directory = self.maps / map_id / version
            shutil.copytree(self.map, directory)
            write_file(directory, 'manifest.json', {**self.manifest, 'map_id': map_id, 'map_version': version})
        write_file(self.maps, 'ustc-gaoxin/review-annotations.v2.json', {'review': True})
        write_file(self.maps, 'README.json', {'description': 'Map registry metadata'})
        artifacts = self.package_fixture()
        with ZipFile(artifacts[-1]) as archive:
            descriptor = json.loads(archive.read('artifact.json'))
            self.assertEqual([(ref['map_id'], ref['map_version']) for ref in descriptor['map_refs']],
                             [('synthetic-campus', 'release-3'), ('ustc-gaoxin', '1'), ('ustc-gaoxin', '2')])
            expected = {f'payload/scene-maps/{path.relative_to(self.maps).as_posix()}': path.read_bytes()
                        for manifest in self.maps.glob('*/*/manifest.json')
                        for path in manifest.parent.rglob('*') if path.is_file()}
            actual = {name: archive.read(name) for name in archive.namelist()
                      if name.startswith('payload/scene-maps/')}
            self.assertEqual(actual, expected)

    def test_rejects_directory_and_manifest_identity_mismatch(self):
        write_file(self.map, 'manifest.json', {**self.manifest, 'map_version': '2'})
        with self.assertRaisesRegex(ValueError, 'identity must match its directory'):
            self.package_fixture()
        self.assertFalse(self.output.exists())

    def test_rejects_incomplete_version_before_writing_any_archive(self):
        (self.maps / 'ustc-gaoxin/2').mkdir()
        with self.assertRaisesRegex(ValueError, 'Versioned map is missing'):
            self.package_fixture()
        self.assertFalse(self.output.exists())

    def test_rejects_tampered_later_version_before_writing_any_archive(self):
        second = self.maps / 'ustc-gaoxin/2'
        shutil.copytree(self.map, second)
        write_file(second, 'manifest.json', {**self.manifest, 'map_version': '2'})
        write_file(second, 'quality.json', {'status': 'changed'})
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.package_fixture()
        self.assertFalse(self.output.exists())
