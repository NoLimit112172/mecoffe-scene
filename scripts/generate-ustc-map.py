"""Generate a public USTC map from archived geometry only, never download."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from adapter.scene_service.map_package import publish_map

parser=argparse.ArgumentParser()
parser.add_argument('--version',default='1')
parser.add_argument('--out',type=Path)
parser.add_argument('--annotations',type=Path)
parser.add_argument('--no-template',action='store_true')
args=parser.parse_args()
directory=ROOT/'data/maps/ustc-gaoxin'
result=publish_map(ROOT/'frontend/public/mecoffe/scenarios/ustc-history',args.out or directory/args.version,
                   'ustc-gaoxin',args.version,'中国科学技术大学 · 高新校区',args.annotations,
                   directory/'review-annotations.template.json' if args.version=='1' and not args.no_template else None)
print(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2))
