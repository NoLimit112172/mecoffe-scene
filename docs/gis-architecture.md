# GIS 模式原型：四层结构（里程碑 8）

本轮只增加 `/mecoffe-gis?scenario=<id>`。使用 MapLibre GL JS **6.16.0**（BSD-3-Clause，package-lock 固定），没有 deck.gl、API Key 或高德/百度/Google 接口，也没有空间后端、agent 决策或 OASIS 双向闭环。

## 1. 地图输入

现有 OSM 和调用方 GeoJSON 入口不变。官方 GIS / CAD 等数据以后先转换为经过来源确认的 WGS84 GeoJSON，再走同一入口；不会把在线校园地图网页当作可随意复制的模型库。第二阶段的高德或天地图是**可选底图服务**，不自动替代建筑轮廓、道路拓扑或提供地点映射。

## 2. 场景生成与素材匹配

`python -m adapter.scene_builder scenario --manifest scenarios/ustc-history.json` 同时输出原有米制场景和六份 `gis/*.geojson`。`adapter/scene_builder/gis.py` 严格按场景记录的 `origin_lon/origin_lat/earth_radius_m` 反算，输出 `[经度, 纬度]`；保留建筑孔洞、多块校界、道路层信息、原始高度来源及已有素材分配。GIS 图层和原有文件一起记录 SHA-256，使用 `.gitattributes` 的 `-text` 保存原始字节。

既有输入、地图、步行图、人物与关系、轨迹文件不重写语义；重复生成相同 JSON 时保持旧文件字节。Windows 上读者占用文件导致原子替换失败时，短暂重试后发布同一份已验证 JSON，最后更新清单哈希；并发读者遇到混合版本会被哈希校验拒绝，不会静默接受。临时 `.tmp` 文件不发布。

## 3. 人物层

`gis/replay.js` 不依赖 MapLibre / Three.js / Vue。它使用原有 `replay.js`、`cursorAtPosition`、`advancePosition`、初始化偏移与 `scenarioTime`，消费已有购买事件，复用 `createRouting` / `routeBetweenMappings` 的 A* 原始道路图。人物家位置只来自**已有显式 location_mapping**，不按 POI 类型猜测。

人物站位、出门连接、分道与门店排队都是展示设定；道路/水域/建筑避让使用原有展示几何函数。显示步速为既有沙盘的 100 显示米/秒，停留为 0.85 显示秒，受播放倍速影响，不是现实步速。保留原有每店 2 人 / 全局 12 人的可视队列上限。GIS 与沙盘共用事件游标和模拟时间，动画调度受帧率/加载影响，不声称两个界面的每一个姿态逐帧相同。

没有 trajectory 的场景不创建人物、不补购买、不输出虚构轨迹；例如 NUS 小时清单仅推进模拟时间。原始运行缺失日期不会填满成 30 天。

## 4. 可替换显示层

`gis/engine.js` 是唯一显示引擎创建入口；当前仅注册 `maplibre`。将来添加 Cesium 引擎应实现：`init()`、`setPeople()`、`setLayers(values)`、`setBasemap(id)`、`select(item)`、`focusFeature(item)`、`focusPerson(id)`、`resetCamera()`、`requestFrame()`、`needsAnimation()`、`setMeasuring(value)`、`getStats()`、`dispose()`。Vue 页面不访问 MapLibre map 对象；两个引擎读取相同 GIS 图层、人物经纬度及回放控制器。

MapLibre 用 fill-extrusion 显示按类别着色的建筑，符号层负责全局标签碰撞。标签使用本机字体和本地字形生成，不请求外部字体服务。ESM worker 通过 Vite 的 `?worker&url` 单独打包，避免开发预打包或 Pages 子路径遗漏 worker/shared 模块。

Three.js 自定义图层共享地图 WebGL 上下文，复用 `RealCharacterBatch` 的模型、骨骼、外观、步行动画和持杯动画；全部模型 URL 仍基于 BASE_URL。远景为圆点，zoom < 18.7 不请求 FBX；近景只加载视野内最多 12 人，优先选中人物。模型资源按原有租约释放；移除人物层不主动丢失地图的共享 WebGL 上下文。

### 底图适配器接口与第二阶段

`gis/basemaps.js` 的描述符为 `{id, label, online, source, layer}`，MapLibre 安装/移除 raster source/layer 时保留场景与人物图层，不通过 setStyle 重新创建人物。当前：

- `offline`：默认，仅用本地场景图层，worker / 字体 / 素材也在站内，无外部请求。
- `osm`：用户主动选择才请求 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`。始终显示署名，不提供抓取、预取、下载离线包、代理或自建缓存；浏览器正常 HTTP 缓存遵守服务器响应头。图层错误时回退离线并给出提示。

第二阶段在这个注册表和显示适配层新增服务商。若底图坐标采用 GCJ-02，须在显示适配器中统一转换**所有**矢量、人物、轨迹、查询和相机位置，不能只换栅格网址；原场景仍保存 WGS84。服务条款、域名白名单、署名和 key 的公开使用范围先确认。当前未实现这些服务商或转换。

OSM 政策：https://operations.osmfoundation.org/policies/tiles/ 。仅测试单个正常视口，不对在线瓦片做批量缩放/遍历。

### 地点映射接口与第三阶段

第三阶段应在 `scene_builder` 的地点映射阶段新增可审查的 POI 匹配器，输出与现在相同的 location_mapping。零候选、多候选及商家落点必须明确处理；匹配来源、置信度和人工确认记录写入产物。人物层继续消费 location_id，不把 POI 类别当作人物当前位置。本轮的 POI 点仅来自输入或现有显式映射，没有新增自动猜测。

## 本轮验证

`ustc-history`：31 栋建筑、已有 100 人与运行轨迹；`nus-hourly`：226 栋楼、仅小时模拟时间。两者通过相同命令重新生成、重复比较字节和哈希；前端校验经纬度、搜索、底图切换、LOD 上限、A*、游标/时钟一致性及无轨迹行为。

浏览器验收脚本：`node scripts/test-gis.cjs`；Pages：先构建，再 `node scripts/test-gis.cjs --pages`。OSM 单视口截图为显式选择：`node scripts/test-gis.cjs --osm`，不纳入离线/性能基线。截图与原始性能记录在 `logs/milestone8/`。
