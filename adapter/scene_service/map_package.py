"""Offline, immutable map publication; no population, run or download inputs."""
import copy
import hashlib
import json
from pathlib import Path
import re

from adapter.scene_builder.asset_library import published_asset_library
from .common import read_json, require
from .evidence import enrich_map
from .maps import load_map


def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+'\n').encode('utf-8')


def publish_map(source,out,map_id,map_version,title,annotations=None,template_out=None,*,evidence_mode='legacy',ai_evidence=None,rules_path=None):
    source=Path(source);out=Path(out)
    require(bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}',map_id)) and
            bool(re.fullmatch(r'[1-9][0-9]*',map_version)), 'INVALID_MAP','地图 ID 或数字版本无效')
    descriptor,catalog=published_asset_library()
    package=load_map(source)
    require(evidence_mode in ('legacy','auto'),'INVALID_INPUT','Unknown evidence mode')
    input_ref=copy.deepcopy(package['map_ref'])
    ai_raw=None;rules_raw=None;policy=None
    if annotations:
        annotations=read_json(annotations)
        base=annotations.get('map_ref',{})
        if not (evidence_mode=='auto' and base==input_ref):
            require(base.get('map_id')==map_id and isinstance(base.get('map_version'),str) and
                    bool(re.fullmatch(r'[1-9][0-9]*',base['map_version'])) and int(base['map_version'])<int(map_version),
                    'REF_MISMATCH','审核补注必须引用同一地图的已发布旧版本，新版本需递增')
            previous=out.parent/base['map_version']/'manifest.json'
            require(previous.is_file() and hashlib.sha256(previous.read_bytes()).hexdigest()==base.get('manifest_sha256'),
                    'REF_MISMATCH','审核补注引用的旧地图清单不存在或摘要不符')
            previous_manifest=read_json(previous)
            require(previous_manifest.get('map_id')==map_id and previous_manifest.get('map_version')==base['map_version'],
                    'REF_MISMATCH','旧地图清单身份与审核补注不一致')
        package['map_ref']=copy.deepcopy(base)
    if evidence_mode=='auto':
        from .auto_evidence import RULES_PATH, validate_rules
        rules_raw=Path(rules_path or RULES_PATH).read_bytes()
        rules=validate_rules(json.loads(rules_raw.decode('utf-8')))
        package['evidence_rules']=rules
        package.pop('evidence_frozen',None)
        package['evidence_input_ref']=input_ref
        package.pop('ai_evidence',None)
        if ai_evidence:
            ai_raw=Path(ai_evidence).read_bytes()
            package['ai_evidence']=json.loads(ai_raw.decode('utf-8'))
        policy={'version':rules['version'],'sha256':rules['sha256'],'ai_min_confidence_pct':rules['ai_min_confidence_pct'],
                'input_map_ref':input_ref}
        if ai_raw is not None:
            policy['ai_evidence_sha256']=hashlib.sha256(ai_raw).hexdigest()
    else:
        require(ai_evidence is None and rules_path is None,'INVALID_INPUT','Legacy reproduction does not accept automatic evidence')
        require('evidence_rules' not in package,'INVALID_INPUT','Automatic maps cannot be republished as legacy')
    package=enrich_map(package,annotations)
    if policy is not None:
        package['quality']['evidence_policy']=copy.deepcopy(policy)
    assets=read_json(source/'asset_assignments.json')
    ids={p['id'] for p in catalog['prototypes']}
    require(all(item.get('prototype_id') in ids for item in assets.get('assignments',[])),
            'ASSET_VERSION_MISMATCH','地图引用了发布版 catalog 没有的素材')
    files={'campus3d.json':package['campus'],'entrances.json':package['entrances'],
           'landcover.json':package['landcover'],'asset_assignments.json':assets,'quality.json':package['quality']}
    if (source/'surroundings.json').is_file():files['surroundings.json']=read_json(source/'surroundings.json')
    for name in ('buildings','roads','landcover','water','boundary','pois','entrances'):
        value=read_json(source/f'gis/{name}.geojson')
        if name in ('buildings','pois'):
            value['features']=[f for f in value['features'] if not f.get('properties',{}).get('illustrative')]
            for feature in value['features']:
                feature['properties'].pop('location_ids',None);feature['properties'].pop('location_id',None)
        files[f'gis/{name}.geojson']=value
    raw={name:json_bytes(value) for name,value in files.items()}
    if rules_raw is not None:raw['evidence-rules.json']=rules_raw
    if ai_raw is not None:raw['ai-evidence.json']=ai_raw
    source_manifest=source/('scenario.json' if (source/'scenario.json').is_file() else 'manifest.json')
    manifest={'schema_version':'scene.map-manifest.v1','map_id':map_id,'map_version':map_version,'title':title,
              'asset_library_version':descriptor['version'],'catalog_sha256':descriptor['catalog_sha256'],
              'style':read_json(source_manifest).get('style',{'buildings':'procedural','characters':'campus'}),
              'files':{name:hashlib.sha256(value).hexdigest() for name,value in raw.items()}}
    if policy is not None:manifest['evidence_policy']=policy
    raw['manifest.json']=json_bytes(manifest)
    ref={'map_id':map_id,'map_version':map_version,'manifest_sha256':hashlib.sha256(raw['manifest.json']).hexdigest()}
    # Check every existing byte before writing anything. A version can be repeated, never replaced.
    for name,value in raw.items():
        target=out/name
        require(not target.exists() or target.read_bytes()==value,'MAP_VERSION_IMMUTABLE',f'版本文件不可覆盖：{name}；请升版')
    template=None
    if template_out:
        template={'schema_version':'scene.annotations.template.v1','map_ref':ref,'buildings':{
            b['osm_id']:{'name':b.get('name',''),'functions':[],'source':'','reviewer':'','note':''}
            for b in sorted(package['campus']['buildings'],key=lambda b:b['osm_id'])
            if any(word in b.get('name','') for word in ('食堂','餐厅','咖啡'))}}
        target=Path(template_out)
        require(not target.exists() or target.read_bytes()==json_bytes(template),'MAP_VERSION_IMMUTABLE','补注模板已有改动，不覆盖人工内容')
    for name,value in raw.items():
        target=out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(value)
    if template_out:
        target=Path(template_out);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(json_bytes(template))
    return {'map_ref':ref,'asset_library':descriptor,'quality':package['quality'],'annotation_candidates':len(template['buildings']) if template else 0}
