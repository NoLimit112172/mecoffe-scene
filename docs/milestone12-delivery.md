# 里程碑 12 交付记录

基线 `65bdfb7`，分支 `feat/replay-role-labels`。本记录与代码同次本地提交；未推送、未修改 main 或 social-sim，未登录服务器。原 5180 服务 PID 51228 保持运行。

## 行为

- 回放按运行详情中的 `config_id` 读取同一配置的可选 `stages/roles`，不使用会话当前配置。
- 完整有效的角色阶段说明优先，之后是冻结快照的显式角色说明，再之后是原始角色名；沿用现有短名/全文显示，两种地图共用加载器。
- 冻结轨迹、快照与计划先严格校验。roles 缺失、未完成、无效 JSON/格式、配置不匹配、网络异常只影响展示元数据；401 和请求取消继续向页面传递。
- 原始 `role` ID 保留在人物“数据详情”，三维回放名册同时显示角色短名与楼栋；旧历史回放/NUS 页面行为不变。
- 草案更新至 v0.3：师兄认可可选三维/GIS 与同源 `/scene/` 方向；学弟本地补丁待 PR，默认 Alemax067 审查，接口路径和部署方式在 PR 确认，尚未合并部署。
- 新增面向对接人的联调清单，逐项说明在哪里点、应看到什么。

## 文件

- `frontend/src/mecoffe/genericReplay.js`
- `frontend/src/components/ConfigProfileFields.vue`
- `frontend/src/views/MeCoffe3D.vue`
- `frontend/tests/genericReplay.test.js`
- `scripts/test-milestone12.cjs`
- `scripts/test-run-replay.cjs`（原浏览器 mock 兼容可选 roles 请求）
- `docs/scene-interface-draft.md`（纳入原未跟踪文档并更新）
- `docs/social-sim-integration.md`
- `docs/scene-integration-checklist.md`
- 本交付记录

## 验证

环境：Windows，Node v24.15.0，Python 3.12.4，Chrome headless，1600×1000。仅新增合成数据验证，不接触团队服务器或私有样例。

| 命令 | 结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 90 项通过 |
| `npm --prefix frontend test` | 284 项通过 |
| `npm --prefix frontend run build` | 通过 |
| `npm --prefix frontend run build:pages` | 通过 |
| `npm --prefix frontend run check:pages` | 通过 |
| `npm --prefix frontend run build:embed` | 通过；113.74 MB / 242 文件 |
| `node scripts/audit-public.cjs` | 通过，findings=[]，覆盖现有 Pages/embed 产物 |
| `node scripts/test-milestone12.cjs` | 通过，本地 Vite |
| `node scripts/test-milestone12.cjs --embed` | 通过，`/scene/` 严格静态目录托管 |
| `node scripts/test-run-replay.cjs --embed` | 通过，原回放用例回归 |
| `node scripts/test-pages.cjs` | 通过，11 条公开入口及刷新；慢网交互检查通过 |
| 文档 JSON 示例/相对链接、`git diff --check` | 通过 |

新增浏览器检查在两个视图验证：中文说明、404、阶段未完成、无效格式/JSON、跨配置说明、roles 单独 401；刷新和视图切换保留 session/run。合成样例 7 人、4 条关系、2 笔订单、被拒 1、未知 1，异常降级不改变结果。单元测试另覆盖网络异常、冻结说明回退及 fetch/JSON 读取时的 AbortError。

## 截图及嵌入产物

截图和 QA JSON 仅保存在本地 `logs/milestone12/`，不提交截图：

- `embed-3d-chinese-roles.png`、`embed-gis-chinese-roles.png`：中文图例和人物名册。
- `embed-3d-chinese-person-card.png`、`embed-gis-chinese-person-card.png`：角色名称与人物卡。
- `embed-3d-missing-roles.png`、`embed-gis-missing-roles.png`：缺失说明回退原名。
- `embed-3d-login-expired.png`、`embed-gis-login-expired.png`：roles 单独 401。
- `local-*`：同样的本地开发模式截图；`local-browser-qa.json`、`embed-browser-qa.json` 为结果。

嵌入目录为 `frontend/dist-embed/`。构建白名单及公开审计确认仅含程序、必要素材、中科大地图和明确合成样例；本轮不制作 ZIP，由 Claude 验收后打包转交。提交号和目录内容摘要记录在本地 `logs/milestone12/embed-receipt.json`，以最终交付消息中的提交为准。

## 已知边界

团队补丁和真实接口仍待 PR 审查、部署及授权数据联调；本轮只用 mock 验证客户端。角色说明都不存在时显示原名是预期行为，不猜译角色身份。若团队以后允许同一配置重新生成，角色展示说明也应随运行冻结。构建保留原有大 chunk 提示，无新增依赖。
