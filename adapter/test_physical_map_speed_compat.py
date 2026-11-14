"""Compare optimized CLI bytes with the fixed upstream offline implementation.

Only the builder fingerprint is fixed in these differential children: genuine
source changes must change recipe provenance, which would otherwise cascade
through campus/manifest/map_ref. No geometry, evidence, quality or rule field is
normalized. Both implementations read the same caller-supplied synthetic input.
"""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET

from adapter.test_physical_map import fixture, SCOPES, tree_bytes


ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'c51f7bd04ac06c82c4d21c04f2ff20eb1a465eeb'
PHASES = ['reading', 'geometry', 'entrances_gis', 'evidence_quality', 'publishing']
CLI = r'''
import sys
sys.path.insert(0, sys.argv[1])
def no_network(event, arguments):
    if event in ('socket.connect', 'socket.bind', 'socket.getaddrinfo', 'urllib.Request'):
        raise AssertionError('Offline physical-map attempted network: '+event)
sys.addaudithook(no_network)
from adapter.scene_builder import physical_map
# Test-only oracle identity. The real, source-derived identity is never changed.
physical_map._builder_identity = lambda: {
    'name': 'mecoffe-physical-map-builder', 'version': 'physical-map.1',
    'implementation_sha256': '0'*64}
from adapter.scene_builder.__main__ import main
raise SystemExit(main(sys.argv[2:]))
'''


class PhysicalMapSpeedCompatibilityCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline_tmp = tempfile.TemporaryDirectory(prefix='physical-speed-upstream-')
        cls.addClassCleanup(cls.baseline_tmp.cleanup)
        cls.baseline_root = Path(cls.baseline_tmp.name).resolve()
        raw = subprocess.check_output(['git', 'archive', BASELINE, 'adapter'], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
            for member in archive.getmembers():
                if (member.issym() or member.islnk() or
                        not (cls.baseline_root/member.name).resolve().is_relative_to(cls.baseline_root)):
                    raise AssertionError('Unsafe baseline archive member')
            archive.extractall(cls.baseline_root, filter='data')

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='physical-speed-contract-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.osm, self.metadata = fixture(self.work/'input')

    def cli(self, root, arguments):
        # -I and a cwd outside both source trees ensure the chosen root is used.
        return subprocess.run([sys.executable, '-I', '-B', '-c', CLI, str(root), *arguments],
                              cwd=self.work, capture_output=True, text=True, encoding='utf-8', timeout=60)

    def pair(self, geometry, *, suffix='case', extra=(), nonempty=False):
        scope = self.work/(suffix+'-scope.json')
        scope.write_text(json.dumps(geometry), encoding='utf-8')
        results = []
        outputs = []
        for label, root in [('upstream', self.baseline_root), ('optimized', ROOT)]:
            out = self.work/(suffix+'-'+label)
            if nonempty:
                out.mkdir()
                (out/'keep').write_bytes(b'caller-owned bytes')
            result = self.cli(root, ['physical-map', '--osm', str(self.osm),
                '--metadata', str(self.metadata), '--scope', str(scope),
                '--map-id', 'synthetic-speed-contract', '--map-version', '1',
                '--title', '合成离线兼容图', '--rules',
                str(root/'adapter/scene_service/evidence_rules_v2.json'),
                '--out', str(out), *extra])
            results.append(result)
            outputs.append(out)
        self.assertEqual(results[0].returncode, results[1].returncode)
        self.assertEqual(results[0].stdout, results[1].stdout)
        self.assertEqual(results[0].stderr, results[1].stderr)
        return results[1], outputs

    def test_original_cli_help_and_argument_errors_are_byte_identical(self):
        for arguments in [['--help'], ['physical-map', '--help'],
                          ['physical-map'], ['physical-map', '--invented-option']]:
            with self.subTest(arguments=arguments):
                before, after = [self.cli(root, arguments) for root in (self.baseline_root, ROOT)]
                self.assertEqual(before.returncode, after.returncode)
                self.assertEqual(before.stdout, after.stdout)
                self.assertEqual(before.stderr, after.stderr)

    def test_holes_and_multiple_scopes_match_all_candidate_bytes_offline(self):
        for name in ['hole', 'multi']:
            with self.subTest(scope=name):
                result, outputs = self.pair(SCOPES[name], suffix=name)
                self.assertEqual(result.returncode, 0, result.stderr)
                response = json.loads(result.stdout)
                self.assertEqual(response['summary']['status'], 'ready')
                self.assertEqual([json.loads(line)['phase'] for line in result.stderr.splitlines()], PHASES)
                before, after = [tree_bytes(out) for out in outputs]
                self.assertEqual(len(after), 14)
                self.assertEqual(before, after)
                self.assertEqual(response['recipe']['rules_version'], 'auto-evidence.2')
                self.assertEqual(after['evidence-rules.json'],
                                 (ROOT/'adapter/scene_service/evidence_rules_v2.json').read_bytes())

    def test_preview_only_keeps_success_exit_and_full_output_contract(self):
        # Existing fixture with roads removed: valid buildings have no usable
        # road-connected entrance. This is a quality outcome, not a CLI error.
        tree = ET.parse(self.osm)
        for way in tree.getroot().findall('way'):
            if any(tag.get('k') == 'highway' for tag in way.findall('tag')):
                tree.getroot().remove(way)
        raw = ET.tostring(tree.getroot(), encoding='utf-8', xml_declaration=True)
        self.osm.write_bytes(raw)
        import hashlib
        metadata = json.loads(self.metadata.read_bytes())
        metadata['sha256'] = hashlib.sha256(raw).hexdigest()
        self.metadata.write_text(json.dumps(metadata), encoding='utf-8')
        result, outputs = self.pair(SCOPES['crossing'], suffix='preview')
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual(response['summary']['status'], 'preview_only')
        self.assertEqual(response['quality']['status'], 'preview_only')
        self.assertEqual([json.loads(line)['phase'] for line in result.stderr.splitlines()], PHASES)
        self.assertEqual(tree_bytes(outputs[0]), tree_bytes(outputs[1]))
        self.assertEqual(len(tree_bytes(outputs[1])), 14)

    def test_invalid_scope_limits_and_nonempty_output_keep_error_contract(self):
        limits = self.work/'limits.json'
        limits.write_text(json.dumps({'max_nodes': 1}), encoding='utf-8')
        cases = [('scope', {'type': 'Point', 'coordinates': [100, 30]}, (), False, 'INVALID_SCOPE'),
                 ('limit', SCOPES['hole'], ('--limits', str(limits)), False, 'MAP_DATA_LIMIT'),
                 ('nonempty', SCOPES['multi'], (), True, 'MAP_OUTPUT_NOT_EMPTY')]
        for name, scope, extra, nonempty, code in cases:
            with self.subTest(case=name):
                result, outputs = self.pair(scope, suffix=name, extra=extra, nonempty=nonempty)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                failure = json.loads(result.stderr.splitlines()[-1])
                self.assertEqual(failure['error'], code)
                self.assertRegex(failure['message'], r'[\u4e00-\u9fff]')
                for out in outputs:
                    if nonempty:
                        self.assertEqual(tree_bytes(out), {'keep': b'caller-owned bytes'})
                    else:
                        self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
