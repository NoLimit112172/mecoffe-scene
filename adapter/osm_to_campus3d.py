"""Build the phase-1 campus from a saved OpenStreetMap XML snapshot.

Only Python's standard library is used. Coordinates are metres, x east/y north.
The exported walking graph retains consecutive, shared OSM node IDs: geometric
crossings are never silently connected (some campus roads are grade separated).
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
OSM_PATH = ROOT / "data/osm/ustc_gaoxin.osm"
METADATA_PATH = ROOT / "data/osm/ustc_gaoxin.metadata.json"
OUTPUT_PATH = ROOT / "scene/campus3d.json"
MAPPING_PATH = ROOT / "scene/campus3d_mapping.json"
PUBLIC_DIR = ROOT / "frontend/public/mecoffe"
BBOX = (117.1194, 31.8180, 117.1283, 31.8270)
SOURCE_URL = "https://api.openstreetmap.org/api/0.6/map?bbox=117.1194,31.8180,117.1283,31.8270"
RELATION_ID = "14093671"
EARTH_RADIUS_M = 6371008.8
REQUIRED_MAPPING_KEYS = {
    "ug_dorm_west", "ug_dorm_east", "teaching_main", "grad_apartment",
    "library_main", "faculty_main", "shop_merchant_001", "shop_merchant_002",
}
WALKABLE_HIGHWAYS = {
    "footway", "path", "pedestrian", "steps", "living_street", "residential",
    "service", "track", "unclassified", "tertiary", "tertiary_link",
    "secondary", "secondary_link", "primary", "primary_link",
}
DEFAULT_LEVELS = {"dormitory": 6, "education": 5, "library": 5,
                  "office": 4, "dining": 3, "sports": 2, "other": 3}
DEFAULT_STOREY_HEIGHT_M = 3.2


def tags_of(element):
    return {tag.get("k"): tag.get("v") for tag in element.findall("tag")}


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def download(osm_path=OSM_PATH, metadata_path=METADATA_PATH):
    """Save the actual response, with provenance; leave old files on HTTP/XML errors."""
    request = urllib.request.Request(SOURCE_URL, headers={
        "User-Agent": "MeCoffe-Campus3D/1.0 (OpenStreetMap research demonstration)",
        "Accept": "application/xml",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    root = ET.fromstring(raw)
    if root.tag != "osm" or not root.findall("way"):
        raise ValueError("下载响应不是包含道路的 OSM XML")
    path = Path(osm_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(raw)
    temporary.replace(path)
    metadata = {
        "source_url": SOURCE_URL,
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bbox": list(BBOX),
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
    }
    write_json(metadata_path, metadata)
    return metadata


def project(lon, lat, origin_lon, origin_lat):
    """Local equirectangular projection, in metres (no GCJ-02 conversion)."""
    return [EARTH_RADIUS_M * math.cos(math.radians(origin_lat)) * math.radians(lon - origin_lon),
            EARTH_RADIUS_M * math.radians(lat - origin_lat)]


def ring_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def polygon_center(ring):
    area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
    if abs(area2) < 1e-12:
        points = ring[:-1] if ring[0] == ring[-1] else ring
        return [sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)]
    return [sum((a[0] + b[0]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:])) / (3 * area2),
            sum((a[1] + b[1]) * (a[0] * b[1] - b[0] * a[1]) for a, b in zip(ring, ring[1:])) / (3 * area2)]


def point_in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y):
            crossing = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < crossing:
                inside = not inside
    return inside


def join_rings(chains):
    """Assemble relation members by shared endpoints, preserving disjoint outers."""
    remaining = [list(chain) for chain in chains]
    rings = []
    while remaining:
        chain = remaining.pop(0)
        while chain[0] != chain[-1]:
            for i, other in enumerate(remaining):
                if chain[-1] == other[0]:
                    chain.extend(other[1:])
                elif chain[-1] == other[-1]:
                    chain.extend(list(reversed(other))[1:])
                elif chain[0] == other[-1]:
                    chain = other[:-1] + chain
                elif chain[0] == other[0]:
                    chain = list(reversed(other))[:-1] + chain
                else:
                    continue
                remaining.pop(i)
                break
            else:
                raise ValueError("校园 relation 的边界成员不完整，不能伪造闭合边界")
        if len(set(chain)) < 3:
            raise ValueError("校园边界不足三个独立节点")
        rings.append(chain)
    return rings


def building_kind(tags):
    name = tags.get("name", "")
    if tags.get("building") == "dormitory" or "公寓" in name:
        return "dormitory"
    if "图书" in name:
        return "library"
    if "食堂" in name:
        return "dining"
    if "体育" in name or tags.get("building") == "grandstand":
        return "sports"
    if "行政" in name:
        return "office"
    if tags.get("building") in {"school", "university"}:
        return "education"
    return "other"


def positive_number(value):
    if value is None:
        return None
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*", value)
    if not match:
        return None
    number = float(match.group(1))
    return number if number > 0 else None


def walking_allowed(tags):
    if tags.get("highway") not in WALKABLE_HIGHWAYS or tags.get("area") == "yes":
        return False
    foot = tags.get("foot")
    if foot in {"no", "private"}:
        return False
    return foot in {"yes", "designated", "permissive"} or tags.get("access") not in {"no", "private"}


def graph_components(graph):
    neighbors = defaultdict(set)
    for edge in graph["edges"]:
        neighbors[edge["source"]].add(edge["target"])
        neighbors[edge["target"]].add(edge["source"])
    components = []
    unseen = {node["id"] for node in graph["nodes"]}
    while unseen:
        start = min(unseen)
        component = {start}
        unseen.remove(start)
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for neighbor in neighbors[current] & unseen:
                unseen.remove(neighbor)
                component.add(neighbor)
                queue.append(neighbor)
        components.append(component)
    return sorted(components, key=lambda component: (-len(component), min(component)))


def convert(osm_path=OSM_PATH, metadata_path=METADATA_PATH):
    root = ET.parse(osm_path).getroot()
    raw_nodes = {node.get("id"): (float(node.get("lon")), float(node.get("lat")))
                 for node in root.findall("node")}
    ways = {way.get("id"): way for way in root.findall("way")}
    node_refs = {key: [node.get("ref") for node in way.findall("nd")] for key, way in ways.items()}
    relation = next((r for r in root.findall("relation") if r.get("id") == RELATION_ID), None)
    if relation is None:
        raise ValueError(f"OSM 缺少校园 relation {RELATION_ID}")
    rings_by_role = {}
    for role in ("outer", "inner"):
        chains = []
        for member in relation.findall("member"):
            if member.get("type") == "way" and member.get("role") == role:
                ref = member.get("ref")
                if ref not in node_refs:
                    raise ValueError(f"OSM 缺少边界 way/{ref}")
                chains.append(node_refs[ref])
        rings_by_role[role] = join_rings(chains)
    if not rings_by_role["outer"]:
        raise ValueError("校园没有 outer 边界")
    boundary_coords = [raw_nodes[ref] for ring in rings_by_role["outer"] for ref in ring]
    origin_lon = (min(p[0] for p in boundary_coords) + max(p[0] for p in boundary_coords)) / 2
    origin_lat = (min(p[1] for p in boundary_coords) + max(p[1] for p in boundary_coords)) / 2
    xy = {key: [round(v, 3) for v in project(lon, lat, origin_lon, origin_lat)]
          for key, (lon, lat) in raw_nodes.items()}
    outer_rings = [[xy[ref] for ref in ring] for ring in rings_by_role["outer"]]
    inner_rings = [[xy[ref] for ref in ring] for ring in rings_by_role["inner"]]
    polygons = [{"outer": outer, "holes": [hole for hole in inner_rings if point_in_ring(hole[0], outer)]}
                for outer in outer_rings]
    if sum(len(polygon["holes"]) for polygon in polygons) != len(inner_rings):
        raise ValueError("校园 inner 边界没有对应的 outer")
    polygons.sort(key=lambda polygon: -abs(ring_area(polygon["outer"])))

    buildings = []
    roads = []
    graph_nodes = {}
    graph_edges = []
    road_way_count = 0
    excluded_walk_ways = 0
    min_lon, min_lat, max_lon, max_lat = BBOX
    in_bbox = lambda ref: min_lon <= raw_nodes[ref][0] <= max_lon and min_lat <= raw_nodes[ref][1] <= max_lat
    for key, way in ways.items():
        tags = tags_of(way)
        refs = node_refs[key]
        if any(ref not in raw_nodes for ref in refs):
            raise ValueError(f"way/{key} 的节点不完整")
        if "building" in tags and tags["building"] != "no":
            if len(refs) < 4 or refs[0] != refs[-1]:
                raise ValueError(f"building way/{key} 不是闭合轮廓")
            kind = building_kind(tags)
            levels_osm = positive_number(tags.get("building:levels"))
            levels = levels_osm if levels_osm is not None else DEFAULT_LEVELS[kind]
            height_osm = positive_number(tags.get("height"))
            buildings.append({
                "osm_id": f"way/{key}", "name": tags.get("name", f"未命名建筑（way/{key}）"),
                "name_source": "osm" if tags.get("name") else "display_fallback",
                "building_type": tags["building"], "kind": kind,
                "polygon": [xy[ref] for ref in refs],
                "levels": int(levels) if float(levels).is_integer() else levels,
                "height_m": height_osm if height_osm is not None else round(levels * DEFAULT_STOREY_HEIGHT_M, 3),
                "levels_source": "osm" if levels_osm is not None else "default",
                "height_source": "osm" if height_osm is not None else "levels_estimate" if levels_osm is not None else "default",
            })
        if "highway" not in tags:
            continue
        road_way_count += 1
        walkable = walking_allowed(tags)
        if not walkable:
            excluded_walk_ways += 1
        # OSM's map endpoint includes complete ways extending beyond the bbox.
        # Split at outside nodes rather than joining nonconsecutive OSM nodes.
        segments = []
        segment = []
        for ref in refs:
            if in_bbox(ref):
                segment.append(ref)
            else:
                if len(segment) >= 2:
                    segments.append(segment)
                segment = []
        if len(segment) >= 2:
            segments.append(segment)
        for segment_index, segment in enumerate(segments):
            roads.append({
                "osm_id": f"way/{key}", "segment": segment_index,
                "name": tags.get("name", ""), "highway": tags["highway"],
                "layer": tags.get("layer", "0"), "tunnel": tags.get("tunnel") == "yes",
                "points": [xy[ref] for ref in segment], "walkable": walkable,
                "node_ids": [f"node/{ref}" for ref in segment],
            })
            if not walkable:
                continue
            for a_ref, b_ref in zip(segment, segment[1:]):
                if a_ref == b_ref:
                    continue
                length = math.dist(xy[a_ref], xy[b_ref])
                if length <= 0:
                    continue
                for ref in (a_ref, b_ref):
                    graph_nodes[ref] = {"id": f"node/{ref}", "x": xy[ref][0], "y": xy[ref][1]}
                graph_edges.append({"source": f"node/{a_ref}", "target": f"node/{b_ref}",
                                    "length_m": round(length, 6), "osm_way_id": f"way/{key}"})
    metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    if metadata.get("sha256") != sha256_of(osm_path):
        raise ValueError("OSM 原始文件与下载元数据的 SHA-256 不一致")
    all_boundary = [point for ring in outer_rings for point in ring]
    graph = {"directed": False, "nodes": sorted(graph_nodes.values(), key=lambda node: node["id"]),
             "edges": graph_edges,
             "policy": "Only consecutive shared OSM nodes within the download bbox; no geometric-intersection shortcuts. Vehicle oneway tags do not restrict walking. foot/access restrictions are respected where tagged; missing restrictions do not certify real-world access."}
    return {
        "schema_version": "mecoffe.campus3d.v1", "campus_id": "ustc_gaoxin_osm",
        "title": tags_of(relation).get("name", "中科大高新校区"),
        "source": {**metadata, "relation_id": RELATION_ID,
                   "osm_generator": root.get("generator"), "license_url": "https://www.openstreetmap.org/copyright"},
        "projection": {"method": "local_equirectangular", "units": "metres", "x": "east", "y": "north",
                       "origin_lon": origin_lon, "origin_lat": origin_lat, "earth_radius_m": EARTH_RADIUS_M,
                       "origin_method": "centre of the bounding box of all relation outer rings",
                       "formula": "x = R*cos(lat0)*radians(lon-lon0); y = R*radians(lat-lat0)"},
        "bounds_m": {"min_x": min(p[0] for p in all_boundary), "max_x": max(p[0] for p in all_boundary),
                     "min_y": min(p[1] for p in all_boundary), "max_y": max(p[1] for p in all_boundary)},
        "boundary": polygons[0]["outer"], "boundary_polygons": polygons,
        "boundary_note": "The campus relation has disjoint outer parcels and an inner exclusion. boundary is the largest outer for compatibility; boundary_polygons preserves every parcel and hole.",
        "buildings": sorted(buildings, key=lambda building: building["osm_id"]),
        "roads": roads, "walk_graph": graph,
        "defaults": {"levels_by_kind": DEFAULT_LEVELS, "storey_height_m": DEFAULT_STOREY_HEIGHT_M,
                     "note": "Missing heights/levels use presentation defaults, not measured or verified building heights."},
        "stats": {"buildings": len(buildings), "named_buildings": sum(b["name_source"] == "osm" for b in buildings),
                  "source_road_ways": road_way_count, "road_segments": len(roads),
                  "excluded_walking_ways": excluded_walk_ways,
                  "graph_nodes": len(graph["nodes"]), "graph_edges": len(graph_edges),
                  "graph_components": len(graph_components(graph)),
                  "default_height_buildings": sum(b["height_source"] == "default" for b in buildings)},
        "illustrative": True,
        "notice": "建筑与道路来自 OpenStreetMap；人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据",
    }


def validate_mapping(campus, mapping):
    mappings = mapping.get("mappings", {})
    if set(mappings) != REQUIRED_MAPPING_KEYS:
        raise ValueError("楼栋映射必须恰好包含现有八个地点")
    buildings = {building["osm_id"]: building for building in campus["buildings"]}
    nodes = campus["walk_graph"]["nodes"]
    component_of = {node_id: i for i, component in enumerate(graph_components(campus["walk_graph"])) for node_id in component}
    anchor_components = set()
    for key, entry in mappings.items():
        if entry.get("osm_id") not in buildings or entry.get("illustrative") is not True or not entry.get("note", "").strip():
            raise ValueError(f"地点 {key} 的 OSM 楼栋、示意标记或理由无效")
        center = polygon_center(buildings[entry["osm_id"]]["polygon"])
        if not nodes:
            raise ValueError("OSM 步行图为空")
        nearest = min(nodes, key=lambda node: (math.dist(center, [node["x"], node["y"]]), node["id"]))
        anchor_components.add(component_of[nearest["id"]])
    if len(anchor_components) != 1:
        raise ValueError("八个映射楼栋最近的道路节点不在同一连通分量；不能伪造接路")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="refresh the saved OSM snapshot and download metadata")
    parser.add_argument("--osm", type=Path, default=OSM_PATH)
    parser.add_argument("--metadata", type=Path, default=METADATA_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--mapping", type=Path, default=MAPPING_PATH)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DIR)
    args = parser.parse_args(argv)
    try:
        if args.download:
            download(args.osm, args.metadata)
        campus = convert(args.osm, args.metadata)
        mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
        validate_mapping(campus, mapping)
        write_json(args.output, campus)
        write_json(args.public_dir / "campus3d.json", campus)
        write_json(args.public_dir / "campus3d_mapping.json", mapping)
        print(json.dumps({"output": str(args.output), **campus["stats"]}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"campus3d: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
