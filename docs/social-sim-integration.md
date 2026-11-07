# social-sim 配置期人物与关系预览

## 接入范围

配置的 network 阶段完成后，可以在三维校园和 GIS 中查看人物画像、初始关系及楼内人数。页面标注“配置预览 · 尚未运行模拟”。人物位置由显式规则或确定性规则分配，属于展示示意。所有事件、订单和在途人数均为零。

这一版本由 mecoffe-scene 提供静态子应用，团队负责把构建结果挂载在网站的 `/scene/`。预览读取团队已有的阶段接口，配置页可添加“查看三维场景”和“查看 GIS”入口。

## 数据与地址

```text
/scene/mecoffe3d?session=<session_id>&config=<config_id>
/scene/mecoffe-gis?session=<session_id>&config=<config_id>
```

子应用按同一组 `session_id` 和 `config_id` 读取两份产物。

```text
GET /api/sessions/{session_id}/configs/{config_id}/stages/network
GET /api/sessions/{session_id}/configs/{config_id}/stages/roles
```

两者都是 `StageDetail`，先检查 `status` 和 `payload`。network 的数据取 `payload.snapshot`，roles 的角色说明和属性标题取 `payload.population_request`。快照保留 `snapshot_id`、`snapshot_revision`、`seed`、`nodes` 和 `edges`。

远程接口使用相对 `/api` 地址及浏览器的同源 Cookie。前端不读取或保存登录令牌。401 显示登录失效，404 显示配置不存在或无访问权限，未完成阶段显示等待提示。团队继续在每份阶段产物接口执行会话和配置归属检查。

## 本地文件与示意分配

本地开发使用 `/mecoffe3d?preview=local` 或 `/mecoffe-gis?preview=local`，分别选择快照和角色准备文件。文件可采用原始 `snapshot.json`、`preparation.json` 格式，也可使用上述 StageDetail 响应格式。第三个“楼栋安置规则”文件为可选项。文件内容只保留在本次页面内存中。刷新后重新选择文件，两种视图之间切换则保留已载入的数据。

测试目录中的样例均为合成数据，人物名称明确写为“样例人物”。团队私有样例应留在原只读克隆，或放到被忽略的 `data/private/`。私有样例、真实验证截图和结果不提交到本仓库。

安置规则文件可分别指定角色和个体对应的 OSM 建筑 ID，个体规则优先于角色规则。以下只展示结构，实际键应取自本次快照，建筑 ID 应取自当前地图。

```json
{
  "roles": {"sample_role": "way/1435377501"},
  "entities": {"sample_entity_01": "way/1435377506"}
}
```

引用不存在的角色、人物或建筑会报错。没有显式规则时，程序按 `String(osm_id)` 的稳定字典序排列所有建筑，以 `seed + "|" + role` 的 UTF-8 字节计算 FNV-1a 32 位无符号哈希，然后对建筑数量取模。哈希初值为 `0x811c9dc5`，每个字节异或后乘以 `0x01000193`，逐次保留 32 位。seed 优先取调用方传入值，其次取快照 seed，缺省为 0。同一角色使用同一兜底楼栋，个体显式规则可将其中某人放到另一栋。算法不读取姓名、画像或性别来猜测住处，两种视图使用相同分配结果。

生成字段的中文名来自 `GeneratedField.title`，静态属性使用展示字典，缺少字典项时保留原 key。原始属性 key、值和关系类型均保留。

## 构建与地图

在 mecoffe-scene 根目录执行以下命令。

```sh
npm --prefix frontend ci
npm --prefix frontend run build:embed
```

输出目录是 `frontend/dist-embed/`，资源和路由基址为 `/scene/`。默认入口打开本地配置预览。三维、GIS、素材库和来源许可页都有真实的静态目录入口，刷新时可直接提供对应的 `index.html`。

嵌入构建采用显式允许列表，包含程序、必要素材和固定中科大地图。它排除旧运行轨迹、人物快照、规则演示、配置数据和按旧人物生成的素材卡片。地图单独放在 `mecoffe/config-map/`，manifest 对每份几何文件记录 SHA-256，浏览器按实际字节验证。开发服务器在相同相对地址提供这份地图。

素材许可与署名继续随构建提供，详见 `NOTICE.md` 和网站来源与许可页。构建产物已经被 Git 忽略，应在构建或部署流程中生成。

## 团队 Docker 挂载方案

团队当前 `compose.yaml` 将宿主端口映射到容器内的 Vite 前端，`/api` 由前端代理到 FastAPI。接入时需要让同一个前端入口提供 `/scene/` 子目录。

在团队的构建或部署步骤中，将 `dist-embed/` 的内容复制到静态文件目录的 `scene/` 子目录。若继续使用当前 Vite 服务，可以在启动前生成 `frontend/public/scene/`，确保该目录不提交 Git。使用带末尾斜杠的静态入口可直接命中已生成的目录首页，例如 `/scene/mecoffe3d/?session=...&config=...`。团队应验证实际服务器对无末尾斜杠地址的跳转，以及刷新后仍返回嵌入页。

若由 Nginx 承载统一入口，可把构建结果放在 `/srv/www/scene/`，示意配置如下。这里的路径由部署者按实际容器文件布局调整。

```nginx
location = /scene {
    return 308 /scene/$is_args$args;
}
location ~ ^/scene/(?:assets/|mecoffe/|licenses/.*\.(?:txt|md)$) {
    root /srv/www;
    try_files $uri =404;
}
location /scene/ {
    root /srv/www;
    try_files $uri $uri/ /scene/index.html;
}
location /api/ {
    proxy_pass http://backend:8002;
    proxy_set_header Host $host;
}
```

HTML 回退仅覆盖 `/scene/`，保持团队 React 应用的页面路由独立。JSON、模型和纹理缺失应返回 404，部署验收时需检查网络请求，避免将 HTML 回退误当成数据。

配置或结果文件由登录后的 API 返回，不复制到静态 `scene/` 目录。网站与 API 应使用相同协议、域名和端口。

## 页面入口与 iframe

配置页在 network 阶段完成后，取得当前会话和配置 ID，再拼接以下入口。参数值须使用 `encodeURIComponent`。

```html
<iframe
  title="人物与关系预览"
  src="/scene/mecoffe3d/?session=SESSION_ID&config=CONFIG_ID"
  style="width:100%;height:850px;border:0"
  allowfullscreen>
</iframe>
```

GIS 使用 `/scene/mecoffe-gis/`。iframe 内切换视图时保持相同的配置参数。也可用普通链接打开独立标签页。

服务器应允许同源嵌入，部署 CSP 需允许地图所需的 Worker 和纹理资源。若添加 iframe sandbox，需要允许脚本和同源能力，再验证 Cookie 请求、WebGL 与文件选择。外层与子应用之间若增加 `postMessage` 通信，双方应检查消息来源 origin。

## 联调验收

1. 合成样例在三维和 GIS 中人数、关系边数一致，原属性值未改变，事件与订单为零。
2. 选择楼内人物能够定位建筑，楼内名单和人数相符，关注线保持方向。
3. 同一账号能读取自己的配置，登录失效、未完成阶段和不可访问配置都有明确提示。
4. `/scene/` 子路径的三维与 GIS 可直接打开和刷新，素材请求成功。
5. 运行 `node scripts/audit-public.cjs`，确认当前文件和已存在的 Pages、embed 产物未混入私有配置。

运行回放接口和权威空间动作在后续阶段对接。
