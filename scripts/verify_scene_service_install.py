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


PREPARE_POLICY=r'''
import copy, hashlib, json, pathlib, shutil, sys
request=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
root=pathlib.Path(request['repo']);work=pathlib.Path(request['work'])
sys.path.insert(0,str(root))
from adapter.scene_service import compile_scene, validate_result, load_map
from adapter.scene_service.checker import check_scene
from adapter.scene_service.map_package import publish_map, json_bytes
from adapter.scene_service.quality import current_policy
from adapter.scene_service.fixtures.taxonomy import layered_request

def hashes(directory):
    return {p.relative_to(directory).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob('*')) if p.is_file()}

def prepare(name,case,required):
    source=pathlib.Path(case['map_path']);before=hashes(source);source_ref=load_map(source)['map_ref']
    directory=work/name/'1'
    publish_map(source,directory,name,'1','安装验收：合成范围质量',evidence_mode='auto',
                rules_path=root/'adapter/scene_service/evidence_rules_v2.json',quality_policy=current_policy())
    package=load_map(directory);intent=copy.deepcopy(case['intent']);intent['map_ref']=package['map_ref']
    seed=case.get('assignment_seed',case.get('seed',42))
    # The installed child reads the sorted request JSON. Give the source the
    # identical object ordering too; then compare its original response bytes,
    # rather than mistaking serialization of differently ordered inputs for a
    # runtime difference.
    inputs=json.loads(json.dumps({'intent':intent,'snapshot':case['snapshot'],'plan':case['plan']},sort_keys=True,ensure_ascii=False))
    intent,snapshot,plan=inputs['intent'],inputs['snapshot'],inputs['plan']
    response=compile_scene(intent,snapshot,plan,package,assignment_seed=seed)
    if required:assert response['ok'],response
    if response['ok']:validate_result(response['result'],{'map':package,'snapshot':snapshot,'plan':plan})
    report=check_scene(intent,snapshot,plan,str(directory),assignment_seed=seed)
    assert bool(response['ok'])==bool(report['configuration_ok']),{'compile_ok':response['ok'],
        'failed_checks':[item for item in report['items'] if item['status']=='不通过']}
    assert hashes(source)==before,'Source map bytes were changed during installation preparation'
    return {'name':name,'intent':intent,'snapshot':snapshot,'plan':plan,'seed':seed,
            'map_path':str(directory),'expected':response,'expected_check':report,
            'expected_response_sha256':hashlib.sha256(json.dumps(response,ensure_ascii=False).encode('utf-8')).hexdigest(),
            'policy':copy.deepcopy(package['quality']['quality_policy']),'file_hashes':hashes(directory),
            'source_map_path':str(source),'source_map_ref':source_ref,'source_file_hashes':before}

synthetic=layered_request()
policy_case={'intent':{k:v for k,v in synthetic.items() if k not in ('map','snapshot','plan','assignment_seed')},
             'snapshot':synthetic['snapshot'],'plan':synthetic['plan'],'seed':synthetic['assignment_seed'],
             'map_path':str(root/'frontend/tests/fixtures/scene-taxonomy/maps/synthetic-taxonomy/1')}
cases=[prepare('synthetic-install-scope-quality',policy_case,True)]
if request.get('policy_input'):
    file=pathlib.Path(request['policy_input'])
    external=json.loads(file.read_text(encoding='utf-8'))
    source=pathlib.Path(external['map_path'])
    external['map_path']=str(source if source.is_absolute() else file.parent/source)
    cases.append(prepare('synthetic-install-external-scope',external,False))
# A valid manifest hash must not hide an invalid quality-policy body.
invalid=work/'malformed-scope-quality';shutil.copytree(cases[0]['map_path'],invalid)
quality_path=invalid/'quality.json';quality=json.loads(quality_path.read_bytes())
quality['quality_policy'].pop('rules');raw=json_bytes(quality);quality_path.write_bytes(raw)
manifest_path=invalid/'manifest.json';manifest=json.loads(manifest_path.read_bytes())
manifest['files']['quality.json']=hashlib.sha256(raw).hexdigest();manifest_path.write_bytes(json_bytes(manifest))
value={'policy_cases':cases,'invalid_policy_map':str(invalid),'invalid_policy_hashes':hashes(invalid)}
pathlib.Path(request['output']).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'policy_cases':[case['name'] for case in cases],'external_map_read_only':bool(request.get('policy_input'))}))
'''


