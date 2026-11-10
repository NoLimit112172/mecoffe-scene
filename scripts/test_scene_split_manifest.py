import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from scene_split_manifest import write_artifact


class ArtifactManifestTest(unittest.TestCase):
    def test_manifest_hashes_exact_archive_bytes(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data"
            data = b"text with preserved CRLF\r\n"
            source.write_bytes(data)
            archive_path = write_artifact(root, "display", "a" * 40, {"scene/index.html": source})
            expected = archive_path.read_bytes()
            with ZipFile(archive_path) as archive:
                self.assertEqual(archive.read("payload/scene/index.html"), data)
                manifest = json.loads(archive.read("artifact.json"))
                self.assertEqual(manifest["files"], [{"path": "scene/index.html", "bytes": len(data),
                                                     "sha256": hashlib.sha256(data).hexdigest()}])
            write_artifact(root, "display", "a" * 40, {"scene/index.html": source})
            self.assertEqual(archive_path.read_bytes(), expected)

    def test_unsafe_paths_do_not_publish_an_archive(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data"
            source.write_bytes(b"example")
            for name in ("../outside", "/outside", "C:/outside", "scene//index.html", "scene\\index.html", "bad\x00name"):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    write_artifact(root, "display", "a" * 40, {name: source})
            self.assertEqual(list(root.glob("*.zip")), [])
