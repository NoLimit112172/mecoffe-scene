"""Internal request adapter and deterministic display-only placement."""
import copy

from .common import digest, portable, require
from .evidence import FUNCTIONS, enrich_map
from .validation import brand_catalog, indexed, validate_result
from .auto_evidence import STRONG_SOURCES

FUNCTION_LABELS={'dining':'餐饮','retail':'零售','dormitory':'宿舍','residential':'住宅','education':'教学','office':'办公','library':'图书服务','unknown':'未知'}


def normalize_prefs(request, roles, brands):
    role_prefs=request.get('role_prefs',{}); brand_prefs=request.get('brand_prefs',{})
    require(isinstance(role_prefs,dict) and set(role_prefs)==roles,'UNKNOWN_ROLE','Role preferences must exactly match snapshot roles')
    require(isinstance(brand_prefs,dict) and set(brand_prefs)==set(brands),'BRAND_NAME_MISMATCH','Brand preferences must exactly match current unique brand names')
    rules={'role_prefs':{},'brand_prefs':{},'overrides':copy.deepcopy(request.get('overrides',{'entities':{},'brands':{}}))}
    require(isinstance(rules['overrides'],dict) and set(rules['overrides'])<= {'entities','brands'},'OVERRIDE_INVALID','Invalid overrides')
    for key in ('entities','brands'):
        rules['overrides'].setdefault(key,{})
        require(isinstance(rules['overrides'][key],dict),'OVERRIDE_INVALID','Overrides must be dictionaries')
        require(all(isinstance(v,str) and v.strip() for v in rules['overrides'][key].values()),'OVERRIDE_INVALID','Overrides need explicit building IDs')
    for group, preferences in (('role_prefs',role_prefs),('brand_prefs',brand_prefs)):
        for name,pref in sorted(preferences.items()):
            require(isinstance(pref,dict),'INVALID_PREFERENCE','Preference must be an object')
            functions=pref.get('functions')
            require(isinstance(functions,list) and functions and all(isinstance(f,str) and f in FUNCTIONS for f in functions),
                    'UNKNOWN_FUNCTION','Unknown or missing function preference')
            fallback=pref.get('fallback','fail')
            require(fallback in ('fail','any_building_in_scope','out_of_scene'),'INVALID_PREFERENCE','Unknown fallback')
            adopted={'functions':sorted(set(functions)),'fallback':fallback}
            if group=='role_prefs':
                adopted['distribution']=pref.get('distribution','balanced')
                require(adopted['distribution'] in ('balanced','clustered'),'INVALID_PREFERENCE','Unknown distribution')
                allowed={'functions','fallback','distribution'}
            else:
                adopted['separate_when_possible']=pref.get('separate_when_possible',False)
                require(type(adopted['separate_when_possible']) is bool,'INVALID_PREFERENCE','separate_when_possible must be boolean')
                allowed={'functions','fallback','separate_when_possible'}
            require(set(pref)<=allowed,'INVALID_PREFERENCE','Unknown preference fields')
            rules[group][name]=adopted
    return rules


