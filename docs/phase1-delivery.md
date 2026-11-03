# 阶段 1 交付与验收记录

日期：2026-11-03。工作目录：`C:\Users\Lenovo\Documents\Claude\mecoffe-scene`。

分支：`feat/campus-3d`；仅本地提交，不 push。现有 5180 Vite 服务未停止、未重启，启动脚本未修改。访问：<http://127.0.0.1:5180/mecoffe3d>；原页面：<http://127.0.0.1:5180/mecoffe>。

## 完成内容

- Three.js 校园体块、两片校园边界及内孔、OSM 道路、楼名悬停、人物选择和 OrbitControls。
- 八个地点均映射到真实存在的 OSM 楼栋，理由和 `illustrative: true` 写入独立配置；人物沿用原数据中的住宿分配。
- 人物静止时位于对应楼体外的示意入口附近。购买时从楼栋最近的 OSM 道路节点出发，A* 往返仅经过步行图上的边；楼门到道路的接入不补造道路。
- 复用原 `replay.js` 的事件索引、累计统计和人物记录；新版规则演示、静态关系网络、历史 OASIS 回放各有独立提示。
- 支持播放、暂停、速度、单事件、按天跳转；同人订单排队、重复订单去重、跳转归位、末尾返程收尾。
- 顶部持续提示 OASIS 没有位置数据，地图显示 OSM 署名，缺失高度明确标为默认值。

## 文件清单（仓库根目录相对路径）

| 文件 | 改动 |
| --- | --- |
| `.gitattributes` | 保留 OSM 原始字节，避免 Windows 换行转换破坏来源 SHA-256 |
| `NOTICE.md` | OSM 署名、ODbL 与来源/示意限制 |
| `README.md` | 三维页面、生成方法、交互和限制说明 |
| `frontend/package.json` | 唯一新增依赖 `three: 0.187.0` |
| `frontend/package-lock.json` | 恢复原 CRLF；仅新增 three 的 7 行锁定信息 |
| `frontend/src/App.vue` | 新页面隐藏全局主题按钮，旧页面条件等效 |
| `frontend/src/router/index.js` | 新增独立 `/mecoffe3d` 路由 |
| `adapter/osm_to_campus3d.py` | 仅标准库的 OSM 下载、投影、几何与步行图转换 |
| `adapter/test_osm_to_campus3d.py` | 新增 9 项 OSM 适配器测试 |
| `data/osm/ustc_gaoxin.osm` | 官方 OSM 原始响应 |
| `data/osm/ustc_gaoxin.metadata.json` | URL、下载时间、范围、SHA-256 与署名 |
| `scene/campus3d.json` | 米制建筑、道路、完整校园边界与步行图 |
| `scene/campus3d_mapping.json` | 八个原地点到 OSM 楼栋的示意对应 |
| `frontend/public/mecoffe/campus3d.json` | 场景数据的前端副本 |
| `frontend/public/mecoffe/campus3d_mapping.json` | 映射数据的前端副本 |
| `frontend/src/mecoffe/campus3dRouting.js` | 最近道路节点、A* 与反向路线 |
| `frontend/src/mecoffe/campus3dPlayback.js` | 模式校验、游标与日期转换 |
| `frontend/src/mecoffe/Campus3DScene.js` | 三维绘制、人物、行走、事件和资源回收 |
| `frontend/src/views/MeCoffe3D.vue` | 新三维页面、面板、模式与时间轴 |
| `frontend/tests/campus3dRouting.test.js` | 5 项，含六住处×两门店路径逐边校验 |
| `frontend/tests/campus3dPlayback.test.js` | 4 项，模式来源、全游标往返、日界线与空日 |
| `frontend/tests/campus3dScene.test.js` | 5 项，FIFO、去重、沿边往返、seek、不可达 |
| `docs/phase1-delivery.md` | 本验收记录 |

原 `MeCoffeScene.vue`、`CampusScene.js`、`layout.js`、`replay.js`、`scene/campus.json`、三份现有行为/网络 JSON 和启动脚本未修改。

## 依赖遗留改动审计

中断会话的锁文件约 9000 行差异来自 CRLF → LF。恢复原换行后，锁文件只新增 7 行；与 HEAD 对比，原有 391 个包记录完全不变，仅添加 `three@0.187.0`。版本、官方 tarball 和 integrity 已核对，`npm ls three --depth=0`、Three 模块及 OrbitControls 导入通过。未运行会清空现有 node_modules 的 npm ci。

## 地图来源与规模

- 来源：`https://api.openstreetmap.org/api/0.6/map?bbox=117.1194,31.8180,117.1283,31.8270`，未使用其他地图平台数据。
- 下载 UTC：`2026-11-03T05:01:24.973987+00:00`。
- 原始 XML：307,776 字节，SHA-256：`663062802ab35914d085a7a97d2be29001d0d6bc786b69b688608bdd37ee6437`。
- 31 栋楼、30 栋有 OSM 名称；57 条源 highway ways，下载范围内保留 50 个连续绘制路段。
- 步行图：195 节点、234 边，两个连通分量（187＋8），没有为连通而伪造边；八地点使用的最近道路节点均在主分量。
- 校园边界 relation 14093671：两片独立 outer、一个 inner；`boundary_polygons` 完整保存，兼容字段 `boundary` 指最大 outer。
- 本地等距矩形投影，x 东、y 北、单位米，原点为全部校园 outer 包围盒中心；Three.js 使用 x / -z 地面坐标与 y 高度。

## 测试与构建

