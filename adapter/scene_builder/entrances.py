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


def facade_midpoints(building):
    # Merge collinear OSM vertices so a facade split into several nodes still
    # gets one door in its middle, never at the corner between two walls.
    ring=[list(p) for p in building['polygon']]
    if ring[0]==ring[-1]:ring.pop()
    changed=True
    while changed and len(ring)>3:
        changed=False
        for i,b in enumerate(ring):
            a,c=ring[i-1],ring[(i+1)%len(ring)]
            ab=[b[0]-a[0],b[1]-a[1]];bc=[c[0]-b[0],c[1]-b[1]]
            if abs(ab[0]*bc[1]-ab[1]*bc[0])<=1e-5*max(1,distance(a,b)*distance(b,c)) and ab[0]*bc[0]+ab[1]*bc[1]>=0:
                ring.pop(i);changed=True;break
    sign=1 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))>=0 else -1
    result=[]
    for a,b in zip(ring,ring[1:]+ring[:1]):
        length=distance(a,b)
        if length<1e-6:continue
        result.append(([(a[0]+b[0])/2,(a[1]+b[1])/2],[(b[1]-a[1])*sign/length,-(b[0]-a[0])*sign/length],[a,b],length))
    # Tiny bevels are not useful front facades. Retain a fallback for small huts.
    return [x for x in result if x[3]>=min(8,max(x[3] for x in result))]


def generate_entrances(campus):
    cache_key=hashlib.sha256(json.dumps([campus['campus_id'],campus['projection'],campus['source'],[(b['osm_id'],b['polygon']) for b in campus['buildings']],campus['walk_graph']],sort_keys=True).encode()).hexdigest()
    if cache_key in _CACHE:return copy.deepcopy(_CACHE[cache_key])
    nodes={p['id']:p for p in campus['walk_graph']['nodes']}
    edges=[(e,[nodes[e['source']]['x'],nodes[e['source']]['y']],[nodes[e['target']]['x'],nodes[e['target']]['y']]) for e in campus['walk_graph']['edges']]
    records=[]
    for building in sorted(campus['buildings'],key=lambda b:b['osm_id']):
        candidates=facade_midpoints(building);best=None
        for point,normal,facade,length in candidates:
            for edge,c,d in edges:
                road=project(point,c,d);dx,dy=road[0]-point[0],road[1]-point[1]
                if dx*normal[0]+dy*normal[1]<-1e-6:continue
                key=(round(distance(point,road),6),-length,str(edge['source']),str(edge['target']),point)
                if best is None or key<best[0]:best=(key,edge,point,road,normal,facade)
        if best is None:
            point,normal,facade,_=max(candidates,key=lambda c:c[3])
            record={'point':point,'road_node_id':None,'connector':[],'connected':False}
        else:
            _,edge,point,road,normal,facade=best
            node_id=min((edge['source'],edge['target']),key=lambda key:(distance(road,[nodes[key]['x'],nodes[key]['y']]),str(key)))
            lead=[point[i]+normal[i]*min(3,distance(point,road)*.4) for i in (0,1)]
            connector=[]
            for p in (point,lead,road,[nodes[node_id]['x'],nodes[node_id]['y']]):
                p=[round(x,6) for x in p]
                if not connector or distance(p,connector[-1])>1e-6:connector.append(p)
            record={'point':[round(x,6) for x in point],'road_node_id':node_id,'connector':connector,'connected':True}
        records.append({'id':building['osm_id']+'/entrance/1','building_id':building['osm_id'],**record,
            'facade':facade,'outward':normal,'placement':'facade_midpoint','source':'inferred','illustrative':True})
    local={'schema_version':'mecoffe.entrances.v1','campus_id':campus['campus_id'],'illustrative':True,'geometry_source':campus['source'],
           'note':'入口位于朝道路的外墙中段，与路线一致；为展示示意，非实测，不解析 OSM entrance 标注。','entrances':records}
    geo={'type':'FeatureCollection','schema_version':'mecoffe.gis.v1','name':'entrances','source':campus['source'],
         'features':[{'type':'Feature','id':p['id'],'geometry':{'type':'Point','coordinates':to_wgs84(p['point'],campus['projection'])},
                      'properties':{**{k:v for k,v in p.items() if k not in ('point','connector')},'feature_id':p['id'],'category':'entrance'}} for p in records]}
    _CACHE[cache_key]=(local,geo)
    return copy.deepcopy((local,geo))
