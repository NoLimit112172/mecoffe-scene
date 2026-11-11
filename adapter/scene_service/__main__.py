"""Local JSON CLI; no network, server or rendering side effects."""
import argparse
import json
import sys
from pathlib import Path

from .common import read_json, write_json, SceneError
from .evidence import enrich_map
from .maps import load_map
from .resolver import resolve
from .request import adapt_request
from .validation import validate_result
from .compiler import compile_scene
from .issues import compile_failure


class CompileParser(argparse.ArgumentParser):
    def error(self, message):
        raise SceneError('INVALID_INPUT', message)


def compile_main(argv):
    parser=CompileParser(description='Compile a local scene intent (provisional fields)')
    parser.add_argument('--intent',required=True)
    parser.add_argument('--snapshot',required=True); parser.add_argument('--plan',required=True)
    parser.add_argument('--map'); parser.add_argument('--assignment-seed',required=True)
    parser.add_argument('--out')
    try:
        args=parser.parse_args(argv)
        intent=read_json(args.intent)
        # none must never read even an explicitly supplied missing/bad map path.
        package=load_map(args.map) if isinstance(intent,dict) and intent.get('mode')=='map' and args.map else None
        try:
            seed=json.loads(args.assignment_seed)
        except ValueError:
            seed=args.assignment_seed
        response=compile_scene(intent,read_json(args.snapshot),read_json(args.plan),package,assignment_seed=seed)
        if args.out:
            write_json(args.out,response)
    except (SceneError, OSError, KeyError, TypeError, ValueError, AttributeError, IndexError) as error:
        response=compile_failure(error)
    print(json.dumps(response,ensure_ascii=False))
    return 0 if response['ok'] else 2


def check_main(argv):
    from .checker import check_scene, input_failure, local_path, render_report
    parser=CompileParser(description='Local configuration checks; run binding remains unconfirmed')
    parser.add_argument('--intent',required=True)
    parser.add_argument('--snapshot',required=True); parser.add_argument('--plan',required=True)
    parser.add_argument('--map'); parser.add_argument('--assignment-seed',required=True)
    parser.add_argument('--out')
    try:
        args=parser.parse_args(argv)
        intent=read_json(local_path(args.intent))
        try:
            seed=json.loads(args.assignment_seed)
        except ValueError:
            seed=args.assignment_seed
        report=check_scene(intent,read_json(local_path(args.snapshot)),read_json(local_path(args.plan)),
                           args.map,assignment_seed=seed)
        if args.out:
            target=local_path(args.out)
            write_json(target,report)
            Path(str(target)+'.txt').write_text(render_report(report),encoding='utf-8')
    except (SceneError, OSError, KeyError, TypeError, ValueError, AttributeError, IndexError) as error:
        report=input_failure(error)
    print(json.dumps(report,ensure_ascii=False))
    print(render_report(report),file=sys.stderr,end='')
    return 0 if report['configuration_ok'] else 1


def main(argv=None):
    argv=list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0]=='compile':
        return compile_main(argv[1:])
    if argv and argv[0]=='check':
        return check_main(argv[1:])
    parser=argparse.ArgumentParser(description='Local display-only scene service')
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('compile',help='Compile local intent to a result or explained error')
    commands.add_parser('check',help='Check local configuration and list unconfirmed runtime facts')
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
