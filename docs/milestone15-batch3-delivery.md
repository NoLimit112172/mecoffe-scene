# M15 第三批交付

基线 main=`dd980ed`，本地分支 `feat/m15-batch3`。本批完成发布 catalog 一致性、正式新格式中科大地图、中文与无地图界面收尾，以及私有对接方案新版。没有推送、合并、发布或部署；没有联网获取地图或访问团队服务器。

## catalog 按真正发布的字节登记

源码和发布版不是同一份文件：源码摘要以 `a54f919d8c86764b` 开头，现有 embed 发布器会删去不分发条目并重写预览路径，发布版摘要以 `a4444d42d820359f` 开头。不能用前者登记地图、再让发布页验证后者。

本批登记的素材库描述：

```json
{
  "schema_version": "scene.asset-library.v1",
  "version": "mecoffe-embed-v1",
  "catalog_file": "catalog.json",
  "catalog_sha256": "a4444d42d820359ff180d4390c1b16a5a86249cfd008a0d2e5eafa1dfc55aa0c"
}
```

描述和完整 catalog 原始字节保存在 `adapter/scene_builder/resources/mecoffe-embed-v1/`。catalog 不额外格式化，不补换行。地图 manifest、显示程序的固定版本描述、Python 使用的 catalog 都指这份字节。前端会再读取实际发布 catalog 核对摘要，不根据当前取到的内容临时猜版本。

复核命令：

```text
node scripts/prepare-scene-assets.mjs
npm --prefix frontend run build:embed
node scripts/prepare-scene-assets.mjs --dist
```

`node scripts/prepare-scene-assets.mjs --dist` 是**发布前必过项**，当前按此命令验收；后续由 shaoyunhui 接入正式构建或 CI 自动检查。本批不修改他负责的两份打包文件。白名单或发布字节改变后，应登记新版本并同步消费者和地图版本，不通过覆盖 v1 来消除错误。

登记脚本直接复用当前发布器的 `embedCatalog`，没有复制一套过滤算法。首次登记用 `--write`；已存在版本内容不符会拒绝覆盖。未来发布内容改变须新建版本目录，并明确更新描述、消费者和地图版本，不覆盖 v1。

Python 新生产建图可通过 `published_asset_library()` 取得已校验的描述和 catalog，传给现有 builder 的 `catalog=`，或给现有 CLI 的 `--catalog` 指向该资源文件。旧 builder 默认路径为历史兼容保留；不能把它的源码默认 catalog 当成生产发布版。完整 Python/Linux 独立打包及其他依赖整理仍属于拆分打包工作，不能只复制一个目录就宣称已完成独立部署。

默认 DEV 页面仍取到源码 catalog 时，明确提示“当前为源码素材，与发布版不同”，停止绘图。DEV 功能浏览器测试先验证这个真实错误，再显式提供发布 catalog 作为测试响应；这不代替发布验证。`test-scene-render-embed.cjs` 在真正的 dist-embed、严格静态 `/scene/` 目录下分别检查默认关闭与显式开启，开启时使用未经替换的实际发布 catalog：发布版登记地图能加载，源码版登记地图被拒，且不回退中科大。

没有修改 `frontend/embed/build-tools.mjs` 或 `frontend/embed/embed-plugin.mjs`，不往 embed 塞地图包或模拟输入。第二批文档中的 bundled-v1 和最初第三批的常开本地入口是当时快照，现以以下收口规则为准。

## 本地导入入口：正式构建默认关闭

开关名称为 **`MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT`**，只有字面值 `true` 才开启 embed 的 SceneResult 本地导入。未设置或设为 false 时关闭；DEV 模式保持可用，Pages 不因此开启。`EmbeddedSceneEntry.vue` 与 `previewQuery` 共同读取 `sceneImportGate.js`，不能仅靠 URL 参数启用关闭的构建，也不会因无效参数丢掉团队 run/config 引用。

