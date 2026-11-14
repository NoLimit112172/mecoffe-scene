"""Conservative local-metre geometry checks, independent of legacy rendering."""
import math
from functools import lru_cache

EPS = 1e-7


def point(value):
    return (isinstance(value, list) and len(value) == 2 and
            all(type(x) in (int, float) and math.isfinite(x) for x in value))


def on_segment(p, a, b):
    cross = (p[0]-a[0])*(b[1]-a[1]) - (p[1]-a[1])*(b[0]-a[0])
    return abs(cross) <= EPS * max(1, math.dist(a, b)) and all(
        min(a[i], b[i])-EPS <= p[i] <= max(a[i], b[i])+EPS for i in (0, 1))


def inside(p, ring, strict=True):
    if not point(p) or not valid_ring(ring):
        return False
    if any(on_segment(p, a, b) for a, b in zip(ring, ring[1:])):
        return not strict
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result


def intersects(a, b, c, d):
    # Reject spatially separate boxes before orientation arithmetic. Besides
    # reducing work, this corrects a known near-collinear floating-cancellation
    # false positive in the old predicate. Possible contacts retain its EPS
    # convention; unusual inputs still fall through to the original arithmetic.
    try:
        ordinary=(len(a)==len(b)==len(c)==len(d)==2 and
                  all(type(v) in (int,float) and math.isfinite(v) and abs(v)<=1e8
                      for p in (a,b,c,d) for v in p))
        if ordinary:
            for i in (0,1):
                ab_min,ab_max=min(a[i],b[i]),max(a[i],b[i])
                cd_min,cd_max=min(c[i],d[i]),max(c[i],d[i])
                if (math.nextafter(ab_max+EPS,math.inf)<math.nextafter(cd_min-EPS,-math.inf) or
                        math.nextafter(cd_max+EPS,math.inf)<math.nextafter(ab_min-EPS,-math.inf)):
                    return False
    except (TypeError,ValueError,IndexError,OverflowError):
        pass
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    if any(on_segment(p, q, r) for p, q, r in ((a,c,d),(b,c,d),(c,a,b),(d,a,b))):
        return True
    return cross(a,b,c)*cross(a,b,d) < 0 and cross(c,d,a)*cross(c,d,b) < 0


def valid_ring(ring):
    if not isinstance(ring, list) or len(ring) < 4 or not all(point(p) for p in ring) or ring[0] != ring[-1]:
        return False
    # Containment checks revisit the same rings for every POI and connector.
    # Include each coordinate's type: equal-valued int/float rings can produce
    # different area arithmetic. Copies share a key; edits must be rechecked.
    return _valid_ring_coordinates(tuple(tuple((type(value),value) for value in p) for p in ring))


@lru_cache(maxsize=4096)
def _valid_ring_coordinates(typed_coordinates):
    # Preserve the original values and arithmetic types rather than coercing
    # coordinates to a common representation for either storage or validation.
    ring=tuple(tuple(value for _,value in p) for p in typed_coordinates)
    if len({tuple(p) for p in ring[:-1]}) < 3:
        return False
    if abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]))) <= EPS:
        return False
    edges = list(zip(ring, ring[1:]))
    for i, (a,b) in enumerate(edges):
        if a == b:
            return False
        for j in range(i+1, len(edges)):
            if j == i+1 or (i == 0 and j == len(edges)-1):
                continue
            if intersects(a,b,*edges[j]):
                return False
    return True


def valid_building(building):
    outer, holes = building.get('polygon'), building.get('holes', [])
    if not valid_ring(outer) or not isinstance(holes, list):
        return False
    for i, hole in enumerate(holes):
        if not valid_ring(hole) or not all(inside(p, outer) for p in hole[:-1]):
            return False
        if any(intersects(a,b,c,d) for a,b in zip(hole,hole[1:]) for c,d in zip(outer,outer[1:])):
            return False
        for other in holes[:i]:
            if inside(hole[0],other,False) or inside(other[0],hole,False) or any(
                    intersects(a,b,c,d) for a,b in zip(hole,hole[1:]) for c,d in zip(other,other[1:])):
                return False
    return True


def in_building(p, building, strict=True):
    return inside(p, building['polygon'], strict) and not any(inside(p, h, False) for h in building.get('holes', []))


def segment_midpoints(a, b, rings):
    # Split a segment at every ring crossing, then inspect interval midpoints.
    values = [0., 1.]
    dx, dy = b[0]-a[0], b[1]-a[1]
    for ring in rings:
        for c,d in zip(ring,ring[1:]):
            ex,ey=d[0]-c[0],d[1]-c[1]
            den=dx*ey-dy*ex
            if abs(den) > EPS:
                t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/den
                u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den
                if 0 <= t <= 1 and 0 <= u <= 1:
                    values.append(t)
    values=sorted(set(values))
    return [[a[0]+dx*(l+r)/2, a[1]+dy*(l+r)/2] for l,r in zip(values,values[1:])]


def cuts_interior(a, b, building):
    return any(in_building(p,building) for p in segment_midpoints(a,b,[building['polygon'],*building.get('holes',[])]))


def within_scope(building, part):
    rings=[part['outer'],*part.get('holes',[])]
    samples=list(building['polygon'][:-1])
    for a,b in zip(building['polygon'],building['polygon'][1:]):
        samples.extend(segment_midpoints(a,b,rings))
    return all(inside(p,part['outer'],False) and not any(inside(p,h,False) for h in part.get('holes',[])) for p in samples) and not any(
        in_building(h[0],building) for h in part.get('holes',[]))
