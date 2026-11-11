# M15 第六批：自动楼栋用途证据与 SceneResult v2

基线 main=f2db4bd，本地分支 feat/m15-auto-evidence。实现与验收日期：2026-11-11。

## 结论

新地图可以凭标签、楼内 POI 和明确的名称规则确定用途；AI 文件和人工补注都是可选输入。没有 AI、没有人工确认，也能在质量门槛满足时生成 ready 地图。没有把“用途都查清”变成发布前置条件；unknown 楼仍不能参加严格用途匹配。

本批不调用真实模型，不读密钥，不联网，不接团队状态机或运行绑定。全部位置仍为示意，不影响 OASIS 模拟。中科大已发布的 ustc-gaoxin/1、/2、原 v1 契约和旧夹具保持原字节。

新编译统一生成 scene.result.v2；Python 和前端同时读取旧 v1 和新 v2。正式 embed 默认关闭本地导入，测试显式开启后再恢复默认构建。

## 一、用途怎样自动判断

用途词表仍是 dining、retail、dormitory、residential、education、office、library、unknown。旧 kind、模型素材匹配、入口与路网安全判定均保留。

| 顺序 | 来源 | 如何使用 |
| --- | --- | --- |
| 1 | annotation 人工或对话确认 | 保留原 add / replace 语义及来源、reviewer、note；replace 可覆盖，add 保留原有具体标签用途并补充用途 |
| 2 | building_tag / poi 具体标签、唯一楼内 POI | 沿用原具体值映射；住宅与宿舍分开；不做最近楼吸附 |
| 3 | name_rule 名称规则 | 高确定性写法可成为强证据；有排除词或不同用途规则冲突时不给名称强证据 |
| 4 | ai_inferred AI 文件 | 原始把握达到本地图冻结阈值，且不覆盖上面来源时才生效 |
| 背景 | name_keyword 名称关键词 | 继续作为弱证据记录，不能单独参加严格匹配 |

同一具体标签层出现多个用途时保留多用途并警告。低优先级与高优先级相同的用途可以保留为支持证据；不同用途记录到 inactive_function_evidence 并给出 EVIDENCE_CONFLICT，不会反向覆盖。

building=university/college/school 的 education 是泛用途兜底。如果名称规则、有效 AI 或具体确认给出餐饮等其他用途，泛 education 转入 superseded_function_evidence，发出 GENERIC_USE_SUPERSEDED，该楼不再凭这条泛标签参加教学匹配。校园 amenity=university 仍不下放给每栋楼。

### 名称规则表

文件：adapter/scene_service/evidence_rules.json。版本 auto-evidence.1；内容摘要为去掉 sha256 后，按现有规范化 JSON 计算：

`aec557eaecfaf24158e4a21eafa9a6b5abd6a6f6489b65df0f2e356c58ca9e7d`

| 用途 | 本版明确写法（实际以 JSON 中正则为准） |
| --- | --- |
| dining | 以食堂、餐厅、咖啡馆、咖啡厅结尾；允许 A区、数字区等后缀 |
| dormitory | 学生公寓、宿舍、宿舍楼结尾；允许规则列出的楼号、栋、区后缀 |
| education / library / office | 教学楼 / 图书馆 / 办公楼结尾 |
| retail / residential | 超市、便利店 / 住宅楼、居民楼结尾 |

排除项包括旧址、遗址、拆除、筹建、拟建、废弃、原址、以“原”开头，道路/路口/车站/公交/地铁，以及以路、站、门、广场、停车场结尾。宁可保留 unknown，也不靠模糊词猜用途。规则未覆盖的写法可进入后续 AI 判断，不能默认为已确认用途。

规则 JSON 自带内容摘要，地图 manifest.files 另登记该文件的实际字节摘要；两者用途不同，都需要核对。修改规则必须更新规则版本及其内容摘要，并生成新的地图版本，不能覆盖已有版本。

## 二、AI 文件接口

