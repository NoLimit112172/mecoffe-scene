"""Offline Python 3.11 installation and c0bf430 byte comparison; no engine/network."""
import argparse
import copy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

from export_scene_service import DEFAULT_OUT, ROOT, build_export, check_export, json_bytes

BASELINE='c0bf4302b9005f6dc0e08f8d3baabe339fba7e9e'


def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))


def cases():
    fixture=ROOT/'adapter/scene_service/fixtures'
    snapshot=read(fixture/'snapshot.json');plan=read(fixture/'plan.json')
    ustc={'name':'ustc-v2','intent':read(fixture/'check/intent-ustc-v2.json'),
          'snapshot':snapshot,'plan':plan,'map_path':str(ROOT/'data/maps/ustc-gaoxin/2'),'seed':42}
    auto_dir=ROOT/'frontend/tests/fixtures/scene-auto'
    auto=read(auto_dir/'input-v2.json');result=auto['scene_result']
    automatic={'name':'frozen-auto-v2','intent':{**result['rules'],'mode':'map','config_id':auto['config_id'],
               'map_ref':result['map_ref'],'assumptions':result['assumptions']},'snapshot':auto['snapshot'],
               'plan':auto['plan'],'map_path':str(auto_dir/'maps/synthetic-auto/1'),
               'seed':result['assignment_meta']['assignment_seed']}
    internal_auto=copy.deepcopy(automatic);internal_auto.update(name='internal-auto-v2',unfreeze=True)
    none={'name':'none','intent':read(fixture/'prefs-none.json'),'snapshot':snapshot,'plan':plan,
          'map_path':str(ROOT/'logs/nonexistent-map-must-not-be-read'),'seed':42}
    legacy=read(fixture/'request.json')
    internal={'name':'legacy-internal','intent':{k:v for k,v in legacy.items() if k not in ('snapshot','plan','map')},
              'snapshot':legacy['snapshot'],'plan':legacy['plan'],'map_value':legacy['map'],
              'seed':legacy['assignment_seed']}
    function=copy.deepcopy(ustc);function['name']='unknown-function'
    next(iter(function['intent']['role_prefs'].values()))['functions']=['synthetic_invalid_function']
    brand=copy.deepcopy(ustc);brand['name']='brand-rename'
    brand['plan']['economy']['products'][0]['product_name']='合成改名品牌'
    return [ustc,automatic,internal_auto,none,internal,function,brand]


