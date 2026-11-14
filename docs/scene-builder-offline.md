# Python 离线建图包

## 快速 physical-map 兼容补丁

本包沿用主线 `physical-map` 的全部命令参数、14文件候选结构、stdout结果JSON、stderr五阶段进度和错误处理；仍显式使用 `auto-evidence.2`。只增加当前进程内的保守空间索引和几何重复校验缓存，不增加在线接口、排队、OSM下载、存图或部署职责，也不需要第三方Python运行依赖。

2026-11-14，macOS ARM64 / Python3.11同输入三轮新进程对照：0.771876km²校园样本总时中位5.204秒降为0.197秒；0.053712km²社区子范围0.311秒降为0.097秒。包含进程启动与本地建图，不含调用方下载。建筑/用途/质量不变，校园样本仍为preview_only。实际源码摘要正常更新；固定身份的单独诊断中，两样本各14文件和stdout原字节一致。完整口径、复跑脚本和来源见源仓库 `docs/physical-map-speed-delivery.md`。

环境为 Linux、CPython 3.11 和系统 IANA `tzdata`。归档含 `adapter/scene_builder`、`adapter/scene_service`、OSM 转换脚本、正式地图生成入口、`mecoffe-embed-v1` 素材库描述和发布版 `catalog.json`，以及本地几何与原始地图输入。`scene_service` 的运行 `.py` 和 `.json` 递归打包，包含场景编译器、问题说明代码和中文说明资源，排除测试、夹具和缓存。运行只用 Python 标准库。OSM 下载地址、归档时间、字节哈希与来源署名随 `data/osm` 中的元数据保存，分发说明见归档内的 `notices/NOTICE.md`。

## 复现正式中科大地图

解压归档后进入 `payload/`。主线的发布脚本从归档里的预处理几何复现 `ustc-gaoxin/1`，同时生成用途证据、`quality.json` 和 `scene.map-manifest.v1` 清单。预处理输入沿用公开的预览地图几何，其中建筑 GIS 图层采用正式版公开字节，以保留坐标的数值序列化。归档里的输入清单也记录了该图层的实际摘要。

```sh
python3.11 -B -S -c 'from zoneinfo import ZoneInfo; ZoneInfo("Asia/Shanghai")'
output=$(mktemp -d)
python3.11 -I -B scripts/generate-ustc-map.py --no-template \
  --out "$output/ustc-gaoxin/1"
python3.11 -B -S -m adapter.scene_service evidence \
  --map "$output/ustc-gaoxin/1" --out "$output/evidence.json"
python3.11 -I -B scripts/generate-ustc-map.py --no-template --version 2 \
  --annotations data/maps/ustc-gaoxin/review-annotations.v2.json \
  --out "$output/ustc-gaoxin/2"
```

`$output/ustc-gaoxin/1/manifest.json` 的 SHA-256 应为 `101a660efd370e807d4d3e579ca2c5732b69c79ce8fb43a0a6d864e9a41bf1ad`，v2 为 `9d76db922491c6dacb42529a97c4e50ac3b13f864325a7ee392095bf9f3aa8d9`，分别用于各版本的 `map_ref.manifest_sha256`。`catalog_sha256` 对应素材库真正发布的目录字节。同一地图编号与版本始终对应一份固定内容。

v2 使用包内审核补注确认的 3 座食堂。补注的 `map_ref` 引用 v1，因此先生成同级 `1/`，再生成 `2/`。发布器会核对该 v1 清单的原字节摘要，补注文件在归档中保留源码字节和换行。

隔离模式 `-I` 下，生成脚本按自身文件位置定位解包根目录。打包回归测试还会显式加入这份解包目录来导入全部 `scene_service` 模块，确认依赖和 JSON 资源齐备。以上命令只使用建图包自身的几何、素材目录和审核补注复现两版。

## 从原始数据独立建图

```sh
python3.11 -B -S -m adapter.scene_builder osm \
  --osm data/osm/ustc_gaoxin.osm --metadata data/osm/ustc_gaoxin.metadata.json \
  --campus-id ustc-gaoxin-preview --output-dir "$output/ustc-preview"
python3.11 -B -S -m adapter.scene_builder osm \
  --osm data/osm/nus.osm --metadata data/osm/nus.metadata.json \
  --campus-id nus --output-dir "$output/nus"
python3.11 -B -S -m adapter.scene_builder geojson \
  --input data/examples/offline-map.geojson \
  --campus-id offline-example --output-dir "$output/geojson"
```

这些命令直接从归档的 OSM 或 GeoJSON 生成基础地图清单 `mecoffe.scene-bundle.v1`，适合检验新校园数据和素材匹配。中科大原始 OSM 的建图结果使用独立预览编号 `ustc-gaoxin-preview`，正式 `ustc-gaoxin/1` 由上面的发布脚本复现。输入 GeoJSON 采用 WGS84 经纬度，包内示例为合成地物。已有 OSM 归档用 `--osm` 和 `--metadata`，联网采集才使用 `--bbox`。

## 已确认多边形范围的纯地图入口

新命令只读取离线 OSM，不搜索地点、不下载、不调模型，也不生成模拟时间或轨迹。在源码根可运行 `python -B -m adapter.scene_builder physical-map`；解包后可在任意工作目录使用下面的隔离入口，路径按实际解包位置调整，输出目录必须为空或不存在：

```sh
python3.11 -I -B /path/to/payload/scripts/prepare-physical-map.py \
  --osm /path/to/payload/data/osm/nus.osm \
  --metadata /path/to/payload/data/osm/nus.metadata.json \
  --scope /path/to/payload/adapter/physical_map_examples/nus-scope.geojson \
  --map-id nus-physical-example --title "NUS offline example" \
  --rules /path/to/payload/adapter/scene_service/evidence_rules_v2.json \
  --out /tmp/nus-physical-candidate
```

scope 为 WGS-84 Polygon/MultiPolygon 几何，可带孔洞；从 Feature 导出时取 geometry。`--scope-source` 可另给来源 JSON（osm/manual/manual_subset），默认仅记录 manual。显式传新规则，不依赖旧默认；道路缓冲默认 50m，只扩道路上下文，不扩大人物和品牌的可安置范围。`--limits` 可读 JSON 限额，`--draft-out` 可保留完整草稿。

stdout 为结果 JSON、stderr 为实际阶段；生成成功仍需检查 `summary.status`。包内 NUS 手写范围只是已有小归档内的演示，不是完整校园边界，当前按既有质量门槛得到 preview_only，不能直接上线。旧 USTC v1/v2 仍按上文原命令复现，不用此命令覆盖。算法边界、限额和完整交付说明见源码仓库 `docs/realtime-map-batch1-delivery.md`。

## Linux 验收（原有复现路径）

在禁止出网的测试环境将 `payload/` 只读挂载，把输出写到独立目录。将复现的 v1、v2 与地图库归档中对应的 `payload/scene-maps/ustc-gaoxin/<version>/` 逐文件比对，检查七个 GIS 图层、`quality.json.status`、`catalog_sha256` 和 v2 的 3 座食堂。另取 OSM 元数据副本改动 `sha256`，确认输入被拒绝。
