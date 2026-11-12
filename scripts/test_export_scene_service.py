"""Generated delivery has one source and fails closed on stale/altered files."""
import ast
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

from export_scene_service import (ROOT, DEFAULT_OUT, IMPORT_NAME, MANIFEST, VERSION, build_export,
                                 check_export, check_import_dependencies, input_paths, lf, runtime_module,
                                 write_export)

# Deliberate release lock, in addition to source/export and per-file checks.
RELEASE_MANIFEST_SHA256 = '5103bce165426d1d339c215b5c230109a25d05cbf61503c1471fefc0be80173f'


class SceneServiceExportTests(unittest.TestCase):
    def source_copy(self,target):
        for name in input_paths()+['scripts/export_scene_service.py']:
            file=target/name;file.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/name,file)

    def test_committed_delivery_matches_source_and_is_reproducible(self):
        expected=build_export()
        self.assertTrue(check_export(DEFAULT_OUT,expected)['ok'])
        self.assertEqual(expected,build_export())
        manifest=json.loads(expected[MANIFEST])
        self.assertEqual(manifest['package']['version'],VERSION)
        self.assertEqual(len(manifest['source_commit']),40)
        self.assertNotIn('timestamp',manifest)
        self.assertNotIn(str(ROOT),json.dumps(manifest))
        self.assertEqual(expected[f'src/{IMPORT_NAME}/resources/mecoffe-embed-v1/catalog.json'],
                         (ROOT/'adapter/scene_builder/resources/mecoffe-embed-v1/catalog.json').read_bytes())
        # Text checkout newline conversions do not change the exported release.
        raw=(ROOT/'adapter/scene_service/common.py').read_bytes()
        self.assertEqual(runtime_module('common',lf(raw)),runtime_module('common',lf(raw).replace(b'\n',b'\r\n')))

    def test_changed_added_and_missing_export_files_are_detected(self):
        expected=build_export()
        target_name=f'src/{IMPORT_NAME}/common.py'
        for mode in ('changed','added','missing'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temporary:
                target=Path(temporary)/'package';write_export(target,expected)
                file=target/target_name
                if mode=='changed':file.write_bytes(file.read_bytes()+b'\n# altered export\n')
                elif mode=='added':(target/'unexpected.py').write_text('unexpected',encoding='utf-8')
                else:file.unlink()
                with self.assertRaises(ValueError):check_export(target,expected)
                with self.assertRaises(ValueError):runpy.run_path(str(target/'verify_export.py'))['verify'](target)

    def test_source_change_invalidates_export_without_touching_real_source(self):
        expected=build_export();revision=json.loads(expected[MANIFEST])['source_commit']
        with tempfile.TemporaryDirectory() as temporary:
            source=Path(temporary)/'source';out=Path(temporary)/'package'
            for name in input_paths()+['scripts/export_scene_service.py']:
                target=source/name;target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(ROOT/name,target)
            self.assertEqual(build_export(source,source_commit=revision),expected)
            write_export(out,expected)
            changed=source/'adapter/scene_service/compiler.py'
            changed.write_bytes(changed.read_bytes()+b'\n# synthetic source modification\n')
            regenerated=build_export(source,source_commit=revision)
            with self.assertRaises(ValueError):check_export(out,regenerated)
            self.assertNotEqual(json.loads(expected[MANIFEST])['inputs'],json.loads(regenerated[MANIFEST])['inputs'])

    def test_package_metadata_and_runtime_scope(self):
        import tomllib
        files=build_export();metadata=tomllib.loads(files['pyproject.toml'].decode())
        self.assertEqual(metadata['project']['dependencies'],[])
        self.assertEqual(metadata['project']['requires-python'],'>=3.11,<3.12')
        self.assertEqual(metadata['build-system']['requires'],['setuptools>=68'])
        self.assertNotIn('scripts',metadata['project'])
        names='\n'.join(files)
        for forbidden in ('/fixtures/','/tests/','/maps/','/map_package.py','/__main__.py','osm_to','scene_builder/'):
            self.assertNotIn(forbidden,names)
        auto=ast.parse(files[f'src/{IMPORT_NAME}/auto_evidence.py'].decode())
        self.assertNotIn('prepare_ai_review',{n.name for n in auto.body if isinstance(n,ast.FunctionDef)})
        self.assertNotIn('default_rules',{n.name for n in auto.body if isinstance(n,ast.FunctionDef)})
        for name,raw in files.items():
            if not name.startswith('src/') or not name.endswith('.py'):continue
            for node in ast.walk(ast.parse(raw.decode())):
                if isinstance(node,ast.ImportFrom) and node.module:
                    self.assertNotEqual(node.module.split('.')[0],'adapter',name)
                    if not node.level:self.assertIn(node.module.split('.')[0],sys.stdlib_module_names,name)
                if isinstance(node,ast.Import):
                    self.assertTrue(all(n.name.split('.')[0]!='adapter' for n in node.names),name)
                    self.assertTrue(all(n.name.split('.')[0] in sys.stdlib_module_names for n in node.names),name)

    def test_unexpected_source_import_requires_recipe_review(self):
        with self.assertRaises(ValueError):runtime_module('compiler',b'import adapter.unexpected\n')
        with self.assertRaises(ValueError):runtime_module('maps',b'import json\n')

    def test_standalone_verifier_does_not_need_source_repository(self):
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'package';write_export(target,build_export())
            process=subprocess.run([sys.executable,'-I',str(target/'verify_export.py')],cwd=temporary,
                                   capture_output=True,encoding='utf-8')
            self.assertEqual(process.returncode,0,process.stderr)
            self.assertTrue(json.loads(process.stdout)['ok'])

    def test_new_referenced_module_fails_before_export_and_check(self):
        imports=('from .newmod import HELPER','from . import newmod',
                 'import mecoffe_scene_service.newmod',
                 'from mecoffe_scene_service.newmod import HELPER',
                 'from mecoffe_scene_service import newmod')
        for statement in imports:
            with self.subTest(statement=statement),tempfile.TemporaryDirectory() as temporary:
                source=Path(temporary)/'source';self.source_copy(source)
                compiler=source/'adapter/scene_service/compiler.py'
                compiler.write_text(statement+'\n'+compiler.read_text(encoding='utf-8'),encoding='utf-8')
                (compiler.parent/'newmod.py').write_text('HELPER = 1\n',encoding='utf-8')
                with self.assertRaisesRegex(ValueError,r'compiler\.py:.*newmod.*newmod\.py'):
                    build_export(source,source_commit='0'*40)
                # Both public CLI paths must fail before writing anything or asking Git for a revision.
                for flag in ([],['--check']):
                    out=Path(temporary)/'output'
                    process=subprocess.run([sys.executable,str(source/'scripts/export_scene_service.py'),
                                            '--out',str(out),*flag],cwd=temporary,
                                           capture_output=True,encoding='utf-8')
                    self.assertEqual(process.returncode,1,process.stdout)
                    self.assertIn('compiler.py',process.stderr);self.assertIn('newmod.py',process.stderr)
                    self.assertFalse(out.exists())

    def test_new_unclassified_python_and_json_files_fail(self):
        for name in ('unused.py','unused.json','nested/unused.py','nested/unused.json'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as temporary:
                source=Path(temporary)/'source';self.source_copy(source)
                file=source/'adapter/scene_service'/name;file.parent.mkdir(parents=True,exist_ok=True)
                file.write_text('{}\n',encoding='utf-8')
                with self.assertRaises(ValueError) as error:build_export(source,source_commit='0'*40)
                self.assertIn('未归类',str(error.exception));self.assertIn(name,str(error.exception))
                for flag in ([],['--check']):
                    out=Path(temporary)/'output'
                    process=subprocess.run([sys.executable,str(source/'scripts/export_scene_service.py'),
                                            '--out',str(out),*flag],cwd=temporary,
                                           capture_output=True,encoding='utf-8')
                    self.assertEqual(process.returncode,1,process.stdout)
                    self.assertIn(name,process.stderr);self.assertFalse(out.exists())

    def test_explicitly_excluded_sources_do_not_change_payload(self):
        revision='0'*40;expected=build_export(source_commit=revision)
        with tempfile.TemporaryDirectory() as temporary:
            source=Path(temporary)/'source';self.source_copy(source)
            for name in ('map_package.py','__main__.py','__init__.py','evidence_rules.json',
                         'fixtures/new-fixture.json','tests/new_test.py','__pycache__/cache.json'):
                file=source/'adapter/scene_service'/name;file.parent.mkdir(parents=True,exist_ok=True)
                file.write_text('explicitly excluded synthetic content\n',encoding='utf-8')
            actual=build_export(source,source_commit=revision)
            self.assertEqual(actual,expected)
            policy=json.loads(actual[MANIFEST])['exporter']['source_policy']
            self.assertIn('map_package.py',policy['excluded_files'])
            self.assertIn('fixtures',policy['excluded_directories'])

    def test_import_graph_accepts_present_modules_and_rejects_missing_excluded_or_parent(self):
        files=build_export();name=f'src/{IMPORT_NAME}/compiler.py'
        valid=('from . import common','from .common import digest',
               'import mecoffe_scene_service.common as common',
               'from mecoffe_scene_service import common',
               'from mecoffe_scene_service.common import digest',
               'from mecoffe_scene_service import compile_scene')
        for statement in valid:
            with self.subTest(statement=statement):
                check_import_dependencies({**files,name:(statement+'\n').encode()+files[name]})
        for statement in ('from .map_package import publish_map','from . import fixtures',
                          'from ..newmod import HELPER','from .unknown.module import HELPER'):
            with self.subTest(statement=statement),self.assertRaises(ValueError):
                check_import_dependencies({**files,name:(statement+'\n').encode()+files[name]})

    def test_runtime_020_manifest_is_locked_and_old_contracts_assets_are_identical(self):
        files=build_export()
        self.assertEqual(hashlib.sha256(files[MANIFEST]).hexdigest(),RELEASE_MANIFEST_SHA256)
        frozen=['contract.json','contract-v2.json','resources/mecoffe-embed-v1/catalog.json',
                'resources/mecoffe-embed-v1/asset-library.json']
        for relative in frozen:
            name=f'src/{IMPORT_NAME}/{relative}'
            before=subprocess.check_output(['git','show','39b4ae1:packages/scene-service/'+name],cwd=ROOT)
            self.assertEqual(files[name],before,name)
        manifest=json.loads(files[MANIFEST])
        self.assertEqual(manifest['package']['version'],'0.2.0')
        self.assertEqual(manifest['exporter']['version'],'3')
        contract=json.loads(files[f'src/{IMPORT_NAME}/contract-v3.json'])
        self.assertEqual(contract['properties']['schema_version']['const'],'scene.result.v3')
        self.assertIn('layer',contract['properties']['assignments']['items']['properties']['evidence']['items']['required'])


if __name__=='__main__':unittest.main()
