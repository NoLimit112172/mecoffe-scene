# 三维素材库与地图建模流水线交付记录

分支 `feat/asset-library`，基于 `main` 的 `ee17353a4de200d87eca7ad828ca586511252d62`；按三个里程碑分别本地提交，不 push，不停止 5180 服务。

## 里程碑 1：目录与浏览页

- 50 个现有原型，覆盖建筑/部件、道路、地表、树木、街道家具、两种人物和事件/显示特效；每个有来源、许可、匹配、参数、变体及实际缩略图。
- `/mecoffe3d/assets` 使用一个 WebGL context 和多个 scissor 视口展示真实可旋转模型，支持分类/来源/文本筛选、变体选择及许可明细。静态 SVG 只用于加载占位。
- 素材纯函数提供 schema 校验、组件/整要素分离、标签匹配、固定 UTF-8 FNV seed 选择和统计。现有建筑、角色、道路及事件样式转为读取目录，默认值不变。
- Node 新增目录/预览测试通过，现有前端测试通过；Vite build 通过。无头 Chrome 验证素材页 50 张卡、只有一个 canvas、筛选有效、无页面错误。
- `logs/asset-library/default-m1.png` 与上一版 `logs/phase1-visual/polish-overview.png` 的逐像素比较：**变化像素 0，最大通道差 0**。默认效果保持一致。
- 截图 `logs/asset-library/assets-m1.png`（1600×1000），浏览检查 `m1-browser-checks.json`。日志截图按原规则仅保留在本机。

相关文件：`adapter/build_asset_catalog.py`、`catalog.json`、`assets3d/previews/*.svg`、`assetCatalog.js`、`AssetPreviewRenderer.js`、`assetPreviewModel.js`、`AssetLibrary.vue`、目录/预览测试、现有渲染器的参数接入、router/App、README/NOTICE。

里程碑 1 提交：`f131554`。

## 里程碑 2：通用地图流水线

- 新增 `adapter/scene_builder/{__init__,__main__,io,core}.py`，标准库实现 OSM bbox 下载/存档或 WGS84 GeoJSON 校验、局部米制投影、标签识别、原型匹配、UTF-8 FNV 固定变体及输出解释。
- GeoJSON 支持建筑/带孔多边形/多部件、道路和 POI；地点由调用方 ID 直接对应或显式规则匹配，歧义报错。单个 POI 不虚构楼体，交点不凭视觉添加通路。
- `docs/map-input-contract.md` 明确标为“草案，待与调度器负责人确认”。CLI 的建筑风格选项不要求道路和地表提供同名风格。
- 中科大从原始 XML 重建，与现有场景 deepEqual；修改测试 XML 的高度会改变转换结果，证明没有借用冻结场景。
- NUS 实际快照：`2026-11-03T07:36:11.586106+00:00`，SHA-256 `31f19c9919e87ce833f592cff615097b6829cdecd8ae8f4adb6be897d7c2d63f`。226 楼、840 道路分段、114 POI、100 地表；1280 素材/地点分配记录。149 楼默认高度，不使用“约220楼”代替真实统计。
- `frontend/public/mecoffe/campuses/nus/` 输出场景、素材分配、地点对应、地表和 manifest；新增窄范围 Git 规则保留这些 JSON 的字节哈希。原校园源文件与映射没有覆盖。
- `/mecoffe3d?campus=nus` 独立预览只取楼栋和道路，不加载 MeCoffe 数据；原无 query 入口仍使用原三维视图。
- Python 全部 **55/55** 通过，其中流水线新增 12 项。NUS 预览新增一项前端来源/格式测试；build 和无头浏览器结果在最终记录补充。

里程碑 2 提交：`8778617`。

## 里程碑 3：YuLan 三维改编

