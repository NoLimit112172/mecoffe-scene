# 中科大高新校区三维视觉升级验收记录

日期：2026-11-03。页面：<http://127.0.0.1:5180/mecoffe3d>。

## 分支与范围

- 从 `main` 的 `fec4d97c96d4ec73b574b70e1ab40937630f3255` 新建 `feat/campus-3d-visual`，仅本地提交，不 push。main 保留原提交。
- 保留 5180 原服务，未停止或重启进程；`/mecoffe` 与 `/mecoffe3d` 均返回 HTTP 200。
- 原二维页面、`replay.js`、`layout.js`、三维 routing/playback/view 纯函数、原 scene/data/source/data/osm、三种数据模式 JSON、原三维 geometry/mapping JSON、package.json、package-lock.json 和 `.gitattributes` 相对 main 均无差异。
- 顶部提示逐字保留：**建筑与道路来自 OpenStreetMap；人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据**。
- 新增图层只读取已有 OSM 快照：八块运动场与永怀湖，共九块地表，不增改建筑、道路节点、边、楼高或地点映射。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `frontend/src/mecoffe/Campus3DScene.js` | 接入三类显示管理器、楼顶人数徽标、18/26px 人物显示下限、特写避障相机、杯子交付与视觉效果续播；路线/FIFO/订单统计不变 |
| `frontend/src/views/MeCoffe3D.vue` | 接入视觉开关、独立地表图层、图例和特写入口；视觉活动独立计数，不写入事件或订单统计 |
| `frontend/src/components/Campus3DVisualControls.vue` | 高/低画质、日夜循环和正午/傍晚/夜晚预览 |
| `frontend/src/mecoffe/Campus3DEnvironment.js` | 天空/雾/光照、窗纹与夜间亮窗、屋顶边缘、门店招牌和遮阳棚、地表材质、实例化装饰树及家具 |
| `frontend/src/mecoffe/campus3dEnvironmentModel.js` | 纯函数：昼夜参数、建筑配色、固定随机种子、窗户亮灯掩码与避让布点 |
| `frontend/src/mecoffe/Campus3DCharacters.js` | 实例化低多边形角色，面部/四肢/角色服装/步行动画/咖啡杯 |
| `frontend/src/mecoffe/Campus3DEffects.js` | 发帖评论气泡、评论关注弧线、广告光束粒子、到店金额收据及选择性辉光 |
| `frontend/src/mecoffe/campus3dPresentation.js` | 纯显示时钟、站立代表抽样、示意楼内人数 |
| `adapter/osm_landcover.py` | 验证保存快照 SHA-256，提取并裁剪 OSM 运动场/水面/停车场地表 |
| `frontend/public/mecoffe/campus3d_landcover.json` | 新增独立 OSM 衍生显示图层，复用原来源与投影信息 |
| `adapter/test_osm_landcover.py` | 新增三个地表转换/来源/裁剪测试 |
| `frontend/tests/campus3dCharacters.test.js` | 外观、朝向、走路动作、实例变换、杯子与品质开关测试 |
| `frontend/tests/campus3dEffects.test.js` | 事件参与者、收据、弧线、效果上限、异常恢复、阴影隔离测试 |
| `frontend/tests/campus3dEnvironment.test.js` | 光照、配色、可复现纹理与装饰避让测试 |
| `frontend/tests/campus3dPresentation.test.js` | 显示时钟、抽样与徽标人数测试 |
| `frontend/tests/campus3dScene.test.js` | 保留原测试，新增到店交杯/seek清理、纯事件续播、夜窗悬停恢复与特写避障集成测试 |
| `README.md`、`NOTICE.md` | 操作、数据边界、素材来源与许可说明 |
| `frontend/public/mecoffe/assets3d/README.md` | 程序生成资源清单，无外部下载模型或贴图 |
| `docs/campus3d-visual-delivery.md` | 本记录 |

所有装饰在图例标为“装饰”；建筑高度仍使用原默认值。树木/路灯/长椅采用固定种子布点，并避开源楼栋、道路、校园孔洞和新增水面/运动场。保留全部人物条目，只隐藏多数静止代表以减少拥挤，楼顶徽标表示示意楼内人数。到店交杯和收据由原行走到达触发，不能在尚未到店时出现。

