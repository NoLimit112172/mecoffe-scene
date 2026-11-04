"""Deterministic WGS84 presentation layers, derived from the prepared map only."""
from __future__ import annotations

import math
from .io import MapInputError

LAYERS = ('buildings', 'roads', 'landcover', 'water', 'boundary', 'pois')


def projection_values(projection):
    if projection.get('method') != 'local_equirectangular':
        raise MapInputError('unsupported_gis_projection', 'GIS export requires the recorded local_equirectangular projection')
    try:
        lon, lat, radius = (float(projection[key]) for key in ('origin_lon', 'origin_lat', 'earth_radius_m'))
    except (KeyError, TypeError, ValueError):
        raise MapInputError('invalid_gis_projection', 'projection origin and radius are required') from None
    if not all(math.isfinite(v) for v in (lon, lat, radius)) or radius <= 0 or not -90 < lat < 90:
        raise MapInputError('invalid_gis_projection', 'invalid projection parameters')
    return lon, lat, radius


def to_wgs84(point, projection):
    lon, lat, radius = projection_values(projection)
    x, y = point
    return [round(lon + math.degrees(x / (radius * math.cos(math.radians(lat)))), 9),
            round(lat + math.degrees(y / radius), 9)]


def to_local(point, projection):
    lon, lat, radius = projection_values(projection)
    return [radius * math.cos(math.radians(lat)) * math.radians(point[0] - lon),
            radius * math.radians(point[1] - lat)]


def ring(points, projection, clockwise=False):
    result = [to_wgs84(p, projection) for p in points]
    if result and result[0] != result[-1]:
        result.append(result[0])
    if len(result) < 4:
        raise MapInputError('invalid_gis_ring', 'polygon requires a closed non-degenerate ring')
    area = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(result, result[1:]))
    if (area < 0) != clockwise:
        result.reverse()
    return result


def polygon(outer, holes, projection):
    return {'type': 'Polygon', 'coordinates': [ring(outer, projection), *[ring(h, projection, True) for h in holes]]}


def feature(identifier, geometry, **properties):
    return {'type': 'Feature', 'id': identifier, 'geometry': geometry, 'properties': {'feature_id': identifier, **properties}}


def export_gis(campus, assignments, landcover, mapping=None, surroundings=None):
    """No geocoding, POI matching, new movement or external requests here."""
    projection = campus['projection']
    projection_values(projection)
    records = {key: [] for key in LAYERS}
    assigned = {a['feature_id']: a for a in assignments.get('assignments', [])}
    mapped = {}
    for location_id, entry in (mapping or {}).get('mappings', {}).items():
        mapped.setdefault(entry.get('osm_id'), []).append(location_id)
    buildings = {b['osm_id']: b for b in campus['buildings']}
    for b in campus['buildings']:
        a = assigned.get(b['osm_id'], {})
        records['buildings'].append(feature(b['osm_id'], polygon(b['polygon'], b.get('holes', []), projection),
            name=b.get('name', ''), name_source=b.get('name_source', 'input'), category=b.get('kind', b.get('building_type', 'building')),
            building_type=b.get('building_type', 'yes'), height_m=b['height_m'], levels=b.get('levels'),
            height_source=b.get('height_source', 'default'), levels_source=b.get('levels_source', 'default'),
            prototype_id=a.get('prototype_id'), variant_id=a.get('variant_id'),
            location_ids=sorted(mapped.get(b['osm_id'], []))))
    for outside, roads in ((False, campus['roads']), (True, (surroundings or {}).get('roads', []))):
        for index, road in enumerate(roads):
            identifier = f"{'surrounding' if outside else 'road'}/{road['osm_id']}/{road.get('segment', index)}"
            if len(road['points']) < 2:
                continue
            records['roads'].append(feature(identifier, {'type': 'LineString', 'coordinates': [to_wgs84(p, projection) for p in road['points']]},
                name=road.get('name', ''), highway=road.get('highway', 'service'),
                walkable=False if outside else bool(road.get('walkable')), surrounding=outside,
                layer=str(road.get('layer', '0')), bridge=road.get('bridge', road.get('tags', {}).get('bridge', ''))))
    for index, area in enumerate(landcover.get('features', [])):
        tags = area.get('tags', {})
        water = area.get('kind') in ('water', 'river', 'lake') or tags.get('natural') == 'water'
        layer = 'water' if water else 'landcover'
        records[layer].append(feature(area.get('osm_id', f'area/{index}'), polygon(area['polygon'], area.get('holes', []), projection),
            name=area.get('name', tags.get('name', '')), category=area.get('kind', 'landcover'), sport=area.get('sport', tags.get('sport', ''))))
    boundaries = campus.get('boundary_polygons') or [{'outer': campus['boundary'], 'holes': []}]
    records['boundary'].append(feature('campus-boundary', {'type': 'MultiPolygon', 'coordinates': [
        polygon(p['outer'], p.get('holes', []), projection)['coordinates'] for p in boundaries]}, name=campus.get('title', ''), category='boundary'))
    for index, poi in enumerate(campus.get('pois', [])):
        tags = poi.get('tags', {})
        a = assigned.get(poi['osm_id'], {})
        records['pois'].append(feature(poi['osm_id'], {'type': 'Point', 'coordinates': to_wgs84(poi['point'], projection)},
            name=poi.get('name', ''), category=tags.get('amenity', tags.get('shop', 'poi')), prototype_id=a.get('prototype_id'),
            location_ids=sorted(mapped.get(poi['osm_id'], [])), illustrative=False))
    # Explicit mappings are displayed as points, never inferred from POI type.
    for location_id, entry in (mapping or {}).get('mappings', {}).items():
        b = buildings.get(entry.get('osm_id'))
        if not b:
            continue
        points = b['polygon'][:-1] if b['polygon'][0] == b['polygon'][-1] else b['polygon']
        centre = [sum(p[i] for p in points)/len(points) for i in (0, 1)]
        records['pois'].append(feature('location/'+location_id, {'type': 'Point', 'coordinates': to_wgs84(centre, projection)},
            name=entry.get('display_name') or entry.get('osm_name') or b.get('name', location_id), category='mapped_location',
            location_ids=[location_id], building_id=b['osm_id'], illustrative=True,
            prototype_id=assigned.get(b['osm_id'], {}).get('prototype_id')))
    return {f'gis/{name}.geojson': {'type': 'FeatureCollection', 'name': name, 'schema_version': 'mecoffe.gis.v1',
            'source': campus['source'], 'coordinate_system': 'WGS84 longitude, latitude',
            'notice': '人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据',
            'features': sorted(records[name], key=lambda f: str(f['id']))} for name in LAYERS}
