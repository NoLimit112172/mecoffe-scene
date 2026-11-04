"""Illustrative door-to-walking-graph connectors; never alters archived geometry."""
import hashlib
import copy
import json
import math

from .gis import to_wgs84
_CACHE={}


def project(point, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))) if dx or dy else 0
    return [a[0]+dx*t, a[1]+dy*t]


def distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])


def pair(a, b, c, d):
    candidates = [(p, project(p,c,d)) for p in (a,b)] + [(project(p,a,b),p) for p in (c,d)]
    dx,dy=b[0]-a[0],b[1]-a[1]; ex,ey=d[0]-c[0],d[1]-c[1]
    cross=dx*ey-dy*ex
    if abs(cross)>1e-10:
        t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/cross
        u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/cross
        if 0<=t<=1 and 0<=u<=1:
            p=[a[0]+t*dx,a[1]+t*dy];candidates.append((p,p))
    return min(candidates,key=lambda p:(distance(*p),p[0],p[1]))


def generate_entrances(campus):
    cache_key=hashlib.sha256(json.dumps([campus['campus_id'],campus['projection'],campus['source'],[(b['osm_id'],b['polygon'],b.get('holes',[])) for b in campus['buildings']],campus['walk_graph']],sort_keys=True).encode()).hexdigest()
    if cache_key in _CACHE:return copy.deepcopy(_CACHE[cache_key])
    nodes={p['id']:p for p in campus['walk_graph']['nodes']}
    edges=[(e,[nodes[e['source']]['x'],nodes[e['source']]['y']],[nodes[e['target']]['x'],nodes[e['target']]['y']]) for e in campus['walk_graph']['edges']]
    buildings=sorted(campus['buildings'],key=lambda b:b['osm_id'])
    records=[]
    for b in buildings:
        options=[{'point':None}]
        for number,option in enumerate(options):
            best=None
            points=[option['point']] if option['point'] is not None else b['polygon']
            box=[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
            def lower_bound(item):
                _,c,d=item
                return math.hypot(max(box[0]-max(c[0],d[0]),min(c[0],d[0])-box[2],0),max(box[1]-max(c[1],d[1]),min(c[1],d[1])-box[3],0))
            for edge,c,d in sorted(edges,key=lower_bound):
                if best and lower_bound((edge,c,d))>best[0][0]+1e-8:continue
                if option['point'] is not None:
                    a=option['point'];p=project(a,c,d);choices=[(a,p)]
                else:
                    choices=[pair(a,z,c,d) for ring in [b['polygon'],*b.get('holes',[])] for a,z in zip(ring,ring[1:]+ring[:1])]
                for a,p in choices:
                    key=(round(distance(a,p),9),str(edge['source']),str(edge['target']),a,p)
                    if best is None or key<best[0]:best=(key,edge,a,p,c,d)
            if best is None:
                records.append({'id':b['osm_id']+'/entrance/'+str(number+1),'building_id':b['osm_id'],
                    'point':option['point'] or b['polygon'][0],'source':'inferred',
                    'road_node_id':None,'connector':[],
                    'connected':False,'illustrative':True})
                continue
            _,edge,point,road,c,d=best
            node_id=min((edge['source'],edge['target']),key=lambda key:(distance(road,[nodes[key]['x'],nodes[key]['y']]),str(key)))
            connector=[]
            for p in (point,road,[nodes[node_id]['x'],nodes[node_id]['y']]):
                p=[round(x,6) for x in p]
                if not connector or distance(p,connector[-1])>1e-6:connector.append(p)
            records.append({'id':b['osm_id']+'/entrance/'+str(number+1),'building_id':b['osm_id'],
                'point':[round(x,6) for x in point],'source':'inferred',
                'road_node_id':node_id,'connector':connector,'connected':True,'illustrative':True})
    local={'schema_version':'mecoffe.entrances.v1','campus_id':campus['campus_id'],'illustrative':True,'geometry_source':campus['source'],
           'note':'入口与道路连接为展示示意；本轮统一推断入口，非实测，不解析 OSM entrance 标注。','entrances':records}
    geo={'type':'FeatureCollection','schema_version':'mecoffe.gis.v1','name':'entrances','source':campus['source'],
         'features':[{'type':'Feature','id':p['id'],'geometry':{'type':'Point','coordinates':to_wgs84(p['point'],campus['projection'])},
                      'properties':{**{k:v for k,v in p.items() if k not in ('point','connector')},'feature_id':p['id'],'category':'entrance'}} for p in records]}
    _CACHE[cache_key]=(local,geo)
    return copy.deepcopy((local,geo))
