# physical-map 提速兼容交付

2026-11-14。按吴贤学长《在线建图：建图程序对接说明》对齐，学弟方交付现有建图程序的兼容提速补丁。基线为场景仓库 `c51f7bd04ac06c82c4d21c04f2ff20eb1a465eeb`，工作分支 `feat/physical-map-speed-compat`；纯性能源码提交 `3c2d5f3`。

## 对接范围

改动集中在入口道路搜索、建筑/水域候选索引和重复几何校验；配套提交运行包镜像、离线复跑输入、基准脚本及兼容性测试。已有后台继续负责搜索、确认、排队、OSM下载、存图、采用和部署。

原程序会把实际源码SHA写进recipe，所以换实现后，来源摘要及下游manifest/map_ref会正常变化。固定源码身份的独立差分诊断中，两个样本的14文件和完整stdout逐字节一致；质量门槛和建筑数量保持不变。

## 不变的调用契约

```sh
python3.11 -B -m adapter.scene_builder physical-map \
  --osm source.osm --metadata metadata.json \
  --scope scope.json --scope-source scope-source.json \
  --map-id auto-example --map-version 1 --title "南京大学（仙林校区）" \
  --rules adapter/scene_service/evidence_rules_v2.json \
  --limits limits.json --road-buffer-m 50 --seed 0 --out empty-candidate
```

这里的南京大学只是调用示例，必须由调用方提供对应真实文件，不表示本轮构建过该校。省略项、默认值和可选`--draft-out`沿用上游。业务输入错误退出1；原有argparse参数语法错误退出2的行为也保持不变。成功退出0包含preview_only，调用方仍须检查summary.status。

stderr阶段严格保留 `reading → geometry → entrances_gis → evidence_quality → publishing`，stdout仅为原结果JSON；没有插入计时字段或额外进度。默认1km²净面积、1.5km²取数框、1000栋、XML25MiB和其他上限全部不变；900秒任务超时仍由学长后台管理。

相对基线，`__main__.py`、`physical_map.py`、`physical_scope.py`、`core.py`、`auto_evidence.py`和`evidence_rules_v2.json`均未修改。规则原字节摘要为`86d7db99a5be5ef6cbeb69c7afeb1c2834bb0235a7df1c8bea51a7e105af691a`。

## 实现与性能

- 道路BVH只提供距离下界，仍用原投影、距离舍入、同距与原顺序规则决定入口。
- 稳定顺序网格索引只排除空间上不可能相交的建筑/水域，候选仍执行原精确谓词；EPS/ULP外扩及大范围回退避免漏选。
- 环合法性按坐标内容做4096项有界缓存，修改坐标会重新检查；首次新地点也在本次进程内建立索引/缓存，不依赖预先构建过该地点。
- 保留上游现有用途分类、楼内服务、涉水与安置语义。本轮不夹带水域孔洞规则修正、楼高补注或质量策略调整。

环境为macOS26.6 ARM64、CPython3.11.15。原版和优化版每样本各3次交替执行，均为独立新进程、未存在的输出目录，使用固定原始XML/metadata/轮廓/规则/seed；系统文件缓存未清空。计时从父进程派发到子进程退出，包含启动及本地全流程，排除外部搜索、排队、OSM下载和浏览器。分段时间是父进程接收原stderr阶段的边界观测，不是独占CPU函数计时；各阶段中位数不能拼成一轮总时。

| 样本 | 原版三次总秒数 | 优化后三次总秒数 | 中位数 | 提速 | 最大RSS |
| --- | --- | --- | --- | --- | --- |
| 高新校园，净0.771876km² | 5.1713 / 5.2041 / 5.2055 | 0.1968 / 0.1974 / 0.2003 | 5.2041→0.1974秒 | 26.36倍，少96.21% | 43.17→43.28MiB |
| 华清内退子范围，净0.053712km² | 0.3099 / 0.3109 / 0.3111 | 0.0972 / 0.0974 / 0.0983 | 0.3109→0.0974秒 | 3.19倍，少68.68% | 36.08→36.02MiB |

高新使用已有完整周边OSM归档，以覆盖真实校界的50米道路缓冲；取数框1.032853km²，全部默认限额内。按上游语义保留归档范围内对象，共77栋、29栋可安置，主分量比例0.64935，因此仍为preview_only。它与此前演示使用的31楼tight归档不是同一份输入，不混算性能。华清为明确标注的内退子区域，保留32栋、10栋可安置，ready；不宣称完整社区边界。

