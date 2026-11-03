# 里程碑 7 交付记录

日期：2026-11-04。分支：`feat/asset-library`。本轮单独本地提交，未 push、未改 main、未启用远端 Pages，5180 原服务保留。

目标网站：https://nolimit112172.github.io/mecoffe-scene/ （完成所有者设置与 main 部署后生效）。

## 实现

- Pages 独立入口与构建模式，base 为 `/mecoffe-scene/`；本地仍为 `/`，VS Code 配置和四个 F5 入口不变。
- 使用 history 路由，为已知入口生成真实目录 index.html，查询参数经目录跳转保留；另带 404.html 处理未知路径。根地址进入三维校园。
- 资源请求按 BASE_URL 处理；公开构建排除后端管理页面和本地 VITE_* 配置。构建后自动检查根资源路径、敏感内容与包体上限。
- main push / 手动工作流：npm ci、前端测试、公开扫描、构建、检查、官方 Pages 上传与部署。未执行线上工作流。
- 大人物模型按需后台加载，地图和回放控件先开放，保留加载进度；原始模型不转换，保留来源哈希和已验收外观。
- 来源与许可页及随站许可全文已补齐；现有回放、地图、映射、路径规则、示意提示和本地完整素材目录未更改。

## 测试与构建

| 命令/检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund`（复制 package/lock 到独立临时目录，避免影响运行中的服务） | 349 个依赖安装成功，lock 未修改 |
| `python -X utf8 -m unittest discover -s adapter -v` | 77 项通过 |
| `npm --prefix frontend test` | 196 项通过，0 失败/跳过，含原有 191 项和新增 5 项 |
| `npm --prefix frontend run build` | 通过 |
| `npm --prefix frontend run build:pages` | 通过 |
| `npm --prefix frontend run check:pages` | 通过 |
| `node scripts/audit-public.cjs --history` | 当前内容 0 发现；历史遗留见下文 |
| `node scripts/test-pages.cjs` | 9 组地址直达及刷新通过，含交互与模型/许可加载 |
| 本地 5180 四个 F5 目标地址浏览器 smoke | 4 个均 200，canvas 可见，无 pageerror；素材库仍有 Rocketbox，349 项保留 |

普通构建仍有 Vite 大 chunk 提示，不影响构建成功；Pages 按路由拆包并延后人物加载，没有改动本地原上游管理界面的依赖。

## 站点体积与慢网首屏

- 总计 **89,528,992 字节 / 89.53 MB**，357 个文件，含体积报告本身，低于 300 MB。MB 按 1,000,000 字节。
- 公开目录 233 项；本地 349 项。完整 Rocketbox 约 246 MiB、旧 img 约 39 MiB、未用 sounds 和未引用预览未随站打包。公开页面没有 Rocketbox 来源选项/卡片；旧 source=rocketbox 链接回退到可用目录。
- Chrome headless，1600×1000，新上下文/禁用缓存，下载 1.6 Mbps、上传 0.75 Mbps、延迟 150 ms：**16.05 秒**。定义：地图 canvas、100 人数据/KPI、播放控件可用，并验证点击切换到暂停。人物模型继续后台加载；这不是 Lighthouse TTI 或全部素材下载完成时间。

| 最大的 10 个文件（产物相对路径） | MB |
| --- | ---: |
| `mecoffe/assets3d/valid/Asian_F_2_Casual.fbx` | 10.97 |
| `mecoffe/assets3d/valid/Asian_F_2_Busi.fbx` | 9.62 |
| `mecoffe/assets3d/valid/Asian_F_1_Casual.fbx` | 7.24 |
| `mecoffe/assets3d/valid/Asian_M_2_Casual.fbx` | 7.11 |
| `mecoffe/assets3d/valid/Asian_M_3_Casual.fbx` | 7.08 |
| `mecoffe/assets3d/valid/Asian_M_1_Casual.fbx` | 6.97 |
| `mecoffe/assets3d/valid/Asian_M_1_Busi.fbx` | 6.72 |
| `mecoffe/assets3d/valid/Asian_M_2_Busi.fbx` | 6.60 |
| `mecoffe/assets3d/valid/Asian_F_1_Busi.fbx` | 5.84 |
| `assets/bgrd-1.png` | 3.63 |

## 严格静态托管自测

`scripts/serve-pages.cjs` 使用 5187，只提供真实文件和目录 index.html，没有服务端回退；随机不存在的地址确实返回 404。Browser 插件不可用，按前端调试技能使用现有 Playwright + Chrome。

以下 9 组全部先直接打开，再刷新；没有控制台错误、HTTP 404/错误请求或遗漏的根资源请求：

- `/mecoffe-scene/mecoffe3d`：通过。
- `/mecoffe-scene/mecoffe/`：通过。
- `/mecoffe-scene/mecoffe3d/`：通过。
- `/mecoffe-scene/mecoffe3d/assets/`：通过。
- `/mecoffe-scene/mecoffe3d/?campus=nus`：通过。
- `/mecoffe-scene/mecoffe3d/?scenario=ustc-history`：通过。
- `/mecoffe-scene/mecoffe3d/?scenario=nus-hourly`：通过。
- `/mecoffe-scene/mecoffe3d/assets/?source=rocketbox`：通过。
- `/mecoffe-scene/licenses/`：通过。

还检查了历史第 2 天行走、二维播放暂停、VALID 模型预览、NUS 小时切换、许可全文文件，以及本地 Rocketbox 入口。

截图和机器可读报告都在项目相对路径 `logs/milestone7/`（本机验收证据，不纳入 Git 或网站）：

- `root.png`、`2d.png`、`3d.png`、`assets.png`、`nus.png`、`ustc-scenario.png`、`nus-scenario.png`、`excluded-library.png`、`licenses.png`、`slow-network-interactive.png`。
- `pages-qa.json`、`local-smoke.json`、`public-audit.json`、`python-tests.txt`、`frontend-tests.txt`、`local-build.txt`、`build-pages.txt`、`check-pages.txt`、`npm-ci.txt`。

## 公开检查与已知边界

当前跟踪及未忽略文件（含二进制字符串）已扫描，内部飞书 URL、个人主目录绝对路径及常见凭据格式为 0 发现；另外扫描 JWT 和常见密钥赋值格式也无发现。指定同步文档只留下“团队飞书文档（内部）”文字；历史交付中的个人路径改为项目相对路径。未修改团队输入数据、原型源数据或素材许可。

**旧 main 历史中仍有内部飞书链接，旧 feature 历史还有本机路径。它们不是当前文件，但公开仓库会连同 Git 历史一起公开。** 禁止修改 main / 不重写历史的本轮约束下，不能消除这些旧 Git 对象；没有擅自做历史过滤或强推。仅 squash feature 也不能消除 main 已有链接。公开仓库前应由所有者另行复核并决定历史清理，具体边界见 `docs/pages-deployment.md`。不能把“当前扫描干净”当成“整个仓库历史干净”。

## 所有者在 GitHub 上的操作

1. 先处理上述历史遗留，验收后确认后续合并和推送。本轮未执行。
2. 仓库 Settings → General → Danger Zone → Change repository visibility → Make public，按 GitHub 要求确认。
3. Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
4. 本轮内容进入 main 并推送后会自动部署；也可 Actions → Publish MeCoffe Pages → Run workflow，分支选 main。无需自行提供密钥。
5. 等 build / deploy 成功，再打开目标网站。官方流程参考：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages 。

## 改动文件

共 33 个文件；没有改 package-lock、数据、映射、寻路输入、VS Code 配置或 main。

- `.github/workflows/pages.yml`
- `NOTICE.md`
- `README.md`
- `docs/milestone7-delivery.md`
- `docs/pages-deployment.md`
- `docs/phase1-delivery.md`
- `docs/rocketbox-library.md`
- `docs/source-sync-20261102.md`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/pages/build-tools.mjs`
- `frontend/pages/check-dist.mjs`
- `frontend/pages/pages-plugin.mjs`
- `frontend/public/favicon.svg`
- `frontend/src/App.vue`
- `frontend/src/PagesApp.vue`
- `frontend/src/mecoffe/Campus3DRealCharacters.js`
- `frontend/src/mecoffe/Campus3DScene.js`
- `frontend/src/mecoffe/CampusScene.js`
- `frontend/src/mecoffe/publicUrl.js`
- `frontend/src/mecoffe/rocketboxCharacterModel.js`
- `frontend/src/pages-main.js`
- `frontend/src/router/index.js`
- `frontend/src/router/pages.js`
- `frontend/src/views/AssetLibrary.vue`
- `frontend/src/views/MeCoffe3D.vue`
- `frontend/src/views/MeCoffeScene.vue`
- `frontend/src/views/SourceLicenses.vue`
- `frontend/tests/pages.test.js`
- `frontend/vite.config.js`
- `scripts/audit-public.cjs`
- `scripts/serve-pages.cjs`
- `scripts/test-pages.cjs`
