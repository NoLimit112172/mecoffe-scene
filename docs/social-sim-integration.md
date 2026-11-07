# social-sim 场景接入：配置预览与运行回放

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

本地开发使用 `/mecoffe3d?preview=local` 或 `/mecoffe-gis?preview=local`。一次选择多个 JSON、拖入文件或导入一个 zip，程序按内容识别快照、角色准备信息和可选楼栋安置规则，不要求文件名。支持原始 `snapshot.json`、`preparation.json` 和上述 StageDetail 响应结构。只有快照必需，缺少角色准备信息时属性名显示原始 key。也可点击“加载合成样例”，直接查看仓库内明确标注的合成人物。

这是开发调试入口；从团队网站打开时数据自动读取，不需要导入。文件内容只保留在本次页面内存中。刷新后重新选择文件，两种视图之间切换则保留已载入的数据。

测试目录中的样例均为合成数据，人物名称明确写为“样例人物”。团队私有样例应留在原只读克隆，或放到被忽略的 `data/private/`。私有样例、真实验证截图和结果不提交到本仓库。

安置规则文件可分别指定角色和个体对应的 OSM 建筑 ID，个体规则优先于角色规则。以下只展示结构，实际键应取自本次快照，建筑 ID 应取自当前地图。

```json
{
  "roles": {"sample_role": "way/1435377501"},
  "entities": {"sample_entity_01": "way/1435377506"}
}
```

引用不存在的角色、人物或建筑会报错。没有显式规则时，程序按 `String(osm_id)` 的稳定字典序排列所有建筑，以 `seed + "|" + role` 的 UTF-8 字节计算 FNV-1a 32 位无符号哈希，然后对建筑数量取模。哈希初值为 `0x811c9dc5`，每个字节异或后乘以 `0x01000193`，逐次保留 32 位。seed 优先取调用方传入值，其次取快照 seed，缺省为 0。同一角色使用同一兜底楼栋，个体显式规则可将其中某人放到另一栋。算法不读取姓名、画像或性别来猜测住处，两种视图使用相同分配结果。

生成字段的中文名来自 `GeneratedField.title`，静态属性使用展示字典。性别、年龄段、学历、收入组等含义明确的取值也使用中文显示；缺少字典项时保留原 key 或原值。“数据详情”保留原始属性 key、值，显示翻译不改写画像或关系。

## 构建与地图

在 mecoffe-scene 根目录执行以下命令。

```sh
npm --prefix frontend ci
npm --prefix frontend run build:embed
```

输出目录是 `frontend/dist-embed/`，资源和路由基址为 `/scene/`。无参数打开 `/scene/` 时显示团队网站接入说明，本地文件导入收在折叠的“开发者调试”中。带 `session + config` 或 `session + run` 参数时不显示导入面板。三维、GIS、素材库和来源许可页都有真实的静态目录入口，刷新时可直接提供对应的 `index.html`。

嵌入构建采用显式允许列表，包含程序、必要素材和固定中科大地图。它排除旧运行轨迹、真实人物快照、规则演示、配置数据和按旧人物生成的素材卡片；仅保留用于一键体验的明确合成样例。团队私有数据不得复制进构建目录。地图单独放在 `mecoffe/config-map/`，manifest 对每份几何文件记录 SHA-256，浏览器按实际字节验证。开发服务器在相同相对地址提供这份地图。

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

## 运行回放（草案，待 Alemax067 确认）

这一轮提供前端数据源、通用转换和 mock 验证，不修改 social-sim 后端。接口路径须由 Alemax067 确认后联调。没有真实终态轨迹时使用合成的团队格式轨迹，不把合成活动显示为真实 OASIS 结果。

入口参数与配置预览分开；两种视图切换时保留同一组会话、运行参数。

```text
/scene/mecoffe3d/?session=<session_id>&run=<run_id>
/scene/mecoffe-gis/?session=<session_id>&run=<run_id>
```

子应用依次读取以下数据。

