"""Offline M15 render fixtures: synthetic data + one public USTC geometry copy."""
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from adapter.scene_builder.core import build_from_geojson
from adapter.scene_builder.entrances import generate_entrances
from adapter.scene_builder.gis import export_gis
from adapter.scene_service import enrich_map,load_map,resolve

OUT=ROOT/'frontend/tests/fixtures/scene-render'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def write_json(path,value):
    # File-byte hashes must survive regeneration and checkout on Windows/Linux.
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes((json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+'\n').encode('utf-8'))


def synthetic_map():
    features=[]
    for i,kind in enumerate(('school','yes','dormitory','yes','residential','yes')):
        x=103.77+i*.001;y=1.294
        tags={'building':kind,'name':f'合成楼栋 {i}'}
        if i in (1,3):tags['amenity']='cafe'
        if i==5:tags['amenity']='library'
        features.append({'type':'Feature','id':f'synthetic-building-{i}','properties':tags,'geometry':{'type':'Polygon','coordinates':[[[x,y],[x+.0004,y],[x+.0004,y+.0003],[x,y+.0003],[x,y]]]}})
    features.append({'type':'Feature','id':'synthetic-walk','properties':{'highway':'footway'},'geometry':{'type':'LineString','coordinates':[[103.7702+i*.001,1.2937] for i in range(6)]}})
    bundle=build_from_geojson({'type':'FeatureCollection','source':{'license':'CC0-1.0','attribution':'Entirely synthetic test geometry'},'features':features},campus_id='synthetic-render-a',title='合成校园甲')
    entrance,_=generate_entrances(bundle['campus'])
    return {'map_ref':{'map_id':'synthetic-render-a','map_version':'1','manifest_sha256':'0'*64},'campus':bundle['campus'],'entrances':entrance,'landcover':bundle['landcover']},bundle['assignments']


def main():
    old=ROOT/'frontend/tests/fixtures/generic-replay'
    snapshot=read(old/'snapshot.json');plan=read(old/'plan.json');trajectory=read(old/'trajectory.json')
    roles={'synthetic':True,'population_request':{role:{'description':'合成角色 '+role,'count':sum(n['role']==role for n in snapshot['nodes']),'generate':{}} for role in sorted({n['role'] for n in snapshot['nodes']})}}
    for kind in ('a','b'):
        if kind=='a':package,assets=synthetic_map();title='合成校园甲 · SceneResult 验收'
        else:
            directory=ROOT/'frontend/public/mecoffe/scenarios/ustc-history'
            package=load_map(directory);package['map_ref']={'map_id':'public-ustc-render-b','map_version':'1','manifest_sha256':'0'*64}
            assets=read(directory/'asset_assignments.json');title='中科大公开几何测试副本 · 合成用途补注'
        initial=enrich_map(package)
        safe=[b for b in initial['campus']['buildings'] if b['scene_eligible']]
        shop=next((b for b in safe if 'dining' in b['functions']),safe[0])['osm_id']
        annotations={'map_ref':package['map_ref'],'buildings':{shop:{'functions':['dining'],'source':'synthetic test annotation, not verified real use','reviewer':'synthetic-reviewer','note':'仅合成验收，不能当成实际经营用途'}}}
        package=enrich_map(package,annotations)
        files={'campus3d.json':package['campus'],'entrances.json':package['entrances'],'landcover.json':package['landcover'],
               'asset_assignments.json':assets,'quality.json':package['quality']}
        files.update(export_gis(package['campus'],assets,package['landcover']))
        _,files['gis/entrances.geojson']=generate_entrances(package['campus'])
        directory=OUT/'maps'/package['map_ref']['map_id']/'1'
        for name,value in files.items():write_json(directory/name,value)
        manifest={'schema_version':'scene.map-manifest.v1','map_id':package['map_ref']['map_id'],'map_version':'1','title':title,
                  'asset_library_version':'bundled-v1','catalog_sha256':sha((ROOT/'frontend/public/mecoffe/assets3d/catalog.json').read_bytes()),
                  'style':{'buildings':'procedural','characters':'campus'},'files':{name:sha((directory/name).read_bytes()) for name in files}}
        write_json(directory/'manifest.json',manifest)
        package['map_ref']['manifest_sha256']=sha((directory/'manifest.json').read_bytes())
        package['annotations']['map_ref']=copy.deepcopy(package['map_ref'])
        names=[p['product_name'] for p in plan['economy']['products']]
        request={'mode':'map','config_id':'synthetic-live-config','map':package,'snapshot':snapshot,'plan':plan,'assignment_seed':42,
                 'role_prefs':{'visitor':{'functions':['education'],'fallback':'fail'},'operator':{'functions':['dormitory'],'fallback':'fail'},'research':{'functions':['retail'],'fallback':'out_of_scene'}},
                 'brand_prefs':{n:{'functions':['dining'],'fallback':'fail'} for n in names},'overrides':{'entities':{},'brands':{names[0]:shop,names[1]:shop}},
                 'assumptions':['完全合成验收；所有安置和路线为示意，非真实住所或经营地点。']}
        request['brand_prefs'][names[2]]={'functions':['retail'],'fallback':'out_of_scene'}
        result=resolve(request)
        value={'synthetic':True,'config_id':request['config_id'],'snapshot':snapshot,'plan':plan,'roles':roles,'trajectory':trajectory,'scene_result':result}
        write_json(OUT/f'input-{kind}.json',value)
        if kind=='a':
            request.update(mode='none',reason='本次为用户确认的合成纯网络实验')
            value['scene_result']=resolve(request);write_json(OUT/'input-none.json',value)


if __name__=='__main__':main()
