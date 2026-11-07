"""把 OASIS 交互轨迹转换成 MeCoffe 校园场景前端使用的 scene.json。

输入：
  - data/source/trajectory.json          OASIS 导出的交互轨迹（kind = oasis.interaction_trajectory）
  - data/source/population_snapshot.json 同一次运行使用的人口快照
  - scene/campus.json                    校园地点配置（环境准备模块的产出）
输出：
  - frontend/public/mecoffe/scene.json

只做展示所需的字段选择与核对，不调用模型，不补造轨迹里没有的数据。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TRAJECTORY = ROOT / "data" / "source" / "trajectory.json"
DEFAULT_SNAPSHOT = ROOT / "data" / "source" / "population_snapshot.json"
DEFAULT_CAMPUS = ROOT / "scene" / "campus.json"
DEFAULT_OUTPUT = ROOT / "frontend" / "public" / "mecoffe" / "scene.json"

SCHEMA = "mecoffe.scene.v1"

ROLE_LABELS = {
    "merchant": "咖啡商家",
    "undergraduate_consumer": "本科生",
    "graduate_consumer": "研究生",
    "teacher_consumer": "教师",
}

# 原始动作名 -> 场景事件类型；未列出的执行成功动作归为 other
ACTION_TYPES = {
    "create_post": "post",
    "create_comment": "comment",
    "purchase_product": "purchase",
    "publish_ad": "ad",
    "follow": "follow",
    "interview": "interview",
    "set_product_price": "price",
}

PROFILE_FIELDS = ("coffee_preferences", "coffee_budget_30d_cny", "personality", "purchase_strategy")


class SceneError(ValueError):
    """输入之间不一致时抛出，避免把不同实验版本混在一起展示。"""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def home_location_for(person: dict, campus: dict) -> str:
    keys = (f"{person['role']}:{person['id']}", person["role"])
    for key in keys:
        for location in campus["locations"]:
            if key in location.get("default_for_roles", []):
                return location["location_id"]
    raise SceneError(f"校园配置里没有角色 {person['role']}（{person['id']}）的默认地点")


def building_index(campus: dict) -> dict:
    index = {}
    for location in campus["locations"]:
        for building in location.get("buildings", []):
            if building["building_id"] in index:
                raise SceneError(f"楼栋编号重复：{building['building_id']}")
            index[building["building_id"]] = location["location_id"]
    return index


def split_by_share(count: int, shares: list[float]) -> list[int]:
    """最大余数法：按比例把 count 个人分成若干份，总和严格等于 count。"""
    total = sum(shares)
    if total <= 0:
        raise SceneError("occupancy 的 share 之和必须大于 0")
    raw = [count * share / total for share in shares]
    result = [int(value) for value in raw]
    order = sorted(range(len(raw)), key=lambda k: (raw[k] - result[k], -k), reverse=True)
    for k in order[: count - sum(result)]:
        result[k] += 1
    return result


def stable_key(entity_id: str) -> str:
    return hashlib.sha1(entity_id.encode("utf-8")).hexdigest()


def assign_buildings(people: list[dict], campus: dict) -> None:
    """按 campus.occupancy 把每个人放进一栋楼（示意分配，OASIS 本身没有位置）。"""
    buildings = building_index(campus)
    occupancy = campus.get("occupancy", {})
    by_role: dict[str, list[dict]] = {}
    for person in people:
        by_role.setdefault(person["role"], []).append(person)

    for role, members in by_role.items():
        if role == "merchant":
            for person in members:
                location = next(l for l in campus["locations"] if l["location_id"] == person["home_location_id"])
                if not location.get("buildings"):
                    raise SceneError(f"门店地点 {location['location_id']} 没有楼栋")
                person["building_id"] = location["buildings"][0]["building_id"]
                person["indoor"] = False   # 商家站在自家柜台外
            continue
        rules = occupancy.get(role)
        if not rules:
            raise SceneError(f"campus.occupancy 里没有角色 {role} 的楼栋分配")
        for rule in rules:
            if rule["building_id"] not in buildings:
                raise SceneError(f"occupancy 引用了不存在的楼栋 {rule['building_id']}")
        counts = split_by_share(len(members), [rule["share"] for rule in rules])
        ordered = sorted(members, key=lambda p: stable_key(p["id"]))
        start = 0
        for rule, count in zip(rules, counts):
            for person in ordered[start:start + count]:
                person["building_id"] = rule["building_id"]
                person["home_location_id"] = buildings[rule["building_id"]]
                person["indoor"] = True
            start += count


def build_people(snapshot: dict, trajectory: dict, campus: dict) -> list[dict]:
    names_from_run = {}
    for action in trajectory["actions"]:
        actor = action.get("actor") or {}
        if actor.get("name"):
            names_from_run.setdefault(actor["entity_id"], actor["name"])

    people = []
    for node in snapshot["nodes"]:
        static = node.get("static_attributes") or {}
        dynamic = node.get("dynamic_attributes") or {}
        person = {
            "id": node["entity_id"],
            "role": node["role"],
            "role_label": ROLE_LABELS.get(node["role"], node["role"]),
            "name": node.get("name") or names_from_run.get(node["entity_id"]) or node["entity_id"],
            "gender": {"male": "m", "female": "f"}.get(static.get("gender")),
            "age": static.get("age"),
            "bio": node.get("bio") or node.get("description") or "",
            "profile": {key: dynamic[key] for key in PROFILE_FIELDS if key in dynamic},
        }
        if node["role"] == "merchant":
            person["profile"]["promotion_goal"] = dynamic.get("promotion_goal", "")
        person["home_location_id"] = home_location_for(person, campus)
        people.append(person)
    assign_buildings(people, campus)
    return people


def stage_of(action: dict) -> str:
    if action.get("origin") == "initialization":
        return "initialization"
    if action.get("phase"):
        return action["phase"]
    return action.get("stage") or "unknown"


def first_target(action: dict, kind: str) -> dict:
    for target in action.get("targets") or []:
        if target.get("type") == kind:
            return target
    return {}


def build_events(trajectory: dict, people_ids: set[str], plan: dict | None = None) -> tuple[list[dict], dict]:
    objects = trajectory["objects"]
    economy = (plan or {}).get("economy", {})
    brands_by_owner = {brand["owner_entity_id"]: brand["brand_id"] for brand in economy.get("brands", [])}
    products_by_name = {product["product_name"]: product for product in economy.get("products", [])}
    ad_by_post = {ad["post_id"]: ad for ad in objects.get("ads", [])}
    posts = {}
    for post in objects.get("posts", []):
        posts[post["post_id"]] = {
            "author": post.get("author_entity_id"),
            "content": post.get("content", ""),
            "brand_id": ad_by_post.get(post["post_id"], {}).get("brand_id"),
        }

    def check_person(entity_id: str | None, context: str) -> None:
        if entity_id is not None and entity_id not in people_ids:
            raise SceneError(f"{context} 引用了人口快照里不存在的人物 {entity_id}")

    events = []
    seen_orders = set()
    noop_by_day = Counter()

    for action in trajectory["actions"]:
        actor = action["actor"]["entity_id"]
        check_person(actor, f"动作 {action['id']}")
        step = action["step"]
        name = action["action"]
        outcome = action["outcome"]

        if outcome == "noop":
            noop_by_day[step] += 1
            continue

        event = {
            "key": action["id"],
            "step": step,
            "line": action["audit_line"],
            "stage": stage_of(action),
            "origin": action.get("origin"),
            "actor": actor,
            "action": name,
        }

        if outcome not in {"executed", "failed", "declined", "unknown"}:
            raise SceneError(f"动作 {action['id']} 的结果状态无效：{outcome}")
        if plan is not None:
            event["outcome"] = outcome
        if outcome in {"failed", "declined", "unknown"}:
            event["type"] = outcome
            if outcome != "failed":
                event["outcome"] = outcome
            result = action.get("result")
            event["text"] = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
            events.append(event)
            continue

        event["type"] = ACTION_TYPES.get(name, "other")
        args = action.get("args") or {}
        result = action.get("result") or {}

        if name == "create_post":
            event["post_id"] = result.get("post_id")
            event["text"] = args.get("content", "")
        elif name == "create_comment":
            target = first_target(action, "post")
            event["post_id"] = args.get("post_id")
            event["target"] = target.get("author_entity_id")
            check_person(event["target"], f"评论 {action['id']}")
            event["text"] = args.get("content", "")
        elif name == "purchase_product":
            product = first_target(action, "product")
            if plan is not None:
                product_name = args.get("product_name") or result.get("product_name") or product.get("product_name")
                configured = products_by_name.get(product_name)
                if configured is None:
                    raise SceneError(f"购买动作 {action['id']} 引用了计划里不存在的商品")
                expected_brand = configured["brand_id"]
                if product.get("brand_id") not in (None, expected_brand):
                    raise SceneError(f"购买动作 {action['id']} 的品牌与计划不一致")
                owner = next(brand["owner_entity_id"] for brand in economy["brands"] if brand["brand_id"] == expected_brand)
                if product.get("owner_entity_id") not in (None, owner):
                    raise SceneError(f"购买动作 {action['id']} 的经营者与计划不一致")
                product = {**product, "brand_id": expected_brand, "owner_entity_id": owner}
            order_id = result.get("order_id")
            if not order_id:
                raise SceneError(f"购买动作 {action['id']} 执行成功却没有订单号")
            if order_id in seen_orders:
                # 同一订单被审计记录了两次，只保留第一次，避免重复计账
                continue
            seen_orders.add(order_id)
            event["order_id"] = order_id
            event["brand_id"] = product.get("brand_id")
            event["target"] = product.get("owner_entity_id")
            event["amount_fen"] = result.get("amount_fen")
            event["quantity"] = result.get("quantity", 1)
            event["product_name"] = result.get("product_name")
        elif name == "publish_ad":
            if plan is not None and actor not in brands_by_owner:
                raise SceneError(f"广告动作 {action['id']} 的执行者没有对应品牌")
            event["brand_id"] = brands_by_owner[actor] if plan is not None else actor
            event["post_id"] = result.get("post_id")
            event["text"] = args.get("content", "")
            event["cost_fen"] = result.get("cost_fen")
            ad = ad_by_post.get(result.get("post_id"), {})
            event["targeted"] = ad.get("target_entity_ids", [])
        elif name == "follow":
            target = first_target(action, "agent")
            event["target"] = target.get("entity_id")
            check_person(event["target"], f"关注 {action['id']}")
        elif name == "interview":
            event["text"] = result.get("content", "")
            event_id = action.get("event_id") or ""
            event["round"] = "pre" if event_id.startswith("pre_") else "post" if event_id.startswith("post_") else "other"
            event["prompt"] = args.get("prompt", "")
        elif name == "set_product_price":
            if plan is not None:
                product = products_by_name.get(args.get("product_name"))
                if product is None or brands_by_owner.get(actor) != product["brand_id"]:
                    raise SceneError(f"调价动作 {action['id']} 的商品或品牌归属不一致")
                event["brand_id"] = product["brand_id"]
                event["price_fen"] = result.get("price_fen", result.get("price", args.get("price_fen", args.get("price"))))
            else:
                event["brand_id"] = actor
                event["price_fen"] = result.get("price") or args.get("price")
        events.append(event)

    # 信息流里实际返回的广告帖：投放名单不等于看到，只有返回记录才算一次曝光
    for index, observation in enumerate(trajectory["observations"]):
        sponsored = observation.get("sponsored_post_ids") or []
        if not sponsored:
            continue
        actor = observation["actor"]["entity_id"]
        check_person(actor, "信息流返回记录")
        brands = sorted({posts.get(pid, {}).get("brand_id") for pid in sponsored} - {None})
        events.append({
            "key": f"exposure_{index:05d}",
            "step": observation["step"],
            "line": observation["audit_line"],
            "stage": "feed",
            "origin": "observation",
            "actor": actor,
            "type": "exposure",
            "post_ids": sponsored,
            "brand_ids": brands,
        })

    order_ids_in_objects = {order["order_id"] for order in objects.get("orders", [])}
    if seen_orders != order_ids_in_objects:
        missing = len(order_ids_in_objects - seen_orders)
        extra = len(seen_orders - order_ids_in_objects)
        raise SceneError(f"动作里的订单与订单表不一致：缺 {missing} 单，多 {extra} 单")

    events.sort(key=lambda e: (e["step"], e["line"], e["key"]))
    for index, event in enumerate(events):
        event["i"] = index
    return events, {"posts": posts, "noop_by_day": noop_by_day}


def build_brands(trajectory: dict, campus: dict) -> list[dict]:
    shops = {loc.get("brand_id"): loc["location_id"] for loc in campus["locations"] if loc.get("brand_id")}
    brands = []
    for product in trajectory["objects"].get("products", []):
        brand_id = product["brand_id"]
        if brand_id not in shops:
            raise SceneError(f"校园配置里没有品牌 {brand_id} 的门店地点")
        brands.append({
            "brand_id": brand_id,
            "product_name": product["name"],
            "location_id": shops[brand_id],
        })
    return brands


def build_days(trajectory: dict, events: list[dict], noop_by_day: Counter) -> list[dict]:
    meta = trajectory["metadata"]
    # 只有“未操作”记录的日子也要出现在时间轴上（例如中断前的最后一天）
    last_step = max([e["step"] for e in events] + list(noop_by_day), default=0)
    by_day = {}
    for event in events:
        by_day.setdefault(event["step"], Counter())[event["type"]] += 1
    days = []
    for step in range(0, last_step + 1):
        days.append({
            "step": step,
            "label": "初始化" if step == 0 else f"第 {step} 天",
            "complete": step <= meta["completed_steps"],
            "counts": dict(by_day.get(step, {})),
            "noop": noop_by_day.get(step, 0),
        })
    return days


def role_hash(seed: int, role: str) -> int:
    """按 UTF-8 FNV-1a 计算角色安置种子，与配置预览的缺省规则一致。"""
    value = 0x811C9DC5
    for byte in f"{seed}|{role}".encode("utf-8"):
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    return value


def build_generic_people(snapshot: dict, campus: dict, population_request: dict | None = None,
                         placement_rules: dict | None = None) -> list[dict]:
    """按显式规则或种子安置任意角色，保留画像原始 key 和值。"""
    by_building = building_index(campus)
    building_ids = sorted(by_building)
    if not building_ids:
        raise SceneError("通用回放地图没有可安置的楼栋")
    rules = placement_rules or {}
    role_rules, entity_rules = rules.get("roles", {}), rules.get("entities", {})
    nodes = snapshot["nodes"]
    roles, entities = {node["role"] for node in nodes}, {node["entity_id"] for node in nodes}
    if len(entities) != len(nodes):
        raise SceneError("人口快照里的人物编号重复")
    for values, known in ((role_rules, roles), (entity_rules, entities)):
        if not isinstance(values, dict) or any(key not in known or building not in by_building for key, building in values.items()):
            raise SceneError("楼栋安置规则引用了不存在的角色、人物或建筑")
    seed = snapshot.get("seed", 0)
    if type(seed) is not int:
        raise SceneError("人口快照 seed 必须为整数")
    people = []
    for node in nodes:
        role, entity = node["role"], node["entity_id"]
        selected = entity_rules.get(entity) or role_rules.get(role)
        if selected is None:
            for key in (f"{role}:{entity}", role):
                location = next((location for location in campus["locations"] if key in location.get("default_for_roles", [])), None)
                if location and location.get("buildings"):
                    selected = sorted(building["building_id"] for building in location["buildings"])[0]
                    break
        selected = selected or building_ids[role_hash(seed, role) % len(building_ids)]
        static, dynamic = node.get("static_attributes") or {}, node.get("dynamic_attributes") or {}
        request = (population_request or {}).get(role, {})
        fields = [{"key": key, "label": key, "value": copy.deepcopy(value), "source": "static"}
                  for key, value in static.items()]
        fields.extend({"key": key, "label": request.get("generate", {}).get(key, {}).get("title", key),
                       "value": copy.deepcopy(value), "source": "dynamic"} for key, value in dynamic.items())
        people.append({**copy.deepcopy(node), "id": entity, "role_label": request.get("description", role),
                       "name": node.get("name") or entity, "gender": {"male": "m", "female": "f"}.get(static.get("gender")),
                       "age": static.get("age"), "bio": node.get("bio") or node.get("description") or "",
                       "profile": copy.deepcopy(dynamic), "profile_fields": fields, "location_key": selected,
                       "building_id": selected, "home_location_id": by_building[selected], "indoor": True})
    return people


def build_generic_brands(plan: dict, people: list[dict]) -> list[dict]:
    """通过品牌与具体经营者实体建立门店映射，品牌 ID 与人物 ID 分开。"""
    economy = plan.get("economy", {})
    by_person = {person["id"]: person for person in people}
    brands, seen_brands, seen_owners = [], set(), set()
    for brand in economy.get("brands", []):
        brand_id, owner = brand["brand_id"], brand["owner_entity_id"]
        if brand_id in seen_brands or owner in seen_owners or owner not in by_person:
            raise SceneError("计划中的品牌或经营者绑定无效")
        seen_brands.add(brand_id)
        seen_owners.add(owner)
        products = [product for product in economy.get("products", []) if product["brand_id"] == brand_id]
        brands.append({"brand_id": brand_id, "merchant_id": owner, "owner_entity_id": owner,
                       "product_name": " / ".join(product["product_name"] for product in products) or brand_id,
                       "location_id": by_person[owner]["home_location_id"],
                       "building_id": by_person[owner]["building_id"]})
    if any(product["brand_id"] not in seen_brands for product in economy.get("products", [])):
        raise SceneError("商品引用了不存在的品牌")
    return brands


def convert(trajectory_path: Path, snapshot_path: Path, campus_path: Path, *, plan_path: Path | None = None,
            population_request: dict | None = None, placement_rules: dict | None = None) -> dict:
    """将冻结快照及终态轨迹转成场景，传入计划时启用通用角色和品牌。"""
    trajectory = load_json(trajectory_path)
    snapshot = load_json(snapshot_path)
    campus = load_json(campus_path)
    plan = load_json(plan_path) if plan_path is not None else None

    if trajectory.get("kind") != "oasis.interaction_trajectory":
        raise SceneError("输入不是 OASIS 交互轨迹（kind 应为 oasis.interaction_trajectory）")
    meta = trajectory["metadata"]
    if (meta.get("snapshot_id"), meta.get("snapshot_revision")) != (snapshot.get("snapshot_id"), snapshot.get("snapshot_revision")):
        raise SceneError(
            f"轨迹使用的快照是 {meta.get('snapshot_id')} r{meta.get('snapshot_revision')}，"
            f"提供的快照是 {snapshot.get('snapshot_id')} r{snapshot.get('snapshot_revision')}，二者不是同一次运行"
        )

    if plan is not None:
        if trajectory.get("schema_version") != "1.0" or trajectory.get("status") not in {"completed", "failed", "cancelled"}:
            raise SceneError("通用回放需要格式 1.0 的终态轨迹")
        if plan.get("plan_id") != meta.get("plan_id"):
            raise SceneError("轨迹与计划编号不一致")
        population = plan.get("population", {})
        if (population.get("snapshot_id"), population.get("snapshot_revision")) != (snapshot.get("snapshot_id"), snapshot.get("snapshot_revision")):
            raise SceneError("计划与冻结快照的版本不一致")
    people = (build_generic_people(snapshot, campus, population_request, placement_rules)
              if plan is not None else build_people(snapshot, trajectory, campus))
    brands = build_generic_brands(plan, people) if plan is not None else build_brands(trajectory, campus)
    people_ids = {p["id"] for p in people}
    run_ids = {a["entity_id"] for a in trajectory["agents"]}
    if run_ids != people_ids:
        raise SceneError(f"运行中的人物与快照不一致：运行独有 {sorted(run_ids - people_ids)[:5]}，快照独有 {sorted(people_ids - run_ids)[:5]}")

    events, extra = build_events(trajectory, people_ids, plan)
    relationships = [
        {"source": edge["source"], "target": edge["target"], "relation": edge.get("relation", "follow")}
        for edge in trajectory.get("initial_relationships", [])
    ]
    type_counts = Counter(e["type"] for e in events)
    purchases = [e for e in events if e["type"] == "purchase"]

    return {
        "schema": SCHEMA,
        "meta": {
            "run_id": trajectory.get("run_id"),
            "status": trajectory.get("status"),
            "partial": trajectory.get("partial"),
            "plan_id": meta.get("plan_id"),
            "snapshot_id": meta.get("snapshot_id"),
            "snapshot_revision": meta.get("snapshot_revision"),
            "completed_steps": meta.get("completed_steps"),
            "total_steps": meta.get("total_steps"),
            "step_unit": meta.get("step_unit"),
            "exported_at": meta.get("exported_at"),
            "limitations": meta.get("limitations", []),
            "sources": {
                "trajectory_sha256": sha256_of(trajectory_path),
                "snapshot_sha256": sha256_of(snapshot_path),
                "campus_sha256": sha256_of(campus_path),
            },
        },
        "summary": {
            "people": len(people),
            "events": len(events),
            "by_type": dict(sorted(type_counts.items())),
            "orders": len(purchases),
            "revenue_fen": sum(e.get("amount_fen") or 0 for e in purchases),
            "noop": sum(extra["noop_by_day"].values()),
        },
        "campus": campus,
        "brands": brands,
        "people": people,
        "relationships": relationships,
        "posts": {str(k): v for k, v in extra["posts"].items()},
        "days": build_days(trajectory, events, extra["noop_by_day"]),
        "events": events,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OASIS 轨迹 -> MeCoffe 场景数据")
    parser.add_argument("--trajectory", type=Path, default=DEFAULT_TRAJECTORY)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--campus", type=Path, default=DEFAULT_CAMPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--plan", type=Path, help="提供计划时启用任意角色与品牌的通用转换")
    args = parser.parse_args(argv)
    try:
        scene = convert(args.trajectory, args.snapshot, args.campus, plan_path=args.plan)
    except SceneError as error:
        print(f"转换失败：{error}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(scene, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    summary = scene["summary"]
    print(f"已生成 {args.output}")
    print(f"人物 {summary['people']}，事件 {summary['events']}，订单 {summary['orders']}，"
          f"成交额 {summary['revenue_fen'] / 100:.2f} 元，未操作 {summary['noop']} 次")
    print("事件类型：" + "，".join(f"{k} {v}" for k, v in summary["by_type"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
