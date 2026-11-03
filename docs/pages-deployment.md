# GitHub Pages 部署与公开检查

目标地址：https://nolimit112172.github.io/mecoffe-scene/ 。本轮只准备源码并在 feat/asset-library 本地提交，不修改仓库可见性、不启用远端 Pages、不合并、不 push。

## 本地与 Pages 两种模式

本地仍由原启动脚本、VS Code F5 和任务启动 127.0.0.1:5180，base 为 /，完整 349 项素材库保留。Pages 只发布沙盘及来源许可页，base 为 /mecoffe-scene/；旧 YuLan 后端管理界面不进入静态网站。

```powershell
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build:pages
npm --prefix frontend run check:pages
node scripts/serve-pages.cjs
```

静态模拟使用 5187，不占用/停止 5180。它只服务真实文件及目录 index.html，没有服务端 SPA 回退。页面提供真实的 mecoffe、mecoffe3d、mecoffe3d/assets、licenses 目录入口，查询参数经过目录跳转仍保留。未知路径使用 404.html 将原路径暂存后回到根页，由启动脚本恢复；Vue Router 使用 Vite base。已列出的入口不需要先收到 404 才能打开。

构建入口独立于本地的后端/管理依赖；数据、图集、模型和场景请求使用 BASE_URL。根地址转到三维校园。构建后扫描 JS/CSS/HTML/JSON，拒绝遗漏的根资源路径、内部文档 URL、个人绝对路径和常见凭据格式，超过 300 MB 时构建失败。Pages 不将本地 VITE_* 配置序列化进客户端；其显式公开前缀为 MECOFFE_PUBLIC_，base 由构建配置读取。

## 产物取舍

- 保留 2D/3D 共用 YuLan 图集、三种回放数据、OSM 地图、USTC/NUS 场景包和清单、Kenney 植被、9 个已验收 VALID 人物、来源与许可文件。
- 保留原始人物 FBX 字节与来源哈希，约65 MiB；地图可操作后才后台加载图集与可见人物，加载期间有进度。没有为压缩包体更换已验收的角色外观或骨骼。
- 完整 Rocketbox 约246 MiB、旧 img 约39 MiB 与未用 sounds 不进入 Pages。公开构建的目录同时去掉116个 Rocketbox 原型，剩233项；来源筛选也不再提供 Rocketbox。访问带 source=rocketbox 的旧收藏链接会回到可用的完整公开目录，不加载不存在的卡片。
- 本地仍是原完整目录，Rocketbox 文件未删除。所有源文件和素材许可保持原样。
- 构建打印产物总大小及最大的10个文件，机器可读值在 dist/site-size.json。MB 按1000000字节统计。

## 自动部署

.github/workflows/pages.yml 监听 main push 与 workflow_dispatch。流程为 npm ci → 前端测试 → 当前公开内容审计 → Pages 配置/构建/产物检查 → 官方 upload-pages-artifact 与 deploy-pages。部署 job 只允许 main，使用 github-pages 环境、pages:write 和 id-token:write；不需要自行配置密钥。

官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages 。本轮没有在 GitHub 运行工作流；只有确认合并、推送并完成仓库设置后，线上部署才会发生。

## 所有者的操作顺序

1. 先核对下方 Git 历史遗留项；本轮不能在“不改 main”的约束下擦除既有提交。
2. 验收后另行确认合并与推送；本轮不会执行。
3. GitHub 仓库 Settings → General → Danger Zone → Change repository visibility → Make public，按页面要求确认仓库名。
4. Settings → Pages → Build and deployment → Source 选 GitHub Actions。
5. main push 会自动部署；也可在 Actions → Publish MeCoffe Pages → Run workflow 选择 main。
6. 等 build 与 deploy 都成功，再打开站点。发布前的404不能当作应用部署失败；本轮尚未向该地址发布。

## 公开内容审计与历史边界

```powershell
node scripts/audit-public.cjs
node scripts/audit-public.cjs --history
```

只读审计扫描当前跟踪及未忽略文件，包括二进制中的字节字符串；报告只输出位置和类别，不回显潜在密钥。当前文件中的团队飞书链接已改为“团队飞书文档（内部）”；交付文档中的个人主目录路径已改为项目相对位置。未发现常见实际凭据值。

**既有 main 和 feature 的历史提交仍含旧内部文档链接，部分旧 feature 文档还含旧本机路径。修改当前文件不会删除 Git 对象中的原内容。** 原始链接本身不是访问凭据，但本任务要求不保留它，因此不能声称历史也已清理。按本轮禁止修改 main、禁止 push 的约束，没有重写历史；公开仓库前，需要所有者另行决定并授权历史清理。仅 squash 当前 feature 不能消除原本已在 main 中的那条链接。

需要彻底清理时，应先备份仓库，在独立镜像中用经过复核的历史过滤规则替换内部文档 URL 与个人主目录，再审计所有 refs，并由所有者确认更新远端及协作者迁移。此操作会改变提交号，属于下一次明确授权的操作；本轮不提供自动强推或在现有工作区执行的脚本。历史扫描结果存放在本地 logs/milestone7/public-audit.json，不含原链接值。

## 自测

node scripts/test-pages.cjs 使用已安装的 Playwright/Chrome（可通过 PLAYWRIGHT_MODULE 指定模块路径），在严格静态服务器下验证所有列出的地址直达与刷新、控件交互、人物/图集与数据加载、233项目录、来源许可全文、本地349项/Rocketbox入口仍可用。截图和 JSON 在 logs/milestone7/。

慢网是新的浏览器上下文、禁用缓存、下载1.6 Mbps/上传0.75 Mbps/延迟150ms。首屏可操作定义为地图 canvas、100人数据/KPI与可用播放控件就绪，点击能切为暂停；不冒充 Lighthouse TTI，也不把后台人物65 MiB全部下载完算进首屏时间。具体实测值见本轮交付记录。
