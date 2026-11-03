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
