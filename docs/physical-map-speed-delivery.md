# physical-map 提速兼容交付

2026-11-14。按吴贤学长《在线建图：建图程序对接说明》对齐，学弟方交付现有建图程序的提速补丁，并明确包含一类共线浮点噪声误判的修正。基线为场景仓库 `c51f7bd04ac06c82c4d21c04f2ff20eb1a465eeb`，工作分支 `feat/physical-map-speed-compat`；首次提速实现为 `3c2d5f3`，后续审核修订见下节。

## 对接范围

改动集中在入口道路搜索、建筑/水域候选索引和重复几何校验；配套提交运行包镜像、离线复跑输入、基准脚本及兼容性测试。已有后台继续负责搜索、确认、排队、OSM下载、存图、采用和部署。

原程序会把实际源码SHA写进recipe，所以换实现后，来源摘要及下游manifest/map_ref会正常变化。固定源码身份的独立差分诊断中，两份真实样本的14文件和完整stdout逐字节一致；这证明的是这些固定输入的结果一致，不代表所有退化几何输入均无行为变化。质量门槛和建筑保留策略不变。

## PR #2 合并前审核修订

1. **OSM原字节保护。** `.gitattributes`显式覆盖`adapter/physical_map_examples/**/*.osm -text diff`。测试读取cases.json中的每一份真实XML，核对read_bytes的SHA-256、metadata和expected_source_sha256；使用`core.autocrlf=true`的隔离Git检出模拟，未保护对照文件会转CRLF，样例仍保持原字节。华清误转CRLF时摘要为`3965c5ff…`，正确归档为`8d16733a…`，测试可实际拦截。
2. **缓存键保留坐标类型。** 缓存键逐坐标包含`(type(value), value)`，缓存未命中时恢复原数值和运算类型。测试使用约2⁶⁰的整数环、同值浮点环及混合类型，直接与c51f7bd旧geometry比较，两种调用顺序与反复交替均独立得到原结果；只设置`lru_cache(typed=True)`不能提供这种嵌套类型隔离。
3. **共线浮点噪声误判的修正。** 继续保留带EPS/ULP的边框分离判断。两条近共线、端点相隔约微米的线段，旧版可能因1e-12量级叉积舍入噪声将其误判为相交；新版在外框已分离时判为不相交。这是有意保留的行为修正，不能再笼统称“无语义变化”。同类退化输入会影响共用该谓词的自交合法性、入口安全、wet、scene_eligible以及最终质量/编译结果。几何和完整enrich_map回归固定这一新行为；常规差分直接以c51f7bd的geometry/evidence为旧模块基准，只允许这一类可具体识别的旧误报，不能以新版谓词的全量扫描替代旧版oracle。

固定反例为两个三角形，相邻边端点间距`1.2499999988321682e-6`米，四个旧浮点叉积为`[-1.8189894e-12, 3.6379788e-12, 1.8189894e-12, -2.0258373e-13]`。原始坐标固定在`adapter/physical_map_test_oracle.py`。旧版只在这一对边误报相交，将建筑排除；新版从`scene_eligible=False / eligible_buildings=0 / preview_only / BUILDING_EXCLUDED`修正为`True / 1 / ready / 无warning`。顶点包含、合法范围、入口可达及主分量比例都相同，阈值未调整。

差分例外必须同时满足：旧True/新False、精确二进制有理数证明边框间距大于`2*EPS`、没有旧on_segment近接触，且四个浮点及精确有理数叉积均落在局部ULP舍入尺度内。真实交叉、EPS近接触、非共线分离和反向结果变化均不能豁免；完整enrich_map结果不做字段掩码或豁免。5000组一般随机与500组近共线线段中，发现的5处差异均严格属于上述纠正。

0.2.1的运行包说明同步声明上述已知差异；0.2.0的已发布地图、规则和旧编译基准不修改。本轮不增加1.5～3km²样本，不提高在线建图上限，不同步团队仓库。学长已报告的Windows/Linux独立复核针对审核前版本；本轮修订的真实跨平台复核仍待学长进行，macOS的Git检出模拟不冒充Windows运行验证。

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
- 稳定顺序网格索引使用EPS/ULP外扩和大范围回退；候选继续执行几何判定。近共线且外框分离的旧浮点误报是上节列明的行为修正。
- 环合法性按坐标值及每个坐标的类型做4096项有界缓存，修改坐标或类型会重新检查；首次新地点也在本次进程内建立索引/缓存，不依赖预先构建过该地点。
- 用途分类、楼内服务、质量门槛与水域孔洞规则保持原实现。退化共线情况下的涉水/安置结论可能因上述修正改变，不扩展为其他几何策略调整。

以下为首次提速实现`3c2d5f3`的历史实测。环境为macOS26.6 ARM64、CPython3.11.15。原版和优化版每样本各3次交替执行，均为独立新进程、未存在的输出目录，使用固定原始XML/metadata/轮廓/规则/seed；系统文件缓存未清空。计时从父进程派发到子进程退出，包含启动及本地全流程，排除外部搜索、排队、OSM下载和浏览器。分段时间是父进程接收原stderr阶段的边界观测，不是独占CPU函数计时；各阶段中位数不能拼成一轮总时。

