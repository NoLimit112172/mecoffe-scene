# 里程碑 10 交付记录

## 本地分支与提交

工作分支为 `feat/config-preview`，基线 `main` 为 `5338ec9`。F5 启动配置先单独提交为 `ed72fa7`，提交名 `chore: default local launch to 3D history and add GIS entry`。本里程碑以独立的 `milestone 10:` 提交交付，提交号以分支 Git 日志为准。

## 配置预览

- 本地入口为 `/mecoffe3d?preview=local` 和 `/mecoffe-gis?preview=local`。上传原始 snapshot/preparation，或两份 StageDetail 响应。第三个 JSON 可选文件提供显式楼栋规则。
- 远程入口使用 `?session=<id>&config=<id>`。两种视图从同一组阶段接口取数据，使用同源 Cookie。未完成、401、404、阶段失败和无效格式都有明确提示。
- 公用适配层验证快照版本、角色人数、关系端点和字段结构。原始属性 key、值及关系类型保留。生成字段取中文 title，静态属性使用显示字典，未知字段显示原 key。
- 角色安置优先采用显式实体规则，再采用角色规则。缺省使用 UTF-8 FNV-1a 32 位计算 `seed|role`，对按 OSM ID 稳定排序的建筑数量取模。同角色同楼栋，全部为展示示意。
- 人物全部计入楼内，名单可定位，楼顶显示人数。三维按方向显示关注线，竞争关系使用独立颜色；GIS 使用屏幕线并为其他关系加虚线。场景切换保持同一配置，刷新本地上传页需要重新选文件。
- 页面显示“配置预览 · 尚未运行模拟”，事件、订单和在途人数均为零。配置预览没有播放时间轴。

## 地图和嵌入

普通、Pages 和 embed 均提供独立的固定地图包 `mecoffe/config-map/`，仅含几何、入口、地表和必要地图元数据，浏览器校验 SHA-256。原始轨迹转换补齐 `snapshot_revision`，合成原始轨迹加快照可完整生成场景并重复得到相同结果。

`npm --prefix frontend run build:embed` 输出 `frontend/dist-embed/`，基址为 `/scene/`。构建采用显式文件允许列表，剔除旧配置、运行数据、Rocketbox 和按旧人物生成的素材目录条目。当前嵌入包约 113.70 MB、246 个文件。构建没有新增依赖。

团队接入步骤、同源要求、Docker/Vite/Nginx 静态挂载及 iframe 示例见 [接入说明](social-sim-integration.md)。

## 测试与浏览器验收

| 检查 | 结果 |
| --- | --- |
| Python 全量 unittest | 86 项通过 |
| 前端全量测试 | 238 项通过 |
| 普通构建、Pages 构建、Pages 产物检查、embed 构建 | 通过 |
| 公开内容审计 | 零发现 |
| 配置预览本地浏览器检查 | 通过 |
| `/scene/` 严格静态托管浏览器检查 | 通过 |
| 原有 Pages 页面直达、刷新和交互 | 通过 |

合成输入有 6 人和 5 条有向关系，其中 4 条关注、1 条竞争。三维和 GIS 均核对到 6 人全部在楼内，事件和订单为零。浏览器同时检查画像、关系线、跨视图切换、远程阶段响应、GIS 刷新、未完成、401 和 404。测试使用本机 mock，无需真实模型。

执行命令如下。

```sh
python -X utf8 -m unittest discover -s adapter -v
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run build:pages
npm --prefix frontend run check:pages
npm --prefix frontend run build:embed
node scripts/audit-public.cjs
node scripts/test-config-preview.cjs
node scripts/test-config-preview.cjs --embed
node scripts/test-pages.cjs
node scripts/test-gis.cjs --pages
```

## 数据保护与本地产物

公开测试只使用 `frontend/tests/fixtures/config-preview/` 中自行构造的合成内容。审计会拦截新导入的团队快照、preparation、归一化配置预览数据，以及被强制加入 Git 的私有目录路径。此前已获准公开的旧快照按规范化内容哈希识别。

真实团队样例从外部只读克隆经浏览器本地文件接口验证，验证数值和结果仅保存在忽略的 `logs/milestone10-private/`。该验证不生成截图。

合成截图和自测日志位于忽略的 `logs/milestone10/`，包括 `3d-overview.png`、`profile.png`、`relationships.png`、`gis-preview.png`、`stage-pending.png` 和 `login-expired.png`。私有输入及浏览器文件内容不会写入本地存储或静态构建。

## 验证边界

当前地图固定为中科大。真实团队网站的部署与远程 Cookie 联调需要团队挂载静态包后验收，本轮远程接口以同源 mock 验证。配置快照不提供个人实际位置，楼栋分配为确定性展示设定。地图时间仅用于内部场景兼容，配置页面默认采用正午展示光照。

`docs/showcase-20261106/` 保存在本地并被忽略。团队仓库和远端服务器未在本轮修改或访问。

## 本里程碑改动文件

```text
.gitignore
adapter/oasis_to_scene.py
adapter/test_raw_trajectory_scenario.py
docs/milestone10-delivery.md
docs/social-sim-integration.md
frontend/embed/build-tools.mjs
frontend/embed/embed-plugin.mjs
frontend/package.json
frontend/src/components/ConfigProfileFields.vue
frontend/src/embed-main.js
frontend/src/mecoffe/Campus3DScene.js
frontend/src/mecoffe/campus3dRouting.js
frontend/src/mecoffe/configMap.js
frontend/src/mecoffe/configPreview.js
frontend/src/mecoffe/configPreviewStore.js
frontend/src/mecoffe/gis/ConfigRelations.js
frontend/src/mecoffe/gis/IndoorLayer.js
frontend/src/mecoffe/gis/replay.js
frontend/src/router/index.js
frontend/src/router/pages.js
frontend/src/views/ConfigPreviewEntry.vue
frontend/src/views/MeCoffe3D.vue
frontend/src/views/MeCoffe3DEntry.vue
frontend/src/views/MeCoffeGis.vue
frontend/src/views/MeCoffeGisEntry.vue
frontend/tests/configPreview.test.js
frontend/tests/configPreviewRender.test.js
frontend/tests/embedPrivacy.test.js
frontend/tests/fixtures/config-preview/preparation.json
frontend/tests/fixtures/config-preview/snapshot.json
frontend/vite.config.js
scripts/audit-public.cjs
scripts/test-config-preview.cjs
```
