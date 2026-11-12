"""Local configuration diagnostics; no engine registration or run binding."""
import copy
import hashlib
import json
from pathlib import Path
import re

from ._asset_library import published_asset_library
from .common import SceneError, canonical, digest, require
from .compiler import compile_scene
from .evidence import enrich_map
from .issues import describe_issue
from .maps import load_map
from .request import adapt_intent, adapt_request
from .resolver import normalize_prefs
from .validation import CONTRACT, brand_catalog, check_schema, indexed, validate_result

CHECKS = (
    ('input','入口对象与显式模式'),
    ('selectors','角色、品牌、经营者与用途偏好'),
    ('seed','独立安置种子的提供与对齐'),
    ('map_manifest','地图目录、清单摘要与身份'),
    ('map_catalog','地图与登记发布素材配套'),
    ('map_files','地图文件清单与原始字节摘要'),
    ('map_quality','归档质量与证据重算'),
    ('compile','复用原编译入口'),
    ('validate','复用原结果与上下文校验'),
    ('hash','重新计算结果摘要'),
    ('repeat','同输入重复编译一致'),
)
PENDING = (
    ('runtime_binding','运行绑定','等待褚凌宇确认运行创建/提交时序、不可变正文绑定及初始化失败恢复方式。'),
    ('actual_plan','实际执行计划关系','等待实际冻结计划及可靠来源，确认提交时改动、plan_revision 关系和 bundle_sha256；本检查不推断相容、不调整修订号。'),
    ('storage','存储与只读读取','等待团队确认存储位置、正文保留、归属权限及只读读取契约。'),
)
# Formal map resource envelope only; placement and result rules stay in the existing code.
MAP_FILES = {'campus3d.json','entrances.json','landcover.json','asset_assignments.json','quality.json',
             *[f'gis/{name}.geojson' for name in ('buildings','roads','landcover','water','boundary','pois','entrances')]}
EXPECTED_ERRORS = (ValueError, OSError, KeyError, TypeError, AttributeError, IndexError, OverflowError)


def local_path(value):
    require(isinstance(value,(str,Path)) and bool(str(value)) and
            not str(value).startswith(('\\\\','//')) and '://' not in str(value),
            'INVALID_MAP_BASE','Use a local path, not a URL or UNC network path')
    return Path(value)


def _new_report():
    return {'scope':'配置期接入检查','position_notice':'所有位置与路线均为示意，不影响模拟。',
            'items':[{'id':key,'title':title,'status':'待确认','reason':'前置条件未满足，本项尚未执行。'}
                     for key,title in CHECKS]+
                    [{'id':key,'title':title,'status':'待确认','reason':reason} for key,title,reason in PENDING],
            'warnings':[],'warning_explanations':[]}


def _item(report,key):
    return next(item for item in report['items'] if item['id']==key)


def _attempt(report,key,operation,reason):
    item=_item(report,key)
    try:
        value=operation()
        item.update(status='通过',reason=reason)
        return value
    except EXPECTED_ERRORS as error:
        issue=describe_issue(getattr(error,'code','INVALID_INPUT'),str(error))
        item.update(status='不通过',reason=issue['user_message'],issue=issue)
        return None


def _passed(report,*keys):
    return all(_item(report,key)['status']=='通过' for key in keys)


def _finish(report):
    report['configuration_ok']=not any(item['status']=='不通过' for item in report['items'])
    # Missing configuration checks can never be presented as a configuration pass.
    if any(_item(report,key)['status']!='通过' for key,_ in CHECKS):
        report['configuration_ok']=False
    report['conclusion']='配置期检查通过，运行绑定待确认' if report['configuration_ok'] else '不通过'
    return report


def input_failure(error):
    report=_new_report()
    def fail():
        raise error
    _attempt(report,'input',fail,'')
    return _finish(report)


def _input(intent,snapshot,plan):
    adapt_request(intent,snapshot,plan)
    require(intent.get('mode') in ('map','none'),'INVALID_INPUT','mode must explicitly be map or none')


def _selectors(intent,snapshot,plan,package=None):
    people=indexed(snapshot.get('nodes'),'entity_id')
    require(all(isinstance(person.get('role'),str) and person['role'] for person in people.values()),
            'UNKNOWN_ROLE','Every person needs a role')
    brands=brand_catalog(plan,people)
    from .taxonomy import is_layered, FUNCTIONS as LAYERED_FUNCTIONS
    from .evidence import FUNCTIONS
    allowed=LAYERED_FUNCTIONS if package is not None and is_layered(package.get('evidence_rules')) else FUNCTIONS
    normalize_prefs(intent,{person['role'] for person in people.values()},brands,allowed)


def _seed(intent,snapshot,plan,seed):
    require(seed is not None,'INVALID_INPUT','An independent assignment_seed is required')
    adapt_intent(intent,snapshot,plan,None,seed)


