# M15 第九批交付：楼栋主用途与楼内服务

## 结果和边界

修复“医院里有一家餐厅，就把整栋医院当成餐饮”的问题。新地图用 20 类用途，分别保存主用途 functions、楼内服务 services。人物只看主用途；品牌先找主用途匹配，找不到才找楼内服务，最后才执行已经确认的兜底。所有位置仍为示意，不影响模拟引擎。

只在 mecoffe-scene 的 feat/m15-function-taxonomy 本地分支实现；没有推送、合并、部署、访问服务器、修改团队仓库、调用模型或下载地图。没有做几何/证据性能优化，五张新地图的实图重建由学弟完成。场景页接团队实时/回放的原第九批工作顺延为第十批。

## 实现位置

| 位置 | 作用 |
| --- | --- |
| adapter/scene_service/evidence_rules_v2.json | 20 类的定义、例子、标签表、名称规则、禁入类与 AI 阈值；完整冻结进新地图 |
| adapter/scene_service/taxonomy.py | 纯程序分层判定，主用途与楼内服务不混算 |
| evidence.py / auto_evidence.py / maps.py / map_package.py | 按冻结版本选择旧/新路径，读取与发布冻结证据、质量统计、GIS 附加用途字段、AI 待判断说明 |
| resolver.py / validation.py / checker.py / contract-v3.json | 分层安置与 v3 校验；旧规则仍输出 v2 |
| frontend/src/mecoffe/sceneResult.js / sceneMap.js | 读取 v1/v2/v3，核对地图冻结策略及证据层级 |
| sceneLabels.js / gis/labels.js / gis/model.js / gis/MapLibreScene.js / campus3dEnvironmentModel.js / views/MeCoffe3D.vue / views/MeCoffeGis.vue | 中文类别、小类显示、主用途/楼内服务信息、三维/GIS 颜色；旧地图颜色路径保留 |
| packages/scene-service/ | 零运行依赖的 mecoffe_scene_service 0.2.0，可给团队固定版本同步 |
| scripts/export_scene_service.py / test_export_scene_service.py / verify_scene_service_install.py | 导出、AST/未分类文件检查、逐文件及整份清单锁定、离线安装验证 |
| adapter/test_function_taxonomy.py / frontend/tests/functionTaxonomy.test.js | 分层语义、冻结读写、新旧兼容和显示检查 |

最终分类表（含每类定义、正反例、全部标签映射及名称正则）：[function-taxonomy-v2.md](function-taxonomy-v2.md)。JSON 是可执行事实来源，文档按同一份 JSON 生成核对。没有修改旧 kind 或素材 catalog。

## 安置规则和质量输出

- annotation > 具体 building_tag > name_rule > 达到 80% 的 ai_inferred。generic_education 保持降级，不压住具体医院、食堂、科研等用途。
- annotation add 保留具体标签，replace 替换主用途；楼内真实服务继续保存。主用途与服务不同不算冲突；主用途同档冲突和被压低的主用途冲突仍记 warning。
- POI 必须严格落在唯一楼的外环内且不在孔洞内；不做最近楼吸附。只有 POI 主用途的楼带 primary_from_services=true，理由和界面都写“仅据楼内店铺推断”，继续交给 AI 待判断。
- 人物只匹配主用途。品牌在整张地图所有合格主用途候选为空时，才启用楼内服务候选；不会为了尽量分楼越过这一层级。层内仍按品牌名排序和原确定性哈希分楼。
- 主用途含 transport / utility / construction 任一类，整栋禁止安置，不能进入 any_building_in_scope；override 同样报 OVERRIDE_INVALID。三类服务也不作为品牌用途候选。unknown 仍可用于已确认兜底。禁止自动放宽偏好或自动改为 none。
- 新 quality 除保留 function_counts 外，增加 primary_function_counts、buildings_with_services、non_placeable_buildings、poi_only_primary_buildings；用途数量包含 20 个键，统计的是楼数，多用途楼会计入多类。团队地图列表应原样读取这些数值。
- 中文理由能区分“医院楼内有餐饮服务”“仅据楼内店铺推断”“依据名称规则”“依据 AI 推断（把握 xx%）”。证据依旧保留原始 key/value/ref；不新增小类字段，不把 AI 说成人工确认。

## 版本与兼容

| 对象 | 保持/变化 |
| --- | --- |
| 已发布 ustc-gaoxin 地图 1、2 | 所有字节不变，仍用旧规则；地图版本与 SceneResult 版本是两回事 |
| 旧规则、auto-evidence.1 地图及 none | compile 继续输出原 scene.result.v2，旧结果、理由、排序、哈希不变 |
| 冻结 auto-evidence.2 的地图 | compile 输出 scene.result.v3，resolver_version=3 |
| SceneResult v3 | 仅扩大用途枚举并在证据里增加必填 layer=primary/service；人物不得用 service 层；其余字段及规范化哈希算法不变 |
| v1/v2 旧契约及夹具 | 原字节不改，Python 和前端继续读取 |
| 旧显示程序/0.1.0 包 | 不能读取 v3；新地图必须与支持 v3 的显示端和 0.2.0 包一起接入，不能只升级地图 |
| 运行包 0.2.0 | 支持 v1/v2/v3；SCENE_RESULT_OUTPUT_SCHEMA_VERSION 是新规则输出 v3，旧规则/none 仍为 v2，不代表统一改写旧输出 |

