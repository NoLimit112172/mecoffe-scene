# M15 第四批：中文报错说明与通用编译入口

基线为 main=1d587e6，工作分支 feat/m15-scene-entry。只做通用程序和本地入口，不接团队状态机、数据库、权限或服务器；未推送、合并或部署。

## 做了什么

- 一份 JSON 说明表供 Python 和前端共用，覆盖当前 25 个错误码和 5 个警告码。
- 本地场景页优先显示中文原因和可选处理，错误码用小字保留；管理员建议、重跑范围和原始诊断放在默认折叠的“管理员查看”里。不会因为报错自动重试、换图、放宽用途或改成 none。
- 新增纯函数 compile_scene 和 compile 命令行。直接调用原有 resolver；结果仍是原 SceneResult v1，校验规则未改。
- 原 evidence / resolve / validate 命令和既有团队默认展示保持原用法；正式本地导入开关仍默认关闭。

## 共用说明表和错误对象

位置：[issue_messages.json](../adapter/scene_service/issue_messages.json)。

每个码包含 severity（error/warning）、user_message（给用户看的中文原因）、admin_message（管理员建议）、actions（可选处理文字数组）、rerun_scope（重跑范围说明）。actions 是说明，不是自动执行的操作或团队工具名；rerun_scope 是文字，明确区分只跑 scene、先修上游、先恢复资源后重读等情况，不能把每个读取错误都变成重新安置。

Python 的 issues.describe_issue 与前端 sceneIssues.describeSceneIssue 读取同一份表，返回独立副本并附 code、details。编译失败返回：

    {
      "ok": false,
      "error": {
        "code": "SCENE_NO_CANDIDATE",
        "severity": "error",
        "user_message": "没有符合用途且安全可达的楼；已允许任意楼兜底时也可能无安全候选",
        "admin_message": "没有符合条件的楼。你可以改用途、换图，或明确允许场外；我不会替你放宽。",
        "actions": ["改偏好", "经确认选允许的兜底", "换图", "选不用地图"],
        "rerun_scope": "偏好或 none 可只重跑；地图缺证据/不可达需先修图",
        "details": "原始诊断文字"
      }
    }

实际 actions 文字以 JSON 表为准，上例只说明结构。没有 code 的普通异常使用 INVALID_INPUT；若本地回放/实时模块抛出本表范围外的码，页面保留原码，暂用 INVALID_INPUT 的通用中文说明，原始原因仍在管理员详情内。没有新增或承诺一套其他引擎错误码说明。

