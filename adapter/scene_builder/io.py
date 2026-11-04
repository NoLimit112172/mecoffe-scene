"""Validated local input and archived OpenStreetMap downloads; standard library only."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import time
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET


class MapInputError(ValueError):
    """An actionable validation error with a stable machine-readable code."""
    def __init__(self, code, message):
        self.code = code
        super().__init__(f"{code}: {message}")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    # Vite can briefly hold watched files open on Windows. Identical archived
    # inputs need no replacement (and keep their exact, already-hashed bytes).
    if path.exists() and path.read_text(encoding='utf-8') == serialized:
        return
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(serialized, encoding='utf-8')
    for attempt in range(8):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 7:
                # Some Windows readers allow writes but deny delete-sharing,
                # which prevents os.replace even after they finish reading.
                # Publish the same validated JSON in place; manifest hashes are
                # written last, so a concurrent reader never accepts mixed data.
                path.write_text(serialized, encoding='utf-8')
                temporary.unlink(missing_ok=True)
                return
            time.sleep(.05)


def validate_bbox(bbox):
    if not isinstance(bbox,(list,tuple)) or len(bbox) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in bbox):
        raise MapInputError('invalid_bbox', 'bbox must be four finite numbers [minLon,minLat,maxLon,maxLat]')
    west, south, east, north = bbox
    if not -180 <= west < east <= 180 or not -90 <= south < north <= 90:
        raise MapInputError('invalid_bbox', 'bbox must be ordered WGS84 longitude/latitude coordinates')
    return tuple(float(v) for v in bbox)


def download_osm(bbox, osm_path, metadata_path):
    bbox = validate_bbox(bbox)
    if (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > .25:
        raise MapInputError('download_area_too_large', 'OSM map API bbox exceeds 0.25 square degrees; split the request')
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join(format(v, '.10g') for v in bbox)
    request = urllib.request.Request(url, headers={'User-Agent': 'MeCoffe-SceneBuilder/1.0 (OpenStreetMap research preview)', 'Accept': 'application/xml'})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    root = ET.fromstring(raw)
    if root.tag != 'osm' or not root.findall('node') or not root.findall('way'):
        raise MapInputError('invalid_osm_response', 'download response is not an OSM map with nodes and ways')
    metadata = {'source_url': url, 'downloaded_at_utc': datetime.now(timezone.utc).isoformat(),
                'sha256': hashlib.sha256(raw).hexdigest(), 'bbox': list(bbox),
                'license': 'ODbL-1.0', 'license_url': 'https://www.openstreetmap.org/copyright',
                'attribution': '© OpenStreetMap contributors'}
    path = Path(osm_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(raw)
    temporary.replace(path)
    write_json(metadata_path, metadata)
    return metadata


def read_osm(osm_path, metadata_path):
    raw = Path(osm_path).read_bytes()
    metadata = json.loads(Path(metadata_path).read_text(encoding='utf-8'))
    if metadata.get('sha256') != hashlib.sha256(raw).hexdigest():
        raise MapInputError('source_hash_mismatch', 'OSM XML does not match its archived SHA-256 metadata')
    validate_bbox(metadata.get('bbox', []))
    root = ET.fromstring(raw)
    if root.tag != 'osm':
        raise MapInputError('invalid_osm', 'root element must be osm')
    return root, metadata
