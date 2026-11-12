"""Frozen auto-evidence.2 policy: primary building use and interior services.

No defaults, files, downloads or models are read here. Every mapping comes from
the exact rules embedded in the selected map version. Legacy maps bypass this.
"""
import copy
from decimal import Decimal, ROUND_HALF_UP
import re

from .common import require

VERSION = 'auto-evidence.2'
FUNCTION_LABELS = {
    'dormitory': '宿舍', 'residential': '住宅', 'hotel': '酒店住宿',
    'education': '教学', 'research': '科研', 'office': '办公', 'library': '图书馆',
    'industrial': '工业仓储', 'dining': '餐饮', 'retail': '零售',
    'life_service': '生活服务', 'medical': '医疗', 'government': '政务公共',
    'sports': '体育', 'culture': '文化娱乐', 'religious': '宗教',
    'transport': '交通', 'utility': '后勤设施', 'construction': '在建或废弃', 'unknown': '未知',
}
FUNCTIONS = tuple(FUNCTION_LABELS)
NON_PLACEABLE = frozenset(('transport', 'utility', 'construction'))
FROZEN_FIELDS = ('services', 'service_evidence', 'primary_from_services')


def is_layered(rules):
    return isinstance(rules, dict) and rules.get('version') == VERSION


def validate_taxonomy(rules):
    definitions = rules.get('taxonomy')
    require(isinstance(definitions, dict) and set(definitions) == set(FUNCTIONS),
            'INVALID_EVIDENCE_RULES', 'The layered taxonomy must define all 20 functions')
    for key, entry in definitions.items():
        require(isinstance(entry, dict) and set(entry) == {'label', 'definition', 'examples', 'counterexamples', 'placeable'} and
                all(isinstance(entry.get(k), str) and entry[k].strip() for k in ('label', 'definition')) and
                all(isinstance(entry.get(k), list) and entry[k] and all(isinstance(s, str) and s for s in entry[k])
                    for k in ('examples', 'counterexamples')) and entry.get('placeable') is (key not in NON_PLACEABLE),
                'INVALID_EVIDENCE_RULES', 'Incomplete function definition or changed placement restriction')
    mappings = rules.get('tag_functions')
    require(isinstance(mappings, dict) and mappings and
            all(isinstance(key, str) and isinstance(table, dict) and table and
                all(isinstance(value, str) and value and function in FUNCTIONS for value, function in table.items())
                for key, table in mappings.items()), 'INVALID_EVIDENCE_RULES', 'Invalid explicit tag mappings')
    require(not any(value in mappings.get('building', {}) for value in ('yes', 'commercial')),
            'INVALID_EVIDENCE_RULES', 'Ambiguous building tags must not imply a function')
    venues = rules.get('venue_poi_functions')
    require(isinstance(venues, dict) and venues and
            all(isinstance(key, str) and key in ('amenity', 'healthcare', 'tourism') and
                isinstance(table, dict) and table and
                all(isinstance(value, str) and value and function in FUNCTIONS and function != 'unknown'
                    for value, function in table.items()) for key, table in venues.items()),
            'INVALID_EVIDENCE_RULES', 'Invalid frozen venue-level POI mappings')
    require(all(value not in mappings.get(key, {}) or mappings[key][value] == function
                for key, table in venues.items() for value, function in table.items()),
            'INVALID_EVIDENCE_RULES', 'Venue POI function contradicts its ordinary tag mapping')
    require(rules.get('non_placeable') == sorted(NON_PLACEABLE),
            'INVALID_EVIDENCE_RULES', 'Layered rules cannot relax the non-placeable classes')


def tag_evidence(tags, source, ref, rules):
    records = [{'function': table[tags[key]], 'source': source, 'key': key, 'value': tags[key], 'ref': ref}
               for key, table in rules['tag_functions'].items()
               if isinstance(tags.get(key), str) and tags[key] in table]
    # Venue-only values (notably amenity=university) are point evidence only:
    # never reinterpret a campus-wide polygon tag as every building's use.
    if source == 'poi':
        for key, table in rules['venue_poi_functions'].items():
            if isinstance(tags.get(key), str) and tags[key] in table:
                record = {'function': table[tags[key]], 'source': source, 'key': key, 'value': tags[key], 'ref': ref}
                if record not in records:
                    records.append(record)
    return records


def is_venue_poi(evidence, rules):
    return (evidence['source'] == 'poi' and
            rules['venue_poi_functions'].get(evidence['key'], {}).get(evidence['value']) == evidence['function'])


def functions(records):
    return {e['function'] for e in records} - {'unknown'}


