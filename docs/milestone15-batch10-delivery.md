# M15 第十批：团队场景页使用地图阶段结果

本批把团队配置里已经冻结的 SceneResult 接到三维/GIS 嵌入页。预览、实时和回放使用同一份安置；不重新分楼，不修改 SceneResult 正文、引用或哈希。没启用地图就展示人物和活动列表，明确要地图但失败时不回退中科大。

源码基线为 mecoffe-scene `4c2b17f`，分支 `feat/m15-batch10-scene-page`。团队仓库只读核对的是本机 `origin/main=dd0cedb`，未 fetch、未修改团队文件；PR #28 的 0.2.0 升级分支只作待合并背景，不作为生产已具备的事实。未推送、未部署、未访问服务器或模型。

## 实际读取的接口和对应关系

现有团队 `SceneButton.tsx` 已传 `session + config` 或 `session + run`，不需要新 URL 参数。

| 数据 | 读取方式及用途 |
|---|---|
| 固定需求版本 | `GET /api/sessions/{session}`，由 `configs[].id` 找配置，再以它的 `scenario_id` 找 `scenarios[].id`，直接检查原始 `content.map`。不取会话最新需求，也不调用会补默认值的 Requirement 解析 |
| 地图产物 | `GET /api/sessions/{session}/configs/{config}/stages/map`，读取 `scene.map-stage.v1` 外壳的 `payload.scene`，接受 SceneResult v2/v3 |
| 配置引用 | 同配置的 `stages/plan` 和 `stages/network`，分别取原始计划及 `payload.snapshot`，复用既有 `checkScenePlacement` |
| 地图文件 | 只用 `payload.scene.map_ref`；`loadSceneMap` 的根路径传 `/api/scene-maps/`，先核对 manifest 摘要，再核对每个列出的文件、地图身份、素材 catalog 和 ready 状态 |
| 终态实际输入 | 既有回放加载器读取 `artifacts/plan`、`artifacts/population-snapshot`、轨迹，并核对真实运行和引擎运行编号 |
| 实时实际输入 | 既有 M14 `scene/bootstrap` 提供实际冻结的 plan/snapshot，`scene/events` 提供活动。团队的 artifacts 接口在 running 时返回 409，所以运行中不能用终态接口代替 bootstrap |

全部请求保留同源登录凭据，不接收外部 API 地址或令牌。地图/catalog 的 401 同样清空场景和活动，停止旧请求及实时内存会话，防止旧通知恢复数据。

团队依据：`backend/app/api/sessions.py`、`schemas/api.py` 的 SessionDetail/ConfigView/ScenarioView、`services/runs.py:require_replay_file`、`oasis/adapter/src/oasis_adapter/scene_live.py:bootstrap`。外壳 `map_id` 是业务阶段身份，不能拿它冒充地图库里的 `scene.map_ref.map_id`。

## 四种页面状态

| 情形 | 页面行为 |
|---|---|
| 明确 map=true，阶段完成且通过校验 | 加载固定 map_ref，显示人物、独立门店、场外人数及安置依据；v3 继续显示主用途/楼内服务。位置和路线均标“示意” |
| 明确 map=false | 显示“这份配置未启用地图”，没有 canvas、没有中科大地图；人物、关系、活动和核实订单继续显示 |
| 明确要地图，但未登记/pending/running/failed，或正文/引用/地图校验失败 | 显示阶段状态及中文原因，无地图；已取得的活动记录仍可查看，可以手动重新读取 |
| 对应需求原文完全没有 map 键 | 才使用 legacy 路径，醒目标“旧版示意场景，未使用地图阶段” |

找不到会话、配置、对应需求版本、stage 返回 404，都不是“旧版”的证据。map 为 null/字符串/数字也不能当 false 或旧版。旧占位需求即便写了 map=true，只要没有合法地图产物，仍按阻塞状态处理。人物快照尚未读到时显示“待取得”，不把它当成真实的零人。

无图活动视图复用原有轨迹校验、订单证据匹配和整数分金额规则；不为生成列表构造假地图或假 none SceneResult。预览没有模拟事件，明确写“尚未运行”。失败/部分运行仍保留真实结果状态。

## 计划修订号：比什么，保留什么

