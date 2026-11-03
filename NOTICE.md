# 第三方代码说明

## GitHub Pages 发布说明

公开网站使用独立的 Pages 产物白名单：保留 YuLan 图集、OSM 校园数据、Kenney 植被和 9 个 VALID 原始人物模型及许可；完整 Rocketbox、旧页面 img/sounds 资源不进入网站。素材库同步过滤未发布的 Rocketbox 原型，避免失效卡片。本地完整目录与模型文件保持可用。网页提供“来源与许可”入口与下列第三方原始许可全文。

Pages 前端使用 YuLan-OneSim（Apache-2.0）、© OpenStreetMap contributors（ODbL-1.0）、Kenney（CC0-1.0，署名自愿）、VALID（MIT，Copyright (c) 2022 Tiffany Do）、Three.js（MIT）、Vue/Vue Router（MIT）、PixiJS/pixi-viewport（MIT）、Apache ECharts（Apache-2.0，保留 NOTICE）及 Font Awesome Free（图标 CC BY 4.0、字体 OFL 1.1、代码 MIT）。Pages 包保留对应的许可文本与版权声明。新增 favicon 为项目程序绘制。

地点和走路路线为展示示意，OASIS 没有位置数据。公开数据包括已获授权的历史回放、关系网络和规则演示；规则演示仍明确标记为示例，不冒充新模拟结果。发布不会改变原始地图、数据、模型字节或其许可。

## 当前校园新增模型

- **Kenney Nature Kit 2.1**：来自 <https://kenney.nl/assets/nature-kit>，CC0-1.0。8个原生三维 GLB 和原始 `License.txt` 保存在 `frontend/public/mecoffe/assets3d/kenney/`；清单记录原包 SHA-256、每个归档成员与文件哈希。只是装饰布点，不代表实地植被测绘。校园不再使用 YuLan 像素浮雕树。
- **VALID Validated Avatar Library**：来自 <https://github.com/google/valid-avatar-library>，固定提交 `c76d2547b5b464415283169d18dffb16bb584eee`，MIT，Copyright (c) 2022 Tiffany Do。9个原始带内嵌贴图FBX及原始许可、README和作者标签元数据保存在 `frontend/public/mecoffe/assets3d/valid/`。Asian/male/female是上游合成模型的标签，不是从图像猜测，也不推断画像主体真实族群或国籍。每个文件记录并校验上游Git blob、SHA-256和大小。

VALID 运行时兼容处理合并同姿态的重名骨骼、重复顶点，移除室外回放不需要的口腔内部与作者灯光，并由本项目代码驱动放松站立、行走、持杯；原始FBX不改写。原 Rocketbox115套与其MIT许可仍保留在完整素材库，当前校园按画像性别和师生角色使用VALID预设。31栋实际楼栋及场地/水域/跨水通行面实例卡片的OSM几何仍保留ODbL-1.0，YuLan立面继续保留Apache-2.0；实例没有将几何和模型合并改授许可。

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

早期视觉升级阶段新增的立体角色（头部、面部、衣服、四肢、背包、帽子与咖啡杯）、建筑窗户贴图、招牌、遮阳棚、草地/道路纹理、树木、路灯、长椅、天空着色器，以及事件气泡与文字图标，均由本仓库 JavaScript/Canvas/Three.js 几何程序生成，当时没有下载 Quaternius、Kenney 或其他第三方美术素材（当前新增 Kenney 的来源见前文），也没有新增使用 YuLan 的气泡图片。它们属于项目源码的程序化输出；不冒充外部 CC0 授权资源。素材生成位置及边界见 `frontend/public/mecoffe/assets3d/README.md`。

`frontend/public/mecoffe/campus3d_landcover.json` 中的运动场、水面等几何来自同一份已保存 OSM 快照，通过 `adapter/osm_landcover.py` 独立提取并沿下载边界裁剪；保留原来源与投影，按 ODbL 1.0 提供，与上述 OSM 衍生数据采用相同署名及许可要求。运动场线条/水面风格属于示意性绘制，不是测量结果。

`Campus3DSports.js` 的实体跑道、球场、篮架与球网，及 `Campus3DWater.js` 的岸坡、起伏湖底、水面、桥面、坡道、护栏与桥墩，都是项目程序生成的几何，未下载外部美术素材。400m 标准型跑道按用户标注包围既有足球场；外围尺寸与多场排布经过展示缩放，不代表实测球场外圈或数量。永怀湖的变化水深是 0.22–2.8m 的展示设定；现有 OSM 道路/水域交叠生成的桥型和通行面也是推定展示，不新增 `bridge=yes` 或更改原 `layer`。可行走性仅约束显示人物，不写回 OASIS。各程序原型按 `LicenseRef-MeCoffe-Project` 记录；所用 OSM 定位几何继续保留 ODbL-1.0。

Three.js 及 `three/addons` 的 OrbitControls、EffectComposer、RenderPass、UnrealBloomPass、ShaderPass、OutputPass 使用当前已安装版本的 MIT 许可代码（见 `frontend/node_modules/three/LICENSE`）；本轮未升级或新增依赖。当前 r187 已移除 PCFSoftShadowMap，阴影使用受支持的 PCFShadowMap 和扩大的采样半径得到柔和边缘。

## YuLan 改编模型与周边道路

