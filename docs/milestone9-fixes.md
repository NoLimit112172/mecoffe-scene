# 里程碑 9 追加修正

基线为 `feat/indoor` 的 `6b5a330`，追加一个 `milestone 9 fixes:` 本地提交，不改写初版。提交号以 `git log -1 --format=%h feat/indoor` 为准。没有 push、合并或改 main；5180 服务保持运行。本次只处理中科大，NUS 文件未重写，仅通过原页面和 Pages 回归。

## 五项反馈

1. **清晰标注**：事件气泡的 Canvas 至少按 2 倍设备像素绘制，上限 3 倍；使用线性放大和 mipmap 缩小过滤。发帖、评论、关注、广告和咖啡图标用 Canvas 矢量路径重新绘制，不引用二维位图或依赖系统 emoji。气泡保持约 34 CSS 像素高。楼名、人数、入口、人物定位标记使用屏幕像素的 DOM；人数文字从 9px 提高到 11px。GIS 的标注继续使用矢量文字及 DOM。装饰性图标对读屏隐藏，不再混入“全景”等按钮的名称。
2. **关系线**：Three.js 自带 Line2 / LineMaterial，宽 2.8 CSS 像素、半透明，随视口自动更新。蓝色表示关注他人，金色表示被关注。修复楼内人物选择后直接返回、不生成关系线的问题；楼内端点连接所在楼栋屋顶，室外端点跟随人物。同一个人重复选择保留已有线资源，更新点位复用缓冲。
3. **人物去向**：共享状态检查室外人数、各楼楼内人数、总人数、未知楼栋、重复身份和无效坐标；页面显示“人物去向”。模型尚未准备好或被楼体遮挡时，室外人物保留可点击的 DOM 定位点。近景仅绘制需要的模型，楼内人物仍隐藏。离开当前相机视口的人不会强行钉在屏幕边缘，仍可从列表定位。
4. **每栋楼一个门，门在墙中段**：合并外轮廓的共线墙段，从朝道路的墙段中点中推断唯一入口，避免把门放在转角或棱边。门框与墙面法线对齐，31 栋楼用三批实例化几何绘制。去程与返程使用同一入口；进门约 0.5 展示秒，沿法线向楼内移动约 2 展示米并缩小，完成后隐藏且计入楼内。门店停留、持杯出门、进家门逻辑保留。入口仍是示意，不冒充实测门。
5. **两家门店**：`shop_merchant_001` → 学生食堂B区（`way/1435377506`）；`shop_merchant_002` → 教工食堂（`way/1435377504`）。修改公开映射源文件和 scene 副本，再生成中科大包，更新地点映射、GIS 建筑/点位、入口、清单及目录哈希。原 OASIS 人物、事件、订单、关系、地图几何和 A* 道路图不变。两店均保留“示意”。

## 人数与路线证据

- 全回放每隔 0.025 天采样：室外渲染对象加楼内人数恒为 100，坐标有限；步行者不进入建筑轮廓、不离开建成区展示范围。进门阶段允许沿法线穿过门所在墙面，随后隐藏。
- 两页在回放位置 `2.5` 的完整检查对象相同：`visible:4, inside:96, total:100, accounted:100, unassigned:0, valid:true, issues:[]`。全景内四个室外 DOM 标记都实际可见。
- 浏览器在沙盘和 GIS 各点击全部 100 个名册条目，全部能定位到对应楼栋并显示“在某楼内（示意）”。不是只验证人数加法。
- 每栋楼恰好一个入口；全部 12 条购买走廊的往返起终点与对应入口相同。原图节点和边未修改。
- `logs/milestone9/fixes-invariants.json` 核对相对初版的场景变化：仅目录、中科大入口/映射及相关派生 GIS/清单变化；NUS 全部文件、原轨迹及地图/道路图字节不变。

## 长帧排查与处理

CPU 采样发现原始 FBX 的面片生成/解析（`FBXLoader.genFace`）在运行期间占据明显耗时。将已有 9 个 VALID 模型离线转换为 GLB，预先合并骨架/顶点、保留身体/眼睛及中性脸形、移除本回放未使用的面部变形目标、纹理最高 1024px。GLB 约 2.9–5.3 MB/个，原始 FBX 不改写，原 Git blob 和 SHA-256 保留。manifest 新增 GLB 路径、SHA-256 和大小，仍附原 MIT 许可及 Copyright (c) 2022 Tiffany Do；没有下载新人物或新增依赖。

运行时按需加载 GLB，显示前使用既有 renderer.compileAsync 准备材质；等待期间显示定位点。着色器尚未准备完的模型不直接进入绘制。转换脚本为 `node scripts/prepare-valid-runtime.cjs`，需要既有本地开发服务及 Chrome/Playwright，仅处理本地归档素材。

正式测量为 Chrome headless、1600×1000；帧率使用已加载完成并实际播放后的窗口。早期长任务探针曾包含页面初始化，不能用该段约 900ms 的初始化任务当作播放卡顿；最终探针已修正采样起点。内存为主线程 JS heap，不包含 GPU、worker 或进程 RSS。

