"""SceneResult contract, integrity, context and cross-reference validation."""
import json
from pathlib import Path
import re

from .common import canonical, digest, nonblank, portable, require, SceneError

CONTRACT=json.loads(Path(__file__).with_name('contract.json').read_text(encoding='utf-8'))


def check_schema(value, schema, path='$'):
    if 'anyOf' in schema:
        for candidate in schema['anyOf']:
            try:
                check_schema(value,candidate,path)
                return
            except SceneError:
                pass
        raise SceneError('INVALID_SCENE', f'{path}: no matching contract variant')
    if 'const' in schema:
        require(type(value)==type(schema['const']) and value==schema['const'], 'INVALID_SCENE', f'{path}: unexpected constant')
    if 'enum' in schema:
        require(value in schema['enum'], 'INVALID_SCENE', f'{path}: unexpected enum value')
    kind=schema.get('type')
    matches={'null':value is None,'string':isinstance(value,str),'integer':type(value)==int,
             'boolean':type(value)==bool,'array':isinstance(value,list),'object':isinstance(value,dict)}
    if kind:
        require(matches[kind], 'INVALID_SCENE', f'{path}: expected {kind}')
    if kind=='object':
        properties=schema.get('properties',{})
        require(set(schema.get('required',[]))<=set(value),'INVALID_SCENE',f'{path}: missing fields')
        for key,item in value.items():
            target=properties.get(key,schema.get('additionalProperties'))
            require(target is not False and target is not None,'INVALID_SCENE',f'{path}: unexpected field {key}')
            check_schema(item,target,f'{path}.{key}')
    elif kind=='array':
        require(len(value)>=schema.get('minItems',0),'INVALID_SCENE',f'{path}: too few items')
        if schema.get('uniqueItems'):
            require(len({canonical(x) for x in value})==len(value),'INVALID_SCENE',f'{path}: duplicate items')
        for i,item in enumerate(value):
            check_schema(item,schema['items'],f'{path}[{i}]')
    elif kind=='string':
        require(len(value)>=schema.get('minLength',0) and (not schema.get('minLength') or nonblank(value)), 'INVALID_SCENE',f'{path}: empty text')
        if 'pattern' in schema:
            require(re.fullmatch(schema['pattern'],value) is not None,'INVALID_SCENE',f'{path}: invalid format')
    elif kind=='integer':
        require(schema.get('minimum',value)<=value<=schema.get('maximum',value),'INVALID_SCENE',f'{path}: integer out of range')


def indexed(items,key,code='REF_MISMATCH'):
    require(isinstance(items,list) and all(isinstance(x,dict) and isinstance(x.get(key),str) and x[key] for x in items),code,f'Invalid {key} records')
    result={x[key]:x for x in items}
    require(len(result)==len(items),code,f'Duplicate {key}')
    return result


def brand_catalog(plan, people=None):
    economy=plan.get('economy',{})
    brands=indexed(economy.get('brands',[]),'brand_id','BRAND_NAME_MISMATCH')
    names={}; seen=set()
    for product in economy.get('products',[]):
        identifier=product.get('brand_id'); name=product.get('product_name')
        require(identifier in brands and nonblank(name) and name not in names and identifier not in seen,
                'BRAND_NAME_MISMATCH','Expected exactly one uniquely named product per brand')
        require(isinstance(brands[identifier].get('owner_entity_id'),str) and
                (people is None or brands[identifier]['owner_entity_id'] in people),'REF_MISMATCH','Brand owner is absent from the snapshot')
        names[name]=brands[identifier]; seen.add(identifier)
    require(seen==set(brands),'BRAND_NAME_MISMATCH','Missing product-to-brand mapping')
    return names


