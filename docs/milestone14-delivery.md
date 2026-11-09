# 里程碑14交付：受限混合实时展示与整页嵌入

日期：2026-11-09。分支 `feat/live-run`，基线 `33908e2`。仅本地提交，未push、未改main、未发Release、未访问团队服务器。下周展示仍使用团队已部署的33908e2。本分支何时发布由用户和Claude决定。

## 已实现

- 现有 `session + run` 入口自动区分实时与终态。新增提议路径集中在 `LIVE_API_PATHS`，冻结输入严格校验；没有实时接口时明确降级等待终态，不展示空结果冒充成功。
- 2秒非重叠轮询、15秒单请求超时、4→8→…→30秒退避；只在当前标签页内存共享运行，三维/GIS切换保留游标和暂停状态。401清私有场景，恢复后可以重读。
- 按稳定来源去重，白名单快报与固定日汇总分离。待核对购买仅提示，不计销量、不取杯；证据确认后升级同一事件，缺单标未核实。被拒、未知、失败不算成功。
- 地图和模型不因轮询重建；快报动画队列最多32项、同人最多2项；人物内部待执行行走也最多2项，保留当前walker和全部已确认统计。暂停只暂停画面，跟随最新可丢弃积压动画。
- 先读完终态尾流再严格读取三个正式产物；409继续等待。冻结版本、订单等校验不放宽，正式记录优先，计数差异有提示，失败保留部分结果。
- 整页容器跟随iframe实际高度，移除嵌入模式的650/520px硬下限；宽度≤900px详情折叠。修正父级高度链，验收同时检查真实内容边界，不能只靠隐藏溢出掩盖裁剪。
- 位置、楼栋和路线继续标为示意；原历史回放、NUS、素材库、来源许可和配置预览行为保留。

## 改动文件

实时核心与展示：

- `frontend/src/mecoffe/liveRun.js`、`liveRunStore.js`、`liveRender.js`
- `frontend/src/components/LiveRunPanel.vue`
- `frontend/src/views/ConfigPreviewEntry.vue`、`EmbeddedSceneEntry.vue`
- `frontend/src/views/MeCoffe3D.vue`、`MeCoffeGis.vue`
- `frontend/src/mecoffe/Campus3DScene.js`、`gis/MapLibreScene.js`、`gis/replay.js`、`replay.js`

验证与说明：

- `frontend/tests/liveRun.test.js`、`liveRender.test.js`、`livePresentation.test.js`
- `scripts/test-live-run.cjs`、`scripts/lib/live-fixture.cjs`
- `docs/live-run-contract.md`、`social-sim-integration.md`、`scene-integration-checklist.md`、本文

未改依赖、原始地图、人物、OASIS事件或地点映射。日志与截图在被忽略的logs目录，不提交。

