"""Entirely synthetic local geometry and people; never imports team data."""
from ..common import digest


def sample_request():
    kinds=['school','school','school','yes','yes','residential','dormitory','yes']
    buildings=[]; entrances=[]; nodes=[]; edges=[]
    for i,kind in enumerate(kinds):
        x=i*20; identifier=f'synthetic/b{i}'
        tags={'building':kind}
        if i in (3,4):
            tags['amenity']='cafe'
        buildings.append({'osm_id':identifier,'name':'合成食堂（仅弱证据）' if i==7 else f'Synthetic building {i}',
                          'kind':'legacy-appearance','building_type':kind,'tags':tags,
                          'polygon':[[x,10],[x+10,10],[x+10,20],[x,20],[x,10]],'holes':[]})
        nodes.append({'id':f'synthetic/n{i}','x':x+5,'y':0})
        if i:
            edges.append({'source':f'synthetic/n{i-1}','target':f'synthetic/n{i}'})
        entrances.append({'id':identifier+'/entrance','building_id':identifier,'point':[x+5,10],
                          'road_node_id':f'synthetic/n{i}','connector':[[x+5,10],[x+5,0]],'connected':True})
    campus={'campus_id':'synthetic-campus','synthetic':True,'boundary':[[-10,-10],[170,-10],[170,40],[-10,40],[-10,-10]],
            'buildings':buildings,'pois':[],'walk_graph':{'nodes':nodes,'edges':edges}}
    package={'schema_version':'scene.map.v1','synthetic':True,'campus':campus,
             'entrances':{'entrances':entrances},'landcover':{'features':[]}}
    package['map_ref']={'map_id':'synthetic-campus','map_version':'1','manifest_sha256':digest(package)}
    people=[{'entity_id':f'synthetic_student_{i:03}','role':'synthetic_student','name':f'合成人物{i}'} for i in range(24)]
    people.extend({'entity_id':f'synthetic_operator_{i}','role':'synthetic_operator','name':f'合成人物经营者{i}'} for i in range(2))
    snapshot={'snapshot_id':'synthetic-snapshot','snapshot_revision':1,'dataset_version':'synthetic-m15','nodes':people}
    plan={'synthetic':True,'plan_id':'synthetic-plan','plan_revision':1,
          'population':{'snapshot_id':snapshot['snapshot_id'],'snapshot_revision':1},
          'economy':{'brands':[{'brand_id':f'brand_{i+1}','owner_entity_id':f'synthetic_operator_{i}'} for i in range(2)],
                     'products':[{'product_name':name,'brand_id':f'brand_{i+1}'} for i,name in enumerate(('合成品牌甲','合成品牌乙'))]}}
    return {'synthetic':True,'mode':'map','config_id':'synthetic-config','map':package,'snapshot':snapshot,'plan':plan,
            'role_prefs':{'synthetic_student':{'functions':['education'],'distribution':'balanced','fallback':'fail'},
                          'synthetic_operator':{'functions':['dormitory'],'distribution':'clustered','fallback':'fail'}},
            'brand_prefs':{name:{'functions':['dining'],'separate_when_possible':True,'fallback':'fail'} for name in ('合成品牌甲','合成品牌乙')},
            'assignment_seed':42,'assumptions':['完全合成测试；默认地点仅供展示，不代表住所。',' 原样保留空格与换行\n🙂 '],
            'overrides':{'entities':{},'brands':{}}}