先用已准备好的本地地图导出待判断清单：

```powershell
python -m adapter.scene_service prepare-ai-review --map frontend/public/mecoffe/scenarios/ustc-history --out logs/ai-request.json
```

可用 --rules 指定另一份已登记规则。清单为 scene.ai-review.v1，含精确 map_ref、rules_version、rules_sha256，只列没有具体强证据、仅有校园泛用途、或证据冲突的楼。每栋含 ID、名称、相关物理标签、唯一楼内 POI、50 米内附近 POI、面积、层数、地图内投影坐标描述。附近 POI 只是判断背景，不能冒充楼内 POI。清单不读取人物、团队配置或运行数据。

管理员智能体或模型在外部读清单，再写下面的本地 JSON；本程序不会代为调用模型：

```json
{
  "schema_version": "scene.ai-evidence.v1",
  "map_ref": {
    "map_id": "从待判断清单原样复制",
    "map_version": "1",
    "manifest_sha256": "从待判断清单原样复制完整摘要"
  },
  "buildings": {
    "源地图中的楼栋ID": {
      "functions": ["office"],
      "confidence": 0.84,
      "rationale": "简短中文判断依据。",
      "model": "实际模型名称",
      "prompt_version": "提示版本",
      "generated_at": "2026-11-11T00:00:00Z"
    }
  }
}
```

这段仅说明结构，示意 ID 和摘要必须替换。顶层还允许 synthetic，离线测试用 true。楼栋条目字段必须齐全，不能夹带人物或团队字段；functions 必须在词表内，不能重名或将 unknown 与其他用途混用；confidence 必须是 0–1 有限数字；rationale 为最多 500 字的非空中文说明；时间必须带时区。楼不存在、引用不符、未知用途、缺字段都会明确失败。

AI 文件绑定的是**导出清单时的输入地图 map_ref**，不是尚未生成的新版本 manifest。新版本 manifest 的 evidence_policy.input_map_ref 保存这份输入引用，避免输出摘要反过来包含自己的循环问题。AI 文件中的 map_ref 不由程序修补。

auto-evidence.1 阈值是原始 confidence ≥ 0.8，即 80%。发布时先用原始值判断是否生效，再用四舍五入生成整数 confidence_pct。例如 0.799 即使显示舍入为 80，也不会成为有效 AI 证据。低把握记录保留在原始文件及 inactive_function_evidence，并给 AI_LOW_CONFIDENCE；没有其他强证据时仍是 unknown，不阻塞其他合格楼的地图发布。

原始 confidence、model、prompt_version、generated_at、rationale 随 ai-evidence.json 原字节冻结；结果证据只保留必要来源、中文依据和整数百分比。加载已发布地图后，编译使用冻结的有效证据，不按新默认规则或显示百分比重新筛选 AI。结果校验仍核对证据确实存在于同一地图。

## 三、离线发布流程及可复现性

流程：现有几何包 → 原标签/楼内 POI → 名称规则 → 可选 AI 文件 → 可选人工补注 → 原质量检查 → 新版本目录。

```powershell
python -m adapter.scene_service publish --source frontend/public/mecoffe/scenarios/ustc-history --out logs/new-maps/ustc-auto-demo/1 --map-id ustc-auto-demo --map-version 1 --title "中科大自动用途演示"
```

需要时追加 --ai-evidence logs/ai-output.json、--annotations 本地补注文件、--rules 本地规则文件。人工补注格式及 reviewer 要求不变，但不传补注文件完全合法。用户在对话中确认时，reviewer 可写“对话中用户确认”，来源必须如实记录。

新增发布命令默认启用自动规则。publish_map 的旧 Python 调用默认 legacy，以保留历史复现；新调用显式 evidence_mode='auto'。generate-ustc-map.py 对版本 1、2 默认沿用历史规则，对其他版本默认启用自动规则，也可显式 --auto-evidence。历史复现不能附加 AI 或自动规则。

