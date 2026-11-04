"""Draft scenario preparation contract. Never generates agent decisions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import copy
import hashlib
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .core import ROOT, build_from_geojson, build_from_osm
from .io import MapInputError, download_osm, write_json
from .gis import export_gis
from .entrances import generate_entrances

PUBLIC = ROOT / 'frontend/public/mecoffe'
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise MapInputError('invalid_id', 'id must contain 1-64 letters, digits, underscore or hyphen')
    return value


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_scenario_index(directory=None, default_id=None):
    """Discover prepared bundles, not a hard-coded list of campus IDs.

    Stable ordering prefers bundles with recorded simulation data, then IDs.
    The index is metadata only; existing bundle files are never rewritten.
    """
    directory = Path(directory or PUBLIC / 'scenarios')
    entries = []
    for path in sorted(directory.glob('*/scenario.json')):
        document = read_json(path)
        scenario_id = identifier(document.get('id'))
        if (scenario_id != path.parent.name or document.get('schema_version') != 'mecoffe.scenario.v1'
                or not isinstance(document.get('title'), str) or not document['title'].strip()
                or type(document.get('simulation_data')) is not bool):
            raise MapInputError('invalid_scenario_index_entry', 'prepared scenario metadata is invalid')
        entries.append({'id': scenario_id, 'title': document['title'], 'simulation_data': document['simulation_data'],
                        'manifest_sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    entries.sort(key=lambda entry: (not entry['simulation_data'], entry['id']))
    if not entries:
        raise MapInputError('empty_scenario_index', 'prepare at least one scenario before generating its directory')
    if default_id is not None and default_id not in {entry['id'] for entry in entries}:
        raise MapInputError('invalid_default_scenario', 'default scenario must exist in the directory')
    result = {'schema_version': 'mecoffe.scenario-index.v1', 'default_id': default_id or entries[0]['id'], 'scenarios': entries}
    write_json(directory / 'index.json', result)
    return result


def validate_time(value):
    if not isinstance(value, dict) or any(key not in value for key in ('start', 'timezone', 'step_unit', 'steps')):
        raise MapInputError('missing_simulation_time', 'simulation_time requires start, timezone, step_unit and steps')
    try:
        zone = ZoneInfo(value['timezone'])
    except (ZoneInfoNotFoundError, TypeError, ValueError):
        raise MapInputError('invalid_timezone', 'timezone must be a valid IANA timezone (install tzdata if unavailable)') from None
    if value['step_unit'] not in ('day', 'hour') or type(value['steps']) is not int or not 1 <= value['steps'] <= 10000:
        raise MapInputError('invalid_step', 'step_unit must be day/hour; steps must be an integer in [1,10000]')

    def parse(text):
        try:
            if not isinstance(text, str) or 'T' not in text:
                raise ValueError()
            parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=zone)
            # Aware input is an instant, including UTC Z; normalize it to the
            # display timezone. Naive input must be a real local wall clock.
            local = parsed.astimezone(zone)
            if local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None):
                raise ValueError()
            return local
        except (ValueError, TypeError, OverflowError):
            raise MapInputError('invalid_datetime', 'use ISO local date-time in the declared timezone') from None

    start = parse(value['start'])
    duration = timedelta(days=1) if value['step_unit'] == 'day' else timedelta(hours=1)
    intervals = value.get('intervals')
    if intervals is not None and (not isinstance(intervals, list) or len(intervals) != value['steps']):
        raise MapInputError('invalid_intervals', 'intervals must contain exactly steps entries')
    result = []
    previous = None
    for i in range(value['steps']):
        interval = intervals[i] if intervals is not None else {'start': (start + i * duration).isoformat(), 'end': (start + (i+1) * duration).isoformat()}
        if not isinstance(interval, dict) or 'start' not in interval or 'end' not in interval:
            raise MapInputError('invalid_intervals', 'each interval requires start and end')
        left, right = parse(interval['start']), parse(interval['end'])
        if right.timestamp() <= left.timestamp() or (previous is not None and left.timestamp() < previous):
            raise MapInputError('reversed_time', 'intervals must increase without overlaps')
        if i == 0 and left.timestamp() != start.timestamp():
            raise MapInputError('invalid_intervals', 'the first interval must start at simulation_time.start')
        previous = right.timestamp()
        result.append({'start': left.isoformat(), 'end': right.isoformat()})
    if 'end' in value and parse(value['end']).timestamp() != previous:
        raise MapInputError('reversed_time', 'end must equal the final interval end and follow start')
    return {**value, 'start': start.isoformat(), 'intervals': result}


def validate_manifest(document):
    if not isinstance(document, dict) or any(key not in document for key in ('id', 'title', 'map', 'simulation_time')):
        raise MapInputError('missing_manifest_fields', 'scenario requires id, title, map, simulation_time')
    identifier(document['id'])
    if not isinstance(document['title'], str) or not document['title'].strip():
        raise MapInputError('invalid_title', 'title is required')
    source = document['map']
    if not isinstance(source, dict) or source.get('type') not in ('bundle', 'osm', 'geojson'):
        raise MapInputError('invalid_map', 'map.type must be bundle, osm or geojson')
    if source['type'] == 'bundle': identifier(source.get('id'))
    if source['type'] == 'geojson' and not isinstance(source.get('path'), str):
        raise MapInputError('invalid_map', 'geojson requires path')
    if source['type'] == 'osm' and not (source.get('bbox') or (source.get('osm') and source.get('metadata'))):
        raise MapInputError('invalid_map', 'osm requires bbox or archived osm + metadata')
    if source['type'] == 'osm' and source.get('bbox') and (source.get('osm') or source.get('metadata')):
        raise MapInputError('conflicting_inputs', 'use either bbox download or archived osm + metadata')
    for key in ('trajectory','population_snapshot','location_rules'):
        if key in document and (not isinstance(document[key],str) or not document[key].strip()):
            raise MapInputError('invalid_path', f'{key} must be a non-empty file path')
    style = document.get('style', {})
    if not isinstance(style, dict) or style.get('buildings', 'procedural') not in ('procedural', 'yulan') or style.get('characters', 'campus') != 'campus':
        raise MapInputError('invalid_style', 'buildings: procedural/yulan; characters: campus')
    return {**copy.deepcopy(document), 'simulation_time': validate_time(document['simulation_time'])}


def prepare_scenario(manifest_path, output_root=None):
    path = Path(manifest_path).resolve()
    manifest = validate_manifest(read_json(path))
    resolve = lambda filename: (path.parent / filename).resolve()
    source = manifest['map']
    style = manifest.get('style', {}).get('buildings', 'procedural')
    rules = read_json(resolve(manifest['location_rules'])) if manifest.get('location_rules') else None
    options = {'campus_id': source.get('campus_id', manifest['id']), 'title': manifest['title'], 'seed': manifest.get('seed', 2026),
               'style': style, 'location_rules': rules if isinstance(rules, list) else None}
    if source['type'] == 'bundle':
        base = PUBLIC / 'campuses' / source['id']
        bundle_manifest = read_json(base / 'manifest.json')
        for filename, expected in bundle_manifest['files'].items():
            if Path(filename).name != filename or hashlib.sha256((base / filename).read_bytes()).hexdigest() != expected:
                raise MapInputError('bundle_hash_mismatch', 'existing scene bundle has changed; rebuild it first')
        bundle = {key: read_json(base / filename) for key, filename in {'campus':'campus3d.json', 'assignments':'asset_assignments.json',
                  'locations':'location_mapping.json', 'landcover':'landcover.json'}.items()}
    elif source['type'] == 'geojson':
        bundle = build_from_geojson(read_json(resolve(source['path'])), **options)
    else:
        if source.get('bbox'):
            archive = ROOT / 'data/osm/scenarios'
            osm, metadata = archive / f"{manifest['id']}.osm", archive / f"{manifest['id']}.metadata.json"
            download_osm(source['bbox'], osm, metadata)
        else:
            osm, metadata = resolve(source['osm']), resolve(source['metadata'])
        bundle = build_from_osm(osm, metadata, profile=source.get('profile'), **options)
    values = {'campus3d.json': bundle['campus'], 'asset_assignments.json': bundle['assignments'], 'landcover.json': bundle['landcover']}
    mappings = rules if isinstance(rules, dict) else bundle['locations']
    if mappings and mappings.get('schema_version')=='mecoffe.location-map.v1':
        mappings={**mappings,'campus_id':bundle['campus']['campus_id'],'mappings':{key:{**entry,'osm_id':entry.get('feature_ids',[None])[0]} for key,entry in mappings['mappings'].items()}}
    if mappings and 'mappings' in mappings:
        if not isinstance(mappings['mappings'], dict):
            raise MapInputError('invalid_mapping', 'mappings must be an object keyed by replay location id')
        ids = {b['osm_id'] for b in bundle['campus']['buildings']}
        if any(entry.get('osm_id') not in ids for entry in mappings['mappings'].values()):
            raise MapInputError('unknown_building', 'a location mapping points to a building outside this map')
        values['location_mapping.json'] = mappings
    trajectory = None
    if manifest.get('trajectory'):
        trajectory = read_json(resolve(manifest['trajectory']))
        if not isinstance(trajectory,dict):raise MapInputError('invalid_trajectory', 'trajectory must be an object')
        if trajectory.get('schema') != 'mecoffe.scene.v1':
            if not manifest.get('population_snapshot'):
                raise MapInputError('snapshot_required', 'raw OASIS trajectory requires population_snapshot')
            from adapter.oasis_to_scene import convert
            trajectory = convert(resolve(manifest['trajectory']), resolve(manifest['population_snapshot']), ROOT / 'scene/campus.json')
        if not trajectory.get('meta', {}).get('run_id') or trajectory.get('meta', {}).get('mode') in ('network_demo','network_snapshot'):
            raise MapInputError('invalid_trajectory', 'scenario trajectory must be an existing OASIS run, not a generated demonstration')
        if any(not isinstance(trajectory.get(key), list) for key in ('people', 'events', 'days', 'brands', 'relationships')):
            raise MapInputError('invalid_trajectory', 'normalized replay requires people, events, days, brands and relationships arrays')
        people = {p['id'] for p in trajectory['people']}
        if len(people) != len(trajectory['people']) or any(e.get('actor') not in people for e in trajectory['events']):
            raise MapInputError('invalid_actor', 'duplicate person or unknown event actor')
        if any(edge.get('source') not in people or edge.get('target') not in people for edge in trajectory['relationships']):
            raise MapInputError('invalid_relationship', 'relationship references an unknown person')
        if trajectory.get('meta', {}).get('step_unit') != manifest['simulation_time']['step_unit']:
            raise MapInputError('step_unit_mismatch', 'trajectory and manifest must use the same step unit')
        keys = mappings.get('mappings', {})
        for person in trajectory['people']:
            location = person.get('home_location_id') if person.get('role') == 'merchant' else person.get('building_id')
            if location not in keys:
                raise MapInputError('unmapped_person', f"person {person['id']} has no building mapping: {location}")
        if any(type(day.get('step')) is not int or not 0 <= day['step'] <= manifest['simulation_time']['steps'] for day in trajectory['days']):
            raise MapInputError('invalid_replay_time', 'replay steps exceed the declared simulation time')
        values['trajectory.json'] = trajectory
    if manifest.get('population_snapshot'):
        snapshot = read_json(resolve(manifest['population_snapshot']))
        if not isinstance(snapshot, dict): raise MapInputError('invalid_snapshot', 'population snapshot must be an object')
        if trajectory:
            meta=trajectory.get('meta', {})
            if (meta.get('snapshot_id'), meta.get('snapshot_revision')) != (snapshot.get('snapshot_id'), snapshot.get('snapshot_revision')):
                raise MapInputError('snapshot_mismatch', 'snapshot id/revision differs from the trajectory')
        values['population_snapshot.json'] = snapshot
    # Additional geometry context can be archived explicitly, never inferred from
    # another campus. Preserve the accepted USTC surroundings/water exactly.
    for role in ('landcover', 'surroundings'):
        if source.get(role): values[role + '.json'] = read_json(resolve(source[role]))
    values.update(export_gis(bundle['campus'], bundle['assignments'], values['landcover.json'],
                             values.get('location_mapping.json'), values.get('surroundings.json')))
    values['entrances.json'],values['gis/entrances.geojson']=generate_entrances(bundle['campus'])
    output = Path(output_root or PUBLIC / 'scenarios') / manifest['id']
    for filename, value in values.items(): write_json(output / filename, value)
    runtime = {**manifest, 'schema_version':'mecoffe.scenario.v1', 'simulation_data': trajectory is not None,
               'files':{name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in values},
               'replay_format':'mecoffe.scene.v1' if trajectory else None}
    # Runtime never contains caller absolute filesystem paths.
    for key in ('trajectory','population_snapshot','location_rules'): runtime.pop(key, None)
    runtime['map'] = {'type':'prepared', 'campus_id': bundle['campus']['campus_id'], 'source': bundle['campus']['source']}
    write_json(output / 'scenario.json', runtime)
    write_scenario_index(output.parent)
    return runtime, output