def apply_layered_evidence(package, rules, ai_file, warn):
    # Called after generic input/rules/AI validation in auto_evidence.
    from .auto_evidence import generic_education
    threshold = Decimal(rules['ai_min_confidence_pct']) / 100
    for building in package['campus']['buildings']:
        identifier = building['osm_id']
        base = building['function_evidence']
        weak = [e for e in base if e['source'] == 'name_keyword']
        services = [dict(e, layer='service') for e in base if e['source'] == 'poi']
        annotations = [e for e in base if e['source'] == 'annotation']
        tags = [e for e in base if e['source'] == 'building_tag' and not generic_education(e)]
        generic = [e for e in base if generic_education(e)]
        name = building.get('name', '')
        excluded = any(re.search(pattern, name) for pattern in rules['exclusion_patterns'])
        matches = [] if excluded else [(rule, re.search(rule['pattern'], name)) for rule in rules['name_rules']]
        matches = [(rule, match) for rule, match in matches if match]
        name_conflict = len({rule['function'] for rule, _ in matches}) > 1
        if excluded or name_conflict:
            warn('NAME_RULE_EXCLUDED' if excluded else 'NAME_RULE_CONFLICT',
                 'Name rules were excluded or conflicted; weak keywords remain weak', [identifier])
        names = [] if name_conflict else [
            {'function': rule['function'], 'source': 'name_rule', 'key': rule['id'],
             'value': match.group(0), 'ref': identifier} for rule, match in matches]
        prediction = ai_file['buildings'].get(identifier) if ai_file else None
        inferred = []; low = []
        if prediction:
            percent = int((Decimal(str(prediction['confidence'])) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
            records = [{'function': f, 'source': 'ai_inferred', 'key': 'ai_evidence',
                        'value': prediction['rationale'], 'ref': identifier, 'confidence_pct': percent}
                       for f in sorted(prediction['functions']) if f != 'unknown']
            if Decimal(str(prediction['confidence'])) >= threshold:
                inferred = records
            else:
                low = records
                warn('AI_LOW_CONFIDENCE', 'AI prediction retained but below the frozen map policy threshold', [identifier])
        # add keeps the old meaning: preserve concrete tag uses alongside annotation.
        # replace has already removed old tag evidence in evidence.enrich_map.
        if annotations:
            selected = functions(annotations)
            if building['function_annotation'].get('mode', 'add') == 'add':
                selected |= functions(tags)
        elif tags:
            selected = functions(tags)
        elif names:
            selected = functions(names)
        elif inferred:
            selected = functions(inferred)
        else:
            selected = functions(generic)
        primary_from_services = not selected and bool(functions(services)) and not annotations
        candidates = [e for e in base if e['source'] != 'poi'] + names + inferred
        if primary_from_services:
            venues = [e for e in services if is_venue_poi(e, rules)]
            basis = venues or services
            selected = functions(basis)
            primary = [dict(e, layer='primary') for e in basis]
            # Only POI is the actual primary-use basis in this exceptional case.
            active = [dict(e, layer='primary') for e in weak] + primary
        else:
            active = [dict(e, layer='primary') for e in candidates
                      if e['source'] == 'name_keyword' or e['function'] in selected or
                      (e['function'] == 'unknown' and not selected)]
        inactive = [dict(e, layer='primary') for e in candidates
                    if e['source'] != 'name_keyword' and e['function'] not in selected] + [dict(e, layer='primary') for e in low]
        suppressed = [e for e in inactive if generic_education(e)]
        if suppressed:
            building.setdefault('superseded_function_evidence', []).extend(copy.deepcopy(suppressed))
            warn('GENERIC_USE_SUPERSEDED', 'Generic education tag retained as superseded evidence, not a teaching candidate', [identifier])
        # Interior services are expected to differ from the building use, not a conflict.
        conflict = bool(functions(tags) - selected or functions(names) - selected or functions(inferred) - selected or
                        functions(building.get('superseded_function_evidence', [])) - selected or len(functions(tags)) > 1)
        if conflict:
            warn('EVIDENCE_CONFLICT', 'Lower-priority or same-tier primary-use evidence conflicts; no automatic override', [identifier])
        building.update(function_evidence=active, inactive_function_evidence=inactive,
                        services=sorted(functions(services)), service_evidence=sorted(services, key=lambda e: (e['function'], e['ref'], e['key'], e['value'])),
                        primary_from_services=primary_from_services,
                        needs_ai_review=primary_from_services or not selected or bool(generic and not tags and not names and not inferred and not annotations) or conflict or name_conflict)


def placeable(building):
    return not NON_PLACEABLE.intersection(building.get('functions', []))
