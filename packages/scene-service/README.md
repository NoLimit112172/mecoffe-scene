# 场景编译运行包 0.2.0

这是自动生成的交付目录，不在这里手工改源码。源代码由 mecoffe-scene 的
adapter/scene_service 和素材登记模块维护，导出规则为 scripts/export_scene_service.py。
团队按固定版本接入，升级通过 PR；包版本与 SceneResult v1/v2、地图版本相互独立。

Python >=3.11,<3.12；运行依赖为空。构建工具仅 setuptools>=68，需离线预备。
正式安装前运行 `python verify_export.py` 核验目录。构建可能产生临时文件，建议从交付目录
的副本安装。目录核验不是安装后 site-packages 的文件核验。

离线安装（隔离环境已有 pip 与构建工具）：

    python -I -m pip install --no-index --no-deps --no-build-isolation /path/to/package-copy

仅提供 Python API，没有场景功能命令行；verify_export.py 只核验交付物。
没有建图、地图发布或模型调用。

    from mecoffe_scene_service import compile_scene, validate_result, check_scene
    from mecoffe_scene_service import load_map, describe_issue, SceneError

| 稳定接口 | 返回 / 异常 / 副作用 |
| --- | --- |
| compile_scene(intent, snapshot, plan, map_package=None, *, assignment_seed=None) | 成功返回 {ok: true, result}，已知输入错误返回 {ok: false, error}；纯计算，不读网络、数据库或写文件；auto-evidence.2 地图产出 v3，旧规则地图及 none 仍产出原 v2 |
| validate_result(result, context=None) | 返回通过校验的原结果；失败抛 SceneError；不改正文，不读取地图目录，不重算 AI 阈值 |
| load_map(path) | 读取本地已准备地图并返回包；核对资源与冻结证据；校验错抛 SceneError，文件错可能抛 OSError/ValueError 等；只读文件 |
| check_scene(intent, snapshot, plan, map_directory=None, *, assignment_seed=None) | 返回 JSON 可序列化的检查报告；读取本地地图，不写文件、不联网；配置期通过仍明确运行绑定待确认 |
| describe_issue(code, details='') | 返回独立中文说明字典；未知码保留原码并用 INVALID_INPUT 说明；无文件或网络副作用 |
| SceneError | 继承 ValueError；code 为已有错误码，str(error) 为原始诊断；业务薄适配负责转换为团队错误 |

`__version__` 为运行包版本；`SCENE_RESULT_SCHEMA_VERSIONS` 为可读取的 v1/v2/v3；
`SCENE_RESULT_OUTPUT_SCHEMA_VERSION` 为新规则的输出版本 v3，不表示旧地图也要升级。其他模块、常量和函数均为内部实现。
不把可修改的契约字典作为稳定公共 API。检查和加载函数沿用现有异常边界，不保证所有错误都包装成 SceneError。

本包包含几何可达性、旧证据重算及编译必需的纯函数，读取新地图时使用已冻结证据；
没有 prepare-ai-review、map_package、OSM 转换、地图文件、测试、夹具、模型文件。
包内资源只有 v1/v2/v3 契约、中文说明、发布素材登记和 catalog；catalog 原字节不改。
不会自动下载地图、放宽偏好、改为 none 或实现团队运行绑定。

源码一致性在源仓库运行：

    python scripts/export_scene_service.py --check

交付目录的逐文件清单在 EXPORT_MANIFEST.json，包含源提交、规范化源码摘要、导出器摘要和文件摘要；
不包含机器绝对路径或时间戳。源码文本统一 LF，已登记素材资源保留原始字节。
