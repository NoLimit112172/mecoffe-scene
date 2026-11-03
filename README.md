# MeCoffe 校园场景沙盘

默认打开基于团队最新人物关系快照（目前 revision 3）的动态演示：100 个主体、530 条有向关注，支持 30 个展示日的播放、暂停、逐条推进、走到门店和互动气泡。顶部还可查看静态关系网络或原始 OASIS 历史运行回放。前端基于 [YuLan-OneSim](https://github.com/RUC-GSAI/YuLan-OneSim) 的 Vue + PixiJS 前端和美术素材改造，**不调用模型**。

“新版演示”使用明确的脚本规则，供检查场景、动画和接口，不是新一轮 OASIS 实验结果。演示价格、概率、抽样和每日购买上限在 `scene/demo.json` 中公开配置；不得据此报告销量预测或消费者偏好变化。

## 在 VS Code 里运行

源码仓库：<https://github.com/NoLimit112172/mecoffe-scene>（私有，包含运行所需的团队输入和美术素材，不做公开网站部署）。首次在另一台电脑使用时：

```powershell
git clone https://github.com/NoLimit112172/mecoffe-scene.git
```

1. 用 VS Code 打开 `mecoffe-scene.code-workspace`（或直接打开本文件夹）。
2. 按 **F5**，选择 **MeCoffe：打开校园场景沙盘**：会先启动本地服务，再打开 Chrome 调试页。
3. 不用调试器时，双击 `start-mecoffe.cmd`，或在终端运行：

```powershell
.\start-mecoffe.ps1            # 启动并打开浏览器
.\start-mecoffe.ps1 -NoBrowser # 只启动服务
.\start-mecoffe.ps1 -Rebuild   # 先重新生成场景数据
```

页面地址：<http://127.0.0.1:5180/mecoffe>。服务在后台运行，日志在 `logs/`。端口固定为 5180，被别的程序占用时脚本会报错退出，不会结束任何进程。

需要 Node.js 18+ 和 Python 3.9+（适配器只用标准库）。首次运行若没有 `frontend/node_modules`，脚本会自动执行 `npm ci`。

也可以在 `frontend/` 终端运行 `npm run dev`，会自动打开同一个新版演示页面。该项目默认固定使用 5180，访问首页 `/` 也会跳到 `/mecoffe`。MeCoffe 三种展示模式都不需要另开后端或填写 API 密钥；`frontend/.env.example` 仅保留可选配置说明。

若启动失败，先查看 VS Code 的启动任务终端和 `logs/`，其中会说明解释器、依赖、数据或端口的具体问题。代码更新不包含本机 `node_modules/`、构建产物、日志、备份或个人 `.claude/` 配置；其他电脑拉取后会按锁文件安装依赖。

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

转换脚本只使用 Python 标准库。经纬度以校园中心为原点，按等距矩形投影转换为东/北方向的米，公式和原点写入场景 JSON。道路相邻 OSM 节点生成带实际投影长度的无向步行图；购买动画从住所楼栋中心最近的道路节点出发，使用 A* 找到门店的最近节点，再严格原路返回。楼门到道路节点的接入、人物所在楼栋与门店配置均为展示层安排。

页面将同一个人的多笔订单依次排队，重复订单不会再次触发行走；暂停会冻结行走，拖动时间轴或按天跳转会清除未完成动画并恢复示意站位。时间轴到末尾后，已出发的人物继续返回；随后可从头播放。选中人物可查看其关注关系和截至当前的行为记录。动画速度是回放速度，不是实际步行速度。

三维全景按真实校园边界和楼顶适配，限制轴约占画布 80%；宽屏从东侧观察，窄屏从南侧观察，地面仅在边界包围范围外留 12 米。初始全景会随画布大小调整；手动旋转、平移或缩放后保留用户视角，“全景”按钮可重新适配。人物显示包围盒不小于 12 CSS 像素，行走时有浅色光圈，缩放只影响外观、不改变坐标或路线。默认只显示八个映射楼栋的标签，字号固定 12px，并做重叠避让；其他楼栋通过悬停查看名称。

已知限制：OSM 不提供该批楼栋的楼层与高度，体块使用默认楼层和层高并标明来源；轮廓与道路仅代表下载时的 OSM 覆盖，未登记或后来建设的楼可能缺失。八个地点都是 `illustrative: true` 的人工对应，尤其咖啡店不代表真实店址；OASIS 没有位置数据，人物路线与动画速度不参与模拟，也不应解释为实地可通行性或到店时间。这里仅按 OSM 步行拓扑展示路线，不含室内、门禁、坡度、导航网格或精细模型。

新版演示仍是 v3 网络的 30 天规则脚本，**不是 OASIS 运行结果**；关系网络仅展示静态关注输入，不产生订单；历史回放仍对应原始失败运行（23/30 天完整，第 24 天部分记录），没有补造后续天数。

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
