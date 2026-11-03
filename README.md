# MeCoffe 校园场景沙盘

默认打开基于团队最新人物关系快照（目前 revision 3）的动态演示：100 个主体、530 条有向关注，支持 30 个展示日的播放、暂停、逐条推进、走到门店和互动气泡。顶部还可查看静态关系网络或原始 OASIS 历史运行回放。前端基于 [YuLan-OneSim](https://github.com/RUC-GSAI/YuLan-OneSim) 的 Vue + PixiJS 前端和美术素材改造，**不调用模型**。

“新版演示”使用明确的脚本规则，供检查场景、动画和接口，不是新一轮 OASIS 实验结果。演示价格、概率、抽样和每日购买上限在 `scene/demo.json` 中公开配置；不得据此报告销量预测或消费者偏好变化。

## 在 VS Code 里运行

源码仓库：<https://github.com/NoLimit112172/mecoffe-scene>（私有，包含运行所需的团队输入和美术素材，不做公开网站部署）。首次在另一台电脑使用时：

```powershell
git clone https://github.com/NoLimit112172/mecoffe-scene.git
```

安装 Node.js（建议 22 或 24）、Python 3.9+ 和 Google Chrome。Python 适配器只用标准库；前端测试也会检查 VS Code 配置。首次缺少前端依赖时，启动和前端任务会按 `package-lock.json` 自动执行 `npm ci`，需要网络。

用 VS Code 的“文件 → 从文件打开工作区”打开 `mecoffe-scene.code-workspace`，或直接打开本文件夹。扩展面板中的“工作区推荐”提供 **Vue - Official（Vue.volar）**、**Python**、**Pylance**；Chrome 调试由 VS Code 内置 JavaScript 调试器提供。工作区搜索默认排除依赖、构建产物、原始大数据和派生校园 JSON；文件仍在磁盘上，可直接打开。

在左侧“运行和调试”的下拉框选择入口，再按 **F5**。四个入口按以下顺序排列，共用启动任务：自动启动或复用本项目的 **5180** 服务，校验就绪后打开相应 Chrome 调试页。

| F5 启动项 | 页面 |
| --- | --- |
| **MeCoffe：二维校园沙盘** | <http://127.0.0.1:5180/mecoffe> |
| **MeCoffe：三维校园沙盘** | <http://127.0.0.1:5180/mecoffe3d> |
| **MeCoffe：三维素材库** | <http://127.0.0.1:5180/mecoffe3d/assets> |
| **MeCoffe：NUS 建模预览** | <http://127.0.0.1:5180/mecoffe3d?campus=nus> |

NUS 入口只预览通用流水线生成的地图，没有模拟数据。三维人物与场景外观已按里程碑 5 更新，三种回放模式及二维页面保持原有行为。停止调试不会停止后台开发服务，下次 F5 会复用它。

不用调试器时，双击 `start-mecoffe.cmd`，或在项目根目录终端运行：

```powershell
.\start-mecoffe.ps1            # 启动并打开浏览器
.\start-mecoffe.ps1 -NoBrowser # 只启动服务
.\start-mecoffe.ps1 -Rebuild   # 先重新生成场景数据
.\start-mecoffe.ps1 -Port 5181 -NoBrowser # 可选其他端口；F5 入口固定为 5180
```

脚本就绪后打印全部四个地址；不带 `-NoBrowser` 时仍只自动打开二维页面。每次仍完整生成并校验数据，内容一致时保留原文件，避免重复替换引起 Windows 文件占用错误；输入变化时发布新结果。服务在后台运行，日志在 `logs/`。默认端口 5180 被其他项目占用时，脚本报错退出并保留现有进程。

也可以在 `frontend/` 终端运行 `npm run dev`，会自动打开同一个新版演示页面。该项目默认固定使用 5180，访问首页 `/` 也会跳到 `/mecoffe`。MeCoffe 三种展示模式都不需要另开后端或填写 API 密钥；`frontend/.env.example` 仅保留可选配置说明。

### 常用任务

按 **Ctrl+Shift+P → 任务: 运行任务（Tasks: Run Task）**，选择以下任务。所有任务以项目根目录为基准；前端测试和构建脚本自动进入 `frontend/`。Python 任务使用终端 PATH 中的 `python`；安装后需重开 VS Code，终端可用 `python --version`、`node --version` 验证。

| 任务 | 作用 |
| --- | --- |
| **MeCoffe：启动场景服务** | 只启动/复用服务，打印四个页面地址 |
| **MeCoffe：生成地图场景（OSM 范围）** | 交互输入新地图 ID、标题和四边经纬度，下载 OSM 并生成地图 |
| **MeCoffe：生成地图场景（GeoJSON 文件）** | 输入文件路径、新地图 ID 和标题，生成调用方地图 |
| **MeCoffe：重建中科大场景** | 从已保存 OSM 使用 `--profile ustc_legacy` 重建到 `campuses/ustc/`，原校园数据和映射保持不变 |
| **MeCoffe：重建素材库目录** | 执行 `adapter/build_asset_catalog.py`，重建目录和缩略图 |
| **MeCoffe：重新生成场景数据** | 从原始 OASIS 轨迹生成历史回放 |
| **MeCoffe：重新生成新版网络** | 从最新快照生成静态关系网络 |
| **MeCoffe：重新生成新版演示** | 重建可复现的规则演示 |
| **MeCoffe：运行全部测试** | 依次运行 Python、前端测试；前一步失败即停止，包含配置路径检查 |
| **MeCoffe：运行 Python 测试** | 单独运行全部 Python 适配器测试 |
| **MeCoffe：运行前端测试** | 单独运行 `npm test` |
| **MeCoffe：构建前端** | 执行 `npm run build`，输出到 `frontend/dist/`；也是 **Ctrl+Shift+B** 的默认构建任务 |

### 用自己的地图生成新校园

1. 选一个**新的地图 ID**，如 `my-campus`：以英文字母或数字开头，仅用英文字母、数字、下划线或连字符，最长 64 个字符。不要填路径、中文或空格。重复 ID 会重建同目录，请勿用 `nus`、`ustc` 覆盖已验收示例。任务输入框给出格式提示，不会自动修正 ID。
2. 使用 OSM 时，运行 **生成地图场景（OSM 范围）**，依次填写标题和 **最小经度、最小纬度、最大经度、最大纬度**（西、南、东、北），使用 WGS84。默认范围是 NUS 校园内约百米的小块，适合首次验证，可替换为自己的校园；现成 NUS 预览仍保留完整的已验收范围。下载仅访问 OSM 官方 API；原始 XML、下载时间与 SHA-256 存到 `data/osm/<id>.*`。下载速度取决于网络与范围，超大范围会被校验拒绝。
3. 使用 GeoJSON 时，运行 **生成地图场景（GeoJSON 文件）**。填写本地文件的绝对路径或相对项目根目录的路径；**含空格也不用手动加引号**。文件应为 WGS84 `[经度, 纬度]` 的 `FeatureCollection`，包含建筑 Polygon、道路 LineString 等要素，格式和示例见 [地图输入草案](docs/map-input-contract.md)。
4. 成功后，五个场景文件写入 `frontend/public/mecoffe/campuses/<id>/`。用任一 F5 入口启动服务，再访问 `http://127.0.0.1:5180/mecoffe3d?campus=<id>`；例如 <http://127.0.0.1:5180/mecoffe3d?campus=my-campus>。重新生成后刷新即可，无需重启服务。只有地图和素材原型分配，不会自动生成 agent、订单或 OASIS 结果。

中科大兼容重建的独立预览地址为 <http://127.0.0.1:5180/mecoffe3d?campus=ustc>；原有 `/mecoffe3d` 继续使用原数据展示完整沙盘。

若启动或任务失败，先查看任务终端和 `logs/`，其中会说明解释器、依赖、数据或端口问题；输入路径/范围错误时按终端提示修正再运行。代码不包含本机依赖、构建产物、日志、备份或个人 `.claude/` 配置。里程碑 4 验证见 [VS Code 配置交付记录](docs/vscode-project-delivery.md)。

## 页面能看什么

- **新版演示（默认）**：使用 revision 3 人物与关系，加上可复现的演示规则，播放广告、购买、晒单与评论。广告只向真实关注该商家的消费者展示，晒单讨论沿新版关注关系传播；购买可触发走路去门店。统计明确标注为演示订单与演示金额。支持播放/暂停、下一条、按天回退或跳转、倍速和重播。
- **关系网络**：静态查看最新快照中的人物与 530 条关系。点击地图或名册中的人物，显示其关注与被关注对象，地图箭头标出方向。网络统计为输入关系数量，不冒充已执行的关注动作。
- **历史回放**：顶部切换后加载原始 OASIS 运行记录，保留事件动画、销量指标和回放控制。切换模式会重建场景，不会将历史事件叠加在新版网络上。
- **地图与楼栋**：8 个示意地点、6 栋有人的楼（教学楼、图书馆、研究生公寓、两栋本科生宿舍、教工楼）和两家咖啡店。消费者按 `campus.json` 的 `occupancy` 比例分进各楼：本科生在两栋宿舍和教学楼，研究生在公寓和图书馆，教师在教工楼和教学楼；商家站在自家店门口。楼顶牌子显示楼内 / 外出人数和这栋楼累计买了几杯。外观由人物编号决定，每次打开都一样。
- **看楼里面**：鼠标停在楼上，显示 YuLan 风格的每层室内剖面、家具和站在各层的人，旁边弹出楼内人员卡片（谁在楼里、谁出门买咖啡、各买了几杯，点名字可选中）。选中某人时会固定显示他所在的楼，卡片右上角可收起。
- **事件动画**：发帖、评论、访谈用 YuLan 的气泡图标，从这个人所在楼层的窗口冒出来；评论和关注会连线到对方所在楼层；投放广告是门店光圈；广告进入某人信息流是门店到这个人的细线；动作失败是红色标签。
- **购买时走到门店**：某人当天下单，就从所在楼的楼门出来、沿主路走到这家咖啡店的柜台，到店时弹出金额、门店闪一下、杯数 +1，停一会儿再原路走回楼里；同一人连续几天下单会依次出发。路线由 `src/mecoffe/layout.js` 按 `campus.json` 的 `access` / `counter` 计算，全程横平竖直、不穿过建筑。地图右上角可关掉，改为连线表示。**这是展示层动画**：模拟里只有“这一天下了一单”，没有行走路线或到店时间。
- **指标**：订单与杯数、成交额、帖子与评论、失败动作、广告**实际返回**的人数（按人去重，分品牌）。
- **右侧面板**：人物资料（偏好、预算、性格、购买策略）、截至当前的购买与行为记录；事件流；可搜索、按角色筛选的名册。
- **回放控制**：播放 / 暂停、下一条事件、上一天 / 下一天、0.5×–4× 速度、按天拖动；底部是逐日分品牌成交柱状图，只画到当前时间点。

## 数据怎么来

动态演示、静态网络与历史回放分别生成、分别加载：

```text
data/source/population_snapshot.latest.json   最新人物与关系（目前 revision 3）
scene/campus.json + scene/demo.json           校园布局与显式演示规则
        │  adapter/build_demo.py             不读取旧运行轨迹
        ▼
frontend/public/mecoffe/latest-demo.json      默认动态演示（规则脚本）
```

```text
data/source/population_snapshot.latest.json   最新人物与关系（目前 revision 3）
scene/campus.json                            示意校园地点配置
        │  adapter/snapshot_to_scene.py
        ▼
frontend/public/mecoffe/latest-network.json   静态关系网络
```

```text
data/source/trajectory.json            OASIS 交互轨迹（团队运行导出）
data/source/population_snapshot.json   同一次运行的人口快照
scene/campus.json                      校园地点配置（本模块产出）
        │  adapter/oasis_to_scene.py
        ▼
frontend/public/mecoffe/scene.json     前端读取的场景数据
        │  src/mecoffe/replay.js        回放状态（纯函数）
        ▼
src/views/MeCoffeScene.vue + src/mecoffe/CampusScene.js
```

换一次运行的数据：把新的 `trajectory.json` 和**同一次运行的** `population_snapshot.json` 放进 `data/source/`，然后运行 VS Code 任务 **MeCoffe：重新生成场景数据**（或 `python -X utf8 adapter/oasis_to_scene.py`），刷新页面即可。也可以用 `--trajectory`、`--snapshot`、`--campus`、`--output` 指定路径。

更新默认网络：替换 `data/source/population_snapshot.latest.json`，运行 VS Code 任务 **MeCoffe：重新生成新版网络**（或 `python -X utf8 adapter/snapshot_to_scene.py`）后刷新。正常启动也会自动重建新版网络。

更新动态演示：运行 VS Code 任务 **MeCoffe：重新生成新版演示**（或 `python -X utf8 adapter/build_demo.py`）后刷新。正常启动会同时生成静态网络和动态演示。更改 `scene/demo.json` 可调整展示规则；相同输入、配置与 seed 生成相同事件，不调用模型或产生真实支付。

适配器会核对并在不一致时直接报错：轨迹和快照必须是同一个 `snapshot_id` 与版本；运行中的人物必须和快照名册完全一致；每笔订单按 `order_id` 去重，并与轨迹里的订单表逐一对上；角色和品牌必须在 `campus.json` 里有对应地点。

## 统计口径

- **新版演示**：人物和关系来自最新快照，行为为规则脚本；订单、金额和传播结果均为演示统计。30 天表示展示脚本的长度，不表示 OASIS 已完成 30 天。
- **历史回放**：以下审计、广告返回、失败动作等口径对应原始运行记录。
- 一天内的先后按审计记录顺序（`audit_line`）排列，这是完成顺序，不代表因果。
- “广告实际返回人数”只统计信息流里真的返回过广告帖的人；广告的定向名单不算触达。
- `do_nothing`（未操作）不做动画，只在进度条旁显示当天次数。
- 动作失败单独计数，不算作评论或订单。
- 回退或拖动进度时，状态从头重算，不会沿用之后的数据。

## 历史回放的限制（仅历史模式）

这次运行（`run_956ac9fb…`）状态为 `failed`：完整完成 23/30 天，第 24 天只有部分记录。只有第 1 天的基线访谈，第 30 天的后测访谈没有执行，所以暂时不能做“偏好前后对照”。

### 2026-11-02 共享仓库同步核对

团队已采用 [social-sim 共享仓库](https://github.com/Alemax067/social-sim) 集成各模块，首轮通过 JSON 文件交接。本目录仍是独立的场景回放模块，端口为 5180。

当前共享仓库的人物网络模块已提供 **revision 3：100 人、530 条有向关注**；100 人的画像字段和值未变，关系网络重新生成。与历史回放使用的 revision 2（346 条关注、2 条竞争）相比，新增 502 条、移除 320 条、保留 28 条，不能简单解释为追加 182 条关注。**默认动态演示和静态网络均实际采用新版快照。**

OASIS 样例计划仍绑定 revision 2，当前共享仓库没有新版关系网络的配套轨迹。引擎 README 说明第 24 轮整阶段误套单动作超时的问题已修正，但该 100 人用例尚未重新完成 30 轮验证。默认地图和关系已更新为 revision 3；人物行为和销量可切到历史模式查看，继续对应原始运行。

- 历史模式通过 `frontend/public/mecoffe/sync-status.json` 展示两版输入的区别及来源；只有与当前回放的运行 ID、快照 ID、快照摘要匹配时才显示。
- 正在使用的新版快照为 `data/source/population_snapshot.latest.json`；对照文件和来源摘要保存在 `data/pending/20261102/`。原历史运行输入仍保留在原路径。
- 详细核对与后续交接见 [同步核对记录](docs/source-sync-20261102.md)。本机 `data/pending/` 的原始文档核对副本不上传到源码仓库。
- 原输入、原场景数据和此次修改前的页面、README 备份在 `backups/20261102-before-source-sync/`。

后续为新版网络生成行为轨迹时，管理员需按协议更新计划的快照版本引用，重新运行。拿到同一运行的 `trajectory.json` 和 revision 3 快照后，再重建历史回放数据；不应手改旧运行的版本号或补造第 25～30 天数据。

## 地点为什么只是示意

当前 OASIS 引擎没有位置概念（运行计划写明“社会环境库未接入”“不模拟移动”），所以谁在哪栋楼、去门店怎么走，都只是展示层的安排，不影响谁看到什么、谁买什么。楼栋分配可以在 `campus.json` 的 `occupancy` 里改比例，改完重新生成场景数据即可。`scene/campus.json` 已经给每个地点定义了 `location_id`、类型、范围和默认角色；以后要让地点影响行为时，可以直接把它作为后端的地点层：每天按“所在地点”生成曝光事件，再注入 OASIS。

## 阶段 1：中科大高新校区三维体块

打开 <http://127.0.0.1:5180/mecoffe3d>。原 `/mecoffe` 页面仍按原方式运行，启动脚本与 5180 开发服务不变。新页面使用 Three.js（唯一新增依赖，锁定 `0.187.0`），支持旋转、缩放、平移、悬停楼名、人物选择、播放/暂停、逐条与按天跳转。三种数据模式分别加载原来的 `scene.json`、`latest-network.json` 和 `latest-demo.json`，共享 `replay.js` 的统计与事件游标。

地图仅来自 OpenStreetMap，校园边界使用 [relation 14093671](https://www.openstreetmap.org/relation/14093671)，原始 XML 保存在 `data/osm/ustc_gaoxin.osm`。同目录元数据记录实际下载时间、URL 和摘要；派生数据为 `scene/campus3d.json`，八个示意地点的楼栋对应关系与选择理由为 `scene/campus3d_mapping.json`。OSM 数据许可为 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)，详见 [NOTICE.md](NOTICE.md)。页面离线读取这些已保存的数据，不加载地图瓦片。

本次快照下载于 `2026-11-03T05:01:24.973987+00:00`：31 栋建筑（30 栋有 OSM 名称）、57 条原始 highway ways；仅保留下载范围内连续原始节点后，页面绘制 50 段道路。步行图有 195 个节点、234 条边，保留两个连通分量；八个示意地点的最近道路节点都在主分量内，六个住处到两个门店共 12 条路径已验证可达。校园关系由两片独立外边界与一个内孔构成，`boundary_polygons` 完整保留它们，不强行拼接。

重新生成（在仓库根目录）：

```powershell
# 从已保存的 OSM 原始数据重新生成，通常只需这一步
python -X utf8 adapter/osm_to_campus3d.py

# 需要刷新 OSM 快照时才重新下载；会更新下载元数据
python -X utf8 adapter/osm_to_campus3d.py --download

python -X utf8 -m unittest discover -s adapter
cd frontend
npm ci
npm test
npm run build
```

转换脚本只使用 Python 标准库。经纬度以校园中心为原点，按等距矩形投影转换为东/北方向的米，公式和原点写入场景 JSON。道路相邻 OSM 节点生成带实际投影长度的无向步行图；住所与门店的原始 A* 路径保持不变，返回使用其反向节点序列。里程碑 5 在独立显示副本上增加分道、建筑避让及等候，不把这些显示折线加入 OSM 图。楼门到道路节点的接入、人物所在楼栋与门店配置均为展示层安排。

页面将同一个人的多笔订单依次排队，重复订单不会再次触发行走；暂停会冻结行走，拖动时间轴或按天跳转会清除未完成动画并恢复示意站位。时间轴到末尾后，已出发的人物继续返回；随后可从头播放。选中人物可查看其关注关系和截至当前的行为记录。动画速度是回放速度，不是实际步行速度。

三维全景按校园范围和楼顶适配；底部现在为有厚度的分层沙盘，另留校外道路与收边的显示余量。初始全景会随画布大小调整；手动旋转、平移或缩放后保留用户视角，“全景”按钮可重新适配。所有人物最小屏幕高度统一为 12 CSS 像素，行走时有浅色光圈。为给放大后的完整人物留出空间，相机改变时可重新排布**显示位置**；固定相机下的动画不会为此重排。原始 A*、人物关系、订单和地图数据不变。默认只显示八个映射楼栋的标签，字号固定 12px，并做重叠避让；其他楼栋通过悬停查看名称。

已知限制：OSM 不提供该批楼栋的楼层与高度，体块使用默认楼层和层高并标明来源；轮廓与道路仅代表下载时的 OSM 覆盖，未登记或后来建设的楼可能缺失。八个地点都是 `illustrative: true` 的人工对应，尤其咖啡店不代表真实店址；OASIS 没有位置数据，人物路线与动画速度不参与模拟，也不应解释为实地可通行性或到店时间。这里仅按 OSM 步行拓扑展示路线，不含室内、门禁、坡度、导航网格或精细模型。

新版演示仍是 v3 网络的 30 天规则脚本，**不是 OASIS 运行结果**；关系网络仅展示静态关注输入，不产生订单；历史回放仍对应原始失败运行（23/30 天完整，第 24 天部分记录），没有补造后续天数。

## 三维视觉版

`/mecoffe3d` 增加程序生成的楼面窗户、屋顶边缘、两家示意门店招牌与遮阳棚，以及树木、路灯、长椅和草地纹理。环境装饰均在图例注明，建筑轮廓、高度默认值、八个地点映射和原步行图不变。原始 OSM 快照里的八块运动场与永怀湖另存为独立显示图层，不更新已有场景数据。

人物当前默认使用**立体 YuLan**：按原二维人物的图集组合取样肤色、发色、上衣、裤子和鞋色，再用完整的头发、头、躯干、四肢与鞋建模；侧面和背面同样有实体结构。五官使用原 YuLan 贴图，保留最近邻过滤。另可切换“像素贴图 / 体素”；旧版低多边形人物保留为素材库备选。角色脚下颜色标识身份，上衣颜色来自对应源角色，不强制全部按身份换色。只显示少量站立代表与正在行走/选中的人物，楼顶徽标显示相应楼栋的示意人数。点击“人物特写”可放大当前行人或选中人物。

右上角“日夜循环”按每个回放日的小数进度改变**展示光照**，并非 OASIS 的真实时间、天气或作息；暂停时光照与动作保持不变。可用“光照预览”固定正午、傍晚或夜晚。夜里固定种子的部分窗户亮灯；发帖气泡、评论/关注弧线、广告光束/粒子和到店收据仅表示已有事件。高画质开启阴影、装饰树和选择性辉光，低画质关闭这三项。

建筑、环境装饰、事件特效和人物几何为程序生成；默认人物的配色和五官参考仓库已有 YuLan 组合，YuLan 楼房立面与可选像素/体素模式也复用这些图集，不另行下载模型或贴图。详见 `NOTICE.md` 和 `frontend/public/mecoffe/assets3d/README.md`。

```powershell
# 只从已保存的 OSM 快照生成新增的运动场/水面显示图层
python -X utf8 adapter/osm_landcover.py
```

现有 `campus3d.json`、地点映射、步行图、三种模式的数据与 `/mecoffe` 二维页面不受上述命令影响。截图与验收记录见 `docs/campus3d-visual-delivery.md`。

## 像素人物、建成区取景与周边马路

可选的“像素贴图”人物直接使用 `frontend/public/assets/bgrd-0..2.json/png`，与二维页面复用 `layout.hashOf`、性别/服装变体和头部组合规则。三维中使用脚底锚定、始终朝向镜头的 Sprite，行走播放图集原三帧（10.8 fps），按运动在镜头中的左右方向翻转。站立固定第一帧，暂停冻结动作，角色贴图使用最近邻过滤。默认“立体 YuLan”改用分部件动画及手持咖啡杯，像素模式保留杯子标记。风格切换不重放事件或改变订单统计。

**东侧未建设用地不在展示范围内。** 裁剪只在显示层进行：所有楼栋和既有十二条映射住所到门店的 A* 路线构成核心，四周留 50 米；原边界中无楼栋的独立空地不绘制，与建成区无关的小路按窗口截断。草地、边界虚线、地表图层与装饰物都使用展示副本，原 `scene/campus3d.json`、原始 OSM 边界、楼高和步行图未修改。全景相机另留约 60 米观察周边道路，不把下载范围扩成大片草地。

周边道路另存为 `data/osm/ustc_gaoxin_surroundings.osm`，使用 OSM 官方 map API，原下载范围四边外扩约 300 米。`ustc_gaoxin_surroundings.metadata.json` 保留实际 URL、UTC 时间、bbox 与原始 XML 的 SHA-256；`frontend/public/mecoffe/campus3d_surroundings.json` 使用原校园投影，只提取道路信息，不含新的寻路图。显示中只保留建成区附近的校外道路段，按 `highway`、`lanes` 和 `oneway` 绘制沥青、车道线、人行道与路缘。车道宽度及缺失车道数为展示默认值，不能当作实测交通设施；OSM 明确 `tunnel` 的地下段只画淡虚线，不虚构地面人行道。

此次下载实际有名道路为：**中颍南支路、习友路、创新大道、华佗巷、复兴路、梅岭巷、燕子河路、石莲南路**。当前校园附近显示四个路牌：**习友路、石莲南路、复兴路、创新大道**，取自 OSM 原 `name` 字段，每条路一个固定 12px 标签；无名道路不标。校外道路仅用于显示，**不加入人物 A* 步行图**，也不参与 OASIS 决策。

```powershell
# 需要刷新周边道路时才重新下载（不覆盖原校园快照）
python -X utf8 adapter/osm_surroundings.py --download

# 用已保存的周边 OSM 快照重新转换
python -X utf8 adapter/osm_surroundings.py
```

三张本轮截图及完整测试记录见 `docs/campus3d-polish-delivery.md`。

## 三维素材库

打开 <http://127.0.0.1:5180/mecoffe3d/assets>。目录位于 `frontend/public/mecoffe/assets3d/catalog.json`，版本 `mecoffe.asset-catalog.v1`；按类别、来源或名称查询原型，每张卡片显示可旋转的三维示例、变体、参数、匹配规则和来源许可。预览只改变素材卡片，不影响校园回放。

建筑配色、道路分级、角色外观和事件样式从目录读取。`adapter/build_asset_catalog.py` 可重建目录及代码生成的 SVG 缩略图。整要素自动匹配排除 `target: component` 的墙窗、屋顶、基座等部件；匹配按标签具体程度排序，固定 seed 和要素 ID 决定变体。里程碑 5 的圆塔立面兼容校正只影响实际显示选型，并同时记录请求与实际原型，不修改已保存的地图素材分配文件。

程序生成资源使用 `LicenseRef-MeCoffe-Project` 标记项目自产来源与授权边界，不冒称 CC0；YuLan 和 OSM 分别保留 Apache-2.0、ODbL-1.0 记录。实现和验证详见 `docs/asset-library-delivery.md`。

## 通用地图建模流水线

`adapter/scene_builder/` 仅依赖 Python 标准库，接受 OSM 范围/已存快照或调用方 WGS84 GeoJSON，将坐标转为米，再从目录匹配原型并按固定 seed 选择变体。输出兼容 `campus3d.json`、素材分配理由、地点对应、地表和带 SHA-256 的 manifest。接口见 **[地图输入草案](docs/map-input-contract.md)，待与调度器负责人确认**；地图生成不包含人物、订单或 agent 决策。

```powershell
python -X utf8 -m adapter.scene_builder osm --osm data/osm/nus.osm --metadata data/osm/nus.metadata.json --campus-id nus --title "NUS 建模流水线验证" --seed 2026 --output-dir frontend/public/mecoffe/campuses/nus
python -X utf8 -m adapter.scene_builder geojson --input campus.geojson --campus-id caller-campus --output-dir scene/generated/caller-campus
```

打开 <http://127.0.0.1:5180/mecoffe3d?campus=nus> 查看独立的 NUS 楼栋/道路预览，**没有模拟数据**，不复用 MeCoffe 人物或地点映射。本次 OSM 快照实际生成 226 栋楼、840 段道路、114 个 POI 和 100 个地表要素；其中 149 栋使用默认高度。NUS 原始文件与来源记录独立保存在 `data/osm/nus*`。中科大原始 XML 经兼容 profile 重建与当前场景完全一致，未覆盖已有源数据。

## YuLan 三维人物、屋顶与沙盘层次

素材库目前 **73 个原型**：建筑26、道路14、地表6、植被3、街道家具7、人物4、特效13。来源为程序生成52、YuLan图集改编20、OSM几何1；实例中的 OSM 几何许可与模型原型许可分别记录。新增 `character.yulan3d`、实体平/坡屋顶、建筑基座与分层沙盘底座；原型说明记录程序建模与源图参考的区别。

`/mecoffe3d` 的建筑可选“程序化 / YuLan”，默认建筑仍为程序化；人物可选“**立体 YuLan（默认）/ 像素贴图 / 体素**”。立体 YuLan 的形体、待机、摆臂迈步和手持杯都是程序建模；五官及外观配色来自对应 YuLan 组合，因此同一个人物在二维和三维中保留可辨认特征。它不是单张图片拉厚。像素和旧体素模式继续用于对照；风格切换不改变订单或回放游标。

house21–26 保留图集底层、标准层立面；villa27–30 原图没有独立楼层零件，仍采用**明确记录的墙面分带裁剪**。原斜二维屋顶贴图不再投影到楼顶。大楼使用有厚度的平屋面、女儿墙和按固定 ID/seed 布置的设备（水箱、空调、楼梯间、通风口、部分太阳能板或绿化）；小型、无孔、近矩形住宅使用有檐口的实体双坡顶。中庭保持开口，设备避开外边缘和孔洞。圆塔立面 22/2、24/2、25/1–3 不用于方形或长条轮廓，显示层选择兼容直面并保留选择原因。这些设备和屋顶形式是展示设计，不是测量成果。

保留的体素备选将可见像素拉出有限厚度、剔除透明采样与内部面并合并网格；这与默认的完整分部件立体人物是两种做法。decor40–45 仍为明确标记的风格改编/浮雕，不恢复图片未显示的背面。灯/椅源帧不足三种时，用原帧配不同厚度作为变体，不虚构新源帧。

沙盘底座显示石材、土层、表层及外侧收边；校内道路略低于草坪，建筑落在基座上，校外道路低一级且人行道/路缘高于沥青。`campus3dTerrain.js` 统一显示高度：校内路面 0.14、草坪 0.62、路缘 0.72、楼底 0.94；校外路面 −3、人行道 −2.48、路缘 −2.34，底座底面 −19（单位均为显示坐标米）。这些数值不是校园实测高程，不写入 OSM 或步行图。高画质显示柔和接触暗部，低画质可关闭这部分效果。

门口站位采用全局预留槽位；行走采用独立显示路线副本、分道与必要的等待/让行。碰撞间距按缩放后的角色包围半径加 0.9 米展示余量计算，比只检查人物中心更严格。每个运动步同时检查起终点及两点间扫掠间距，站位/路线避开建筑，装饰布点也避开路线和站位区。相机缩放可能触发显示位置重新排布；这些位置、绕行和排队不代表 OASIS 决策、现实通行时间或新的实测道路。原始 A* 返回值、映射、回放数据和顶部提示保持不变。

重建证明与素材分配仍在 `frontend/public/mecoffe/campuses/ustc/`，其中场景与原 `scene/campus3d.json` 完全一致，原文件未覆盖。里程碑 1–3 记录见 `docs/asset-library-delivery.md`，里程碑 5 的改动、断言调整、全量验证与五张截图见 `docs/milestone5-delivery.md`。

## 测试

```powershell
python -X utf8 -m unittest discover -s adapter -v   # 原有适配器和 OSM 转换测试
cd frontend
npm test                                          # 原有回放/二维路线及三维寻路、播放与动画测试
npm run build
```

VS Code 里可直接运行任务 **MeCoffe：运行全部测试**。

## 目录

| 路径 | 说明 |
| --- | --- |
| `scene/campus.json` | 校园地点配置（环境准备模块的产出） |
| `scene/campus3d.json` / `campus3d_mapping.json` | OSM 三维几何、步行图与八个示意地点映射 |
| `data/osm/` | OSM 原始 XML 与下载来源、时间、SHA-256 |
| `adapter/osm_to_campus3d.py` | OSM 快照 → 米制校园几何与步行图，复制派生 JSON 到前端 |
| `adapter/test_osm_to_campus3d.py` | 投影、几何、路网、映射与数据来源测试 |
| `adapter/oasis_to_scene.py` | OASIS 轨迹 → 场景数据，含一致性校验 |
| `adapter/snapshot_to_scene.py` | 最新人物关系快照 → 静态网络场景，不读取旧轨迹 |
| `adapter/build_demo.py` | 最新快照 + 演示规则 → 30 天动态脚本，不调用模型 |
| `scene/demo.json` | 示例价格、概率、抽样、上限与 seed 等演示假设 |
| `adapter/test_oasis_to_scene.py` | 适配器测试 |
| `frontend/src/mecoffe/replay.js` | 回放状态、逐日统计、人物记录（纯函数） |
| `frontend/src/mecoffe/layout.js` | 人物站位、去门店的行走路线（纯函数） |
| `frontend/src/mecoffe/CampusScene.js` | Pixi 校园场景：地图、人物、行走与事件动画 |
| `frontend/src/mecoffe/Campus3DScene.js` | Three.js 校园体块、人物与路网动画 |
| `frontend/src/mecoffe/Campus3DEnvironment.js` | 程序化外观、装饰、日夜光照与 OSM 地表显示 |
| `frontend/src/mecoffe/Campus3DCharacters.js` | 带四肢动画和咖啡杯的实例化低多边形人物 |
| `frontend/src/mecoffe/Campus3DYuLanCharacters.js` / `yulanCharacterModel.js` | 默认完整立体 YuLan 人物、原图配色/五官取样、行走与待机 |
| `frontend/src/mecoffe/YuLanRoofGeometry.js` / `yulanRoofModel.js` | 实体平/坡屋顶、屋面设备及圆塔立面兼容规则 |
| `frontend/src/mecoffe/campus3dCrowd.js` / `campus3dDetour.js` | 展示站位、分道、建筑绕行与人物间距；不修改原始 A* 图 |
| `frontend/src/mecoffe/Campus3DBase.js` / `campus3dTerrain.js` | 有厚度的沙盘、道路/人行道/草坪/楼底的展示层次 |
| `frontend/src/mecoffe/Campus3DEffects.js` | 事件气泡、弧线、粒子、收据及选择性辉光 |
| `frontend/src/components/Campus3DVisualControls.vue` | 高低画质、日夜循环和光照预览 |
| `adapter/osm_landcover.py` | 从同一已存快照提取运动场、水面等独立图层 |
| `frontend/src/mecoffe/campus3dRouting.js` | 最近道路节点与 A* 寻路（纯函数） |
| `frontend/src/mecoffe/campus3dPlayback.js` | 三维页面模式校验与时间轴定位（复用 replay.js 统计） |
| `frontend/src/mecoffe/campus3dView.js` | 按真实校园边界进行透视全景适配 |
| `frontend/src/mecoffe/campus3dScreen.js` | 人物最小像素尺寸、标签屏幕布局与避让 |
| `frontend/src/views/MeCoffe3D.vue` | 三维页面、三种模式、人物面板与播放控制 |
| `frontend/tests/layout.test.js` | 站位与路线测试 |
| `frontend/src/views/MeCoffeScene.vue` | 页面：指标、面板、回放控制、图表 |
| `frontend/tests/replay.test.js` | 回放状态测试 |
| `start-mecoffe.ps1` / `.cmd` | 启动脚本 |

`frontend/` 其余文件是 YuLan-OneSim 前端原样代码，改动见 `NOTICE.md`。
