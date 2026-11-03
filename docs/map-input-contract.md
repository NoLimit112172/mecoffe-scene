# 地图输入接口草案：地图 → 三维场景与素材原型

**草案，待与 OASIS 调度器负责人确认。** 本文定义地图准备模块的文件边界，不表示调度器已经实现或接受此协议。人物调度、agent 决策、模拟时间、购买与互动轨迹不由本流水线生成。

## 输入与调用方式

仅接受 **OpenStreetMap 官方数据** 或 **调用方提供的 GeoJSON**。坐标统一为 RFC 7946 / WGS84 经纬度，坐标顺序固定 `[longitude, latitude]`，不接受 GCJ-02、BD-09、投影米坐标或含旧 `crs` 声明的 GeoJSON。不得将不同坐标系混用，也不会抓取高德、百度或 Google。

模块仅使用 Python 标准库，入口为 `python -m adapter.scene_builder`。两个子命令都支持：

| 参数 | 含义 |
| --- | --- |
| `--campus-id` | 地图标识；下载模式只允许字母、数字、下划线、连字符，防止文件名越界 |
| `--title` | 预览标题，不代表模拟名称 |
| `--output-dir` | 独立输出目录，不应指向已验收的中科大源文件目录 |
| `--catalog` | 素材目录路径，默认 `frontend/public/mecoffe/assets3d/catalog.json` |
| `--seed` | 变体选择种子，默认字符串 `0` |
| `--style` | 建筑原型风格，默认 `procedural`；道路/地表仍用通用 procedural 原型，不要求每套楼房都带一套路模型 |
| `--location-rules` | 可选 JSON 规则列表，见“地点对应” |

### 方式 A：OSM 范围

`--bbox` 顺序固定 `[minLon,minLat,maxLon,maxLat]`，四边须为有限、顺序正确的 WGS84 数值。下载只访问 OSM 官方 map API；单次范围超过 0.25 平方度会拒绝，调用方应拆分。

```powershell
python -X utf8 -m adapter.scene_builder osm --bbox 103.7710 1.2920 103.7790 1.3000 --campus-id nus --title "NUS 建模流水线验证" --seed 2026 --archive-dir data/osm --output-dir frontend/public/mecoffe/campuses/nus
```

会保存 `data/osm/nus.osm` 与 `nus.metadata.json`，记录 **实际请求 URL、UTC 下载时间、原始响应 SHA-256、bbox、ODbL 许可与 OSM 署名**。元数据与 XML 的哈希不匹配时拒绝转换。官方响应中的完整楼栋轮廓可能延伸到请求框外；只纳入与框相交的建筑，保留完整建筑轮廓，避免凭空截成一栋新楼。道路截到请求范围，新增截断端点明确使用 `clip/...` 标识，不与其他道路虚接。

离线重新生成：

```powershell
python -X utf8 -m adapter.scene_builder osm --osm data/osm/nus.osm --metadata data/osm/nus.metadata.json --campus-id nus --title "NUS 建模流水线验证" --seed 2026 --output-dir frontend/public/mecoffe/campuses/nus
```

`--bbox` 下载与 `--osm/--metadata` 离线输入互斥。NUS 快照实际于 `2026-11-03T07:36:11.586106+00:00` 下载，SHA-256 为 `31f19c9919e87ce833f592cff615097b6829cdecd8ae8f4adb6be897d7c2d63f`。本次实际得到 **226 栋楼、840 个道路分段、114 个 POI、100 个地表要素**，数量来自该快照，不使用“约 220 栋”的估计冒充测量。预览必须注明：**NUS 仅用于验证建模流水线，没有模拟数据**。

### 方式 B：调用方 GeoJSON

输入必须为 `FeatureCollection`，支持 `Polygon` / `MultiPolygon`（建筑或地表）、`LineString` / `MultiLineString`（道路）、`Point`（POI）；其他 geometry 类型明确拒绝。每个 polygon 外环与孔洞都要闭合、非退化，孔洞起点须在外环内。`Feature.id` 可为字符串或数值，地图内不得重复；未提供时使用输入顺序生成标识，若需要跨版本稳定对应，请显式提供稳定 ID。