## 测试和构建

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -s adapter -p 'test_*.py'` | 90项通过。负例的校验错误输出为预期行为。 |
| `npm --prefix frontend test` | 333项通过，0失败、0跳过。 |
| `npm --prefix frontend run build` | 通过。 |
| `npm --prefix frontend run build:pages` | 通过。 |
| `npm --prefix frontend run check:pages` | 通过。 |
| `npm --prefix frontend run build:embed` | 通过，约113.79MB、242文件；只含允许的程序、素材、地图和明确合成样例。 |
| `node scripts/audit-public.cjs` | 通过，findings为空，含现有Pages与embed产物。 |
| `node scripts/test-live-run.cjs` | 通过，本机5194严格静态托管及真正整页iframe；无页面异常、资源404、意外API或外部请求。 |
| `node scripts/test-pages.cjs` | 通过，原公开页面直接打开/刷新、资源与素材库回归。 |
| `node scripts/test-gis.cjs --pages` | 通过，中科大/NUS及通用场景GIS回归。 |
| `node scripts/test-milestone11.cjs --embed` | 通过，一次导入、ZIP、一键样例、中文属性、配置预览与通用终态回放回归。 |

构建仍有现有的较大chunk及import-attributes警告，无构建错误。测试没有读取团队私有样例、登录团队服务器或改动5180服务。

实时合成验收覆盖：分批和重复页、pending→verified、汇总缺单、declined/unknown、失败部分结果、网络恢复、401清除与恢复、404/409、无接口降级、尾流和正式回放切换、两视图同计数和暂停状态、画布身份不变。纯函数测试还覆盖汇总先于动作、冲突拒绝、超时、迟到请求以及101笔同人购买的有界内部队列。

## 截图和报告（本地）

目录：`logs/milestone14/`。`browser-qa.json` 为合成浏览器验收报告。

| 内容 | 文件 |
| --- | --- |
| 宽屏整页、运行中与待核对订单 | `3d-live-pending-wide.png` |
| 日汇总核实后 | `3d-day-summary-confirmed.png` |
| GIS共享状态与暂停 | `gis-live-shared-paused.png` |
| 窄屏及详情折叠 | `3d-narrow-full-page.png`、`3d-narrow-details.png`、`gis-narrow-details.png` |
| 矮窗口 | `3d-short-full-page.png`、`gis-short-full-page.png` |
| 失败保留部分结果 | `failed-partial-keeps-confirmed.png` |
| 无接口降级及随后自动转终态 | `missing-live-api-fallback.png`、`missing-api-automatic-terminal.png` |
| 正式产物等待与切换后 | `terminal-artifacts-wait.png`、`terminal-strict-replay.png` |
| 接口错误 | `events-401.png`、`events-404.png`、`events-409.png`、`network.png` |

实际iframe验收尺寸：1600×1000、820×650、1100×500（含父页面32px导航）。检查两层文档无滚动、根内容与地图底部均在视口内，地图可用区域不被裁掉。

## C：团队后端参考补丁（公开仓库之外）

已在仓库外handoff目录生成 `0001-feat-scene.patch`，没有将补丁或后端代码放入本仓库和构建产物。独立工作副本 `social-sim-live`，分支 `feat/scene-live-events`，精确基线301fca1a560e2e693497ce589e22097e285e38c7，参考提交5d3429030fbe1048c45535845b74b9435d625367。未push。

补丁SHA-256：`F6A0C602903AFBD77C7B6BF6B153AAFAD9560EC2062EC1A4A5DC8D077EEF93AE`。

包含两个只读接口、归属及注册目录边界、完整JSONL行分页、ID映射与outcome、引擎每步结束的固定日汇总钩子。失败停止后的残缺末行返回明确警告并允许done，避免永远无法切正式部分回放；完整成功运行有残行则409报完整性问题。

标准库参考测试17项：16通过，1项因Windows创建符号链接权限跳过。另附4项FastAPI权限集成测试，**未执行**；当前Windows环境没有团队的Linux/fcntl运行条件。该补丁是待审参考，学弟须在Linux按补丁文档执行API及全量测试，mwbhorse须审查引擎日末钩子后才能考虑合并，不能把本地标准库通过写成团队API已联调成功。

## 接口与待确认

完整字段见 [实时接口草案](live-run-contract.md)：bootstrap提供本次冻结快照、计划、业务/引擎/配置编号、版本与状态；events提供稳定来源、结果明确的白名单快报、completed_step、active_step、固定逐日日汇总、next_cursor及done。订单推荐携带完整证据，不能只给order_id而省略金额、数量等后又声称已核实。

仍需Alemax067确认路径、字段、轮询限流及运行页入口；团队须提供固定日汇总，不用下一天的数据库当前计数充上一天；地图选择仍沿现有固定中科大接入，并非自动按任意地名生成地图。旧运行没有新日汇总时不补造数据，正式终态回放仍可使用。

未在真实团队运行验证实时展示、日志并发和日汇总开销；未验证原生引擎所有社交动作的事务行为。位置与走路动画始终是展示效果，不参与智能体决策。本地模拟验证不替代团队部署后的权限和真实运行验收。
