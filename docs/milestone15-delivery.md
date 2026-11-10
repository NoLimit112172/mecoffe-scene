# M15 第一批交付

日期：2026-11-10。基线：`main=324b047`；本地分支：`feat/m15-scene-service`。

本批实现三件事：统一的场景结果及校验、从地图提取用途证据、根据明确规则确定人物与门店位置。Python 仅依赖标准库。前端只增加校验模块，没有接入渲染，也没有改动旧入口、旧地图、`kind`、素材匹配或 M14 行为。

没有实现地图联网获取、地图库注册、后台任务队列、团队 API、管理员工具、第五阶段或运行绑定，也没有访问团队服务、发布和部署。

## 文件与使用入口

| 文件 | 作用 |
| --- | --- |
| `adapter/scene_service/common.py` | 错误、可跨语言复算的 JSON、哈希和本地读写 |
| `adapter/scene_service/contract.json` | Python 和 JavaScript 共用的 v1 字段约束 |
| `adapter/scene_service/request.py` | 内部请求适配层，后续在此映射 scene_intent 字段 |
| `adapter/scene_service/maps.py` | 只读本地地图包或已准备好的地图目录 |
| `adapter/scene_service/geometry.py` | 轮廓、孔洞、边界与接驳段的保守检查 |
| `adapter/scene_service/evidence.py` | 用途证据、补注、入口和质量摘要 |
| `adapter/scene_service/resolver.py` | 人物与门店确定性安置 |
| `adapter/scene_service/validation.py` | 结构、哈希、内部一致性和外部引用校验 |
| `adapter/scene_service/__main__.py` | evidence、resolve、validate 命令 |
| `frontend/src/mecoffe/sceneResult.js` | 同一契约的同步前端校验；复用已有 SHA-256 |
| `adapter/scene_service/fixtures/` | 完全合成的地图、输入及 25 个共用校验样例，context.json 保存共用上下文避免重复 |
| `adapter/test_scene_service.py`、`frontend/tests/sceneResult.test.js` | 不变性、异常和跨语言样例测试 |
| `docs/milestone15-ustc-stats.json` | 现有公开中科大地图的离线统计，不含人物或运行数据 |

从仓库根目录运行以下命令。输出目录 `logs/` 被忽略，不会进入公开提交。

```powershell
python -m adapter.scene_service evidence --map frontend/public/mecoffe/scenarios/ustc-history --out logs/m15-ustc-evidence.json
python -m adapter.scene_service resolve --map adapter/scene_service/fixtures/map.json --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json --prefs adapter/scene_service/fixtures/prefs.json --out logs/m15-result.json
python -m adapter.scene_service validate logs/m15-result.json --map adapter/scene_service/fixtures/map.json --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json
```

如果将最后一条的地图替换为 `logs/m15-ustc-evidence.json`，应以退出码 2、`REF_MISMATCH` 拒绝，不能把合成人物安排套进中科大。无地图示例为：

```powershell
python -m adapter.scene_service resolve --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json --prefs adapter/scene_service/fixtures/prefs-none.json --out logs/m15-none.json
python -m adapter.scene_service validate logs/m15-none.json
```

`validate` 不提供上下文时，只能确认结构、哈希与内部一致性；有地图、快照和计划时才核对外部引用。也支持 `--context` 指向 `{map,snapshot,plan,source_refs}` 对象。前端入口是 `validateSceneResult(result, context)`，通过时返回副本，失败时抛出带 `code` 的错误；不获取数据、不做安置。

地图 JSON 输入使用 `{map_ref,campus,entrances,landcover}`。`campus` 沿用本仓库的 `buildings`、`walk_graph`、`boundary` 或 `boundary_polygons`；`entrances.entrances` 沿用既有入口记录。目录输入读取 `scenario.json`（或 `manifest.json`）、`campus3d.json`、`entrances.json` 和 `landcover.json`，检查清单已声明的相关文件摘要；缺入口的普通地图转换目录应先完成本地场景组装，不能凭空当作可安置地图。

