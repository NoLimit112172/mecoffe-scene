# `scene-split.1` 场景产物

基于场景仓库的 `198394b`，包含场景编译、配置检查模块和中科大正式地图 v2。原 `build:embed` 继续生成完整嵌入目录。新增的 `build:split` 先执行该构建，再用 `node scripts/prepare-scene-assets.mjs --dist` 校验构建后的素材目录。校验通过后，按原始字节拆分嵌入文件，加入主线的正式地图，并打包独立的 Python 建图工具。

```sh
npm --prefix frontend ci
npm --prefix frontend run build:split
```

`build:split` 支持 Linux 和 macOS，需在 PATH 中提供 `python3`、`npm`、`node`、`git`，使用 Python 3.11 和仓库支持的 Node.js 22 或 24。Windows 用户可在 WSL 的 Linux 环境执行。构建记录 Git 提交，需在干净的工作树执行。默认输出 `logs/scene-split.1/`，也可以用 `-- --output-dir /absolute/test/path` 指定尚不存在的目录。四份归档全部生成并核对通过后，命令才发布该输出目录。

| 归档 | `payload/` 内容 |
| --- | --- |
| `scene-display-1.0.0.zip` | `scene/` 内的入口、编译后的 JS/CSS、字体和许可页。 |
| `scene-model-library-1.0.0.zip` | `scene/mecoffe/assets3d/` 和 `scene/assets/bgrd-*` 的六个 YuLan 图集文件。 |
| `scene-map-library-1.0.0.zip` | `scene/mecoffe/config-map/` 旧地图和 `data/maps/<map_id>/<version>/` 下全部已发布地图。当前包含 `ustc-gaoxin/1` 和 `ustc-gaoxin/2`。 |
| `scene-map-builder-1.0.0.zip` | Python 建图、场景编译与用途证据模块、公开素材目录、原始地图输入和 [离线运行说明](scene-builder-offline.md)。 |

`release-lock.json` 记录源码提交、归档版本及 SHA-256、发布素材库版本、公开 `catalog.json` 的 SHA-256。`map_refs` 为按地图 ID 和版本排序的列表，每项含 `map_id`、`map_version` 和 `manifest_sha256`，与地图库 `artifact.json` 的 `map_refs` 一致。打包时校验全部地图清单和文件摘要，发布锁再次核对归档里的每一份地图原字节。请使用同一份锁文件对应的四份 ZIP。

三份前端归档分别解到临时目录，核对锁文件和各包的清单，再将三个 `payload/` 中的文件合成一份同源站点目录。合成的 `scene/` 应与同一提交默认构建的完整包逐文件一致。正式地图按 `/scene-maps/<map_id>/<version>/manifest.json` 提供，引用摘要是该清单原始字节的 SHA-256。同一编号和版本始终指向同一份内容。地图库按版本目录归档，Python 建图包另外携带用于复现 v2 的 `data/maps/ustc-gaoxin/review-annotations.v2.json` 原字节。

Python 包递归收集 `adapter/scene_service/` 中的运行代码和 JSON 资源，排除 `tests/`、`fixtures/`、测试文件和缓存，因此包含 `compiler.py`、`issues.py`、`issue_messages.json` 和 `checker.py`。回归测试从真实 ZIP 解包，在独立目录用 `python -I` 导入，先复现正式 v1，再带包内补注复现同级 v2，并逐文件比对两版。

`mecoffe-embed-v1` 是地图和加载器登记的素材库发布版本，`1.0.0` 是拆分归档版本。素材库归档和 Python 包携带同一份已通过官方校验的公开 `catalog.json`，地图清单与发布锁记录它的摘要。

## 配置预览、运行和地图选择

当前主站用 `session` 加 `config` 或 `run` 进入场景。配置预览、实时运行和历史回放继续从 `/scene/mecoffe/config-map/` 读取旧地图。业务入口接通本次配置或运行的有效 `SceneResult` 后，按其中的 `map_ref` 选取正式地图，版本由该引用指定。发布锁的列表记录可用地图。

`build:split` 显式关闭 `MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT`。主线已有的本地诊断入口可用显式开启的独立构建验证 `SceneResult → map_ref`，与主站入口分开。

测试服务器的同源目录、访问控制、服务账号读权限和建图输出目录由部署负责人确认。挂载在独立测试站点验证，再按团队流程处理后续发布。