def resolve(request):
    require(isinstance(request,dict),'INVALID_INPUT','Request must be an object')
    require(request.get('mode') in ('map','none'),'INVALID_INPUT','mode must be map or none')
    snapshot=request.get('snapshot',{}); plan=request.get('plan',{})
    require(isinstance(snapshot,dict) and isinstance(plan,dict),'REF_MISMATCH','Snapshot and plan are required')
    source={k:request.get(k) for k in ('config_id',)}
    source.update({k:snapshot.get(k) for k in ('snapshot_id','snapshot_revision')})
    source.update({k:plan.get(k) for k in ('plan_id','plan_revision')})
    require(all(isinstance(source[k],str) and source[k].strip() for k in ('config_id','snapshot_id','plan_id')) and
            all(type(source[k]) is int and source[k]>=1 for k in ('snapshot_revision','plan_revision')), 'REF_MISMATCH','Missing source identities')
    if 'source_refs' in request:
        require(request['source_refs']==source,'REF_MISMATCH','Requested source references differ')
    if plan.get('population'):
        require(all(plan['population'].get(k)==source[k] for k in ('snapshot_id','snapshot_revision')),'REF_MISMATCH','Plan snapshot reference differs')
    require('assignment_seed' in request,'INVALID_INPUT','An independent assignment_seed is required')
    seed=portable(request['assignment_seed'])
    require(type(seed) in (str,int) and (not isinstance(seed,str) or seed.strip()),'INVALID_INPUT','assignment_seed must be a safe integer or nonblank string')
    assumptions=request.get('assumptions',[])
    require(isinstance(assumptions,list) and all(isinstance(a,str) for a in assumptions),'INVALID_INPUT','Assumptions must be confirmed strings')
    result={'schema_version':'scene.result.v2','scene_id':'pending','scene_revision':request.get('scene_revision',1),
            'mode':request['mode'],'illustrative':True,'map_ref':None,'source_refs':source,
            'assignment_meta':{'assignment_seed':seed,'rules_version':request.get('rules_version','1'),
                               'resolver_version':'2','rules_sha256':''},
            'rules':{},'assumptions':copy.deepcopy(assumptions),'assignments':[],'service_points':[],'warnings':[]}
    context={'snapshot':snapshot,'plan':plan}
    if request['mode']=='none':
        require(isinstance(request.get('reason'),str) and request['reason'].strip(),'INVALID_INPUT','none requires a confirmed reason')
        result['reason']=request['reason']
    else:
        package=request.get('map')
        require(isinstance(package,dict),'MAP_NOT_READY','Map is missing')
        require(package.get('quality',{}).get('status','ready')=='ready','MAP_NOT_READY','Map is preview-only')
        thresholds=package.get('quality',{}).get('thresholds',{})
        package=enrich_map(package,annotations=package.get('annotations'),**thresholds)
        require(package['quality']['status']=='ready','MAP_NOT_READY','Map quality gate has not passed')
        if 'map_ref' in request:
            require(request['map_ref']==package['map_ref'],'REF_MISMATCH','Requested map reference differs')
        people=indexed(snapshot.get('nodes'),'entity_id')
        require(all(isinstance(p.get('role'),str) and p['role'] for p in people.values()),'UNKNOWN_ROLE','Every person needs a role')
        brands=brand_catalog(plan,people)
        rules=normalize_prefs(request,{p['role'] for p in people.values()},brands)
        require(set(rules['overrides']['entities'])<=set(people),'OVERRIDE_INVALID','Unknown entity override')
        require(set(rules['overrides']['brands'])<=set(brands),'UNKNOWN_BRAND','Unknown brand override')
        result['rules']=rules; result['map_ref']=copy.deepcopy(package['map_ref'])
        result['warnings']=copy.deepcopy(package['quality']['warnings']); context['map']=package
        buildings={b['osm_id']:b for b in package['campus']['buildings']}
        def choose(name, pref, override=None, avoid=None):
            eligible=[b for b in buildings.values() if b['scene_eligible']]
            fallback=None; explicit=override is not None
            if explicit:
                require(isinstance(override,str) and override in buildings and buildings[override]['scene_eligible'],
                        'OVERRIDE_INVALID','Override building is absent, outside scope, or unreachable')
                candidates=[buildings[override]]
            else:
                candidates=[b for b in eligible if set(pref['functions']) & (set(b['functions'])-{'unknown'})]
            if not candidates:
                fallback=pref['fallback']
                require(fallback!='fail','SCENE_NO_CANDIDATE',f'No usable function candidate for {name}')
                result['warnings'].append({'code':'FALLBACK_USED','message':f'Confirmed fallback {fallback} used','refs':[name]})
                if fallback=='out_of_scene':
                    return {'status':'out_of_scene','building_id':None,'entrance_id':None,'reason':'按已确认的场外兜底处理，未找到符合用途的楼',
                            'evidence':[],'fallback_used':fallback}
                candidates=eligible
                require(bool(candidates),'SCENE_NO_CANDIDATE','No safe reachable building even for confirmed fallback')
            if avoid:
                candidates=[b for b in candidates if b['osm_id'] not in avoid] or candidates
            # Structured JSON avoids delimiter collisions; hex order equals integer order.
            chosen=max(candidates,key=lambda b:(digest([seed,name,b['osm_id']]),b['osm_id']))
            evidence=[copy.deepcopy(e) for e in chosen['function_evidence'] if e['source'] in STRONG_SOURCES and
                      (explicit or fallback is not None or e['function'] in pref['functions'])]
            uses='、'.join(FUNCTION_LABELS[f] for f in sorted({e['function'] for e in evidence}))
            auto_sources=[]
            if any(e['source']=='name_rule' for e in evidence):
                auto_sources.append('名称规则')
            ai_confidence=[e['confidence_pct'] for e in evidence if e['source']=='ai_inferred']
            if ai_confidence:
                auto_sources.append(f'AI 推断（把握 {min(ai_confidence)}%）')
            standard_reason=(f"依据{'、'.join(auto_sources)}判定为{uses}，入口可达，按确定性规则选定" if auto_sources else
                             f'有{uses}用途证据且入口可达，按确定性规则选定')
            reason=('按已确认的指定楼栋安置，入口可达' if explicit else '按已确认的范围内任意楼栋兜底安置，入口可达' if fallback else standard_reason)
            if auto_sources and (explicit or fallback):
                reason+=f"；楼栋用途依据{'、'.join(auto_sources)}（{uses}）"
            return {'status':'placed','building_id':chosen['osm_id'],'entrance_id':chosen['usable_entrance_ids'][0],
                    'reason':reason,
                    'evidence':evidence,'fallback_used':fallback}
        for identifier, person in sorted(people.items()):
            pref=rules['role_prefs'][person['role']]
            key=person['role'] if pref['distribution']=='clustered' else identifier
            result['assignments'].append({'entity_id':identifier,'role':person['role'],
                                         **choose(key,pref,rules['overrides']['entities'].get(identifier))})
        used=set()
        for name,brand in sorted(brands.items()):
            pref=rules['brand_prefs'][name]
            place=choose(name,pref,rules['overrides']['brands'].get(name),used if pref['separate_when_possible'] else None)
            if place['building_id']:
                used.add(place['building_id'])
            result['service_points'].append({'service_id':'service_'+digest(name)[:24],'brand_name':name,
                                             'brand_id':brand['brand_id'],'owner_entity_id':brand['owner_entity_id'],**place})
    result['assignment_meta']['rules_sha256']=digest(result['rules'])
    result['scene_id']=request.get('scene_id','scene_'+digest({k:v for k,v in result.items() if k!='scene_id'})[:24])
    result['result_sha256']=digest(result)
    return validate_result(result,context)