两个样本的建筑数、主用途、楼内服务、unknown、eligible、主分量比例及全部warnings逐项相同。原始产物14文件中13个SHA变化，经严格路径审计，仅为recipe源码身份及manifest/证据引用摘要级联；冻结规则文件原字节不变。独立诊断只在子进程内替换`_builder_identity`返回值，再调用同一解析器；每样本14/14文件和完整stdout严格相等，不对比较结果做字段掩码。该诊断不计入性能聚合，生产实现没有伪装旧SHA。

机器可读摘要在 `docs/physical-map-speed-measurements.json`；完整原始命令、输入/源码快照、每轮stdout/stderr、RSS、逐文件SHA与差异路径在忽略目录 `logs/physical-map-speed/paired-01/`。

## 验证与发布包

| 检查 | 结果 |
| --- | --- |
| adapter完整回归 | 188项通过，无跳过；Pillow只借用既有临时测试依赖，生产仍标准库 |
| scripts完整回归 | 34项通过，无跳过；包括独立解包、旧中科大v1/v2原字节复现与导出核验 |
| 前端原有测试 | 410项通过、2项原Windows条件跳过；未改前端源码，临时依赖链接已移除 |
| CLI/离线新旧差分 | 原12项+新增4项通过；审计钩子禁止socket/DNS；help/参数/ready/preview_only/错误/相位及14文件严格对照 |
| 旧图基准 | 65组旧编译响应canonical字节及97个正式输入SHA不变 |
| 独立运行包 | 0.2.1本地离线安装成功；7组旧编译响应原字节一致，v3规则与校验通过 |
| 原始源码/规则保护 | 物理入口、范围、core、auto-evidence.2与规则无diff；已发布地图未改 |

发现并精准修复一项上游验收夹具问题：`legacy-compile-baseline.json`误登记一份从未入库的`campus3d.json.tmp`，其摘要与已登记正式文件相同。本轮只去掉这1条临时副本记录并加完整性检查，65组expected与97个正式输入摘要均未修改。证据在 `logs/baseline-fixture-cleanup-20261114/report.json`，不把这项清理计作性能收益。

生成的scene-service源码镜像升补丁版0.2.1，导出规则4显式纳入spatial_index，避免解包后缺模块。规则版本、SceneResult契约及地图格式不升级；调用方替换的是建图包，不要求改团队源码或增加服务。

建图包继续由 `scripts/package_scene_builder.py` 生成，沿用 `scene-map-builder-1.0.0.zip` 归档命名，实际源码由artifact.json的source_commit和逐文件SHA区分。解包后在payload根可用原`-m`命令，也可在任意工作目录运行：

```sh
python3.11 -I -B /path/to/payload/scripts/prepare-physical-map.py \
  --osm source.osm --metadata metadata.json --scope scope.json \
  --scope-source scope-source.json --map-id auto-example --map-version 1 \
  --title "示例" --rules /path/to/payload/adapter/scene_service/evidence_rules_v2.json \
  --limits limits.json --road-buffer-m 50 --seed 0 --out empty-candidate
```

本轮实际运行环境为macOS/Python3.11；未新增Linux容器或服务器部署。学长本机站的“南京大学→选校区→建图→采用→小模拟→三维/GIS”和团队服务器审批仍由学长验收，不能把本轮程序包兼容验证称为主站已上线。

复跑：`python3.11 -B scripts/profile_physical_map.py --python /path/to/python3.11 --baseline-commit c51f7bd --repeats 3 --output logs/physical-map-speed/new-unused-label`。脚本拒绝覆盖旧结果。

## 逐文件改动与定位

下表覆盖相对c51f7bd的每个改动文件；源码位置和验证结果在交付时核对。运行产物、原始运行日志与源码快照存放在忽略目录；公开的离线复跑输入随性能用例提交。

