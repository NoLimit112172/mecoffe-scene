# 确认范围内的路网质量：修复说明

本批从9411d9e在独立克隆开发，不修改原工作区。只本地提交，不推送。临时站是否升级运行包另行确认，不能把离线对照写成真实模拟通过。

## 统计口径

新地图的质量规则为`scope-quality.1`，与用途分类规则`auto-evidence.2`分开记录。用途分类没有改名或升为auto-evidence.3；SceneResult v1/v2/v3及其字段没有变化。

ready所用的主路网比例，只统计**几何有效、整栋位于用户确认范围内**的楼栋入口。范围内断路入口仍在分母中，不会因为不可达而被删掉。跨界、孔洞内或完整位于范围外的楼保留显示，入口只作背景参考。范围内没有入口时不能ready。

90%门槛、用途已知比例的统计范围和门槛、楼栋有效性、有可安置楼等其余ready条件全部沿用。入口是否安全、是否穿楼穿水、楼体与水域是否冲突，以及禁入用途的限制也没有放宽。连通率的分子仍沿用原来的connected标记加主路网分量判断，连线安全另外决定安置资格。

## 冻结与旧图

`quality.json`新增`quality_policy`，由现有manifest.files摘要保护，无须新增地图文件或修改manifest契约。对象保存版本、规则正文及摘要、发布实现的逐文件摘要和汇总摘要；JSON摘要按键排序、UTF-8规范化，源码摘要统一LF，不写时间戳或绝对路径。

运行时按已知规则版本执行，核对正文与摘要；未知、篡改、显式null或两处引用冲突都拒绝，不静默套旧口径。实现摘要记录原发布实现，后续同规则版本的程序不会把它改写成自己的摘要。

|质量字段|新规则含义|
|---|---|
|entrances|全部显示入口数，原字段含义保留|
|connectivity_entrances|本次ready连通率的范围内分母|
|main_component_entrances / main_component_ratio|范围内连主路网入口数和比例|
|background_entrances|有效但不完整位于确认范围内的背景楼入口数|
|background_main_component_entrances / background_main_component_ratio|背景入口连通情况，只作参考|
|invalid_geometry_entrances|所属楼几何无效的入口数，单独记录|

没有`quality_policy`字段的旧图继续走原代码路径。`publish_map`默认保持旧发布行为，CLI新增`publish --quality-policy scoped`显式选择新策略，默认legacy仍用于历史复现。`physical-map`生成新地图时默认冻结新策略，并将同一对象记入recipe；旧bbox建图和旧归档复现不变。

## 原因说明

新规则不再用一个BUILDING_EXCLUDED概括所有情况：

|代码|含义|
|---|---|
|BUILDING_OUT_OF_SCOPE|正常范围外背景，保留显示，不参与安置或范围内连通统计|
|BUILDING_INVALID_GEOMETRY|几何无效，不能认证安全安置|
|BUILDING_WATER_CONFLICT|范围内楼体与水域冲突|
|BUILDING_NO_SAFE_ENTRANCE|范围内楼没有安全且连上主路网的入口，含缺入口或不安全连线|
|BUILDING_NON_PLACEABLE|交通、后勤、在建废弃楼不可安置|

说明表仍用既有error/warning两种级别，正常背景的文字明确说明其正常用途，不作为ready失败条件。新增INVALID_QUALITY_POLICY错误。共享说明表测试的固定warning数量由10增为15，仍精确检查全部代码，不删除或放宽旧断言。旧图继续产生原警告，旧SceneResult夹具不重生成。

## 兼容性限制

0.2.0能读取带新quality_policy的地图，但旧resolver与checker仍调用旧enrich_map，浦口会再次算成43/51并报MAP_NOT_READY。因此，**仅换建图包无法完成配置编译**；不能仅凭load_map成功声称兼容。

自有源码导出版本升为0.2.2，导出规则5，加入quality模块。旧地图、旧契约与素材继续受原字节保护，完整EXPORT_MANIFEST继续锁定。团队/19201运行包0.2.0本批不改；临时19203是否允许升级需要单独答复。c51f7bd前端的地图文件白名单不变，SceneResult仍为原v3，不以改坐标或删除背景楼来迁就旧编译器。

## 对照与回归依据

- 浦口缓存数据：旧43/51、preview_only；新43/43、ready，8个背景入口只作参考。原图逐文件摘要不变，没有重新下载。
- 中科大1/2：31/31、ready保持，eligible29、unknown2和人工补注保持；新规则对照另发到仓库外101/102，不写data/maps。原生成命令仍能逐字节复现两版各14文件。
- 新专项覆盖背景孤立楼、范围内断路、跨界、孔洞、穿楼穿水、安全入口、空分母、策略篡改与未知规则，以及发布/加载/编译。
- 原加速差分测试继续严格比较旧口径全部输出；测试专用wrapper显式选择旧策略，不把新规则差异放进豁免白名单。新口径另由专项覆盖。

具体测试命令、最终计数、包摘要及真实临时站验收结果在仓库外的本批交付记录中报告；本文件不放个人会话、数据库、密钥或服务器信息。
