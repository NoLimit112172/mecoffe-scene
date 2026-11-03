# 第三方代码说明

`frontend/` 来自 [RUC-GSAI/YuLan-OneSim](https://github.com/RUC-GSAI/YuLan-OneSim) 的 `src/frontend`，提交 `9829d72`，按 Apache License 2.0 使用，许可证全文见 `YULAN_LICENSE`。美术素材（`frontend/public/assets`、`frontend/public/img`）同样来自该项目。

对上游文件的改动：

- `frontend/src/router/index.js`：新增 `/mecoffe`、`/mecoffe3d` 路由；首页转到原沙盘，原首页保留在 `/dashboard`。
- `frontend/src/App.vue`：在两个 MeCoffe 页面隐藏全局主题切换按钮。
- `frontend/package.json`：新增 `test` 脚本，`dev` 自动打开沙盘。
- `frontend/vite.config.js`：固定本地 5180 端口，仅在配置 API 地址时启用旧页面代理。

新增文件：`frontend/src/mecoffe/`、`frontend/src/views/MeCoffeScene.vue`、`frontend/src/views/MeCoffe3D.vue`、`frontend/tests/`、`frontend/public/mecoffe/`，以及仓库根目录下的 `adapter/`、`scene/`、启动脚本和 VS Code 配置。

`data/source/` 是团队 OASIS 模拟的运行导出，不属于 YuLan-OneSim。

## OpenStreetMap 地图数据

阶段 1 三维校园使用 **© OpenStreetMap contributors** 的数据，按 [Open Data Commons Open Database License 1.0（ODbL）](https://opendatacommons.org/licenses/odbl/1-0/) 使用；[署名与许可说明](https://www.openstreetmap.org/copyright)。

原始数据为 `data/osm/ustc_gaoxin.osm`，下载来源、UTC 时间、范围及 SHA-256 记录在同目录元数据文件。`scene/campus3d.json` 中的校园边界、建筑轮廓、道路、投影坐标和步行图均由此导出，作为 OSM 衍生数据库按 ODbL 1.0 提供。保留原始数据、转换脚本和许可说明，分发该衍生数据库时遵守 ODbL 的署名及相同方式共享要求。网页右下角保留可点击的 OSM 署名。

地图未使用高德、百度、Google 地图或任何卫星影像。缺失的楼层与高度采用公开的展示默认值；地点映射、人物安置、门店位置和行走动画为 MeCoffe 展示层示意，不代表 OSM 记录了咖啡店，也不是 OASIS 输出的位置或轨迹。
