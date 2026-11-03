# 三维校园第三轮：像素人物、建成区裁剪与周边道路

日期：2026-11-03。页面：<http://127.0.0.1:5180/mecoffe3d>。

## 分支和边界

- 从本轮开始时 `main` 的 `7e550328705d2e901eaad32ea7add032022fe1d9` 新建 `feat/campus-3d-polish`，只在该分支本地提交，不 push，不修改 main。
- 原 `/mecoffe` 页面、`CampusScene.js`、`layout.js`、`replay.js`、原图集、三种回放模式数据、地点映射和步行图均未改。
- 原始校园 OSM XML、metadata 和 `scene/campus3d.json` 均未覆盖；新增周边数据使用独立文件，校外道路不进入 A*。
- 保留顶部原文：**建筑与道路来自 OpenStreetMap；人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据**。
- 未结束或重启 5180 原服务。截图脚本启动的临时无头 Chrome 在检查结束后自行关闭。

## 结果

### 默认 YuLan 像素人物

直接复用仓库原有 `public/assets/bgrd-0..2.json/png`，从二维 `layout.hashOf` 取得同一哈希，使用相同的性别、服装类型/变体、脸部、眼睛、嘴、上下层头发规则。支持原图集的 rotation/trim/sourceSize，还原身体与头部叠放；本轮未修改任何图集文件。

Sprite 始终朝向镜头，脚底锚定，整个人物使用 8.5 世界显示单位作为基准，按屏幕尺寸自动放大。静止代表最低 30 CSS px，行走/选中最低 40 CSS px。站立用第一帧，行走用原三帧、10.8 fps；根据路线前进方向在当前镜头左右翻转，暂停冻结。只在到店后显示头顶咖啡杯，返回保留，seek 清除。身份颜色改由脚下标记表示，图例同步说明；右上角“人物：像素 / 立体”默认像素，保留原低多边形备选。

### 建成区显示裁剪

建成区核心取全部楼栋和现有六个住所到两个门店的十二条 A* 路线，再留 50 米余量。实际窗口为：

```text
x/east:  -422.118 ... 410.667 m
y/north: -523.007 ... 70.154 m
```

原视角右侧的大片无楼栋空地不再绘制，通向该区域的小路在窗口截断。原数据保留完整边界；地面、边界、道路、landcover 和装饰只使用运行时显示副本，原 walk_graph/buildings 保留只读引用。全景相机另留 60 米周边观察余量，没有以外扩 300 米下载框重新铺满草地。显示窗口内默认有 100 棵装饰树、20 盏灯和 12 张椅子，仍标为“装饰”。

### 周边马路与真实路名

OSM 官方 map API 的独立快照，原 bbox 四边外扩约 300 米：

- URL：<https://api.openstreetmap.org/api/0.6/map?bbox=117.11622475,31.81530204,117.13147525,31.82969796>
- 下载时间：`2026-11-03T06:48:55.924494+00:00`
- 原始 XML：`data/osm/ustc_gaoxin_surroundings.osm`，1,079,979 bytes。
- SHA-256：`fe07a4f4caf8b29566c4352d38601a376b2e59be5bc0cffaad56a19f8c5a5da7`
- metadata：`data/osm/ustc_gaoxin_surroundings.metadata.json`
- 派生文件：`frontend/public/mecoffe/campus3d_surroundings.json`，108 个裁剪后的 highway 分段，沿用原校园米制投影。

此次实际取得 **8 个原 name 路名**：

**中颍南支路、习友路、创新大道、华佗巷、复兴路、梅岭巷、燕子河路、石莲南路**。

前端在建成区外约 115 米上下文内绘制校外部分，共 37 段；当前全景显示 **习友路、创新大道、复兴路、石莲南路** 四个固定 12px 路牌，每个原名一个标签，无名不标。道路按等级、原 lanes/oneway 画沥青、分道线、人行道和路缘，地下 tunnel 段只作淡虚线，不画地面人行道。图层按顺序覆盖且不互写深度，避免近共面白斑；高画质主渲染目标加受硬件上限约束的 4× MSAA，角色贴图仍用 NearestFilter。

## 改动文件（25 个）