本项目 `frontend/vite.config.js` 已为 embed/Pages **显式配置** `envPrefix: 'MECOFFE_PUBLIC_'`，所以这个前缀确实会暴露给客户端；这里没有假定 Vite 的默认 VITE_ 前缀能读取其他变量，也没有扩大环境变量暴露范围。实际开启/关闭构建已分别经浏览器验证。

正式默认命令仍为 `npm --prefix frontend run build:embed`。关闭时，`/scene/mecoffe3d/?scene=local` 和 `/scene/mecoffe-gis/?scene=local` 都回到原有“请从团队网站打开场景”欢迎页，无新导入界面、地图画布或团队 API 请求；与无参数欢迎页的资源请求逐项一致。本次默认产物实测仍为 242 文件，**未产出 SceneResultEntry 的 JS/CSS 分块**，也未请求该分块。原来欢迎页已有的开发者调试区保持原样。

临时开启供本地测试的 PowerShell 用法：

```powershell
$env:MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT = 'true'
npm --prefix frontend run build:embed
# 检查结束后恢复关闭的正式产物，不保留测试构建。
$env:MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT = 'false'
npm --prefix frontend run build:embed
node scripts/prepare-scene-assets.mjs --dist
Remove-Item Env:\MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT
```

也可直接执行 `node scripts/test-scene-render-embed.cjs`：它先构建未设置开关的默认包并验证关闭，再构建显式开启的测试包运行完整发布素材/错配拒绝/none/iframe 测试，最后在 finally 中重建关闭包并再次验证。子测试失败也会尝试恢复，恢复失败则明确退出失败，不能拿测试包发布。输出仍使用现有 dist-embed，未改打包插件的目录规则。

开启构建中的本地地址才是 `/scene/mecoffe3d/?scene=local`、`/scene/mecoffe-gis/?scene=local`；它们不读取正式远程 scene。这个开关只控制入口发布，**不放宽 catalog、SceneResult、source_refs、地图哈希或入口可达性校验**。

## 正式中科大地图与可复现生成

源数据仍是仓库公开中科大几何，未重新下载。命令：

```text
python scripts/generate-ustc-map.py
```

输出在 `data/maps/ustc-gaoxin/1/`，用于今后的独立地图库打包，不在 public、Pages 或 embed 中。manifest 为 `scene.map-manifest.v1`，map_id=`ustc-gaoxin`，map_version=`"1"`，title=`中国科学技术大学 · 高新校区`，素材版本和摘要按上节登记。

打包时须将**完整版本目录按原字节复制**到 `<mapsBase>/ustc-gaoxin/1/`，保持 manifest 与全部引用文件，不重序列化 JSON、不改换行、不换成 latest。mapsBase 的同源挂载前缀由团队确认；目录迁移不应改动文件字节。

地图含 campus3d、entrances、landcover、asset_assignments、quality、surroundings，以及七个 GIS 图层。所有文件写成固定 UTF-8/LF，清单保存原始字节 SHA-256；manifest 自身摘要写入外部 map_ref，不自存哈希。生成器先比较现有版本的全部输出内容，有差异便拒绝覆盖；应改用新版本。

本次 v1 manifest SHA-256：

```text
101a660efd370e807d4d3e579ca2c5732b69c79ce8fb43a0a6d864e9a41bf1ad
```

| 统计 | 数量 |
| --- | --- |
| 楼栋 / 有效轮廓 | 31 / 31 |
| 可安置楼栋 | 29 |
| 入口 / 主路网分量入口 | 31 / 31（100%） |
| 无入口楼栋 | 0 |
| 教学 / 宿舍 / 未知 | 21 / 8 / 2 |
| 餐饮、零售、住宅、办公、图书服务的严格用途证据 | 均为 0 |
| POI | 0 |
| 当前通用质量状态 | ready |

ready 不代表任意用途都有候选。门店要求餐饮且 fallback=fail 时仍报 SCENE_NO_CANDIDATE。另有两栋未通过安置安全检查，quality.json 保留 BUILDING_EXCLUDED 及楼栋引用，它们不参与候选。当前 .9 的主路网入口比例门槛、0 的已知用途比例门槛只是可校准示例；具体实验还要检查用途候选和每个入口可达。