三维素材库的 YuLan 模块化建筑与环境装饰，同样由上述 `9829d72` 图集改编，保留 Apache-2.0、源作者和 `YULAN_LICENSE`。house21–26 使用原底层/标准层立面；villa27–30 为有记录的墙面分带裁剪，不声称是原生独立模块。里程碑 5 已停用斜二维屋顶贴图，改用程序生成的实体平屋顶、女儿墙、设备或双坡屋顶。目录仍保存原屋顶帧的来源信息，但不将该帧投影到屋面。圆塔专用立面仅用于兼容轮廓，其余轮廓选择直面变体并记录原因。新增屋顶、设备、建筑基座和沙盘层次属于项目程序输出，不代表源图或 OSM 实测了这些结构。

decor40–45 的 RGBA 通过有限厚度挤出、透明过滤与合并表面转换；这些装饰浮雕不含图片未显示的真实背面信息。早期三维像素、体素、YuLan立体和程序方块人物模式已移除；历史交付文档保留当时来源说明。所有 YuLan 原图文件保持不变，继续供二维人物、三维建筑和环境装饰使用。当前各套装、变体、实际源帧及程序建模信息记录在 catalog.json 与模型 userData 中。

独立 NUS 原始 OSM 数据、元数据与 `campuses/nus/` 衍生文件均按 ODbL-1.0 保留来源；调用方 GeoJSON 的几何许可按调用方元数据保存，不自动改称 OSM 或套用 ODbL。模型原型的许可与其使用的地图几何许可分开保留。

二维人物继续复用 YuLan-OneSim 提交 `9829d72` 中已有的 `frontend/public/assets/bgrd-0.json/png`、`bgrd-1.json/png`、`bgrd-2.json/png`，身体及头部原帧仍按 Apache License 2.0 使用，许可证保留在 `YULAN_LICENSE`。未修改、另下载或重新授权这些共用原图集，不将其声称为 CC0。当前三维页面只使用下一节的Rocketbox写实人物，加载中只显示身份脚标。

新增 `data/osm/ustc_gaoxin_surroundings.osm`、同目录 metadata 与 `frontend/public/mecoffe/campus3d_surroundings.json` 来自 OSM 官方 API，属于单独保存的周边道路快照及 ODbL 1.0 衍生数据库。保留原始响应、下载 URL/UTC/bbox/SHA-256、转换脚本和 © OpenStreetMap contributors 署名。仅使用实际 `name` 标路名；默认道路宽度、人行道和分道线风格属于展示，不是测绘成果。没有获取高德、百度、Google 数据。

里程碑 5 的分层底座、校园与校外路面高度、人物碰撞半径、门口站位、额外绕行与等待均属于展示层。原始 OSM 文件、步行图、地点映射、回放数据与 A* 返回路径不因这些显示调整而修改。相机改变时可能重新排布显示人物，以容纳最小屏幕尺寸；不得把该排布或动画用时作为 OASIS 位置、通行或消费决策结果。

## Microsoft Rocketbox 写实人物全集

115套标准人形模型（40成年人、4儿童、71职业装）来自 [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)，固定提交 `0943055db6ec570bcef9f2c8b41c9e5467c808f9`，按上游 MIT License 使用，Copyright (c) 2020 Microsoft。完整原许可为 `frontend/public/mecoffe/assets3d/rocketbox/LICENSE.md`。所有标准FBX均保存原字节并核对官方Git blob，逐条来源见manifest。动物、重复facial导出、动画和制作源不属于本次人形库。

贴图有两种可追溯的准备路径：已取得原TGA者核对官方blob与原始SHA256后本地转换；其他部分来自 [openOMSI avatars-1](https://github.com/openOMSI-org/openOMSI/releases/tag/avatars-1) 的同源预转换色图（JPEG或PNG），再本地缩小。后一路逐条保留release/tag、条目CRC、实际文件SHA256及二次JPEG有损说明；未取得的原TGA原始SHA256留空，不声称本地完整验证。派生包只取所需ZIP条目，GitHub公布的整包SHA256作为出处记录，不冒充已完整下载验证。额外许可、CREDITS及详细说明保存在 `rocketbox/derivatives/openomsi/`，原Microsoft许可同样保留。

所有运行贴图均为本地PNG：脸/合图最长1024像素，身体与透明部件最长512，保留透明通道。这些格式/分辨率处理不改变原许可。待机、行走及持杯姿态由项目程序驱动骨骼，没有导入外部动作包。显示外观按ID稳定复用，不代表团队画像中人物的真实人像，也不推断性别、年龄或职业。

Three.js FBXLoader、SkeletonUtils与既有Three.js同属其MIT代码；没有新增模型云服务或运行时外链。预下载/转换脚本仅在准备素材时使用来源中记录的公开仓库、发布包与内容分发镜像，并校验相应原始或派生文件；网页运行不依赖这些远程地址。

## 里程碑 6：第三方许可复核（2026-11-03）

- Kenney Nature Kit 2.1：官方 <https://kenney.nl/assets/nature-kit> 标记 Creative Commons CC0；归档原始 License.txt 同样明确署名不是强制要求。保留 Kenney / www.kenney.nl 自愿致谢和完整原文，不添加署名义务。
- VALID：逐字复核固定提交的 [MIT LICENSE](https://github.com/google/valid-avatar-library/blob/c76d2547b5b464415283169d18dffb16bb584eee/LICENSE)，版权人为 Copyright (c) 2022 Tiffany Do。MIT 要求分发副本或实质部分时附带上述版权声明和许可文本；已在 public/mecoffe/assets3d/valid/LICENSE 原样保留，构建会随模型一起分发。原始 FBX 未更改；运行时骨骼、索引 LOD 和动画属于展示适配，不改变源文件和许可。
- 每个 Kenney / VALID 原型（含校内实例）均从 adapter/build_asset_catalog.py 的来源与许可记录生成；catalog.json 不以项目程序生成许可覆盖上游模型。
