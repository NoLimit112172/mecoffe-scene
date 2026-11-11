# M15 第七批：可安装的独立场景运行包

基线 main=c0bf430，本地分支 feat/m15-scene-package。包名 mecoffe-scene-service，导入名 mecoffe_scene_service，包版本 0.1.0，Python 范围 >=3.11,<3.12。

## 结论先行

采用方案 B：保留现有源码，由脚本生成 packages/scene-service/。团队可以把这个完整目录按固定版本接入后端；它不依赖仓库顶层 adapter，也不需要安装第三方运行库。构建工具单独使用 setuptools>=68。

本批没有改原 scene_service、scene_builder 或前端业务代码，没有改旧命令、地图、契约或夹具。没有团队薄适配、管理员工具、运行绑定、部署、联网下载或模型调用；只完成独立包交付及验证。

Python 3.11 隔离环境中从本地目录安装成功，实际模块来自虚拟环境 site-packages。新包与 c0bf430 基线在相同解释器、相同输入下比较完整编译响应字节；正常、none、内部输入和失败响应都一致。这里比较的是完整 JSON 响应，不只是 result_sha256。

## 一、目录与单一源码

| 路径 | 职责 |
| --- | --- |
| adapter/scene_service/ | 原有算法、编译、校验和旧 CLI 的权威源码；本批未改 |
| adapter/scene_builder/asset_library.py 及其登记资源 | 素材登记的权威源码与原字节 catalog；本批未改 |
| scripts/export_scene_service.py | 导出规则、包版本、稳定接口包装、安装配置与清单生成；权威导出配方 |
| packages/scene-service/ | 自动生成的完整交付目录，24 个文件；不在这里手工维护源码 |
| scripts/test_export_scene_service.py | 源码与生成目录一致性、改动/新增/缺失、运行范围及离线核验测试 |
| scripts/verify_scene_service_install.py | Python 3.11 离线安装、真实路径、冻结证据、旧结果和基线字节验证 |

导出与检查（仓库根目录）：

```powershell
python scripts/export_scene_service.py
python scripts/export_scene_service.py --check
python packages/scene-service/verify_export.py
```

可用 --out 指定其他交付目录。--check 只检查、不写文件；不一致退出 1。正常导出也不会替用户删除额外文件：发现额外文件会拒绝，要求先检查。

交付目录包含 pyproject.toml、VERSION、README.md、NOTICE.md、verify_export.py、EXPORT_MANIFEST.json，以及 src/mecoffe_scene_service/。版本值统一由导出配方生成，避免手工维护多份版本号。

补测后的交付清单 SHA-256：58e4a1d47f3afc57ca7dc737c26488f3f2178abcb2683ab152dbb139bc50b159。接收方应与已审版本的清单核对，再运行目录核验；清单变化原因见第八节，运行包版本和其他文件字节不变。

EXPORT_MANIFEST.json 记录包身份、运行源码提交、每份输入的摘要及字节规则、导出器版本/摘要、全部交付文件摘要。清单自身不包含在自己的摘要表内，不产生自引用；目录核验要求清单之外没有多余或缺失文件。不记录时间戳或机器绝对路径。

本版运行源码提交是 c0bf4302b9005f6dc0e08f8d3baabe339fba7e9e。该值取最后修改所选权威输入的提交，不把仅新增导出物的提交当运行算法的新版本，因此提交导出物后 --check 不会无故失效。工作区未提交的源码变化仍通过输入摘要检测。

