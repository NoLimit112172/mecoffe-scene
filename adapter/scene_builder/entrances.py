"""Illustrative door-to-walking-graph connectors; never alters archived geometry."""
import hashlib
import copy
import json
import math
import heapq

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


class _RoadIndex:
    """Cold-build BVH; exact projection and the original tie rule choose roads.

    The box is only a distance lower bound. It cannot choose a road, because
    the closest projection can be behind the facade and rounded ties still
    depend on the original node IDs and edge order.
    """
    def __init__(self, edges):
        self.edges = edges
        self.nodes = []
        boxes = [(min(a[0], b[0]), min(a[1], b[1]),
                  max(a[0], b[0]), max(a[1], b[1])) for _, a, b in edges]
        def build(indices):
            bounds = (min(boxes[i][0] for i in indices), min(boxes[i][1] for i in indices),
                      max(boxes[i][2] for i in indices), max(boxes[i][3] for i in indices))
            identifier = len(self.nodes)
            self.nodes.append(None)
            if len(indices) <= 8:
                self.nodes[identifier] = (bounds, None, None, indices)
            else:
                axis = 0 if bounds[2]-bounds[0] >= bounds[3]-bounds[1] else 1
                indices.sort(key=lambda i: (boxes[i][axis]+boxes[i][axis+2], i))
                middle = len(indices)//2
                left, right = build(indices[:middle]), build(indices[middle:])
                self.nodes[identifier] = (bounds, left, right, None)
            return identifier
        self.root = build(list(range(len(edges)))) if edges else None

    @staticmethod
    def _lower_distance(point, bounds):
        return math.hypot(max(bounds[0]-point[0], 0., point[0]-bounds[2]),
                          max(bounds[1]-point[1], 0., point[1]-bounds[3]))

    def best(self, point, normal, facade, length, limit=math.inf):
        if self.root is None:
            return None
        # A distance up to half a micrometre above the winning rounded value
        # can tie it. Extra coordinate-ULP slack prevents floating projection
        # error from making the box lower bound overly aggressive.
        root_bounds = self.nodes[self.root][0]
        slack = .500001e-6 + max(1e-9, 8*max(math.ulp(v) for v in (*point, *root_bounds)))
        queue = [(self._lower_distance(point, root_bounds), self.root)]
        selected = None
        selected_order = None
        while queue:
            lower, identifier = heapq.heappop(queue)
            if lower > limit+slack:
                break
            bounds, left, right, indices = self.nodes[identifier]
            if indices is None:
                for child in (left, right):
                    child_lower = self._lower_distance(point, self.nodes[child][0])
                    if child_lower <= limit+slack:
                        heapq.heappush(queue, (child_lower, child))
                continue
            for order in indices:
                edge, c, d = self.edges[order]
                road = project(point, c, d)
                dx, dy = road[0]-point[0], road[1]-point[1]
                if dx*normal[0]+dy*normal[1] < -1e-6:
                    continue
                key = (round(distance(point, road), 6), -length,
                       str(edge['source']), str(edge['target']), point)
                if key[0] <= limit and (selected is None or (key, order) < (selected[0], selected_order)):
                    selected = (key, edge, point, road, normal, facade)
                    selected_order = order
                    limit = key[0]
        return selected


def generate_entrances(campus):
    cache_key=hashlib.sha256(json.dumps([campus['campus_id'],campus['projection'],campus['source'],[(b['osm_id'],b['polygon']) for b in campus['buildings']],campus['walk_graph']],sort_keys=True).encode()).hexdigest()
    if cache_key in _CACHE:return copy.deepcopy(_CACHE[cache_key])
    nodes={p['id']:p for p in campus['walk_graph']['nodes']}
    edges=[(e,[nodes[e['source']]['x'],nodes[e['source']]['y']],[nodes[e['target']]['x'],nodes[e['target']]['y']]) for e in campus['walk_graph']['edges']]
    road_index = _RoadIndex(edges)
    records=[]
    for building in sorted(campus['buildings'],key=lambda b:b['osm_id']):
        candidates=facade_midpoints(building);best=None
        for point,normal,facade,length in candidates:
            selected = road_index.best(point, normal, facade, length, best[0][0] if best else math.inf)
            if selected is not None and (best is None or selected[0] < best[0]):
                best = selected
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
