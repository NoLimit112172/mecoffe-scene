# 三维视觉资源清单

本轮不新增下载 GLB、GLTF、PNG 或 JPEG 美术资产。默认像素人物复用已有 YuLan `public/assets/bgrd-0..2.json/png`，来源及上游 Apache-2.0 说明见根目录 NOTICE.md / YULAN_LICENSE；未修改原图集，也不将其标为 CC0。立体备选角色、装饰及特效由项目代码生成。

| 内容 | 生成源码 | 来源/许可说明 |
| --- | --- | --- |
| 默认像素人物身体/头部与原三帧动画 | `src/mecoffe/Campus3DPixelCharacters.js`、`campus3dPixelModel.js` 运行时合成 | 已有 YuLan 图集，Apache-2.0，保留 YULAN_LICENSE；外观规则复用二维 layout.hashOf |
| 低多边形人物、五官、衣服与咖啡杯 | `src/mecoffe/Campus3DCharacters.js` | 本次新增的程序化几何与配色，随项目源码提供 |
| 建筑窗户、招牌、遮阳棚、草地、道路纹理 | `src/mecoffe/Campus3DEnvironment.js` | 本次 Canvas 绘制，运行时生成，不是实景照片 |
| 树、灯、长椅、天空 | 同上及 `campus3dEnvironmentModel.js` | 固定种子的程序化装饰，在页面图例注明 |
| 气泡、弧线、广告粒子与购买收据 | `src/mecoffe/Campus3DEffects.js` | 本次生成的几何/文字，数据只读原事件 |
| 建筑、道路、运动场与永怀湖几何 | `campus3d*.json` | © OpenStreetMap contributors，ODbL 1.0，详见根目录 NOTICE.md |
| 周边马路中心线和原始路名 | `campus3d_surroundings.json` | 独立 OSM 官方快照、ODbL 1.0；宽度/车道线风格为展示默认值 |
| Three.js 核心及后处理 addons | 已安装 `three` 包 | MIT；保留包内 LICENSE |

角色位置、楼栋归属、到店行走、装饰设施和光照均为展示层安排，OASIS 没有提供人物位置数据。建筑层高沿用原默认值，不表示测量高度。
