# M15 第二批：按场景结果显示三维与 GIS

本批让显示程序读取第一批已经算好的 SceneResult。显示程序只核对和展示，不重新决定人物或门店放在哪栋楼。第一批的格式、校验器和 Python 安置程序没有修改。

## 做了什么

- 新增按 `map_ref` 读取地图的模块：先核对 manifest 的文件字节哈希，再核对地图身份、素材版本和所有地图文件的哈希。缺图、文件被改、版本不符或质量不是 `ready` 时明确报错，不换成中科大。
- 配置预览、终态回放和 M14 实时共用 SceneResult 安置。人物默认地点与经营者门店分别记录，路线使用指定的买家入口和门店入口。
- 三维和 GIS 使用同一套人数与运动逻辑。场景外人物保留在人物、关系和事件数据中，计入总人数，但不在地图生成位置。场景外门店也保留在安置列表。
- 同楼多店保留每个服务点，地图标签列出全部品牌名；“安置与依据”可展开查看人物、门店的理由、证据来源与原样假设。
- `mode=none` 不读取地图和素材，不创建三维或 GIS 画布；仍可看人物、关系和事件。配置预览事件为零，回放展示输入记录，实时展示已接收的合成批次。
- 新增仅开发模式可用的本地文件入口。没有增加团队 API 请求，没有接入尚未批准的 scene 契约。

## 本地入口怎么用

在已有开发服务中打开 `/mecoffe3d?scene=local` 或 `/mecoffe-gis?scene=local`。该参数只在 Vite 开发模式生效，Pages 和 embed 构建不会启用此入口。

1. 在“地图库根目录”选择 `frontend/tests/fixtures/scene-render/maps`。选择包含地图 ID 子目录的根目录，不选单张地图的版本目录。
2. 在“SceneResult 与模拟输入”选择同一夹具目录中的 `input-a.json`。
3. 用“GIS 地图 / 三维沙盘”切换视图，用展示模式切换配置预览、终态回放、M14 实时。实时模式的按钮只应用文件中的合成事件，不运行引擎、不请求团队后台。
4. 导入 `input-b.json` 验证另一张地图的标题和几何；导入 `input-none.json` 验证纯网络模式。

导入包是开发适配层，包含 `scene_result`、`config_id`、`snapshot`、`plan`、`roles`；回放还需要 `trajectory`，实时还需要 `live.bootstrap` 与 `live.pages`。这些包装字段不是团队已经批准的接口。快照、计划仍用现有团队数据结构，SceneResult 仍为 `scene.result.v1`。

文件只在当前浏览器标签页内存中保留，切换三维/GIS 时复用，合成实时模式也保留已确认批次数；刷新后重新选择，不写浏览器持久存储，也不上传文件。文件读取与地图加载有取消和版本标记，旧加载不能覆盖新选择。

夹具 A 是完全合成的 6 栋楼地图。夹具 B 使用仓库中科大公开几何副本，并带明确标为合成的餐饮用途补注；它不能证明现实中的餐饮用途。两份人口、品牌和行为均来自现有合成测试输入。两张地图均设为 7 人，其中 5 人在图、2 人场景外；两家店同楼，另一家店在场景外，经营者默认地点与门店分开。

重新生成夹具：`node scripts/generate-m15-render-fixtures.cjs`。只读仓库既有公开几何和合成输入，无下载。输出使用 UTF-8/LF；地图夹具在 `.gitattributes` 中保留精确字节，避免检出换行改变哈希。

## 显示程序需要的地图 manifest 字段草案

这是与拆分打包负责人对齐的草案，未改变 SceneResult v1，也不是部署批准。

目录：`<mapsBase>/<map_id>/<map_version>/manifest.json`。`mapsBase` 为受控同源绝对路径，加载器默认 `/scene-maps/`；本地导入适配器使用内存文件目录。ID 和版本暂用 1–64 个 ASCII 字母、数字、点、下划线、连字符，首字符为字母或数字。

| 字段 | 本批要求 |
| --- | --- |
| `schema_version` | `scene.map-manifest.v1` |
| `map_id`、`map_version` | 与 SceneResult 的 `map_ref` 完全一致 |
| `title` | 非空中文或其他文字标题，三维与 GIS 均显示它 |
| `asset_library_version` | 当前支持 `bundled-v1`，即现有随显示程序提供的素材库 |
| `catalog_sha256` | 建图所用 catalog 的原始文件 SHA-256，与当前素材 catalog 字节摘要完全一致 |
| `files` | 对象，键为下面允许的相对文件名，值为该文件原始字节的 64 位小写 SHA-256 |
| `style` | 可选；沿用现有显示样式字段，不另立素材加载规则；缺省为 procedural/campus |