def _manifest(directory,ref):
    require(isinstance(ref,dict),'INVALID_MAP_REF','check requires an explicit map_ref for the prepared map directory')
    check_schema(ref,CONTRACT['properties']['map_ref'])
    require(all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}',ref[key]) for key in ('map_id','map_version')),
            'INVALID_MAP_REF','Map ID/version cannot be path segments')
    require(directory is not None,'MAP_NOT_READY','Prepared map directory is missing')
    directory=local_path(directory)
    require(directory.is_dir(),'MAP_FILE_MISSING','Prepared map version directory does not exist')
    require(directory.name==ref['map_version'] and directory.parent.name==ref['map_id'],
            'MAP_VERSION_MISMATCH','Directory must end with map_id/map_version')
    path=directory/'manifest.json'
    require(path.is_file(),'MAP_FILE_MISSING','Map manifest is missing')
    raw=path.read_bytes()
    require(hashlib.sha256(raw).hexdigest()==ref['manifest_sha256'],'MAP_HASH_MISMATCH','Manifest byte hash differs from map_ref')
    try:
        manifest=json.loads(raw.decode('utf-8'))
    except (UnicodeError,ValueError) as error:
        raise SceneError('INVALID_MAP_JSON',str(error)) from error
    require(isinstance(manifest,dict) and manifest.get('schema_version')=='scene.map-manifest.v1' and
            manifest.get('map_id')==ref['map_id'] and manifest.get('map_version')==ref['map_version'] and
            isinstance(manifest.get('title'),str) and manifest['title'].strip(),
            'MAP_VERSION_MISMATCH','Formal map manifest identity/title differs')
    return directory,manifest


def _catalog(manifest):
    try:
        descriptor,_=published_asset_library()
    except (OSError,ValueError) as error:
        raise SceneError('ASSET_VERSION_MISMATCH',str(error)) from error
    require(manifest.get('asset_library_version')==descriptor['version'] and
            manifest.get('catalog_sha256')==descriptor['catalog_sha256'],
            'ASSET_VERSION_MISMATCH','Map catalog differs from the registered published library')


def _files(directory,manifest,ref):
    files=manifest.get('files')
    require(isinstance(files,dict) and MAP_FILES<=set(files) and set(files)<=MAP_FILES|{'surroundings.json','evidence-rules.json','ai-evidence.json'} and
            all(isinstance(value,str) and re.fullmatch(r'[a-f0-9]{64}',value) for value in files.values()),
            'INVALID_MAP_MANIFEST','Formal map file list or digest is incomplete/invalid')
    require(all((directory/name).is_file() for name in files),'MAP_FILE_MISSING','A listed map file is missing')
    # Existing loader verifies every listed file hash and registered catalog.
    package=load_map(directory)
    require(package['map_ref']==ref,'REF_MISMATCH','Loaded map reference differs from the requested manifest')
    return package


def _quality(package):
    require(package.get('quality',{}).get('status')=='ready','MAP_NOT_READY','Archived map is preview-only')
    enriched=enrich_map(package,package.get('annotations'),**package.get('quality',{}).get('thresholds',{}))
    require(enriched['quality']['status']=='ready','MAP_NOT_READY','Recomputed map evidence/quality is not ready')
    return enriched


def _compile(intent,snapshot,plan,package,seed):
    response=compile_scene(intent,snapshot,plan,package,assignment_seed=seed)
    if not response['ok']:
        raise SceneError(response['error']['code'],response['error']['details'])
    require(isinstance(response.get('result'),dict),'INVALID_SCENE','Compile success did not contain a SceneResult object')
    return response['result']


