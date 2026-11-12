"""python -m adapter.scene_builder --help"""
import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

from . import MapInputError, build_from_geojson, build_from_osm, download_osm, write_bundle
from .core import CATALOG_PATH


def main(argv=None):
    parser=argparse.ArgumentParser(description='Prepare a map/asset scene; no OASIS simulation data is generated')
    sub=parser.add_subparsers(dest='format',required=True)
    for name in ('osm','geojson'):
        command=sub.add_parser(name)
        command.add_argument('--campus-id',required=True)
        command.add_argument('--title',default='Map modeling preview')
        command.add_argument('--seed',default='0')
        command.add_argument('--style',default='procedural')
        command.add_argument('--catalog',type=Path,default=CATALOG_PATH)
        command.add_argument('--output-dir',type=Path,required=True)
        command.add_argument('--location-rules',type=Path)
        if name=='osm':
            command.add_argument('--bbox',nargs=4,type=float,metavar=('MIN_LON','MIN_LAT','MAX_LON','MAX_LAT'))
            command.add_argument('--archive-dir',type=Path,default=Path('data/osm'))
            command.add_argument('--osm',type=Path)
            command.add_argument('--metadata',type=Path)
            command.add_argument('--profile',choices=['ustc_legacy'])
        else: command.add_argument('--input',type=Path,required=True)
    scenario_command=sub.add_parser('scenario', help='Prepare a map and simulation-time manifest')
    scenario_command.add_argument('--manifest', type=Path, required=True)
    index_command=sub.add_parser('scenario-index', help='Rebuild the directory of already prepared scenarios')
    index_command.add_argument('--scenario-dir', type=Path)
    index_command.add_argument('--default-id')
    physical = sub.add_parser('physical-map', help='Prepare an offline polygon-scoped physical map')
    for name in ('osm', 'metadata', 'scope', 'rules', 'out'):
        physical.add_argument('--'+name, type=Path, required=True)
    physical.add_argument('--map-id', required=True)
    physical.add_argument('--map-version', default='1')
    physical.add_argument('--title', required=True)
    physical.add_argument('--scope-source', type=Path, help='Scope provenance JSON; default type=manual')
    physical.add_argument('--road-buffer-m', type=float, default=50.)
    physical.add_argument('--limits', type=Path, help='JSON overrides for PhysicalMapLimits')
    physical.add_argument('--draft-out', type=Path, help='Optionally retain a complete pre-publication draft')
    physical.add_argument('--seed', default='0', help='Map-building seed, independent of assignment/simulation seeds')
    args=parser.parse_args(argv)
    try:
        if args.format=='physical-map':
            from .physical_map import prepare_physical_map
            result=prepare_physical_map(args.osm,args.metadata,json.loads(args.scope.read_text(encoding='utf-8')),
                scope_source=json.loads(args.scope_source.read_text(encoding='utf-8')) if args.scope_source else {'type':'manual'},
                title=args.title,map_id=args.map_id,map_version=args.map_version,rules_path=args.rules,out=args.out,
                road_buffer_m=args.road_buffer_m,seed=args.seed,draft_out=args.draft_out,
                limits=json.loads(args.limits.read_text(encoding='utf-8')) if args.limits else None,
                progress=lambda event:print(json.dumps(event,ensure_ascii=False),file=sys.stderr))
            print(json.dumps(result,ensure_ascii=False))
            return 0
        if args.format=='scenario-index':
            from .scenario import write_scenario_index
            print(json.dumps(write_scenario_index(args.scenario_dir, args.default_id), ensure_ascii=False))
            return 0
        if args.format=='scenario':
            from .scenario import prepare_scenario
            manifest, output=prepare_scenario(args.manifest)
            print(json.dumps({'output':str(output),'id':manifest['id'],'simulation_data':manifest['simulation_data']},ensure_ascii=False))
            return 0
        options={'campus_id':args.campus_id,'title':args.title,'seed':args.seed,'catalog_path':args.catalog,'style':args.style,
                 'location_rules':json.loads(args.location_rules.read_text(encoding='utf-8')) if args.location_rules else None}
        if args.format=='geojson':
            bundle=build_from_geojson(json.loads(args.input.read_text(encoding='utf-8')),**options)
        else:
            if args.bbox:
                if args.osm or args.metadata: raise MapInputError('conflicting_inputs','use either --bbox download or --osm/--metadata saved inputs')
                if not args.campus_id.replace('_','').replace('-','').isalnum(): raise MapInputError('invalid_campus_id','download campus_id may contain letters, numbers, underscore and hyphen')
                osm=args.archive_dir/f'{args.campus_id}.osm';metadata=args.archive_dir/f'{args.campus_id}.metadata.json'
                download_osm(args.bbox,osm,metadata)
            else:
                if not args.osm or not args.metadata: raise MapInputError('missing_osm_input','provide --bbox or both --osm and --metadata')
                osm,metadata=args.osm,args.metadata
            bundle=build_from_osm(osm,metadata,profile=args.profile,**options)
        manifest=write_bundle(bundle,args.output_dir)
        print(json.dumps({'output':str(args.output_dir),'campus_id':manifest['campus_id'],**bundle['campus']['stats'],
                          'assignments':len(bundle['assignments']['assignments']),'warnings':bundle['campus'].get('warnings',[])},ensure_ascii=False))
        return 0
    except (MapInputError,OSError,ValueError,ET.ParseError) as error:
        print(json.dumps({'error':getattr(error,'code','invalid_input'),'message':str(error)},ensure_ascii=False),file=sys.stderr)
        return 1


if __name__=='__main__': raise SystemExit(main())