- 新增10套建筑（house21–26 / villa27–30），每套三个真实原图变体。house 原0/1/2零件分别用于底层、重复层、屋顶；villa 明确为完整原图的分带裁剪。任意凸/凹、顺/逆环和中庭孔洞按原高度闭合建模，保留庭院开口，墙段按边和层合并。
- 新增7套 decor 类型：灌木、景观树组、花坛、椅、灯、园林砖、喷泉。RGBA 有色采样产生有限厚度体素，透明不生成，内部面剔除后合并几何。椅/灯原帧少于三种时，用明确标注的厚度变体，不假装有不存在的源帧。
- 新增 `character.voxel`，复用二维服装/头部组合和原三帧，默认40行、最多48行/2层厚度，按外观缓存合并几何。位置/yaw/缩放/暂停/杯子只读原展示状态；默认仍用像素人物。
- 校园“建筑风格”默认程序化，选择 YuLan 才懒加载其建筑与三批实例化景观树；原路灯/椅不在默认校园里替换，转换结果均在图库可浏览。三种人物风格可并列切换。
- 图库逐一验证19个YuLan原型、59个变体，全部真实生成、无占位或页面错误；修正了重复选择当前变体导致加载提示不消失的交互边界。
- 中科大独立重建输出和81条原型分配保存至 `campuses/ustc/`，场景与原文件 deepEqual，未覆盖旧数据。
- 通用地图预览也按 assignments 中的真实生成器加载 YuLan 楼套，而非仅显示原型名后仍画通用方盒。单独的合成 GeoJSON 测试通过浏览器验证该路径，图像 `geojson-yulan-qa.png` 仅为测试夹具，不冒称实际 NUS 数据。
- M2 的合成风格单测改为隔离其测试目录，避免新加入的真实 YuLan 原型与合成假原型同分时影响该单测；道路风格回退断言保留。另补了调用方 GeoJSON 不能因许可为 ODbL 就错误标成 OSM 的来源测试。

### 最终素材统计

| 类别 | 数量 |
| --- | ---: |
| building | 23 |
| road | 14 |
| landcover | 5 |
| vegetation | 3 |
| street_furniture | 7 |
| character | 3 |
| effect | 13 |
| **总数** | **68** |

来源：程序生成 **48**，YuLan/Apache-2.0 **19**，OSM/ODbL-1.0 几何原型 **1**。每个原型都有至少三个变体和来源/许可；OSM 地图实例还在 assignments.geometry_source 中单独记录许可与源 SHA。

### 最终验证

| 命令（工作目录） | 结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter`（根目录） | **55/55 通过** |
| `npm test`（frontend） | **112/112 通过** |
| `npm run build`（frontend） | **通过**，上游动态/静态导入与大包提示保留 |
| `git -c core.whitespace=cr-at-eol diff --check`（根目录） | **通过** |
| `node logs/asset-library/qa-final.cjs`（根目录） | **通过**，无头Chrome 156，1600×1000 |

最终浏览器验证：默认校园 map-panel 与上一版逐像素差0；选择YuLan、切低/高画质、恢复程序化后差仍为0；默认不预载YuLan校园/体素人物；人物切换保留暂停KPI；NUS不加载模拟；19个YuLan原型可查。来源与分配记录须同校区且源SHA相同，版本混用明确拒绝。

四张交付图均为 **1600×1000**，在 `logs/asset-library/`：

1. `assets.png`：素材库的真实YuLan三维预览（筛选19/68）。
2. `ustc-yulan.png`：中科大YuLan风格建筑全景。
3. `nus.png`：NUS通用流水线生成结果。
4. `voxel-person.png`：历史第2天原订单行人的体素特写。

`final-browser-checks.json`、`yulan-agent-checks.json`、`python-tests.txt`、`frontend-tests.txt`、`build.txt` 保存检查证据；日志和截图按原 .gitignore 仅本机保留。完整源码文件清单见 `docs/asset-library-files.md`。M3提交号见最终回复或 `git log -3 --oneline`。

### 已知限制与需确认事项

- 图集三维化是有记录的贴图模块与像素厚度浮雕，不推断真实建筑背面或树木内部；并非精细BIM、倾斜摄影或真实高程重建。villa 的楼层带是风格化裁剪。树组源图含地面砖，不冒称单树全景模型。
- 建筑缺高时用明确默认值；局部等距矩形投影适合校园尺度，非全球测绘。NUS道路/楼体只预览，未做室内楼层导航、通行许可认证或交通仿真。
- 实际 agent 位置、感知/碰撞和步行权限仍需后端提供；当前回放位置与路线继续是展示示意，OASIS未因此获得空间数据。
- 调度器接口仍为草案：需确认 `location_id` 命名和唯一性、地图版本/增量更新、输入授权与坐标系、缺失高度策略、通行与层级规则，以及后端是否让位置参与决策。未向团队发送消息或假定接口已获接受。
- 新风格为可选、延迟加载；未做跨集成显卡性能保证。程序生成模型的项目授权边界以NOTICE为准，不冒称第三方CC0。已有全局AudioContext自动播放警告和构建包体提示未改动。
