"""Offline checks for selected ZIP entries and honest derivative provenance."""
import binascii
import hashlib
from io import BytesIO
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

from PIL import Image

from adapter import rocketbox_derived_textures as derived


def zip_fixture(data=b"expected public image bytes", name="Model/body.jpg", method=8):
    encoder = zlib.compressobj(wbits=-15)
    compressed = encoder.compress(data) + encoder.flush() if method == 8 else data
    filename = name.encode("utf8")
    crc = binascii.crc32(data) & 0xffffffff
    header = struct.pack("<4s5H3I2H", b"PK\x03\x04", 20, 2048, method, 0, 0,
                         crc, len(compressed), len(data), len(filename), 0)
    entry = {"name": name, "method": method, "flags": 2048,
             "compressed_size": len(compressed), "uncompressed_size": len(data),
             "crc32": f"{crc:08x}", "local_header_offset": 123}
    return header + filename + compressed, entry


class VersionedIndexTests(unittest.TestCase):
    def test_default_index_is_versioned_complete_and_valid_without_logs(self):
        self.assertTrue(derived.DEFAULT_INDEX.is_file())
        self.assertTrue(derived.DEFAULT_INDEX.is_relative_to(derived.ROOT / "adapter/resources"))
        audit = derived.load_index()
        self.assertEqual(audit["schema_version"], "mecoffe.rocketbox-openomsi-index.v1")
        self.assertEqual(audit["canonical_revision"], derived.REVISION)
        self.assertEqual(len(audit["model_ids"]), 91)
        self.assertEqual(len(audit["required_texture_matches"]), 258)
        self.assertEqual({entry["name"] for entry in audit["entries"]}, {"LICENSE.md", "CREDITS.md"})
        self.assertEqual(set(audit["metadata"]), {"LICENSE.md", "CREDITS.md"})
        self.assertFalse(audit["release_sha256_locally_verified"])
        # Only stable public URLs are stored; no redirect signatures or tokens.
        for key in ("release_url", "builder_url"):
            self.assertNotIn("?", audit[key])
            self.assertNotIn("@", audit[key])

    def test_rejects_tampered_identity_ranges_notices_and_missing_models(self):
        original = json.loads(derived.DEFAULT_INDEX.read_text("utf8"))
        mutations = [
            lambda value: value.update(release_url="https://example.invalid/archive.zip"),
            lambda value: value["model_ids"].pop(),
            lambda value: value["required_texture_matches"][0]["archive_entry"].update(local_header_offset=derived.ASSET_BYTES),
            lambda value: value["required_texture_matches"][0]["archive_entry"].update(name="../unexpected.png"),
            lambda value: value["metadata"].update({"LICENSE.md": "not the audited licence"}),
        ]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "index.json"
            for mutate in mutations:
                value = json.loads(json.dumps(original))
                mutate(value)
                target.write_text(json.dumps(value), "utf8")
                with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                    derived.load_index(target)

    def test_original_full_audit_format_remains_an_optional_override(self):
        value = json.loads(derived.DEFAULT_INDEX.read_text("utf8"))
        # The original audit predates schema/canonical revision fields and can
        # contain unrelated central-directory entries. No temporary file is needed.
        value.pop("schema_version")
        value.pop("canonical_revision")
        value["entries"].append({"name": "unrelated.fbx"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "original-audit.json"
            path.write_text(json.dumps(value), "utf8")
            self.assertEqual(len(derived.load_index(path)["model_ids"]), 91)


class AtomicWriteTests(unittest.TestCase):
    def test_brief_windows_reader_lock_is_retried_without_partial_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_bytes(b"old complete data")
            replace = derived.os.replace
            calls = []

            def briefly_locked(source, target):
                calls.append(1)
                if len(calls) < 3:
                    self.assertEqual(path.read_bytes(), b"old complete data")
                    raise PermissionError("temporary Windows reader lock")
                replace(source, target)

            with patch.object(derived.os, "replace", side_effect=briefly_locked), patch.object(derived.time, "sleep"):
                derived.atomic_bytes(path, b"new complete data")
            self.assertEqual(len(calls), 3)
            self.assertEqual(path.read_bytes(), b"new complete data")

    def test_permanent_lock_has_a_bounded_retry_count_and_preserves_old_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_bytes(b"old complete data")
            with patch.object(derived.os, "replace", side_effect=PermissionError("locked")) as replace, patch.object(derived.time, "sleep"):
                with self.assertRaises(PermissionError):
                    derived.atomic_bytes(path, b"new complete data")
            self.assertEqual(replace.call_count, 6)
            self.assertEqual(path.read_bytes(), b"old complete data")


class DerivedZipTests(unittest.TestCase):
    def test_deflated_and_stored_payloads_decode_exactly(self):
        data = bytes(range(256)) * 12
        for method in (0, 8):
            with self.subTest(method=method):
                payload, entry = zip_fixture(data, method=method)
                # The range intentionally includes a little of the next entry.
                self.assertEqual(derived.decoded_entry(payload + b"next header", entry), data)

    def test_rejects_wrong_crc_names_size_and_truncated_streams(self):
        payload, entry = zip_fixture()
        invalid = [
            (payload, dict(entry, crc32="00000000")),
            (payload, dict(entry, name="Another/body.jpg")),
            (payload, dict(entry, uncompressed_size=1)),
            (payload[:10], entry),
            (payload[:-2], entry),
            (payload[:31] + b"wrong name" + payload[41:], entry),
        ]
        for content, expected in invalid:
            with self.subTest(expected=expected, length=len(content)):
                with self.assertRaises(ValueError):
                    derived.decoded_entry(content, expected)

    def test_rejects_encryption_and_unsupported_compression(self):
        payload, entry = zip_fixture()
        encrypted = bytearray(payload)
        struct.pack_into("<H", encrypted, 6, 2049)
        with self.assertRaises(ValueError):
            derived.decoded_entry(bytes(encrypted), entry)
        unsupported = bytearray(payload)
        struct.pack_into("<H", unsupported, 8, 99)
        with self.assertRaises(ValueError):
            derived.decoded_entry(bytes(unsupported), dict(entry, method=99))

    def test_cached_entry_still_requires_size_and_crc(self):
        data = b"unmodified cached bytes"
        _, entry = zip_fixture(data)
        derived.verify_entry(data, entry)
        with self.assertRaises(ValueError):
            derived.verify_entry(data[:-1], entry)
        with self.assertRaises(ValueError):
            derived.verify_entry(data[:-1] + b"!", entry)


class DerivedTextureTests(unittest.TestCase):
    def fixture(self, image, kind, suffix):
        buffer = BytesIO()
        image.save(buffer, "JPEG" if suffix == ".jpg" else "PNG")
        data = buffer.getvalue()
        _, entry = zip_fixture(data, name="Example/texture" + suffix)
        source = {"kind": kind, "source_path": "Assets/Avatars/Adults/Example/Textures/texture_color.tga",
                  "source_git_blob": "1" * 40, "source_bytes": 123456}
        return source, {"archive_entry": entry}, data

    def test_opacity_remains_rgba_and_never_claims_original_tga_hash(self):
        image = Image.new("RGBA", (1024, 512), (20, 50, 90, 255))
        alpha = Image.new("L", image.size, 255)
        alpha.paste(0, (0, 0, 512, 512))
        image.putalpha(alpha)
        source, match, data = self.fixture(image, "opacity", ".png")
        with tempfile.TemporaryDirectory() as directory, patch.object(derived, "OUTPUT", Path(directory)):
            # Texture conversion must not replace the original standard FBX.
            fbx = Path(directory) / "Example/Example.fbx"
            fbx.parent.mkdir()
            fbx.write_bytes(b"unchanged official model")
            record = derived.convert_texture(source, match, data, "Example")
            actual = (Path(directory) / record["path"]).read_bytes()
            self.assertEqual(fbx.read_bytes(), b"unchanged official model")
            with Image.open(BytesIO(actual)) as result:
                self.assertEqual((result.format, result.mode, result.size), ("PNG", "RGBA", (512, 256)))
                self.assertEqual(result.getchannel("A").getextrema(), (0, 255))
            self.assertIsNone(record["source_sha256"])
            self.assertFalse(record["source_git_blob_locally_verified"])
            self.assertEqual(record["source_git_blob"], source["source_git_blob"])
            self.assertIn(derived.REVISION, record["source_url"])
            self.assertEqual(record["sha256"], hashlib.sha256(actual).hexdigest())
            self.assertEqual(record["bytes"], len(actual))
            provenance = record["derivative"]
            self.assertFalse(provenance["whole_archive_verified"])
            self.assertFalse(provenance["jpeg_lossy_intermediate"])
            self.assertTrue(provenance["crc32_verified"])
            self.assertEqual(provenance["crc32"], match["archive_entry"]["crc32"])
            self.assertEqual(provenance["sha256_actual_entry"], hashlib.sha256(data).hexdigest())
            self.assertEqual(provenance["expected_archive_sha256"], derived.EXPECTED_ARCHIVE_SHA256)
            self.assertEqual(provenance["release_tag_commit"], derived.RELEASE_COMMIT)
            self.assertIsNone(record["original_width"])

    def test_jpeg_head_and_shared_atlas_keep_1024_limit_and_lossy_disclosure(self):
        for kind in ("head", "atlas"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory, patch.object(derived, "OUTPUT", Path(directory)):
                source, match, data = self.fixture(Image.new("RGB", (2048, 1024), "gold"), kind, ".jpg")
                record = derived.convert_texture(source, match, data, "Example")
                self.assertEqual((record["width"], record["height"], record["mode"]), (1024, 512, "RGB"))
                self.assertTrue(record["derivative"]["jpeg_lossy_intermediate"])
                self.assertEqual(record["derivative"]["width"], 2048)
                self.assertIn("already lossy", record["conversion"])

    def test_rejects_opacity_without_alpha_or_extension_format_mismatch(self):
        source, match, data = self.fixture(Image.new("RGB", (64, 64), "red"), "opacity", ".png")
        with tempfile.TemporaryDirectory() as directory, patch.object(derived, "OUTPUT", Path(directory)):
            with self.assertRaises(ValueError):
                derived.convert_texture(source, match, data, "Example")
            source["kind"] = "body"
            match["archive_entry"]["name"] = "Example/texture.jpg"
            with self.assertRaises(ValueError):
                derived.convert_texture(source, match, data, "Example")


if __name__ == "__main__":
    unittest.main()