| 文件 | 函数/组件及行号 | 验证/用途 |
| --- | --- | --- |
| `adapter/physical_map_examples/performance/cases.json` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/huaqing-subset-scope-source.json` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/huaqing-subset-scope.geojson` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/huaqingjiayuan.metadata.json` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/huaqingjiayuan.osm` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/limits.json` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/ustc-gaoxin-scope-source.json` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/physical_map_examples/performance/ustc-gaoxin-scope.geojson` | `基准输入 / 范围 / 来源 / 默认限额:1` | 原字节SHA核验；3对运行在原默认限额内；未联网 |
| `adapter/scene_builder/entrances.py` | `_RoadIndex / generate_entrances:57` | 道路BVH；20项性能针对测试、188项adapter及物理CLI差分 |
| `adapter/scene_service/evidence.py` | `enrich_map:57` | 候选与入口索引；用途/质量严格等价和65组旧编译 |
| `adapter/scene_service/fixtures/compat/legacy-compile-baseline.json` | `map_files:40306` | 只移除1个误收临时副本；97正式SHA/65 expected未改 |
| `adapter/scene_service/geometry.py` | `intersects / valid_ring / _valid_ring_coordinates:31` | 保守排除和坐标缓存；随机/边界/坐标修改回归 |
| `adapter/scene_service/spatial_index.py` | `BoundsIndex:28` | 稳定网格、EPS/ULP、大对象回退；索引差分 |
| `adapter/test_entrance_index.py` | `入口BVH差分测试:11` | 原遍历/同距/原顺序对照通过 |
| `adapter/test_function_taxonomy.py` | `LegacyBaselineCase:260` | 临时文件完整性guard；17项含65个expected不变 |
| `adapter/test_physical_map_speed_compat.py` | `PhysicalMapSpeedCompatibilityCase:41` | 4项真实CLI差分、14文件原字节与禁联网 |
| `adapter/test_scene_geometry_cache.py` | `环缓存测试:8` | 值失效、非法环和容量约束通过 |
| `adapter/test_scene_segment_bounds.py` | `线段保守排除测试:25` | 边界容差/随机原谓词差分通过 |
| `adapter/test_scene_spatial_index.py` | `候选/证据差分测试:20` | 新版用途服务、冻结字段及水域原语义保持 |
| `docs/physical-map-speed-delivery.md` | `本交付记录:1` | 对接边界、指标、逐文件与验收 |
| `docs/physical-map-speed-measurements.json` | `实测摘要:2` | 来源报告SHA、两样本三对、严格差异审计 |
| `docs/scene-builder-offline.md` | `离线包说明:3` | 补丁口径、时间边界、原命令与14文件不变 |
| `packages/scene-service/EXPORT_MANIFEST.json` | `自动生成0.2.1发布元数据:1` | 导出可复现、来源/文件SHA与离线安装通过 |
| `packages/scene-service/README.md` | `自动生成0.2.1发布元数据:1` | 导出可复现、来源/文件SHA与离线安装通过 |
| `packages/scene-service/VERSION` | `自动生成0.2.1发布元数据:1` | 导出可复现、来源/文件SHA与离线安装通过 |
| `packages/scene-service/pyproject.toml` | `自动生成0.2.1发布元数据:1` | 导出可复现、来源/文件SHA与离线安装通过 |
| `packages/scene-service/src/mecoffe_scene_service/__init__.py` | `自动生成运行镜像:1` | 由权威源码导出，27文件核验、离线安装及7组旧响应 |
| `packages/scene-service/src/mecoffe_scene_service/evidence.py` | `自动生成运行镜像:1` | 由权威源码导出，27文件核验、离线安装及7组旧响应 |
| `packages/scene-service/src/mecoffe_scene_service/geometry.py` | `自动生成运行镜像:1` | 由权威源码导出，27文件核验、离线安装及7组旧响应 |
| `packages/scene-service/src/mecoffe_scene_service/spatial_index.py` | `自动生成运行镜像:1` | 由权威源码导出，27文件核验、离线安装及7组旧响应 |
| `scripts/export_scene_service.py` | `VERSION / MODULES / source_policy:12` | 0.2.1、导出器4纳入新模块；11项导出检查 |
| `scripts/profile_physical_map.py` | `run_cli / compare_candidates / audit_provenance_changes:141` | 新进程总时/RSS/相位、严格原字节和来源差异审计 |
| `scripts/test_export_scene_service.py` | `发布摘要锁与导出测试:18` | 新导出摘要、版本及原契约/素材固定检查 |
| `scripts/test_package_physical_map.py` | `PhysicalPackageCase:16` | 载荷必须含spatial_index；原隔离命令通过 |
| `scripts/test_profile_physical_map.py` | `PhysicalMapBenchmarkTests:13` | 5项输入/计时/真实子进程/不得掩码的负例 |
| `scripts/verify_scene_service_install.py` | `CHILD隔离安装探针:47` | 0.2.1离线安装、7组旧响应与v3验证 |