覆盖测试会自动扫描 adapter/scene_service/*.py，以及前端 sceneMap.js、sceneResult.js、scenePlacement.js 中的码；要求与说明表的键完全相等，缺一项或多一项都会失败。Python 用 AST 扫描，前端测试也独立扫描这些源码；测试还检查中文说明、操作和范围非空。

## compile_scene 的暂定本地用法

    from adapter.scene_service import compile_scene

    response = compile_scene(
        intent, snapshot, plan, map_package,
        assignment_seed=42,
    )

参数为调用者已经准备好的内存对象。函数调用期间不读取文件、网络或数据库，不写入存储、不注册团队接口、不修改输入；模块初始化时会像既有 contract 一样读取随代码分发的说明 JSON。

- intent 的字段名是**暂定本地格式**，不是褚凌宇接口。它沿用现有 prefs：mode、config_id、role_prefs、brand_prefs、overrides、assumptions、可选 map_ref/source_refs、结果/规则版本；none 需要 reason。精确角色和品牌名的语义不变。
- 实际 snapshot、plan、map 单独传入，不能塞进 intent 充当需求。实际快照/最终计划及修订必须齐全；上游品牌一一对应和用途词仍由原程序校验。
- assignment_seed 是单独参数，缺失会返回 INVALID_INPUT；若兼容旧 prefs 中已有 assignment_seed，必须与参数类型和值完全一致，冲突不覆盖、不猜。
- mode=none 时不接触 map_package，直接走原有合法 none 生成流程。map 模式仍要求地图 ready，且只按明确兜底安置；失败不会自动返回 none。
- 成功返回 {"ok": true, "result": SceneResult}。结果与同输入直接调用原 resolve 一致，仍能通过 validate_result；失败不附半份 result。
- 成功结果中的 warnings 保留原码和结构，不把中文说明塞进 SceneResult 改变契约；调用者可按共享表解释警告。

新适配点仅在 request.adapt_intent。以后接团队 scene_intent 时，薄适配负责将实际名称选择器和上下文翻成这里的暂定格式；不要在薄适配里另写放人、猜品牌或跳过来源校验。

## 命令行

在仓库根目录执行，以下全部使用既有合成样例：

    python -m adapter.scene_service compile --intent adapter/scene_service/fixtures/prefs.json --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json --map adapter/scene_service/fixtures/map.json --assignment-seed 42 --out logs/m15-batch4-map-compile.json

none：

    python -m adapter.scene_service compile --intent adapter/scene_service/fixtures/prefs-none.json --snapshot adapter/scene_service/fixtures/snapshot.json --plan adapter/scene_service/fixtures/plan.json --assignment-seed 42

stdout 输出完整的成功/失败 JSON；成功退出 0，失败退出 2；--out 可选，保存同一响应。compile 的缺参、坏参数、文件读取错误也输出解释后的失败 JSON。--help 保留普通命令帮助。原有三个命令的输出格式不变。

--assignment-seed 会先按 JSON 值解析；42 为整数，无法解析成 JSON 的文字作为字符串，其他不合法种子由原规则拒绝。需要数字外观的字符串时须传入保留引号的 JSON 字符串。none 即使显式传入不存在的 --map，也不读取该路径。CLI 负责本地文件 I/O，纯函数不负责。

## 验证与记录

| 检查 | 结果 |
| --- | --- |
| Python unittest 全量 | 118 通过；新测试含纯函数、无输入修改、none 不触图、五种失败及 JSON CLI |
| 前端 node:test 全量 | 381 通过；含说明表双向覆盖、中文字段和副本隔离 |
| build:embed / build:pages | 通过 |
| audit-public / prepare-scene-assets --dist | 审计 0 项；发布 catalog 与登记字节一致 |
| test-scene-render | 通过，新增中文原因、操作、小字错误码、折叠诊断、坏 JSON 说明验证 |
| test-scene-render-embed | 通过，默认关闭／开启／最后恢复关闭；最终 242 文件、无 SceneResultEntry 分块 |
| test-run-replay --embed / test-live-run / test-config-preview | 全部通过 |
| test-gis --pages / test-pages | 全部通过 |

完整复测命令（仓库根目录）：

    python -m unittest discover -s adapter -p "test_*.py"
    npm --prefix frontend test
    npm --prefix frontend run build:embed
    node scripts/audit-public.cjs
    node scripts/prepare-scene-assets.mjs --dist
    node scripts/test-scene-render.cjs
    node scripts/test-scene-render-embed.cjs
    node scripts/test-run-replay.cjs --embed
    node scripts/test-live-run.cjs
    node scripts/test-config-preview.cjs
    npm --prefix frontend run build:pages
    node scripts/test-gis.cjs --pages
    node scripts/test-pages.cjs

本轮命令日志为 logs/m15-batch4-*.log。浏览器截图和报告沿用 scripts 现有的 logs/milestone15-render/、logs/milestone15-batch3/ 目录；中文错误截图为 logs/milestone15-render/chinese-scene-error.png，源码 catalog 被拒截图包含中文原因与展开的管理员原始诊断。

最终必须保留默认关闭本地导入的 dist-embed，并再次通过发布 catalog 核对。测试只使用合成输入、已有公开几何和本机测试服务，不访问团队服务器或展示环境。

本轮最终状态已核对：默认关闭，242 文件，无 SceneResultEntry 分块；发布素材仍为 mecoffe-embed-v1，catalog 摘要 a4444d42d820359ff180d4390c1b16a5a86249cfd008a0d2e5eafa1dfc55aa0c。

## 给团队接入时还要做什么

只需在团队项目写一层薄适配：取得真实配置身份、人物快照/修订、最终计划/修订和已准备地图，映射 scene_intent 名称偏好，再调用 compile_scene；根据 ok 保存不可变正文或向管理员显示结构化错误。注册函数、阶段保存、权限、依赖失效、运行绑定和读取路径仍待褚凌宇代码确认。

这次没有实现状态机注册、地图准备队列、运行绑定或其他引擎适配；没有改 SceneResult/校验规则、建图/拆包逻辑、build-tools.mjs 或 embed-plugin.mjs。错误说明只是建议，不会替管理员或用户确认任何兜底。
