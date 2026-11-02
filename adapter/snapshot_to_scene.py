"""将最新人口关系快照生成沙盘输入；不读取旧轨迹、不生成模拟行为。"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from oasis_to_scene import ROOT, SCHEMA, SceneError, build_people, load_json, sha256_of

DEFAULT_SNAPSHOT = ROOT / 'data/source/population_snapshot.latest.json'
DEFAULT_CAMPUS = ROOT / 'scene/campus.json'
DEFAULT_OUTPUT = ROOT / 'frontend/public/mecoffe/latest-network.json'
DEFAULT_SOURCE_URL = (
    'https://github.com/Alemax067/social-sim/blob/5c543f47c25e5f90d207465f256e197698f91566/'
    'backend/network_agent_velpro5/examples/mecoffe/population_snapshot.json'
)


def validate_snapshot(snapshot: dict) -> None:
    if not isinstance(snapshot, dict):
        raise SceneError('人口关系快照必须是 JSON 对象')
    if not isinstance(snapshot.get('snapshot_id'), str) or not snapshot['snapshot_id'].strip():
        raise SceneError('快照缺少有效的 snapshot_id')
    revision = snapshot.get('snapshot_revision')
    if type(revision) is not int or revision < 1:
        raise SceneError('snapshot_revision 必须是正整数')
    nodes = snapshot.get('nodes')
    edges = snapshot.get('edges')
    if not isinstance(nodes, list) or not nodes:
        raise SceneError('快照必须包含非空 nodes 数组')
    if not isinstance(edges, list):
        raise SceneError('快照必须包含 edges 数组')
    ids = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise SceneError('nodes 成员必须是对象')
        entity_id = node.get('entity_id')
        if not isinstance(entity_id, str) or not entity_id.strip():
            raise SceneError('人物缺少有效的 entity_id')
        if entity_id in ids:
            raise SceneError(f'人物编号重复：{entity_id}')
        if not isinstance(node.get('role'), str) or not node['role'].strip():
            raise SceneError(f'人物 {entity_id} 缺少角色')
        ids.add(entity_id)
    seen = set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise SceneError('edges 成员必须是对象')
        source, target = edge.get('source'), edge.get('target')
        if not isinstance(source, str) or not isinstance(target, str) or source not in ids or target not in ids:
            raise SceneError(f'关系端点不在人物名册中：{source} → {target}')
        if source == target:
            raise SceneError(f'不允许自关系：{source}')
        relation = edge.get('relation', 'follow')
        if not isinstance(relation, str) or not relation.strip():
            raise SceneError('关系类型必须是非空字符串')
        key = (source, target, relation)
        if key in seen:
            raise SceneError(f'关系重复：{source} → {target} ({relation})')
        seen.add(key)


def build_snapshot_brands(snapshot: dict, campus: dict) -> list[dict]:
    """门店名只作展示，不推导商品价格、订单或实际收入。"""
    shops = {}
    for location in campus['locations']:
        brand_id = location.get('brand_id')
        if brand_id:
            if brand_id in shops:
                raise SceneError(f'品牌门店配置重复：{brand_id}')
            shops[brand_id] = location
    brands = []
    for node in snapshot['nodes']:
        if node['role'] != 'merchant':
            continue
        brand_id = node['entity_id']
        if brand_id not in shops:
            raise SceneError(f'校园配置里没有品牌 {brand_id} 的门店地点')
        shop = shops[brand_id]
        brands.append({
            'brand_id': brand_id,
            'merchant_id': node['entity_id'],
            'product_name': node.get('name') or shop.get('name') or brand_id,
            'location_id': shop['location_id'],
        })
    return brands


def convert(snapshot_path: Path, campus_path: Path, source_url: str = DEFAULT_SOURCE_URL) -> dict:
    snapshot, campus = load_json(snapshot_path), load_json(campus_path)
    validate_snapshot(snapshot)
    # 空动作只用于兼容通用人物布局函数，不从历史运行中借用名字或行为。
    people = build_people(snapshot, {'actions': []}, campus)
    relationships = [dict(edge, relation=edge.get('relation', 'follow')) for edge in snapshot['edges']]
    snapshot_sha256 = sha256_of(snapshot_path)
    return {
        'schema': SCHEMA,
        'meta': {
            'mode': 'network_snapshot', 'status': 'not_run', 'partial': False, 'run_id': None,
            'snapshot_id': snapshot['snapshot_id'], 'snapshot_revision': snapshot['snapshot_revision'],
            'snapshot_sha256': snapshot_sha256, 'source_url': source_url,
            'completed_steps': 0, 'total_steps': 0,
            'limitations': ['这是人物关系输入快照，尚未运行，不含模拟行为与销量。',
                            '楼栋与位置是展示分配，不是智能体的实际行踪。'],
            'sources': {'snapshot_sha256': snapshot_sha256, 'campus_sha256': sha256_of(campus_path)},
        },
        'summary': {
            'people': len(people), 'relationships': len(relationships),
            'events': 0, 'by_type': {}, 'orders': 0, 'revenue_fen': 0, 'noop': 0,
        },
        'campus': campus, 'brands': build_snapshot_brands(snapshot, campus),
        'people': people, 'relationships': relationships,
        'posts': {}, 'events': [],
        'days': [{'step': 0, 'label': '新版网络', 'complete': True, 'noop': 0, 'counts': {}}],
    }


def write_atomic(output_path: Path, scene: dict) -> None:
    """完整转换后再原子替换，失败时保留已有输出。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output_path.parent,
                                         prefix=output_path.name + '.', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(scene, handle, ensure_ascii=False, separators=(',', ':'))
            handle.write('\n')
        os.replace(temporary, output_path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='人口关系快照 → 沙盘网络（不运行模拟）')
    parser.add_argument('--snapshot', type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument('--campus', type=Path, default=DEFAULT_CAMPUS)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--source-url', default=DEFAULT_SOURCE_URL)
    args = parser.parse_args(argv)
    try:
        scene = convert(args.snapshot, args.campus, args.source_url)
        write_atomic(args.output, scene)
    except (SceneError, OSError, json.JSONDecodeError) as error:
        print(f'新版网络转换失败：{error}；原有输出未被覆盖。', file=sys.stderr)
        return 1
    print(f"已生成 {args.output}：快照 r{scene['meta']['snapshot_revision']}，"
          f"人物 {scene['summary']['people']}，关系 {scene['summary']['relationships']}；未运行模拟。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
