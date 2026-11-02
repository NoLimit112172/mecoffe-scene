"""以新版关系网生成可复现的本地动画脚本，不调用模型或读取历史轨迹。"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import snapshot_to_scene
from oasis_to_scene import ROOT, SceneError, load_json, sha256_of

DEFAULT_CONFIG = ROOT / 'scene/demo.json'
DEFAULT_OUTPUT = ROOT / 'frontend/public/mecoffe/latest-demo.json'


def validate_config(config: dict, brand_ids: set[str]) -> None:
    if not isinstance(config, dict) or config.get('illustrative') is not True:
        raise SceneError('演示配置必须明确 illustrative=true')
    for name in ('seed', 'days', 'ad_interval_days', 'ad_recipients_per_brand',
                 'max_purchases_per_day', 'default_budget_fen'):
        if type(config.get(name)) is not int or config[name] < (0 if name == 'seed' else 1):
            raise SceneError(f'演示配置 {name} 必须为有效整数')
    probability = config.get('purchase_probability')
    if isinstance(probability, bool) or not isinstance(probability, (int, float)) or not 0 < probability <= 1:
        raise SceneError('purchase_probability 必须在 (0, 1] 内')
    prices = config.get('prices_fen')
    if not isinstance(prices, dict) or set(prices) != brand_ids:
        raise SceneError('演示价格必须与快照中的全部商家编号一一对应')
    if any(type(value) is not int or value <= 0 for value in prices.values()):
        raise SceneError('演示价格必须为正整数分')


def budget_fen(person: dict, default: int) -> int:
    value = person.get('profile', {}).get('coffee_budget_30d_cny')
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SceneError(f"人物 {person['id']} 的咖啡预算不是数值")
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            raise SceneError(f"人物 {person['id']} 的咖啡预算无效")
        return int((amount * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    except InvalidOperation as error:
        raise SceneError(f"人物 {person['id']} 的咖啡预算无效") from error


def build(snapshot_path: Path = snapshot_to_scene.DEFAULT_SNAPSHOT,
          campus_path: Path = snapshot_to_scene.DEFAULT_CAMPUS,
          config_path: Path = DEFAULT_CONFIG) -> dict:
    scene = snapshot_to_scene.convert(snapshot_path, campus_path)
    config = load_json(config_path)
    brand_map = {brand['brand_id']: brand for brand in scene['brands']}
    validate_config(config, set(brand_map))
    rng = random.Random(config['seed'])
    consumers = {person['id']: person for person in scene['people'] if person['role'] != 'merchant'}
    followers = defaultdict(list)
    for edge in scene['relationships']:
        if edge.get('relation') == 'follow' and edge['source'] in consumers:
            followers[edge['target']].append(edge['source'])
    for members in followers.values():
        members.sort()

    # 只在广告或确实存在的 follower→author 晒单评论处增加商品知识。
    known = {entity_id: set() for entity_id in consumers}
    wallets = {entity_id: budget_fen(person, config['default_budget_fen']) for entity_id, person in consumers.items()}
    initial_wallets = dict(wallets)
    events, posts, days = [], {}, []
    order_sequence = 0

    def emit(step: int, kind: str, actor: str, stage: str, **fields) -> dict:
        event = {
            'key': f'demo:{step}:{len(events) + 1}', 'step': step, 'type': kind,
            'actor': actor, 'stage': stage, 'origin': 'scripted_demo', 'illustrative': True,
            **fields,
        }
        events.append(event)
        return event

    for day in range(1, config['days'] + 1):
        first = len(events)
        if (day - 1) % config['ad_interval_days'] == 0:
            for brand_id, brand in sorted(brand_map.items()):
                candidates = list(followers[brand_id])
                rng.shuffle(candidates)
                recipients = candidates[:config['ad_recipients_per_brand']]
                ad = emit(day, 'ad', brand['merchant_id'], 'merchant_operations',
                          brand_id=brand_id, targeted=recipients,
                          text=f"[演示] {brand['product_name']}：本地动画脚本中的示例推广。")
                ad['post_id'] = f"demo:ad:{day}:{brand_id}"
                posts[ad['post_id']] = {'author': brand['merchant_id'], 'content': ad['text'], 'brand_id': brand_id}
                for recipient in recipients:
                    emit(day, 'exposure', recipient, 'feed', brand_ids=[brand_id],
                         target=brand['merchant_id'], post_ids=[ad['post_id']],
                         reason='scripted_ad_follow_edge')
                    known[recipient].add(brand_id)

        candidates = [entity_id for entity_id in sorted(consumers)
                      if any(wallets[entity_id] >= config['prices_fen'][brand] for brand in known[entity_id])]
        rng.shuffle(candidates)
        purchases_today = 0
        for entity_id in candidates:
            if purchases_today >= config['max_purchases_per_day']:
                break
            # 每个有知识且余额足够的人以相同示例概率参加，不推断画像中的消费概率。
            if rng.random() > config['purchase_probability']:
                continue
            choices = sorted(brand for brand in known[entity_id] if wallets[entity_id] >= config['prices_fen'][brand])
            brand_id = rng.choice(choices)
            brand = brand_map[brand_id]
            amount = config['prices_fen'][brand_id]
            wallets[entity_id] -= amount
            purchases_today += 1
            order_sequence += 1
            emit(day, 'purchase', entity_id, 'consumer_purchase', brand_id=brand_id,
                 order_id=f'demo:order:{order_sequence}', quantity=1, amount_fen=amount,
                 product_name=brand['product_name'], known_brand_before_purchase=True)
            post_id = f'demo:post:{day}:{order_sequence}'
            post = emit(day, 'post', entity_id, 'social_exchange', brand_id=brand_id, post_id=post_id,
                        text=f"[演示] 今天到 {brand['product_name']} 柜台买一杯咖啡，然后返回所在楼栋。")
            posts[post_id] = {'author': entity_id, 'content': post['text'], 'brand_id': brand_id}
            audience = followers[entity_id]
            if audience:
                commenter = rng.choice(audience)
                emit(day, 'comment', commenter, 'social_exchange', target=entity_id,
                     brand_id=brand_id, post_id=post_id,
                     text='[演示] 从关注对象的晒单中知道了这家店，之后可以考虑去看看。',
                     reason='scripted_peer_follow_edge')
                known[commenter].add(brand_id)

        if day == 1:
            # 首次演示尽早看到出门：首笔购买及其晒单/评论紧接该人获知品牌的曝光。
            # 只移动完整因果组，不将购买放在它所需的信息之前。
            purchase_index = next((i for i in range(first, len(events)) if events[i]['type'] == 'purchase'), None)
            if purchase_index is not None:
                purchase = events[purchase_index]
                knowledge_index = next((i for i in range(first, purchase_index)
                                        if events[i]['type'] == 'exposure'
                                        and events[i]['actor'] == purchase['actor']
                                        and purchase['brand_id'] in events[i]['brand_ids']), None)
                if knowledge_index is not None:
                    end = purchase_index + 2  # purchase + post
                    if end < len(events) and events[end]['type'] == 'comment':
                        end += 1
                    trip_group = events[purchase_index:end]
                    del events[purchase_index:end]
                    events[knowledge_index + 1:knowledge_index + 1] = trip_group

        counts = Counter(event['type'] for event in events[first:])
        days.append({'step': day, 'label': f'演示第 {day} 天', 'complete': True,
                     'noop': 0, 'counts': dict(sorted(counts.items()))})

    types = Counter(event['type'] for event in events)
    purchases = [event for event in events if event['type'] == 'purchase']
    scene['meta'].update({
        'mode': 'network_demo', 'status': 'demo', 'illustrative': True,
        'run_id': None, 'execution_status': 'not_run', 'partial': False,
        'completed_steps': config['days'], 'total_steps': config['days'],
        'step_unit': 'scripted_demo_day', 'demo_duration_days': config['days'],
        'demo_seed': config['seed'],
        'disclaimer': '这是新版关系网的本地规则脚本演示，购买、传播与对话均为示例，不是 OASIS 新模拟结果。',
        'assumptions': config.get('assumptions', []),
        'limitations': [
            'completed_steps/total_steps 仅表示可播放的演示脚本长度，不是 OASIS 已完成业务轮数。',
            '示例价格和行为参数来自 scene/demo.json；不会根据人物文字推断现实消费概率。',
            '地图位置和移动路径由展示层安排，不是运行记录中的实际行踪。',
        ],
        'demo_config': config,
        'demo_budget_fen': initial_wallets,
        'demo_remaining_budget_fen': wallets,
    })
    scene['meta']['sources']['demo_config_sha256'] = sha256_of(config_path)
    scene.update({
        'events': events, 'posts': posts, 'days': days,
        'summary': {
            'people': len(scene['people']), 'relationships': len(scene['relationships']),
            'events': len(events), 'by_type': dict(sorted(types.items())), 'orders': len(purchases),
            'revenue_fen': sum(event['amount_fen'] for event in purchases), 'noop': 0,
            'illustrative': True,
        },
    })
    return scene


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='新版网络 → 可播放的演示脚本（不运行模型）')
    parser.add_argument('--snapshot', type=Path, default=snapshot_to_scene.DEFAULT_SNAPSHOT)
    parser.add_argument('--campus', type=Path, default=snapshot_to_scene.DEFAULT_CAMPUS)
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        scene = build(args.snapshot, args.campus, args.config)
        snapshot_to_scene.write_atomic(args.output, scene)
    except (SceneError, OSError, json.JSONDecodeError) as error:
        print(f'演示脚本生成失败：{error}；原输出未被覆盖。', file=sys.stderr)
        return 1
    print(f"已生成 {args.output}：r{scene['meta']['snapshot_revision']}，{len(scene['days'])} 个演示日，"
          f"{len(scene['events'])} 条脚本事件；未运行 OASIS 或模型。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
