# 里程碑 5：立体人物、防穿模、实体屋顶与分层沙盘

分支：`feat/asset-library`。接续里程碑 4 提交 `4514a33`，本轮只做本地提交，不 push，不修改 `main`，不结束 5180 服务。

本报告随本轮 `milestone 5:` 提交保存；提交号可用 `git log -1 --format=%h -- docs/milestone5-delivery.md` 查询，亦见最终交付消息。

## 实现范围

### 完整立体 YuLan 人物

- 默认人物变为“立体 YuLan”；“像素贴图 / 体素”继续可选。原程序立体角色保留为素材库中的历史备选。
- 头部、发型、躯干、上臂/前臂、上下腿和鞋为有完整正侧背面的实体几何，按部件摆动，有待机起伏、迈步、摆臂和手持杯动作。
- 使用同一人物 ID 对应的二维 YuLan 组合，读取肤色、发色、发型轮廓、上衣、裤子、鞋的像素样本。只有五官使用正面贴片，其余部分没有用单面图片替代体积。形体是程序化设计，不是恢复真实人物或源图未显示的三维数据。
- 新增 `character.yulan3d`。目录共 **73 个原型**：建筑26、道路14、地表6、植被3、街道家具7、人物4、特效13。程序来源52、YuLan图集改编20、OSM几何1。
- 全景下所有人物的最小屏幕高度统一为 12 CSS 像素，保留姓名、选中高亮与行走光圈。碰撞半径包含肢体摆动与手持杯，并随显示缩放更新。

### 显示站位与行走避让

- 对同楼和不同楼的门口站位做全局预留，人物圆形包络之间留 `CROWD_GAP = 0.9` 米展示余量；静止站位额外留通行宽度，并避开原始道路及全部正反向建筑安全显示折线，避免静止人物堵住窄路。
- 原始 OSM A* 图、返回节点序列和距离保持不变。新增的是显示路线副本：分道、建筑外侧绕行、站立人群绕行与必要的等待。不会把避让折线写回道路数据。
- 连续扫掠检测检查一帧内的轨迹交叉，不仅检查帧末位置；建筑检测检查整段与角色半径，避免两个端点都合法却穿墙。
- 相机转动/缩放导致人物尺寸变化时可以重新安排显示位置。固定相机下的日常播放不以重新排布站位代替行走，速度有上限；暂停保留状态。
- 建筑或人群阻挡时，用有界的局部显示栅格重规划；跳过被占用的中间点，店前预留服务位，窄路会车可退回预留站位等待。零长度路径点在高刷新率和低倍速下也会正确推进。
- 装饰物布点避开建筑、步行线和站位区。相机重排、转返程或绕行改变显示走廊时，同步隐藏冲突的程序/YuLan装饰；恢复仍用原实例矩阵，不改地图。此处的排队、绕行和动画用时是显示安排，不代表 OASIS 的位置、出行或决策。

### 实体屋顶与立面兼容

- house21–26 的原底层/标准层立面保留；villa27–30 继续使用有说明的墙面分带。原斜二维 roof atlas **不再投影到屋顶**，仅保留源帧记录与配色参考。
- 平顶沿原轮廓及中庭孔洞生成有厚度的屋面；女儿墙与压顶为实体。水箱、空调、楼梯间、通风、部分太阳能板/绿化按楼栋 ID 和固定 seed 确定，位置避开边缘、孔洞和其他设备。
- 小型、低层、无孔、近矩形住宅/villa 可采用封闭实体双坡顶，含檐口、屋脊和瓦面配色。大楼及不适合坡顶的复杂轮廓使用平顶。
- 图集检查确认圆塔立面为 **22/2、24/2、25/1–3**。它们只配给接近圆形的轮廓；方形/长条轮廓改用同套直面或 house26 兼容变体。23/1 的圆角长方形、26/3 仅屋顶圆顶不等同圆塔立面，未被错误排除。
- 图集检查图片位于本机 `logs/asset-library/m5-roof-atlas.png`、`m5-roof-towers.png`。本次实际校园屋顶检查生成31栋、校正9栋圆塔立面分配；旧审查截图 `m5-roof-review.png` 仅作开发证据，正式交付截图见后表。
- 显示实例同时记录请求原型与实际原型。`MapSceneRenderer` 使用合并方式保留这些元数据，不覆盖已保存的地图素材分配文件。屋顶部件卡片也显示真实几何。

### 分层底座与高度

- 底座有石材层、土层、表层及四周收边；校内道路从草坪实体中裁出，而非把沥青画到草面上。外部道路、人行道、路缘和楼底基座都有厚度。
- 统一高度来自 `campus3dTerrain.js`：底座底面 −19，石层顶 −13，土层顶 −5.1，校外地面 −3.8，校外路面 −3，人行道 −2.48，路缘 −2.34；校内路面0.14、草坪0.62、路缘0.72、楼底0.94。
- 数值单位为展示坐标米，**不是实测高程**，不写入 OSM/地图输入。人物脚底按当前显示地表高度落地。高画质保留批量接触暗部，低画质可关闭。
- 新增目录部件：`building.component.roof-flat`、`building.component.roof-pitched`、`building.component.foundation`、`landcover.layered-base`。

