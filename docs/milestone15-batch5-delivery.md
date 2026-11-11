# M15 第五批：配置期检查和多版本地图测试

基线 main=f00b167，分支 feat/m15-scene-check。本批提供本地验收检查，不接团队状态机、运行绑定或存储。地图、resolver、compile_scene、validate_result、SceneResult 契约和前端加载器的语义均未改变。

## 结论先行

- 新增 check 命令，复用原有名称/偏好校验、地图读取、用途证据、compile_scene、validate_result 和摘要函数，不另写一套安置或结果校验。
- 每项输出“通过 / 不通过 / 待确认”，同时给出 JSON 和中文文字报告。没有执行的项目不会假装通过。
- 成功结论固定为“配置期检查通过，运行绑定待确认”；失败结论固定为“不通过”。运行绑定、实际执行计划关系、存储/读取始终待确认。
- none 不接触 --map 指向的目录、文件或 catalog。所有位置和路线都标为示意，不影响模拟。
- 前端仅新增测试，没有加版本选择器或改加载功能。运行绑定只补私有事实清单，没有实现绑定对象或 revision 兼容。

## 入口和输出

从仓库根目录执行：

    python -m adapter.scene_service check --intent adapter/scene_service/fixtures/check/intent-ustc-v2.json --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json --map data/maps/ustc-gaoxin/2 --assignment-seed 42 --out logs/m15-batch5-ustc-v2.json

stdout 是完整 JSON；stderr 是中文报告。有 --out 时保存同一 JSON，并在路径后追加 .txt 保存文字，如 logs/m15-batch5-ustc-v2.json.txt。有“不通过”退出 1，否则退出 0。正常帮助仍按常规帮助显示。

--assignment-seed 沿用 compile 的解析：先尝试 JSON 值，否则作为字符串；其合法性由原编译校验判断。intent 中若保留旧种子，必须与独立参数类型和值一致。

**check 的 map 输入必须是准备好的正式版本目录**，以 map_id/map_version 结尾，有 scene.map-manifest.v1 的 manifest.json，且 intent 明确携带 map_ref。不能用没有实际清单/发布证据的内部地图 JSON 宣称完成了这些检查。旧 compile/resolve 仍支持原有输入，没有改用法。

此入口不联网，不调用下载、建图、HTTP、数据库或引擎。输入/输出路径只接受本地路径，URL 和 UNC 被拒绝；none 连多余的 --map 参数也不检查或读取。它不验证真实部署的 URL、权限、缓存或运行接口。

JSON 是**暂定本地诊断格式**，不是团队响应协议：

- configuration_ok：仅代表配置期各检查通过，不代表运行就绪。
- conclusion：上述两种固定结论之一。
- items：id、title、status、reason；失败另有 issue，中文原因、管理员建议、操作及范围均来自 issue_messages.json。
- warnings：成功编译结果中的原始 warnings，未改写；warning_explanations 单独提供共享中文说明，不计为失败。
- position_notice：位置示意说明。
- result：只在配置期检查全部通过时附原 SceneResult；运行绑定仍待确认，没有新增 SceneResult 字段。

主要源码：

| 文件 | 用途 |
| --- | --- |
| adapter/scene_service/checker.py | 检查编排、三态和中文报告；复用原程序，不注册团队接口 |
| adapter/scene_service/__main__.py | check 参数、本地文件 I/O、JSON/文字保存及退出码 |
| adapter/scene_service/fixtures/check/ | 三份合成意图：合成地图、公开中科大 v2 正例、v1 无餐饮候选反例 |
| adapter/test_scene_check.py | 配置检查、失败、警告、none 和 CLI 测试 |
| frontend/tests/sceneMapVersions.test.js | 同一 mapsBase 多版本加载与拒绝错误引用的测试 |

程序调用可用 adapter.scene_service.checker.check_scene(intent, snapshot, plan, map_directory, assignment_seed=...)。它是本地检查，会读取准备好的地图目录；编译纯函数 compile_scene 的边界保持不变。

