# 里程碑 8：GIS 模式原型交付

## 版本与入口

- 分支：`feat/gis`，从 `main` 的 `5129f84f07d382f8b81734e68883fa3f7b86d8b4` 新建。初版提交 `35668b7` 保留；验收修正另追加 `milestone 8 fixes:` 本地提交，提交号以本分支 `git log -1` 为准，不改写初版。
- 没有 push、合并或改动 main；本轮功能尚未发布到公开网站。原有 5180 服务保持运行。
- 中科大：<http://127.0.0.1:5180/mecoffe-gis?scenario=ustc-history>
- NUS：<http://127.0.0.1:5180/mecoffe-gis?scenario=nus-hourly>
- 两个场景清单预览和三维沙盘都有 GIS 入口，GIS 可以切回对应场景的沙盘。

## 验收修正

1. 场景菜单与默认项读取生成的 `frontend/public/mecoffe/scenarios/index.json`。目录包含 id、原清单标题、是否有模拟数据及清单 SHA-256，保持原始字节发布。生成场景时自动更新；单独刷新用 `python -m adapter.scene_builder scenario-index`。GIS 页面没有校园 ID 常量/白名单。Python 临时目录增加第三包后重复生成字节一致；浏览器临时 HTTP 第三包验证了菜单、默认项与切换，无须修改页面，也未把假场景加入正式目录。
2. 场景 OSM 数据与栅格底图的署名采用同一规范内容，地图控件只显示一次；其他来源仍保留独立署名。真实 OSM 单视口检查次数为 1，截图可复验。
3. 信息卡、地图弹窗和搜索共用中文名称解析。素材名称取现有 catalog.title；未知类别/无中文素材名采用次要样式附代号。OASIS 地点显示映射名称并保留 ID；要素 ID 默认折叠到“数据详情”，不再直接作为正文。
4. **人物重叠改善已完成**：同一有向 A* 路径按 0.4 展示秒错开出发，等候时使用待机动作；不修改 OASIS 事件、订单、模拟时间或道路图。测试验证第二人先等待、两人拉开并沿同一 node_ids 出发。近景已补图；交叉路口等复杂拥挤仍未引入完整动力学。

本轮不新增依赖；package.json/package-lock、原有场景包（包括 GIS 文件、清单）、人物与地点映射均无改动，新增目录单独存放。相对 `35668b7` 逐字节核对了 24 份已有场景文件，全部相同；目录再次生成的字节相同，证据为 `logs/milestone8/fixes-invariants.json`。原“示意”提示保持逐字不变，旧页面只通过回归验证而不调整行为。

## 实现范围

场景命令同时生成六份 WGS84 GeoJSON：建筑、道路、地表、水域、校界、点位；每份文件加入 scenario.json 的 SHA-256，并按原始字节保存。中科大 31 栋楼，NUS 226 栋楼，通过同一生成器、显示引擎与页面加载；GIS 显示代码没有校园坐标、建筑 ID 或楼名专用分支。

MapLibre GL JS **6.16.0** 固定版本。默认只有场景矢量，不请求站外字体、底图或模型；可主动切换 OSM 标准栅格瓦片，保留署名，无抓取、预取或自建缓存。SDK 原始 BSD-3-Clause 许可和其依赖声明一并进入 Pages 产物。

支持倾斜/旋转、分类楼体拉伸、标签避让、七组图层、楼名/地点搜索高亮、楼栋/人物点击查询、播放暂停与倍速。近景共享现有 Three.js 人物模型和动作，最多 12 人；远景圆点不请求 FBX。人物沿既有 A* 道路图做展示移动；事件游标与模拟日期使用原回放函数及初始化偏移。NUS 没有运行轨迹，人物数始终为 0，并显示“尚无模拟数据”。

“人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据”始终保留。没有接入新的 agent 决策、空间后端或 OASIS 双向闭环。接口和后续扩展位置见 [GIS 架构](gis-architecture.md) 与 [地图输入契约草案](map-input-contract.md)。

## 测试与构建

在项目根目录执行；原始输出均位于 `logs/milestone8/`（运行证据不进入 Git）。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 81 项通过 | `fixes-python-tests.txt` |
| `npm --prefix frontend test` | 208 项通过，0 失败/跳过 | `fixes-frontend-tests.txt` |
| `npm ci`（初版隔离安装记录，本轮无依赖变更） | 安装 372 包成功，不干扰 5180 的 node_modules | `npm-ci.txt` |
| `npm --prefix frontend run build` | 通过；保留 Vite 大 chunk 提示 | `fixes-local-build.txt` |
| `npm --prefix frontend run build:pages` | 通过 | `fixes-build-pages.txt` |
| `npm --prefix frontend run check:pages` | 通过，含目录条目/清单哈希、GIS 静态入口及子路径引用 | `fixes-check-pages.txt` |
| `node scripts/test-pages.cjs` | 11 个入口直达/刷新通过，旧页面交互通过 | `legacy-pages-qa.json` |
| `node scripts/test-gis.cjs --pages` | 两场景直达/刷新、播放、中文查询、模型 LOD、菜单、默认项、第三包、图层/快速切换、手机布局通过 | `pages-qa.json` |
| `node scripts/test-gis.cjs --osm` | 本地 GIS 通过；OSM 单视口 59 次瓦片响应，右下角同源署名恰好一次 | `local-qa.json` |
| `node scripts/audit-public.cjs` | 当前可提交文件扫描无发现 | `fixes-public-audit.json` |

