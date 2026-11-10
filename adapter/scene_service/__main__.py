"""Local JSON CLI; no network, server or rendering side effects."""
import argparse
import json
import sys

from .common import read_json, write_json, SceneError
from .evidence import enrich_map
from .maps import load_map
from .resolver import resolve
from .request import adapt_request
from .validation import validate_result


def main(argv=None):
    parser=argparse.ArgumentParser(description='Local display-only scene service')
    commands=parser.add_subparsers(dest='command',required=True)
    evidence=commands.add_parser('evidence')
    evidence.add_argument('--map',required=True); evidence.add_argument('--annotations')
    evidence.add_argument('--min-main-ratio',type=float,default=.9)
    evidence.add_argument('--min-function-ratio',type=float,default=0.)
    evidence.add_argument('--out',required=True)
    resolution=commands.add_parser('resolve')
    resolution.add_argument('--map'); resolution.add_argument('--snapshot',required=True)
    resolution.add_argument('--plan',required=True); resolution.add_argument('--prefs',required=True)
    resolution.add_argument('--out',required=True)
    validation=commands.add_parser('validate')
    validation.add_argument('result'); validation.add_argument('--context')
    validation.add_argument('--map'); validation.add_argument('--snapshot'); validation.add_argument('--plan')
    args=parser.parse_args(argv)
    try:
        if args.command=='evidence':
            result=enrich_map(load_map(args.map),read_json(args.annotations) if args.annotations else None,
                              args.min_main_ratio,args.min_function_ratio)
            write_json(args.out,result)
            print(json.dumps(result['quality'],ensure_ascii=False))
        elif args.command=='resolve':
            request=adapt_request(read_json(args.prefs),read_json(args.snapshot),read_json(args.plan),load_map(args.map) if args.map else None)
            result=resolve(request); write_json(args.out,result)
            print(json.dumps({'scene_id':result['scene_id'],'result_sha256':result['result_sha256']}))
        else:
            context=read_json(args.context) if args.context else {}
            for key in ('map','snapshot','plan'):
                path=getattr(args,key)
                if path:
                    context[key]=load_map(path) if key=='map' else read_json(path)
            if 'map' in context:
                context['map']=enrich_map(context['map'],context['map'].get('annotations'),**context['map'].get('quality',{}).get('thresholds',{}))
            validate_result(read_json(args.result),context)
            print('{"valid":true}')
        return 0
    except (SceneError, OSError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({'code':getattr(error,'code','INVALID_INPUT'),'message':str(error)},ensure_ascii=False),file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
