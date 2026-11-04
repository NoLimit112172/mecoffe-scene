# 三维视觉资源清单

版本化目录为 `catalog.json`，浏览页为 `/mecoffe3d/assets`。当前 349 项：建筑57、道路17、地表19、植被11、街道家具7、人物225、特效13。默认当前校区207项，含31栋实际楼栋、100个主体外观、8个运动场、湖泊与2处跨水通行面；原始 Rocketbox115套与旧原型可切换到完整库浏览。

本轮稳定性清理没有新增下载美术资产。YuLan 原图仍来自上游提交 `9829d72` 的 `public/assets/bgrd-0..2.json/png`，按 Apache-2.0 保留根目录 `NOTICE.md` / `YULAN_LICENSE`，未修改或重新授权原图。程序输出以 `LicenseRef-MeCoffe-Project` 标记，不能称为外部 CC0 素材。

| 内容 | 生成源码（相对 frontend/） | 来源与建模边界 |
| --- | --- | --- |
| 原始 Rocketbox 人物（保留在完整库） | `src/mecoffe/Campus3DRealCharacters.js`、`rocketboxCharacterModel.js` | 原始Rocketbox带骨骼人体、MIT；站立、行走和持杯由程序驱动 |
| 装饰浮雕 | `src/mecoffe/YuLanAssetFactory.js`、`yulanAssetModel.js` | YuLan 可见像素有限厚度改编，透明过滤和内部面剔除；不恢复未显示的背面 |
| YuLan 建筑立面 | `src/mecoffe/YuLanAssetFactory.js`、`YuLanCampusStyle.js` | house21–26 原底层/标准层；villa27–30 为注明的墙面分带裁剪。圆塔立面不分给不兼容方形轮廓 |
| 实体平/坡屋顶和屋面设备 | `src/mecoffe/YuLanRoofGeometry.js`、`yulanRoofModel.js` | 程序生成有厚度的屋面、女儿墙、水箱等；已停用斜二维 roof atlas。固定 ID/seed 布置，中庭保留开口，设备避开孔洞与边缘 |
| 分层底座、建筑基座和道路层次 | `src/mecoffe/Campus3DBase.js`、`campus3dTerrain.js`、`Campus3DSurroundings.js` | 程序生成石/土/表层、校内外高差、人行道与路缘厚度；只是展示高度，不是实测地形 |
| 跑道、篮球、网球、羽毛球场 | `src/mecoffe/Campus3DSports.js`、`campus3dSportsModel.js` | 程序生成实体场地、分道标线、篮架、球网；以 OSM 球场定位，外围跑道与多片球场排布是展示设计 |
| 有深度水域和实体桥 | `src/mecoffe/Campus3DWater.js`、`campus3dSpatial.js` | 从草地/台地挖除水域；程序生成岸坡、起伏湖底、半透明水面、桥面坡道及桥墩；桥型和 0.22–2.8m 水深不是测量成果 |
| 程序建筑窗户、招牌、遮阳棚、草地/道路纹理 | `src/mecoffe/Campus3DEnvironment.js` | Canvas 运行时绘制，不是实景照片 |
| 树、灯、长椅、天空 | 同上及 `campus3dEnvironmentModel.js` | 固定种子装饰；避让路线、站位和建筑，页面图例注明“装饰” |
| 气泡、弧线、广告粒子与购买收据 | `src/mecoffe/Campus3DEffects.js` | 程序几何/文字；数据只读原事件 |
| 建筑、道路、运动场与永怀湖几何 | `campus3d*.json` | © OpenStreetMap contributors，ODbL-1.0，见根目录 NOTICE.md |
| 周边马路中心线和原始路名 | `campus3d_surroundings.json` | 独立 OSM 官方快照、ODbL-1.0；宽度/车道线风格为展示默认值 |
| Three.js 核心及后处理 addons | 已安装 `three` 包 | MIT；保留包内 LICENSE |

旧三维像素、体素、YuLan立体和程序方块人物的运行模块、卡片与缩略图已移除；共用原图保留供二维人物及建筑/装饰使用。实体屋顶和基座卡片保留；同一建筑的校正前后原型与理由记录在运行时 `userData`，不覆盖原始地图分配文件。

中科大三维回放使用 YuLan 立面与实体屋顶、按画像性别匹配的 VALID 校园人物，以及 Kenney 原生三维植被；不再用 YuLan 像素景观浮雕替换树木。通用地图预览按各自的素材分配加载。程序生成几何不会把原图许可变成 CC0，也不会把 YuLan 原型许可套到 OSM 几何上。

角色位置、楼栋归属、到店行走、门口排队、额外绕行、装饰设施和光照均为展示层安排。人物按缩放后的半径预留间距；相机改变时可调整显示站位，固定相机播放不因尺寸重新排布。原始 A* 图与返回路径、映射和回放数据保持不变，OASIS 没有提供人物位置。建筑层高、屋顶形式及沙盘层次均不表示测量结果。详细验证与本轮限制见根目录 `docs/milestone5-delivery.md`。

## Rocketbox 写实人物全集

`character.rocketbox` 是115款人形的全集入口，`character.rocketbox.<模型ID>` 为115套独立素材卡；每套有站立、行走、持杯预览。人物页支持40成年人、4儿童、71职业装的分类及每页12项预览，切页释放旧页3D资源。

模型与本地贴图在 `rocketbox/`，完整列表及逐图来源见 `rocketbox/manifest.json`。115个原始标准FBX按Microsoft固定提交及Git blob核对；同源贴图有原TGA本地派生和openOMSI预转换JPEG/PNG两条路径，均保留MIT许可、源身份和实际派生步骤。原TGA未本地取回时 `source_sha256` 为null，不能误报完整原始文件校验；openOMSI ZIP只取所需条目，未声称完整ZIP SHA已本地验证。

皮肤、头发与衣服使用原模型贴图，程序驱动原骨骼做待机、步行和持杯；没有引入外部动作包。全部池优先在100人中分配100款不同模型，按画面可见状态加载，未就绪时显示身份脚标。当前代表人物仅因相机离开画面时保留缓存；切换选择或回放后隐藏的人物最多保留8个预热实例。暂停且画面无变化时停止重绘，重复姿态不重算骨骼，过期加载不再创建实例。人物ID、动作和位置仍读取现有展示状态，外观分类不代表模拟人物真实身份。

## 当前校园素材

`valid/` 保存9个原始FBX（含内嵌贴图）、MIT许可和来源清单；原始Git blob及SHA-256均有校验。`kenney/` 保存8个原生GLB及CC0许可，归档版本2.1与SHA-256固定。没有按照片或人物姓名推断族群；Asian是上游合成模型的目录标签。

人物运行时优先使用同目录9个GLB派生版本，避免在播放中解析原始FBX。转换保留室外身体、眼睛、骨架、中性脸形，移除未使用的面部变形目标并限制贴图最高1024像素；原始FBX不改写。manifest.json记录每个GLB的SHA-256和大小，MIT版权和许可与原文件一同保留。`node scripts/prepare-valid-runtime.cjs` 使用本地5180服务和既有Chrome/Playwright离线重建，不下载素材。网页按需加载模型，并异步准备着色器后显示。

`building.campus.*`、`character.campus.*`、`landcover.campus.*`、`road.campus.*` 为校区实例卡片；通用匹配时作为 component 排除，不改变场景生成器的原型优先级。实例包含来源ID及原始轮廓，人物绑定使用与运行页面相同的画像性别、角色和稳定哈希规则。

`python -X utf8 adapter/import_campus_assets.py` 可离线验证素材。设计与边界详见根目录 `docs/campus-boundary-assets.md`。
