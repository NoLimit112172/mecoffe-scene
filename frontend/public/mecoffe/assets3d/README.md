# 三维视觉资源清单

版本化目录为 `catalog.json`，交互浏览页为 `/mecoffe3d/assets`。当前共 **189 个原型**：建筑26、道路14、地表6、植被3、街道家具7、人物120、特效13。每个原型记录源路径、许可、变体、参数与匹配规则；`target: component` 的屋顶、基座等部件不参加整栋楼的自动匹配。程序来源52、YuLan图集改编20、Rocketbox原型116、OSM几何1；实例所用地图几何与模型原型的许可分别记录。

本轮没有新增下载 GLB、GLTF、PNG 或 JPEG 美术资产。YuLan 原图仍来自上游提交 `9829d72` 的 `public/assets/bgrd-0..2.json/png`，按 Apache-2.0 保留根目录 `NOTICE.md` / `YULAN_LICENSE`，未修改或重新授权原图。程序输出以 `LicenseRef-MeCoffe-Project` 标记，不能称为外部 CC0 素材。

| 内容 | 生成源码（相对 frontend/） | 来源与建模边界 |
| --- | --- | --- |
| 默认完整立体 YuLan 人物 | `src/mecoffe/Campus3DYuLanCharacters.js`、`yulanCharacterModel.js` | 原 YuLan 组合取样配色/正面五官；头、躯干、四肢、鞋的正侧背面及动画由程序完整建模，Apache-2.0 参考改编，不是图片挤出 |
| 像素贴图备选人物与原三帧动画 | `src/mecoffe/Campus3DPixelCharacters.js`、`campus3dPixelModel.js` | 已有 YuLan 图集运行时组合，外观规则复用二维人物 ID，不改原图 |
| 体素备选人物与装饰浮雕 | `src/mecoffe/YuLanAssetFactory.js`、`yulanAssetModel.js`、`Campus3DVoxelCharacters.js` | YuLan 可见像素有限厚度改编，透明过滤和内部面剔除；不恢复未显示的背面 |
| 旧程序立体人物备选原型 | `src/mecoffe/Campus3DCharacters.js` | 作为素材库历史备选保留；程序化几何与配色，随项目源码提供 |
| YuLan 建筑立面 | `src/mecoffe/YuLanAssetFactory.js`、`YuLanCampusStyle.js` | house21–26 原底层/标准层；villa27–30 为注明的墙面分带裁剪。圆塔立面不分给不兼容方形轮廓 |
| 实体平/坡屋顶和屋面设备 | `src/mecoffe/YuLanRoofGeometry.js`、`yulanRoofModel.js` | 程序生成有厚度的屋面、女儿墙、水箱等；已停用斜二维 roof atlas。固定 ID/seed 布置，中庭保留开口，设备避开孔洞与边缘 |
| 分层底座、建筑基座和道路层次 | `src/mecoffe/Campus3DBase.js`、`campus3dTerrain.js`、`Campus3DSurroundings.js` | 程序生成石/土/表层、校内外高差、人行道与路缘厚度；只是展示高度，不是实测地形 |
| 程序建筑窗户、招牌、遮阳棚、草地/道路纹理 | `src/mecoffe/Campus3DEnvironment.js` | Canvas 运行时绘制，不是实景照片 |
| 树、灯、长椅、天空 | 同上及 `campus3dEnvironmentModel.js` | 固定种子装饰；避让路线、站位和建筑，页面图例注明“装饰” |
| 气泡、弧线、广告粒子与购买收据 | `src/mecoffe/Campus3DEffects.js` | 程序几何/文字；数据只读原事件 |
| 建筑、道路、运动场与永怀湖几何 | `campus3d*.json` | © OpenStreetMap contributors，ODbL-1.0，见根目录 NOTICE.md |
| 周边马路中心线和原始路名 | `campus3d_surroundings.json` | 独立 OSM 官方快照、ODbL-1.0；宽度/车道线风格为展示默认值 |
| Three.js 核心及后处理 addons | 已安装 `three` 包 | MIT；保留包内 LICENSE |

新增原型为 `character.yulan3d`、`building.component.roof-flat`、`building.component.roof-pitched`、`building.component.foundation`、`landcover.layered-base`。屋顶卡片显示实际实体几何；同一建筑的校正前后原型与理由记录在运行时 `userData`，不覆盖原始地图分配文件。

中科大三维回放页面统一使用 YuLan 立面与三维实体屋顶；默认试用“写实人物”，可切换“立体 YuLan / 像素贴图 / 体素”。通用地图预览按各自的素材分配加载。程序生成几何不会把原图许可变成 CC0，也不会把 YuLan 原型许可套到 OSM 几何上。

角色位置、楼栋归属、到店行走、门口排队、额外绕行、装饰设施和光照均为展示层安排。人物按缩放后的半径预留间距；相机改变时可调整显示站位，固定相机播放不因尺寸重新排布。原始 A* 图与返回路径、映射和回放数据保持不变，OASIS 没有提供人物位置。建筑层高、屋顶形式及沙盘层次均不表示测量结果。详细验证与本轮限制见根目录 `docs/milestone5-delivery.md`。

## Rocketbox 写实人物全集

`character.rocketbox` 是115款人形的全集入口，`character.rocketbox.<模型ID>` 为115套独立素材卡；每套有站立、行走、持杯预览。人物页支持40成年人、4儿童、71职业装的分类及每页12项预览，切页释放旧页3D资源。

模型与本地贴图在 `rocketbox/`，完整列表及逐图来源见 `rocketbox/manifest.json`。115个原始标准FBX按Microsoft固定提交及Git blob核对；同源贴图有原TGA本地派生和openOMSI预转换JPEG/PNG两条路径，均保留MIT许可、源身份和实际派生步骤。原TGA未本地取回时 `source_sha256` 为null，不能误报完整原始文件校验；openOMSI ZIP只取所需条目，未声称完整ZIP SHA已本地验证。

皮肤、头发与衣服使用原模型贴图，程序驱动原骨骼做待机、步行和持杯；没有引入外部动作包。全部池优先在100人中分配100款不同模型，仅按可见状态加载，隐藏最多8个热缓存；未就绪时显示原YuLan外观。人物ID、动作和位置仍读取现有展示状态，外观分类不代表模拟人物真实身份。