目录适配器用清单的 `id/campus_id` 作为 `map_id`；`map_version` 缺失时暂用字符串 `1`，并绑定清单原始字节的 SHA-256。这是本地适配约定，正式地图库版本规则留待下一批确定。修改清单不会冒充原来的地图引用。

## SceneResult v1 全部字段

精确约束见共用的 `contract.json`，额外字段默认拒绝。

| 字段 | 内容 |
| --- | --- |
| `schema_version` | 固定 `scene.result.v1` |
| `scene_id`、`scene_revision` | 场景编号与正整数修订；默认编号按内容确定，无时间戳或随机 UUID |
| `mode`、`illustrative` | `map/none`，以及固定 `true` |
| `map_ref` | `{map_id,map_version,manifest_sha256}`；无地图为 null |
| `source_refs` | `{config_id,snapshot_id,snapshot_revision,plan_id,plan_revision}` |
| `assignment_meta` | `{assignment_seed,rules_version,resolver_version,rules_sha256}`；安置种子必须明确传入，与配置种子独立 |
| `rules` | 实际采用并补齐默认值的 `{role_prefs,brand_prefs,overrides}`；functions 去重排序；none 为 `{}` |
| `assumptions` | 用户确认的文字数组，空格、换行和内容原样保留，不重写、不补造 |
| `assignments[]` | `{entity_id,role,status,building_id,entrance_id,reason,evidence,fallback_used}` |
| `service_points[]` | `{service_id,brand_name,brand_id,owner_entity_id,status,building_id,entrance_id,reason,evidence,fallback_used}` |
| `warnings[]` | `{code,message,refs}`；refs 是字符串数组 |
| `reason` | none 必需的非空关闭原因；map 可不提供 |
| `result_sha256` | 去掉本字段后的完整结果摘要 |

人物与服务点均有 `status=placed/out_of_scene`。为完整保留使用品牌场外兜底的情况，服务点额外采用与人物相同的 status；场外条目的楼和入口为 null，仍保留品牌及经营者身份。多人、多店同楼不合并、不丢弃。

`fallback_used` 未使用兜底时为 null，否则是 `any_building_in_scope/out_of_scene`。明确覆盖会在 rules 中保留，不伪造用途证据；覆盖位置仍必须在范围内并有安全可达入口。每条 evidence 为 `{function,source,key,value,ref}`，source 为 `building_tag/poi/annotation/name_keyword`。

none 不读地图、不安置，输出空位置及服务点数组和空规则，但仍保存来源、假设、原因及两种哈希。它不删除正常人物快照。

### 哈希的跨语言规则

对象键按 Unicode 码点排序，UTF-8 编码，紧凑 JSON，无多余空白；数组按既定顺序保留。人物输出按 entity_id、服务点按品牌名排序。`rules_sha256` 针对保存后的 rules；`result_sha256` 本身不参与自己的哈希。

v1 结果内数字只接受 JavaScript 安全整数（绝对值不超过 9007199254740991，整数值的 1.0 归一为 1，负零归一为 0）；大种子可传字符串。NaN、Infinity、小数及未配对代理字符拒绝。地图坐标和质量比例不属于 SceneResult 正文，不受这个整数约束。此规则是本契约的便携格式，不声称实现通用 JCS。

## 用途映射与证据

用途词表：dining、retail、dormitory、residential、education、office、library、unknown。

| 标签 | 具体值 | 用途 |
| --- | --- | --- |
| amenity | cafe、restaurant、fast_food、food_court、canteen | dining |
| amenity | library | library |
| building | dormitory | dormitory |
| building | residential、apartments、house | residential |
| building | university、college、school | education |
| building | office | office |
| office | 非空字符串，排除 no、none、vacant | office |
| shop | convenience、supermarket、bakery、books、clothes、general、kiosk、stationery、department_store、mall | retail |

未列值不产生用途，unknown 不参与严格候选匹配。校园边界上的 amenity=university 不下放给楼栋。旧归档没有 tags 时，仅将原始 `building_type` 当作 building 标签使用，不从旧 kind 或素材外观反推用途。食堂、咖啡、宿舍、教学楼、图书馆、办公等关键词只记弱证据。