CHILD=r'''
import ast, copy, hashlib, importlib.metadata, importlib.util, json, pathlib, sys
request=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
installed=sys.argv[2]=='installed'
if installed:
    import mecoffe_scene_service as service
    assert service.__version__=='0.2.2'
    assert service.SCENE_RESULT_SCHEMA_VERSIONS==('scene.result.v1','scene.result.v2','scene.result.v3')
    assert service.SCENE_RESULT_OUTPUT_SCHEMA_VERSION=='scene.result.v3'
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
    taxonomy=request['taxonomy']
    response=service.compile_scene(taxonomy['intent'],taxonomy['snapshot'],taxonomy['plan'],taxonomy['map'],assignment_seed=42)
    assert response==taxonomy['expected'],response
    service.validate_result(response['result'],{'map':taxonomy['map'],'snapshot':taxonomy['snapshot'],'plan':taxonomy['plan']})
    assert response['result']['schema_version']=='scene.result.v3'
    report=service.check_scene(taxonomy['intent'],taxonomy['snapshot'],taxonomy['plan'],taxonomy['map_path'],assignment_seed=42)
    assert report['configuration_ok'] and report['result']==response['result'],report
    assert report['evidence_usage']['by_source']['name_rule']>0 and report['evidence_usage']['ai_count']>0
    checks['taxonomy-v3']=report
    from mecoffe_scene_service.quality import validate_policy
    from mecoffe_scene_service.common import digest
    def hashes(directory):
        return {p.relative_to(directory).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(pathlib.Path(directory).rglob('*')) if p.is_file()}
    for case in request['policy_cases']:
        package=service.load_map(case['map_path']);original=copy.deepcopy(package)
        policy=package['quality']['quality_policy']
        assert policy==case['policy'] and policy['version']=='scope-quality.1'
        response=service.compile_scene(case['intent'],case['snapshot'],case['plan'],package,assignment_seed=case['seed'])
        assert response==case['expected'],response
        if response['ok']:
            service.validate_result(response['result'],{'map':package,'snapshot':case['snapshot'],'plan':case['plan']})
            assert response['result']['schema_version']=='scene.result.v3'
        report=service.check_scene(case['intent'],case['snapshot'],case['plan'],case['map_path'],assignment_seed=case['seed'])
        assert report==case['expected_check'],report
        assert package==original and hashes(case['map_path'])==case['file_hashes']
        assert hashes(case['source_map_path'])==case['source_file_hashes']
        # These hashes describe the frozen publisher, not the current runtime.
        historical=copy.deepcopy(policy);historical['implementation_files']['quality.py']='0'*64
        historical['implementation_sha256']=digest(historical['implementation_files'])
        historical['sha256']=digest({k:v for k,v in historical.items() if k!='sha256'})
        frozen=copy.deepcopy(historical)
        assert validate_policy(historical)==frozen and historical==frozen
        tampered=copy.deepcopy(policy);tampered['rules']['empty_connectivity_population_ready']=0
        tampered['sha256']=digest({k:v for k,v in tampered.items() if k!='sha256'})
        try:
            validate_policy(tampered)
        except service.SceneError as error:
            assert error.code=='INVALID_QUALITY_POLICY'
        else:
            raise AssertionError('False-to-zero policy tampering must not bypass its rules digest')
        responses[case['name']]=response;checks[case['name']]=report
    try:
        service.load_map(request['invalid_policy_map'])
    except service.SceneError as error:
        assert error.code=='INVALID_QUALITY_POLICY' and service.describe_issue(error.code)['user_message']
    else:
        raise AssertionError('A rehashed manifest must not accept an invalid quality policy')
    assert hashes(request['invalid_policy_map'])==request['invalid_policy_hashes']
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
    parser.add_argument('--policy-input',type=Path,help='可选本地JSON：map_path、intent、snapshot、plan、assignment_seed；原地图只读，另在临时目录发布并对照')
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
                 'taxonomy':read(ROOT/'frontend/tests/fixtures/scene-taxonomy/input-v3.json'),
                 'old_results':[str(ROOT/'adapter/scene_service/fixtures/map-valid.json'),
                                str(ROOT/'frontend/tests/fixtures/scene-auto/input-v2.json')]}
        request['taxonomy']['map_path']=str(ROOT/'frontend/tests/fixtures/scene-taxonomy/maps/synthetic-taxonomy/1')
        # Both fixtures wrap their original SceneResult; never rewrite a source fixture.
        old_v1=work/'old-v1.json';old_v1.write_bytes(json_bytes(read(request['old_results'][0])['result']))
        request['old_results'][0]=str(old_v1)
        old_v2=work/'old-v2.json';old_v2.write_bytes(json_bytes(read(request['old_results'][1])['scene_result']))
        request['old_results'][1]=str(old_v2)
        preparation=work/'prepare-policy.json';prepared=work/'policy-cases.json'
        preparation.write_bytes(json_bytes({'repo':str(ROOT),'work':str(work),'output':str(prepared),
            'policy_input':str(args.policy_input.resolve()) if args.policy_input else None}))
        run([args.python,'-I','-c',PREPARE_POLICY,preparation],work,'prepare-policy.log')
        request.update(read(prepared))
        file=work/'request.json';file.write_bytes(json_bytes(request))
        run([python,'-I','-c',CHILD,file,'baseline'],work,'baseline.log')
        run([python,'-I','-c',CHILD,file,'installed'],work,'installed.log')
        import hashlib
        hashes={}
        for case in request['cases']:
            name=case['name']+'.json';before=(work/'baseline'/name).read_bytes();after=(work/'installed'/name).read_bytes()
            if before!=after:raise AssertionError('Compile response bytes differ: '+case['name'])
            hashes[case['name']]=hashlib.sha256(after).hexdigest()
        policy_hashes={}
        for case in request['policy_cases']:
            after=(work/'installed'/(case['name']+'.json')).read_bytes()
            if case['expected_response_sha256']!=hashlib.sha256(after).hexdigest():
                raise AssertionError('Scope-policy compile response bytes differ: '+case['name'])
            policy_hashes[case['name']]={'sha256':hashlib.sha256(after).hexdigest(),'ok':case['expected']['ok'],
                                        'policy_version':case['policy']['version'],
                                        'policy_sha256':case['policy']['sha256'],
                                        'source_map_ref':case['source_map_ref'],'source_bytes_unchanged':True}
        for mode in ('baseline','installed'):
            target=out/mode
            if target.exists():raise ValueError('Use a fresh --out directory to preserve prior verification')
            shutil.copytree(work/mode,target)
        report={'ok':True,'baseline':BASELINE,'compile_responses_identical':hashes,
                'policy_compile_responses_identical':policy_hashes,
                'malformed_policy_rejected':'INVALID_QUALITY_POLICY',
                'package_manifest_sha256':hashlib.sha256((package/'EXPORT_MANIFEST.json').read_bytes()).hexdigest(),
                'python_version':version.stdout.strip(),'installation':'local directory; no index/deps/build isolation',
                'installed_module':read(work/'installed/metadata.json')['module_path'],
                'note':'Temporary isolated environment is removed after verification; paths are retained as evidence.'}
        (out/'report.json').write_bytes(json_bytes(report));print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0


if __name__=='__main__':sys.exit(main())
