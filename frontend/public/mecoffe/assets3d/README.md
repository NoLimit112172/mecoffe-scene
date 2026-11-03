# 三维视觉资源清单

本轮不包含外部下载的 GLB、GLTF、PNG 或 JPEG 美术资产。所有新角色、贴图、装饰及特效均由项目代码生成；没有借用来源不明的模型，也没有把程序生成资源标作第三方 CC0。

| 内容 | 生成源码 | 来源/许可说明 |
| --- | --- | --- |
| 低多边形人物、五官、衣服与咖啡杯 | `src/mecoffe/Campus3DCharacters.js` | 本次新增的程序化几何与配色，随项目源码提供 |
| 建筑窗户、招牌、遮阳棚、草地、道路纹理 | `src/mecoffe/Campus3DEnvironment.js` | 本次 Canvas 绘制，运行时生成，不是实景照片 |
| 树、灯、长椅、天空 | 同上及 `campus3dEnvironmentModel.js` | 固定种子的程序化装饰，在页面图例注明 |
| 气泡、弧线、广告粒子与购买收据 | `src/mecoffe/Campus3DEffects.js` | 本次生成的几何/文字，数据只读原事件 |
| 建筑、道路、运动场与永怀湖几何 | `campus3d*.json` | © OpenStreetMap contributors，ODbL 1.0，详见根目录 NOTICE.md |
| Three.js 核心及后处理 addons | 已安装 `three` 包 | MIT；保留包内 LICENSE |

角色位置、楼栋归属、到店行走、装饰设施和光照均为展示层安排，OASIS 没有提供人物位置数据。建筑层高沿用原默认值，不表示测量高度。
