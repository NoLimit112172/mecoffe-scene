"""The shipped physical-map command runs with -I outside the source tree."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from adapter.test_physical_map import fixture, SCOPES
from package_scene_builder import package_builder, PREPARED_MAP_FILES, ROOT
from scene_split_manifest import ASSET_DIRECTORY, json_bytes


class PhysicalPackageCase(unittest.TestCase):
    def test_offline_command_and_new_modules_are_in_digest_verified_isolated_payload(self):
        with TemporaryDirectory() as temporary:
            work = Path(temporary)
            legacy = work/'legacy'
            official = ROOT/'data/maps/ustc-gaoxin/1'
            hashes = {}
            for name in PREPARED_MAP_FILES:
                target = legacy/name;target.parent.mkdir(parents=True,exist_ok=True)
                raw = (official/name).read_bytes();target.write_bytes(raw)
                hashes[name] = hashlib.sha256(raw).hexdigest()
            (legacy/'scenario.json').write_bytes(json_bytes({'schema_version':'mecoffe.scenario.v1',
                'id':'ustc-config-map','simulation_data':False,'files':hashes}))
            artifact = package_builder(ASSET_DIRECTORY/'catalog.json',legacy,work/'release','a'*40)
            with ZipFile(artifact) as archive:
                record = json.loads(archive.read('artifact.json'))
                for entry in record['files']:
                    self.assertEqual(hashlib.sha256(archive.read('payload/'+entry['path'])).hexdigest(),entry['sha256'])
                self.assertTrue({'payload/adapter/scene_builder/physical_map.py',
                                 'payload/adapter/scene_builder/physical_scope.py',
                                 'payload/adapter/scene_service/spatial_index.py',
                                 'payload/scripts/prepare-physical-map.py'} <= set(archive.namelist()))
                archive.extractall(work/'unpacked')
            payload = work/'unpacked/payload'
            osm,metadata = fixture(work/'input')
            scope = work/'scope.json';scope.write_text(json.dumps(SCOPES['hole']),encoding='utf-8')
            verify = subprocess.run([sys.executable,'-I','-B','-c',
                'import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);'
                'import adapter.scene_builder.physical_map as p;'
                'assert Path(p.__file__).resolve().is_relative_to(Path(sys.argv[1]).resolve());'
                'print(p.RECIPE_VERSION)',str(payload)],cwd=work,capture_output=True,text=True)
            self.assertEqual(verify.returncode,0,verify.stderr)
            result = subprocess.run([sys.executable,'-I','-B',str(payload/'scripts/prepare-physical-map.py'),
                '--osm',str(osm),'--metadata',str(metadata),'--scope',str(scope),
                '--map-id','synthetic-packaged','--title','Synthetic packaged map',
                '--rules',str(payload/'adapter/scene_service/evidence_rules_v2.json'),
                '--out',str(work/'map')],cwd=work,capture_output=True,text=True,encoding='utf-8',timeout=60)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            response = json.loads(result.stdout)
            self.assertEqual(response['summary']['status'],'ready')
            manifest = (work/'map/manifest.json').read_bytes()
            self.assertEqual(response['map_ref']['manifest_sha256'],hashlib.sha256(manifest).hexdigest())
            for name,digest in json.loads(manifest)['files'].items():
                self.assertEqual(hashlib.sha256((work/'map'/name).read_bytes()).hexdigest(),digest)
            self.assertEqual([json.loads(line)['phase'] for line in result.stderr.splitlines()],
                             ['reading','geometry','entrances_gis','evidence_quality','publishing'])


if __name__ == '__main__':
    unittest.main()
