"""Extract real OSM surface polygons for the visual overlay; no base data edits."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from osm_to_campus3d import project, tags_of, write_json

ROOT = Path(__file__).resolve().parent.parent


def clip_ring(points, bounds):
    """Sutherland-Hodgman clip to the original download rectangle."""
    points = points[:-1] if points and points[0] == points[-1] else points[:]
    for axis, limit, positive in [(0, bounds[0], True), (0, bounds[2], False),
                                  (1, bounds[1], True), (1, bounds[3], False)]:
        if not points:
            break
        output = []
        previous = points[-1]
        for point in points:
            inside = point[axis] >= limit if positive else point[axis] <= limit
            was_inside = previous[axis] >= limit if positive else previous[axis] <= limit
            if inside != was_inside:
                t = (limit - previous[axis]) / (point[axis] - previous[axis])
                output.append([previous[0] + t * (point[0] - previous[0]), previous[1] + t * (point[1] - previous[1])])
            if inside:
                output.append(point)
            previous = point
        points = output
    return points + [points[0]] if len(set(map(tuple, points))) >= 3 else []


def extract(osm_path=ROOT / 'data/osm/ustc_gaoxin.osm', campus_path=ROOT / 'scene/campus3d.json'):
    raw = Path(osm_path).read_bytes()
    campus = json.loads(Path(campus_path).read_text(encoding='utf-8'))
    if hashlib.sha256(raw).hexdigest() != campus['source']['sha256']:
        raise ValueError('OSM snapshot does not match the campus provenance')
    root = ET.fromstring(raw)
    nodes = {node.get('id'): [float(node.get('lon')), float(node.get('lat'))] for node in root.findall('node')}
    features = []
    origin = campus['projection']
    for way in root.findall('way'):
        tags = tags_of(way)
        if tags.get('building') not in (None, 'no'):
            continue
        kind = ('water' if tags.get('natural') == 'water' else 'pitch' if tags.get('leisure') == 'pitch'
                else 'parking' if tags.get('amenity') == 'parking' else None)
        refs = [nd.get('ref') for nd in way.findall('nd')]
        if not kind or len(refs) < 4 or refs[0] != refs[-1] or any(ref not in nodes for ref in refs):
            continue
        ring = clip_ring([nodes[ref] for ref in refs], campus['source']['bbox'])
        if not ring:
            continue
        polygon = [[round(value, 3) for value in project(lon, lat, origin['origin_lon'], origin['origin_lat'])] for lon, lat in ring]
        features.append({'osm_id': f"way/{way.get('id')}", 'kind': kind, 'name': tags.get('name', ''),
                         'sport': tags.get('sport', ''), 'polygon': polygon, 'source': 'osm'})
    return {'schema_version': 'mecoffe.landcover.v1', 'source': campus['source'], 'projection': origin,
            'note': 'Only existing closed OSM pitch/water/parking ways, clipped to the original bbox. Trees, lamps and benches are separate decorative geometry.',
            'features': features}


if __name__ == '__main__':
    data = extract()
    output = ROOT / 'frontend/public/mecoffe/campus3d_landcover.json'
    write_json(output, data)
    print(json.dumps({'output': str(output), 'features': len(data['features'])}, ensure_ascii=False))