def check_scene(intent,snapshot,plan,map_directory=None,*,assignment_seed=None):
    """Local diagnostics, not an approved team protocol. none never touches map_directory."""
    report=_new_report()
    _attempt(report,'input',lambda:_input(intent,snapshot,plan),'意图、快照和计划均为对象，mode 已明确；完整结构继续由原编译校验。')
    if not _passed(report,'input'):
        return _finish(report)
    mode=intent['mode']
    if mode=='none':
        _item(report,'selectors').update(status='通过',reason='明确不用地图，不做空间角色/品牌选择；人物与计划引用仍由原结果校验核对。')
    _attempt(report,'seed',lambda:_seed(intent,snapshot,plan,assignment_seed),'独立种子已提供且与意图种子对齐；值的合法性继续由原编译校验。')
    package=None
    map_keys=('map_manifest','map_catalog','map_files','map_quality')
    if mode=='none':
        for key in map_keys:
            _item(report,key).update(status='通过',reason='明确 none，本项不适用，已跳过；没有读取地图目录、文件或素材。')
    else:
        header=_attempt(report,'map_manifest',lambda:_manifest(map_directory,intent.get('map_ref')),
                        '指定版本目录存在，manifest 原始字节摘要、身份和目录版本一致。')
        if header:
            directory,manifest=header
            _attempt(report,'map_catalog',lambda:_catalog(manifest),'地图 catalog 与登记发布版及其实际字节一致。')
            if _passed(report,'map_catalog'):
                package=_attempt(report,'map_files',lambda:_files(directory,manifest,intent['map_ref']),
                                 '正式文件清单完整，原地图加载器已核对所有列出文件的原始字节摘要。')
            if package is not None:
                package=_attempt(report,'map_quality',lambda:_quality(package),'归档 ready，原用途证据与安全可达性重算也通过质量门槛。')
        _attempt(report,'selectors',lambda:_selectors(intent,snapshot,plan,package),'原有名称和偏好校验通过，角色、品牌名和经营者可对应到实际输入。')
    if not _passed(report,'selectors','seed',*map_keys):
        return _finish(report)
    result=_attempt(report,'compile',lambda:_compile(intent,snapshot,plan,package,assignment_seed),
                    'compile_scene 成功；没有自动放宽规则、改用其他地图或改为 none。')
    if result is None:
        return _finish(report)
    context={'snapshot':snapshot,'plan':plan,'source_refs':{
        'config_id':intent.get('config_id'),'snapshot_id':snapshot.get('snapshot_id'),
        'snapshot_revision':snapshot.get('snapshot_revision'),'plan_id':plan.get('plan_id'),'plan_revision':plan.get('plan_revision')}}
    if package is not None:
        context['map']=package
    _attempt(report,'validate',lambda:validate_result(result,context),'现有 validate_result 的结构、完整性和全部来源上下文校验通过。')
    def rehash():
        require(digest({key:value for key,value in result.items() if key!='result_sha256'})==result['result_sha256'],
                'HASH_MISMATCH','Recomputed result digest differs')
    _attempt(report,'hash',rehash,'复用现有规范化摘要函数，重新计算的 result_sha256 一致。')
    def repeat():
        second=_compile(intent,snapshot,plan,package,assignment_seed)
        require(canonical(result)==canonical(second),'HASH_MISMATCH','Identical inputs produced different results')
    _attempt(report,'repeat',repeat,'同一输入再次调用 compile_scene，规范化结果和摘要完全相同。')
    report['warnings']=copy.deepcopy(result['warnings'])
    report['warning_explanations']=[describe_issue(warning['code'],warning['message']) for warning in result['warnings']]
    _finish(report)
    if report['configuration_ok']:
        report['result']=result
        from collections import Counter
        placed=[entry for entry in result['assignments']+result['service_points'] if entry['status']=='placed']
        counts=Counter(e['source'] for entry in placed for e in entry['evidence'])
        total=sum(counts.values());ai=counts['ai_inferred']
        report['evidence_usage']={'by_source':dict(sorted(counts.items())),'total':total,'ai_count':ai,
                                  'ai_share_pct':round(ai*100/total) if total else 0,
                                  'placements_with_ai':sum(any(e['source']=='ai_inferred' for e in entry['evidence']) for entry in placed),
                                  'placed_count':len(placed),'illustrative':True}
    return report


def render_report(report):
    lines=['场景配置期接入检查','所有位置与路线均为示意，不影响模拟。','结论：'+report['conclusion']]
    for item in report['items']:
        lines.append(f"【{item['status']}】{item['title']}：{item['reason']}")
        if 'issue' in item:
            issue=item['issue']
            lines.extend([f"  错误码：{issue['code']}",'  管理员建议：'+issue['admin_message'],
                          '  可选处理：'+'；'.join(issue['actions']),'  重跑范围：'+issue['rerun_scope'],
                          '  原始诊断：'+issue['details']])
    for warning,explanation in zip(report['warnings'],report['warning_explanations']):
        lines.append(f"【警告，不计失败】{warning['code']}：{explanation['user_message']}；引用：{','.join(warning['refs'])}")
    result=report.get('result',{})
    usage=report.get('evidence_usage')
    if usage is not None:
        lines.append(f"【安置依据统计·示意】来源条数 {usage['by_source']}；AI {usage['ai_count']}/{usage['total']}，占 {usage['ai_share_pct']}%；使用 AI 依据的安置 {usage['placements_with_ai']}/{usage['placed_count']}。")
    for item in result.get('service_points',[]):
        place=item['building_id'] if item['status']=='placed' else '场景外'
        lines.append(f"【位置示意】服务点 {item['brand_name']}：{place}")
    lines.append('待确认项没有作为通过；本报告不证明运行绑定、实际执行计划关系或存储已完成。')
    return '\n'.join(lines)+'\n'
