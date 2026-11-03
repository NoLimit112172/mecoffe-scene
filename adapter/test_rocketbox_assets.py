"""Offline integrity and licence checks for the four-avatar web trial."""
import hashlib
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'frontend/public/mecoffe/assets3d/rocketbox'


class RocketboxAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ASSETS / 'manifest.json').read_text(encoding='utf8'))

    def checked_file(self, relative, digest, length):
        path = (ASSETS / relative).resolve()
        self.assertTrue(path.is_relative_to(ASSETS.resolve()))
        content = path.read_bytes()
        self.assertEqual(len(content), length, relative)
        self.assertEqual(hashlib.sha256(content).hexdigest(), digest, relative)
        return content

    def test_pinned_models_have_the_original_mit_notice_and_no_motion_pack(self):
        manifest = self.manifest
        self.assertEqual(manifest['schema_version'], 'mecoffe.rocketbox-assets.v1')
        self.assertEqual(manifest['revision'], '0943055db6ec570bcef9f2c8b41c9e5467c808f9')
        self.assertEqual(manifest['license'], 'MIT')
        models=manifest['models']
        self.assertEqual(len(models),115)
        self.assertEqual(len({model['id'] for model in models}),115)
        self.assertEqual({group:sum(model['category']==group for model in models) for group in ['adults','children','professions']},
                         {'adults':40,'children':4,'professions':71})
        self.assertTrue(all(model.get('human',True) for model in models))
        for record in manifest['source_files']:
            content = self.checked_file(record['path'], record['sha256'], record['bytes'])
            if record['path'] == manifest['license_file']:
                self.assertIn(b'MIT License', content)
                self.assertIn(b'Microsoft', content)
        self.assertFalse(any('Animations' in str(path) for path in ASSETS.rglob('*')))

    def test_runtime_fbx_and_texture_bytes_match_the_provenance(self):
        for model in self.manifest['models']:
            content = self.checked_file(model['fbx'], model['sha256'], model['bytes'])
            self.assertTrue(content.startswith(b'Kaydara FBX Binary'), model['id'])
            self.assertTrue(model['textures'], model['id'])
            names = set()
            for texture in model['textures']:
                content = self.checked_file(texture['path'], texture['sha256'], texture['bytes'])
                self.assertTrue(content.startswith(b'\x89PNG\r\n\x1a\n'))
                width, height = struct.unpack('>II', content[16:24])
                self.assertEqual((width, height), (texture['width'], texture['height']))
                self.assertLessEqual(max(width, height),1024 if texture['kind'] in ['head','combined','atlas'] else 512)
                self.assertEqual(len(texture['source_git_blob']),40)
                if texture['source_sha256'] is None:
                    derivative=texture['derivative']
                    self.assertEqual(derivative['provider'],'openOMSI')
                    self.assertEqual(derivative['release_tag'],'avatars-1')
                    self.assertEqual(derivative['expected_archive_sha256'],'ead00bbfbf66165336dcd40323569840c18e148ee79c3e7d097d198ad4b12d6a')
                    self.assertFalse(derivative['whole_archive_verified'])
                    self.assertTrue(derivative['crc32_verified'])
                    self.assertEqual(len(derivative['sha256_actual_entry']),64)
                    self.assertFalse(texture['source_git_blob_locally_verified'])
                    self.assertTrue((ASSETS/derivative['license_file']).is_file())
                    self.assertTrue((ASSETS/derivative['credits_file']).is_file())
                else:
                    self.assertEqual(len(texture['source_sha256']), 64)
                self.assertIn(self.manifest['revision'], texture['source_url'])
                self.assertNotIn(texture['source_name'].lower(), names)
                names.add(texture['source_name'].lower())


if __name__ == '__main__':
    unittest.main()