assignment_meta.rules_version 仍指安置偏好规范；分类规则由 map_ref 指向的 manifest.evidence_policy 冻结，二者不是同一个版本号。

规则 JSON 保留原 scene.evidence-rules.v1 文件格式，用 version=auto-evidence.2 选择新语义；version 和内容摘要同时进 manifest.evidence_policy 与 quality。规则文件和 AI 原文件本身也由 manifest.files 核对字节。编译冻结地图时读取保存的证据，不重问 AI、不套当前默认规则。新增 JSON 和测试地图加了 -text，防止检出时换行变化。

默认的旧 Python 发布路径和旧中科大复现命令不换规则。要启用新分类，发布/prepare-ai-review 明确传 --rules adapter/scene_service/evidence_rules_v2.json，避免仅升级代码就重解释已有地图。

## 旧输出基准与合成样例

修改前从 39b4ae1 保存了 65 组 compile 响应，覆盖中科大 1/2、旧中科大/NUS 归档、现有三份前端地图、内部合成地图和 none。包括 57 份成功结果及 8 份原本就拒绝的响应；逐份比较规范化 JSON 字节，连 scene_id/result_sha256、理由和 warning 都相同。同时检查原来 98 个地图/相关文件的原字节摘要。基准在 adapter/scene_service/fixtures/compat/legacy-compile-baseline.json；没有重生成任何旧夹具。

新增 frontend/tests/fixtures/scene-taxonomy/maps/synthetic-taxonomy/1 为完全合成测试图，不进 data/maps 或 embed。包含医院+院内餐厅、住宅+底商、教学楼、AI 酒店、配电房、门卫、购物广场、通用教学标签下的科研楼。AI 使用固定手写离线样例：0.84 生效，0.4 不生效。规则、AI 文件及新夹具重新生成后逐字节一致。

python scripts/generate-taxonomy-fixtures.py <一个空输出目录>

该命令只用于生成新的测试副本。版本目录已有不同内容时拒绝覆盖，不能用它覆盖已发布地图。

## 0.2.0 包和导出保护

源码仍只维护 adapter/scene_service；packages/scene-service 由脚本生成。taxonomy 纯函数进入运行包，发布默认规则文件、AI 清单准备、地图发布、建图、地图文件、测试夹具均不进运行包。

导出规则版本升为 3，因为显式纳入 taxonomy.py、contract-v3.json，并显式排除发布默认规则 evidence_rules_v2.json。AST 相对/包内绝对导入依赖检查、未归类 .py/.json 拦截、额外/缺失/篡改文件检查均继续执行。

第七批锁死“包必须等于 0.1.0”的一条历史保护测试，已按负责人批准更新为：锁定 0.2.0 整份 EXPORT_MANIFEST 的 SHA-256；清单再逐文件锁定内容。任何包文件意外变化、重新导出后清单变化都会失败；同时核对 0.2.0、v3 必填 layer、与 39b4ae1 历史中的 v1/v2 契约和素材原字节一致。0.1.0 只从该 git 历史取，没有另存副本。其他原测试断言不改。

python scripts/export_scene_service.py
python scripts/export_scene_service.py --check
python -I packages/scene-service/verify_export.py
python scripts/verify_scene_service_install.py --python <Python3.11路径> --out <新的日志目录>

干净 3.11 环境离线安装：--no-index --no-deps --no-build-isolation --no-cache-dir；构建工具只用本机 ensurepip 已有离线版本，零运行依赖，导入路径来自 site-packages，未加载 adapter。安装验收保留原 7 组与 c0bf430 的字节比较，另编译并校验含 name_rule、ai_inferred、service 层的 v3 新合成地图。

## 测试结果

| 检查 | 命令 / 结果 |
| --- | --- |
| Python 全套 | `D:\App\anaconda\python.exe -m unittest discover -s adapter -p "test_*.py"`：146 通过，250.663 秒 |
| 前端全套 | `npm --prefix frontend test`：393 通过 |
| 打包与导出测试 | `python -m unittest discover -s scripts -p "test_*.py"`：28 通过，含建图包独立导入及中科大 1/2 原字节复现 |
| 默认嵌入构建 | `npm --prefix frontend run build:embed`：通过，242 文件、113.83 MB；仅有原有大分块提示 |
| 公开审计 | `node scripts/audit-public.cjs`：0 项 |
| 导出与清单 | `python scripts/export_scene_service.py --check`、`python -I packages/scene-service/verify_export.py`：通过；26 个交付文件（含清单自身） |
| 离线安装 | `python scripts/verify_scene_service_install.py --python D:\App\anaconda\envs\hello-agents\python.exe --out logs/milestone15-batch9-install-release`：通过；Python 3.11.15，site-packages，零运行依赖，无 adapter 导入 |
| 兼容 | 65 组旧响应规范化字节一致；98 个既有文件字节一致；安装后的原 7 组 compile 与 c0bf430 一致；新增 v3 的 compile、validate、check 全通过 |

