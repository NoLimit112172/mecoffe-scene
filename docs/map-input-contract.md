# 地图输入接口草案：地图 → 三维场景与素材原型

**草案，待与 OASIS 调度器负责人确认。** 本文定义地图准备模块的文件边界，不表示调度器已经实现或接受此协议。人物调度、agent 决策、模拟时间、购买与互动轨迹不由本流水线生成。

## 里程碑 8：场景包 GIS 图层扩展（仍为草案）

`scenario --manifest ...` 在原有米制文件之外输出 `gis/`，不要求调用者重新下载地图。六个文件均为 WGS84 / RFC 7946 GeoJSON FeatureCollection，无旧 crs 字段，坐标固定 `[longitude, latitude]`。数据来自原场景 `projection` 所记录公式的反算；不替换来源、不生成轨迹。

| 文件 | 内容 |
| --- | --- |
| `gis/buildings.geojson` | 原始轮廓及孔洞；name、name_source、category、building_type、height_m、levels、height_source、levels_source、prototype_id、variant_id、location_ids |
| `gis/roads.geojson` | 校内道路及输入显式保存的周边道路；name、highway、walkable、layer、bridge、surrounding。校外道路 walkable 为 false，不加入 A* |
| `gis/landcover.geojson` | 地表轮廓及 category、sport、name |
| `gis/water.geojson` | 水域轮廓；不凭空生成实测深度或地形 |
| `gis/boundary.geojson` | 完整原始校界 MultiPolygon，保留独立区域和孔洞 |
| `gis/pois.geojson` | 输入已有 POI；已有显式 OASIS 映射另以 location/ID 点展示并标 illustrative。没有 POI 时输出空集合 |

每份集合保留 source/attribution/许可和“人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据”。height_source 原样继承；数据中写有高度不等于经过实地测量核验。名称缺失不冒充真实名称。第二阶段底图和第三阶段 POI 自动映射均未启用。

`scenario.json.files` 以 `gis/<layer>.geojson` 为键记录文件字节 SHA-256；Git 保持字节原样。前端 GIS 模式显式加载并校验六份图层，旧沙盘默认不请求它们。场景时间与原 OASIS 轨迹仍使用原字段；没有模拟数据的清单只显示地图。结构说明见 [GIS 架构](gis-architecture.md)。

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

## 场景清单 v1（里程碑 6 草案，待确认）

地图与模拟时钟通过一个清单交接；仍只使用 OSM 或调用方有权提供的 GeoJSON，不生成 agent 决策。

```json
{
  "id": "my-campus-run",
  "title": "校园场景",
  "map": { "type": "bundle", "id": "nus" },
  "simulation_time": {
    "start": "2026-11-03T06:00:00+08:00",
    "timezone": "Asia/Singapore",
    "step_unit": "hour",
    "steps": 24
  },
  "style": { "buildings": "procedural", "characters": "campus" }
}
```

- `id`：1–64 位字母、数字、下划线或短横线，首位为字母或数字；对应输出目录与 URL。
- `map.type`：`bundle` + `id` 读取 campuses 下已生成的场景包，先验证文件哈希；`geojson` + `path` 读取调用方文件；`osm` + `bbox: [west,south,east,north]` 下载并归档官方 OSM，或用 `osm`、`metadata` 路径读取归档。新地图可指定 `campus_id`，默认等于场景 id。只用官方 OSM 数据，不调用高德/Google。
- `map.profile: "ustc_legacy"` 用于原中科大 OSM 兼容转换；可选 `map.landcover` / `map.surroundings` 指向同一地图的地表与校外道路上下文，不能借用其他校区。
- 路径相对清单所在目录，也接受绝对路径。生成的运行清单不暴露本机输入路径。
- `simulation_time` 四字段必填：ISO 日期时间、有效 IANA 时区、`day` / `hour`、整数步数 1–10000。带偏移或 Z 的时刻按同一瞬间转换为声明时区；无偏移按该时区解释。Windows Python 如缺时区库，需要安装 tzdata。
- 可选 `intervals: [{"start":"...","end":"..."}, ...]` 必须恰好 steps 段；首段起点与 start 相同，每段结束晚于开始，递增且不重叠。可选 end 必须等于最后一段结束。默认按日历日/小时生成；夏令时跳变导致的不存在时刻会拒绝，可显式提供有效时间段。
- 进度在各段起止之间线性映射；日期和钟点按声明时区格式化；day 也经历日夜，hour 按实际小时设置光照。
- `location_rules` 指向通用精确名称/标签规则数组，或已验收的 campus3d_mapping 对象。轨迹中每个人的地点必须对应本地图的建筑；不随机补位置。
- `trajectory` 支持归一化 `mecoffe.scene.v1`，或原始 oasis.interaction_trajectory 导出。原始格式必须同时提供 population_snapshot，复用现有 adapter 核对快照编号、版本和人物 ID。归一化回放保持人物、事件、关注关系、订单原值，并验证人物、动作和地点一致性。可选快照不会替换历史关注网络。
- `style.buildings`：procedural / yulan；`style.characters`：campus。没有轨迹时不放置虚构人物，明确显示“尚无模拟数据”，只播放模拟时钟。

```powershell
python -X utf8 -m adapter.scene_builder scenario --manifest scenarios/ustc-history.json
python -X utf8 -m adapter.scene_builder scenario --manifest scenarios/nus-hourly.json
```

输出为 `frontend/public/mecoffe/scenarios/<id>/`：scenario.json、地图、原型分配、地表、可选地点映射/轨迹/快照/校外道路。运行清单记录各文件 SHA-256；页面先验证时间与文件哈希再创建场景，缺失或混版时显示错误与重试入口。

场景目录草案：每次 `scenario` 生成还会扫描所有已准备包，刷新同级 `scenarios/index.json`（`schema_version: mecoffe.scenario-index.v1`）。`scenarios` 每项含 `id`、原清单 `title`、`simulation_data`、清单原始字节的 `manifest_sha256`；`default_id` 必须指向目录内一项。默认按有模拟数据优先、再按 id 稳定排序并取第一项。GIS 下拉框完全读取目录，URL 无 `scenario` 时读取 `default_id`；新增第三个或更多包只需生成目录，不修改 GIS 页面。Pages 验证目录完整性、元数据及清单哈希，目录文件保持原始字节。

仅重建目录（不重写已有场景文件）：`python -m adapter.scene_builder scenario-index`。可选 `--scenario-dir <目录>` 用于其他输出目录，`--default-id <id>` 指定本次目录的默认项。

- `/mecoffe3d?scenario=ustc-history`：复用已有中科大地图、原历史轨迹、原地点映射和地表/道路上下文。完整 23 天、第 24 天部分记录的事实不变，不补造记录。示例的 2026-10-01 是显式展示时间配置，不声称是原运行的真实日期。
- `/mecoffe3d?scenario=nus-hourly`：NUS 226 栋楼、840 段道路，24 小时查看光照，没有模拟轨迹。
- 没有 scenario 参数时，原三种数据模式与二维入口保持原样。

VS Code 任务“MeCoffe：按场景清单搭建场景”提示清单路径，按独立参数调用同一 CLI。调度器只需输出清单，无须改渲染代码。地点命名、step 与日历的关系、时区权威来源仍需团队确认；本契约不是 OASIS 空间状态接口。
