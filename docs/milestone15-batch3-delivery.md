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

登记脚本直接复用当前发布器的 `embedCatalog`，没有复制一套过滤算法。首次登记用 `--write`；已存在版本内容不符会拒绝覆盖。未来发布内容改变须新建版本目录，并明确更新描述、消费者和地图版本，不覆盖 v1。

Python 新生产建图可通过 `published_asset_library()` 取得已校验的描述和 catalog，传给现有 builder 的 `catalog=`，或给现有 CLI 的 `--catalog` 指向该资源文件。旧 builder 默认路径为历史兼容保留；不能把它的源码默认 catalog 当成生产发布版。完整 Python/Linux 独立打包及其他依赖整理仍属于拆分打包工作，不能只复制一个目录就宣称已完成独立部署。

默认 DEV 页面仍取到源码 catalog 时，明确提示“当前为源码素材，与发布版不同”，停止绘图。DEV 功能浏览器测试先验证这个真实错误，再显式提供发布 catalog 作为测试响应；这不代替发布验证。新增 `test-scene-render-embed.cjs` 则在真正的 dist-embed、严格静态 `/scene/` 目录下，使用未经拦截替换的实际 catalog：发布版登记地图能加载，源码版登记地图被拒，且不回退中科大。

没有修改 `frontend/embed/build-tools.mjs` 或 `frontend/embed/embed-plugin.mjs`。新增界面模块由现有 Vite 流程正常编译，不往 embed 塞地图包或模拟输入。显式本地文件入口现在也可在 embed 使用：`/scene/mecoffe3d/?scene=local`、`/scene/mecoffe-gis/?scene=local`；默认团队入口和请求路径不变，不等于正式远程 scene 已接入。第二批文档中的 bundled-v1 和 DEV-only 是当时的快照，以本批规则为准。

## 正式中科大地图与可复现生成

源数据仍是仓库公开中科大几何，未重新下载。命令：

```text
python scripts/generate-ustc-map.py
```

输出在 `data/maps/ustc-gaoxin/1/`，用于今后的独立地图库打包，不在 public、Pages 或 embed 中。manifest 为 `scene.map-manifest.v1`，map_id=`ustc-gaoxin`，map_version=`"1"`，title=`中国科学技术大学 · 高新校区`，素材版本和摘要按上节登记。

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
| `npm --prefix frontend test` | 378 通过 |
| `npm --prefix frontend run build:embed` | 通过 |
| `npm --prefix frontend run build:pages` | 通过，静态页面回归使用新产物 |
| `node scripts/prepare-scene-assets.mjs --dist` | 发布、登记及 Python catalog 字节一致 |
| `python scripts/generate-ustc-map.py`（两次） | manifest 与所有输出文件一致 |
| `node scripts/test-scene-render.cjs` | 通过，含 DEV 源码素材明确拒绝、发布素材测试响应与原功能回归 |
| `node scripts/test-scene-render-embed.cjs` | 通过，真实发布素材、错配拒绝、中文 none、窄屏和 iframe |
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
| 无地图与显式嵌入入口 | `SceneResultEntry.vue`、`EmbeddedSceneEntry.vue`、`configPreviewStore.js` |
| 测试和夹具 | `adapter/test_scene_map_package.py`、`test_scene_service.py`、`frontend/tests/sceneBatch3.test.js`、两组重生成的合成夹具、`scripts/test-scene-render*.cjs`、`scripts/lib/m15-render-fixtures.py` |
| 原始字节保留与交付记录 | `.gitattributes`、本文件；私有对接文档另存于下一节路径 |

本批截图与 embed 报告在 `logs/milestone15-batch3/`：published-catalog-three.png、published-catalog-gis.png、source-catalog-map-rejected.png、none-desktop.png、iframe-three.png、narrow-iframe-three.png、none-narrow-iframe.png、embed-qa.json。DEV 原功能截图在 `logs/milestone15-render/`，含 dev-source-catalog-rejected.png。命令日志为 `logs/m15-batch3-*.log`。全部测试只用合成数据和既有公开几何，外部请求与团队 API 请求为零。

## 私有对接文档与后续确认

新版另存于 `D:/Documents/ChatGPT/social-sim/独立场景Agent_与褚凌宇对接方案_2026-11-10_M15第三批.md`，正文不进入此公开仓库。只在该目录新建这份方案，没有修改 social-sim 代码；旧版保留。

- shaoyunhui：素材库和地图库拆分产物采用本批版本描述、原始字节及 manifest；完整 Linux 包依赖、版本目录、资源许可和测试环境挂载仍由后续拆分确认。
- 褚凌宇/后端负责人：scene_intent 名称映射、scene 注册/附属产物、正式读取权限和包装、地图任务队列、运行绑定与不可变正文保存都未接入。当前前端严格核对计划修订号；模型换绑造成修订变化的后端证明及消费适配需明确，不由前端猜。
- 吴贤或地图审核者：三栋食堂候选仍待人工核实；审核后才生成 v2。v1 不能严格安排餐饮门店。
- 当前显式文件入口用于本地核对，不自动读取远程 stages/scene，不代表地图库服务或管理员工具已获批准。默认无 SceneResult 的团队流程继续 legacy。
