import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import import_campus_assets as assets


class CampusAssetsCase(unittest.TestCase):
    def test_verifier_rejects_changed_bytes_and_wrong_upstream_blob(self):
        b=b'example';record={'id':'sample','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'source_git_blob':hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()}
        assets.verify_file(b,record,True)
        with self.assertRaisesRegex(ValueError,'SHA-256'):assets.verify_file(b'Example',record,True)
        with self.assertRaisesRegex(ValueError,'Git blob'):assets.verify_file(b,{**record,'source_git_blob':'0'*40},True)

    def test_wrong_download_archive_never_overwrites_an_existing_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=root/'kenney';folder.mkdir();(folder/'tree.glb').write_bytes(b'keep-existing-model')
            (folder/'manifest.json').write_text(json.dumps({'archive_sha256':'0'*64,'models':[]}))
            bad=root/'wrong.zip';bad.write_bytes(b'not-the-pinned-archive')
            with patch.object(assets,'ROOT',root),self.assertRaisesRegex(ValueError,'原始包 SHA-256'):
                assets.main(['--nature-zip',str(bad)])
            self.assertEqual((folder/'tree.glb').read_bytes(),b'keep-existing-model')