新地图在原文件上增加 evidence-rules.json；有 AI 文件时增加 ai-evidence.json。manifest 仍为 scene.map-manifest.v1，增加 evidence_policy，内容为 version、sha256、ai_min_confidence_pct、input_map_ref，以及有 AI 时的 ai_evidence_sha256；quality.json 记录同一发布策略。所有新文件都进入 manifest.files 的原字节 SHA-256 校验。旧地图不增加这些字段。

ready 沿用可校准质量参数：默认 min_main_ratio=0.9、min_function_ratio=0，仍检查有效几何和可安置楼；这不是对现实用途准确率的承诺。冲突、unknown 和待 AI 清单不是自动发布关卡；每次具体安置仍要满足其偏好的用途与可达入口，失败不自动放宽。

同版本只能重复写入相同字节，改变规则、AI、补注或其他文件必须升地图版本。对已冻结地图直接传入不同规则、AI 或补注会报 MAP_VERSION_IMMUTABLE，不会默默忽略修改；应通过 publish 生成新版本。规则和 AI 文件原字节保存；原始空白或时间变化也会改变地图摘要。不能在同版本目录重新问 AI 并覆盖。

### 原有正式地图

以下旧命令均已在临时目录复现，与正式目录各 14 个文件逐字节一致（共 28 个文件）：

```powershell
python scripts/generate-ustc-map.py --version 1 --no-template --out logs/reproduce-ustc/1
python scripts/generate-ustc-map.py --version 2 --no-template --annotations data/maps/ustc-gaoxin/review-annotations.v2.json --out logs/reproduce-ustc/2
```

正式 data/maps/ustc-gaoxin/1、/2 没有改动；旧 v1 契约与 adapter/scene_service/fixtures 也做了与基线的字节比较。本批没有发布中科大新版本。

