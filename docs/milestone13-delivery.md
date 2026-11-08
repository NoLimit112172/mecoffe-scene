# 里程碑 13 交付记录

基线 `29fc972`，分支 `fix/http-and-frozen-plan`。只在 mecoffe-scene 本地提交，不推送、不修改 main 或 social-sim、不登录团队服务器；5180 原服务保持 PID 51228。

## 修复

1. 新增无依赖、自行实现的 SHA-256，统一入口 `sha256Hex(bytes)`。Web Crypto 可用时优先使用，否则按同一字节执行纯 JS 实现。配置地图和公开场景加载器都保留所有哈希校验。
2. 回放优先读取运行的 `artifacts/plan` 原始计划对象，避免模型绑定调整产生的新计划修订版与配置阶段旧计划混淆。只在该接口 404 时兼容配置计划，且仍严格校验快照、计划编号与 revision、人口和轨迹一致性。
3. 旧后端回退计划不一致时，显示“团队后端需要提供该次运行冻结的计划接口”。冻结接口 401/409/500、网络或 JSON 错误不触发旧计划回退。里程碑 12 可选角色说明的优先级、降级和取消规则不变。

新增/修改文件：

- `frontend/src/mecoffe/sha256.js`
- `frontend/src/mecoffe/configMap.js`
- `frontend/src/mecoffe/scenario.js`
- `frontend/src/mecoffe/genericReplay.js`
- `frontend/tests/sha256.test.js`
- `frontend/tests/genericReplay.test.js`
- `scripts/test-milestone13.cjs`
- `scripts/test-milestone12.cjs`、`scripts/test-run-replay.cjs`（原 mock 兼容冻结计划 404 探测）
- `docs/social-sim-integration.md`、`docs/scene-integration-checklist.md`、`docs/scene-interface-draft.md`
- 本记录

## 检查结果

环境：Node v24.15.0、Python 3.12.4、Chrome headless，1600×1000。新增业务数据验证全部使用合成样例；无 npm 依赖变更。

| 命令 | 结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 90 项通过 |
| `npm --prefix frontend test` | 291 项通过 |
| `npm --prefix frontend run build` | 通过 |
| `npm --prefix frontend run build:pages` | 通过 |
| `npm --prefix frontend run check:pages` | 通过 |
| `npm --prefix frontend run build:embed` | 通过；113.75 MB、242 文件 |
| `node scripts/audit-public.cjs` | 通过，findings=[]，含 Pages/embed 私有数据检查 |
| `node scripts/test-milestone13.cjs` | 通过，普通 HTTP 的 17 个页面证据 |
| `node scripts/test-milestone12.cjs --embed` | 通过，角色名称与降级回归 |
| `node scripts/test-run-replay.cjs --embed` | 通过，旧后端匹配计划回退及原回放回归 |
| `node scripts/test-pages.cjs` | 通过，11 条公开入口及刷新；慢网交互检查通过 |
| 文档 JSON 示例、相对链接、`git diff --check` | 通过 |

SHA 测试含空串、abc、标准多块输入、一百万个 a，二进制 0–255、多个 padding 边界、偏移视图；对照 Node 独立摘要和 Web Crypto。没有 subtle 时，两个完整地图加载路径仍验证全部声明文件，改动文件字节会失败。

## 普通 HTTP 实测方法与证据

测试脚本创建临时严格静态服务：嵌入包在 `http://mecoffe-http.test:5191/scene/`，Pages 在同一测试域名的 5192 端口。仅本次 Chrome 进程用 `--host-resolver-rules=MAP mecoffe-http.test 127.0.0.1` 解析到本机，关闭该进程的代理；不改 hosts、不关闭浏览器安全校验、不将来源强制标为安全。任务结束后关闭这两个自建服务，不动 5180。

17 次检查实际读取 `window.isSecureContext === false`，且 `typeof crypto.subtle === 'undefined'`；没有通过注入假值模拟安全上下文。业务接口由合成 mock 返回，不访问团队服务器。

已覆盖：三维/GIS 配置预览（6 人、0 事件/订单）；同一配置的旧/新运行冻结计划 v1/v2（7 人、2 订单，均不请求配置旧计划）；冻结接口 404 且版本匹配的回退；404 且版本不匹配时拒绝；401/409 不回退；地图文件追加一个空格仍被拒绝；公开 NUS GIS 用另一个地图加载器在相同非安全上下文正常显示。无页面异常、非预期资源 404 或外部请求。

本地 `logs/milestone13/` 保存日志、`http-browser-qa.json` 和 17 张截图。截图顶端为测试脚本生成的证据条，显示真实读取的 origin、安全上下文状态和测试输入，不是产品新增界面。

- `3d-preview-normal.png`、`gis-preview-normal.png`：普通 HTTP 配置预览。
- `3d-replay-frozen-v1.png`、`gis-replay-frozen-v1.png`：旧运行冻结 v1。
- `3d-replay-frozen-v2.png`、`gis-replay-frozen-v2.png`：配置 v1、冻结计划/轨迹 v2 仍成功。
- `3d-legacy-mismatch.png`、`gis-legacy-mismatch.png`：旧后端计划版本不一致的明确提示。
- `3d-replay-legacy-match.png`、`gis-replay-legacy-match.png`：404 后正确匹配回退。
- `3d-tampered-map.png`、`gis-tampered-map.png`：纯 JS 哈希仍拒绝改动文件。
- `3d-plan-401.png`、`gis-plan-401.png`、`3d-plan-409.png`、`gis-plan-409.png`：权限/未就绪错误。
- `public-scenario-http.png`：公开 NUS GIS 的 HTTP 哈希回归。

## 学弟 PR 需补的接口与边界

新增提议 `GET /api/sessions/{session_id}/runs/{run_id}/artifacts/plan`，只返回该运行已登记 `bundle.json` 的 `simulation_plan` 字段，不能返回整个 bundle 或配置阶段计划。与 trajectory、population-snapshot 一样检查登录 → 会话归属 → 运行归属，目录/符号链接/文件白名单、只读、终态才开放；未就绪 409，未登录 401，不存在或无权访问 404。最终路径由 PR 审查确认。

嵌入产物在 `frontend/dist-embed/`，验收合并后由 Claude 发布新 Release。源码和构建目录不包含本轮真实团队数据。提交号与目录摘要另记在本地 `logs/milestone13/embed-receipt.json`。

已知边界：本机 HTTP 条件已真实验证，但生产服务器及新后端接口未访问，仍需部署后的真实终态运行验收。旧后端若没有匹配版本的计划，拒绝回放是预期行为。安全上下文 API 扫描发现旧 `TopologyEditor.vue.copyDebugJson()` 使用剪贴板，它不在本轮场景执行路径，未改动；场景路径及相关 Three.js/MapLibre 源码未发现其他直接的 subtle/randomUUID/clipboard 依赖。构建仅保留原有大 chunk 提示。
