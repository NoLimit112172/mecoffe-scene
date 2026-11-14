"""Scope-quality is explicit, immutable and separate from evidence/SceneResult.

All inputs are synthetic or already-published public fixtures; writes go only to
TemporaryDirectory. The pre-change evidence implementation is a pinned oracle.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from scene_service import SceneError, canonical, compile_scene, digest, enrich_map, validate_result
from scene_service.fixtures.synthetic import sample_request
from scene_service.fixtures.taxonomy import layered_request
from scene_service.map_package import publish_map, json_bytes
from scene_service.maps import load_map
from scene_service.quality import current_policy, policy_for, validate_policy


ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / 'frontend/tests/fixtures/scene-taxonomy/maps/synthetic-taxonomy/1'


def rectangle(x, y, width=10, height=10):
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]


def synthetic_package(*, policy=True):
    """Two safe in-scope schools and an isolated out-of-scope house."""
    buildings, entrances = [], []
    for number, x in enumerate((0, 20, 100)):
        identifier = f'synthetic-quality/b{number}'
        kind = 'school' if number < 2 else 'residential'
        buildings.append({'osm_id': identifier, 'name': f'合成教学楼{number}',
                          'kind': 'display-only-legacy-kind', 'building_type': kind,
                          'tags': {'building': kind}, 'polygon': rectangle(x, 0), 'holes': []})
        entrances.append({'id': identifier + '/entrance', 'building_id': identifier,
                          'point': [x + 5, 0], 'road_node_id': f'n{number}',
                          'connector': [[x + 5, 0], [x + 5, -10]], 'connected': True})
    package = {'schema_version': 'scene.map.v1', 'synthetic': True,
               'map_ref': {'map_id': 'synthetic-scope-quality', 'map_version': '1',
                           'manifest_sha256': 'a' * 64},
               'campus': {'campus_id': 'synthetic-scope-quality', 'synthetic': True,
                          'boundary': rectangle(-5, -20, 45, 50),
                          'boundary_polygons': [{'outer': rectangle(-5, -20, 45, 50), 'holes': []}],
                          'buildings': buildings, 'pois': [],
                          'walk_graph': {'nodes': [{'id': f'n{i}', 'x': x + 5, 'y': -10}
                                                   for i, x in enumerate((0, 20, 100))],
                                         'edges': [{'source': 'n0', 'target': 'n1'}]}},
               'entrances': {'entrances': entrances}, 'landcover': {'features': []}}
    if policy:
        package['quality_policy'] = current_policy()
    return package


def file_hashes(directory):
    return {path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob('*')) if path.is_file()}


class ScopeQualityCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Read from the fixed pre-change commit, not a copied implementation.
        source = subprocess.check_output(
            ['git', 'show', '9411d9ef99e64aee086b92f81481c493b178c377:adapter/scene_service/evidence.py'],
            cwd=ROOT)
        namespace = {'__name__': 'scope_quality_941_oracle', '__package__': 'scene_service'}
        exec(compile(source, '9411d9e:adapter/scene_service/evidence.py', 'exec'), namespace)
        cls.legacy_enrich = staticmethod(namespace['enrich_map'])

    def assertCode(self, expected, action):
        with self.assertRaises(SceneError) as caught:
            action()
        self.assertEqual(caught.exception.code, expected)

    def test_absent_policy_retains_pinned_legacy_bytes_and_existing_result_fixture(self):
        for package in (sample_request()['map'], layered_request()['map'], synthetic_package(policy=False),
                        load_map(PUBLISHED), load_map(ROOT / 'data/maps/ustc-gaoxin/1'),
                        load_map(ROOT / 'data/maps/ustc-gaoxin/2')):
            with self.subTest(map_id=package['map_ref']['map_id']):
                original = copy.deepcopy(package)
                self.assertIsNone(policy_for(package))
                actual = enrich_map(package)
                # Map geometry/quality contain fractional coordinates/ratios;
                # SceneResult's integer-only canonicalizer is not their codec.
                self.assertEqual(json.dumps(actual, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'),
                                 json.dumps(self.legacy_enrich(package), ensure_ascii=False, sort_keys=True,
                                            separators=(',', ':')).encode('utf-8'))
                self.assertNotIn('quality_policy', actual['quality'])
                self.assertNotIn('connectivity_entrances', actual['quality'])
                self.assertEqual(package, original)
        bundle = json.loads((PUBLISHED.parents[2] / 'input-v3.json').read_text(encoding='utf-8'))
        inputs = copy.deepcopy(bundle)
        response = compile_scene(bundle['intent'], bundle['snapshot'], bundle['plan'],
                                 load_map(PUBLISHED), assignment_seed=42)
        self.assertEqual(canonical(response), canonical(bundle['expected']))
        self.assertEqual(bundle, inputs)

    def test_background_is_reference_only_and_all_entrance_count_is_preserved(self):
        package = synthetic_package()
        original = copy.deepcopy(package)
        result = enrich_map(package)
        quality = result['quality']
        self.assertEqual(quality['status'], 'ready')
        self.assertEqual((quality['entrances'], quality['connectivity_entrances'],
                          quality['main_component_entrances'], quality['main_component_ratio']), (3, 2, 2, 1))
        self.assertEqual((quality['background_entrances'], quality['background_main_component_entrances'],
                          quality['background_main_component_ratio'], quality['invalid_geometry_entrances']), (1, 0, 0, 0))
        self.assertEqual(quality['quality_policy'], package['quality_policy'])
        excluded = result['campus']['buildings'][2]
        self.assertFalse(excluded['scene_eligible'])
        self.assertIn({'code': 'BUILDING_OUT_OF_SCOPE',
                       'message': '确认范围外的背景楼，保留显示；不参加安置或范围内路网质量统计',
                       'refs': [excluded['osm_id']]}, quality['warnings'])
        self.assertFalse(any(warning['code'] == 'BUILDING_EXCLUDED' for warning in quality['warnings']))
        self.assertEqual(package, original)
        legacy = copy.deepcopy(package)
        legacy.pop('quality_policy')
        old = enrich_map(legacy)['quality']
        self.assertEqual(old['main_component_ratio'], 2 / 3)
        self.assertEqual(old['status'], 'preview_only')

    def test_disconnected_in_scope_entrance_stays_in_denominator(self):
        package = synthetic_package()
        package['campus']['boundary'] = rectangle(-5, -20, 120, 50)
        package['campus']['boundary_polygons'][0]['outer'] = copy.deepcopy(package['campus']['boundary'])
        quality = enrich_map(package)['quality']
        self.assertEqual((quality['connectivity_entrances'], quality['main_component_entrances']), (3, 2))
        self.assertEqual(quality['main_component_ratio'], 2 / 3)
        self.assertEqual(quality['background_entrances'], 0)
        self.assertEqual(quality['status'], 'preview_only')
        self.assertTrue(any(w['code'] == 'BUILDING_NO_SAFE_ENTRANCE'
                            and w['refs'] == ['synthetic-quality/b2'] for w in quality['warnings']))

    def test_hole_and_cross_boundary_buildings_are_background_not_ratio_population(self):
        package = synthetic_package()
        outer = rectangle(-5, -20, 65, 50)
        package['campus']['boundary'] = outer
        package['campus']['boundary_polygons'] = [{'outer': outer, 'holes': [rectangle(19, -1, 12, 12)]}]
        package['campus']['buildings'][2]['polygon'] = rectangle(55, 0)
        result = enrich_map(package)
        self.assertEqual([b['scene_eligible'] for b in result['campus']['buildings']], [True, False, False])
        quality = result['quality']
        self.assertEqual((quality['entrances'], quality['connectivity_entrances'],
                          quality['main_component_entrances'], quality['main_component_ratio']), (3, 1, 1, 1))
        self.assertEqual((quality['background_entrances'], quality['background_main_component_entrances']), (2, 1))
        excluded = [w['refs'][0] for w in quality['warnings'] if w['code'] == 'BUILDING_OUT_OF_SCOPE']
        self.assertEqual(excluded, ['synthetic-quality/b1', 'synthetic-quality/b2'])

    def test_invalid_geometry_has_its_own_count_and_still_blocks_ready(self):
        package = synthetic_package()
        package['campus']['buildings'][2]['polygon'] = [[100, 0], [110, 10], [110, 0], [100, 10], [100, 0]]
        quality = enrich_map(package)['quality']
        self.assertEqual(quality['invalid_geometry_entrances'], 1)
        self.assertEqual(quality['background_entrances'], 0)
        self.assertEqual(quality['connectivity_entrances'], 2)
        self.assertEqual(quality['status'], 'preview_only')
        self.assertTrue(any(w['code'] == 'BUILDING_INVALID_GEOMETRY' for w in quality['warnings']))

    def test_cross_building_or_water_connectors_cannot_certify_safe_entrances(self):
        for reason in ('building', 'water'):
            with self.subTest(reason=reason):
                package = synthetic_package()
                if reason == 'building':
                    # A bad facade connector goes inside its own building first.
                    package['entrances']['entrances'][0]['connector'] = [[5, 0], [5, 5], [5, -10]]
                else:
                    package['landcover']['features'] = [{'kind': 'water', 'polygon': rectangle(4, -8, 2, 6), 'holes': []}]
                result = enrich_map(package)
                self.assertFalse(result['entrances']['entrances'][0]['scene_reachable'])
                self.assertFalse(result['campus']['buildings'][0]['scene_eligible'])
                self.assertEqual(result['campus']['buildings'][0]['usable_entrance_ids'], [])
                self.assertTrue(any(w['code'] == 'BUILDING_NO_SAFE_ENTRANCE'
                                    and w['refs'] == ['synthetic-quality/b0'] for w in result['quality']['warnings']))
                # Connectivity intentionally remains the main-component measure;
                # safety is a separate unchanged eligibility gate.
                self.assertEqual(result['quality']['main_component_ratio'], 1)

    def test_water_body_and_non_placeable_reasons_are_explicit(self):
        package = synthetic_package()
        package['landcover']['features'] = [{'kind': 'water', 'polygon': rectangle(4, 2, 2, 2), 'holes': []}]
        result = enrich_map(package)
        self.assertFalse(result['campus']['buildings'][0]['scene_eligible'])
        self.assertTrue(any(w['code'] == 'BUILDING_WATER_CONFLICT' for w in result['quality']['warnings']))
        layered = layered_request()['map']
        layered['quality_policy'] = current_policy()
        quality = enrich_map(layered)['quality']
        self.assertEqual(quality['non_placeable_buildings'], 2)
        self.assertEqual(len([w for w in quality['warnings'] if w['code'] == 'BUILDING_NON_PLACEABLE']), 2)

    def test_no_in_scope_entrances_cannot_pass_even_at_zero_ratio_threshold(self):
        package = synthetic_package()
        package['entrances']['entrances'] = [package['entrances']['entrances'][2]]
        result = enrich_map(package, min_main_ratio=0)
        self.assertEqual(result['quality']['connectivity_entrances'], 0)
        self.assertEqual(result['quality']['background_entrances'], 1)
        self.assertEqual(result['quality']['main_component_ratio'], 0)
        self.assertEqual(result['quality']['status'], 'preview_only')
        self.assertEqual(result['quality']['eligible_buildings'], 0)
        self.assertEqual(len([w for w in result['quality']['warnings'] if w['code'] == 'BUILDING_NO_SAFE_ENTRANCE']), 2)

    def test_policy_validation_rejects_unknown_incomplete_tampered_and_null(self):
        original = current_policy()
        variants = []
        missing = copy.deepcopy(original); missing.pop('implementation_sha256'); variants.append(missing)
        unknown = copy.deepcopy(original); unknown['version'] = 'scope-quality.future'; variants.append(unknown)
        changed = copy.deepcopy(original); changed['rules']['empty_connectivity_population_ready'] = True; variants.append(changed)
        changed = copy.deepcopy(original); changed['sha256'] = '0' * 64; variants.append(changed)
        # Python equality treats False == 0; the exact JSON rule bytes must
        # still match their own frozen digest, even with a rehashed envelope.
        changed = copy.deepcopy(original); changed['rules']['empty_connectivity_population_ready'] = 0
        changed['sha256'] = digest({k: v for k, v in changed.items() if k != 'sha256'}); variants.append(changed)
        changed = copy.deepcopy(original); changed['implementation_files'].pop('geometry.py')
        changed['implementation_sha256'] = digest(changed['implementation_files'])
        changed['sha256'] = digest({k: v for k, v in changed.items() if k != 'sha256'}); variants.append(changed)
        for malformed in variants:
            with self.subTest(policy=malformed):
                self.assertCode('INVALID_QUALITY_POLICY', lambda: validate_policy(malformed))
                package = synthetic_package(); package['quality_policy'] = malformed
                self.assertCode('INVALID_QUALITY_POLICY', lambda: enrich_map(package))
        for location in ('explicit', 'frozen'):
            with self.subTest(null_location=location):
                package = synthetic_package(policy=False)
                if location == 'explicit':
                    package['quality_policy'] = None
                else:
                    package['quality'] = {'quality_policy': None}
                self.assertCode('INVALID_QUALITY_POLICY', lambda: enrich_map(package))
        self.assertEqual(validate_policy(original), original)

    def test_policy_explicit_and_frozen_must_agree(self):
        package = synthetic_package()
        package['quality'] = {'quality_policy': copy.deepcopy(package['quality_policy'])}
        package['quality']['quality_policy']['implementation_files']['quality.py'] = '0' * 64
        self.assertCode('INVALID_QUALITY_POLICY', lambda: enrich_map(package))
        package = synthetic_package()
        package['quality'] = {'quality_policy': copy.deepcopy(package['quality_policy'])}
        package['quality']['quality_policy']['rules']['empty_connectivity_population_ready'] = 0
        # A valid explicit copy must not hide malformed frozen content, even
        # though Python compares False and 0 as equal across nested dicts.
        self.assertCode('INVALID_QUALITY_POLICY', lambda: enrich_map(package))

    def test_new_policy_publication_load_enrich_compile_and_inputs_remain_immutable(self):
        source_hashes = file_hashes(PUBLISHED)
        request = layered_request()
        original_request = copy.deepcopy(request)
        policy = current_policy()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / '1'
            published = publish_map(PUBLISHED, directory, 'synthetic-scope-quality-published', '1',
                                    '合成范围质量发布', evidence_mode='auto',
                                    rules_path=ROOT / 'adapter/scene_service/evidence_rules_v2.json', quality_policy=policy)
            self.assertEqual(published['quality']['status'], 'ready')
            files = file_hashes(directory)
            manifest = json.loads((directory / 'manifest.json').read_bytes())
            self.assertNotIn('quality-policy.json', manifest['files'])
            quality_bytes = (directory / 'quality.json').read_bytes()
            self.assertEqual(manifest['files']['quality.json'], hashlib.sha256(quality_bytes).hexdigest())
            loaded = load_map(directory)
            self.assertEqual(loaded['quality']['quality_policy'], policy)
            original_loaded = copy.deepcopy(loaded)
            enriched = enrich_map(loaded)
            self.assertEqual(enriched['quality']['status'], 'ready')
            self.assertEqual(enriched['quality']['quality_policy'], policy)
            self.assertEqual(loaded, original_loaded)
            intent = {key: copy.deepcopy(value) for key, value in request.items()
                      if key not in ('map', 'snapshot', 'plan', 'assignment_seed')}
            intent['map_ref'] = published['map_ref']
            response = compile_scene(intent, request['snapshot'], request['plan'], loaded, assignment_seed=42)
            self.assertTrue(response['ok'], response)
            self.assertEqual(response['result']['schema_version'], 'scene.result.v3')
            self.assertEqual(response['result']['map_ref'], published['map_ref'])
            validate_result(response['result'], {'snapshot': request['snapshot'], 'plan': request['plan'], 'map': enriched})
            self.assertEqual(response, compile_scene(intent, request['snapshot'], request['plan'], loaded, assignment_seed=42))
            self.assertEqual(loaded, original_loaded)
            self.assertEqual(file_hashes(directory), files)
            # Even a correctly rehashed manifest cannot make malformed policy
            # acceptable: byte verification and semantic policy checks both run.
            invalid = json.loads(quality_bytes); invalid['quality_policy'].pop('rules')
            modified = json_bytes(invalid); (directory / 'quality.json').write_bytes(modified)
            manifest['files']['quality.json'] = hashlib.sha256(modified).hexdigest()
            (directory / 'manifest.json').write_bytes(json_bytes(manifest))
            self.assertCode('INVALID_QUALITY_POLICY', lambda: load_map(directory))
        self.assertEqual(file_hashes(PUBLISHED), source_hashes)
        self.assertEqual(request, original_request)


if __name__ == '__main__':
    unittest.main()