重复生成两次已核对输出一致；单元测试还逐字节比较所有地图文件，并验证已有版本改标题会被拒绝。旧 kind、楼体轮廓和步行图保留。另从 dd980ed 取原始归档生成兼容地图，与当前 dist-embed 的 legacy config-map **13 个文件逐字节比较相同**，报告在 `logs/m15-batch3-legacy-bytes.json`。

## 空审核模板怎样用

`data/maps/ustc-gaoxin/review-annotations.template.json` 绑定 v1 的精确 map_ref，列出下列候选，仅供人工核实：

| 楼栋 ID | 名称 |
| --- | --- |
| way/1435377504 | 教工食堂 |
| way/1435377505 | 学生食堂A区 |
| way/1435377506 | 学生食堂B区 |

functions、source、reviewer、note 都为空。名字仅作弱证据，本批没有替任何人填写餐饮用途或审核人。

1. 将模板另存为已审核文件，保留原模板。删除尚未核实的楼栋条目。
2. 对核实过的条目填写 functions（例如 dining）、真实 source、reviewer 和 note；后三者均须非空。默认追加用途；确需替换旧用途时可明确填 mode=replace，程序保留旧证据来源。
3. 保留模板里引用 v1 的 map_ref，再执行：

```text
python scripts/generate-ustc-map.py --version 2 --annotations <已审核文件路径>
```

程序会核对旧清单哈希、楼栋、用途词及审核信息，生成 `data/maps/ustc-gaoxin/2/`，不覆盖 v1。空模板不能直接通过审核校验。补注来源保存在楼栋记录中，Python 再读取新版本并编译时仍保留这些证据。审核文件本身不得包含人物、团队配置或运行数据。

## 界面收尾

- 安置程序理由改为中文，注明教学/餐饮等实际用途，或已确认的指定楼栋、范围内兜底、场外兜底。resolver_version 从 1 升为 1.1；SceneResult 字段结构和校验规则未改，合成夹具已重生成。
- 证据保存值仍为 building_tag / poi / annotation / name_keyword，显示文字为建筑标签 / 楼内兴趣点 / 人工补注 / 名称推断（弱）。
- none 页使用标题、说明卡、人数/关系/事件统计和人物、关系列表。显示人物姓名与明确提供的中文角色说明；缺少中文说明时如实提示，不猜身份。原始人物和角色 ID 收进详情，事件也按姓名展示。无地图、无素材读取、无画布。
- “安置与依据”默认一行折叠，高 34px；展开内容覆盖在地图上方，不推动地图缩小。桌面、整页 iframe 和 390px 窄屏均验证。按第二批原面板 CSS 在同页对照，三维地图高度从参考 719.31px 到 722.5px，窄 iframe 从 249.81px 到 253px；展开后高度不变。

## 测试及截图

| 命令 | 结果 |
| --- | --- |
| `python -m unittest discover -s adapter -p "test_*.py"` | 111 通过 |
| `npm --prefix frontend test` | 379 通过，含关闭时保留团队 run/config 引用 |
| `npm --prefix frontend run build:embed` | 通过 |
| `npm --prefix frontend run build:pages` | 通过，静态页面回归使用新产物 |
| `node scripts/prepare-scene-assets.mjs --dist` | 发布、登记及 Python catalog 字节一致 |
| `python scripts/generate-ustc-map.py`（两次） | manifest 与所有输出文件一致 |
| `node scripts/test-scene-render.cjs` | 通过，含 DEV 源码素材明确拒绝、发布素材测试响应与原功能回归 |
| `node scripts/test-scene-render-embed.cjs` | 通过：默认关闭、显式开启验证、最终恢复关闭；开启时完整素材/场景校验不变 |
| `node scripts/test-run-replay.cjs --embed` | 通过 |
| `node scripts/test-live-run.cjs` | 通过 |
| `node scripts/test-config-preview.cjs` | 通过 |
| `node scripts/test-gis.cjs --pages` | 通过，离线图层 |
| `node scripts/test-pages.cjs` | 通过，11 路由及刷新、慢网可操作性、本地素材保留 |
| `node scripts/audit-public.cjs` | 通过，0 项发现 |