必需文件共 12 个：

```text
campus3d.json
entrances.json
landcover.json
asset_assignments.json
quality.json
gis/buildings.geojson
gis/roads.geojson
gis/landcover.geojson
gis/water.geojson
gis/boundary.geojson
gis/pois.geojson
gis/entrances.geojson
```

另外只允许可选的 `surroundings.json`。未提供时只在内存中补空道路，不改地图包。清单不包含人口、安置结果、关系或轨迹，避免把某次实验写进共用地图。

`campus3d.json` 与 `entrances.json` 需要保留第一批附加的用途证据、`scene_eligible` 和 `scene_reachable` 信息；楼栋/入口 ID 必须能被 SceneResult 引用。`quality.json.status` 必须是 `ready`。GIS 文件保持现有 GeoJSON 图层结构，楼栋要素 ID 与楼栋 ID 一致。

manifest 本身按**文件原始字节**求 SHA-256，并与 `map_ref.manifest_sha256` 比较，不采用 SceneResult 的规范化 JSON 算法。SceneResult 则继续使用第一批的规范化 JSON 哈希。清单不自存自己的哈希，避免循环引用。

错误包括 `INVALID_MAP_REF`、`INVALID_MAP_BASE`、`MAP_FILE_MISSING`、`MAP_HASH_MISMATCH`、`INVALID_MAP_JSON`、`MAP_VERSION_MISMATCH`、`INVALID_MAP_MANIFEST`、`ASSET_VERSION_MISMATCH`、`MAP_NOT_READY`；来源引用或安置引用不符沿用第一批的 `REF_MISMATCH`。每种失败均停止当前地图展示。

## legacy 兼容规则

现有 `loadConfigMap` 保留为明确的中科大 legacy 路径。当前团队没有 SceneResult 时，配置预览、终态回放和 M14 实时继续用它；页面说明“未提供 SceneResult，使用中科大 legacy 展示路径”。历史场景、素材匹配、旧 kind 和旧打包内容均沿用原行为。

新的 `loadSceneMap` 不调用 `loadConfigMap`。一旦用户明确提供 SceneResult，校验或加载失败就显示错误，不能切回中科大。显示前核对 config、snapshot、plan 的 ID/修订号，以及地图引用、楼栋、入口和证据来源。

`readOptionalSceneResult` 是未来同源 scene 只读接口的预留点，目前默认入口不会调用。它仅在 404 时返回带说明的 legacy 状态，401 等其他错误不会吞掉。真实远程读取和运行绑定需等上游契约确认后接入。

