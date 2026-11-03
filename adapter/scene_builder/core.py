"""A deterministic WGS84 map -> metric display scene pipeline (stdlib only).

This is a geometry/asset preparation boundary, not an OASIS execution engine.
The explicit ustc_legacy input profile preserves the previously accepted scene
byte semantics by re-running its original OSM adapter, not by reading its JSON.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from .io import MapInputError, read_osm, validate_bbox, write_json
try:
    from adapter import osm_to_campus3d as legacy
except ImportError:  # unittest discover -s adapter adds adapter/ to sys.path
    import osm_to_campus3d as legacy


ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / 'frontend/public/mecoffe/assets3d/catalog.json'


def fnv1a(value):
    number = 2166136261
    for byte in str(value).encode('utf-8'):
        number = ((number ^ byte) * 16777619) & 0xffffffff
    return number


def load_catalog(path=CATALOG_PATH):
    catalog = json.loads(Path(path).read_text(encoding='utf-8'))
    if catalog.get('schema_version') != 'mecoffe.asset-catalog.v1' or not isinstance(catalog.get('prototypes'), list):
        raise MapInputError('invalid_catalog', 'expected mec offe asset catalog v1 with prototypes')
    ids = set()
    for prototype in catalog['prototypes']:
        if not prototype.get('id') or prototype['id'] in ids or not prototype.get('source') or not prototype.get('license'):
            raise MapInputError('invalid_catalog', 'each prototype needs a unique id, source and license')
        ids.add(prototype['id'])
    return catalog


def match_score(tags, rule):
    """All keys in a rule must match; arrays mean OR, '*' means present."""
    if not isinstance(rule, dict) or not rule:
        return None
    score = 0
    for key, expected in rule.items():
        actual = tags.get(key)
        options = expected if isinstance(expected, list) else [expected]
        if actual is not None and str(actual) in [str(option) for option in options if option != '*']:
            score += 4
        elif '*' in options and actual is not None and str(actual) not in ('', 'no', 'false', 'None'):
            score += 1
        else:
            return None
    return score


def select_prototype(tags, category, catalog, seed=0, feature_id='', style='procedural'):
    candidates = []
    for prototype in catalog['prototypes']:
        if prototype.get('target','feature') == 'component':
            continue
        if prototype.get('category') != category:
            continue
        if prototype.get('style', 'procedural') not in (style, 'shared', 'data'):
            continue
        rule = prototype.get('match', {})
        rules = rule if isinstance(rule, list) else [rule]
        scores = [(match_score(tags, option), option) for option in rules]
        scores = [(score, option) for score, option in scores if score is not None]
        if scores:
            score, matched_rule = max(scores, key=lambda item: item[0])
            candidates.append((-score, prototype['id'], prototype, matched_rule))
    if not candidates:
        prototype = next((item for item in catalog['prototypes'] if category == 'building' and item['id'] == 'building.procedural.other'), None)
        if prototype is None:
            raise MapInputError('no_prototype_match', f'no {category} prototype for feature {feature_id} tags {tags}')
        rule = {}
    else:
        _, _, prototype, rule = min(candidates, key=lambda item: (item[0], item[1]))
    variants = prototype.get('variants') or [{'id': 'default', 'params': {}}]
    selected = variants[fnv1a(f'{seed}|{feature_id}|{prototype["id"]}') % len(variants)]
    variant = selected if isinstance(selected, dict) else {'id': str(selected), 'params': {}}
    return {'prototype_id': prototype['id'], 'variant_id': variant['id'],
            'params': {**copy.deepcopy(prototype.get('params', {})), **copy.deepcopy(variant.get('params', {}))},
            'reason': [f'{key}={tags.get(key)} matches {value}' for key, value in sorted(rule.items())] or ['explicit generic building fallback'],
            'source': copy.deepcopy(prototype['source']), 'license': copy.deepcopy(prototype['license'])}


def _coordinate(point):
    if not isinstance(point, (list, tuple)) or len(point) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point):
        raise MapInputError('invalid_coordinate', 'coordinates must be finite [longitude,latitude] pairs without altitude')
    if not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90:
        raise MapInputError('invalid_coordinate', 'coordinate is outside WGS84 longitude/latitude limits')
    return list(point)


def _ring(ring):
    if not isinstance(ring, list) or len(ring) < 4:
        raise MapInputError('invalid_polygon', 'polygon rings need at least three vertices plus closure')
    points = [_coordinate(point) for point in ring]
    if points[0] != points[-1] or len(set(map(tuple, points[:-1]))) < 3:
        raise MapInputError('invalid_polygon', 'polygon ring must be closed with three distinct vertices')
    if abs(legacy.ring_area(points)) <= 1e-14:
        raise MapInputError('invalid_polygon', 'polygon ring has zero area')
    return points


def _kind(tags):
    if tags.get('amenity') == 'library': return 'library'
    if tags.get('amenity') in ('cafe', 'restaurant', 'food_court', 'canteen'): return 'dining'
    if tags.get('building') in ('office', 'administrative'): return 'office'
    if tags.get('building') in ('apartments', 'residential', 'dormitory'): return 'dormitory'
    return legacy.building_kind(tags)


def _project(point, origin):
    return [round(value, 3) for value in legacy.project(*point, *origin)]


def _bounds(points):
    return [min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)]


def _projection(origin):
    return {'method': 'local_equirectangular', 'units': 'metres', 'x': 'east', 'y': 'north',
            'origin_lon': origin[0], 'origin_lat': origin[1], 'earth_radius_m': legacy.EARTH_RADIUS_M,
            'origin_method': 'centre of requested WGS84 extent',
            'formula': 'x = R*cos(lat0)*radians(lon-lon0); y = R*radians(lat-lat0)'}


def _building(identifier, rings, tags, origin):
    kind = _kind(tags)
    levels = legacy.positive_number(str(tags.get('building:levels', tags.get('levels', ''))))
    height = legacy.positive_number(str(tags.get('height', tags.get('height_m', ''))))
    default_levels = legacy.DEFAULT_LEVELS[kind]
    return {'osm_id': identifier, 'name': str(tags.get('name') or f'未命名建筑（{identifier}）'),
            'name_source': 'input' if tags.get('name') else 'display_fallback', 'building_type': str(tags.get('building', 'yes')),
            'kind': kind, 'polygon': [_project(point, origin) for point in rings[0]],
            'holes': [[_project(point, origin) for point in ring] for ring in rings[1:]],
            'levels': levels if levels is not None else default_levels,
            'height_m': height if height is not None else round((levels or default_levels) * legacy.DEFAULT_STOREY_HEIGHT_M, 3),
            'levels_source': 'input' if levels is not None else 'default',
            'height_source': 'input' if height is not None else 'levels_estimate' if levels is not None else 'default',
            'tags': tags}


def _road(identifier, points, tags, node_ids, origin):
    return {'osm_id': identifier, 'segment': 0, 'name': str(tags.get('name', '')), 'highway': str(tags.get('highway', 'service')),
            'layer': str(tags.get('layer', '0')), 'tunnel': str(tags.get('tunnel', '')).lower() in ('yes', 'true', '1'),
            'points': [_project(point, origin) for point in points], 'node_ids': node_ids,
            'walkable': legacy.walking_allowed({**tags, 'highway': str(tags.get('highway', 'service'))}), 'tags': tags}


def _graph(roads):
    nodes, edges = {}, []
    for road in roads:
        if not road['walkable']: continue
        for i, (a, b) in enumerate(zip(road['points'], road['points'][1:])):
            source, target = road['node_ids'][i:i+2]
            length = math.dist(a, b)
            if source == target or length <= 0: continue
            for identifier, point in ((source, a), (target, b)):
                existing = nodes.get(identifier)
                if existing and [existing['x'], existing['y']] != point:
                    raise MapInputError('node_coordinate_conflict', f'{identifier} has inconsistent road coordinates')
                nodes[identifier] = {'id': identifier, 'x': point[0], 'y': point[1]}
            edges.append({'source': source, 'target': target, 'length_m': round(length, 6), 'osm_way_id': road['osm_id']})
    return {'directed': False, 'nodes': sorted(nodes.values(), key=lambda node: node['id']), 'edges': edges,
            'policy': 'Only consecutive explicitly shared input vertices; geometric crossings are not connected. OSM access/foot restrictions apply; missing tags do not certify real-world access.'}


def _make_campus(campus_id, title, bbox, source, buildings, roads, pois, landcovers):
    origin = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
    west, south, east, north = bbox
    boundary = [_project(point, origin) for point in [[west,south],[east,south],[east,north],[west,north],[west,south]]]
    graph = _graph(roads)
    bounds = _bounds(boundary)
    return {'schema_version': 'mecoffe.campus3d.v1', 'campus_id': campus_id, 'title': title,
            'source': source, 'projection': _projection(origin),
            'bounds_m': dict(zip(('min_x','min_y','max_x','max_y'), bounds)),
            'boundary': boundary, 'boundary_polygons': [{'outer': boundary, 'holes': []}],
            'boundary_note': 'Requested input extent, not a surveyed or administrative campus boundary.',
            'buildings': sorted(buildings, key=lambda feature: feature['osm_id']),
            'roads': sorted(roads, key=lambda feature: (feature['osm_id'],feature['segment'])), 'walk_graph': graph,
            'pois': sorted(pois, key=lambda feature: feature['osm_id']), 'landcovers': landcovers,
            'defaults': {'levels_by_kind': copy.deepcopy(legacy.DEFAULT_LEVELS), 'storey_height_m': legacy.DEFAULT_STOREY_HEIGHT_M,
                         'note': 'Missing values are display defaults, not measured or verified building dimensions.'},
            'stats': {'buildings': len(buildings), 'named_buildings': sum(feature['name_source'] != 'display_fallback' for feature in buildings),
                      'road_segments': len(roads), 'graph_nodes': len(graph['nodes']), 'graph_edges': len(graph['edges']),
                      'graph_components': len(legacy.graph_components(graph)), 'pois': len(pois), 'landcovers': len(landcovers),
                      'default_height_buildings': sum(feature['height_source'] == 'default' for feature in buildings)},
            'illustrative': True,
            'notice': 'Map geometry and asset assignments only; no OASIS people, purchases or simulation trajectory are attached.'}


def _location_mapping(features, rules):
    if rules is not None and (not isinstance(rules,list) or any(not isinstance(rule,dict) or not isinstance(rule.get('tags',{}),dict) for rule in rules)):
        raise MapInputError('invalid_location_rules','location rules must be a list of objects with optional tag objects')
    mappings, owners = {}, {}
    for feature in features:
        location_id = feature['tags'].get('location_id')
        if location_id is not None:
            if not isinstance(location_id, str) or not location_id.strip():
                raise MapInputError('invalid_location_id', 'location_id must be a non-empty string')
            if location_id in mappings and mappings[location_id]['input_feature_id'] != feature.get('input_feature_id', feature['osm_id']):
                raise MapInputError('duplicate_location_id', f'{location_id} occurs on different input features')
            entry = mappings.setdefault(location_id, {'feature_ids': [], 'input_feature_id': feature.get('input_feature_id',feature['osm_id']),
                                                      'method': 'caller_location_id', 'illustrative': False})
            entry['feature_ids'].append(feature['osm_id'])
            owners[feature['osm_id']] = location_id
    for rule in rules or []:
        location_id = rule.get('location_id')
        if not isinstance(location_id, str) or not location_id.strip() or location_id in mappings:
            raise MapInputError('duplicate_location_id', 'mapping rules need unique non-empty location_id values')
        tags = dict(rule.get('tags') or {})
        if rule.get('name') is not None: tags['name'] = rule['name']
        if not tags:
            raise MapInputError('empty_location_rule', 'location rule needs an exact name or tag condition')
        matches = [feature for feature in features if match_score(feature['tags'], tags) is not None]
        if len(matches) != 1:
            raise MapInputError('ambiguous_location_rule' if len(matches) > 1 else 'unresolved_location_rule', f'{location_id} matched {len(matches)} features; provide a direct location_id')
        feature = matches[0]
        if feature['osm_id'] in owners:
            raise MapInputError('location_conflict', f'{feature["osm_id"]} already belongs to another location_id')
        mappings[location_id] = {'feature_ids': [feature['osm_id']], 'method': 'explicit_exact_rule', 'rule': tags, 'illustrative': True}
        owners[feature['osm_id']] = location_id
    return {'schema_version': 'mecoffe.location-map.v1', 'status': 'draft', 'mappings': mappings,
            'note': 'Caller IDs are authoritative labels, not proof of an agent location. Rule matches require caller approval.'}


def _bundle(campus, catalog, seed, features, location_rules=None, style='procedural', preserve_scene=False):
    assignments = []
    for feature in sorted(features, key=lambda feature: feature['osm_id']):
        category = feature['category']
        if category == 'poi':
            assignments.append({'feature_id': feature['osm_id'], 'feature_type': 'poi', 'prototype_id': None,
                                'placement_only': True, 'reason': ['POI registers a location; no building footprint is invented']})
            continue
        chosen = select_prototype(feature['tags'], category, catalog, seed, feature['osm_id'], style if category=='building' else 'procedural')
        geometry = next((item for item in campus.get('buildings',[]) if item['osm_id']==feature['osm_id']),None) if category=='building' else None
        if geometry:
            if not preserve_scene:
                defaults=chosen['params']
                if geometry['levels_source']=='default' and isinstance(defaults.get('levels'),(int,float)) and defaults['levels']>0:
                    geometry['levels']=defaults['levels']
                if geometry['height_source'] in ('default','levels_estimate'):
                    storey=defaults.get('storey_height_m',legacy.DEFAULT_STOREY_HEIGHT_M)
                    if isinstance(storey,(int,float)) and storey>0:
                        geometry['height_m']=round(geometry['levels']*storey,3)
            chosen['params'].update({'levels':geometry['levels'],'height_m':geometry['height_m']})
            chosen['reason'].append('scene/input dimensions take precedence over prototype display defaults')
        assignments.append({'feature_id': feature['osm_id'], 'feature_type': category, **chosen})
    return {'campus': campus,
            'assignments': {'schema_version': 'mecoffe.asset-assignments.v1', 'catalog_schema': catalog['schema_version'],
                            'seed': seed, 'campus_id': campus['campus_id'], 'assignments': assignments,
                            'geometry_source': copy.deepcopy(campus['source']), 'simulation_data': False},
            'locations': _location_mapping(features, location_rules),
            'landcover': {'schema_version': 'mecoffe.landcover.v1', 'source': campus['source'],
                          'projection': campus['projection'], 'features': campus.get('landcovers', [])}}


def build_from_geojson(document, *, catalog=None, catalog_path=CATALOG_PATH, campus_id='geojson_map', title='Caller map preview', seed=0, location_rules=None, style='procedural'):
    if not isinstance(document, dict) or document.get('type') != 'FeatureCollection' or not isinstance(document.get('features'), list):
        raise MapInputError('invalid_geojson', 'input must be a GeoJSON FeatureCollection')
    if document.get('crs') is not None:
        raise MapInputError('unsupported_crs', 'RFC 7946 WGS84 only; omit the legacy crs property')
    records, coordinates, identifiers = [], [], set()
    for index, feature in enumerate(document['features']):
        if not isinstance(feature, dict) or feature.get('type') != 'Feature' or not isinstance(feature.get('geometry'), dict):
            raise MapInputError('invalid_feature', f'feature {index} needs a geometry object')
        properties = feature.get('properties')
        if properties is None: properties={}
        if not isinstance(properties, dict): raise MapInputError('invalid_properties', 'feature properties must be an object')
        if not isinstance(properties.get('tags', {}), dict): raise MapInputError('invalid_properties', 'properties.tags must be an object')
        tags = {**properties.get('tags', {}), **{key:value for key,value in properties.items() if key != 'tags'}}
        for key in ('levels','building:levels','height','height_m'):
            if key in tags and (isinstance(tags[key],bool) or legacy.positive_number(str(tags[key])) is None):
                raise MapInputError('invalid_height',f'{key} must be a positive number (height may include m)')
        identifier = str(feature.get('id', f'feature-{index}'))
        if feature.get('id') is not None and (isinstance(feature['id'],bool) or not isinstance(feature['id'],(str,int,float))):
            raise MapInputError('invalid_feature_id','Feature.id must be a string or number')
        if identifier in identifiers: raise MapInputError('duplicate_feature_id', identifier)
        identifiers.add(identifier)
        geometry = feature['geometry']; kind = geometry.get('type'); raw = geometry.get('coordinates')
        if kind in ('Polygon','MultiPolygon'):
            polygons = [raw] if kind == 'Polygon' else raw
            if not isinstance(polygons,list) or not polygons: raise MapInputError('invalid_polygon', 'polygon coordinates are empty')
            for part, polygon in enumerate(polygons):
                if not isinstance(polygon,list) or not polygon: raise MapInputError('invalid_polygon','polygon has no rings')
                rings = [_ring(ring) for ring in polygon]
                if any(not legacy.point_in_ring(hole[0],rings[0]) for hole in rings[1:]):
                    raise MapInputError('invalid_polygon','polygon hole starts outside its outer ring')
                category = tags.get('feature_type') or ('landcover' if (any(key in tags for key in ('natural','landuse','leisure')) or tags.get('amenity')=='parking') and not tags.get('building') else 'building')
                if category not in ('building','landcover'): raise MapInputError('invalid_feature_type','polygons must be buildings or landcover')
                if category == 'building' and not tags.get('building'): tags = {**tags,'building':'yes'}
                records.append({'osm_id': f'geojson/{identifier}' + (f'/part/{part}' if len(polygons)>1 else ''), 'input_feature_id':identifier,
                                'category':category, 'rings':rings, 'tags':tags})
                coordinates.extend(point for ring in rings for point in ring)
        elif kind in ('LineString','MultiLineString'):
            lines = [raw] if kind == 'LineString' else raw
            if not isinstance(lines,list) or not lines: raise MapInputError('invalid_line','road coordinates are empty')
            for part,line in enumerate(lines):
                if not isinstance(line,list) or len(line)<2: raise MapInputError('invalid_line','roads need at least two points')
                points = [_coordinate(point) for point in line]
                if len(set(map(tuple,points))) < 2: raise MapInputError('invalid_line','road has zero length')
                records.append({'osm_id':f'geojson/{identifier}' + (f'/part/{part}' if len(lines)>1 else ''), 'input_feature_id':identifier,
                                'category':'road','points':points,'tags':{**tags,'highway':tags.get('highway','service')}})
                coordinates.extend(points)
        elif kind == 'Point':
            point = _coordinate(raw)
            records.append({'osm_id':f'geojson/{identifier}','input_feature_id':identifier,'category':'poi','point':point,'tags':tags})
            coordinates.append(point)
        else:
            raise MapInputError('unsupported_geometry', f'{kind} is unsupported; use Polygon/MultiPolygon/LineString/MultiLineString/Point')
    if not coordinates: raise MapInputError('empty_map','input contains no map geometry')
    inferred = _bounds(coordinates)
    for low,high in ((0,2),(1,3)):
        if inferred[low]==inferred[high]: inferred[low]-=.0001;inferred[high]+=.0001
    bbox = validate_bbox(document.get('bbox') or inferred)
    if document.get('bbox') and any(not _inside(point,bbox) for point in coordinates):
        raise MapInputError('coordinate_outside_bbox','provided bbox must contain all GeoJSON coordinates')
    origin = ((bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2)
    buildings, roads, pois, landcovers = [], [], [], []
    for record in records:
        tags = record['tags']; identifier=record['osm_id']; category=record['category']
        if category == 'building': buildings.append(_building(identifier,record['rings'],tags,origin))
        elif category == 'road':
            points = record['points']; node_ids=tags.get('node_ids')
            if node_ids is not None and (not isinstance(node_ids,list) or len(node_ids)!=len(points) or any(not isinstance(value,str) or not value for value in node_ids)):
                raise MapInputError('invalid_node_ids','node_ids must be a non-empty string per road vertex')
            ids = [f'caller-node/{value}' for value in node_ids] if node_ids else [f'vertex/{point[0]:.10f}/{point[1]:.10f}/layer/{tags.get("layer",0)}' for point in points]
            roads.append(_road(identifier,points,tags,ids,origin))
        elif category == 'poi': pois.append({'osm_id':identifier,'name':str(tags.get('name','')),'point':_project(record['point'],origin),'tags':tags})
        else:
            kind='water' if tags.get('natural')=='water' or tags.get('water') else 'parking' if tags.get('amenity')=='parking' else 'pitch' if tags.get('leisure')=='pitch' else 'grass'
            landcovers.append({'osm_id':identifier,'kind':kind,'polygon':[_project(point,origin) for point in record['rings'][0]],'tags':tags,'source':'caller_geojson'})
    raw=json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
    if not isinstance(document.get('source',{}),dict): raise MapInputError('invalid_source','source must be an object')
    source={'source_type':'caller_geojson','sha256':hashlib.sha256(raw).hexdigest(), 'bbox':list(bbox),
            'license':(document.get('source') or {}).get('license','LicenseRef-Caller-Provided'),
            'attribution':(document.get('source') or {}).get('attribution','Caller-provided GeoJSON; source rights must be confirmed by the caller')}
    campus=_make_campus(campus_id,title,bbox,source,buildings,roads,pois,landcovers)
    return _bundle(campus,catalog or load_catalog(catalog_path),seed,records,location_rules,style)


def build_from_osm(osm_path, metadata_path, *, catalog=None, catalog_path=CATALOG_PATH, campus_id='osm_map', title='OSM map preview', seed=0, profile=None, location_rules=None, style='procedural'):
    root,metadata=read_osm(osm_path,metadata_path)
    catalog=catalog or load_catalog(catalog_path)
    raw_nodes={node.get('id'):_coordinate([float(node.get('lon')),float(node.get('lat'))]) for node in root.findall('node')}
    ways={way.get('id'):way for way in root.findall('way')}
    tags_by_id={f'way/{identifier}':legacy.tags_of(way) for identifier,way in ways.items()}
    if profile == 'ustc_legacy':
        if tuple(metadata['bbox']) != legacy.BBOX: raise MapInputError('legacy_profile_mismatch','ustc_legacy requires the accepted USTC bbox')
        campus=legacy.convert(osm_path,metadata_path)
        features=[{'osm_id':feature['osm_id'],'category':category,'tags':tags_by_id.get(feature['osm_id'],{})}
                  for category,key in [('building','buildings'),('road','roads')] for feature in campus[key]]
        return _bundle(campus,catalog,seed,features,location_rules,style,preserve_scene=True)
    if profile is not None: raise MapInputError('unknown_profile',str(profile))
    bbox=validate_bbox(metadata['bbox']); origin=((bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2)
    records,buildings,roads,pois,landcovers,warnings=[],[],[],[],[],[]
    relation_members=set()
    for relation in root.findall('relation'):
        tags=legacy.tags_of(relation)
        if tags.get('type')!='multipolygon' or tags.get('building') in (None,'no'): continue
        chains={'outer':[],'inner':[]}; refs=[]
        try:
            for member in relation.findall('member'):
                role=member.get('role') or 'outer'; ref=member.get('ref')
                if member.get('type')!='way' or role not in chains: continue
                way=ways[ref]; nodes=[node.get('ref') for node in way.findall('nd')]
                if any(node not in raw_nodes for node in nodes): raise KeyError(ref)
                chains[role].append(nodes); refs.append(ref)
            outers=legacy.join_rings(chains['outer']); inners=legacy.join_rings(chains['inner'])
            if not outers: raise ValueError('no outer')
            for part,outer in enumerate(outers):
                points=[raw_nodes[ref] for ref in outer]
                if not _intersects_bbox(points,bbox): continue
                holes=[[raw_nodes[ref] for ref in ring] for ring in inners if legacy.point_in_ring(raw_nodes[ring[0]],points)]
                identifier=f'relation/{relation.get("id")}' + (f'/part/{part}' if len(outers)>1 else '')
                buildings.append(_building(identifier,[points,*holes],tags,origin)); records.append({'osm_id':identifier,'category':'building','tags':tags})
            relation_members.update(refs)
        except (KeyError,ValueError):
            warnings.append(f'Incomplete building relation/{relation.get("id")} was skipped; no polygon was invented')
    for identifier,way in ways.items():
        tags=legacy.tags_of(way); refs=[node.get('ref') for node in way.findall('nd')]
        if len(refs)<2 or any(ref not in raw_nodes for ref in refs): continue
        points=[raw_nodes[ref] for ref in refs]; feature_id=f'way/{identifier}'
        if tags.get('building') not in (None,'no') and identifier not in relation_members:
            if refs[0]!=refs[-1] or len(set(refs))<3:
                warnings.append(f'Open building {feature_id} was skipped'); continue
            if _intersects_bbox(points,bbox):
                buildings.append(_building(feature_id,[points],tags,origin)); records.append({'osm_id':feature_id,'category':'building','tags':tags})
        if tags.get('highway'):
            for part,(segment,ids) in enumerate(_clip_osm_line(points,refs,bbox,identifier)):
                road=_road(feature_id,segment,tags,ids,origin); road['segment']=part
                road['feature_id']=feature_id + (f'/segment/{part}' if part else '')
                roads.append(road); records.append({'osm_id':feature_id + (f'/segment/{part}' if part else ''),'category':'road','tags':tags})
        if refs[0]==refs[-1] and len(set(refs))>=3 and _intersects_bbox(points,bbox):
            kind='pitch' if tags.get('leisure')=='pitch' else 'water' if tags.get('natural')=='water' else 'parking' if tags.get('amenity')=='parking' else 'grass' if tags.get('landuse') in ('grass','meadow') else None
            if kind:
                landcovers.append({'osm_id':feature_id,'kind':kind,'polygon':[_project(point,origin) for point in points], 'tags':tags,'source':'osm'})
                records.append({'osm_id':feature_id,'category':'landcover','tags':tags})
    for node in root.findall('node'):
        tags=legacy.tags_of(node); point=raw_nodes[node.get('id')]
        if any(key in tags for key in ('amenity','shop','location_id')) and _inside(point,bbox):
            identifier=f'node/{node.get("id")}'
            pois.append({'osm_id':identifier,'name':tags.get('name',''),'point':_project(point,origin),'tags':tags})
            records.append({'osm_id':identifier,'category':'poi','tags':tags})
    source={**metadata,'osm_generator':root.get('generator')}
    campus=_make_campus(campus_id,title,bbox,source,buildings,roads,pois,landcovers)
    campus['warnings']=warnings
    return _bundle(campus,catalog,seed,records,location_rules,style)


def _inside(point,bbox):
    return bbox[0]<=point[0]<=bbox[2] and bbox[1]<=point[1]<=bbox[3]


def _intersects_bbox(ring,bbox):
    bounds=_bounds(ring)
    return not(bounds[2]<bbox[0] or bounds[0]>bbox[2] or bounds[3]<bbox[1] or bounds[1]>bbox[3])


def _clip_osm_line(points,refs,bbox,way_id):
    pieces=[]; current_points=[]; current_ids=[]
    def flush():
        nonlocal current_points,current_ids
        if len(current_points)>=2: pieces.append((current_points,current_ids))
        current_points=[];current_ids=[]
    for index,(a,b) in enumerate(zip(points,points[1:])):
        lo,hi=0.,1.;dx=b[0]-a[0];dy=b[1]-a[1]
        for p,q in [(-dx,a[0]-bbox[0]),(dx,bbox[2]-a[0]),(-dy,a[1]-bbox[1]),(dy,bbox[3]-a[1])]:
            if abs(p)<1e-15:
                if q<0: lo,hi=1,0;break
            elif p<0: lo=max(lo,q/p)
            else: hi=min(hi,q/p)
        if hi-lo<=1e-12: flush();continue
        start=[a[0]+dx*lo,a[1]+dy*lo];end=[a[0]+dx*hi,a[1]+dy*hi]
        start_id=f'node/{refs[index]}' if lo<=1e-12 else f'clip/{way_id}/{index}/start'
        end_id=f'node/{refs[index+1]}' if hi>=1-1e-12 else f'clip/{way_id}/{index}/end'
        if current_ids and current_ids[-1]==start_id:
            current_points.append(end);current_ids.append(end_id)
        else:
            flush();current_points=[start,end];current_ids=[start_id,end_id]
        if hi<1-1e-12: flush()
    flush()
    return pieces


def write_bundle(bundle, output_dir):
    output=Path(output_dir)
    # All geometry validation and matching finish before any output is written.
    values={'campus3d.json':bundle['campus'],'asset_assignments.json':bundle['assignments'],
            'location_mapping.json':bundle['locations'],'landcover.json':bundle['landcover']}
    for name,value in values.items(): write_json(output/name,value)
    manifest={'schema_version':'mecoffe.scene-bundle.v1','campus_id':bundle['campus']['campus_id'],'simulation_data':False,
              'files':{name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in values}}
    write_json(output/'manifest.json',manifest)
    return manifest
