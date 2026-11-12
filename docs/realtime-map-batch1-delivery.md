# 实时建图第 1 批：纯地图编排与多边形范围

基线：`d014607`。本批只做离线物理地图准备，不做搜索、下载、模型调用、团队后端任务或部署。

## 做了什么

新增 `adapter.scene_builder.physical_map.prepare_physical_map`，把现有离线 OSM 几何、素材匹配、入口、GIS、用途/质量、发布串起来。输入已由调用方确认的 Polygon/MultiPolygon；不经过 prepare_scenario，不需要模拟时间、人物快照、轨迹或场景索引。

内部先生成完整草稿，再用现有 publish_map、auto-evidence.2 生成候选，最后复制到调用方的空目录。生成成功和质量 ready 分开：候选为 preview_only 时原样返回，不自动调低门槛。调用方以后决定是否允许该候选进入可用地图库。

### 避开学弟的改动

**core.py 修改为零，逐条列举如下：无。**

- `_make_campus`、OSM 地表解析、旧 bbox 裁剪没有改。
- `entrances.py`、`scene_service/evidence.py`、范围/相交原算法均没有改。
- 新入口在现有 `build_from_osm` 返回后设置范围、裁剪道路；复用 `_graph` 重建路网和 `_bundle` 重新匹配实际保留的素材，不复制这些算法。
- 新的缓冲/裁剪只在 `physical_scope.py`，老调用完全不经过这条路径。
- 与学弟合并时主要关注私有 `_graph`、`_bundle` 及 bundle 数据形状是否保持；如有接口变化，在新入口适配，不回改旧地图。

其他改动：CLI 增加子命令；建图包名单增加两个模块、隔离入口和公开 NUS 手写范围样例；新增验收测试。没有修改运行包 0.2.0 或已有地图、夹具。

## 入口和用法

### Python

```python
from adapter.scene_builder.physical_map import prepare_physical_map

result = prepare_physical_map(
    "data/osm/nus.osm", "data/osm/nus.metadata.json", confirmed_geometry,
    scope_source={"type": "manual", "note": "调用方提供的范围"},
    title="NUS 离线物理图", map_id="nus-physical-example", map_version="1",
    rules_path="adapter/scene_service/evidence_rules_v2.json",
    out="/tmp/nus-physical-candidate", road_buffer_m=50,
    draft_out="/tmp/nus-physical-draft",  # 可省略，省略时草稿临时保存
    progress=lambda event: print(event),
)
```

- `confirmed_geometry` 为 GeoJSON **几何对象**：`{"type":"Polygon","coordinates":...}` 或 MultiPolygon，带孔洞可直接传；若从 OSM 工具导出 Feature，请取它的 geometry，不把整个 FeatureCollection 当范围。
- 范围来源支持 `type=osm/manual/manual_subset`。OSM 来源另给 `osm_type=way|relation` 与数字 `osm_id`。这只是来源记录，不替代上游用户确认，也不自动验证手工子区域的父级授权。
- `rules_path` 必填，必须是合法的 auto-evidence.2；没有依赖发布器的旧默认规则。
- `seed` 为建图素材种子，默认字符串 `0`，与 assignment_seed、模拟 seed 分开。
- 返回 map_ref、素材版本、完整 quality、简短 summary 和冻结 recipe。
- progress 接收实际阶段字典：reading、geometry、entrances_gis、evidence_quality、publishing，不编百分比。它可以抛异常停止后续操作。
- out 与可选 draft_out 必须不存在或为空，且不能相互包含。无效范围和限额失败不会写入候选目录。完整草稿可保留供复查；它不是正式地图，也不进入地图库。
- 此函数只负责本地候选目录，不是全局版本登记器。地图 ID/版本唯一性、原子上线、并发、取消与恢复仍归后续任务服务。

### 源码目录命令

以下命令只读本地归档，输出目录要换成空路径：

```sh
python -B -m adapter.scene_builder physical-map \
  --osm data/osm/nus.osm --metadata data/osm/nus.metadata.json \
  --scope adapter/physical_map_examples/nus-scope.geojson \
  --map-id nus-physical-example --map-version 1 --title "NUS 离线范围示例" \
  --rules adapter/scene_service/evidence_rules_v2.json \
  --out /tmp/nus-physical-candidate --draft-out /tmp/nus-physical-draft
```

`--scope-source 来源.json` 可省略，默认只记录 `type=manual`。`--limits 限额.json` 可覆盖下表参数，未知字段/非法数值会报错。stdout 为结果 JSON，stderr 为阶段 JSON；失败非零退出并输出错误码/原因。exit=0 只表示候选生成完成，仍须检查 summary.status。