新增单元检查包括固定 catalog 字节、源码差异、正式地图前端加载、无虚构餐饮候选、地图重复生成、版本不可覆盖、空补注拒绝、已审核 v2 重新读取及引用错配。现有 SceneResult 合法/非法样例继续由 Python/前端共同验证。

主要文件分组：

| 范围 | 文件 |
| --- | --- |
| 发布素材描述与核对 | `adapter/scene_builder/asset_library.py`、同目录 `resources/mecoffe-embed-v1/`、`scripts/prepare-scene-assets.mjs`、`frontend/src/mecoffe/sceneMap.js` |
| 地图生成与读取 | `adapter/scene_service/map_package.py`、`maps.py`、`scripts/generate-ustc-map.py`、`data/maps/ustc-gaoxin/` |
| 中文理由与证据 | `adapter/scene_service/resolver.py`、`frontend/src/mecoffe/sceneLabels.js`、`ScenePlacementDetails.vue`、`MeCoffe3D.vue` |
| 无地图与显式嵌入入口 | `SceneResultEntry.vue`、`EmbeddedSceneEntry.vue`、`configPreviewStore.js`、`sceneImportGate.js` |
| 测试和夹具 | `adapter/test_scene_map_package.py`、`test_scene_service.py`、`frontend/tests/sceneBatch3.test.js`、两组重生成的合成夹具、`scripts/test-scene-render*.cjs`、`scripts/lib/m15-render-fixtures.py` |
| 原始字节保留与交付记录 | `.gitattributes`、本文件；私有对接文档另存于下一节路径 |

本批截图与 embed 报告在 `logs/milestone15-batch3/`：published-catalog-three.png、published-catalog-gis.png、source-catalog-map-rejected.png、none-desktop.png、iframe-three.png、narrow-iframe-three.png、none-narrow-iframe.png、embed-qa.json。DEV 原功能截图在 `logs/milestone15-render/`，含 dev-source-catalog-rejected.png。命令日志为 `logs/m15-batch3-*.log`。全部测试只用合成数据和既有公开几何，外部请求与团队 API 请求为零。

入口收口复测日志为 `logs/m15-gate-*.log`；同一截图目录另存 default-qa.json、restored-default-qa.json、embed-matrix-qa.json，以及默认/开启/恢复三份构建日志和默认欢迎页截图。最终以 restored-default-qa.json 和默认正式产物验收，不以开启测试包作为交付物。

## 私有对接文档与后续确认

新版另存于 `D:/Documents/ChatGPT/social-sim/独立场景Agent_与褚凌宇对接方案_2026-11-10_M15第三批.md`，正文不进入此公开仓库。只在该目录新建这份方案，没有修改 social-sim 代码；旧版保留。

- shaoyunhui：素材库和地图库拆分产物采用本批版本描述、原始字节及 manifest；将 `prepare-scene-assets.mjs --dist` 纳入发布构建检查；正式构建不启用本地 SceneResult 导入开关。ustc-gaoxin/1 原字节复制到上述目录。完整 Linux 包依赖、资源许可和测试环境挂载仍由后续拆分确认。
- 褚凌宇/后端负责人：scene_intent 名称映射、scene 注册/附属产物、正式读取权限和包装、地图任务队列、运行绑定与不可变正文保存都未接入。当前前端严格核对计划修订号；模型换绑造成修订变化的后端证明及消费适配需明确，不由前端猜。
- 吴贤或地图审核者：三栋食堂候选仍待人工核实；审核后才生成 v2。v1 不能严格安排餐饮门店。
- 当前显式文件入口用于 DEV 或主动开启的测试构建，正式默认关闭；不自动读取远程 stages/scene，不代表地图库服务或管理员工具已获批准。默认无 SceneResult 的团队流程继续 legacy。