## 测试与构建

| 命令与目录 | 结果 |
| --- | --- |
| 根目录 `python -X utf8 -m unittest discover -s adapter` | **39/39 通过**（原 36 项 + 新 3 项） |
| `frontend/` 下 `npm test` | **68/68 通过**（原 44 项 + 新 24 项，含四个渲染器集成回归） |
| `frontend/` 下 `npm run build` | **通过**，Vite 6.3.2，2916 modules，约 20 秒 |
| 根目录 `git -c core.whitespace=cr-at-eol diff --check` | **通过** |
| 已安装 Google Chrome 156.0.8078.48，无头模式、1600×1000 | **交互与四张截图检查通过** |

Python 中输出的 SHA 不匹配和 snapshot_revision 非法提示来自故意损坏输入的拒绝测试，测试结果为 OK。

浏览器检查覆盖：历史第 2 天购买后沿原路网行走；暂停时画布不变（容许少量 GPU 1/255 舍入差，最后一次比较 2 个通道差 1）；画质高低来回切换；关系网络禁止播放；规则演示保留第 30 天；八个固定地点标签；原顶部提示；单条发帖等效果正常完成并回到暂停。页面无 error；有三条上游全局 AudioContext 自动播放限制 warning，不涉及新增视觉代码，未改二维或全局声音模块。

额外修复并验证：底板与草地之间的离屏深度冲突条纹；辉光隔离时冻结阴影更新、正常材质主渲染再刷新阴影；建筑 hover 保存并还原 emissive，避免熄灭夜窗；单步或时间轴末尾的非购买效果可完成，不会永久冻结。

## 四张交付截图

所有 PNG 均由 **headless Chrome** 生成，尺寸 **1600×1000**，历史模式第 2 天；人物特写为第一笔订单的实际行走动画停帧。

根目录下：

1. `logs/phase1-visual/noon.png`：正午全景。
2. `logs/phase1-visual/dusk.png`：傍晚全景。
3. `logs/phase1-visual/night.png`：夜晚全景，固定种子亮窗与路灯。
4. `logs/phase1-visual/walking-person.png`：人物走路特写，可见脸部、服装、手脚与姓名。

同目录 `browser-checks.json` 记录浏览器版本、检查结果、暂停像素比较、warnings 及性能样本；`capture.cjs` 是本机截图自动化脚本，使用 Codex 自带 Playwright 和 sharp，未向项目添加依赖。`logs/` 按原 .gitignore 保持不入库，截图保存在本机供验收。

## 来源与已知限制

- **新美术全部程序生成**：无外部模型/贴图，无额外 CC0 下载；新增代码生成的资源随项目源码提供。OSM 几何保持 © OpenStreetMap contributors、ODbL 1.0 署名。Three.js 及 addons 按已有 MIT 许可使用，未升级依赖。
- 安装的 Three.js r187 已移除 PCFSoftShadowMap，使用受支持的 PCFShadowMap + radius 2.8 产生柔和阴影，避免移除 API 的警告。
- 建筑仍是源轮廓加默认高度体块，并非精细建筑模型；窗户/屋顶/招牌/树木/灯具/草地/场线/日夜节奏都是风格化显示，不是实测设施、作息或天气。门店继续标“示意”。
- **未接入空间决策 agent**。人物住楼、位置与往返是展示安排；A* 路线、动画速度不参与 OASIS 推理。三种模式的数据含义没有变化，历史失败运行没有补造第 25—30 天。
- 性能样本来自本机 **RTX 4060 Laptop GPU**：高画质播放期间 5 秒 rAF 均值约 200.6 fps，p95 约 8.4 ms；这是无头浏览器帧回调节奏，不等于跨设备性能保证。**未在集成显卡上实测**，低画质关闭阴影、辉光及树木，并降低像素比供较弱设备使用。
- 构建保留原上游 CharacterFactory 动态/静态导入提示和大 chunk 提示；三维页面约 712 kB、上游主包约 3.25 MB（压缩前），本轮未调整全站拆包或原二维代码。
