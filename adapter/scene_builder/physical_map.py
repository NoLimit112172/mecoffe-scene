"""Offline physical-map orchestration. No network, model, scenario or run input."""
from dataclasses import asdict, dataclass, fields
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET

from adapter.scene_service.auto_evidence import validate_rules
from adapter.scene_service.map_package import publish_map, json_bytes
from . import core
from .asset_library import published_asset_library
from .entrances import generate_entrances
from .gis import export_gis
from .io import MapInputError, read_osm, validate_bbox
from .physical_scope import clip_roads, fetch_window, net_area, project_scope

RECIPE_VERSION = 'physical-map.1'


@dataclass(frozen=True)
class PhysicalMapLimits:
    max_area_km2: float = 1.
    max_fetch_area_km2: float = 1.5
    max_nodes: int = 50_000
    max_ways: int = 10_000
    max_relations: int = 2_000
    max_buildings: int = 1_000
    max_road_segments: int = 10_000
    max_pois: int = 3_000
    max_xml_bytes: int = 25*1024*1024
    max_scope_vertices: int = 2_000


def _limits(value):
    if value is None:
        value = PhysicalMapLimits()
    if isinstance(value, dict):
        if set(value) - {f.name for f in fields(PhysicalMapLimits)}:
            raise MapInputError('INVALID_INPUT', '限额包含未知字段')
        value = PhysicalMapLimits(**value)
    if not isinstance(value, PhysicalMapLimits):
        raise MapInputError('INVALID_INPUT', '限额必须为 PhysicalMapLimits 或 JSON 对象')
    for key, number in asdict(value).items():
        valid = type(number) in (int, float) if key.endswith('km2') else type(number) is int
        if not valid or not math.isfinite(number) or number <= 0:
            raise MapInputError('INVALID_INPUT', f'限额 {key} 必须为有限正数；计数限额必须是整数')
    return value


def _limit(value, maximum, label, code='MAP_DATA_LIMIT'):
    if value > maximum:
        raise MapInputError(code, f'{label}为 {value:g}，超过上限 {maximum:g}；请确认较小区域或转离线处理')


def _empty(path):
    path = Path(path)
    if path.is_symlink() or (path.exists() and (not path.is_dir() or any(path.iterdir()))):
        raise MapInputError('MAP_OUTPUT_NOT_EMPTY', '输出目录必须不存在或为空，不能覆盖已有文件')
    return path


def _preflight(osm_path, limits):
    _limit(osm_path.stat().st_size, limits.max_xml_bytes, 'XML 字节数')
    counts = dict(nodes=0, ways=0, relations=0, buildings=0, road_segments=0, pois=0)
    # iterparse checks counts before the existing full-tree geometry builder.
    for event, element in ET.iterparse(osm_path, events=('start', 'end')):
        if event == 'start':
            if element.tag == 'osm':
                continue
            if element.tag in ('node', 'way', 'relation'):
                key = {'node': 'nodes', 'way': 'ways', 'relation': 'relations'}[element.tag]
                counts[key] += 1
                _limit(counts[key], getattr(limits, 'max_'+key), f'OSM {element.tag} 数量')
        elif element.tag in ('node', 'way', 'relation'):
            tags = {tag.get('k'): tag.get('v') for tag in element.findall('tag')}
            if element.tag in ('way', 'relation') and tags.get('building') not in (None, 'no'):
                counts['buildings'] += 1
                _limit(counts['buildings'], limits.max_buildings, '建筑候选数量（保守预检）')
            if element.tag == 'way' and tags.get('highway'):
                counts['road_segments'] += max(0, len(element.findall('nd'))-1)
                _limit(counts['road_segments'], limits.max_road_segments, '道路边段数量（预检）')
            if element.tag == 'node' and any(k in tags for k in ('amenity', 'shop', 'location_id')):
                counts['pois'] += 1
                _limit(counts['pois'], limits.max_pois, 'POI 数量（预检）')
            element.clear()
    return counts


def _builder_identity():
    # Stable across checkout line endings, without Git, timestamps or paths.
    root = Path(__file__).resolve().parents[2]
    paths = [p for folder in ('scene_builder', 'scene_service')
             for p in (root/'adapter'/folder).glob('*.py')]
    paths += [root/'adapter'/name for name in ('osm_to_campus3d.py', 'osm_landcover.py', 'osm_surroundings.py')]
    contents = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                for p in sorted(paths)}
    return {'name': 'mecoffe-physical-map-builder', 'version': RECIPE_VERSION,
            'implementation_sha256': hashlib.sha256(json_bytes(contents)).hexdigest()}