### 解包后的隔离命令

在解包 payload 中，或使用绝对脚本路径，从其他工作目录也可运行：

```sh
python3.11 -I -B /path/to/payload/scripts/prepare-physical-map.py \
  --osm /path/to/payload/data/osm/nus.osm \
  --metadata /path/to/payload/data/osm/nus.metadata.json \
  --scope /path/to/payload/adapter/physical_map_examples/nus-scope.geojson \
  --map-id nus-offline --title "NUS offline example" \
  --rules /path/to/payload/adapter/scene_service/evidence_rules_v2.json \
  --out /tmp/nus-candidate
```

入口按脚本位置显式加载解包根，不依赖当前目录或 PYTHONPATH。建图包仍只用 Python 标准库，运行环境是 Linux/Python 3.11，保留系统 tzdata 和发布版 catalog。打包测试核对实际导入路径和 payload 逐文件摘要；没有新增 Python 第三方运行依赖。

## 范围和道路处理

- 确认几何按同一个 campus.projection 投影，毫米精度与旧几何一致；多块区域和孔洞写入 boundary_polygons，boundary 只保留第一外环作兼容。
- 安置资格继续由原 within_scope 和 evidence 决定：楼栋完整在任一合法区域内才参加，孔洞楼和跨界楼保留原形显示但不可安置，不切出假建筑。
- 先按完整区域切分线段，再把每条边的“矩形带 + 端点圆”解析交区间取并集，得到精确欧氏距离缓冲。它不是 bbox 缓冲，也不是用有限多边形近似圆。
- 原 OSM 顶点/节点 ID 保留，切点以原 way/段/坐标命名；没有共享 OSM 节点的几何交叉不生成步行连接。线段可以被凹区域、孔洞或分离部分切成多段。
- 裁剪输出米坐标取 6 位小数；精度受源几何毫米量化及浮点容差限制，不表示测绘精度。
- 道路可进入缓冲上下文，安置边界始终是未缓冲区域。GIS 从同一 boundary_polygons 导出，避免页面边界和安置边界各算一份。
- 缓冲后的取数包围框和面积写入来源；本地 metadata.bbox 必须覆盖它，否则报 MAP_SOURCE_INCOMPLETE，本命令不会联网补数据。
- 本批没有额外独立 surroundings 输入，不伪造周边图层；缓冲内道路在 campus/路网/GIS 中保留。

## 来源与 recipe 怎么冻结

现有 manifest v1 已能容纳：recipe 放在 `campus3d.json` 的 `source.physical_map`，该文件本来就列在 manifest.files 中，受 SHA-256 保护。**没有新增 source.json、改 manifest 契约或放宽加载器白名单。**

recipe 保存确认几何及 geometry_sha256、来源描述、缓冲、取数框及净面积、实际限额、建图 seed、规则版本/内容摘要/原字节摘要、发布素材库与 catalog 摘要、输入 XML 摘要和计数、AI 未使用标记。

builder 标为 physical-map.1，并记录实际 builder/service/OSM 辅助模块的规范化源码组合摘要：不写时间戳、绝对路径，不靠 Git 或当前工作目录猜版本。源码指纹只统一 CRLF/LF，文件内容变化仍改变摘要；打包归档另有其原字节清单与来源提交。规则原字节在读入后冻结，再交给发布器，不在中途重新选默认规则。

当前基础建图器为 POI 生成 prototype_id=null 的 placement-only 占位，发布器只接受真实 catalog ID。新入口仅从“模型素材表”去掉这种无模型占位；POI 本身、楼内用途证据和 GIS 全部保留。没有改现有素材匹配器或发布器的严格校验。

## 限额与错误

`PhysicalMapLimits` 默认采用方案“优化前受限内测”档：

| 参数 | 默认值 |
|---|---:|
| max_area_km2 / max_fetch_area_km2 | 1 / 1.5 |
| max_nodes / max_ways / max_relations | 50000 / 10000 / 2000 |
| max_buildings / max_road_segments / max_pois | 1000 / 10000 / 3000 |
| max_xml_bytes | 25 MiB |
| max_scope_vertices | 2000（额外防止异常复杂范围） |

先检查净面积（扣孔洞）与取数框，再流式预检 XML 大小、对象及候选数量，然后才做现有几何/入口/用途。实际生成对象和裁剪后的路网边数再查一次。建筑候选预检保守计数：包含关系与带 building 标签的成员 way，可能先于去重触发限额，错误里明说；大输入可由调用方显式调整限额。