在仓库根目录：

```powershell
python -X utf8 adapter/osm_to_campus3d.py
python -X utf8 -m unittest discover -s adapter
```

结果：生成成功；Python **36/36**（原有 27＋新增 9）。负例测试中的来源摘要不匹配/无效快照报错是预期输出。

在 `frontend`：

```powershell
npm test
npm run build
```

结果：Node **31/31**（原有 17＋新增 14）；Vite 生产构建通过。构建仍提示较大分块和上游 CharacterFactory 同时静态/动态导入，不影响构建完成。

额外核对：`git -c core.whitespace=cr-at-eol diff --check` 通过，未更改全局 Git 配置。两份派生数据与前端副本内容一致。

## 浏览器与截图

- 在原 5180 服务实测新旧两个页面，旧二维页面仍显示原 100 人／530 条关系与 898 条演示事件。
- 三维关系网络模式：100 人、530 关系、0 订单，播放与步进禁用。
- 三维历史模式：提示 failed、23/30 天完整，第 24 天部分记录；跳转后保留 101 单／1027.20 元，不补造日期。
- 三维规则演示：单步至购买出现在途人物，暂停后游标与在途状态稳定；按天跳转会清理动画。
- 以 8 倍速完整播放到第 30 天：898/898 条事件，240 单／2609.10 元；最终在途 0 人、排队 0 笔，按钮恢复为播放。
- 三维页面控制台无 error/warn；场景测试另验证 240 笔示例购买均可完成、最终队列清空。

截图（本地文件，不上传）：

- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1\mecoffe3d.png`：最终三维页面，包含一笔购买的暂停路线、顶部声明和 OSM 署名。
- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1\mecoffe3d-paused.png`：暂停验收补充图。
- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1\mecoffe3d-completed.png`：完整 30 天演示结束、人物返程队列清空。

## 已知缺口

1. 31 栋楼均无 OSM 高度/楼层标签；采用分类默认层数×3.2 米，来源标记为 default，不是实测建筑模型。无立面精修、室内和带骨骼动画的人物。
2. OSM 覆盖不是校园建筑清单，北侧区域等未记录建筑不会被凭空补齐；原始路网有断开的分量。
3. 住房、门口散开位置和两店对应均为展示安排。两店示意对应师生活动中心、教工食堂，不代表实际咖啡店位置。
4. 图上的最近节点不是实测入口。人物从示意楼门安置点切换到道路起点，往返严格走 OSM 边；缺失的楼门接路、门禁、坡度和动态障碍没有模拟。
5. 购买事件先由原数据确定，再播放出行；位置不会反向影响 OASIS 决策。100 米/秒的基础移动速度仅服务回放，不能作为校园出行耗时。
6. 新版演示仍是规则脚本；网络模式没有行为；历史运行仍为失败的不完整原记录。本阶段未调用模型，也未生成新 OASIS 运行。

## 视觉验收修正（2026-11-03）

按 Claude 功能验收后的四项观感反馈追加修正，继续使用 `feat/campus-3d`，无新依赖、无地图或行为数据变更。

- 全景按真实校园边界点和建筑屋顶进行透视适配，限制轴约 80%，不再用包含道路及空角的包围盒。宽屏将校园长轴横向展开（1230×650 画布投影宽约 70.27%、高 80%）；窄屏采用南侧视角，五种画布尺寸均未裁切。地面包围平面在边界外仅留 12 米。
- 人物按相机和画布 CSS 尺寸计算均匀显示缩放，包围盒至少 12 CSS px，行走时加浅色光圈。人物位置、A* 路线、速度、订单和回放逻辑不变；点击区域与选中环跟随显示尺度。顶视、远近、resize、DPR 独立性有回归测试。
- 仅八个映射楼栋保留默认 DOM 标签，固定 12px 字号；含门店示意说明，采用引线、边缘限制与重叠避让。其他楼栋仍可悬停。相机改变才重排标签；自然文字宽度留像素余量，避免分数缩放导致末字省略。
- 删除 `.gitattributes` 全仓库 `* text=auto`，保留原 ps1/cmd、来源 JSON、前端场景 JSON 和 OSM 的定向规则；未运行全仓库 renormalize，未修改系统 Git 配置。

本轮文件：`.gitattributes`、`README.md`、本记录、`frontend/src/views/MeCoffe3D.vue`、`frontend/src/mecoffe/Campus3DScene.js`、`frontend/src/mecoffe/campus3dView.js`、`frontend/src/mecoffe/campus3dScreen.js`、`frontend/tests/campus3dView.test.js`、`frontend/tests/campus3dScreen.test.js`、`frontend/tests/campus3dScene.test.js`。

验收命令：`python -X utf8 -m unittest discover -s adapter` **36/36**；`frontend` 下 `npm test` **44/44**（本轮增加 13 项）；`npm run build` **通过**。仍有原先的大分块、上游静态/动态混合导入提示。

浏览器按 1600×1000 验证初始全景、手动缩放后“全景”恢复、历史第 2 天购买和暂停。八个标签均为 12px、全景无截断；缩放后仍为 12px。反复切换三种数据模式，画布始终 1 个、标签层 1 个、标签 8 个；控制台无 error/warn。

新截图：

- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1-visual\mecoffe3d-overview-1600x1000.jpg`
- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1-visual\mecoffe3d-history-day2-1600x1000.jpg`
- `C:\Users\Lenovo\Documents\Claude\mecoffe-scene\logs\phase1-visual\mecoffe3d-zoom-1600x1000.jpg`