```json
{
  "type": "FeatureCollection",
  "source": {
    "license": "LicenseRef-Caller-Provided",
    "attribution": "调用方提供的地图；使用权由调用方确认"
  },
  "features": [
    {
      "type": "Feature",
      "id": "dorm-a",
      "properties": {
        "building": "dormitory",
        "name": "宿舍 A",
        "levels": 6,
        "location_id": "ug_dorm_a"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[103.773,1.294],[103.7732,1.294],[103.7732,1.2942],[103.773,1.2942],[103.773,1.294]]]
      }
    },
    {
      "type": "Feature",
      "id": "walkway-a",
      "properties": { "highway": "footway", "name": "校园步道" },
      "geometry": { "type": "LineString", "coordinates": [[103.773,1.2939],[103.7732,1.2939],[103.7734,1.2939]] }
    },
    {
      "type": "Feature",
      "id": "cafe-poi",
      "properties": { "amenity": "cafe", "name": "咖啡店 A", "location_id": "shop_a" },
      "geometry": { "type": "Point", "coordinates": [103.7734,1.2941] }
    }
  ]
}
```

```powershell
python -X utf8 -m adapter.scene_builder geojson --input campus.geojson --campus-id caller-campus --title "调用方地图预览" --seed 2026 --output-dir scene/generated/caller-campus
```

属性可直接放在 `properties`，也可把 OSM 标签放在 `properties.tags`；直接字段优先。字段：

| 字段 | 规则 |
| --- | --- |
| `building` | OSM 建筑类型；Polygon 缺省为 `yes`；决定素材匹配，不包含 agent |
| `amenity`、`leisure`、`natural`、`landuse` | OSM 风格类型标签，用于楼栋或地表分类 |
| `feature_type` | 可选显式 `building` 或 `landcover`，用于消除 Polygon 的分类歧义 |
| `name` | 调用方名称；没有名字使用明确的展示缺省名，不能当作 OSM 原名 |
| `building:levels` / `levels` | 正数，前者优先；非法或负数报错 |
| `height` / `height_m` | 正数米值，可用 `24.5 m`；前者优先；非法值报错 |
| `highway` | 道路等级，LineString 缺省 `service` |
| `foot`、`access` | 步行可达限制，沿用已验收的 OSM 标签规则；无标记不证明真实可通行 |
| `layer`、`tunnel` | 道路拓扑层信息，避免同一平面坐标的上下层误连 |
| `node_ids` | 可选，每个道路顶点一个非空字符串；同 ID 必须有相同坐标，表示调用方明确的共享节点 |
| `location_id` | 可选非空 OASIS 地点 ID，不是人物当前位置 |
| 顶层 `bbox` | 可选 `[minLon,minLat,maxLon,maxLat]`，必须包含所有坐标；缺省从输入推导；单点/水平线等退化范围仅为显示加很小余量 |
| 顶层 `source` | 建议提供地图许可与署名；不提供时标为 `LicenseRef-Caller-Provided`，不会伪称成 OSM/ODbL |

地图只能表示几何，单个 POI 不会被自动扩成虚构的建筑轮廓。POI 会写入地点注册和 assignments，并标 `placement_only: true`、`prototype_id: null`，说明没有为它生成楼体。MultiPolygon 的各部件以 `/part/N` 区分，单个输入 Feature 的 `location_id` 可对应它的多个部件。

## 坐标、拓扑与确定性原型选择

统一使用输入范围中心为局部原点，按本项目原有等距矩形公式换算为米：`x=R*cos(lat0)*radians(lon-lon0)`、`y=R*radians(lat-lat0)`，`R=6371008.8m`。坐标保留毫米级小数，三维显示映射为 `(x, height, -y)`。这是适合校园范围的局部投影，不是全球高精度测绘或高程模型。

OSM 只把原始共享节点及相邻顶点连成步行边；几何上相交的两条线不会自动接通。GeoJSON 若没有 `node_ids`，只共享**完全相同坐标且 layer 相同的显式顶点**，不把线段交叉处自动插成道路节点；有 `node_ids` 时按调用方显式拓扑处理。没有新增道路路线规划、门禁或 agent 调度语义。

原型规则来自实际 `catalog.json`：同一规则各标签为 AND，数组是 OR；具体值每键得 4 分、存在通配 `*` 得 1 分，空规则不自动命中。同分按原型 ID 的确定顺序选择。`target: component` 的窗户、招牌等组件不会替代完整建筑自动命中；未识别建筑用目录中的明确通用建筑兜底，未匹配的其他类别报错。`road.other` 覆盖 corridor 等已存在但未单独细分的道路标签。

