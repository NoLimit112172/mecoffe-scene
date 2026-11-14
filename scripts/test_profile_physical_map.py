"""Integrity checks for the offline physical-map benchmark, without network."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from profile_physical_map import audit_provenance_changes, compare_candidates, freeze_inputs, observed_stage_seconds, run_cli

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT/'adapter/physical_map_examples/performance/cases.json'


class PhysicalMapBenchmarkTests(unittest.TestCase):
    def test_every_real_case_archive_matches_metadata_and_expected_source_hash(self):
        specification=json.loads(CASES_PATH.read_bytes())
        self.assertTrue(specification['cases'])
        for case in specification['cases']:
            with self.subTest(case=case['id']):
                raw=(ROOT/case['osm']).read_bytes()
                metadata=json.loads((ROOT/case['metadata']).read_bytes())
                self.assertEqual(hashlib.sha256(raw).hexdigest(),metadata['sha256'])
                self.assertEqual(metadata['sha256'],case['expected_source_sha256'])

    def test_real_archives_survive_git_autocrlf_checkout_without_byte_conversion(self):
        """Exercise Git checkout conversion locally; this is not a Windows run."""
        specification=json.loads(CASES_PATH.read_bytes())
        paths={specification[field] for field in ['rules','limits']}
        paths.update(case[field] for case in specification['cases']
                     for field in ['osm','metadata','scope','scope_source'])
        original={name:(ROOT/name).read_bytes() for name in paths}
        with tempfile.TemporaryDirectory(prefix='physical-map-autocrlf-') as temporary:
            work=Path(temporary);repo=work/'repository';repo.mkdir()
            def git(*arguments):
                return subprocess.run(['git','-C',str(repo),*arguments],check=True,
                                      capture_output=True,text=True)
            git('init','--quiet')
            git('config','core.autocrlf','true')
            git('config','core.safecrlf','false')
            git('config','core.attributesFile',os.devnull)
            (repo/'.gitattributes').write_bytes((ROOT/'.gitattributes').read_bytes())
            for name,raw in original.items():
                target=repo/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
            control=b'unprotected first line\nunprotected second line\n'
            (repo/'conversion-control.txt').write_bytes(control)
            git('add','--all')
            for case in specification['cases']:
                attributes=git('check-attr','text','diff','--',case['osm']).stdout.splitlines()
                self.assertIn(case['osm']+': text: unset',attributes)
                self.assertIn(case['osm']+': diff: set',attributes)
            checkout=work/'checkout';checkout.mkdir()
            git('checkout-index','--all','--prefix='+str(checkout)+os.sep)
            self.assertEqual((checkout/'conversion-control.txt').read_bytes(),
                             control.replace(b'\n',b'\r\n'),
                             'The checkout must actually exercise CRLF conversion for unprotected text')
            frozen,_=freeze_inputs(checkout,specification,work/'valid-frozen',None)
            self.assertEqual(len(frozen),len(specification['cases']))
            for case in specification['cases']:
                with self.subTest(case=case['id']):
                    raw=original[case['osm']]
                    self.assertIn(b'\n',raw)
                    self.assertNotIn(b'\r\n',raw)
                    self.assertEqual((checkout/case['osm']).read_bytes(),raw)
                    self.assertEqual(hashlib.sha256(raw).hexdigest(),case['expected_source_sha256'])
                    # Reproduce the original review failure only in this
                    # temporary checkout; production XML/metadata stay intact.
                    converted=raw.replace(b'\n',b'\r\n')
                    self.assertNotEqual(hashlib.sha256(converted).hexdigest(),case['expected_source_sha256'])
                    (checkout/case['osm']).write_bytes(converted)
                    with self.assertRaisesRegex(ValueError,'hash mismatch'):
                        freeze_inputs(checkout,specification,work/('corrupt-'+case['id']),[case['id']])
                    (checkout/case['osm']).write_bytes(raw)
        for name,raw in original.items():
            self.assertEqual((ROOT/name).read_bytes(),raw,'The source input must remain unchanged')

    def test_freeze_rejects_xml_metadata_disagreement_and_preserves_original_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);repo=root/'source';repo.mkdir()
            xml=b'<osm version="0.6"/>\n'
            (repo/'map.osm').write_bytes(xml)
            metadata={'bbox':[0,0,1,1],'sha256':hashlib.sha256(xml).hexdigest()}
            for name,value in [('map.metadata.json',metadata),('scope.json',{'type':'Polygon'}),
                               ('source.json',{'type':'manual'}),('rules.json',{}),('limits.json',{})]:
                (repo/name).write_text(json.dumps(value)+'\n')
            spec={'rules':'rules.json','limits':'limits.json','road_buffer_m':50,'seed':'0','cases':[
                {'id':'case','osm':'map.osm','metadata':'map.metadata.json','scope':'scope.json',
                 'scope_source':'source.json','expected_source_sha256':metadata['sha256']}]}
            cases,_=freeze_inputs(repo,spec,root/'valid',None)
            self.assertEqual(Path(cases[0]['metadata']).read_bytes(),(repo/'map.metadata.json').read_bytes())
            self.assertEqual(Path(cases[0]['osm']).read_bytes(),xml)
            (repo/'map.osm').write_bytes(xml+b' ')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                freeze_inputs(repo,spec,root/'tampered',None)

    def test_stage_observations_account_for_startup_and_final_publish(self):
        result=observed_stage_seconds([{'phase':'reading','observed_seconds':.2},
                                      {'phase':'geometry','observed_seconds':.5},
                                      {'phase':'publishing','observed_seconds':1.4}],1.7)
        self.assertAlmostEqual(result['startup'],.2)
        self.assertAlmostEqual(result['geometry'],.9)
        self.assertAlmostEqual(result['publishing'],.3)
        self.assertAlmostEqual(sum(result.values()),1.7)

    def test_byte_comparison_masks_nothing_and_rejects_semantic_or_serialization_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);left=root/'left';right=root/'right';left.mkdir();right.mkdir()
            value={'builder':{'implementation_sha256':'0'*64},'eligible':False}
            (left/'campus3d.json').write_text(json.dumps(value)+'\n')
            (right/'campus3d.json').write_bytes((left/'campus3d.json').read_bytes())
            self.assertTrue(compare_candidates(left,right)['all_bytes_identical'])
            value['eligible']=True
            (right/'campus3d.json').write_text(json.dumps(value)+'\n')
            change=compare_candidates(left,right)
            self.assertFalse(change['all_bytes_identical'])
            self.assertEqual(change['json_changes']['campus3d.json'][0]['path'],'$.eligible')
            (right/'campus3d.json').write_text((left/'campus3d.json').read_text().rstrip())
            self.assertFalse(compare_candidates(left,right)['all_bytes_identical'])
            self.assertEqual(compare_candidates(left,right)['json_changes']['campus3d.json'],[])
            (right/'extra.json').write_text('{}')
            self.assertIn('extra.json',compare_candidates(left,right)['changed_files'])

    def test_raw_audit_rejects_other_builder_fields_or_payload_changes(self):
        comparison={'changed_files':['campus3d.json'],'json_changes':{'campus3d.json':[
            {'path':'$.source.physical_map.builder.implementation_sha256','before':'a','after':'b'}]}}
        self.assertTrue(audit_provenance_changes(comparison,{}, {})['only_implementation_fingerprint_and_dependent_hashes_changed'])
        comparison['json_changes']['campus3d.json'].append({'path':'$.buildings[0].levels','before':3,'after':9})
        self.assertFalse(audit_provenance_changes(comparison,{}, {})['only_implementation_fingerprint_and_dependent_hashes_changed'])
        comparison['json_changes']['campus3d.json']=[{'path':'$.source.physical_map.builder.version','before':'1','after':'2'}]
        self.assertFalse(audit_provenance_changes(comparison,{}, {})['only_implementation_fingerprint_and_dependent_hashes_changed'])
        self.assertFalse(audit_provenance_changes({'changed_files':[],'json_changes':{}},{'quality':{'status':'preview_only'}},{'quality':{'status':'ready'}})['only_implementation_fingerprint_and_dependent_hashes_changed'])

    @unittest.skipUnless(hasattr(os,'wait4'),'per-child RSS uses POSIX wait4')
    def test_measured_process_keeps_raw_streams_and_observes_the_phase_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);runtime=root/'runtime';(runtime/'scripts').mkdir(parents=True)
            (runtime/'scripts/prepare-physical-map.py').write_text('''import json,pathlib,sys,time
candidate=pathlib.Path(sys.argv[sys.argv.index('--out')+1])
assert not candidate.exists()
for phase in ['reading','geometry','entrances_gis','evidence_quality','publishing']:
 print(json.dumps({'phase':phase}),file=sys.stderr,flush=True)
 time.sleep(.005)
candidate.mkdir();(candidate/'payload.json').write_text('{}\\n')
print(json.dumps({'summary':{'status':'preview_only','buildings':1},'recipe':{'builder':{'version':'test'}}}))
''')
            case={'osm':'unused.osm','metadata':'unused.json','scope':'scope.json','scope_source':'source.json',
                  'map_id':'test-map','map_version':'1','title':'中文标题'}
            shared={'rules':'rules.json','limits':'limits.json','road_buffer_m':50,'seed':'0'}
            measurement=run_cli(sys.executable,runtime,case,shared,root/'run',10)
            self.assertEqual(measurement['exit_code'],0)
            self.assertTrue(measurement['phase_sequence_matches_contract'])
            self.assertGreater(measurement['peak_rss_bytes'],0)
            self.assertGreater(measurement['wall_seconds'],.025)
            self.assertAlmostEqual(sum(measurement['observed_stage_seconds'].values()),measurement['wall_seconds'])
            self.assertEqual(len((root/'run/stderr.jsonl').read_text().splitlines()),5)
            self.assertEqual(json.loads((root/'run/stdout.json').read_bytes())['summary']['status'],'preview_only')


if __name__=='__main__':
    unittest.main()
