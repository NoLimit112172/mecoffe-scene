"""Add functional evidence and conservative eligibility, without changing kind."""
import copy
from collections import Counter

from .common import require
from .geometry import cuts_interior, in_building, inside, intersects, point, valid_building, valid_ring, within_scope

FUNCTIONS = ('dining','retail','dormitory','residential','education','office','library','unknown')
TAG_FUNCTIONS = {
    'amenity': {'cafe':'dining','restaurant':'dining','fast_food':'dining','food_court':'dining','canteen':'dining','library':'library'},
    'building': {'dormitory':'dormitory','residential':'residential','apartments':'residential','house':'residential',
                 'university':'education','college':'education','school':'education','office':'office'},
    'shop': {name:'retail' for name in ('convenience','supermarket','bakery','books','clothes','general','kiosk','stationery','department_store','mall')},
}
KEYWORDS = {'食堂':'dining','咖啡':'dining','宿舍':'dormitory','教学楼':'education','图书馆':'library','办公':'office'}


def tag_evidence(tags, source, ref):
    result=[]
    for key, mapping in TAG_FUNCTIONS.items():
        function=mapping.get(tags.get(key)) if isinstance(tags.get(key), str) else None
        if function:
            result.append({'function':function,'source':source,'key':key,'value':tags[key],'ref':ref})
    office=tags.get('office')
    if isinstance(office,str) and office.strip() and office not in ('no','none','vacant'):
        result.append({'function':'office','source':source,'key':'office','value':office,'ref':ref})
    return result


def main_component(graph):
    nodes={n['id'] for n in graph.get('nodes', [])}
    neighbors={n:set() for n in nodes}
    for edge in graph.get('edges', []):
        if edge.get('walkable') is False:
            continue
        a,b=edge.get('source'),edge.get('target')
        if a in nodes and b in nodes:
            neighbors[a].add(b); neighbors[b].add(a)
    # Isolated vertices do not certify access to a walking network.
    unseen={n for n in nodes if neighbors[n]}; components=[]
    while unseen:
        todo=[min(unseen)]; found=set()
        while todo:
            n=todo.pop()
            if n in found:
                continue
            found.add(n); todo.extend(neighbors[n]-found)
        unseen-=found; components.append(found)
    return min(components,key=lambda c:(-len(c),sorted(c))) if components else set()


