"""Confirmed polygon scopes and analytic line clipping to their metre buffer.

Only this opt-in path uses these helpers. Polygon/holes validation and point
membership reuse scene_service.geometry; a buffer is not a bounding rectangle
or a polygonal approximation of a circle.
"""
import copy
import math

from adapter.scene_service.geometry import in_building, segment_midpoints, valid_building
from .gis import to_local, projection_values
from .io import MapInputError

TOL = 1e-10


def fail(message):
    raise MapInputError('INVALID_SCOPE', message)


def project_scope(geometry, projection, max_vertices=2000):
    if not isinstance(geometry, dict) or set(geometry) != {'type', 'coordinates'}:
        fail('范围必须是只有 type 和 coordinates 的 WGS-84 GeoJSON 几何')
    kind = geometry['type']
    if kind not in ('Polygon', 'MultiPolygon'):
        fail('范围必须为 Polygon 或 MultiPolygon，不能用点或包围框代替')
    polygons = [geometry['coordinates']] if kind == 'Polygon' else geometry['coordinates']
    if not isinstance(polygons, list) or not polygons:
        fail('范围必须含至少一块多边形')
    parts, vertices = [], 0
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            fail('每块范围必须有外环')
        rings = []
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                fail('范围环至少需要四个坐标，并显式闭合')
            vertices += len(ring)
            if vertices > max_vertices:
                raise MapInputError('MAP_DATA_LIMIT', f'范围顶点超过上限 {max_vertices}，请简化确认范围或离线处理')
            for p in ring:
                if (not isinstance(p, list) or len(p) != 2 or
                        any(type(x) not in (int, float) or not math.isfinite(x) for x in p) or
                        not -180 <= p[0] <= 180 or not -89 < p[1] < 89):
                    fail('范围坐标必须是有限的 WGS-84 [经度,纬度]，不支持极区或附加高度')
            if ring[0] != ring[-1]:
                fail('范围环没有闭合，程序不会自动补闭合线')
            if max(p[0] for p in ring) - min(p[0] for p in ring) >= 180:
                fail('范围不能跨越日期变更线或覆盖半个地球')
            # Match the existing builder's millimetre geometry precision.
            rings.append([[round(v, 3) for v in to_local(p, projection)] for p in ring])
        building = {'polygon': rings[0], 'holes': rings[1:]}
        if not valid_building(building):
            fail('范围存在自相交、退化、非法孔洞或相互接触的内外环')
        parts.append({'outer': rings[0], 'holes': rings[1:]})
    for i, part in enumerate(parts):
        for other in parts[:i]:
            for a, b in ((part, other), (other, part)):
                area = {'polygon': b['outer'], 'holes': b['holes']}
                if any(in_building(p, area) for p in a['outer'][:-1]):
                    fail('MultiPolygon 各部分不能重叠')
                for p, q in zip(a['outer'], a['outer'][1:]):
                    if any(in_building(x, area) for x in segment_midpoints(p, q, [b['outer'], *b['holes']])):
                        fail('MultiPolygon 各部分不能交叉或重叠')
                    for c, d in zip(b['outer'], b['outer'][1:]):
                        if _collinear_overlap(p, q, c, d):
                            fail('MultiPolygon 各部分不能共用一段边界，请先提供合法区域')
    return parts


def _collinear_overlap(a, b, c, d):
    dx, dy = b[0]-a[0], b[1]-a[1]
    if any(abs(dx*(p[1]-a[1])-dy*(p[0]-a[0])) > 1e-7 for p in (c, d)):
        return False
    axis = 0 if abs(dx) >= abs(dy) else 1
    return min(max(a[axis], b[axis]), max(c[axis], d[axis])) - max(min(a[axis], b[axis]), min(c[axis], d[axis])) > 1e-7


def net_area(parts):
    def area(ring):
        return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]))) / 2
    return sum(area(p['outer']) - sum(area(h) for h in p['holes']) for p in parts)


def fetch_window(parts, projection, buffer_m):
    points = [p for part in parts for p in part['outer']]
    low = [min(p[i] for p in points)-buffer_m for i in (0, 1)]
    high = [max(p[i] for p in points)+buffer_m for i in (0, 1)]
    lon, lat, radius = projection_values(projection)
    def inverse(p):
        return [lon+math.degrees(p[0]/(radius*math.cos(math.radians(lat)))), lat+math.degrees(p[1]/radius)]
    a, b = inverse(low), inverse(high)
    return [*a, *b], (high[0]-low[0])*(high[1]-low[1])


def _linear_band(base, delta, low, high):
    if abs(delta) < TOL:
        return (0., 1.) if low-TOL <= base <= high+TOL else None
    a, b = sorted(((low-base)/delta, (high-base)/delta))
    a, b = max(0., a), min(1., b)
    return (a, b) if a <= b+TOL else None


