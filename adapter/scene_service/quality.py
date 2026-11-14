"""Versioned quality population; publication records, runtime executes known rules."""
import copy
import hashlib
from pathlib import Path
import re

from .common import digest, require

VERSION = 'scope-quality.1'
RULES = {
    'version': VERSION,
    'connectivity_population': 'entrances_of_valid_buildings_fully_within_confirmed_scope',
    'connectivity_numerator': 'connected_flag_and_road_node_in_main_component',
    'empty_connectivity_population_ready': False,
    'background_entrances': 'reference_only',
    'known_function_population': 'all_display_buildings',
    'thresholds': 'unchanged_and_frozen_in_quality',
    'remaining_ready_conditions': 'unchanged',
}
IMPLEMENTATION_FILES = ('quality.py', 'evidence.py', 'geometry.py', 'spatial_index.py')


def current_policy():
    """Freeze normalized source bytes; no timestamps, machine paths or secrets."""
    files = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
             for name in IMPLEMENTATION_FILES}
    value = {'schema_version': 'scene.quality-policy.v1', 'version': VERSION,
             'rules': copy.deepcopy(RULES), 'rules_sha256': digest(RULES),
             'implementation_files': files, 'implementation_sha256': digest(files)}
    value['sha256'] = digest(value)
    return value


def validate_policy(value):
    fields = {'schema_version', 'version', 'rules', 'rules_sha256',
              'implementation_files', 'implementation_sha256', 'sha256'}
    require(isinstance(value, dict) and set(value) == fields and
            value.get('schema_version') == 'scene.quality-policy.v1' and value.get('version') == VERSION,
            'INVALID_QUALITY_POLICY', '未知或不完整的地图质量规则；不能按旧口径静默解释')
    require(value['rules'] == RULES and value['rules_sha256'] == digest(RULES) and
            value['rules_sha256'] == digest(value['rules']) and
            value['sha256'] == digest({key: item for key, item in value.items() if key != 'sha256'}),
            'INVALID_QUALITY_POLICY', '地图质量规则正文或摘要不一致')
    files = value['implementation_files']
    require(isinstance(files, dict) and set(files) == set(IMPLEMENTATION_FILES) and
            all(isinstance(item, str) and re.fullmatch('[0-9a-f]{64}', item) for item in files.values()) and
            value['implementation_sha256'] == digest(files),
            'INVALID_QUALITY_POLICY', '地图质量实现的逐文件摘要清单不完整或不一致')
    # This records the original publisher implementation. A newer runtime may
    # implement the same version; it must not rewrite the frozen publisher hash.
    return value


def policy_for(package):
    quality = package.get('quality', {})
    has_explicit = 'quality_policy' in package
    has_frozen = isinstance(quality, dict) and 'quality_policy' in quality
    if not has_explicit and not has_frozen:
        return None
    explicit = package.get('quality_policy')
    frozen = quality.get('quality_policy') if has_frozen else None
    require(not (has_explicit and has_frozen) or explicit == frozen,
            'INVALID_QUALITY_POLICY', '地图质量规则引用不一致')
    return validate_policy(explicit if has_explicit else frozen)


def exclusion_warning(building, *, valid, in_scope, wet, associated, usable, layered, placeable, warn):
    """Separate normal background from genuinely unusable in-scope buildings."""
    refs = [building['osm_id']]
    if not valid:
        warn('BUILDING_INVALID_GEOMETRY', '楼栋几何无效，无法认证安全安置；请修图后发布新版本', refs)
    elif not in_scope:
        warn('BUILDING_OUT_OF_SCOPE', '确认范围外的背景楼，保留显示；不参加安置或范围内路网质量统计', refs)
    else:
        if wet:
            warn('BUILDING_WATER_CONFLICT', '范围内楼栋与水域冲突，不能参与安置', refs)
        if not usable:
            warn('BUILDING_NO_SAFE_ENTRANCE', '范围内楼栋没有安全且连上主路网的入口，不能参与安置', refs)
        if layered and not placeable(building):
            warn('BUILDING_NON_PLACEABLE', '交通、后勤设施或在建废弃楼只供显示，不参与安置', refs)