## 旧测试断言调整及原因

没有删除原回放、订单去重、模式切换、不可达或数据一致性要求。与新外观相冲突的断言改为检查对应的新约束：

| 文件/旧断言 | 调整与理由 |
| --- | --- |
| `yulanAssets.test.js`：house21 材质必须含 `_2.png` 屋顶帧；整栋包围盒最高点必须等于原墙高17.5 | 需求明确停用二维屋顶，改为断言不使用该屋顶贴图、`roofTextureApplied=false`，楼体原轮廓与 `originalHeight=17.5` 不变；实体屋面/女儿墙/设备可高于原墙顶 |
| `yulanAssets.test.js`：屋顶为平面 `yulan-roof-module`，按平面索引计算面积 | 改为 `roof-slab` 的实体 ExtrudeGeometry，兼容非索引几何，只累计顶面；仍断言中庭射线无交点、屋面有交点、净顶面积336，不能以改几何为由填平中庭 |
| `campus3dRoadModel.test.js`：周边道路所有层都不写深度 | 沥青、人行道和路缘现在是实体，必须 `depthWrite=true` 才能正确遮挡；车道涂线及地下段示意仍为叠加层。另检查真实厚度和路面/人行道高差 |
| `campus3dScene.test.js`：脚底高度恒定为0.35 | 改为与 `renderer.personElevation()` 一致；横向坐标另行断言。展示层次变化后不能继续让人物浮在旧的统一平面 |
| `campus3dScene.test.js`：固定一次大时间步就必须到店/返家 | 避让折线可更长，也可能等候。改为按0.04秒推进，检查每步不超过4米（100展示米/秒）、人物/建筑间距及有界时间内到达；保留只发一次收据、杯子状态、顺序和暂停检查 |
| `campus3dScene.test.js`：最小屏幕尺寸、相机缩放不改变显示位置 | 人物统一最小12 CSS像素；放大后的体积需要重排显示站位。改为验证重排后包络间距、楼体外侧及可见性，并核对原始 A*、源数据、订单不变。固定相机动画另测不重排 |
| `campus3dEnvironment.test.js`：装饰仅避开旧路径/点 | 追加带宽度与角色包络的站位/路线区域避让；保留固定种子、建筑避让和有限几何检查 |

## 新增测试覆盖

- `yulanCharacters3d.test.js`：透明像素过滤、精确配色、来源组合、发型类别、无有效样本报错、正侧背实体、暂停、杯子、身体包络和资源共享/释放。
- `yulanRoof.test.js`：坡/平选择、圆塔兼容、固定 seed、原轮廓/中庭、设备不跨孔洞；真实中科大全部31栋；双坡顶封闭边和外向法线；素材卡真实几何与变体。
- `campus3dTerrain.test.js`：全部高度排序、实体厚度、道路裁切面积守恒、反向轮廓、真实校园每条道路中心线无草坪覆盖、源数据不变、资源恢复及预览。
- `campus3dCrowd.test.js`：100人全局站位、原12条 A* 不变而显示线避墙、凹多边形/中庭/负坐标、对向和交叉扫掠、持续混合通行、稳定结果。
- `campus3dDetour.test.js`：站立队列与建筑联合绕行、近接触起点、窄走廊、被占目标返回等待、封闭中庭不穿墙、输入不修改。
- `campus3dTraffic.test.js`：实际100人场景、12条住处到双店订单同时启动，按帧检查距离、速度、楼体避让、唯一收据、原始输入/寻路不变。996帧、39.84显示秒内全部到店并返回，低于120秒上限；每帧核对全部100个人物的包络。
- `campus3dScene.test.js` 追加 `1/240` 秒步长零长度显示点回归：推进指针而不产生位移、购买或源路线修改。

## 测试、构建与不变项核对

| 命令/检查 | 本轮最终结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 55/55，退出码0；`logs/asset-library/m5-python-tests.txt` |
| 在 `frontend/` 执行 `npm test` | 159/159，退出码0；`logs/asset-library/m5-frontend-tests.txt` |
| 在 `frontend/` 执行 `npm run build` | 退出码0；`logs/asset-library/m5-build.txt`。保留既有 CharacterFactory 动静态混合导入与大于500kB包体提示，无构建错误 |
| `git diff --check` | 通过 |
| 原始 OSM、三种回放JSON、映射、路网与 `/mecoffe` 文件无改动 | 对照里程碑4 `4514a33` 核对：scene、data、原回放JSON、路由、二维、依赖及VS Code配置无改动 |
| 浏览器默认/YuLan/像素/体素切换、回放/暂停/跳转、无页面错误 | 正午截图、暂停800ms零漂移、人物/画质切换通过；历史第2天61人在途，现场全体碰撞检查0冲突；五个新素材卡真实预览通过，errors=[]；见 `logs/asset-library/m5-final-browser.json` |
| `main` 不变，5180原服务仍可访问 | `main=ee17353a4de200d87eca7ad828ca586511252d62`；原监听进程PID71160保留 |

