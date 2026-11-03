# 里程碑 4：VS Code 本地项目配置

验收日期：2026-11-03。继续在 `feat/asset-library` 上工作，基于里程碑 3 的 `d8873c4` 单独本地提交；未 push。提交号见 `git log -1` 或本轮交付回复，提交信息以 `milestone 4:` 开头。

`main` 保持 `ee17353a4de200d87eca7ad828ca586511252d62`。5180 原服务 PID **71160** 持续保留，启动测试实际复用该进程。页面源代码、原始数据、素材目录内容、映射、路网、依赖及锁文件均未修改。

## 工作区与四个入口

打开根目录 `mecoffe-scene.code-workspace`，在“运行和调试”选择下列入口并按 F5。均使用 VS Code Chrome 调试器、统一的 `preLaunchTask`、`presentation.group: MeCoffe` 和顺序 1–4。

| 启动项 | 地址 |
| --- | --- |
| MeCoffe：二维校园沙盘 | http://127.0.0.1:5180/mecoffe |
| MeCoffe：三维校园沙盘 | http://127.0.0.1:5180/mecoffe3d |
| MeCoffe：三维素材库 | http://127.0.0.1:5180/mecoffe3d/assets |
| MeCoffe：NUS 建模预览 | http://127.0.0.1:5180/mecoffe3d?campus=nus |

工作区排除 node_modules、dist、原始/派生大数据及日志的搜索；不删除或隐藏源代码。新增 Vue.volar、ms-python.python、ms-python.vscode-pylance 推荐扩展。

## 任务清单

| 任务 | 执行方式 |
| --- | --- |
| MeCoffe：启动场景服务 | `start-mecoffe.ps1 -NoBrowser`，验证并启动/复用服务 |
| MeCoffe：生成地图场景（OSM 范围） | `python -X utf8 -m adapter.scene_builder osm`；输入 ID、标题和四边经纬度 |
| MeCoffe：生成地图场景（GeoJSON 文件） | 同模块的 `geojson`；输入文件路径、ID、标题 |
| MeCoffe：重建中科大场景 | 已存 OSM + `--profile ustc_legacy`，写入独立 `campuses/ustc/` |
| MeCoffe：重建素材库目录 | `adapter/build_asset_catalog.py` |
| MeCoffe：重新生成场景数据 | 保留原 `adapter/oasis_to_scene.py` 任务 |
| MeCoffe：重新生成新版网络 | 保留原 `adapter/snapshot_to_scene.py` 任务 |
| MeCoffe：重新生成新版演示 | 保留原 `adapter/build_demo.py` 任务 |
| MeCoffe：运行全部测试 | sequence 依赖以下两项；失败即停止 |
| MeCoffe：运行 Python 测试 | `python -X utf8 -m unittest discover -s adapter -v` |
| MeCoffe：运行前端测试 | `scripts/run-frontend.ps1 -Action test` → `npm run test` |
| MeCoffe：构建前端 | 同脚本 `-Action build` → `npm run build`；默认构建任务 |

实际执行任务使用 process 类型和独立参数，含空格的路径/标题无需额外引号。新地图写入 `frontend/public/mecoffe/campuses/<id>/`，服务开启后通过 `/mecoffe3d?campus=<id>` 查看。输入框及 README 写明地图 ID 的可接受字符和新 ID 用法；VS Code promptString 不额外执行 ID 自动修正。地图内容验证继续由既有流水线负责。

## 启动兼容性修复

- 启动脚本仍支持 `-NoBrowser`、`-Rebuild`、`-Port`；只增加四个地址输出，默认自动打开页仍为二维。
- 实测原脚本重复发布同内容 `latest-demo.json` 时，Windows 连续两次返回 WinError 5，导致 F5 前置任务中断。现每次完整生成到同目录临时文件并比较 SHA-256；内容相同则不替换现有文件，不跳过生成/数据校验。变化时用原子替换，新目标用移动，失败保留原文件，临时文件最终清理。
- Windows PowerShell 5.1 的 File.Replace 备份路径使用 `[NullString]::Value`；隔离测试发现 `$null` 被绑定为空字符串的问题并验证修正。
- 前端任务直接调用 Node 所在目录的 npm.cmd，避免 npm.ps1 执行策略与 shell 拼接问题；多 Node 安装只选择首个实际命令。依赖缺失时先 npm ci，任何失败原样返回非零退出码。

## 验证结果

验证环境：Windows、Windows PowerShell 5.1、Node v24.15.0、Python 3.12.4。执行了 tasks.json 内的实际命令及顺序依赖，日志保存在忽略的 `logs/vscode/`。

| 检查 | 结果 |
| --- | --- |
| Python 全套 `python -X utf8 -m unittest discover -s adapter -v` | **55/55 通过** |
| 前端全套 `npm test`（配置任务等价执行 `npm run test`） | **121/121 通过**，其中新增配置测试 9 项 |
| `npm run build` | **通过**；保留既有动态/静态导入与大包警告 |
| `start-mecoffe.ps1 -NoBrowser` | **通过**；四个地址齐全，复用 5180 |
| `start-mecoffe.ps1 -NoBrowser -Rebuild` | **通过**；旧数据内容不变，复用 5180 |
| Chrome 实际访问四个配置 URL | **全部通过**；渲染 canvas、没有页面异常/console error |
| GeoJSON 输入任务 | **通过**；含空格的本地路径与中文标题，生成 1 楼/1 路，浏览器显示正确标题 |
| OSM 输入任务 | **通过**；官方 API 小范围下载，生成 4 楼/20 道路段，预览无错误 |
| 重建中科大/素材库 | **通过**；31 楼/50 道路段与 68 原型，已有文件无 diff |
| 路由、任务路径、依赖、推荐扩展与 JSONC 注释 | **通过**；包含不存在的引用被拒绝的负向用例 |
| Windows 发布/退出码隔离测试 | **通过**；相同且锁定、变化、新文件、变化且锁定，以及 npm 安装/测试失败返回码 |

浏览器检查使用无头 Chrome 读取 launch.json 的四个 URL，并额外验证两份生成地图；未声称通过 UI 手动逐个按下 F5。配置引用与启动前置命令分别经测试和实测验证。

首次使用原 NUS 完整范围下载时，QA 外层 120 秒超时；随后使用校园内百米范围实际下载成功。任务的默认输入改为这个已验证小范围，原有 NUS 数据及入口保持不变；大范围下载仍依赖网络和 OSM 服务状态。原始尝试日志保留在 `task-smoke-first.json`，成功结果在 `task-smoke.json`。

两份临时测试地图和新下载的 OSM 已移动到 `logs/vscode/generated/` 保存证据，不进入项目默认数据或提交。`browser-smoke.json`、`verification-results.json`、`python-tests.txt`、`frontend-tests.txt`、`build.txt`、`startup.txt`、`startup-rebuild.txt` 保存本机验收结果。

## 改动文件

1. `.vscode/launch.json`：四个 F5 入口。
2. `.vscode/tasks.json`：地图/重建/测试/构建任务和输入参数。
3. `.vscode/extensions.json`：推荐扩展。
4. `mecoffe-scene.code-workspace`：搜索排除。
5. `start-mecoffe.ps1`：四地址、相同生成文件保留及原子发布。
6. `scripts/run-frontend.ps1`：前端测试/构建执行器和退出码传播。
7. `frontend/tests/vscodeConfig.test.js`：9 项配置与 Windows 运行测试。
8. `README.md`：工作区、F5、任务、自己的地图及预览地址说明。
9. `docs/vscode-project-delivery.md`：本交付记录。