| 文件 | 用途 |
| --- | --- |
| `frontend/src/mecoffe/Campus3DPixelCharacters.js` | 加载原图集、预合成三帧、billboard/翻转/杯子与身份标记 |
| `frontend/src/mecoffe/campus3dPixelModel.js` | 外观哈希、部件布局、帧选择、方向与裁剪纯函数 |
| `frontend/src/mecoffe/campus3dDisplay.js` | 建成区窗口、保留原路线、polygon/polyline/landcover 裁剪 |
| `frontend/src/mecoffe/campus3dRoadModel.js` | 校外道路剔除、宽度分级、可见路段中点与原名去重 |
| `frontend/src/mecoffe/Campus3DSurroundings.js` | 六个道路几何批次与固定像素路牌 |
| `frontend/src/mecoffe/Campus3DScene.js` | 接入显示副本、像素/立体切换和周边道路；保留原路由上下文 |
| `frontend/src/mecoffe/Campus3DEnvironment.js` | 按展示窗口裁地表和装饰、保留三类家具 |
| `frontend/src/mecoffe/Campus3DEffects.js` | 主渲染目标的多重采样，减少远处道路线条锯齿 |
| `frontend/src/mecoffe/campus3dPresentation.js` | billboard 独立 CSS 像素缩放 |
| `frontend/src/components/Campus3DVisualControls.vue` | 默认像素/立体开关 |
| `frontend/src/views/MeCoffe3D.vue` | 新增道路数据读取和图例；图集加载完前禁用按天跳转，避免点击被忽略 |
| `adapter/osm_surroundings.py` | 独立 OSM 下载、SHA 校验和原投影下的道路提取 |
| `adapter/test_osm_surroundings.py` | 下载范围、来源、提取与哈希拒绝测试 |
| `data/osm/ustc_gaoxin_surroundings.osm` | 独立保存的原始周边 XML |
| `data/osm/ustc_gaoxin_surroundings.metadata.json` | URL、UTC、范围、SHA、ODbL 署名 |
| `frontend/public/mecoffe/campus3d_surroundings.json` | 仅显示用道路 JSON，无新图节点/边 |
| `frontend/tests/campus3dPixelCharacters.test.js` | 三种真实 roster 外观、帧、图集还原、朝向与暂停等 |
| `frontend/tests/campus3dDisplay.test.js` | 真实建成区/十二路线、边界孔洞和分段裁剪等 |
| `frontend/tests/campus3dRoadModel.test.js` | 宽度、剔除校内段、路牌去重、真实下载与资源释放等 |
| `frontend/tests/campus3dPresentation.test.js` | 新增 billboard 屏幕尺寸测试 |
| `frontend/tests/campus3dScene.test.js` | 新增样式切换保留位置/排队/暂停和校外道路不入图测试 |
| `README.md` | 使用方式、裁剪与道路来源说明 |
| `NOTICE.md` | YuLan 许可说明覆盖三维；新 OSM 衍生数据说明 |
| `frontend/public/mecoffe/assets3d/README.md` | 更新默认像素素材和原程序资产的区别 |
| `docs/campus3d-polish-delivery.md` | 本交付记录 |

## 测试与截图

| 命令 | 结果 |
| --- | --- |
| 根目录 `python -X utf8 -m unittest discover -s adapter` | **43/43 通过**，包含原 39 项与周边道路新增 4 项 |
| `frontend/` 下 `npm test` | **88/88 通过**，包含原 68 项与本轮新增 20 项 |
| `frontend/` 下 `npm run build` | **通过**，Vite 6.3.2；仅保留上游动态/静态导入及大 chunk 提示 |
| `git -c core.whitespace=cr-at-eol diff --check` | **通过** |
| `node logs/phase1-visual/capture-polish.cjs` | **通过**，安装的 Google Chrome 156.0.8078.48，无头模式 |

浏览器检查覆盖默认像素模式、四个原名路牌/固定 12px、八个映射标签、顶部原文、历史第 2 天购买后的行走、像素特写、暂停画布不变、样式切换保留行走数、高低画质、静态网络禁止播放、30 天规则演示仍可用。最终暂停前后画布像素差为零。无 pageerror/console error；三条已有全局 AudioContext 自动播放 warning 不涉及新功能。

全部截图为 **1600×1000**，保存在仓库根目录下：

1. `logs/phase1-visual/polish-overview.png`：建成区全景，原空地已裁、四个原名路牌可见。
2. `logs/phase1-visual/polish-history-day2.png`：历史第 2 天第一笔订单，像素人物沿原路网行走。
3. `logs/phase1-visual/polish-pixel-closeup.png`：同一行人的行走帧特写。

检查详情为 `logs/phase1-visual/polish-browser-checks.json`，测试/构建输出分别为 `polish-python-tests.txt`、`polish-frontend-tests.txt`、`polish-build.txt`。日志和截图继续按原 `.gitignore` 仅保留本机，不加入源码提交；未添加 Playwright/sharp 项目依赖，截图脚本使用本机已有工具。

## 来源与已知限制

- 默认人物是 **YuLan 图集的二维像素贴图**，始终面向镜头，只做左右翻转，不是新增四方向三维骨骼模型。来源为原 YuLan-OneSim `9829d72`，沿用上游 Apache-2.0 与本仓库保留的 `YULAN_LICENSE`/NOTICE，不称为 CC0；咖啡杯小图标为本项目程序生成。
- OSM 几何和路名按 ODbL 1.0 提供并保留署名；未使用高德、百度、Google 或地图截图。新道路宽度、缺失车道数、人行道与标线样式是展示默认值，不能当作实测道路设施；地下段仅简化为虚线，不是精细立交或交通仿真。
- 建筑仍为默认高度体块，原位置与地图数据覆盖限制不变。裁剪只隐藏画面中的空地，不删除原地块；地图/人物/光照/到店动画均不参与 OASIS 空间决策，历史失败运行没有补造后续天数。
- 新功能未做跨设备集成显卡性能保证；低画质保留像素人物，关闭原阴影、辉光与树。全景 30/40px 为可读性而放大，并非人物真实比例。
- 原全局声音模块的 AudioContext 警告与全站大包构建提示保留，未改 `/mecoffe` 或上游全局代码。
