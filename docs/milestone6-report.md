# 里程碑 6 验收记录

日期：2026-11-04。分支 feat/asset-library，基线 a62c2f0。仅本地提交，不 push。main 保持 ee17353a4de200d87eca7ad828ca586511252d62。

## 改动与边界

- 删除人物匹配/外观分配的实现说明；加载进度移到地图浮层，就绪即隐藏，避免进度条反复改变画布尺寸。画像与服装选择逻辑保持原样。
- 素材库移除范围筛选，默认显示全部 349 项；保留搜索、类别、来源、分页。只绘制可见卡片；静态卡片在加载、滚动、旋转时重绘。
- 复用原有植被/家具实例化，新增 YuLan 楼体/屋顶静态合并与材质组索引压缩；远景人物使用保留 UV/骨骼权重的网格 LOD，特写保留全模。屏幕外不更新动作，站立/步行动画按需节流。
- 静态阴影按太阳角度与装饰变化刷新；保留 DPR 上限 1.5；面板约 5Hz 更新。低于 30 FPS 的持续窗口自动降级一次，手动画质优先。
- 高开销展示走廊/局部避让交给 Worker；缓存静态空间查询并加精确包围盒排除。动态局部搜索先用小预算，必要时只对最终目的地用完整预算。原始 OSM A* 模块及其结果未改。
- 动画默认每家门店最多两个往返，其余按原事件顺序排队；不丢弃订单、事件或关注关系。原 12 并发交通压力测试明确放开入场限制，保留所有原碰撞/水域/校界/120 秒内归零断言，另测默认队列策略。
- 新增 scenario 清单生成、校验、日期/光照映射、加载页与 VS Code 任务；地图可用归档/范围 OSM、GeoJSON 或已有包。中科大使用原历史轨迹，NUS 按小时且无轨迹。
- 许可证已复核：Kenney CC0 不强制署名；VALID MIT 要求保留 Tiffany Do 2022 版权声明与完整许可。catalog 和 NOTICE 已同步，原许可证和模型字节不改。

## 性能实测

环境：Windows，本机 Chrome headless，1600×1000、DPR=1，RTX 4060 Laptop / ANGLE D3D11，Vite 开发服务 5180。Browser 插件未提供，使用现有 Playwright。

同一脚本先历史模式、4×播放、预热 4 秒、目标采样 12 秒；分别强制程序化/YuLan、高画质（关闭自适应干扰）。基线在任何源码修改前记录。库页两次均为全部素材首页。绘制次数/三角形从真实 GL 调用计数，包含阴影和后处理，不使用最后一次 pass 的 renderer.info 充当整帧值。

| 场景 | FPS 前→后 | 最差帧 ms 前→后 | draw calls/帧 前→后 | 三角形/帧 前→后 | GL纹理句柄 前→后 | JS堆 MiB 前→后 |
|---|---:|---:|---:|---:|---:|---:|
| 程序化基底（DEV 强制） | 5.6 → 87.6 | 5950.0 → 1341.7 | 1496 → 1154 | 3785908 → 519102 | 276 → 238 | 165.9 → 230.5 |
| YuLan（页面默认） | 2.9 → 81.0 | 3925.0 → 1258.3 | 4304 → 1168 | 4047321 → 614083 | 281 → 238 | 154.3 → 114.7 |
| 素材库静态首页 | 240.0 → 240.0 | 5.2 → 4.6 | 222 → 0 | 10256 → 0 | 13 → 13 | 29.3 → 27.1 |

补充：

- FPS 是 rAF 采样间隔的均值；素材库静态首页仍有约 240Hz 的轻量探针回调，但 GPU 实际重绘由每帧 222 calls 降为 0，并非静态图片有 240FPS 动画。人物预览卡片只在可见时更新，最高 30Hz。
- 最差帧仍约 1.3 秒，未消除所有偶发尖峰；YuLan 的 P95 帧时长从约 2879ms 降到约 16.6ms，程序化从约 984ms 降到约 12.6ms。
- GL 纹理是 create/delete 句柄计数，不是显存字节。销毁上下文隐式释放不等同于 delete 调用；当前 Three.js 活跃纹理更可直接比较：程序化 268→230，YuLan 273→230。素材库是单上下文，13→13。
- JS堆为瞬时 CDP usedSize，未强制 GC；程序化瞬时堆升高，本轮没有把这一指标优化下来。多轮 GC 后的稳定性检查单列，不将瞬时值冒充泄漏结论。
- 低帧率旧版在相同墙钟窗口只推进到第 2 天，新版推进到第 4 天；两者输入与4×速度相同，但动画活跃集不完全相同。数字是此开发环境的实测，不能保证其他显卡或发布构建相同。

原始记录：logs/milestone6/perf-before.json、perf-after.json；复测命令 node scripts/benchmark-campus.cjs after。可用 PLAYWRIGHT_MODULE 指向现有 Playwright 安装。

## 测试与浏览器检查

- python -X utf8 -m unittest discover -s adapter：77 项通过。
- frontend 下 npm test：191 项通过，包含材质合并、LOD、自动画质优先级、时间映射、清单校验/可复现、丢文件/坏 JSON、队列策略及原空间安全回归。
- frontend 下 npm run build：通过；沿用大包 chunk 提示，没有新增依赖。
- python -m adapter.scene_builder scenario --manifest scenarios/ustc-history.json：成功。历史人物/事件/关系/地图/地点映射与原文件语义一致，原历史仍 23 天完整、第 24 天部分记录。
- python -m adapter.scene_builder scenario --manifest scenarios/nus-hourly.json：成功。226 栋建筑、840 段道路、1280 项原型分配，无模拟轨迹；06:00→12:00 时光照实际改变。
- node scripts/milestone6-browser-check.cjs：见 logs/milestone6/qa.json 与 qa-final-run.txt。检查页面内容、349 项全量筛选、上下文丢失后重载、404/坏 JSON 的明确错误、20 次模式/风格切换、完整30日4×与后续60秒观察、自动降级及手动覆盖。

