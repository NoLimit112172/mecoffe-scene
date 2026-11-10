"""Regenerate public synthetic parity fixtures: python -m adapter.scene_service.fixtures.generate."""
import copy
from pathlib import Path

from .synthetic import sample_request
from ..common import digest, write_json
from ..evidence import enrich_map
from ..resolver import resolve


def main():
    root=Path(__file__).parent; request=sample_request()
    request['snapshot']['nodes']=[p for p in request['snapshot']['nodes'] if p['role']=='synthetic_operator' or int(p['entity_id'].rsplit('_',1)[1])<6]
    package=enrich_map(request['map'])
    context={'map':package,'snapshot':request['snapshot'],'plan':request['plan']}
    write_json(root/'context.json',{'synthetic':True,**context})
    result=resolve(request)
    cases=[]
    def add(name,value,valid=True,code=None):
        case={'synthetic':True,'description':'Entirely synthetic M15 contract fixture','name':name,'valid':valid,'result':value,'context_ref':'context.json'}
        if code:
            case['code']=code
        filename=name+'.json';write_json(root/filename,case);cases.append(filename)
    add('map-valid',result)
    none=copy.deepcopy(request); none.update(mode='none',reason='用户确认的纯网络合成实验'); none.pop('map')
    add('none-valid',resolve(none))
    shared=copy.deepcopy(request)
    shared['overrides']['brands']={name:'synthetic/b3' for name in shared['brand_prefs']}
    add('same-building-stores',resolve(shared))
    outside=copy.deepcopy(request);outside['role_prefs']['synthetic_student'].update(functions=['retail'],fallback='out_of_scene')
    outside['brand_prefs']['合成品牌甲'].update(functions=['retail'],fallback='out_of_scene')
    add('out-of-scene',resolve(outside))
    override=copy.deepcopy(request); override['overrides']['entities']['synthetic_student_000']='synthetic/b7'
    add('explicit-unknown-building',resolve(override))
    def invalid(name,change,code='INVALID_SCENE',rehash=True):
        value=copy.deepcopy(result);change(value)
        if rehash:
            value['result_sha256']=digest({k:v for k,v in value.items() if k!='result_sha256'})
        add(name,value,False,code)
    invalid('missing-field',lambda v:v.pop('source_refs'))
    invalid('hash-mismatch',lambda v:v['assumptions'].append('synthetic tamper'),'HASH_MISMATCH',False)
    invalid('unknown-building',lambda v:v['assignments'][0].update(building_id='synthetic/missing'),'REF_MISMATCH')
    invalid('wrong-entrance',lambda v:v['assignments'][0].update(entrance_id='synthetic/b0/entrance'),'REF_MISMATCH')
    invalid('duplicate-person',lambda v:v['assignments'].append(copy.deepcopy(v['assignments'][0])),'REF_MISMATCH')
    invalid('missing-person',lambda v:v['assignments'].pop(),'REF_MISMATCH')
    invalid('wrong-brand-owner',lambda v:v['service_points'][0].update(owner_entity_id='synthetic_student_001'),'REF_MISMATCH')
    invalid('wrong-plan',lambda v:v['source_refs'].update(plan_revision=2),'REF_MISMATCH')
    invalid('wrong-map',lambda v:v['map_ref'].update(map_version='2'),'REF_MISMATCH')
    invalid('bad-status',lambda v:v['assignments'][0].update(status='teleported'))
    invalid('false-illustrative',lambda v:v.update(illustrative=False))
    invalid('unknown-field',lambda v:v.update(accidental_field=True))
    invalid('empty-reason',lambda v:v['assignments'][0].update(reason=''))
    invalid('rules-hash',lambda v:v['assignment_meta'].update(rules_sha256='0'*64),'HASH_MISMATCH')
    invalid('forged-evidence',lambda v:v['assignments'][0]['evidence'][0].update(value='synthetic-forged'),'REF_MISMATCH')
    invalid('undeclared-fallback',lambda v:v['assignments'][0].update(fallback_used='any_building_in_scope'),'REF_MISMATCH')
    invalid('weak-only',lambda v:v['assignments'][0]['evidence'][0].update(source='name_keyword'))
    invalid('unicode-blank-reason',lambda v:v['assignments'][0].update(reason=' \ufeff '))
    invalid('out-of-scene-with-place',lambda v:v['assignments'][0].update(status='out_of_scene',fallback_used='out_of_scene'),'REF_MISMATCH')
    badnone=resolve(none);badnone.pop('reason');badnone['result_sha256']=digest({k:v for k,v in badnone.items() if k!='result_sha256'})
    add('none-missing-reason',badnone,False,'INVALID_SCENE')
    write_json(root/'index.json',{'synthetic':True,'cases':cases})
    write_json(root/'request.json',request)
    for filename,value in [('map.json',request['map']),('snapshot.json',request['snapshot']),('plan.json',request['plan'])]:
        write_json(root/filename,value)
    write_json(root/'prefs.json',{k:v for k,v in request.items() if k not in ('map','snapshot','plan')})
    write_json(root/'prefs-none.json',{k:v for k,v in none.items() if k not in ('map','snapshot','plan')})


if __name__=='__main__':
    main()