只读核对团队 `oasis/adapter/src/oasis_adapter/service.py:44-59`：`plan_for_current_models` 复制原计划，并且只在模型绑定变化时递增顶层 `plan_revision`。实际模型绑定随后存在 bundle 外层 `model_bindings`，不是 SceneResult 的输入，也不通过场景页读取密钥。

场景侧采用偏严格的规则：**两份完整计划除顶层 plan_revision 外必须完全相同**。因为当前已核实的模型重绑定路径不改变任何其他计划内容，这样可防止把业务改动误当成换模型。

| 检查 | 具体字段和行为 |
|---|---|
| 场景原始引用 | `config_id`、`snapshot_id/revision`、配置 `plan_id/revision` 必须与 SceneResult 完全对应，继续校验原结果和 rules 摘要 |
| 运行人口 | 冻结快照编号/修订相同；每个 `nodes[].entity_id → role` 相同。允许人物数组排序变化，但不允许增删或换角色 |
| 计划身份 | `plan_id` 不同直接阻止落楼；实际修订号必须是正整数 |
| 品牌与经营者 | `economy.brands[].brand_id/owner_entity_id` 相同，`products[].product_name → brand_id` 相同；不一致给出“品牌经营者”或“品牌名称/对应关系”中文原因 |
| 其余完整计划 | schema/capability、scenario、population、policy_registry_version、role_policies、platform、runtime、initial_state、events、observation、economy 及任何额外字段都比较。对象键顺序不影响；数组仍要求原顺序，不把价格、种子、时间、策略等改动放过去 |
| 修订相同 | 内容仍须通过上述校验，不能拿“版本号相同”掩盖被换过的正文 |
| 修订不同、内容一致 | 保留原 SceneResult 和配置计划用于安置；实际计划继续用于运行轨迹与版本校验，显示“运行使用计划修订 N；除修订号外的内容已核对一致，安置沿用配置计划” |

页面说明采用可直接核实的“内容一致”，不凭修订号变化单独声称已读到哪个模型。当前 OASIS 的自动增修订原因已从代码核实为模型重绑定；若其他引擎以后另有增修订规则，需要重新评估。场景页不会改写任何 revision 来迁就结果。

`prepareTeamPresentation` 返回只在内存使用的 placement 上下文；回放构造器会再次核对实际输入，不能只传一个伪造上下文绕过检查。实时只在首次输入就绪时确定安置，后续更新活动；切换三维/GIS继续使用同一结果，不重新哈希分楼。

## 修改位置

- `frontend/src/mecoffe/teamScene.js`：团队需求版本识别、地图阶段读取、引用核对与计划映射。
- `genericReplay.js`：导出不依赖地图的活动整理入口，地图回放支持独立配置安置上下文。
- `liveRun.js`：向既有实时构图函数传同一安置上下文，不改实时事件校验。
- `views/ConfigPreviewEntry.vue`、`components/TeamSceneInfo.vue`：正式团队入口接线和无图/阻塞视图；本地开发导入入口保持原流程。
- 新单测/浏览器接口替身；旧预览、实时、回放脚本补真实形状的 session legacy 响应及精确请求计数；Pages 脚本仅让开发服务地址可配置。没有放宽原断言，不修改旧 JSON 夹具或发布地图。

`sceneResult.js`、三份契约、已发布地图、0.2.0 导出运行包、建图和拆包代码均保持原字节。

## 测试记录

主要结果如下；测试报告与日志在被 git 忽略的 `logs/` 目录。

```text
python -m unittest discover -s adapter -p "test_*.py"
python -m unittest discover -s scripts -p "test_*.py"
npm --prefix frontend test
npm --prefix frontend run build:embed
node scripts/audit-public.cjs
```

| 检查 | 结果 |
|---|---|
| Python adapter 全套 | 164 项通过；使用现有 WSL `scene-m15-test` 的 Python 3.11.15 |
| scripts 打包全套 | 29 项通过 |
| 前端 node:test | 409 项通过，包含本批 14 项团队绑定/无图活动单测 |
| 默认 build:embed | 通过，约 113.87 MB / 243 文件；正式本地导入默认关闭 |
| audit-public | 0 项 |
| prepare-scene-assets --dist | 发布版 catalog 摘要与实际产物相同：`a4444d42…` |
| 新团队浏览器接口联调 | `node scripts/test-team-scene.cjs` 和 `node scripts/test-team-scene.cjs --embed` 各 23 组通过；后者严格静态托管 `/scene/`，不替换产物 catalog |
| 旧实时、配置预览、终态回放 | `test-live-run.cjs`、`test-config-preview.cjs --embed`、`test-run-replay.cjs --embed` 通过 |
| 原本地 SceneResult 三维/GIS | `test-scene-render.cjs` 通过 |
| 严格静态 embed 本地入口矩阵 | `test-scene-render-embed.cjs` 通过：默认关闭、显式开启、最后恢复默认关闭 |
| Pages GIS | `npm --prefix frontend run build:pages`、`node scripts/test-gis.cjs --pages` 通过 |
| Pages 整页与开发素材 | 设置 `MECOFFE_TEST_DEV_ORIGIN=http://127.0.0.1:5212` 后运行 `node scripts/test-pages.cjs` 通过；11 个静态页面、刷新、慢网操作及开发素材保留断言均通过 |