没有修改 `frontend/embed/build-tools.mjs`，没有修改 build:embed 的产物组成规则。新地图只放测试夹具目录，没有加入 public、Pages 或 embed。当前 embed 构建仍为 242 文件，约 113.82 MB。静态产物中未找到本地开发入口或本地地图适配路径。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -s adapter -p "test_*.py"` | 108 通过 |
| `npm --prefix frontend test` | 375 通过，含新增 8 项场景显示测试 |
| `node scripts/test-scene-render.cjs` | 通过，两张地图、三种模式、两种视图、场景外、同楼多店、门店入口路线、none 无画布、缺图不回退 |
| `npm --prefix frontend run build:embed` | 通过 |
| `npm --prefix frontend run build:pages` | 通过，为静态页面回归准备新产物 |
| `node scripts/test-config-preview.cjs` | 通过 |
| `node scripts/test-live-run.cjs` | 通过 |
| `node scripts/test-run-replay.cjs` | 通过；M14 起即过期的断言在本批同步，业务实现不变 |
| `node scripts/test-run-replay.cjs --embed` | 通过；严格静态 `/scene/` 路径下执行相同检查 |
| `node scripts/test-gis.cjs --pages` | 通过，离线模式，未启用在线底图测试 |
| `node scripts/test-pages.cjs` | 通过，11 个路由及刷新、慢网可操作性、本地素材保留 |
| `node scripts/audit-public.cjs` | 通过，发现 0；合成角色包明确标记 synthetic，没有放宽审计规则 |

单元测试覆盖 manifest 真实摘要、缺文件、文件/清单哈希不符、地图版本、素材版本/catalog 不符、越界文件名、source_refs 不符、none、场景外人数、全部服务点、同楼多店完整品牌标签、三种模式共用安置、服务点路线和预留接口 404。新增浏览器测试阻止所有外部 HTTP 与团队 API 请求，实际外部请求、API 请求和页面异常均为零。

另外直接读取 Git 暂存区字节，核对两份 manifest 和 24 个地图文件摘要，全部一致；不只检查当前工作目录副本。

## 旧回放脚本在本批同步

M14（`ab17838`）改为先轮询运行详情，再由 `loadRunReplay` 独立核对终态详情。旧脚本仍截取前六次请求，并把 running 当作不支持，断言从 M14 起即过期；验收方已在 D 之前的 `af7d267` 基线上独立复现。此批只同步测试脚本，业务实现不迁就旧断言。

- 首次终态加载及页面刷新：比较该阶段的**全部** API 调用。run 详情恰好两次，trajectory、population-snapshot、artifacts/plan、stages/plan、stages/roles 各一次；全部 GET，不允许其他路径，scene/bootstrap 与 scene/events 均为零。第一条必须是 run 详情，三项产物请求在它之后，stages/plan 必须晚于 artifacts/plan 的实际 404 响应。
- 三维/GIS 切换：M14 原有标签页内存会复用已核对的终态输入，所以分别精确检查**零**新请求；刷新重新按七次请求核对，不改成“至少包含某些接口”。
- running 且旧后端的 scene/bootstrap 返回 404：显示明确的等待提示，不显示错误页、地图、人物或订单。只允许 run 详情与 bootstrap；出现等待提示后继续观察五秒，累计详情轮询限定 2–4 次，相邻请求至少间隔 1.5 秒，bootstrap 恰好一次。此轮本地和 embed 都观察到三次详情轮询。
- 401、404、快照版本不符、引擎不符的原错误内容、无画布和无导入界面检查全部保留。提示定位适配 M14 已有的状态面板，401 仍检查清空页面后的登录错误。失败部分回放继续显示，核对 1/2 步的部分记录提示、两笔实际订单和无导入界面。

三份自建合成输入的裸 `roles` 与 `live.bootstrap.roles` 均在 `population_request` **同级**放置 `synthetic: true`，未把它作为角色写入请求。解析继续使用现有校验器；预览、实时和公开审计一并复跑，不改审计规则、不加白名单。

本地与 embed 回放的分阶段请求计数、响应状态及截图分别在 `logs/milestone11/remote-local-qa.json`、`remote-embed-qa.json` 和同目录 PNG；完整命令日志在 `logs/m15-render-run-replay*.log`。

本机截图与报告放在 `logs/milestone15-render/`，不进入公开产物：

- `a-three-config.png`、`a-gis-config.png`：合成地图甲及完整安置依据。
- `a-purchase-service-route.png`、`a-live-confirmed.png`：购买走向独立服务点、实时确认事件。
- `b-three-config.png`、`b-gis-config.png`：第二张公开几何测试副本。
- `none-three.png`、`none-gis.png`、`none-live-events.png`：无画布及纯网络事件。
- `missing-map-no-fallback.png`：缺图错误而非中科大。
- `qa.json`：新增场景浏览器验收报告。其余命令日志为 `logs/m15-render-*.log`。

## 限制与需确认的事项

- 上游契约负责人：SceneResult 的远程读取地址、stage 包装形式、运行冻结绑定如何提供。此批没有假定这些接口已经获批。
- 后端负责人：地图库同源挂载前缀、访问权限、不可变版本和缓存/保留策略。本批未连接服务器、未部署。
- 拆分打包负责人：确认上述 manifest 草案、catalog 精确字节摘要、素材库版本命名；后续分离素材库时，接入真实可用版本描述器，替代本批的 `bundled-v1` 适配器。未实现外置人物/建筑素材库。
- 地图维护者：审核真实用途补注。中科大归档没有严格餐饮证据；测试补注不可转为生产事实。
- 纯网络模式目前提供可核对的文字人物、关系和事件列表；没有新增独立关系图编辑器。实时按钮仅用于本地合成批次验收，真实轮询仍沿用现有 M14 入口，等待 scene 契约接入。