def _source(value):
    if not isinstance(value, dict) or value.get('type') not in ('osm', 'manual', 'manual_subset'):
        raise MapInputError('INVALID_SCOPE', '范围来源 type 必须是 osm、manual 或 manual_subset')
    if value['type'] == 'osm' and (value.get('osm_type') not in ('way', 'relation') or
                                  not str(value.get('osm_id', '')).isdigit()):
        raise MapInputError('INVALID_SCOPE', 'OSM 范围来源需要 way/relation 和数字 osm_id')
    try:
        json.dumps(value, allow_nan=False)
    except (ValueError, TypeError):
        raise MapInputError('INVALID_SCOPE', '范围来源必须是有限 JSON 数据') from None
    return copy.deepcopy(value)


def _write_draft(bundle, output):
    values = {'campus3d.json': bundle['campus'], 'asset_assignments.json': bundle['assignments'],
              'landcover.json': bundle['landcover']}
    values.update(export_gis(bundle['campus'], bundle['assignments'], bundle['landcover']))
    values['entrances.json'], values['gis/entrances.geojson'] = generate_entrances(bundle['campus'])
    raw = {name: json_bytes(value) for name, value in values.items()}
    manifest = {'schema_version': 'mecoffe.scene-bundle.v1', 'campus_id': bundle['campus']['campus_id'],
                'simulation_data': False, 'style': {'buildings': 'procedural', 'characters': 'campus'},
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in raw.items()}}
    raw['manifest.json'] = json_bytes(manifest)
    for name, data in raw.items():
        target = output/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def prepare_physical_map(osm_path, metadata_path, scope, *, scope_source, title, map_id,
                         rules_path, out, map_version='1', road_buffer_m=50., limits=None,
                         seed='0', draft_out=None, progress=None):
    """Prepare a full draft and publish a candidate, without loosening quality.

    Required rules must be auto-evidence.2. Inputs are local paths plus a caller
    confirmed GeoJSON geometry, never guessed coordinates. Callback receives a
    dict with an actual phase; it may raise to stop work. `out` is the final map
    directory; optional `draft_out` retains its complete pre-publication draft.
    A preview_only result is returned honestly, never relabelled as ready.
    """
    limits = _limits(limits)
    out = _empty(out)
    draft_out = _empty(draft_out) if draft_out is not None else None
    if draft_out is not None and (out.resolve().is_relative_to(draft_out.resolve()) or
                                  draft_out.resolve().is_relative_to(out.resolve())):
        raise MapInputError('INVALID_INPUT', '草稿与候选目录不能相同或相互包含')
    if (not isinstance(map_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', map_id) or
            not isinstance(map_version, str) or not re.fullmatch(r'[1-9][0-9]*', map_version) or
            not isinstance(title, str) or not title.strip() or
            type(seed) not in (str, int)):
        raise MapInputError('INVALID_INPUT', '地图 ID、数字版本、标题或建图种子无效')
    if type(road_buffer_m) not in (int, float) or not math.isfinite(road_buffer_m) or road_buffer_m < 0:
        raise MapInputError('INVALID_SCOPE', '道路缓冲必须为有限的非负米数')
    source = _source(scope_source)
    osm_path, metadata_path, rules_path = map(Path, (osm_path, metadata_path, rules_path))
    def report(phase):
        if progress is not None:
            progress({'phase': phase})
    report('reading')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if not isinstance(metadata, dict):
        raise MapInputError('INVALID_INPUT', '离线 metadata 必须为 JSON 对象')
    bbox = validate_bbox(metadata.get('bbox'))
    projection = core._projection(((bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2))
    parts = project_scope(scope, projection, limits.max_scope_vertices)
    area = net_area(parts)/1_000_000
    window, window_area = fetch_window(parts, projection, road_buffer_m)
    _limit(area, limits.max_area_km2, '范围净面积 km²', 'MAP_AREA_LIMIT')
    _limit(window_area/1_000_000, limits.max_fetch_area_km2, '取数框面积 km²', 'MAP_AREA_LIMIT')
    if any(window[i] < bbox[i]-1e-8 for i in (0, 1)) or any(window[i] > bbox[i]+1e-8 for i in (2, 3)):
        raise MapInputError('MAP_SOURCE_INCOMPLETE', '离线归档 bbox 未覆盖轮廓及道路缓冲，请准备完整数据；本命令不会联网补取')
    counts = _preflight(osm_path, limits)
    # Reuse archived hash/root verification before geometry or asset work.
    read_osm(osm_path, metadata_path)
    rules_raw = rules_path.read_bytes()
    rules = validate_rules(json.loads(rules_raw.decode('utf-8')))
    if rules['version'] != 'auto-evidence.2':
        raise MapInputError('INVALID_EVIDENCE_RULES', '本入口必须显式使用 auto-evidence.2 规则文件')
    descriptor, catalog = published_asset_library()
    geometry_sha = hashlib.sha256(json.dumps(scope, sort_keys=True, ensure_ascii=False,
                                            separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()
    recipe = {'schema_version': 'scene.physical-recipe.v1', 'builder': _builder_identity(),
              'scope_geometry': copy.deepcopy(scope), 'geometry_sha256': geometry_sha, 'scope_source': source,
              'road_buffer_m': road_buffer_m, 'fetch_bbox_wgs84': window, 'net_area_km2': area,
              'fetch_area_km2': window_area/1_000_000, 'limits': asdict(limits), 'build_seed': str(seed),
              'rules_version': rules['version'], 'rules_sha256': rules['sha256'],
              'rules_file_sha256': hashlib.sha256(rules_raw).hexdigest(),
              'asset_library_version': descriptor['version'], 'catalog_sha256': descriptor['catalog_sha256'],
              'source_sha256': metadata['sha256'], 'source_counts': counts, 'ai_used': False}
    report('geometry')
    bundle = core.build_from_osm(osm_path, metadata_path, campus_id=map_id, title=title,
                                 catalog=catalog, seed=str(seed))
    campus = bundle['campus']
    if any(campus['source'].get(key) != value for key, value in metadata.items()):
        raise MapInputError('MAP_SOURCE_INCOMPLETE', '建图期间输入归档发生变化，请冻结输入后重试')
    _limit(len(campus['buildings']), limits.max_buildings, '实际建筑数')
    _limit(sum(len(r['points'])-1 for r in campus['roads']), limits.max_road_segments, '实际道路边段数')
    _limit(len(campus['pois']), limits.max_pois, '实际 POI 数')
    campus['boundary_polygons'] = parts
    campus['boundary'] = copy.deepcopy(parts[0]['outer'])
    campus['boundary_note'] = 'Caller-confirmed polygon/holes; road buffer is context only, never an assignment scope.'
    campus['source']['physical_map'] = recipe
    campus['roads'] = clip_roads(campus['roads'], parts, road_buffer_m)
    campus['walk_graph'] = core._graph(campus['roads'])
    graph = campus['walk_graph']
    campus['stats'].update(road_segments=len(campus['roads']), graph_nodes=len(graph['nodes']),
                           graph_edges=len(graph['edges']), graph_components=len(core.legacy.graph_components(graph)))
    _limit(len(graph['edges']), limits.max_road_segments, '裁剪后的路网边数')
    features = [{'osm_id': b['osm_id'], 'category': 'building', 'tags': b['tags']} for b in campus['buildings']]
    features += [{'osm_id': r['feature_id'], 'category': 'road', 'tags': r['tags']} for r in campus['roads']]
    features += [{'osm_id': p['osm_id'], 'category': 'poi', 'tags': p['tags']} for p in campus['pois']]
    features += [{'osm_id': p['osm_id'], 'category': 'landcover', 'tags': p['tags']} for p in campus['landcovers']]
    bundle = core._bundle(campus, catalog, str(seed), features, preserve_scene=True)
    # POIs remain in campus/GIS. A placement-only point has no renderable model
    # and is omitted from the published model table, which requires catalog IDs.
    bundle['assignments']['assignments'] = [a for a in bundle['assignments']['assignments'] if not a.get('placement_only')]
    report('entrances_gis')
    with TemporaryDirectory(prefix='mecoffe-physical-') as temporary:
        work = Path(temporary)
        draft = draft_out if draft_out is not None else work/'draft'
        _empty(draft)
        _write_draft(bundle, draft)
        report('evidence_quality')
        frozen_rules = work/'rules.json'
        frozen_rules.write_bytes(rules_raw)
        result = publish_map(draft, work/'candidate', map_id, map_version, title,
                             evidence_mode='auto', rules_path=frozen_rules)
        report('publishing')
        _empty(out)
        shutil.copytree(work/'candidate', out, dirs_exist_ok=True)
    quality = result['quality']
    summary = {key: copy.deepcopy(quality[key]) for key in ('status', 'buildings', 'primary_function_counts',
               'buildings_with_services', 'unknown', 'eligible_buildings', 'main_component_ratio', 'warnings')}
    return {**result, 'summary': summary, 'recipe': recipe}
