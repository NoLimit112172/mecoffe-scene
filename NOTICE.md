# 第三方代码说明

三维素材目录 `frontend/public/mecoffe/assets3d/catalog.json` 逐原型记录来源、源路径与许可。YuLan 原图集保留上游 Apache-2.0 和 `YULAN_LICENSE`，OSM 数据保留 ODbL-1.0 与署名。程序生成的模型、纹理和 SVG 缩略图属于本项目代码输出，目录以 `LicenseRef-MeCoffe-Project` 记录该来源；这不是外部 CC0 授权，也不改变原数据或素材的许可。

`frontend/` 来自 [RUC-GSAI/YuLan-OneSim](https://github.com/RUC-GSAI/YuLan-OneSim) 的 `src/frontend`，提交 `9829d72`，按 Apache License 2.0 使用，许可证全文见 `YULAN_LICENSE`。美术素材（`frontend/public/assets`、`frontend/public/img`）同样来自该项目。

对上游文件的改动：

- `frontend/src/router/index.js`：新增 `/mecoffe`、`/mecoffe3d`、`/mecoffe3d/assets` 路由；首页转到原沙盘，原首页保留在 `/dashboard`。
- `frontend/src/App.vue`：在 MeCoffe 沙盘及素材库页面隐藏全局主题切换按钮。
- `frontend/package.json`：新增 `test` 脚本，`dev` 自动打开沙盘。
- `frontend/vite.config.js`：固定本地 5180 端口，仅在配置 API 地址时启用旧页面代理。

新增文件：`frontend/src/mecoffe/`、`frontend/src/views/MeCoffeScene.vue`、`frontend/src/views/MeCoffe3D.vue`、`frontend/tests/`、`frontend/public/mecoffe/`，以及仓库根目录下的 `adapter/`、`scene/`、启动脚本和 VS Code 配置。

`data/source/` 是团队 OASIS 模拟的运行导出，不属于 YuLan-OneSim。

## OpenStreetMap 地图数据

阶段 1 三维校园使用 **© OpenStreetMap contributors** 的数据，按 [Open Data Commons Open Database License 1.0（ODbL）](https://opendatacommons.org/licenses/odbl/1-0/) 使用；[署名与许可说明](https://www.openstreetmap.org/copyright)。

原始数据为 `data/osm/ustc_gaoxin.osm`，下载来源、UTC 时间、范围及 SHA-256 记录在同目录元数据文件。`scene/campus3d.json` 中的校园边界、建筑轮廓、道路、投影坐标和步行图均由此导出，作为 OSM 衍生数据库按 ODbL 1.0 提供。保留原始数据、转换脚本和许可说明，分发该衍生数据库时遵守 ODbL 的署名及相同方式共享要求。网页右下角保留可点击的 OSM 署名。

地图未使用高德、百度、Google 地图或任何卫星影像。缺失的楼层与高度采用公开的展示默认值；地点映射、人物安置、门店位置和行走动画为 MeCoffe 展示层示意，不代表 OSM 记录了咖啡店，也不是 OASIS 输出的位置或轨迹。

## 三维视觉升级素材

上一轮新增的立体角色（头部、面部、衣服、四肢、背包、帽子与咖啡杯）、建筑窗户贴图、招牌、遮阳棚、草地/道路纹理、树木、路灯、长椅、天空着色器，以及事件气泡与文字图标，均由本仓库 JavaScript/Canvas/Three.js 几何程序生成，没有下载 Quaternius、Kenney 或其他第三方美术素材，也没有新增使用 YuLan 的气泡图片。它们属于项目源码的程序化输出；不冒充外部 CC0 授权资源。素材生成位置及边界见 `frontend/public/mecoffe/assets3d/README.md`。

`frontend/public/mecoffe/campus3d_landcover.json` 中的运动场、水面等几何来自同一份已保存 OSM 快照，通过 `adapter/osm_landcover.py` 独立提取并沿下载边界裁剪；保留原来源与投影，按 ODbL 1.0 提供，与上述 OSM 衍生数据采用相同署名及许可要求。运动场线条/水面风格属于示意性绘制，不是测量结果。

Three.js 及 `three/addons` 的 OrbitControls、EffectComposer、RenderPass、UnrealBloomPass、ShaderPass、OutputPass 使用当前已安装版本的 MIT 许可代码（见 `frontend/node_modules/three/LICENSE`）；本轮未升级或新增依赖。当前 r187 已移除 PCFSoftShadowMap，阴影使用受支持的 PCFShadowMap 和扩大的采样半径得到柔和边缘。

## YuLan 改编模型与周边道路

三维素材库的 YuLan 模块化建筑、装饰体素与人物体素，同样由上述 `9829d72` 图集改编，保留 Apache-2.0、源作者和 `YULAN_LICENSE`。house21–26 使用原底层/标准层立面；villa27–30 为有记录的墙面分带裁剪，不声称是原生独立模块。里程碑 5 已停用斜二维屋顶贴图，改用程序生成的实体平屋顶、女儿墙、设备或双坡屋顶。目录仍保存原屋顶帧的来源信息，但不将该帧投影到屋面。圆塔专用立面仅用于兼容轮廓，其余轮廓选择直面变体并记录原因。新增屋顶、设备、建筑基座和沙盘层次属于项目程序输出，不代表源图或 OSM 实测了这些结构。

decor40–45 与备选体素人物的 RGBA 通过有限厚度挤出、透明过滤与合并表面转换；这些浮雕/体素模型不含图片未显示的真实背面信息。默认立体人物采用另一种方法：按头、躯干、四肢和鞋程序化完整建模，为侧面和背面设计形状，再从该人物对应的 YuLan 组合取样肤色、发色、衣裤颜色和正面五官。`character.yulan3d` 作为 YuLan 参考改编原型保留 Apache-2.0 来源；完整三维形体、关节和行走/待机动画为本项目新增，并非从一张图推导出的真实三维扫描。所有原图文件保持不变，未新增外部模型。各套装、变体、实际源帧及程序建模信息记录在 catalog.json 与模型 userData 中。

独立 NUS 原始 OSM 数据、元数据与 `campuses/nus/` 衍生文件均按 ODbL-1.0 保留来源；调用方 GeoJSON 的几何许可按调用方元数据保存，不自动改称 OSM 或套用 ODbL。模型原型的许可与其使用的地图几何许可分开保留。

`/mecoffe3d` 继续提供像素贴图备选模式，复用 YuLan-OneSim 提交 `9829d72` 中已有的 `frontend/public/assets/bgrd-0.json/png`、`bgrd-1.json/png`、`bgrd-2.json/png`：身体动画键为 `character/{gender}/{typeId}_{variant}`，头部为 `head/{gender}/{part}/...`。来源和上游 Apache License 2.0 说明与本文开头二维素材相同，许可证保留在 `YULAN_LICENSE`；该说明同时覆盖二维及三维复用。未修改、另下载或重新授权这些原图集，不将其声称为 CC0。像素模式在运行时组合原身体/头部帧并设最近邻过滤；咖啡杯小图标由本项目 Canvas 程序生成。默认人物现为上述完整立体 YuLan 模型，原像素与体素模式保留供对照。

新增 `data/osm/ustc_gaoxin_surroundings.osm`、同目录 metadata 与 `frontend/public/mecoffe/campus3d_surroundings.json` 来自 OSM 官方 API，属于单独保存的周边道路快照及 ODbL 1.0 衍生数据库。保留原始响应、下载 URL/UTC/bbox/SHA-256、转换脚本和 © OpenStreetMap contributors 署名。仅使用实际 `name` 标路名；默认道路宽度、人行道和分道线风格属于展示，不是测绘成果。没有获取高德、百度、Google 数据。

里程碑 5 的分层底座、校园与校外路面高度、人物碰撞半径、门口站位、额外绕行与等待均属于展示层。原始 OSM 文件、步行图、地点映射、回放数据与 A* 返回路径不因这些显示调整而修改。相机改变时可能重新排布显示人物，以容纳最小屏幕尺寸；不得把该排布或动画用时作为 OASIS 位置、通行或消费决策结果。
