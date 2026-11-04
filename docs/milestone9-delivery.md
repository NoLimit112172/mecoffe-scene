# 里程碑 9：人物进楼交付

本文件记录 `6b5a330` 初版验收。随后追加的门居中、人物去向检查、清晰标注、关系线、门店映射及长帧修正见 [里程碑 9 修正记录](milestone9-fixes.md)，以该记录为准。

## 版本与范围

- 分支 `feat/indoor`，基于 `main` 的 `680baf68efdab27430fc5fc422d2719c2a65d773`。本轮单独本地提交，提交号可用 `git log -1 --format=%h feat/indoor` 查看；不推送、不合并、不修改 main。
- 原有 5180 服务保持运行。本轮尚未发布到公开站。
- 按追加优先级，重点为中科大 `ustc-history`，**全部采用推断入口**。没有实现 OSM entrance 解析，没有为 NUS 制作入口演示或截图；NUS 仅由通用生成器同步新文件并通过原页面回归。
- 不增加依赖、外部数据或服务。保留 YuLan 建筑、既有人物外观规则及“人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据”提示。

入口：

- GIS：<http://127.0.0.1:5180/mecoffe-gis?scenario=ustc-history>
- 沙盘：<http://127.0.0.1:5180/mecoffe3d?scenario=ustc-history>

## 完成内容

1. 场景生成器为每栋楼输出 `entrances.json` 和 WGS84 的 `gis/entrances.geojson`，并写入清单哈希。中科大 31 个入口都在楼轮廓上，均可通过展示连接段接到原始步行图节点；不修改图的节点或边。无路网的输入标为不可连接，不编造路线。
2. 沙盘和 GIS 共用 `IndoorMotion`，采用固定 60 Hz 的确定性展示时钟。默认 100 人在家所在楼栋内隐藏；有行程才出门。路线从入口出发并结束在入口，过门用约 0.5 展示秒的缩放效果；进入门店后隐藏并停留，默认 6 展示秒，然后出门持杯、回家、进入后隐藏。时长按回放倍速换算，可在 `INDOOR_DEFAULTS` 或构造参数里配置。
3. 两页楼顶人数和楼内名单来自同一状态；楼内人数加室外人数始终等于人物总数。人数为零不显示，远景避让或隐藏。楼体/屋顶轻度提亮，不覆盖建筑原色。点击楼内人物定位并高亮所在楼；楼栋名单可以点人物。
4. 真实页面不再用 standingSlots 摆常驻人群。楼内人物不参与绘制、LOD 选取或新的模型请求。模型点击也排除已隐藏的缓存人物。
5. 按日回放显示“第 N 天 · 日期”和天内进度，不显示钟点。记录只到第 24 天时，结尾日期不会变成第 25 天；暂停同步精确进度和人数。昼夜变化保留并标注为展示效果。无轨迹场景仍不创建人物。
6. 去程/返程复用既有展示安全走廊并分道，同路线错峰；加载时准备实际购买路线，播放时复用，不提前执行未来订单。楼内停留期间回放清场仍正常推进。

详细接口与状态见 [人物进楼展示约定](indoor-presentation.md)。

## 数据与复现

`logs/milestone9/invariants.json` 以 `680baf6` 为基线核对：22 份已有场景数据文件字节不变；仅新增入口文件，两个 scenario.json 与目录 index.json 更新文件哈希。原人物、订单、地点映射、地图、A* 道路图和六份 GIS 图层未改变。package.json 与 package-lock.json 不变。

入口测试在临时输出目录重复生成两个示例包，逐文件比较字节、验证清单 SHA-256。所有入口均为 `source: inferred`。中科大 31/31 可连接；NUS 由同一流程得到 226/226 可连接，仅作为兼容性结果。现有 JSON/GeoJSON `-text` 规则继续保存原始字节。

## 改动文件

- 场景生成：`adapter/scene_builder/entrances.py`（新增）、`adapter/scene_builder/scenario.py`、`adapter/test_entrances.py`（新增）。
- 场景产物：`frontend/public/mecoffe/scenarios/index.json`；`ustc-history`、`nus-hourly` 各自的 `scenario.json`、新增 `entrances.json` 与 `gis/entrances.geojson`。
- 共用控制器及沙盘：新增 `frontend/src/mecoffe/indoorMotion.js`、`Campus3DIndoor.js`；修改同目录 `Campus3DScene.js`、`scenario.js`。
- GIS：`frontend/src/mecoffe/gis/CharacterLayer.js`、新增 `IndoorLayer.js`、`MapLibreScene.js`、`labels.js`、`model.js`、`replay.js`。
- 页面：`frontend/src/views/MeCoffe3D.vue`、`MeCoffeGis.vue`、`MapScenePreview.vue`（只调整无轨迹场景的时间文案）。
- 测试与自测：新增 `frontend/tests/indoor.test.js`、`scripts/test-indoor.cjs`；修改 `frontend/tests/gis.test.js`、`scripts/test-gis.cjs`、`scripts/test-pages.cjs`。
- 文档：`README.md`、`docs/map-input-contract.md`、新增 `docs/indoor-presentation.md`、本交付记录。共 32 个文件。

