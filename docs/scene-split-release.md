# `scene-split.1` 场景产物

基于场景仓库的 `1d587e6`。原 `build:embed` 继续生成完整嵌入目录。新增的 `build:split` 先执行该构建，再用 `node scripts/prepare-scene-assets.mjs --dist` 校验构建后的素材目录。校验通过后，按原始字节拆分嵌入文件，加入主线的正式地图，并打包独立的 Python 建图工具。

```sh
npm --prefix frontend ci
npm --prefix frontend run build:split
```

使用仓库支持的 Node.js 22 或 24，以及 Python 3.11。构建记录 Git 提交，需在干净的工作树执行。默认输出 `logs/scene-split.1/`，也可以用 `-- --output-dir /absolute/test/path` 指定尚不存在的目录。四份归档全部生成并核对通过后，命令才发布该输出目录。

| 归档 | `payload/` 内容 |
| --- | --- |
| `scene-display-1.0.0.zip` | `scene/` 内的入口、编译后的 JS/CSS、字体和许可页。 |
| `scene-model-library-1.0.0.zip` | `scene/mecoffe/assets3d/` 和 `scene/assets/bgrd-*` 的六个 YuLan 图集文件。 |
| `scene-map-library-1.0.0.zip` | `scene/mecoffe/config-map/` 旧地图和由 `data/maps/ustc-gaoxin/1/` 原样归档的正式地图。 |
| `scene-map-builder-1.0.0.zip` | Python 建图、M15 地图用途证据、公开素材目录、原始地图输入和 [离线运行说明](scene-builder-offline.md)。 |

`release-lock.json` 记录源码提交、归档版本及 SHA-256、发布素材库版本、公开 `catalog.json` 的 SHA-256 和正式地图的 `map_ref`。每个 ZIP 的 `artifact.json` 记录实际包内容和依赖，`notices/` 提供单独归档的许可与署名。请使用同一份锁文件对应的四份 ZIP。

三份前端归档分别解到临时目录，核对锁文件和各包的清单，再将三个 `payload/` 中的文件合成一份同源站点目录。合成的 `scene/` 应与同一提交默认构建的完整包逐文件一致。正式地图的 `map_ref` 指向 `/scene-maps/ustc-gaoxin/1/manifest.json`，引用摘要是该清单原始字节的 SHA-256。同一编号和版本始终指向同一份内容。

`mecoffe-embed-v1` 是地图和加载器登记的素材库发布版本，`1.0.0` 是拆分归档版本。素材库归档和 Python 包携带同一份已通过官方校验的公开 `catalog.json`，地图清单与发布锁记录它的摘要。

## 配置预览、运行和地图选择

当前主站用 `session` 加 `config` 或 `run` 进入场景。配置预览、实时运行和历史回放继续从 `/scene/mecoffe/config-map/` 读取旧地图。挂载 `/scene-maps/` 只让正式地图文件可供读取。业务入口接通本次配置或运行的有效 `SceneResult` 后，才应按其中的 `map_ref` 选取正式地图。

`build:split` 显式关闭 `MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT`。主线已有的本地诊断入口可用显式开启的独立构建验证 `SceneResult → map_ref`，与主站入口分开。

测试服务器的同源目录、访问控制、服务账号读权限和建图输出目录由部署负责人确认。挂载在独立测试站点验证，再按团队流程处理后续发布。