面积超限为 MAP_AREA_LIMIT，数量/字节/顶点超限为 MAP_DATA_LIMIT，均带中文原因。非法轮廓为 INVALID_SCOPE，非空输出为 MAP_OUTPUT_NOT_EMPTY。范围自交、不闭合、非法孔洞、重叠 MultiPolygon、坐标越界和非有限坐标拒绝；程序不替用户补边界。

## 测试与结果

日志位于忽略目录 logs，不进正式地图库。结果如下：

| 检查 | 命令/环境 | 结果 |
|---|---|---|
| Python 全套 | `D:\App\anaconda\python.exe -B -m unittest discover -s adapter -p "test_*.py"`，Python 3.12.4 | 164 项通过，340.268 秒 |
| 前端单元 | `npm --prefix frontend test` | 395 项通过 |
| 打包全套 | `D:\App\anaconda\envs\hello-agents\python.exe -B -m unittest discover -s scripts -p "test_*.py"`，Python 3.11.15 | 29 项通过，含原字节复现 USTC 两版、新包逐文件摘要和隔离入口 |
| Linux 解包运行 | WSL scene-m15-test、Python 3.11.15，`unittest discover -s scripts -p test_package_physical_map.py -v` | 新专项 1 项通过；在源树外用 -I 导入 payload 并执行新 CLI |
| Linux NUS 归档端到端 | 同一 WSL，`python -I -B scripts/prepare-physical-map.py`，参数见下段 | 14 个文件的候选生成成功，quality=preview_only，如实保留 |
| 旧矩形路径 | 现有 builder 默认/ustc_legacy 路径各重新 write_bundle，比对动手前摘要 | NUS 5 个文件、中科大 5 个文件逐字节相同 |
| 保护文件 | 对照动手前 SHA-256 | 186 个已跟踪文件不变，含正式地图、旧夹具、运行包及原算法文件 |

最初用 Windows Python 3.11 环境跑全套时，旧贴图测试因该环境未装 Pillow 无法导入；未修改依赖或旧测试，改用本机已有 Pillow 的 Python 3.12 重跑全套通过。生产入口及解包命令另在 Linux 3.11 实测通过；不能把它说成“3.11 全套通过”。

Linux NUS 实测参数是 `--osm data/osm/nus.osm --metadata data/osm/nus.metadata.json --scope adapter/physical_map_examples/nus-scope.geojson --map-id nus-offline-physical --title NUS-offline-physical-test --rules adapter/scene_service/evidence_rules_v2.json --out logs/rt-map-nus-physical`。

本批新增离线测试：五种范围的完整 ready 地图；孔洞/跨界/凹缺口不可安置；多块区域；缓冲内外道路及圆角解析交点；没有共享节点的道路不连通；GIS 与输入轮廓一致；同输入产物逐字节相同；超限前置；非法范围/非空输出；CLI 中文错误；NUS 归档端到端；打包原字节与隔离 CLI。

已有 65 组旧编译基准、正式中科大 v1/v2 复现和旧 bbox 路径保留原断言。动手前记录了 186 个保护文件的 SHA，以及旧 NUS/中科大 bbox 输出的逐文件摘要，交付前再次核对。

## NUS 示例的实际结果与限制

本批手写的 NUS 范围只用于仓库已有小范围归档，不是实测或全校边界。WSL 3.11 实测候选：226 栋楼、78 栋可安置、26 栋有楼内服务、127 栋未知；主路网入口比例约 74.8%，低于原有 90% 要求，因此 **preview_only**。不能把它当成 ready 新图上线，也没有为了通过案例调低门槛。

候选保留在 `logs/rt-map-nus-physical/`，调用日志 `logs/rt-map-wsl-nus.log`；两者都不进入 data/maps。该结果说明离线全流程可运行，不证明 NUS 整校数据完整或质量合格。后续数据范围、路网和性能工作由相应批次处理。

旧矩形路径、证据冻结和已发布图均无语义改动；性能索引、绿化/水体增强、真实地点搜索、任务调度、上线目录/权限和 AI 接入不在本批。

## 给学弟的话

以后五张新图可以用 physical-map：先准备该地点的离线 XML/metadata，再给一个已确认的 WGS-84 Polygon/MultiPolygon 范围文件（临时手写或从 OSM 导出后取 geometry，孔洞保留）。显式传 evidence_rules_v2.json，用空候选目录，默认道路缓冲 50m。先看输出的 quality：preview_only 不算可用图，别改门槛硬过。core.py、entrances.py 和 evidence 比对我都没动；新代码在 physical_map/physical_scope，后处理会复用 _graph、_bundle。你合并性能改动时请保留这些输入/输出形状。旧 ustc-gaoxin 1/2 继续原命令复现，新规则只生成新图或新版本，不覆盖已发布目录。