def _disk(a, b, center, radius):
    dx, dy = b[0]-a[0], b[1]-a[1]
    x, y = a[0]-center[0], a[1]-center[1]
    aa = dx*dx+dy*dy
    bb, cc = 2*(x*dx+y*dy), x*x+y*y-radius*radius
    disc = bb*bb-4*aa*cc
    if disc < 0:
        return None
    root = math.sqrt(max(0., disc))
    lo, hi = max(0., (-bb-root)/(2*aa)), min(1., (-bb+root)/(2*aa))
    return (lo, hi) if lo <= hi+TOL else None


def _crossings(a, b, c, d):
    dx, dy, ex, ey = b[0]-a[0], b[1]-a[1], d[0]-c[0], d[1]-c[1]
    den = dx*ey-dy*ex
    if abs(den) <= TOL:
        return []  # Collinear boundary intervals are included by the capsule.
    x, y = c[0]-a[0], c[1]-a[1]
    t, u = (x*ey-y*ex)/den, (x*dy-y*dx)/den
    return [max(0., min(1., t))] if -TOL <= t <= 1+TOL and -TOL <= u <= 1+TOL else []


def clip_intervals(a, b, parts, radius):
    """Exact intervals in polygon union or <=radius from its boundary edges.

    An edge's Euclidean neighbourhood is a rectangle plus two endpoint disks.
    Analytic intersections preserve narrow intervals and rounded buffer corners.
    """
    if a == b:
        return []
    intervals, splits = [], [0., 1.]
    dx, dy = b[0]-a[0], b[1]-a[1]
    for part in parts:
        for ring in [part['outer'], *part['holes']]:
            for c, d in zip(ring, ring[1:]):
                splits.extend(_crossings(a, b, c, d))
                ex, ey = d[0]-c[0], d[1]-c[1]
                length = math.hypot(ex, ey)
                along = _linear_band(((a[0]-c[0])*ex+(a[1]-c[1])*ey)/length,
                                     (dx*ex+dy*ey)/length, 0., length)
                across = _linear_band(((a[0]-c[0])*(-ey)+(a[1]-c[1])*ex)/length,
                                      (dx*(-ey)+dy*ex)/length, -radius, radius)
                if along and across:
                    lo, hi = max(along[0], across[0]), min(along[1], across[1])
                    if lo <= hi:
                        intervals.append((lo, hi))
                intervals.extend(v for v in (_disk(a, b, c, radius), _disk(a, b, d, radius)) if v)
    splits = sorted(set(splits))
    for lo, hi in zip(splits, splits[1:]):
        mid = (lo+hi)/2
        p = [a[0]+dx*mid, a[1]+dy*mid]
        if any(in_building(p, {'polygon': v['outer'], 'holes': v['holes']}, False) for v in parts):
            intervals.append((lo, hi))
    merged = []
    for lo, hi in sorted(intervals):
        if hi-lo <= TOL:
            continue
        if merged and lo <= merged[-1][1]+TOL:
            merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
        else:
            merged.append((lo, hi))
    return merged


def clip_roads(roads, parts, radius):
    """Keep original OSM vertices; new cut vertices never connect other ways."""
    result = []
    for road in roads:
        pieces, points, ids = [], [], []
        def flush():
            nonlocal points, ids
            if len(points) >= 2:
                pieces.append((points, ids))
            points, ids = [], []
        for index, (a, b) in enumerate(zip(road['points'], road['points'][1:])):
            intervals = clip_intervals(a, b, parts, radius)
            for lo, hi in intervals:
                segment, names = [], []
                for t in (lo, hi):
                    if t <= TOL:
                        point, name = a, road['node_ids'][index]
                    elif t >= 1-TOL:
                        point, name = b, road['node_ids'][index+1]
                    else:
                        point = [round(a[i]+(b[i]-a[i])*t, 6) for i in (0, 1)]
                        name = f"scope/{road['osm_id']}/{road.get('segment', 0)}/{index}/{point[0]},{point[1]}"
                    segment.append(point); names.append(name)
                if segment[0] == segment[1]:
                    continue
                if ids and ids[-1] == names[0]:
                    points.append(segment[1]); ids.append(names[1])
                else:
                    flush(); points, ids = segment, names
                if hi < 1-TOL:
                    flush()
            if not intervals:
                flush()
        flush()
        for number, (points, ids) in enumerate(pieces):
            item = copy.deepcopy(road)
            item.update(points=points, node_ids=ids, feature_id=f"{road['osm_id']}/scope/{road.get('segment', 0)}/{number}")
            result.append(item)
    # Multiple pieces of the same OSM way must have distinct GIS segment IDs.
    counts = {}
    for road in result:
        road['segment'] = counts.get(road['osm_id'], 0)
        counts[road['osm_id']] = road['segment']+1
    return result