CHILD=r'''
import ast, hashlib, importlib.metadata, importlib.util, json, pathlib, sys
request=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
installed=sys.argv[2]=='installed'
if installed:
    import mecoffe_scene_service as service
    assert service.__version__=='0.1.0'
    assert service.SCENE_RESULT_SCHEMA_VERSIONS==('scene.result.v1','scene.result.v2')
    assert service.SCENE_RESULT_OUTPUT_SCHEMA_VERSION=='scene.result.v2'
    assert not importlib.metadata.distribution('mecoffe-scene-service').requires
    package=pathlib.Path(service.__file__).resolve().parent
    assert package.is_relative_to(pathlib.Path(sys.prefix).resolve())
    assert not any(pathlib.Path(p).resolve()==pathlib.Path(request['repo']).resolve() for p in sys.path if p)
    for name in ('__main__','map_package'):
        assert importlib.util.find_spec('mecoffe_scene_service.'+name) is None
    from mecoffe_scene_service import auto_evidence
    assert not hasattr(auto_evidence,'prepare_ai_review')
    for source in package.rglob('*.py'):
        for node in ast.walk(ast.parse(source.read_text(encoding='utf-8'))):
            if isinstance(node,ast.ImportFrom) and node.module: assert node.module.split('.')[0]!='adapter'
            if isinstance(node,ast.Import): assert all(alias.name.split('.')[0]!='adapter' for alias in node.names)
else:
    sys.path.insert(0,request['baseline_root'])
    import adapter.scene_service as service
    from adapter.scene_service.checker import check_scene
    assert pathlib.Path(service.__file__).resolve().is_relative_to(pathlib.Path(request['baseline_root']).resolve())
responses={};checks={}
for case in request['cases']:
    package=None if case['intent']['mode']=='none' else case.get('map_value') or service.load_map(case['map_path'])
    if case.get('unfreeze'):package.pop('evidence_frozen',None)
    response=service.compile_scene(case['intent'],case['snapshot'],case['plan'],package,assignment_seed=case['seed'])
    if case['name'] in ('unknown-function','brand-rename'):
        expected='UNKNOWN_FUNCTION' if case['name']=='unknown-function' else 'BRAND_NAME_MISMATCH'
        assert not response['ok'] and response['error']['code']==expected,response
        assert response['error']['user_message'] and service.describe_issue(expected)['admin_message']
    else:
        assert response['ok'],response
        service.validate_result(response['result'])
        assert response['result']['schema_version']=='scene.result.v2'
    responses[case['name']]=response
    if installed and case['name'] in ('ustc-v2','frozen-auto-v2','none'):
        report=service.check_scene(case['intent'],case['snapshot'],case['plan'],case['map_path'],assignment_seed=case['seed'])
        assert report['configuration_ok'],report
        assert report['conclusion']=='配置期检查通过，运行绑定待确认'
        if case['name']=='frozen-auto-v2':
            assert report['evidence_usage']['ai_count']>0 and report['evidence_usage']['by_source']['name_rule']>0
        checks[case['name']]=report
for file in request['old_results']:
    service.validate_result(json.loads(pathlib.Path(file).read_text(encoding='utf-8')))
if installed:
    damaged=json.loads(json.dumps(responses['ustc-v2']['result']));damaged['result_sha256']='0'*64
    try:
        service.validate_result(damaged)
    except service.SceneError as error:
        assert error.code=='HASH_MISMATCH' and service.describe_issue(error.code)['user_message']
    else:
        raise AssertionError('Public SceneError must preserve validator errors')
out=pathlib.Path(request['output'])/sys.argv[2];out.mkdir()
for name,response in responses.items():
    (out/(name+'.json')).write_bytes(json.dumps(response,ensure_ascii=False).encode('utf-8'))
(out/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
metadata={'module_path':service.__file__,'python':sys.version,'prefix':sys.prefix,'sys_path':sys.path,
          'cases':list(responses),'old_results':request['old_results']}
if installed:
    assert not any(name=='adapter' or name.startswith('adapter.') for name in sys.modules)
    metadata['runtime_dependencies']=importlib.metadata.distribution('mecoffe-scene-service').requires or []
(out/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(metadata,ensure_ascii=False))
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python',type=Path,required=True)
    parser.add_argument('--package',type=Path,default=DEFAULT_OUT)
    parser.add_argument('--out',type=Path,default=ROOT/'logs/milestone15-batch7-install')
    args=parser.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    env={k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
    env.update(PIP_NO_INDEX='1',PIP_DISABLE_PIP_VERSION_CHECK='1',PYTHONIOENCODING='utf-8')
    def run(command,cwd,log):
        result=subprocess.run([str(v) for v in command],cwd=cwd,env=env,capture_output=True,encoding='utf-8',errors='replace')
        (out/log).write_text(result.stdout+result.stderr,encoding='utf-8')
        if result.returncode:raise RuntimeError(f'{log}: command failed ({result.returncode}); inspect local log')
        return result
    check_export(args.package,build_export())
    with tempfile.TemporaryDirectory(prefix='mecoffe-scene-install-') as temporary:
        work=Path(temporary)
        version=run([args.python,'-I','-c','import sys;assert sys.version_info[:2]==(3,11);print(sys.version)'],work,'python-version.log')
        venv=work/'venv';run([args.python,'-I','-m','venv',venv],work,'create-venv.log')
        python=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        run([python,'-I','-c',"import importlib.metadata as m;print('pip',m.version('pip'));print('setuptools',m.version('setuptools'))"],work,'build-tools.log')
        package=work/'delivery';shutil.copytree(args.package,package)
        run([python,'-I',package/'verify_export.py'],work,'verify-delivery.log')
        run([python,'-I','-m','pip','install','--no-index','--no-deps','--no-build-isolation','--no-cache-dir',package],work,'install.log')
        baseline=work/'baseline-source';baseline.mkdir()
        raw=subprocess.check_output(['git','archive','--format=tar',BASELINE,'adapter'],cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            # The selected tracked tree must stay in this temporary baseline directory.
            for member in archive.getmembers():
                if not (baseline/member.name).resolve().is_relative_to(baseline.resolve()) or member.issym() or member.islnk():
                    raise ValueError('Unsafe baseline archive member')
            archive.extractall(baseline,filter='data')
        request={'repo':str(ROOT),'baseline_root':str(baseline),'cases':cases(),'output':str(work),
                 'old_results':[str(ROOT/'adapter/scene_service/fixtures/map-valid.json'),
                                str(ROOT/'frontend/tests/fixtures/scene-auto/input-v2.json')]}
        # Both fixtures wrap their original SceneResult; never rewrite a source fixture.
        old_v1=work/'old-v1.json';old_v1.write_bytes(json_bytes(read(request['old_results'][0])['result']))
        request['old_results'][0]=str(old_v1)
        old_v2=work/'old-v2.json';old_v2.write_bytes(json_bytes(read(request['old_results'][1])['scene_result']))
        request['old_results'][1]=str(old_v2)
        file=work/'request.json';file.write_bytes(json_bytes(request))
        run([python,'-I','-c',CHILD,file,'baseline'],work,'baseline.log')
        run([python,'-I','-c',CHILD,file,'installed'],work,'installed.log')
        import hashlib
        hashes={}
        for case in request['cases']:
            name=case['name']+'.json';before=(work/'baseline'/name).read_bytes();after=(work/'installed'/name).read_bytes()
            if before!=after:raise AssertionError('Compile response bytes differ: '+case['name'])
            hashes[case['name']]=hashlib.sha256(after).hexdigest()
        for mode in ('baseline','installed'):
            target=out/mode
            if target.exists():raise ValueError('Use a fresh --out directory to preserve prior verification')
            shutil.copytree(work/mode,target)
        report={'ok':True,'baseline':BASELINE,'compile_responses_identical':hashes,
                'package_manifest_sha256':hashlib.sha256((package/'EXPORT_MANIFEST.json').read_bytes()).hexdigest(),
                'python_version':version.stdout.strip(),'installation':'local directory; no index/deps/build isolation',
                'installed_module':read(work/'installed/metadata.json')['module_path'],
                'note':'Temporary isolated environment is removed after verification; paths are retained as evidence.'}
        (out/'report.json').write_bytes(json_bytes(report));print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0


if __name__=='__main__':sys.exit(main())
