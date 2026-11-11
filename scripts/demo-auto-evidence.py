"""Offline USTC demonstration only; output must not enter the official map library."""
import argparse
import copy
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from adapter.scene_service.auto_evidence import prepare_ai_review
from adapter.scene_service.maps import load_map
from adapter.scene_service.map_package import publish_map, json_bytes
from adapter.scene_service.evidence import enrich_map
from adapter.scene_service.checker import check_scene


parser=argparse.ArgumentParser()
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
out=args.out.resolve()
if out.is_relative_to((ROOT/'data/maps').resolve()):
    parser.error('Demonstration output must stay outside data/maps')
out.mkdir(parents=True,exist_ok=True)
source=ROOT/'frontend/public/mecoffe/scenarios/ustc-history'
prepared=load_map(source)
review=prepare_ai_review(prepared);(out/'ai-request.json').write_bytes(json_bytes(review))
names=publish_map(source,out/'maps/ustc-auto-demo/1','ustc-auto-demo','1','中科大自动用途 · 未发布演示',evidence_mode='auto')
unknown=[b for b in enrich_map(load_map(out/'maps/ustc-auto-demo/1'))['campus']['buildings'] if b['functions']==['unknown']]
if len(unknown)<2:
    raise RuntimeError('Demonstration requires two unresolved buildings')
ai={'schema_version':'scene.ai-evidence.v1','synthetic':True,'map_ref':prepared['map_ref'],'buildings':{}}
for building,function,confidence in [(unknown[1],'office',.8),(unknown[0],'dormitory',.4)]:
    ai['buildings'][building['osm_id']]={'functions':[function],'confidence':confidence,'rationale':'手写离线演示判断，不代表该楼的现实用途。',
                                       'model':'固定离线样例，未调用模型','prompt_version':'demo-1','generated_at':'2026-11-11T00:00:00Z'}
ai_path=out/'synthetic-ai-output.json';ai_path.write_bytes(json_bytes(ai))
automatic=publish_map(source,out/'maps/ustc-auto-demo/2','ustc-auto-demo','2','中科大自动用途及 AI · 未发布演示',
                      evidence_mode='auto',ai_evidence=ai_path)
after=load_map(out/'maps/ustc-auto-demo/2')
changes=[{'building_id':b['osm_id'],'name':b.get('name',''),'functions':b['functions'],
          'active_ai':[e for e in b['function_evidence'] if e['source']=='ai_inferred']}
         for b in after['campus']['buildings'] if b['osm_id'] in ai['buildings']]
fixtures=ROOT/'adapter/scene_service/fixtures'
intent=json.loads((fixtures/'prefs.json').read_text(encoding='utf-8'));intent['map_ref']=automatic['map_ref']
check=check_scene(intent,json.loads((fixtures/'snapshot.json').read_text(encoding='utf-8')),
                  json.loads((fixtures/'plan.json').read_text(encoding='utf-8')),out/'maps/ustc-auto-demo/2',assignment_seed=42)
result={'published':False,'position_notice':'所有位置仅为示意；AI 判断为手写样例，不是事实认证。','names_only':names['quality'],
        'with_offline_ai':automatic['quality'],'ai_changes':changes,'review_count':len(review['buildings']),
        'check_conclusion':check['conclusion'],'check_evidence_usage':check.get('evidence_usage')}
(out/'summary.json').write_bytes(json_bytes(result))
print(json.dumps(result,ensure_ascii=False,indent=2))