严格 Pages 模拟服务器仅托管真实文件/目录索引，无服务端 SPA 回退。两个 GIS 场景直达及刷新均成功；控制台错误、HTTP 404、遗漏子路径请求均为 0；默认离线检查站外请求为 0。移动端 390×844 没有横向溢出。快速切换场景后仅一个地图 canvas；隐藏人物层后近景可见模型数为 0。

两个清单分别在两个独立目录重复生成，清单、文件字节与哈希一致：

| 场景 | 往返坐标最大误差 | 建筑 / 道路 / 地表 / 水域 / 校界 / 点位 |
| --- | --- | --- |
| ustc-history | 0.00006823 米 | 31 / 158 / 8 / 1 / 1 / 8 |
| nus-hourly | 0.00007721 米 | 226 / 840 / 99 / 1 / 1 / 114 |

误差远小于 0.5 米，指相同投影的数值往返误差，**不代表 OSM 的测绘精度**。10 份原有场景数据文件与 main 字节相同，没有修改原始人物、映射或道路寻路图；只增加清单哈希和 GIS 文件。生成器跳过相同内容，Windows 文件被读者占用时重试并采用受哈希校验保护的写入；清单最后发布，临时文件不进 Pages。

Pages 产物：**92,673,573 字节（92.67 MB，380 文件）**，低于 300 MB。大文件仍主要为现有按需加载人物 FBX；没有加入新的外部人物模型或完整 Rocketbox。初版 package-lock 改动仅 216 行新增 / 4 行删除，验收修正未再修改依赖。

## 性能

1600×1000、Chrome headless、严格 Pages 静态产物、相同机器、正常 1× 播放；全景各采样 10 秒，近景采样 6 秒。没有同时运行构建或其他浏览器基准。FPS / 最差帧以 MapLibre `render` 事件间隔统计，反映地图实际重绘频率；主机 RAF 约 240 Hz，另行记录，未当作地图 FPS。内存为 CDP 主线程 JS heap，**不包括 worker、GPU、整个浏览器 RSS**，不能据此声称无泄漏或代表所有设备。

| 场景 | 平均地图 FPS | 最差帧间隔 | 主线程 JS heap | 模型 draw calls | 在途人物 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 中科大全景播放 | 69.93 | 80.9 ms | 20.15 MiB | 0 | 4 |
| 中科大近景播放 | 67.03 | 26.6 ms | 78.90 MiB | 7 | 4 |
| NUS 时间播放 | 64.26 | 26.0 ms | 40.52 MiB | 0 | 0 |

远景 FBX 请求数为 0；近景加载 4 个现有 FBX，采样结束时 2 个模型在视野内；NUS 全过程 FBX 请求数为 0。原始数值及采样说明见 `pages-qa.json`。旧三维页面慢网记录位于 `legacy-pages-qa.json`，不冒充 GIS 首屏时间。

## 截图

都在项目的 `logs/milestone8/` 下，前四张来自 Pages 子路径产物，第五张来自本地同一实现的正常单视口在线切换：

1. `pages-ustc-overview.png`：中科大 GIS 全景，倾斜视角。
2. `pages-character-closeup.png`：三维人物与行走。
3. `pages-query-popup.png`：点击楼栋查询、来源/素材/地点信息。
4. `pages-nus-overview.png`：NUS GIS 全景，无模拟人物。
5. `osm-basemap.png`：切换 OSM 底图及署名。
6. `pages-scenario-dropdown.png`：正式目录下拉框展开。
7. `pages-third-scenario-fixture.png`：临时第三场景菜单验证（测试专用，不进入正式数据）。

附加 `pages-mobile.png`、本地对应截图和机器可读验收结果，方便 Claude 复验。

## 已知边界