新增 .gitattributes 将规则文件及 frontend/tests/fixtures/scene-auto/** 标为 -text，避免 Windows 检出时替换换行，导致 manifest 中的冻结文件摘要失效。交付前另外从 Git 暂存区检出这些文件到临时目录，18 个文件与工作区、暂存区原字节全部一致，检出后的地图也能通过加载校验。规则原字节摘要为 6c657dc8d43a1c118a70be22ed53891ea1f4fc8e422fe2539c0d4ee6f6e95d94；这与前述规范化内容摘要不同是正常的。详细记录在 logs/m15-batch6-git-bytes.json。

## 四、SceneResult v1 / v2 的最小差异

| 内容 | 原 v1 | 新 v2 |
| --- | --- | --- |
| schema_version | scene.result.v1 | scene.result.v2 |
| 契约文件 | contract.json，原字节不变 | contract-v2.json，基于 v1 作必要增量 |
| 强来源 | building_tag、poi、annotation | 原三项 + name_rule、ai_inferred |
| name_keyword | 弱证据 | 仍是弱证据 |
| AI 把握字段 | 不接受 | AI 证据必须有 confidence_pct 整数 0–100，其他来源不能带该字段 |
| 其他字段与含义 | 原规则 | 相同；resolver 元信息版本记为 2 |
| 哈希规则 | 原规范化 JSON、整数限制 | 完全沿用，未修改 common.py / 前端摘要函数 |
| 新 compile / resolve / check 产出 | 不再新生成 | 统一 v2；none 也统一 v2 |
| 新 Python / 前端读取 | 支持 | 支持 |

AI 原始小数只在地图上下文/冻结文件内，不进入 SceneResult。v2 校验检查百分比类型、证据来源、引用及摘要，不重复执行发布阈值判断。旧 v1 结果、旧 v1 夹具及旧渲染路径仍通过原回归。

旧的仅 v1 校验器会拒绝 v2，不能依靠静默降级；旧地图加载器也可能拒绝新增文件，因此新地图和 v2 结果应配套新显示程序及新服务包。团队 33908e2 及更早版本没有本批 SceneResult 接入能力。按本轮提供的团队进度，团队尚未接入 SceneResult，没有存量团队结果受这次升版影响；此处是团队提供的状态，本批未访问服务器核实。

## 五、安置说明与 check 报告

resolver 仍用原确定性安置算法，不因引入 AI 改为随机选择。新理由说明“依据名称规则”或“依据 AI 推断（把握 80%）”；覆盖与兜底保留原本依据，并在有新证据时补充来源。前端显示“名称规则 / AI 推断（把握 xx%）”，不把 AI 写成人工补注；三维与 GIS 共用证据标签。

check 增加 evidence_usage 和一行中文统计，按本次已安置人物/服务点使用的**证据条数**统计 by_source、total、ai_count、ai_share_pct，另列带 AI 的安置项数 placements_with_ai 及总安置项数 placed_count。一个安置项可能有多条证据，不能把证据占比误读为人数占比。场外项目不贡献有效证据。warnings 原样保留，运行绑定继续“待确认”。

合成 v2 正例：building_tag 5 条、name_rule 1 条、ai_inferred 1 条，共 7 条，AI 占比显示 14%，带 AI 的安置项 1 个。中科大演示的现有学生/餐饮偏好没有用到 office 楼，故该 check 的 AI 占比是 0%，如实保留。

共享 issue_messages.json 新增 2 个错误、5 个警告：INVALID_EVIDENCE_RULES、INVALID_AI_EVIDENCE、NAME_RULE_EXCLUDED、NAME_RULE_CONFLICT、AI_LOW_CONFIDENCE、EVIDENCE_CONFLICT、GENERIC_USE_SUPERSEDED。现共 37 个码（27 个错误、10 个警告），都有中文原因、管理员说法、可选操作、重跑范围；原自动扫描精确核对代码与说明表，没有用白名单跳过。

## 六、中科大未发布演示

```powershell
python scripts/demo-auto-evidence.py --out logs/milestone15-batch6-demo-final
```

演示脚本拒绝输出到 data/maps。它用仓库公开归档，不下载数据，不用人工补注；AI 输出是手写离线样例，不能当现实用途认证。summary.json 保存完整统计，maps/ 下只是本地演示包。

| 项目 | 仅名称规则，无 AI / 无人工 | 加离线 AI 文件，无人工 |
| --- | --- | --- |
| 质量状态 | ready | ready |
| 建筑 / 可安置建筑 | 31 / 29 | 31 / 29 |
| dining / dormitory / education | 3 / 8 / 18 | 3 / 8 / 18 |
| office / unknown | 0 / 2 | 1 / 1 |
| 无入口楼 / 主路网入口比例 | 0 / 100% | 0 / 100% |

三栋食堂 way/1435377504、way/1435377505、way/1435377506 自动得到 dining，不再凭泛 university 标签参加教学匹配。待判断清单有 23 栋，包含仅有泛教育用途及冲突项，数量不是发布阻塞条件。

手写 AI 将未命名楼 way/1501639766 判为 office，把握 0.8 生效（结果为 80%）；将体育馆 way/1435368250 判为 dormitory，把握 0.4 不生效，该楼仍为 unknown。这两条仅展示阈值和冻结机制，不声明现实楼栋用途。

## 七、测试与证据

| 命令 | 结果 |
| --- | --- |
| python -m unittest discover -s adapter -p "test_*.py" | 135 项通过 |
| npm --prefix frontend test | 388 项通过 |
| python -m unittest discover -s scripts -p "test_*.py" | 17 项打包测试通过 |
| npm --prefix frontend run build:embed | 通过 |
| node scripts/prepare-scene-assets.mjs --dist | 通过，发布 catalog 仍为 a4444d42… |
| node scripts/audit-public.cjs | 0 项 |
| node scripts/test-scene-render.cjs | 通过，旧 v1 DEV 兼容与严格校验 |
| node scripts/test-scene-render-embed.cjs | 通过：默认关闭、显式开启、最终恢复默认关闭；开启时覆盖 v1、v2 与新来源 |
| node scripts/test-run-replay.cjs --embed | 通过 |
| node scripts/test-live-run.cjs | 通过 |
| node scripts/test-config-preview.cjs | 通过 |
| npm --prefix frontend run build:pages | 通过 |
| node scripts/test-gis.cjs --pages | 通过 |
| node scripts/test-pages.cjs | 通过 |

新增用例覆盖名称命中/排除/冲突、无效规则摘要、AI 合法及非法输入、原始 0.799 不被整数舍入提升、各层优先级、泛教育让位、弱关键词不能独立安置、v1 保留/v2 统一产出、v2 整数把握、冻结后不再调用 AI 判定、check 证据占比，以及旧两版地图原命令复现。打包测试继续从解压包验证导入与 v1/v2 复现。

v2 严格静态托管浏览器用例比较三维/GIS 的全部人物、门店楼栋/入口/场外状态与原 SceneResult 一致；共 7 人、场外 2 人、服务点 3 个，名称规则和 AI 84% 都可见。外部请求被场景测试拦截并断言为空。

截图：logs/milestone15-batch6/auto-v2-three.png、auto-v2-gis.png。构建开关测试报告沿用 logs/milestone15-batch3/embed-matrix-qa.json；最终 defaultRestored=true，dist-embed 共 242 个文件。其他本批命令日志为 logs/m15-batch6-*.log。截图、演示输出和日志都在忽略的 logs/ 中，不进入公开提交。

## 八、主要文件与接入限制

| 文件或目录 | 内容 |
| --- | --- |
| adapter/scene_service/auto_evidence.py、evidence_rules.json | 自动规则、优先级、AI 文件检查与待判断清单 |
| evidence.py、map_package.py、maps.py | 原证据管线扩展、新版本冻结发布、加载冻结决策 |
| contract-v2.json、resolver.py、validation.py | v2 统一产出、v1/v2 校验及理由 |
| __main__.py、checker.py、issue_messages.json | 命令行、证据占比、共享中文说明 |
| frontend/src/mecoffe/sceneResult.js、sceneMap.js、sceneLabels.js | 双版本读取、新文件允许列表、新来源标签 |
| ScenePlacementDetails.vue、MeCoffe3D.vue | 详情传入百分比，三维/GIS 共享显示 |
| adapter/test_auto_evidence.py、frontend/tests/sceneAutoEvidence.test.js | 自动规则和双版本单元测试 |
| frontend/tests/fixtures/scene-auto/、scripts/lib/m15-auto-fixtures.py | 独立新 v2 合成夹具及生成器；旧夹具不改 |
| scripts/demo-auto-evidence.py、generate-ustc-map.py、test-scene-render-embed.cjs | 未发布演示、历史复现兼容、新 v2 浏览器回归 |

后续管理员智能体只需在仓库外接“导出清单 → 调模型/询问用户 → 保存 AI 文件或 annotation → 调 publish → 调 compile/check”的薄适配，并记录准确引用；人物和团队数据不要塞进 AI 地图文件。模型选择、提示词实际内容、费用、重试和授权由接入方负责，本批均未实现。对话确认应落 annotation，纯模型判断落 ai_inferred，不能混淆。

建图仍需先有几何包，不提供地名定位、联网下载或后台队列。本版中文名称规则有意保守，不覆盖全部语言、别名和业态；阈值 80% 是可校准策略，模型自报把握不是校准准确率。修订策略、原始 AI 文件或确认内容后必须升地图版本。

新规则文件和 v2 契约由既有动态 scene_service 打包规则收集，没有修改 build-tools.mjs、embed-plugin.mjs 或学弟的打包程序。旧配置、旧回放及 M14 路径保持兼容；实际团队接入、运行绑定、存储和权限仍待真实契约确认。