源代码、契约和说明文本导出时统一 LF；登记素材描述与 catalog 保留原始字节。原文件不被重写。新增 .gitattributes 将 packages/scene-service/** 标为 -text，确保 Windows 检出生成目录时不替换换行。

## 二、包内有什么、没有什么

包内包含编译、请求适配、确定性 resolver、几何与可达性检查、v1/v2 契约和校验、错误中文说明、已准备地图读取、配置期检查，以及素材登记描述/catalog。没有模型文件，也没有实际地图库。

| 导出处理 | 范围 |
| --- | --- |
| 保持函数内容，统一文本换行 | common、compiler、request、resolver、validation、evidence、geometry、issues |
| 两处导入改为包内相对导入 | maps、checker 中的 adapter.scene_builder.asset_library → ._asset_library |
| 素材登记迁入生成包内部 | _asset_library.py 来自原模块，沿用同一校验函数；其相对资源目录现在位于安装包内部 |
| 去掉准备入口，保留现有纯函数 | auto_evidence 去掉 prepare_ai_review、default_rules、RULES_PATH；保留冻结策略/AI 文件校验、来源常量及原编译必需的纯计算 |
| 新增稳定导出门面 | 生成 __init__.py，只声明下表中的公共 API 与版本常量 |

保留纯函数是为了不偷偷改变现有 compile 对内部地图输入的行为。正式已发布地图依旧使用冻结决策，不重新问 AI、不按整数显示百分比重判阈值。包中没有导出规则发布命令；有名称规则相关纯函数不等于提供新地图发布流程。

明确不包含：原 __main__.py、map_package.py、prepare-ai-review、建图、OSM 转换、下载器、地图发布、生成脚本、夹具、测试、地图几何文件或模型素材。新包不提供场景功能 CLI；根目录 verify_export.py 只用于交付完整性核验。原 python -m adapter.scene_service 的所有命令仍留在原处。

素材资源仍登记为 mecoffe-embed-v1，catalog 原始摘要为：

`a4444d42d820359ff180d4390c1b16a5a86249cfd008a0d2e5eafa1dfc55aa0c`

## 三、稳定接口与副作用

```python
from mecoffe_scene_service import (
    compile_scene, validate_result, check_scene, load_map, describe_issue,
    SceneError, __version__, SCENE_RESULT_SCHEMA_VERSIONS,
    SCENE_RESULT_OUTPUT_SCHEMA_VERSION,
)
```

| 接口 | 行为与返回 | 异常和副作用 |
| --- | --- | --- |
| compile_scene(intent, snapshot, plan, map_package=None, *, assignment_seed=None) | 返回 {ok:true,result} 或 {ok:false,error}；新结果统一为 v2，none 也一样 | 保留原已知输入错误包装；纯计算，不写文件、不访问网络/数据库，不加载地图路径 |
| validate_result(result, context=None) | 验证正文、摘要及传入上下文，成功返回原 result | 不修改正文；校验失败抛 SceneError；不读取地图文件，不重新判定 AI 阈值 |
| load_map(path) | 从本地准备目录或原内部地图 JSON 读取并返回地图包，核对登记资源及冻结证据 | 只读文件；规则错误通常为 SceneError，文件/JSON 错误可能为 OSError、ValueError 等，沿用原边界 |
| check_scene(intent, snapshot, plan, map_directory=None, *, assignment_seed=None) | 返回 JSON 可序列化报告；配置期通过仍写“运行绑定待确认” | 只读本地地图；none 不读取多余地图路径，不写报告文件，不联网；不能承诺所有异常都包装成 SceneError |
| describe_issue(code, details='') | 返回独立中文说明；未知码保留原码，并使用 INVALID_INPUT 说明 | 不改规则、不写文件、不联网 |
| SceneError | 原 ValueError 子类；code 为原始错误码，str(error) 是诊断 | 供未来薄适配转换成团队 StageError，不替团队猜转换接口 |

导入包时会读取包内契约和说明 JSON；这与 compile 调用本身的纯计算边界分开。程序内部接口、可修改的契约字典、resolver 辅助函数及素材登记函数都不作为稳定公共 API。

版本常量：__version__='0.1.0'；SCENE_RESULT_SCHEMA_VERSIONS=('scene.result.v1','scene.result.v2')；SCENE_RESULT_OUTPUT_SCHEMA_VERSION='scene.result.v2'。包版本、结果契约版本、地图版本是三件不同的事。

## 四、Python 3.11 离线安装验证

使用本机已有 CPython 3.11.15 创建全新 venv，不修改原有 Conda 环境，不开启 system-site-packages。该解释器的 ensurepip 自带 pip 24.0、setuptools 79.0.1 的离线 wheel，新环境据此自举；构建依赖满足 setuptools>=68。包的运行 dependencies=[]，安装后的发行元数据也没有 Requires-Dist。

可复现验证命令，--out 必须换成尚未产生成功结果的目录：

```powershell
python scripts/verify_scene_service_install.py --python D:\App\anaconda\envs\hello-agents\python.exe --out logs/milestone15-batch7-install-independent
```

其他机器可换成自己的 Python 3.11 路径。若解释器不自带合格构建工具，需先提供本地 wheelhouse 离线安装构建工具；不能用联网自动补齐或全局包混入来冒充干净验收。构建工具不属于运行依赖。

验证脚本实际完成：

1. 用 -I 检查解释器确为 3.11，新建隔离 venv；清除子进程 PYTHONPATH/PYTHONHOME，设置 PIP_NO_INDEX，禁用 pip 版本检查。
2. 将核验过的交付目录复制到临时目录，再从该本地目录执行下面命令；不在源导出目录生成 build 或 egg-info。

```text
<venv-python> -I -m pip install --no-index --no-deps --no-build-isolation --no-cache-dir <local-package-copy>
```

3. 从仓库之外的临时工作目录，用 -I 导入安装包；断言真实路径在 venv 的 site-packages，sys.path 不含当前仓库，sys.modules 不存在 adapter 或其子模块。
4. 从包外读取正式中科大 v2，以及第六批含 name_rule、ai_inferred 的合成地图，分别编译并跑 check；后者确认有名称规则及非零 AI 证据占比。none 传不存在地图路径仍通过。
5. 校验原有 v1 结果及原有 v2 结果；触发 UNKNOWN_FUNCTION、BRAND_NAME_MISMATCH，确认中文原因/管理员说明存在；破坏摘要后确认抛公开的 SceneError，code=HASH_MISMATCH。
6. 检查安装后源码没有 adapter.* 导入、没有 CLI/map_package/prepare-ai-review，发行元数据没有运行依赖。
7. 从 Git c0bf430 导出独立临时基线源码，以同一 3.11 venv 解释器在另一个进程运行原代码。这个基线进程明确导入临时基线；安装包进程不加入任何仓库源码路径。

首轮结果：logs/milestone15-batch7-install-delivery/report.json；本次补测结果：logs/milestone15-batch7-rules2-install/report.json。安装成功并确认模块来自临时 venv/Lib/site-packages/mecoffe_scene_service/__init__.py；完整实际路径与 sys.path 保存在 installed/metadata.json 和 installed.log。临时环境在验证结束后清理，日志中的路径是当时的验证证据，不是长期保留环境。

### 与基线逐字节比较

七组输入全部通过：

| 输入 | 期望 |
| --- | --- |
| 中科大正式 v2 | 编译成功，读取外部地图；check 通过且运行绑定待确认 |
| 第六批冻结自动证据地图 | 名称规则、AI 证据保留，check 可见非零 AI 占比 |
| 同一自动证据内部输入，未冻结标记 | 兼容原纯计算行为，无新增发布入口 |
| none | 编译合法，不读不存在的地图路径 |
| 原旧内部地图输入 | 原入口支持的输入语义不变 |
| 未知用途词 | UNKNOWN_FUNCTION，完整中文错误响应一致 |
| 品牌改名 | BRAND_NAME_MISMATCH，完整中文错误响应一致 |

比较使用相同的 json.dumps(response, ensure_ascii=False) UTF-8 序列化，保留字段插入顺序，逐字节比较完整响应，再记录摘要。没有只比较结果身份或重算哈希来放行，没有重生成旧夹具。

## 五、版本同步与验收检查

升级流程：在原源码或导出配方修改 → 更新包版本 → 重新导出 → --check → 独立安装与回归 → 团队按固定版本通过 PR 同步整目录。团队不分别修改生成包内的算法；修复先回权威源码，再导出新版本。

--check 将当前权威输入重新生成成预期字节，检测源码变更、导出文件内容变化、文件新增/缺失及清单变化。新增 6 项单元测试在临时副本中故意修改源码、改交付文件、加文件、删文件，均被拦住，没有修改真实源码。还扫描包内绝对导入只来自标准库；不只凭 dependencies=[] 声称零依赖。

提交前从 Git 暂存区检出交付目录与 18 份权威输入，确认 24 个交付文件与工作区、Git 对象逐字节一致；用检出后的源码重新导出也得到相同目录。Python 3.11 -I 在该临时检出目录运行独立核验通过，记录在 logs/m15-batch7-checkout-bytes.json。

团队拿到交付目录后可先运行 verify_export.py，核对清单和原字节。完整源码一致性检查仍在权威仓库运行。交付清单摘要及团队固定版本记录应配套保存；构建/安装副本可能产生元数据或缓存，目录核验针对原始交付物。

团队仓库具体放置路径、uv.sources 条目、地图库本地目录与 URL、权限、运行绑定和修订关系都未在本批确定或实现。

## 六、首轮回归结果（ecd2383，补测见第八节）

| 命令 / 检查 | 结果 |
| --- | --- |
| python scripts/export_scene_service.py --check | 通过，24 个文件 |
| python packages/scene-service/verify_export.py | 通过，23 个清单内文件加清单自身 |
| Python 3.11 隔离安装及 c0bf430 字节对比 | 通过，七组完整响应一致 |
| python -m unittest discover -s adapter -p "test_*.py" | 135 项通过 |
| npm --prefix frontend test | 388 项通过 |
| python -m unittest discover -s scripts -p "test_*.py" | 23 项通过：原打包 17 项 + 新导出 6 项 |
| npm --prefix frontend run build:embed | 通过 |
| node scripts/prepare-scene-assets.mjs --dist | 通过，catalog 仍为发布登记字节 |
| node scripts/audit-public.cjs | 0 项 |
| node scripts/test-scene-render.cjs | 通过 |
| node scripts/test-scene-render-embed.cjs | 通过，默认关闭 / 显式开启 / 恢复默认关闭 |
| node scripts/test-run-replay.cjs --embed | 通过 |
| node scripts/test-live-run.cjs | 通过 |
| node scripts/test-config-preview.cjs | 通过 |
| npm --prefix frontend run build:pages | 通过 |
| node scripts/test-gis.cjs --pages | 通过 |
| node scripts/test-pages.cjs | 通过 |

本批日志为 logs/m15-batch7-*.log；浏览器报告及截图沿用各现有脚本的 logs 子目录，均不提交。最终 dist-embed 共 242 个文件，保持正式默认构建，本地导入关闭。

原 adapter/scene_service 全部源码、原素材登记及 catalog、USTC 正式 v1/v2 共 28 文件、SceneResult 契约和夹具、旧 config-map、build-tools.mjs、embed-plugin.mjs、学弟的 build:split 与打包脚本均未修改；另外做与 c0bf430 的路径字节比较。135 项 Python 回归包含旧地图按原命令复现逐字节一致。

## 七、限制及下一步

本次独立安装验证平台为 Windows / CPython 3.11.15，没有把它描述成 Linux 验收。学弟的 build:split 原说明支持 Linux/macOS 或 WSL，且要求干净 Git 工作树。本机未安装 WSL，本批跑完其原有 17 项打包测试，没有改脚本以迁就 Windows；Linux 的完整 build:split 与禁网导入/地图复现，按约定由独立验收方复核。

本批不把整个建图工具装进主 worker。后续团队薄适配只需按确认的契约读取真实快照、计划、已准备地图，调用稳定接口，并转换团队响应与错误；仍需先确认 PR #22 的结果外壳、结构化意图、MAP_NOT_READY、计划修订关系及 map=false 识别规则。

包版本 0.1.0 只声明支持 Python 3.11。旧仓库脚本继续使用原环境，没有因打包改变其解释器要求。位置和路线仍为示意，不影响模拟。

## 八、验收补丁：导入依赖与源码归类

独立验收发现：首轮导出只按白名单收集文件。原模块新加 from .newmod import HELPER 时，newmod.py 会被忽略；重新导出后的字节检查仍能通过，安装导入才暴露缺依赖。单独新增的未引用源码也没有提示。本次补丁在写任何交付文件前增加两条检查，正常导出和 --check 共用同一入口。

### 1. AST 静态导入检查

对所有转换后的导出模块（含生成的 __init__.py 和素材登记模块）解析 AST，建立导出模块/包集合，检查函数内、条件分支内和顶层的静态导入：

- from .newmod import HELPER、from . import newmod：必须能解析到导出集合中的模块。
- import mecoffe_scene_service.newmod、from mecoffe_scene_service.newmod import HELPER、from mecoffe_scene_service import newmod：同样检查包内绝对导入。
- from . import common 等已有子模块正常通过；稳定门面上已声明的 compile_scene 等属性不会误判为新模块。
- 引用了 map_package 或 fixtures 等明确排除内容，仍然拒绝；排除名单不能用来隐藏运行依赖。
- 相对导入超出包边界时拒绝。

缺依赖的报错包含导出文件、行号、被引用模块和缺失文件候选，例如 compiler.py 引用 newmod，会明确指出 src/mecoffe_scene_service/newmod.py 未导出。不会先写出一份缺模块的包，也不会回退为成功。

此检查针对静态 import 语句，不执行源码，不代替真实安装验收；不声称能验证任意动态导入、导入环或所有运行时符号行为。

### 2. 源码文件必须显式归类

递归扫描 adapter/scene_service 下的 .py / .json。每个文件必须落入下列之一：

| 分类 | 内容 |
| --- | --- |
| 导出名单 | MODULES 中的 11 个模块，以及 contract.json、contract-v2.json、issue_messages.json |
| 明确排除文件 | __init__.py（使用生成门面）、__main__.py（旧 CLI）、map_package.py（发布流程）、evidence_rules.json（发布默认规则） |
| 明确排除目录 | fixtures、tests、__pycache__；规则覆盖这些目录下的内容 |

其他文件一律报“未归类”，要求加入导出名单或排除名单并更新导出规则版本。新增未引用模块、未引用 JSON 或新的子目录文件，都不能再被静默忽略。已有明确排除内容的新增或改动不影响交付物；若运行模块去导入这些内容，前一条依赖检查会拒绝。

导出/排除名单及原因写入 EXPORT_MANIFEST.json 的 exporter.source_policy。导出规则版本由 1 升为 2，另记录新导出器摘要。Python 包仍是 0.1.0；src、契约、资源、README、安装配置、VERSION、独立核验脚本等 23 个清单内文件都与 ecd2383 逐字节相同。交付目录仅 EXPORT_MANIFEST.json 元数据变化，files 摘要表完全不变。

### 补测结果与本次回归范围

新增 5 项测试，均使用临时源码副本或内存中的导出内容，不修改真实 adapter 源码：

1. 新增 newmod.py 并以五种写法引用：导出及 --check 都退出 1，指出引用者和缺失文件，输出目录未创建。
2. 新增未引用的 .py、.json，包含子目录：导出及 --check 都退出 1，要求显式归类。
3. 新增或修改明确排除文件（含 map_package.py）和排除目录内容：导出内容完全不变。
4. 已有模块、包内绝对导入和稳定门面属性可通过；缺失、排除或越界导入被拒绝。
5. 逐个与 Git ecd2383 比较 23 个运行交付文件，并确认包版本 0.1.0、导出规则版本 2。

| 补测 | 结果 |
| --- | --- |
| python -m unittest discover -s scripts -p "test_*.py" | 28 项通过：原打包 17 项 + 导出 11 项 |
| python scripts/export_scene_service.py --check | 通过，24 个文件 |
| python packages/scene-service/verify_export.py | 通过 |
| Python 3.11.15 干净 venv 离线安装验收 | 通过，来自 site-packages，无运行依赖、未加载 adapter |
| 与 c0bf430 的七组完整编译响应字节对比 | 全部相同；外部地图 compile/check、v1/v2 校验、中文说明及 SceneError 检查通过 |

安装复验命令使用原脚本，只换了新的输出目录：

```powershell
python scripts/verify_scene_service_install.py --python D:\App\anaconda\envs\hello-agents\python.exe --out logs/milestone15-batch7-rules2-install
```

日志：logs/m15-batch7-rules2-scripts.log、logs/m15-batch7-rules2-install.log。原运行源码、前端及资源字节均未改变；本次只改导出预检、测试、清单元数据和文档，所以按本轮约定不重跑前端与浏览器回归。第六节保留首轮结果，独立验收方也已确认原全套回归及 build:split、建图包 v1/v2 复现通过。