| 采样 | 平均 FPS | 最差帧/任务 | JS heap |
| --- | ---: | ---: | ---: |
| 初版沙盘，Pages，4×、高画质、自动昼夜，12秒 | 137.55 | 1041.8 ms 帧间隔 | 106.47 MiB |
| 修正后沙盘，相同条件，12秒 | 102.98 | 37.5 ms 帧间隔 | 68.08 MiB |
| 修正后 GIS，全景回放，10秒 MapLibre render 间隔 | 89.49 | 16.9 ms 帧间隔 | 60.72 MiB |
| 修正后沙盘，本地实际开始播放后，4×、30秒 CPU采样 | 不用 profiler 计算 FPS | 最长主线程任务 53 ms | 未用作内存测量 |

最差帧大幅改善，12秒与30秒样本都未重现约1秒的播放停顿。平均 FPS 波动且本轮 Pages 沙盘平均低于初版；不宣称所有指标都提升，仍高于既有里程碑6 YuLan约81 FPS的基线。另一轮本地12秒采样为163.58 FPS、最差20.9ms；不以最好的一次代替正式Pages结果。初次进入仍有模型/纹理及GPU初始化耗时，不等同于运行中完全无卡顿。

原始证据：`fixes-cpu-fbx.json`、`fixes-profile-playback-run.txt`、`fixes-longtasks-playback.json`、`fixes-indoor-pages-qa.json`、`fixes-gis-pages-qa.json`，均在 `logs/milestone9/`。

## 测试与构建

以下从项目根目录执行，全部通过；原始日志位于 `logs/milestone9/`，不提交运行证据到 Git。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 85项通过 | `fixes-python-tests.txt` |
| `npm --prefix frontend test` | 224项通过，0失败/跳过 | `fixes-frontend-tests.txt` |
| `npm --prefix frontend run build` | 通过，保留已有大chunk提示 | `fixes-build.txt` |
| `npm --prefix frontend run build:pages` | 通过 | `fixes-build-pages.txt` |
| `npm --prefix frontend run check:pages` | 通过 | `fixes-check-pages.txt` |
| `node scripts/audit-public.cjs` | 无发现 | `fixes-public-audit.json` |
| `node scripts/test-pages.cjs` | 11个入口直达/刷新、原页面交互通过 | `fixes-legacy-pages-qa.json` |
| `node scripts/test-gis.cjs --pages` | 两场景、人物、查询、图层和目录回归通过 | `fixes-gis-pages-qa.json` |
| `node scripts/test-indoor.cjs` | 进出楼与两页人数一致通过 | `fixes-local-qa.json` |
| `node scripts/test-indoor.cjs --pages` | 同上，含性能采样 | `fixes-indoor-pages-qa.json` |
| `node scripts/test-indoor-fixes.cjs` | 100人定位、31个门、门店、关系线和清晰标注通过 | `fixes/local-qa.json` |
| `node scripts/test-indoor-fixes.cjs --pages` | 严格静态子路径下同样通过 | `fixes/pages-qa.json` |

严格静态 Pages 服务不提供 SPA 回退。检查无页面错误、无404、无遗漏根路径请求。产物约125.05 MB、393个文件，低于300MB；新增9个GLB约32MB，保留原FBX供原始素材/来源查看，未改变完整素材库行为。两页均使用BASE_URL加载，无需API Key。

## 改动文件

- 生成与测试：`adapter/scene_builder/entrances.py`、`adapter/test_entrances.py`；`frontend/tests/indoorFixes.test.js`。
- 映射源：`frontend/public/mecoffe/campus3d_mapping.json`、`scene/campus3d_mapping.json`；中科大包的入口、地点映射、GIS buildings/pois/entrances、scenario.json及目录index.json。
- 标注和门：新增 `Campus3DAnnotations.js`、`Campus3DEntrances.js`；修改 `Campus3DEffects.js`、`Campus3DIndoor.js`、`Campus3DScene.js`、`indoorMotion.js`。
- 人物与GIS：`Campus3DRealCharacters.js`、`gis/CharacterLayer.js`、`gis/IndoorLayer.js`、`gis/MapLibreScene.js`；`MeCoffe3D.vue`、`MeCoffeGis.vue`。
- 资源：`frontend/public/mecoffe/assets3d/valid/manifest.json`及9个同名GLB；`assets3d/README.md`、`NOTICE.md`。
- 发布与工具：`frontend/pages/build-tools.mjs`、`scripts/test-gis.cjs`；新增 `scripts/prepare-valid-runtime.cjs`、`scripts/test-indoor-fixes.cjs`。
- 文档：README、人物进楼约定、地图契约、初版交付记录及本文。

## 截图与边界

截图均为1600×1000、Pages子路径实测，位于本机 `logs/milestone9/fixes/`：

- [两家食堂的门店位置](../logs/milestone9/fixes/cafeterias.png)
- [加粗的双向关系线](../logs/milestone9/fixes/relations.png)
- [外墙中段的楼门](../logs/milestone9/fixes/door-centre.png)
- [清晰图标与标签近景](../logs/milestone9/fixes/labels-closeup.png)
- [沙盘：室外4＋楼内96＝100](../logs/milestone9/fixes/accounting.png)
- [GIS：同一时刻相同人数](../logs/milestone9/fixes/gis-accounting.png)

只验证了当前设备上的短时窗口、完整回放状态采样及重复选择；未宣称小时级无泄漏、所有设备同帧率或首次加载零停顿。外墙中点、进门距离和购物时长均是展示设定；没有实测入口、真实室内平面或新增OASIS空间决策。室外人数是可渲染/可定位的人数，缩放到局部时视口外的人不强制显示在屏幕里。
