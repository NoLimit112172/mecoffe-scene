# 里程碑 11 交付：预览易用性与通用回放准备

## 范围与状态

- 基线：main `4aae142`；开发分支 `feat/replay-generic`。仅本地提交，不推送，不修改 social-sim。
- 既有公开历史数据、场景包、映射和 A* 道路图未改动，未新增依赖。
- 本轮仅用明确合成的数据和同源 API mock 验证。未访问团队服务器，未导入或复制团队私有样例。
- 人物位置、入口、楼内停留和行走路线继续为展示示意，OASIS 没有位置数据。

## 已完成

1. 静态属性已知取值中文化，未知取值保留原样；“数据详情”保留原始 key 和 JSON 值。生成字段仍优先使用 `GeneratedField.title`。
2. 关系线近景维持 2.8 CSS 像素 / 0.55 透明度，远景渐变至 4.2 像素 / 0.79，关闭辅助线的雾衰减；复用缓冲区，暂停且画面不变时仍不渲染。
3. 本地改为一个多选输入，支持拖放、普通 ZIP（stored / deflate）、按内容识别；配置预览只需快照，角色字段和安置规则可选。新增一键配置和回放合成样例。
4. `/scene/` 无参数显示接入说明，“开发者调试”默认折叠；带 session/config 或 session/run 时不显示导入表单。视图切换保留同一个输入，刷新本地导入则需重新选择。
5. 新增团队格式通用回放适配：任意角色、品牌到经营者再到示意楼栋、多品牌、成功订单证据核对、计划/快照版本核对。Python 可选 `--plan` 路径和前端各有测试，旧无计划转换输出与基线逐字节相同。
6. `executed` 才进入成功结果。`declined / unknown / failed` 保留不同事件状态，不增加成功帖子、订单或咖啡行走动画。共享运动状态保证三维与 GIS 同一回放位置人数一致。
7. 远程运行数据源按草案读取运行详情、冻结轨迹、冻结快照和该次配置计划；处理运行未结束、401、404、失败部分记录、错运行和错版本。
8. 审计新增原始轨迹、计划、通用回放数据检查；既有获准公开数据按内容摘要保留，新合成样例有明确标记和合成人名。

## 合成验收数据

| 项目 | 输入与显示结果 |
| --- | --- |
| 人物 | 7 |
| 角色 | visitor、operator、research（非 MeCoffe 四角色） |
| 初始关系 | 4（3 条关注、1 条竞争） |
| 品牌 | 3：brand_alpha、brand_beta、brand_gamma |
| 展示事件 | 9，另有 1 条 noop |
| 成功订单 / 金额 | 2 / 2190 分 |
| 被拒 / 未知 / 失败 | 各 1 |

真实中科大公开地图上的运动单测验证了三个经营者的显式楼栋分配、路线终点是对应楼的唯一门；成功购买完成进店取杯返家，被拒人物无队列、无杯。100 个采样位置满足室外 + 楼内 = 7；沙盘与 GIS 10 个正反向定位的坐标和人数逐项一致。没有编造真实 OASIS 运行。

## 改动文件

- Python：`adapter/oasis_to_scene.py`、`adapter/test_generic_replay.py`。
- 导入与属性：`configPreview.js`、`previewImport.js`、`staticAttributeValues.js`、`configPreviewStore.js`，以及 `ConfigImportPanel.vue`、`ConfigProfileFields.vue`。
- 回放与地图：`genericReplay.js`、`replay.js`、`indoorMotion.js`、`campus3dRouting.js`、`characterDisplay.js`、`Campus3DAnnotations.js`、`Campus3DScene.js`、`Campus3DIndoor.js`、`gis/replay.js`。
- 入口与视图：`ConfigPreviewEntry.vue`、`EmbeddedSceneEntry.vue`、`MeCoffe3D.vue`、`MeCoffeGis.vue`、`embed-main.js`、`embed/embed-plugin.mjs`。
- 测试：合成 `fixtures/generic-replay/{snapshot,trajectory,plan}.json`，`genericReplay.test.js`、`previewImport.test.js`、`staticAttributeValues.test.js`、`relationStyle.test.js`、`replayPrivacyAudit.test.js`。
- 审计/浏览器：`scripts/audit-public.cjs`、`scripts/test-config-preview.cjs`、新增 `scripts/test-milestone11.cjs`、`scripts/test-run-replay.cjs`。
- 文档：`README.md`、`docs/social-sim-integration.md`、本交付说明。

前端源文件均位于 `frontend/src/`，测试位于 `frontend/tests/`。完整列表可用 `git show --stat` 查看。