def validate_result(result, context=None):
    result=portable(result); check_schema(result,CONTRACT); context=context or {}
    require(result['result_sha256']==digest({k:v for k,v in result.items() if k!='result_sha256'}),'HASH_MISMATCH','SceneResult hash mismatch')
    require(result['assignment_meta']['rules_sha256']==digest(result['rules']),'HASH_MISMATCH','Rules hash mismatch')
    mode=result['mode']
    if mode=='none':
        require(result['map_ref'] is None and not result['assignments'] and not result['service_points'] and
                nonblank(result.get('reason')) and result['rules']=={},'INVALID_SCENE','none requires a reason and empty spatial data/rules')
    else:
        require(result['map_ref'] is not None and bool(result['rules']),'INVALID_SCENE','map requires a map reference and adopted rules')
    indexed(result['assignments'],'entity_id')
    indexed(result['service_points'],'service_id'); indexed(result['service_points'],'brand_id'); indexed(result['service_points'],'brand_name')
    if mode=='map':
        require({x['role'] for x in result['assignments']}==set(result['rules']['role_prefs']) and
                {x['brand_name'] for x in result['service_points']}==set(result['rules']['brand_prefs']),
                'REF_MISMATCH','Adopted rules do not cover the result')
        require(set(result['rules']['overrides']['entities'])<={x['entity_id'] for x in result['assignments']} and
                set(result['rules']['overrides']['brands'])<={x['brand_name'] for x in result['service_points']},
                'REF_MISMATCH','Adopted overrides have unknown selectors')
        require(all(x['owner_entity_id'] in {a['entity_id'] for a in result['assignments']} for x in result['service_points']),
                'REF_MISMATCH','Service owner missing from assignments')
    for item in result['assignments']+result['service_points']:
        group='entities' if 'entity_id' in item else 'brands'
        name=item.get('entity_id',item.get('brand_name'))
        pref=result['rules']['role_prefs'][item['role']] if group=='entities' else result['rules']['brand_prefs'][name]
        require(item['fallback_used'] is None or item['fallback_used']==pref['fallback'],'REF_MISMATCH','Undeclared fallback')
        if item['status']=='out_of_scene':
            require(item['building_id'] is None and item['entrance_id'] is None and item['fallback_used']=='out_of_scene','INVALID_SCENE','Out-of-scene entries require null places and explicit fallback')
        else:
            require(bool(item['building_id']) and bool(item['entrance_id']) and item['fallback_used']!='out_of_scene','INVALID_SCENE','Placed entry needs building and entrance')
        if item['status']=='placed' and item['fallback_used'] is None:
            group='entities' if 'entity_id' in item else 'brands'
            name=item.get('entity_id',item.get('brand_name'))
            override=result['rules'].get('overrides',{}).get(group,{}).get(name)
            require(override==item['building_id'] or any(e['source']!='name_keyword' for e in item['evidence']), 'INVALID_SCENE','Strict placement needs strong evidence or explicit override')
    if 'source_refs' in context:
        require(result['source_refs']==context['source_refs'],'REF_MISMATCH','Source references differ')
    if 'map' in context and mode=='map':
        package=context['map']
        require(result['map_ref']==package['map_ref'],'REF_MISMATCH','Map reference differs')
        buildings=indexed(package['campus']['buildings'],'osm_id'); entrances=indexed(package['entrances']['entrances'],'id')
        for item in result['assignments']+result['service_points']:
            if item['status']=='placed':
                b=buildings.get(item['building_id']); e=entrances.get(item['entrance_id'])
                require(b is not None and e is not None and e['building_id']==item['building_id'] and
                        b.get('scene_eligible') is True and e.get('scene_reachable') is True,
                        'REF_MISMATCH','Unknown, mismatched or unreachable building/entrance')
                require(all(e in b.get('function_evidence',[]) for e in item['evidence']), 'REF_MISMATCH','Evidence not present in the bound map')
                group='entities' if 'entity_id' in item else 'brands'
                name=item.get('entity_id',item.get('brand_name'))
                override=result['rules']['overrides'][group].get(name)
                pref=result['rules']['role_prefs'][item['role']] if group=='entities' else result['rules']['brand_prefs'][name]
                require(item['fallback_used'] is not None or override==item['building_id'] or any(
                    e['source']!='name_keyword' and e['function']!='unknown' and e['function'] in pref['functions'] for e in item['evidence']),
                    'REF_MISMATCH','Evidence does not satisfy adopted preference')
    if 'snapshot' in context:
        snapshot=context['snapshot']; people=indexed(snapshot['nodes'],'entity_id')
        require(all(result['source_refs'][k]==snapshot[k] for k in ('snapshot_id','snapshot_revision')),'REF_MISMATCH','Snapshot reference differs')
        if mode=='map':
            require({x['entity_id'] for x in result['assignments']}==set(people),'REF_MISMATCH','Population coverage differs')
            require(all(people[x['entity_id']]['role']==x['role'] for x in result['assignments']),'REF_MISMATCH','Assignment role differs')
            require(all(x['owner_entity_id'] in people for x in result['service_points']),'REF_MISMATCH','Unknown service owner')
    if 'plan' in context:
        plan=context['plan']
        require(all(result['source_refs'][k]==plan[k] for k in ('plan_id','plan_revision')),'REF_MISMATCH','Plan reference differs')
        if plan.get('population'):
            require(all(result['source_refs'][k]==plan['population'][k] for k in ('snapshot_id','snapshot_revision')),'REF_MISMATCH','Plan population differs')
        if mode=='map':
            catalog=brand_catalog(plan)
            require({x['brand_name'] for x in result['service_points']}==set(catalog),'REF_MISMATCH','Brand coverage differs')
            require(all(x['brand_id']==catalog[x['brand_name']]['brand_id'] and x['owner_entity_id']==catalog[x['brand_name']]['owner_entity_id'] for x in result['service_points']),'REF_MISMATCH','Brand mapping differs')
    return result