## 已知限制

1. 播放采样中仍出现约1.3秒慢帧，平均FPS提升不代表没有卡顿尖峰。
2. 240笔订单都保留，但为了避免门店拥堵和同时渲染过多人，时间轴结束后动画会继续排队。额外的“300秒内所有往返归零”观察没有完成；队列在持续减少，不超时丢弃，也不影响已经完成的898条事件/240笔订单统计。
3. 模拟时间由清单配置；中科大示例日期是展示设定，不能当成历史运行的真实日历日期。太阳角度按钟点示意，不是天文测绘。当前清单契约仍为草案，需调度器确认地点ID和step语义。
4. 顶部空间“示意”提示、原始 OASIS 数据、源 OSM、地点映射、原始 A* 以及二维页面保持不变。高度/人物位置依旧遵循原有展示限制。

## 截图（1600×1000，本机文件）

- logs/milestone6/01-campus.png：全景，正午光照预览，加载后说明隐藏。
- logs/milestone6/02-assets.png：全部素材首页，范围下拉已移除。
- logs/milestone6/03-nus-hourly.png：NUS scenario，12:00，无模拟数据。
- logs/milestone6/04-ustc-history.png：中科大 scenario 的历史行走。
- logs/milestone6/05-demo-day30.png：30日数据播放完成及继续排队的真实状态。

## 改动文件

- .vscode/tasks.json
- NOTICE.md
- README.md
- adapter/build_asset_catalog.py
- adapter/scene_builder/__main__.py
- adapter/scene_builder/scenario.py
- adapter/test_scenario.py
- docs/map-input-contract.md
- docs/milestone6-report.md
- frontend/public/mecoffe/assets3d/catalog.json
- frontend/public/mecoffe/scenarios/nus-hourly/asset_assignments.json
- frontend/public/mecoffe/scenarios/nus-hourly/campus3d.json
- frontend/public/mecoffe/scenarios/nus-hourly/landcover.json
- frontend/public/mecoffe/scenarios/nus-hourly/location_mapping.json
- frontend/public/mecoffe/scenarios/nus-hourly/scenario.json
- frontend/public/mecoffe/scenarios/ustc-history/asset_assignments.json
- frontend/public/mecoffe/scenarios/ustc-history/campus3d.json
- frontend/public/mecoffe/scenarios/ustc-history/landcover.json
- frontend/public/mecoffe/scenarios/ustc-history/location_mapping.json
- frontend/public/mecoffe/scenarios/ustc-history/scenario.json
- frontend/public/mecoffe/scenarios/ustc-history/surroundings.json
- frontend/public/mecoffe/scenarios/ustc-history/trajectory.json
- frontend/src/components/Campus3DVisualControls.vue
- frontend/src/mecoffe/AssetPreviewRenderer.js
- frontend/src/mecoffe/Campus3DEnvironment.js
- frontend/src/mecoffe/Campus3DRealCharacters.js
- frontend/src/mecoffe/Campus3DScene.js
- frontend/src/mecoffe/MapSceneRenderer.js
- frontend/src/mecoffe/YuLanCampusStyle.js
- frontend/src/mecoffe/campus3dCrowd.js
- frontend/src/mecoffe/campus3dDetour.js
- frontend/src/mecoffe/campus3dEnvironmentModel.js
- frontend/src/mecoffe/campus3dSpatial.js
- frontend/src/mecoffe/campus3dTerrain.js
- frontend/src/mecoffe/renderPerformance.js
- frontend/src/mecoffe/scenario.js
- frontend/src/mecoffe/spatialWorker.js
- frontend/src/views/AssetLibrary.vue
- frontend/src/views/MapScenePreview.vue
- frontend/src/views/MeCoffe3D.vue
- frontend/src/views/MeCoffe3DEntry.vue
- frontend/src/views/ScenarioEntry.vue
- frontend/tests/campus3dTraffic.test.js
- frontend/tests/milestone6.test.js
- scenarios/nus-hourly.json
- scenarios/ustc-history.json
- scripts/benchmark-campus.cjs
- scripts/milestone6-browser-check.cjs

## 最终稳定性复跑（与本次源码一致）

- 20 次模式/风格切换，强制 GC 后 JS 堆 71.9–79.2 MiB；每轮 1 个校园画布、196 个当前 Three 纹理、603 个几何。后六次与同模式/风格前六轮比较在 12 MiB 容差内，没有场景资源数量逐轮叠加。
- 30 天 ×4 时间轴在 90.9 秒播完，继续观察到 151.3 秒，898 条事件、240 笔订单全部保留；动画队列从 181 降到 148，每家门店最多两个在途。
- 后续六个 10 秒窗口帧率 105.1–113.7 FPS；该段最差帧 25.2ms。强制 GC 的主线程堆由 70.8 到 79.3 MiB，没有随播放持续大幅增长。
- WebGL 中断→重载恢复、两类 JSON 故障、强制低帧率窗口触发降画质、手动高画质优先，全部通过。正常操作没有 pageerror。

末次截图复核同时修正了 NUS 光照与原灯光系统的06:00相位约定：12:00 实测太阳强度2.35，次日00:00为0.12，天空同步变为夜色；新增单元断言、浏览器强度断言并重取03截图。额外记录为 logs/milestone6/nus-lighting.json。
