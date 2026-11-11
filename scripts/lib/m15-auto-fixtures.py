"""Build new synthetic v2 fixtures; never regenerates existing v1 fixtures."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from adapter.scene_service import resolve
from adapter.scene_service.auto_evidence import default_rules
from adapter.scene_service.maps import load_map
from adapter.scene_service.map_package import publish_map, json_bytes


def generate():
    old=ROOT/'frontend/tests/fixtures/scene-render'
    target=ROOT/'frontend/tests/fixtures/scene-auto'
    target.mkdir(parents=True,exist_ok=True)
    bundle=json.loads((old/'input-a.json').read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory() as temporary:
        source=Path(temporary)/'synthetic-render-a/1';shutil.copytree(old/'maps/synthetic-render-a/1',source)
        campus=json.loads((source/'campus3d.json').read_text(encoding='utf-8'))
        for building in campus['buildings']:
            building.pop('function_annotation',None)
            if building['osm_id']=='geojson/synthetic-building-1':
                building.update(name='合成智能判断楼',tags={'building':'yes'},building_type='yes')
            if building['osm_id']=='geojson/synthetic-building-3':
                building.update(name='合成食堂',tags={'building':'university'},building_type='university')
        for building in campus['buildings']:
            if building['osm_id']=='geojson/synthetic-building-4':
                building.update(name='合成低把握楼',tags={'building':'yes'},building_type='yes')
        (source/'campus3d.json').write_bytes(json_bytes(campus))
        manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
        manifest['files']['campus3d.json']=hashlib.sha256((source/'campus3d.json').read_bytes()).hexdigest()
        (source/'manifest.json').write_bytes(json_bytes(manifest))
        prepared=load_map(source)
        ai={'schema_version':'scene.ai-evidence.v1','synthetic':True,'map_ref':prepared['map_ref'],'buildings':{}}
        for identifier,functions,confidence in [('geojson/synthetic-building-1',['dining'],.84),('geojson/synthetic-building-4',['office'],.4)]:
            ai['buildings'][identifier]={'functions':functions,'confidence':confidence,'rationale':'合成离线判断，仅验证展示和阈值。',
                                        'model':'手写样例，未调用模型','prompt_version':'synthetic-1','generated_at':'2026-11-11T00:00:00Z'}
        ai_file=Path(temporary)/'ai.json';ai_file.write_bytes(json_bytes(ai))
        directory=target/'maps/synthetic-auto/1'
        info=publish_map(source,directory,'synthetic-auto','1','合成自动用途 · v2 展示',evidence_mode='auto',ai_evidence=ai_file)
        rules=copy.deepcopy(bundle['scene_result']['rules'])
        dining=[name for name,pref in rules['brand_prefs'].items() if 'dining' in pref['functions']]
        rules['overrides']['brands'].update({name:f'geojson/synthetic-building-{1+2*(i%2)}' for i,name in enumerate(dining)})
        request={**rules,'mode':'map','config_id':bundle['config_id'],'snapshot':bundle['snapshot'],'plan':bundle['plan'],
                 'assignment_seed':bundle['scene_result']['assignment_meta']['assignment_seed'],
                 'assumptions':['完全合成场景，AI 输出为手写离线样例；所有位置仅为示意。'],'map':load_map(directory)}
        result=resolve(request);bundle['scene_result']=result
        (target/'input-v2.json').write_bytes(json_bytes(bundle))
        context={'map':load_map(directory),'snapshot':bundle['snapshot'],'plan':bundle['plan'],'source_refs':result['source_refs']}
        (target/'context.json').write_bytes(json_bytes(context))
        print(json.dumps({'map_ref':info['map_ref'],'schema_version':result['schema_version'],
                          'outside':sum(a['status']=='out_of_scene' for a in result['assignments'])},ensure_ascii=False))


if __name__=='__main__':
    generate()