已独立执行的屋顶相关命令：在 `frontend/` 运行 `node --test tests/yulanRoof.test.js tests/yulanAssets.test.js tests/assetPreview.test.js`，**20/20 通过**。这不代替上述全量验证。

## 截图

统一为1600×1000，来自实际页面并逐张查看，放在被Git忽略的本机日志目录：

| 内容 | 路径 |
| --- | --- |
| YuLan建筑 + 默认立体人物全景 | `logs/asset-library/m5-yulan-overview.png` |
| 门口人群特写 | `logs/asset-library/m5-door-crowd.png` |
| 实体屋顶特写 | `logs/asset-library/m5-roof-closeup.png` |
| 分层底座边缘与道路高差 | `logs/asset-library/m5-base-edge.png` |
| 默认程序建筑 + 默认立体人物全景 | `logs/asset-library/m5-default-overview.png` |

## 改动文件

以下为本轮42个改动文件的分组清单。源码、测试、目录和文档随提交保存；截图及运行日志留在本机忽略目录。

- 文档：`README.md`、`NOTICE.md`、`frontend/public/mecoffe/assets3d/README.md`、`docs/milestone5-delivery.md`。
- 目录生成：`adapter/build_asset_catalog.py`、`frontend/public/mecoffe/assets3d/catalog.json`；预览SVG为 `character.solid.svg`、`character.yulan3d.svg`、`building.component.roof-flat.svg`、`building.component.roof-pitched.svg`、`building.component.foundation.svg`、`landcover.layered-base.svg`。
- 页面与集成：`frontend/src/components/Campus3DVisualControls.vue`、`frontend/src/views/MeCoffe3D.vue`、`frontend/src/mecoffe/Campus3DScene.js`、`MapSceneRenderer.js`、`AssetPreviewRenderer.js`、`assetPreviewYulan.js`。
- 人物：`frontend/src/mecoffe/Campus3DYuLanCharacters.js`、`yulanCharacterModel.js`。
- 屋顶与YuLan：`frontend/src/mecoffe/YuLanRoofGeometry.js`、`yulanRoofModel.js`、`YuLanAssetFactory.js`、`YuLanCampusStyle.js`、`yulanAssetModel.js`。
- 环境与避让：`frontend/src/mecoffe/Campus3DBase.js`、`campus3dTerrain.js`、`campus3dCrowd.js`、`campus3dDetour.js`、`Campus3DEnvironment.js`、`Campus3DSurroundings.js`、`campus3dEnvironmentModel.js`。
- 新测试：`frontend/tests/yulanCharacters3d.test.js`、`yulanRoof.test.js`、`campus3dTerrain.test.js`、`campus3dCrowd.test.js`、`campus3dDetour.test.js`、`campus3dTraffic.test.js`。
- 原测试调整：`frontend/tests/yulanAssets.test.js`、`campus3dRoadModel.test.js`、`campus3dEnvironment.test.js`、`campus3dScene.test.js`。

## 边界与已知缺口

- 本轮解决展示模型与可见拥挤，不建立真实交通、人群疏散或 OASIS 空间决策模型。源 A* 路径仍可与某些 OSM 楼体几何冲突，因此保留源结果，在显示副本上绕行；显示折线可能离开道路中心线，不能报告为实测步行轨迹。
- 最小屏幕尺寸放大了人物的世界尺度，全景的门口人员分散范围也随之增大。相机操作可能触发显示重排，不能把该重排当作人物瞬时移动事件。
- 本轮碰撞约束覆盖人物、楼体和展示装饰，尚未把水面、运动场、围墙门禁等完整建成禁行区域；显示站位或绕行可能落在这些区域，不等同实地可行走范围。
- 避让已加入有限场景的连续几何与活性测试，不能据此保证任意新增地图、任意拥挤数量都不会等待或阻塞。地图扩展后需复跑同类集成测试。
- 屋顶设备、坡顶选择、完整人物背面和底座高差为程序设计。墙面仍使用 YuLan 像素风图集，图集纹理拉伸与真实建筑外观存在差异；不是实景模型复原。
- 顶部“人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据”提示保留；三种数据模式、回放统计与二维页面保持原有逻辑。

提交仅保存在本地 `feat/asset-library`，未 push。最终工作区状态与提交号见本轮交付消息。
