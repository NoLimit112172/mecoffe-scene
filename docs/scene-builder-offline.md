# Python 离线建图包

环境为 Linux、CPython 3.11 和系统 IANA `tzdata`。归档含 `adapter/scene_builder`、`adapter/scene_service`、OSM 转换脚本、正式地图生成入口、`mecoffe-embed-v1` 素材库描述和发布版 `catalog.json`，以及本地几何与原始地图输入。运行只用 Python 标准库。OSM 下载地址、归档时间、字节哈希与来源署名随 `data/osm` 中的元数据保存，分发说明见归档内的 `notices/NOTICE.md`。

## 复现正式中科大地图

解压归档后进入 `payload/`。主线的发布脚本从归档里的预处理几何复现 `ustc-gaoxin/1`，同时生成用途证据、`quality.json` 和 `scene.map-manifest.v1` 清单。预处理输入沿用公开的预览地图几何，其中建筑 GIS 图层采用正式版公开字节，以保留坐标的数值序列化。归档里的输入清单也记录了该图层的实际摘要。

```sh
python3.11 -B -S -c 'from zoneinfo import ZoneInfo; ZoneInfo("Asia/Shanghai")'
output=$(mktemp -d)
python3.11 -B -S scripts/generate-ustc-map.py --no-template \
  --out "$output/ustc-gaoxin/1"
python3.11 -B -S -m adapter.scene_service evidence \
  --map "$output/ustc-gaoxin/1" --out "$output/evidence.json"
```

`$output/ustc-gaoxin/1/manifest.json` 的 SHA-256 应为 `101a660efd370e807d4d3e579ca2c5732b69c79ce8fb43a0a6d864e9a41bf1ad`，用于 `map_ref.manifest_sha256`。`catalog_sha256` 对应素材库真正发布的目录字节。同一地图编号与版本对应一份固定内容，审核补注或改动地图后以新版本发布。具体用途以地图证据和正式审核的补注为准。

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

## Linux 验收

在禁止出网的测试环境将 `payload/` 只读挂载，把输出写到独立目录。将复现的 `ustc-gaoxin/1` 与地图库归档中 `payload/scene-maps/ustc-gaoxin/1/` 逐文件比对，检查七个 GIS 图层、`quality.json.status` 和 `catalog_sha256`。另取 OSM 元数据副本改动 `sha256`，确认输入被拒绝。