变体使用 **FNV-1a 32 位、UTF-8 字节**计算 `seed + "|" + feature_id + "|" + prototype_id`，再对变体数取模，与前端 JS `TextEncoder` 逻辑一致。相同输入、目录、种子得到相同输出；改目录规则或种子可能改变原型/变体。输入明确高度优先，缺省楼层与层高从所选原型参数取得；所有缺省维度注明来源，不能误称实测。

## 地点对应

优先由调度器在 GeoJSON `properties.location_id` 直接提供。不同 Feature 重复同一个地点 ID 会报错；同一 MultiPolygon Feature 的部件属于同一个输入，不视为重复冲突。

如果调度器只能给名称或类型，可提供单独的**显式规则列表**，只做完全匹配：

```json
[
  { "location_id": "ug_dorm_a", "name": "宿舍 A" },
  { "location_id": "library_main", "tags": { "amenity": "library" } }
]
```

规则匹配零个要素报 `unresolved_location_rule`，匹配多个报 `ambiguous_location_rule`；不会靠相似名称、最近楼栋或随机挑选解决歧义。直接 ID 记 `method: caller_location_id`、`illustrative:false`；规则结果记 `method: explicit_exact_rule`、`illustrative:true`，需调用方确认。地点 ID 是注册标签，不证明任何 agent 已经在该位置。

## 输出与错误

所有输入校验和素材匹配成功后，才开始写入独立输出目录：

| 文件 | 内容 |
| --- | --- |
| `campus3d.json` | 兼容原 `mecoffe.campus3d.v1` 的米制楼栋、道路、范围、步行图和维度来源；额外保留 POI、地表、原始 tags |
| `asset_assignments.json` | 每个要素的 `feature_id`、类别、原型 ID、变体、参数、匹配理由、素材来源与许可；`simulation_data:false` |
| `location_mapping.json` | 调度器地点 ID 对应、匹配方法、歧义处理与示意标记，独立于人物数据 |
| `landcover.json` | 地表几何与来源，供三维显示层使用 |
| `manifest.json` | bundle schema、campus_id、各输出文件 SHA-256；读取方可检测不完整或混版输出 |

CLI 成功返回 0，输入内容校验失败返回 1，并在 stderr 输出 `{"error":"stable_code","message":"..."}`；命令行参数用法错误遵循 argparse 的返回码 2。典型错误包括 `invalid_bbox`、`invalid_coordinate`、`invalid_polygon`、`invalid_height`、`duplicate_feature_id`、`duplicate_location_id`、`unsupported_crs`、`source_hash_mismatch`、`no_prototype_match`、`node_coordinate_conflict`。失败的输入不会覆盖现有场景输出。缺少官方响应的完整建筑关系会明确列入 `warnings` 后跳过，不虚构闭合轮廓；不会自动修复任意复杂 GIS 自相交或重叠孔洞，调用方仍应提供有效拓扑。

## 中科大兼容回归

通用默认路径不含中科大特判。为保证之前已验收的边界、排序、默认高度、节点和元数据完全一致，提供明确的输入兼容 profile：

```powershell
python -X utf8 -m adapter.scene_builder osm --osm data/osm/ustc_gaoxin.osm --metadata data/osm/ustc_gaoxin.metadata.json --profile ustc_legacy --campus-id ustc_gaoxin_osm --output-dir logs/asset-library/ustc-regression
```

该 profile **重新读取原始 OSM/XML 并调用原转换适配器**，不返回预存 `scene/campus3d.json`；测试既 deepEqual 比较原场景，也用临时修改原始高度、更新哈希证明生成结果确实来自输入。兼容 profile 保留原场景 ID/标题/默认值，不因新素材目录改写已验收数据；随后同样输出素材分配与说明。原脚本继续作为兼容入口，不影响现有启动与已有测试。

## 待与调度器负责人确认

1. 地图如何交接：文件路径/上传对象/服务接口，何时生成稳定 `campus_id` 与输入版本。
2. `location_id` 的命名、稳定性、多栋楼与同一语义地点的关系；名称匹配结果由谁确认。
3. 道路共享节点、layer/楼层、门口接入点、门禁与可达性由谁提供；当前图只忠实使用显式顶点。
4. 模拟空间状态是否由后端持有，agent 位置、移动动作与环境反馈协议另行定义；本文件不默认地图移动参与决策。
5. 调度器提供的 GeoJSON 使用权、署名和保存期限，以及是否允许保留原输入与哈希用于复现。
6. 原型风格、种子、缺省高度等参数的配置归属；真实高度缺失时是否接受当前展示默认值。
