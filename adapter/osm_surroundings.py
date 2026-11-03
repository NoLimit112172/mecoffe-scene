"""Download/extract a separate OSM road context; never change the walking graph."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

from osm_to_campus3d import EARTH_RADIUS_M, project, tags_of, write_json

ROOT = Path(__file__).resolve().parent.parent
OSM_PATH = ROOT / 'data/osm/ustc_gaoxin_surroundings.osm'
METADATA_PATH = ROOT / 'data/osm/ustc_gaoxin_surroundings.metadata.json'
OUTPUT_PATH = ROOT / 'frontend/public/mecoffe/campus3d_surroundings.json'
CAMPUS_PATH = ROOT / 'scene/campus3d.json'


def expanded_bbox(bbox, margin_m=300):
    """Expand the original WGS84 download rectangle by metres on every side."""
    if len(bbox) != 4 or not math.isfinite(margin_m) or margin_m < 0:
        raise ValueError('Invalid bbox or margin')
    west, south, east, north = bbox
    lat = (south + north) / 2
    dy = math.degrees(margin_m / EARTH_RADIUS_M)
    dx = math.degrees(margin_m / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
    return [west - dx, south - dy, east + dx, north + dy]


def download(osm_path=OSM_PATH, metadata_path=METADATA_PATH, campus_path=CAMPUS_PATH):
    campus = json.loads(Path(campus_path).read_text(encoding='utf-8'))
    bbox = expanded_bbox(campus['source']['bbox'])
    source_url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join(f'{value:.8f}' for value in bbox)
    request = urllib.request.Request(source_url, headers={
        'User-Agent': 'MeCoffe-Campus3D/1.0 (OpenStreetMap road-context demonstration)',
        'Accept': 'application/xml',
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    root = ET.fromstring(raw)
    if root.tag != 'osm' or not any(tags_of(way).get('highway') for way in root.findall('way')):
        raise ValueError('OSM response contains no highway ways')
    path = Path(osm_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(raw)
    temporary.replace(path)
    metadata = {
        'source_url': source_url,
        'downloaded_at_utc': datetime.now(timezone.utc).isoformat(),
        'sha256': hashlib.sha256(raw).hexdigest(),
        'bbox': [round(value, 8) for value in bbox],
        'original_campus_bbox': campus['source']['bbox'],
        'margin_m': 300,
        'license': 'ODbL-1.0',
        'attribution': '© OpenStreetMap contributors',
        'license_url': 'https://www.openstreetmap.org/copyright',
        'purpose': 'Display-only road context. Not part of the OASIS or campus walking graph.',
    }
    write_json(metadata_path, metadata)
    return metadata


def clip_polyline(points, bbox):
    """Liang-Barsky segment clipping; disjoint visible parts remain separate."""
    parts = []
    current = []
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        lo, hi = 0., 1.
        for p, q in [(-dx, a[0] - bbox[0]), (dx, bbox[2] - a[0]),
                     (-dy, a[1] - bbox[1]), (dy, bbox[3] - a[1])]:
            if abs(p) < 1e-15:
                if q < 0:
                    lo, hi = 1., 0.
                    break
            elif p < 0:
                lo = max(lo, q / p)
            else:
                hi = min(hi, q / p)
        if lo > hi:
            if len(current) >= 2:
                parts.append(current)
            current = []
            continue
        start = [a[0] + lo * dx, a[1] + lo * dy]
        end = [a[0] + hi * dx, a[1] + hi * dy]
        if start == end:
            continue
        if current and math.dist(current[-1], start) < 1e-10:
            current.append(end)
        else:
            if len(current) >= 2:
                parts.append(current)
            current = [start, end]
    if len(current) >= 2:
        parts.append(current)
    return parts


def extract(osm_path=OSM_PATH, metadata_path=METADATA_PATH, campus_path=CAMPUS_PATH):
    raw = Path(osm_path).read_bytes()
    metadata = json.loads(Path(metadata_path).read_text(encoding='utf-8'))
    if hashlib.sha256(raw).hexdigest() != metadata['sha256']:
        raise ValueError('Surrounding OSM snapshot does not match its SHA-256')
    campus = json.loads(Path(campus_path).read_text(encoding='utf-8'))
    projection = campus['projection']
    root = ET.fromstring(raw)
    nodes = {node.get('id'): [float(node.get('lon')), float(node.get('lat'))] for node in root.findall('node')}
    roads = []
    for way in root.findall('way'):
        tags = tags_of(way)
        if not tags.get('highway'):
            continue
        refs = [node.get('ref') for node in way.findall('nd')]
        if len(refs) < 2 or any(ref not in nodes for ref in refs):
            continue
        for segment, points in enumerate(clip_polyline([nodes[ref] for ref in refs], metadata['bbox'])):
            projected = [[round(value, 3) for value in project(lon, lat, projection['origin_lon'], projection['origin_lat'])] for lon, lat in points]
            roads.append({'osm_id': f"way/{way.get('id')}", 'segment': segment,
                          'name': tags.get('name', ''), 'highway': tags['highway'],
                          'lanes': tags.get('lanes', ''), 'oneway': tags.get('oneway', ''),
                          'tunnel': tags.get('tunnel', ''), 'layer': tags.get('layer', ''),
                          'bridge': tags.get('bridge', ''), 'points': projected})
    return {'schema_version': 'mecoffe.surrounding-roads.v1', 'source': metadata, 'projection': projection,
            'note': 'Only OSM highway ways and name/highway/lanes/oneway/tunnel/layer/bridge tags. Display only: no graph nodes or edges are added.',
            'roads': roads}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Fetch the separate official OSM map snapshot first')
    args = parser.parse_args()
    if args.download:
        download()
    data = extract()
    write_json(OUTPUT_PATH, data)
    print(json.dumps({'output': str(OUTPUT_PATH), 'roads': len(data['roads']),
                      'names': sorted({road['name'] for road in data['roads'] if road['name']})}, ensure_ascii=False))


if __name__ == '__main__':
    main()