## 检查项与三态

| 项目 | 复用/核对内容 | 不执行时怎样处理 |
| --- | --- | --- |
| 入口对象与显式模式 | 原输入适配，意图/快照/计划对象，明确 map 或 none；完整结构仍由编译校验 | 输入失败后依赖项待确认 |
| 名称、经营者和偏好 | 原 indexed、brand_catalog、normalize_prefs；实际角色和唯一商品/品牌名、经营者引用 | none 明确不做空间选择，注明不适用；人物和计划来源仍验证 |
| 独立种子 | 原 adapt_intent，检查提供及两处对齐；值合法性由编译继续校验 | 冲突不覆盖、不猜 |
| 地图目录和 manifest | 版本目录存在，显式 map_ref、清单原始摘要、身份、版本和标题 | none 注明跳过，无读取；失败后地图依赖项待确认 |
| 发布素材 | 原 published_asset_library 核实登记字节，再核对地图登记 | 不把源码 catalog 当发布版 |
| 地图文件 | 正式资源清单齐全，再由原 load_map 检查全部所列文件摘要及加载引用 | 不吸附、不回退、不换最新版 |
| ready 与证据 | 原 enrich_map 重算质量和可达性；不能只相信归档 ready 字样 | 无候选用途仍由原 resolver 决定，不伪造证据 |
| 编译 | 原 compile_scene；失败复用共享中文说明 | 前置不通过则待确认，不返回半份结果 |
| 结果校验 | 原 validate_result，传同一快照、计划、配置来源及重算地图上下文 | 不写第二个 SceneResult validator |
| 结果摘要 | 原 digest 重新计算 result_sha256 | 不修补错误摘要来放行 |
| 重复编译 | 同输入再调 compile_scene，比较原 canonical 结果 | 不修改 seed、规则或修订来凑一致 |
| 运行绑定 | 等创建/提交时序、不可变正文绑定、失败恢复 | 始终待确认 |
| 实际计划关系 | 等冻结计划、内容变更、实际 plan_revision、bundle_sha256 来源 | 始终待确认；不自动改 revision 或判相容 |
| 存储与读取 | 等保存位置、保留策略、权限和读取契约 | 始终待确认 |

“通过”只证明该行描述的检查已完成；“不通过”会阻断总结论；“待确认”包括正式运行能力尚未确定，以及前置失败后未执行的检查。none 的空间检查是明确“不适用并跳过”，不是缺数据却声称验证了地图。警告独立列出，不变成错误或自动处理。

## 样例与实际输出

所有人物/品牌均为合成；仅地图使用已有公开几何。位置为示意。

| 样例 | 运行方式 | 结果 |
| --- | --- | --- |
| 中科大 v2 | 上述命令 | 退出 0；餐饮品牌位于审核过的食堂；三个运行相关项待确认 |
| 中科大 v1 | 将 intent 换成 intent-ustc-v1.json、--map 换成 data/maps/ustc-gaoxin/1 | 退出 1；SCENE_NO_CANDIDATE；后续结果检查待确认；不换 v2 |
| none | --intent adapter/scene_service/fixtures/prefs-none.json，其余人物/计划和种子同上，可不传 --map | 退出 0；不读取地图，无空间安置，运行相关项仍待确认 |
| 合成地图 | intent-synthetic.json + frontend/tests/fixtures/scene-render/input-a.json 中的快照/计划，种子按意图，地图目录为 frontend/tests/fixtures/scene-render/maps/synthetic-render-a/1 | 配置期通过；场外/排除等警告原样保留，不计失败 |
| 品牌改名、种子冲突、清单摘要错、catalog 错 | 测试创建的独立输入/临时地图副本 | 分别不通过；不修改源地图、不自动调整输入 |

