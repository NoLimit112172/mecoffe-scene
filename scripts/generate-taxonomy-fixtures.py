"""Rebuild only the new offline taxonomy fixture; never rewrites old fixtures."""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from adapter.scene_service.fixtures.taxonomy import layered_request
from adapter.scene_service.map_package import json_bytes, publish_map
from adapter.scene_service.maps import load_map
from adapter.scene_service.evidence import enrich_map
from adapter.scene_service.compiler import compile_scene
from adapter.scene_service.common import digest


def generate(out):
    out=Path(out);request=layered_request()
    request['snapshot']['edges']=[]
    request['role_prefs']['synthetic_operator']['functions']=['hotel']
    raw=request['map'];campus=raw['campus']
    campus['buildings'][2].update(name='合成门诊楼',tags={'building':'yes'},building_type='yes')
    campus['buildings'][7].update(name='',tags={'building':'yes'},building_type='yes')
    campus['pois'].extend([
        {'osm_id':'synthetic/outpatient-restaurant','name':'合成门诊楼餐厅','point':[45,15],'tags':{'amenity':'restaurant'}},
        {'osm_id':'synthetic/anonymous-hospital','name':'合成医院设施点','point':[145,15],'tags':{'amenity':'hospital'}},
        {'osm_id':'synthetic/anonymous-restaurant','name':'合成无名楼餐厅','point':[146,15],'tags':{'amenity':'restaurant'}},
    ])
    projection={'method':'local_equirectangular','origin_lat':0,'origin_lon':0,'earth_radius_m':6371008.8,'units':'metres'}
    campus.update(schema_version='mecoffe.campus3d.v1',projection=projection,title='合成医院与楼内服务',
                  source={'attribution':'完全合成，仅用于离线测试','sha256':digest(raw)},roads=[],landcovers=[],
                  bounds_m={'min_x':-10,'max_x':170,'min_y':-10,'max_y':40},defaults={})
    for b in campus['buildings']:
        b.update(height_m=12,levels=3)
    raw['entrances']['schema_version']='mecoffe.entrances.v1'
    def geo(point):
        return [point[0]/projection['earth_radius_m']*180/math.pi,point[1]/projection['earth_radius_m']*180/math.pi]
    collection=lambda features:{'type':'FeatureCollection','synthetic':True,'features':features}
    def feature(identifier,kind,coordinates,properties):
        return {'type':'Feature','id':identifier,'geometry':{'type':kind,'coordinates':coordinates},'properties':properties}
    with tempfile.TemporaryDirectory(prefix='scene-taxonomy-geometry-') as temporary:
        source=Path(temporary)/'source';source.mkdir()
        files={'campus3d.json':campus,'entrances.json':raw['entrances'],'landcover.json':raw['landcover'],
               'asset_assignments.json':{'schema_version':'mecoffe.asset-assignments.v1','synthetic':True,'assignments':[],
                                         'campus_id':campus['campus_id'],'geometry_source':{'sha256':campus['source']['sha256']}}}
        files['gis/buildings.geojson']=collection([feature(b['osm_id'],'Polygon',[[geo(p) for p in b['polygon']]],
            {'name':b['name'],'category':'building','height_m':12}) for b in campus['buildings']])
        files['gis/pois.geojson']=collection([feature(p['osm_id'],'Point',geo(p['point']),{'name':p['name'],'category':'poi'}) for p in campus['pois']])
        files['gis/entrances.geojson']=collection([feature(e['id'],'Point',geo(e['point']),{'building_id':e['building_id'],'category':'entrance'}) for e in raw['entrances']['entrances']])
        files['gis/boundary.geojson']=collection([feature('synthetic/boundary','Polygon',[[geo(p) for p in campus['boundary']]],{})])
        for layer in ('roads','landcover','water'):files[f'gis/{layer}.geojson']=collection([])
        for name,value in files.items():
            path=source/name;path.parent.mkdir(exist_ok=True,parents=True);path.write_bytes(json_bytes(value))
        manifest={'id':'synthetic-taxonomy-source','map_version':'1','synthetic':True,'style':{'buildings':'procedural','characters':'campus'},
                  'files':{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in files}}
        (source/'scenario.json').write_bytes(json_bytes(manifest))
        ai={'schema_version':'scene.ai-evidence.v1','synthetic':True,'map_ref':load_map(source)['map_ref'],'buildings':{
            key:{'functions':[function],'confidence':confidence,'rationale':'完全合成的离线用途判断，未调用模型。',
                 'model':'synthetic-offline','prompt_version':'taxonomy-demo-1','generated_at':'2026-11-12T00:00:00+08:00'}
            for key,function,confidence in [('synthetic/b3','hotel',.84),('synthetic/b7','government',.4)]}}
        ai_file=Path(temporary)/'ai.json';ai_file.write_bytes(json_bytes(ai))
        publish_map(source,out/'maps/synthetic-taxonomy/1','synthetic-taxonomy','1','合成医院与楼内服务',
                    evidence_mode='auto',rules_path=ROOT/'adapter/scene_service/evidence_rules_v2.json',ai_evidence=ai_file)
    package=load_map(out/'maps/synthetic-taxonomy/1');enriched=enrich_map(package)
    intent={key:value for key,value in request.items() if key not in ('snapshot','plan','map','assignment_seed')}
    intent['map_ref']=copy.deepcopy(package['map_ref'])
    expected=compile_scene(intent,request['snapshot'],request['plan'],package,assignment_seed=42)
    assert expected['ok'],expected
    payload={'synthetic':True,'intent':intent,'snapshot':request['snapshot'],'plan':request['plan'],
             'map':enriched,'expected':expected}
    (out/'input-v3.json').write_bytes(json_bytes(payload))
    return payload


if __name__=='__main__':
    result=generate(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'frontend/tests/fixtures/scene-taxonomy')
    print(json.dumps({'map_ref':result['map']['map_ref'],'result_sha256':result['expected']['result']['result_sha256']},ensure_ascii=False))