| 顺序 | 接口 | 用途与归属 |
| --- | --- | --- |
| 1 | `GET /api/sessions/{session_id}/runs/{run_id}` | 已有接口。取得运行状态及本次运行的 `config_id`，不能用配置页当前选中的版本替代。 |
| 2 | `GET /api/sessions/{session_id}/runs/{run_id}/artifacts/trajectory` | 待团队实现。返回该次终态运行导出的 `trajectory.json` 原文。 |
| 3 | `GET /api/sessions/{session_id}/runs/{run_id}/artifacts/population-snapshot` | 待团队实现。返回该次运行冻结时使用的快照，不能读取后来被重新生成的 network 快照。 |
| 4 | `GET /api/sessions/{session_id}/configs/{config_id}/stages/plan` | 已有接口。读取 `StageDetail.payload` 中的计划，取得品牌、商品及具体经营者的绑定。 |

两个新接口均为只读：沿用团队登录、会话归属和运行归属检查，执行顺序是确认当前用户可访问会话，再确认运行属于该会话。后端只允许读取指定运行的已登记产物，不接收客户端文件路径，不开放整个运行目录。轨迹接口仅在运行终态开放；还在排队或执行时返回明确的未就绪信息。冻结快照必须来自该次运行实际使用的冻结版本。响应使用 JSON，保留原始字段和值。

前端在处理运行详情后，才请求对应终态产物；401 显示登录失效，404 显示运行或产物不存在/无访问权限。失败运行若存在有效终态轨迹且 `partial: true`，允许回放已有部分并明确显示不完整；没有可回放轨迹时说明原因。禁止拿另一次运行或另一个配置的数据填空。

转换前严格校验轨迹 `metadata.snapshot_id`、`metadata.snapshot_revision` 与冻结快照一致，并校验计划的人口引用和 `plan_id`。发现不一致即报错。人物以 `entity_id` 关联；门店以 `brand_id → owner_entity_id → 经营者示意楼栋` 关联。广告通过发起者实体找到品牌，调价通过商品及经营者找到品牌，不假设 `brand_id` 等于人物 ID。金额仍是整数分。

任意角色沿用配置预览的显式安置规则和 FNV-1a 种子兜底规则；运行回放优先采用 `plan.runtime.seed`，缺省再取快照 seed 或 0。楼栋、入口、行走路线继续是展示示意，OASIS 没有位置数据。显示层不向引擎写位置，不让配置期管理员工具代替模拟人物动作。

动作 `outcome` 单独处理：`executed` 才能进入成功动作路径；`failed`、`declined`、`unknown` 保留为各自状态的事件。被拒或结果未知的购买不增加订单、不产生取杯动画；未知发帖不作为成功帖子。终态 `objects` 是审计对象，不能直接当成所有人物在时间轴起点就知道的信息。

命令行转换可用以下可选参数启用同样的通用角色和品牌映射；不带 `--plan` 的旧历史数据路径保持原样。

```sh
python -m adapter.oasis_to_scene --trajectory trajectory.json --snapshot snapshot.json --campus campus.json --plan plan.json --output scene.json
```

Python 调用方还可传入 `population_request` 和 `placement_rules` 以提供字段中文名及显式安置规则。所有输入须来自同次运行，转换器不负责访问数据库或发起远程请求。

### 运行回放联调验收

1. 用合成样例验证非 MeCoffe 角色、品牌 ID 与人物 ID 不同、多家门店均可显示；三维和 GIS 的人数、关系、订单与输入一致。
2. mock 验证运行中、失败且有部分轨迹、401、404，以及快照 ID 或 revision 不一致时的提示；没有完整输入时不展示另一次结果。
3. 团队实现两个产物接口后，提供一份允许本地验证的终态运行；用其冻结快照和计划验证同一次运行的完整数据链。真实团队数据和截图只留本地，不进入公开仓库及 Pages/embed 产物。
4. 在登录的团队页面内打开 iframe，并刷新 `/scene/mecoffe3d/`、`/scene/mecoffe-gis/`，检查 Cookie、资源路径、切换参数和会话权限。

权威空间状态、人物自主移动动作和环境反馈闭环仍留待后续阶段讨论。