- 建筑为按来源高度拉伸的体块，缺失高度仍是原有默认/层数估算；不是测绘级模型。没有 DEM 地形、3D Tiles 或 Cesium 实现。
- 人物位置、门店与行走是显示示意；GIS 使用分道路线、站位与同路径错峰出发，但没有引入独立的连续拥挤/人群动力学；不保证复杂交叉/汇合场景的完整防碰撞。
- GIS 自己的楼名/路名在符号层避让；OSM 栅格上已烘焙的文字不能参与矢量符号碰撞，在线底图可能出现重复名称。
- OSM 在线底图受网络与公共瓦片服务可用性限制；失败会提示并退回离线矢量。默认离线不受其影响。
- 本轮测量是短时可复验基准，未声称覆盖所有显卡、长时间内存稳定性或自动 POI 匹配。

## 第二阶段需要的输入

1. 确定高德或天地图，以及允许使用的底图样式/服务类型；提供官方接口文档、使用授权、配额和署名要求。
2. 在服务商控制台申请相应 Web 使用凭证并配置允许域名（公开站域名及需要的本地域名）；凭证由用户在本机配置，不在聊天中发送。需要服务器签名的秘密不能进入公开 Pages 产物。
3. 确认服务返回的坐标系（如 WGS84 / GCJ-02）及转换方案。适配层必须统一处理底图、建筑、人物、轨迹、查询和相机；原场景包继续 WGS84。
4. 若希望替换 OSM 的轮廓/高度，需要另给有授权的官方 GIS / GeoJSON、坐标参考、字段与高度含义。仅有在线底图服务不会自动获得建筑矢量或真实人物位置。

自动 POI 地点映射属于第三阶段，仍未实现。本轮仅预留显示引擎与底图适配接口，并继续消费已有显式地点映射。

## 本次验收修正改动（19 文件）

```text
.gitattributes
README.md
adapter/scene_builder/__main__.py
adapter/scene_builder/scenario.py
adapter/test_gis.py
docs/gis-architecture.md
docs/map-input-contract.md
docs/milestone8-delivery.md
frontend/pages/build-tools.mjs
frontend/public/mecoffe/scenarios/index.json
frontend/src/mecoffe/gis/MapLibreScene.js
frontend/src/mecoffe/gis/basemaps.js
frontend/src/mecoffe/gis/labels.js
frontend/src/mecoffe/gis/replay.js
frontend/src/mecoffe/scenario.js
frontend/src/views/MeCoffeGis.vue
frontend/tests/gis.test.js
frontend/tests/pages.test.js
scripts/test-gis.cjs
```

## 里程碑 8 累计改动清单

```text
.gitattributes
NOTICE.md
README.md
adapter/scene_builder/gis.py
adapter/scene_builder/__main__.py
adapter/scene_builder/io.py
adapter/scene_builder/scenario.py
adapter/test_gis.py
docs/gis-architecture.md
docs/map-input-contract.md
docs/milestone8-delivery.md
frontend/package.json
frontend/package-lock.json
frontend/pages/build-tools.mjs
frontend/pages/dependency-notices.mjs
frontend/pages/pages-plugin.mjs
frontend/public/mecoffe/scenarios/index.json
frontend/public/mecoffe/scenarios/nus-hourly/scenario.json
frontend/public/mecoffe/scenarios/nus-hourly/gis/boundary.geojson
frontend/public/mecoffe/scenarios/nus-hourly/gis/buildings.geojson
frontend/public/mecoffe/scenarios/nus-hourly/gis/landcover.geojson
frontend/public/mecoffe/scenarios/nus-hourly/gis/pois.geojson
frontend/public/mecoffe/scenarios/nus-hourly/gis/roads.geojson
frontend/public/mecoffe/scenarios/nus-hourly/gis/water.geojson
frontend/public/mecoffe/scenarios/ustc-history/scenario.json
frontend/public/mecoffe/scenarios/ustc-history/gis/boundary.geojson
frontend/public/mecoffe/scenarios/ustc-history/gis/buildings.geojson
frontend/public/mecoffe/scenarios/ustc-history/gis/landcover.geojson
frontend/public/mecoffe/scenarios/ustc-history/gis/pois.geojson
frontend/public/mecoffe/scenarios/ustc-history/gis/roads.geojson
frontend/public/mecoffe/scenarios/ustc-history/gis/water.geojson
frontend/src/App.vue
frontend/src/mecoffe/scenario.js
frontend/src/mecoffe/gis/CharacterLayer.js
frontend/src/mecoffe/gis/MapLibreScene.js
frontend/src/mecoffe/gis/basemaps.js
frontend/src/mecoffe/gis/engine.js
frontend/src/mecoffe/gis/model.js
frontend/src/mecoffe/gis/labels.js
frontend/src/mecoffe/gis/replay.js
frontend/src/router/index.js
frontend/src/router/pages.js
frontend/src/views/MapScenePreview.vue
frontend/src/views/MeCoffe3D.vue
frontend/src/views/MeCoffeGis.vue
frontend/src/views/SourceLicenses.vue
frontend/tests/gis.test.js
frontend/tests/pages.test.js
scripts/test-gis.cjs
scripts/test-pages.cjs
```