## 验证结果

本地测试、构建及浏览器验收结果如下。

| 命令 | 结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 90 项通过 |
| `npm --prefix frontend test` | 265 项通过 |
| `npm --prefix frontend run build` | 通过 |
| `npm --prefix frontend run build:pages` | 通过 |
| `npm --prefix frontend run check:pages` | 通过 |
| `npm --prefix frontend run build:embed` | 通过；113.73 MB / 242 文件，仅合成样例，无私有运行或配置 |
| `node scripts/audit-public.cjs` | 通过，findings=[] |
| `node scripts/test-config-preview.cjs` | 通过 |
| `node scripts/test-config-preview.cjs --embed` | 通过 |
| `node scripts/test-milestone11.cjs` | 通过 |
| `node scripts/test-milestone11.cjs --embed` | 通过 |
| `node scripts/test-run-replay.cjs` | 通过 |
| `node scripts/test-run-replay.cjs --embed` | 通过 |
| `node scripts/test-pages.cjs` | 通过；11 条路由打开及刷新，慢网首屏 15,463 ms |
| `node scripts/test-gis.cjs --pages` | 通过；中科大 / NUS / 临时第三场景、切换和移动视口 |

Pages 与 embed 均由严格静态服务器验证真实目录入口和刷新，不靠服务端页面回退。浏览器异常与非预期 404 请求列表均为空。浏览器尺寸 1600×1000。构建仅保留已有的大块体积提示和原城市地图模块的动态/静态混合导入提示，不影响成功结果。

GIS 回归性能（MapLibre render 事件间隔）：中科大全景 88.87 FPS / 最差 17.9 ms / 主线程 heap 58.58 MiB，NUS 80 FPS / 最差 14.5 ms / heap 38.73 MiB。近景段为 86.61 FPS / 17.8 ms，但采样末尾人物已入楼、可见模型数为 0，不能据此声称持续近景模型负载性能。浏览器 RAF 约 240 Hz，与地图渲染 FPS 口径不同；数字只代表本机这次回归。

## 截图与本地证据

截图不提交 Git，保存在 `logs/milestone11/`：

- `local-import-interface.png`：一次导入与用途说明。
- `embed-embed-welcome.png`：嵌入版无参数说明。
- `local-chinese-profile.png`：中文属性值；原始属性可展开。
- `local-overview-relationships.png`：三维全景关系线。
- `local-3d-generic-replay.png`、`local-gis-generic-replay.png`：双页通用回放。
- `local-declined-event.png`：未知、被拒和成功购买分别显示。
- `remote-embed-3d-overview.png`、`remote-embed-gis-replay.png`：同源运行接口 mock。

对应 QA JSON 记录每项检查和错误列表。旧公开页面回归证据仍写入各自 `logs/milestone7/`、`logs/milestone8/`；全量测试与构建日志为 `logs/milestone11-*.txt`。

## 已知边界与团队待办

- 两个新产物接口仍是草案，尚未连接真实服务器或真实终态 OASIS 运行。
- 地图仍使用安全的中科大固定几何包；安置和行走仅展示。没有显式安置规则时沿用按 seed/角色的可复现分配，不按画像或姓名推断住处；同角色可以同楼，同楼可有多个品牌。
- 计划没有真实起始日期时，界面明确日期为展示设定；不将其当作引擎真实时间。日期按声明时区格式化，避免 UTC 造成前一天日期。
- ZIP 仅支持普通未加密 stored / deflate，单文件 16 MB、累计 32 MB、最多 32 个文件；不支持的浏览器可解压后多选 JSON。
- 多品牌归属证据不足时明确报错，不猜品牌。原始字段缺少中文 title 时保留 key。

学弟在 social-sim 侧需要确认并实现：

1. 同源 `/scene/` 静态挂载与配置/结果页 iframe 入口，保留团队登录 Cookie；session/config 用于配置预览，session/run 用于运行回放。
2. 两个只读产物接口：`.../artifacts/trajectory`、`.../artifacts/population-snapshot`。检查当前用户、会话及运行归属；仅终态开放轨迹，快照取本次运行冻结版本，不返回当前可变 network 数据。
3. 运行详情能返回本次 `config_id`，若能返回引擎运行编号也提供 `engine_run_id`；对应计划应仍是本次冻结版本。前端会检查快照 ID/revision 和计划 ID/revision，一旦不一致即停止加载。
4. 与 Alemax067 确认接口路径、未就绪状态码（草案 409）和终态状态值，然后用一份获准本地联调的终态轨迹验收。团队数据及截图留在私有目录，不进入公开 Pages 或 embed 静态目录。