POI 点必须严格位于唯一建筑外环内、排除庭院孔洞；边界点、多重覆盖点和范围外点都不吸附，原点数据保留，另给关联、歧义、未关联和无效坐标数量。

补注格式如下。map_ref 必须与完整地图引用一致，mode 默认 add，也可 replace。replace 后旧强证据保存在 `superseded_function_evidence`，审核来源保存在 `function_annotation`；原始标签与旧 kind 不变。新输出保存 annotations，重读仍可复算。

```json
{
  "map_ref": {"map_id": "synthetic-campus", "map_version": "1", "manifest_sha256": "填写真实地图清单摘要"},
  "buildings": {
    "synthetic/b0": {
      "functions": ["retail"], "mode": "replace",
      "source": "synthetic reviewed note", "reviewer": "synthetic-reviewer", "note": "合成补注示例"
    }
  }
}
```

该段为合成格式示例，摘要占位符不能直接用于执行。使用 `evidence --annotations 文件` 传入完整补注。

## 质量与候选

新增 `functions`、`function_evidence`、`usable_entrance_ids`、`scene_eligible` 等字段，并为入口附加 `scene_reachable`；对输入做副本处理，不改原文件。

建筑外环、孔洞须有效；楼体的边和内部不能越过确认范围或其孔洞。入口必须在楼外墙、连到主步行图分量，接驳段不能穿过楼体或水域；覆盖同样受这些硬约束限制。主分量为最大的非孤立无向分量，并以节点编号打破并列。每个采用的入口都需通过检查，不能靠地图总比例放行坏点。

摘要包含每种用途数量、unknown、无入口楼数、入口属于主图分量的比例、安全可用楼数、POI 统计及警告。`--min-main-ratio` 默认 0.9，`--min-function-ratio` 默认 0；参数均可校准，只是示例。无有效候选楼、几何无效或比例不达标时输出 `preview_only`，否则 `ready`。

ready 是这组地图质量门槛的结果，不代表满足所有实验用途。角色要求餐饮而没有餐饮证据时，仍会按明确兜底处理或返回 `SCENE_NO_CANDIDATE`。

### 中科大离线统计

输入为现有公开 `scenarios/ustc-history`。完整统计见 `docs/milestone15-ustc-stats.json`。

| 项目 | 结果 |
| --- | --- |
| 总楼数／有效轮廓 | 31／31 |
| 宿舍／教学／未知 | 8／21／2 |
| 餐饮、零售、住宅、办公、图书馆 | 均为 0 条可确认用途 |
| 无入口楼数 | 0 |
| 入口属于主路网分量 | 31/31，100% |
| 通过全部保守落位检查的楼 | 29 |
| POI 总数／关联数 | 0／0 |
| 默认质量结论 | ready；不代表具备餐饮安置条件 |

两栋排除建筑为 `way/1435370291`、`way/1435377495`；另有两栋用途未知。归档缺少可确认餐饮标签及 POI，不能据此断言校园没有餐饮，也不能凭楼名补造功能。需要真实证据或审核补注后，才能严格安排餐饮服务点。

## 内部请求与安置

`adapt_request(prefs,snapshot,plan,map_package)` 是独立边界，后续将 scene_intent 翻译到本内部格式即可。核心 resolver 不依赖团队 HTTP 路径或管理员字段命名。

prefs 中的字段为：`mode`、`config_id`、`assignment_seed`、`assumptions[]`、`role_prefs`、`brand_prefs`、`overrides`；可选 `source_refs`、`map_ref` 用于断言引用，可选 `scene_id/scene_revision/rules_version`，none 必填 reason。

- snapshot 采用根对象 `snapshot_id/snapshot_revision/nodes[]`，节点有 entity_id、role。
- plan 采用根对象 plan_id/plan_revision 和 economy.brands/products。若有 population 引用，必须与快照一致。
- role_prefs 必须覆盖快照中的角色名，值为 `{functions[],distribution:balanced|clustered,fallback}`。
- brand_prefs 必须覆盖本次唯一品牌名，值为 `{functions[],separate_when_possible,fallback}`。
- overrides 为 `{entities:{entity_id:building_id},brands:{品牌名:building_id}}`。
- fallback 为 fail（默认）、any_building_in_scope、out_of_scene；distribution 默认 balanced，separate_when_possible 默认 false。