| 样本 | 原版三次总秒数 | 优化后三次总秒数 | 中位数 | 提速 | 最大RSS |
| --- | --- | --- | --- | --- | --- |
| 高新校园，净0.771876km² | 5.1713 / 5.2041 / 5.2055 | 0.1968 / 0.1974 / 0.2003 | 5.2041→0.1974秒 | 26.36倍，少96.21% | 43.17→43.28MiB |
| 华清内退子范围，净0.053712km² | 0.3099 / 0.3109 / 0.3111 | 0.0972 / 0.0974 / 0.0983 | 0.3109→0.0974秒 | 3.19倍，少68.68% | 36.08→36.02MiB |

高新使用已有完整周边OSM归档，以覆盖真实校界的50米道路缓冲；取数框1.032853km²，全部默认限额内。按上游语义保留归档范围内对象，共77栋、29栋可安置，主分量比例0.64935，因此仍为preview_only。它与此前演示使用的31楼tight归档不是同一份输入，不混算性能。华清为明确标注的内退子区域，保留32栋、10栋可安置，ready；不宣称完整社区边界。

两个样本的建筑数、主用途、楼内服务、unknown、eligible、主分量比例及全部warnings逐项相同。原始产物14文件中13个SHA变化，经严格路径审计，仅为recipe源码身份及manifest/证据引用摘要级联；冻结规则文件原字节不变。独立诊断只在子进程内替换`_builder_identity`返回值，再调用同一解析器；每样本14/14文件和完整stdout严格相等，不对比较结果做字段掩码。该诊断不计入性能聚合，生产实现没有伪装旧SHA。

机器可读摘要在 `docs/physical-map-speed-measurements.json`；完整原始命令、输入/源码快照、每轮stdout/stderr、RSS、逐文件SHA与差异路径在忽略目录 `logs/physical-map-speed/paired-01/`。

### 审核修订后复测

在上述缓存键修正后，仍以c51f7bd为基线、同一环境/输入/三轮新进程交替测量。实现快照为`457b0e2`，完整记录在`logs/physical-map-speed/review-paired-01/`，机器摘要为`docs/physical-map-review-measurements.json`。

| 样本 | 原版三次总秒数 | 修订后三次总秒数 | 中位数 | 提速 | 最大RSS |
| --- | --- | --- | --- | --- | --- |
| 高新校园 | 5.3784 / 5.0593 / 5.0694 | 0.2083 / 0.2073 / 0.2013 | 5.0694→0.2073秒 | 24.45倍 | 43.14→43.19MiB |
| 华清内退子范围 | 0.3069 / 0.3065 / 0.3014 | 0.0958 / 0.0947 / 0.0941 | 0.3065→0.0947秒 | 3.24倍 | 35.88→35.94MiB |

两份真实样本的完整summary仍逐项相同；原始产物变化仍仅限源码身份和级联引用摘要。固定identity后，两样本各14文件及完整stdout仍逐字节一致。新合成退化反例则如上明确断言纠正后的差异，不用真实样本一致性覆盖它。

## 验证与发布包

| 检查 | 结果 |
| --- | --- |
| adapter完整回归 | 审核修订后193项通过，无跳过；Pillow只借用既有临时测试依赖，生产仍标准库 |
| scripts完整回归 | 审核修订后36项通过，无跳过；包括真实cases摘要、autocrlf检出模拟、独立解包、旧中科大v1/v2复现与导出核验 |
| 前端原有测试 | 首轮410项通过、2项原Windows条件跳过；本轮未改前端源码 |
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
| `.gitattributes` | `OSM原字节属性:24` | 实际core.autocrlf=true检出仍保持每个case的XML SHA |
| `adapter/physical_map_test_oracle.py` | `load_c51f7bd_modules:69 / separated_roundoff_false_positive:96` | 独立固定旧模块及SHA；精确二进制边框证明与严格ULP例外，负例不能豁免 |
| `docs/physical-map-review-measurements.json` | `审核复测摘要:1` | 修订后的三轮原始数值、229项核心/脚本、已知语义纠正及范围 |
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
| `adapter/scene_service/spatial_index.py` | `BoundsIndex:31` | 稳定网格、EPS/ULP、大对象回退；已知退化误报修正 |
| `adapter/test_entrance_index.py` | `入口BVH差分测试:11` | 原遍历/同距/原顺序对照通过 |
| `adapter/test_function_taxonomy.py` | `LegacyBaselineCase:260` | 临时文件完整性guard；17项含65个expected不变 |
| `adapter/test_physical_map_speed_compat.py` | `PhysicalMapSpeedCompatibilityCase:41` | 4项真实CLI差分、14文件原字节与禁联网 |
| `adapter/test_scene_geometry_cache.py` | `RingValidationCacheCase:12` | 整数/浮点和混合类型双向交替；坐标修改失效与同类型命中 |
| `adapter/test_scene_segment_bounds.py` | `SegmentBoundsCase:20` | 直接旧geometry差分；两个固定反例、5000随机和500近共线，仅严格分类的纠正允许不同 |
| `adapter/test_scene_spatial_index.py` | `SpatialIndexCase:29` | 常规输入直接旧evidence严格对照；独立完整enrich质量纠正回归 |
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
| `scripts/test_profile_physical_map.py` | `PhysicalMapBenchmarkTests:13` | 7项：真实cases原字节、autocrlf实际检出模拟及原计时/差异负例 |
| `scripts/verify_scene_service_install.py` | `CHILD隔离安装探针:47` | 0.2.1离线安装、7组旧响应与v3验证 |
