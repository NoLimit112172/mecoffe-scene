# 安置依据楼名显示修复

基于 `bfd85e3`，分支 `fix/scene-placement-building-names`。

## 改了什么

“安置与依据”里的人物和门店现在显示楼名，例如“5号楼”“教工食堂”“学生食堂A区”。名称只取自当前页面已加载并通过校验的同一版本地图 `campus3d.json`，按 `osm_id` 查找，不从别的地图或最新版本补名字。

空名称，以及建图器写入的“未命名建筑（本楼 ID）”占位名，显示为“未命名楼栋”，面板另用小字保留楼栋 ID。场外状态沿用原来的说明。证据行仍完整保留 `key/value/ref`；DOM 中的楼栋、入口和状态属性也保留，方便验收原安置。

顺带统一三维/GIS 的楼名标签、悬浮提示、人物名册、地点搜索和楼栋详情。技术详情、证据引用和内部诊断中的 ID 仍保留。

## 实现位置

- `frontend/src/mecoffe/buildingDisplay.js`：共用的纯显示名称处理，不修改楼栋对象。
- `ScenePlacementDetails.vue`：人物和门店按当前楼栋表显示名称，未命名楼附小字 ID。
- `MeCoffe3D.vue`、`MeCoffeGis.vue`：把已校验的当前地图楼栋传给面板，并统一其他楼名显示。
- 三维渲染器、GIS 提示和室内活动显示模块：复用相同名称处理。

SceneResult、校验、安置算法、运行包和已发布地图没有修改。

## 测试

| 命令 | 结果 |
|---|---|
| Python 3.11：`python -m unittest discover -s adapter -p "test_*.py"` | 164 项通过 |
| `npm --prefix frontend test` | 412 项通过 |
| `python -m unittest discover -s scripts -p "test_*.py"` | 29 项通过 |
| `npm --prefix frontend run build:embed` | 默认正式构建通过，本地导入关闭 |
| `node scripts/audit-public.cjs` | 0 项发现 |
| `node scripts/prepare-scene-assets.mjs --dist` | 发布版 catalog 摘要一致 |
| `node scripts/test-team-scene.cjs` | 25 组通过 |
| `node scripts/test-team-scene.cjs --embed` | 25 组通过 |

Python 全套在 WSL 的 Python 3.11 环境执行；打包测试在本机 Python 3.11 执行。命令日志保存在忽略目录 `logs/building-name-fix/`。

新增三个前端单元用例，覆盖真实宿舍/食堂楼名、未命名及历史占位名、显示不改地图和证据。浏览器保留原 23 组断言，新增三维/GIS 两组；使用中科大 v2 原字节地图和合成人物、品牌，在内存构造合法的指定楼栋安置，不改旧夹具。检查真实楼名、小字 ID 的字号、场外状态及每条证据原字段。

浏览器截图在忽略目录 `logs/milestone15-team-scene/ustc-building-names-three.png` 和 `ustc-building-names-gis.png`。真实本机回放验收记录与截图单独保存在仓库外，不进入公开包。

## 打包与限制

提交后用该提交号生成新的 `scene/` 根目录嵌入 ZIP，带来源提交、许可、NOTICE、BUILD_INFO、catalog 摘要和 release-lock 摘要。对拆包逐文件和 ZIP 解出内容另做校验；严格静态托管测试直接读取解出的文件。本地导入仍默认关闭。

这是显示修复；地图本身缺少名称时只能显示“未命名楼栋”，不会推断或编造楼名。证据和技术详情保留原 ID，供追溯。Release、推送、部署和团队 PR 更新由后续审批决定；本批只准备本地提交、包和说明。