成功 JSON 摘要（仅示意格式，不是新的团队契约）：

    {
      "configuration_ok": true,
      "conclusion": "配置期检查通过，运行绑定待确认",
      "position_notice": "所有位置与路线均为示意，不影响模拟。",
      "items": [
        {"id": "compile", "status": "通过"},
        {"id": "runtime_binding", "status": "待确认"},
        {"id": "actual_plan", "status": "待确认"},
        {"id": "storage", "status": "待确认"}
      ]
    }

实际报告含全部检查、原因、原样警告和成功结果。日志样例为 logs/m15-batch5-ustc-v2.json 及其 .txt；v1 对照为 logs/m15-batch5-ustc-v1.json 及其 .txt。JSON 摘要示例省略了字段，不可当作完整响应样例校验。

## C：仅补测试

同一 /scene-maps/ 下并发读取 v1/v2，交替读取并检查完整文件内容；修改一次返回对象不会污染另一版或后续加载。引用 v1、仅挂 v2 时，只请求 v1 manifest 后明确拒绝；引用 v1 却给 v2 的摘要时同样拒绝，不自动换版本或 legacy。前端生产代码未改。

## A：私有事实清单

私有新版本另存于 D:/Documents/ChatGPT/social-sim/独立场景Agent_与褚凌宇对接方案_2026-11-11_M15第五批.md，保留旧版。补充运行绑定待确认的时序、提交变化、冻结输入和摘要来源、修订关联、存储读取、初始化失败恢复及失败例子。此正文不进公开仓库。

没有写绑定代码、绑定记录格式、数据库字段或 revision 自动兼容。团队 scene_intent 字段、注册、读取包装都仍待褚凌宇代码确认；check 的本地字段不能当作已批准接口。

## 回归记录

| 命令 | 结果 |
| --- | --- |
| python -m unittest discover -s adapter -p "test_*.py" | 126 通过 |
| npm --prefix frontend test | 385 通过 |
| npm --prefix frontend run build:embed | 通过 |
| node scripts/audit-public.cjs / node scripts/prepare-scene-assets.mjs --dist | 审计 0 项，登记与发布 catalog 字节一致 |
| node scripts/test-scene-render.cjs | 通过 |
| node scripts/test-scene-render-embed.cjs | 默认关闭、显式开启、最终恢复关闭均通过 |
| node scripts/test-run-replay.cjs --embed | 通过 |
| node scripts/test-live-run.cjs | 通过 |
| node scripts/test-config-preview.cjs | 通过 |
| npm --prefix frontend run build:pages | 通过 |
| node scripts/test-gis.cjs --pages / node scripts/test-pages.cjs | 全部通过 |

新增单测已验证同输入重复编译、输入不改动、警告不算失败、错误说明与共享表一致，以及通过注入错误编译结果验证摘要/重复检查不会盲信编译成功。所有测试仅用本机服务、合成输入和既有几何。日志为 logs/m15-batch5-*.log；check 不进入 embed 默认构建，不改本地导入开关。

最终 dist-embed 已恢复默认关闭：242 文件，无 SceneResultEntry 分块；发布 catalog 仍是登记的 mecoffe-embed-v1。check 代码和样例没有加入 embed 产物。

## 限制与交接

这是配置期开发验收工具，不证明实际运行绑定完成，也不替代部署后的目录、权限、HTTP 或实时/终态端到端联调。check 的正式地图要求比旧 compile 的内部 JSON 入口更明确，是为了能验证真实发布字节；没有改变旧入口语义。

交给褚凌宇时仍只需在团队项目做薄适配：把真实阶段输出翻成已有本地意图、实际快照/计划和已准备地图，再用原 compile_scene。check 可作本地验收辅助。实际计划修订变化和绑定保存必须先取得可靠事实并确认契约，不能借此报告自动兼容。

Python 分发包应继续收齐 scene_service 的实际 py/json 模块，包含新增 checker.py；本批没有修改学弟负责的任何打包脚本或产物规则。