Windows 的 `hello-agents` 3.11 环境没有 Pillow，不能用它收集完整 adapter 测试，因此改用已有 WSL 环境，未安装依赖或改变业务代码。Windows 检出带 CRLF；涉及历史原字节比较时，WSL 子进程仅临时传入 `GIT_CONFIG_COUNT=1 / GIT_CONFIG_KEY_0=core.autocrlf / GIT_CONFIG_VALUE_0=true`，让 Git 历史读取沿用 Windows 检出的过滤行为。没有改仓库或全局 Git 配置，没有改地图或基准断言。

专项报告：`logs/milestone15-team-scene/qa.json` 和 `qa-embed.json`，记录每组 API 调用、人数与场外人数、订单金额、零外部请求及零页面错误。正式产物截图包括 `embed-v2-config-three.png`、`embed-v2-live-gis.png`、`embed-none-config-three.png`、`embed-none-replay-gis-orders.png`。已查看三维与无图页面截图。v3 的旧编译夹具缺少渲染所需的道路边长，浏览器替身只在内存建立新身份 `synthetic-taxonomy-render` 并补齐边长、重新登记摘要；不改旧夹具，不放宽生产校验。

测试使用合成团队接口和现有公开几何，阻断外部网络；没有访问真实团队服务。新增覆盖 v2/v3、明确 none、阶段失败/未完成/缺失、旧版、同/不同修订、经营者变化、plan_id 不同、地图字节篡改、无图仍有活动订单，以及三种模式与两视图安置一致。旧夹具只读后在内存构造新输入，不改原字节。

注意：团队场景入口新增 session 详情请求，所以旧浏览器脚本的精确调用次数要增加这一次读取，不能为了维持旧次数跳过需求判断；其余 GET 路径、次数、无画布和鉴权检查继续严格验证。

`test-pages.cjs` 的开发素材检查新增可选 `MECOFFE_TEST_DEV_ORIGIN`（默认仍为 5180）。本机用独立 Vite 5212 执行相同素材断言；不启动、关闭或占用 5180，也不跳过该项检查。

本批同步修正一处真实重试问题：401 后清空实时会话，再点击实时面板“重新读取”时，显式重建并重新鉴权；没有用户点击时不恢复数据或轮询。旧实时回归验证手动重试，新专项验证地图 401 后 2.5 秒内不复活场景或继续请求。

## 同步到团队仓库的清单（本批只列，不执行）

1. 验收通过后，以本批提交运行默认 `build:embed`；再由现有 `build:split` 生成配套显示程序/素材/地图产物，复核 catalog 与 release-lock，保持正式本地导入默认关闭。
2. 用新显示程序更新团队现有 `/scene/` 嵌入静态资源；地图接口继续读取团队仓库已经保存的固定版本，不覆盖同编号地图、不丢旧版本。本批不需要同步或升级 0.2.0 运行包。
3. **预览与终态回放的团队前端接线不用改**：SceneButton 已传 session/config 或 session/run，API 字段足够。
4. **运行中按钮仍是团队待补项**：目前 `Workbench.tsx` 在 running/queued 时仅显示 RunProgress，SceneButton 只由终态 ResultsPanel 提供。本批用现有 `session + run` URL 验收实时嵌入页；若要用户运行中直接点开，需要团队另在进度区复用 SceneButton（不涉及新后端接口）。这是新增入口清单，不在本批修改。
5. 真实服务联调时检查同源登录、401、静态资源及地图只读接口可达；以旧配置、明确不用地图、新地图配置各一份回放验收。真实服务器/模型本批未验证。
