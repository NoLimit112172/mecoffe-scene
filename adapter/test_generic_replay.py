"""以完全合成的团队格式输入验证通用角色、品牌归属和动作状态。"""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import oasis_to_scene as adapter


def inputs():
    """创建任意角色、两个不同品牌和三人的合成输入。"""
    snapshot = {"schema_version":"1.0", "snapshot_id":"synthetic_generic_snapshot", "snapshot_revision":2,
                "seed":23, "dataset_version":"synthetic-only", "nodes":[
        {"entity_id":"owner_one", "role":"venue_operator", "name":"样例人物 01", "static_attributes":{}, "dynamic_attributes":{"custom":"合成经营者"}},
        {"entity_id":"owner_two", "role":"venue_operator", "name":"样例人物 02", "static_attributes":{}, "dynamic_attributes":{}},
        {"entity_id":"visitor_one", "role":"campus_visitor", "name":"样例人物 03", "static_attributes":{"gender":"female"}, "dynamic_attributes":{"visit_goal":"合成参观"}}], "edges":[]}
    plan = {"schema_version":"1.0", "plan_id":"synthetic_generic_plan", "population":{"snapshot_id":snapshot["snapshot_id"],"snapshot_revision":2}, "economy":{
        "brands":[{"brand_id":"brand_xxx", "owner_entity_id":"owner_one"},{"brand_id":"brand_yyy","owner_entity_id":"owner_two"}],
        "products":[{"brand_id":"brand_xxx","product_name":"合成商品 X"},{"brand_id":"brand_yyy","product_name":"合成商品 Y"}]}}
    def action(index, actor, name, outcome, args, result, targets=None):
        """创建一条带显式结果状态的合成动作。"""
        return {"id":f"synthetic_action_{index}","step":1,"audit_line":index,"origin":"autonomous","actor":{"entity_id":actor},"action":name,"outcome":outcome,"args":args,"result":result,"targets":targets or []}
    trajectory={"schema_version":"1.0","kind":"oasis.interaction_trajectory","run_id":"synthetic_generic_run","status":"completed","partial":False,
        "metadata":{"plan_id":plan["plan_id"],"snapshot_id":snapshot["snapshot_id"],"snapshot_revision":2,"completed_steps":1,"total_steps":1},
        "agents":[{"entity_id":node["entity_id"]} for node in snapshot["nodes"]],"initial_relationships":[],
        "objects":{"posts":[{"post_id":1,"author_entity_id":"owner_one","content":"合成广告"}],"products":[],"orders":[{"order_id":"synthetic_order_1"}],"ads":[{"post_id":1,"brand_id":"brand_xxx","target_entity_ids":[]}]},
        "actions":[action(1,"owner_one","publish_ad","executed",{"content":"合成广告"},{"post_id":1,"cost_fen":50}),
            action(2,"owner_two","set_product_price","executed",{"product_name":"合成商品 Y","price_fen":120},{"price_fen":120}),
            action(3,"visitor_one","purchase_product","executed",{"product_name":"合成商品 X"},{"order_id":"synthetic_order_1","product_name":"合成商品 X","amount_fen":200,"quantity":1}),
            action(4,"visitor_one","purchase_product","declined",{"product_name":"合成商品 X"},{"accepted":False,"reason":"合成拒绝"}),
            action(5,"visitor_one","create_post","unknown",{"content":"未知结果的合成帖子"},None)],"observations":[]}
    campus={"campus_id":"synthetic-campus","locations":[{"location_id":f"location_{key}","name":f"合成楼栋 {key}","buildings":[{"building_id":f"building_{key}"}]} for key in ("a","b","c")]}
    return trajectory,snapshot,campus,plan


class GenericReplayTests(unittest.TestCase):
    """通用转换输入按计划和快照绑定，不依赖咖啡角色或品牌编号。"""
    def convert(self, values, **options):
        """仅在临时目录落盘合成输入，再走公开转换入口。"""
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for index,value in enumerate(values):
                filename=Path(directory)/f"input-{index}.json"
                filename.write_text(json.dumps(value,ensure_ascii=False),encoding="utf-8")
                paths.append(filename)
            return adapter.convert(*paths[:3],plan_path=paths[3],**options)

    def test_custom_roles_brand_owners_and_nonexecuted_actions(self):
        """经营者所属楼栋决定门店，被拒和未知动作均不增加订单或成功帖子。"""
        values=inputs(); original=copy.deepcopy(values)
        result=self.convert(values,placement_rules={"entities":{"owner_one":"building_a","owner_two":"building_b"}})
        self.assertEqual(values,original)
        self.assertEqual(result["summary"]["people"],3)
        self.assertEqual(result["summary"]["orders"],1)
        self.assertEqual(result["summary"]["revenue_fen"],200)
        self.assertEqual(result["summary"]["by_type"],{"ad":1,"declined":1,"price":1,"purchase":1,"unknown":1})
        self.assertEqual(result["brands"][0]["location_id"],"location_a")
        self.assertEqual(result["brands"][1]["location_id"],"location_b")
        self.assertEqual(result["events"][0]["brand_id"],"brand_xxx")
        self.assertEqual(result["events"][1]["brand_id"],"brand_yyy")
        self.assertEqual(result["events"][1]["price_fen"],120)
        self.assertEqual(result["events"][2]["target"],"owner_one")
        self.assertNotIn("order_id",result["events"][3])
        self.assertNotIn("post_id",result["events"][4])
        visitor=next(person for person in result["people"] if person["id"]=="visitor_one")
        self.assertEqual(visitor["dynamic_attributes"],values[1]["nodes"][2]["dynamic_attributes"])
        self.assertTrue(all(person["indoor"] for person in result["people"]))

    def test_seed_placement_is_independent_of_input_order(self):
        """同一种子和角色在调整人物及建筑顺序后仍选择相同楼栋。"""
        original=inputs();reversed_values=copy.deepcopy(original)
        reversed_values[1]["nodes"].reverse();reversed_values[2]["locations"].reverse()
        extract=lambda result:{person["id"]:person["building_id"] for person in result["people"]}
        self.assertEqual(extract(self.convert(original)),extract(self.convert(reversed_values)))

    def test_inconsistent_snapshot_plan_owner_and_placement_are_rejected(self):
        """跨版本快照、未知经营者和无效显式安置规则都会明确报错。"""
        changed=inputs();changed[3]["population"]["snapshot_revision"]=3
        with self.assertRaises(adapter.SceneError):self.convert(changed)
        changed=inputs();changed[3]["economy"]["brands"][0]["owner_entity_id"]="unknown_owner"
        with self.assertRaises(adapter.SceneError):self.convert(changed)
        with self.assertRaises(adapter.SceneError):self.convert(inputs(),placement_rules={"roles":{"campus_visitor":"missing"}})
        changed=inputs();changed[0]["actions"][0]["actor"]["entity_id"]="visitor_one"
        with self.assertRaises(adapter.SceneError):self.convert(changed)

    def test_empty_terminal_run_has_initialization_day(self):
        """没有动作的合法终态保留初始化日，并产生零订单。"""
        changed=inputs();changed[0]["actions"]=[];changed[0]["objects"]["orders"]=[]
        result=self.convert(changed)
        self.assertEqual(result["summary"]["orders"],0)
        self.assertEqual([day["step"] for day in result["days"]],[0])


if __name__ == "__main__":
    unittest.main()