def enrich_map(package, annotations=None, min_main_ratio=.9, min_function_ratio=0.):
    require(type(min_main_ratio) in (int,float) and 0 <= min_main_ratio <= 1 and
            type(min_function_ratio) in (int,float) and 0 <= min_function_ratio <= 1,
            'INVALID_THRESHOLD','Quality thresholds must be in [0,1]')
    result=copy.deepcopy(package); campus=result['campus']
    buildings=campus.get('buildings', []); entrances=result.get('entrances', {}).get('entrances', [])
    require(isinstance(buildings,list) and isinstance(entrances,list), 'INVALID_MAP','Buildings and entrances must be arrays')
    ids=[b.get('osm_id') for b in buildings]
    require(all(isinstance(i,str) and i for i in ids) and len(set(ids)) == len(ids), 'INVALID_MAP','Building IDs must be unique')
    entrance_ids=[e.get('id') for e in entrances]
    require(all(isinstance(i,str) and i for i in entrance_ids) and len(set(entrance_ids))==len(entrance_ids), 'INVALID_MAP','Entrance IDs must be unique')
    by_id={b['osm_id']:b for b in buildings}; valid={i for i,b in by_id.items() if valid_building(b)}
    require(all(isinstance(b.get('tags',{}),dict) and isinstance(b.get('name',''),str) for b in buildings),'INVALID_MAP','Building tags and names are malformed')
    require(all(e.get('building_id') in by_id for e in entrances),'INVALID_MAP','Entrance references an unknown building')
    warnings=[]
    def warn(code,message,refs):
        warnings.append({'code':code,'message':message,'refs':sorted(refs)})
    annotations=annotations if annotations is not None else package.get('annotations', {'map_ref':package['map_ref'],'buildings':{}})
    require(annotations.get('map_ref') == package['map_ref'], 'REF_MISMATCH','Annotations must bind the exact map version and hash')
    entries=annotations.get('buildings', {})
    result['annotations']=copy.deepcopy(annotations)
    require(isinstance(entries,dict) and set(entries)<=set(ids), 'OVERRIDE_INVALID','Annotation references an unknown building')
    for b in buildings:
        tags=dict(b.get('tags', {}))
        if isinstance(b.get('building_type'),str):
            tags.setdefault('building',b['building_type'])
        b['function_evidence']=tag_evidence(tags,'building_tag',b['osm_id'])
        for text,function in KEYWORDS.items():
            if text in b.get('name',''):
                b['function_evidence'].append({'function':function,'source':'name_keyword','key':'name','value':text,'ref':b['osm_id']})
    poi_stats={'total':0,'associated':0,'ambiguous':0,'unassociated':0,'invalid':0}
    require(isinstance(campus.get('pois',[]),list) and all(isinstance(p,dict) and isinstance(p.get('tags',{}),dict) for p in campus.get('pois',[])),
            'INVALID_MAP','POI records need tag objects')
    for poi in sorted(campus.get('pois', []),key=lambda p:str(p.get('osm_id',''))):
        poi_stats['total']+=1
        if not point(poi.get('point')):
            poi_stats['invalid']+=1; continue
        matches=[b for b in buildings if b['osm_id'] in valid and in_building(poi['point'],b)]
        # A boundary of a second footprint is ambiguous too, never snap across it.
        touching=[b for b in buildings if b['osm_id'] in valid and in_building(poi['point'],b,False)]
        if len(matches)==1 and len(touching)==1:
            poi_stats['associated']+=1
            matches[0]['function_evidence'].extend(tag_evidence(poi.get('tags',{}),'poi',str(poi.get('osm_id','unknown-poi'))))
        else:
            poi_stats['ambiguous' if len(touching)>1 else 'unassociated']+=1
    for identifier, entry in entries.items():
        require(isinstance(entry,dict) and isinstance(entry.get('functions'),list) and entry['functions'] and
                all(f in FUNCTIONS for f in entry['functions']) and
                all(isinstance(entry.get(k),str) and entry[k].strip() for k in ('source','reviewer','note')) and
                entry.get('mode','add') in ('add','replace'), 'INVALID_ANNOTATION','Annotation needs functions, source, reviewer, note and add/replace mode')
        b=by_id[identifier]
        if entry.get('mode','add')=='replace':
            b['superseded_function_evidence']=copy.deepcopy([e for e in b['function_evidence'] if e['source']!='name_keyword'])
            b['function_evidence']=[e for e in b['function_evidence'] if e['source']=='name_keyword']
        b['function_evidence'].extend({'function':f,'source':'annotation','key':'functions','value':f,'ref':identifier} for f in sorted(set(entry['functions'])))
        b['function_annotation']=copy.deepcopy(entry)
    graph=campus.get('walk_graph', {})
    require(isinstance(graph,dict) and graph.get('directed',False) is False,'INVALID_MAP','Expected an undirected walking graph')
    graph_nodes=graph.get('nodes',[]); graph_edges=graph.get('edges',[])
    require(isinstance(graph_nodes,list) and all(isinstance(n,dict) and isinstance(n.get('id'),str) and point([n.get('x'),n.get('y')]) for n in graph_nodes),
            'INVALID_MAP','Graph nodes need unique IDs and finite metre coordinates')
    require(len({n['id'] for n in graph_nodes})==len(graph_nodes),'INVALID_MAP','Duplicate graph node')
    nodes={n['id']:[n['x'],n['y']] for n in graph.get('nodes', [])}
    require(isinstance(graph_edges,list) and all(isinstance(e,dict) and e.get('source') in nodes and e.get('target') in nodes and
            e['source']!=e['target'] and nodes[e['source']]!=nodes[e['target']] for e in graph_edges),
            'INVALID_MAP','Dangling graph edge')
    component=main_component(graph)
    water=[{'polygon':f.get('polygon'),'holes':f.get('holes',[])} for f in result.get('landcover',{}).get('features',[]) if f.get('kind')=='water']
    require(all(valid_building(w) for w in water),'INVALID_MAP','Invalid water geometry cannot certify safe placement')
    boundaries=campus.get('boundary_polygons') or [{'outer':campus.get('boundary'),'holes':[]}]
    require(all(valid_building({'polygon':p.get('outer'),'holes':p.get('holes',[])}) for p in boundaries), 'INVALID_MAP','Valid explicit map boundary required')
    main_count=0
    for entrance in entrances:
        b=by_id.get(entrance.get('building_id')); connector=entrance.get('connector', [])
        connected=(entrance.get('connected') is True and entrance.get('road_node_id') in component)
        main_count+=bool(connected)
        safe=(b is not None and b['osm_id'] in valid and point(entrance.get('point')) and
              isinstance(connector,list) and len(connector)>=2 and all(point(p) for p in connector))
        if safe:
            safe=(on_boundary(entrance['point'],b['polygon']) and
                  distance(connector[0],entrance['point'])<=.002 and
                  entrance.get('road_node_id') in nodes and distance(connector[-1],nodes[entrance['road_node_id']])<=.002)
        if safe:
            safe=not any(cuts_interior(a,c,other) for a,c in zip(connector,connector[1:]) for other in buildings if other['osm_id'] in valid)
            safe=safe and not any(inside(p,w['polygon'],False) for w in water for p in connector)
            safe=safe and not any(intersects(a,c,u,v) for a,c in zip(connector,connector[1:]) for w in water for u,v in zip(w['polygon'],w['polygon'][1:]))
        entrance['scene_reachable']=bool(connected and safe)
    counts=Counter(); no_entrance=0; eligible=0
    for b in buildings:
        b['function_evidence'].sort(key=lambda e:(e['function'],e['source'],e['key'],e['value'],e['ref']))
        b['functions']=sorted({e['function'] for e in b['function_evidence'] if e['source']!='name_keyword'}-{'unknown'}) or ['unknown']
        counts.update(b['functions'])
        associated=[e for e in entrances if e.get('building_id')==b['osm_id']]
        no_entrance+=not bool(associated)
        b['usable_entrance_ids']=sorted(e['id'] for e in associated if e['scene_reachable'])
        in_scope=b['osm_id'] in valid and any(within_scope(b,part) for part in boundaries)
        wet=b['osm_id'] in valid and any(any(inside(p,w['polygon'],False) for p in b['polygon'][:-1]) or any(in_building(p,b,False) for p in w['polygon'][:-1]) or any(intersects(a,c,u,v) for a,c in zip(b['polygon'],b['polygon'][1:]) for u,v in zip(w['polygon'],w['polygon'][1:])) for w in water)
        b['scene_eligible']=bool(in_scope and not wet and b['usable_entrance_ids'])
        eligible+=b['scene_eligible']
        if not b['scene_eligible']:
            warn('BUILDING_EXCLUDED','Invalid geometry, outside scope, water conflict, or no safe reachable entrance',[b['osm_id']])
    ratio=main_count/len(entrances) if entrances else 0
    known_ratio=(len(buildings)-counts['unknown'])/len(buildings) if buildings else 0
    ready=bool(buildings and len(valid)==len(buildings) and eligible and ratio>=min_main_ratio and known_ratio>=min_function_ratio)
    if counts['unknown']:
        warn('UNKNOWN_USE','Unknown building functions do not participate in strict matching',[b['osm_id'] for b in buildings if b['functions']==['unknown']])
    if poi_stats['ambiguous']:
        warn('POI_AMBIGUOUS','Overlapping building footprints prevent unique POI association',[])
    if poi_stats['invalid']:
        warn('POI_INVALID','Malformed POI coordinates ignored',[])
    warnings.sort(key=lambda w:(w['code'],w['refs']))
    result['quality']={'status':'ready' if ready else 'preview_only','buildings':len(buildings),'valid_buildings':len(valid),
                       'function_counts':{f:counts[f] for f in FUNCTIONS},'unknown':counts['unknown'],'no_entrance':no_entrance,
                       'entrances':len(entrances),'main_component_entrances':main_count,'main_component_ratio':ratio,
                       'eligible_buildings':eligible,'poi':poi_stats,
                       'thresholds':{'min_main_ratio':min_main_ratio,'min_function_ratio':min_function_ratio},'warnings':warnings}
    return result


def distance(a,b):
    return ((a[0]-b[0])**2+(a[1]-b[1])**2)**.5


def on_boundary(p,ring):
    from .geometry import on_segment
    return any(on_segment(p,a,b) for a,b in zip(ring,ring[1:]))