Python 全套在本机已有 Pillow 的 Python 3.12.4 下执行。首次尝试用独立 3.11 环境跑全部 adapter 测试时，旧贴图测试因缺少 Pillow 无法导入；没有下载依赖或修改旧测试。运行包本身另在无源仓库路径的干净 3.11 环境完成离线安装与功能验收，符合团队 Python 版本要求。

专项覆盖：医院/住宅与服务分层、POI-only 主用途及 AI 清单、主用途优先的品牌安置、人物不看服务层、禁入类与 override/兜底、unknown 兜底、AI 新类别与临界阈值、名称排除与冲突、冻结输入不可改、新地图重新生成字节一致、v3 前后端校验、中文标签与配色、三维/GIS 共用安置。旧行为测试只有获准的 0.1.0 发布保护断言及安装脚本版本断言更新，其他原断言未改。

完整日志在 logs/milestone15-batch9-*，不进公开提交。未执行网络建图、真实 AI、团队后端测试、服务器联调；本批没有声称做过浏览器手工截图验收。构建仍为默认关闭本地导入的正式产物。

## 团队仓库后续同步清单（本批未改）

等 #27 合并并按最新 main 单独接入，不把新包直接塞入待审 PR：

1. 固定同步 packages/scene-service 0.2.0，先跑 verify_export；SOURCE/EXPORT_MANIFEST 和新版本保持一致，不在团队副本上改源码。
2. MapIntent 的用途选项扩到 20 类；实际仍按所选地图冻结的词表校验，旧地图不能强塞新类别；管理员的结构化意图和 AI 待判断说明用同一份分类定义。
3. list_scene_maps 输出新类别楼数和楼内服务/不可安置数量；旧地图仍显示旧规则的实际统计，不能补造分类。
4. social-sim 的 check_map 和 MapResult 目前按本轮协作信息只认 v2，同步时也接受 v3，并调用 0.2.0 的 validate_result；不删 v2 支持。
5. 配置页 MapView 同时读 v2/v3，显示中文新类别和主用途/楼内服务，品牌安置依据不再混成整栋用途。
6. 显示包升级到本批 v3 读取版本后，再按地图不可变版本同步新图。三维/GIS 的运行页接入、计划修订映射仍留第十批，不在本批解决。

## 给学弟的重建说明

先用本分支的新规则，不要只跑旧的 --auto-evidence 默认命令。五张图已有的本地几何可以直接用，不必为用途重下 OSM。每张按下面命令发布到一个新的空目录，再检查 quality：医院应是 medical，楼内餐厅在 services；住宅底商同理；配电房、门卫不参加兜底。

```powershell
python -m adapter.scene_service publish --source <现有几何目录> --out <新空目录>/<map_id>/<版本> --map-id <map_id> --map-version <版本> --title <地图中文名> --rules adapter/scene_service/evidence_rules_v2.json
python -m adapter.scene_service evidence --map <新地图版本目录> --out <检查报告.json>
```

需要 AI 时先 prepare-ai-review --map <几何目录> --rules adapter/scene_service/evidence_rules_v2.json --out <待判断清单.json>，回填文件绑定该几何地图的确切 map_ref；发布时再加 --ai-evidence <离线回填.json>。没有 AI 或人工补注也可发布；不确定的楼保留 unknown。未入库的本地 1 版可在新空目录重建后提 PR；已发布/被引用版本必须升版，不能原地改。请带 manifest、quality、新规则和原 AI 文件一起提审，性能分析另交，不混在这个 PR。

## 已知限制

- 主用途含交通即整栋禁入，包括车站内的商铺；这是负责人明确接受的本批限制，未做分区或楼层安置。
- 主用途与服务层都只是楼栋尺度，没有房间、楼层或店面几何。AI 仍是文件进出，不调用真实模型。
- “XX广场”单靠名字不硬猜商场；购物广场/商业广场或明确 mall 等标签才识别。标签表未列的值不硬映射。
- 主用途同档多用途暂保留并警告；人工 annotation add 保持原含义，不自动做排他选择。
- 旧规则中的 POI 混算和旧兜底行为为了字节兼容继续保留，只在新规则地图解决；不能把旧 v1/v2 地图挂上新规则而不升地图版本。
- 本批不优化建图耗时，不重建或发布学弟的五张真实地图，不同步团队仓库，不部署。
