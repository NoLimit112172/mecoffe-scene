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

后续里程碑的完成结果与提交号将在对应提交中补充；当前未完成的功能不作为已交付功能描述。