品牌名取 products[].product_name。第一版要求每个品牌恰有一个唯一产品名，与 brands[].brand_id 精确对应；没有多商品猜测规则。缺失、重名、改名后偏好未更新都报错。结果写入当次 brand_id、owner_entity_id，品牌名只是本次选择器。

balanced 在可用用途候选之间最大化 SHA-256(`[assignment_seed,entity_id,building_id]`)，不按人数重排；clustered 用角色名替代实体编号。品牌按名称排序，按相同结构的品牌名哈希选楼；启用 separate_when_possible 时先尝试未用楼，只有没有空余候选才共享。无论怎样共享，所有服务点保留。

人物默认地点与门店独立。打乱节点、品牌和商品数组不改变对应位置。品牌重排而编号改变时，位置仍按名称稳定，结果记录新的实际编号。增加一个人不移动旧人仅适用于原 ID、种子、候选、地图、规则及程序版本不变的情况；重新生成画像仍须绑定新快照重编。

主要错误码：UNKNOWN_ROLE、UNKNOWN_BRAND、BRAND_NAME_MISMATCH、UNKNOWN_FUNCTION、OVERRIDE_INVALID、SCENE_NO_CANDIDATE、MAP_NOT_READY、REF_MISMATCH；另有 INVALID_INPUT、INVALID_JSON、INVALID_MAP、INVALID_PREFERENCE、INVALID_ANNOTATION、INVALID_THRESHOLD、INVALID_SCENE、HASH_MISMATCH。CLI 失败返回 2，不写成功结果；不删除调用者已有输出文件。

## 测试与结果

在本分支执行：

```powershell
python -m unittest discover -s adapter -p "test_*.py"
npm --prefix frontend test
npm --prefix frontend run build:embed
node scripts/audit-public.cjs
```

- Python：108 项通过，其中 M15 新增 18 项。
- 前端：367 项通过，其中 M15 新增 28 项；25 个共用结果样例同时由两端验证结论及错误码。
- build:embed：通过。仍有既有的大体积 chunk 提示，没有扩大本批范围调整打包策略。
- 公开内容审计：通过，findings 为空。

覆盖重复输出和哈希、换种子、节点顺序、品牌顺序及编号变化、增加人物、聚集、同楼多店、覆盖、品牌改名、三种兜底、场外总人数、无地图、住宅与宿舍分开、未知标签、孔洞及重叠 POI、补注来源、断开的路网、水域、越界、凹边界、引用和哈希错误、伪造证据及未声明兜底。CLI 也执行了本地端到端测试。

复生成合成样例：`python -m adapter.scene_service.fixtures.generate`。示例不依赖私有数据。旧文件没有业务改动，旧中科大历史、配置预览、终态及 M14 用原有回归验证。

## 限制与后续确认

- 当前不提供地图服务、地图库或渲染接入，校验模块也没有挂进旧页面。完整生产链路仍未联调。
- 路网检查针对本地无向步行图、入口及接驳段；不证明现实通行权，不新增引擎空间行为。水域检查保守，宁可排除不确定位置。
- 归档没有保存的用途标签不会自动找回；人工补注须来自审核，名称弱证据不能替代。
- 第一版不支持一个品牌多个产品名、无经营者机构、多楼层真实经营或人口容量模型；这些输入要明确适配，不能猜。
- 第一版名称选择器改名即失效；稳定 brand_ref/role_ref 和正式地图版本须与褚凌宇确认。
- 需要确认 scene_intent 的字段适配、第五阶段或附属产物方式、质量阈值、用途词表、确认假设的来源、正式 map_ref，以及服务点 status 的统一约定。
- 运行冻结、正文保留、后台队列和团队权限仍属后续接入，不因本批结果有哈希就声称已经实现。