## 测试与构建

在项目根目录执行。以下均已通过；运行日志和截图在本机 `logs/milestone9/`，该目录不进入 Git。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 84 项通过 | `python-tests.txt` |
| `npm --prefix frontend test` | 215 项通过，0 失败/跳过 | `frontend-tests.txt` |
| `npm --prefix frontend run build` | 通过，保留已有大 chunk 提示 | `build.txt` |
| `npm --prefix frontend run build:pages` | 通过 | `build-pages.txt` |
| `npm --prefix frontend run check:pages` | 通过，含入口文件哈希与子路径检查 | `check-pages.txt` |
| `node scripts/audit-public.cjs` | 无发现 | `public-audit.json` |
| `node scripts/test-pages.cjs` | 11 个入口直达/刷新、原页面交互通过 | `legacy-pages-qa.json` |
| `node scripts/test-gis.cjs --pages` | 两场景直达/刷新、目录/第三包、图层、查询和人物回归通过 | `gis-pages-qa.json` |
| `node scripts/test-indoor.cjs` | 本地页面、入楼、名单、两页人数一致通过 | `local-qa.json` |
| `node scripts/test-indoor.cjs --pages` | 严格静态子路径下相同检查通过 | `pages-qa.json` |

新增自动测试覆盖：入口位于轮廓上、连接原图节点、经纬度换算、无道路回退、文件复现和哈希；出门/入门/停留/持杯返程、可配置停留、默认室内、人员守恒、两页相同游标和倒拖的一致性、清场不预支未来订单及记录末日日期。

严格 Pages 静态服务不提供 SPA 回退；GIS 和进楼专项检查均无页面错误、无 404，原页面自测也通过。产物 384 个文件，共 92,959,716 字节，仍低于 300 MB。原 5180 服务未重启。

## 性能

Chrome headless，1600×1000，独立顺序采样。两页测量使用不同渲染循环，不能横向比较 FPS；同页与旧记录比较。主线程 JS heap 不含 worker、GPU 和进程 RSS，不代表总内存或长期泄漏结论。

| 页面与条件 | 本轮平均 FPS | 本轮最差帧 | 主线程 heap | 既有基线 |
| --- | ---: | ---: | ---: | --- |
| USTC GIS，全景播放，10 秒 MapLibre render 事件间隔 | 89.18 | 17.6 ms | 55.24 MiB | 里程碑 8 约 66–69 FPS |
| USTC 沙盘，YuLan、高画质、4×、自动昼夜，12 秒实际 GL 绘制/RAF | 137.55 | 1041.8 ms | 106.47 MiB | 里程碑 6 YuLan：81.00 FPS，1258.3 ms，114.75 MiB |

沙盘平均每绘制帧约 989.99 次 GL draw call，旧记录约 1167.78 次。GIS 另一次 12 秒进楼专项采样为 85.60 MapLibre FPS，主线程 heap 71.90 MiB；采样窗口不同，数值波动属于观测结果，不用浏览器约 240 Hz 的 RAF 频率冒充地图帧率。平均帧率未低于既有基线。

**仍有已知长帧：沙盘采样出现约 1.04 秒的停顿。** 已预先准备路线并减少隐藏人物绘制，但未完整定位剩余长帧来源，不能声称完全无卡顿。没有完成小时级稳定性或全进程泄漏测试。

## 截图

均为 1600×1000、Pages 子路径实测：

1. [中科大 GIS 全景：楼前无人群、楼顶人数](../logs/milestone9/gis-overview.png)
2. [人物进入门店的缩小过程](../logs/milestone9/entering-building.png)
3. [楼栋信息卡：推断入口与楼内名单](../logs/milestone9/building-residents.png)
4. [沙盘相同回放位置](../logs/milestone9/sandbox-same-position.png)

两页相同回放位置 `2.5` 的完整楼内名单对象经浏览器逐项比较一致。沙盘截图选择正午以便看清建筑，仅改变光照预览；性能采样恢复自动昼夜。

## 已知边界

- 入口由轮廓与步行图最近关系推断，可能不是现实可进入的门，不包含实测门、室内平面、房间分配或无障碍通行验证。OSM entrance 支持按本轮优先级延期。
- 过门采用缩放并隐藏，不绘制门洞或真正室内；人物停留时间、建筑归属和路线均为展示示意，未改 OASIS 决策。
- 现有每店 2 人、总计 12 条展示行程的并发限制保留；大量购买排队可能延续到事件进度结束之后，但不会改变订单数量或读取未来事件。
- 同路线保留分道与错峰，不包含完整人群动力学，交叉口仍可能短暂靠近。
- 历史数据本身缺失的天数不补造；无轨迹场景不补人物。旧二维页面不在改造范围。
