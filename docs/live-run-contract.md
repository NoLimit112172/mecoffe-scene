# 运行中场景展示接口草案（里程碑 14）

状态：2026-11-09。仅场景分支本地实现和合成接口验证，未部署。路径待 Alemax067 确认，集中在 `frontend/src/mecoffe/liveRun.js` 的 `LIVE_API_PATHS`。现有终态三产物接口不变。本文不是已存在的团队后端接口声明。

## 入口与职责

`/scene/mecoffe3d/?session=<id>&run=<id>`、`/scene/mecoffe-gis/?session=<id>&run=<id>` 不变。先读取已有运行详情；终态走严格回放，其他状态尝试实时接口。人物位置、入口及路线始终属于展示示意，OASIS 没有位置数据。

管理员智能体不发送位置信息，也不参与页面的轮询。后端负责冻结版本、动作结果、身份归属和固定日汇总；场景只负责展示，不向模拟器写数据。纯网络实验仍可使用原有关系图，不必打开校园。

## 初始化

`GET /api/sessions/{sid}/runs/{rid}/scene/bootstrap`

| 字段 | 含义 |
| --- | --- |
| `schema_version` | 固定 `scene.live.v1`。 |
| `run_id`, `engine_run_id`, `config_id` | 分别为业务运行、引擎运行、该次冻结配置的编号；必须与运行详情一致。 |
| `status`, `phase` | `queued` / `initializing` / `running` / `completed` / `failed` / `cancelled`，以及可选可读阶段。团队当前仅有的状态按实际返回。 |
| `snapshot`, `plan` | 该次运行冻结的快照和 `simulation_plan` 原样字段；不能换用最新配置。 |
| `metadata` | `snapshot_id`、`snapshot_revision`、`plan_id`、`plan_revision`，和冻结输入严格一致。 |
| `step_unit` | `day`（本轮主体）或 `hour`。 |
| `roles` | 可选该次配置的角色 StageDetail；缺少时另读已有 `stages/roles`，失败降级，401仍按失效处理。 |
| `synthetic` | 仅用于明确标注合成 mock。真实运行不设置为 true。 |

人物事件已用 `agent.entity_id` 规范化，前端不需要收到整份原始 `id_map.json`。后端用它把原生 agent/user ID 转换为实体 ID；禁止把本机目录、模型绑定或整个 bundle 返回浏览器。冻结版本的检查强度与终态回放相同。

## 增量页

`GET /api/sessions/{sid}/runs/{rid}/scene/events?after=<cursor>&limit=200`

```json
{
  "status": "running",
  "completed_step": 0,
  "active_step": 1,
  "events": [{
    "source": {"run_id":"engine_synthetic", "audit_line":12, "tool_call_index":0},
    "step":1, "agent":{"entity_id":"synthetic_person_01"},
    "action":"purchase_product", "outcome":"executed",
    "brand_id":"brand_alpha", "product_name":"样例商品",
    "order_id":"order_synthetic", "quantity":1, "amount_fen":990
  }],
  "day_summaries": [],
  "next_cursor":"opaque-cursor", "done":false
}
```

- `source.run_id` 是 **引擎运行编号**，不是业务运行编号；`audit_line` 从 1 起，`tool_call_index` 从 0 起。脚本动作使用对应日志行和固定工具序号。三项构成稳定来源，不依赖到达时间或重导出的 action 序号。
- `outcome` 为 `executed / declined / failed / noop / unknown`；由后端复用 `trajectory.outcome()` 推导。决策完成不等于所有工具成功，一行可有多个工具调用。
- `events[]` 只允许规范化字段：source、step、agent、action、outcome、stage，以及适用的 brand_id、product_name、order_id、quantity、amount_fen、post_id、target（实体 ID）、text、message、price_fen、cost_fen。`text` 是清理后的短片段（最多500字符），`message` 为可读说明（最多240字符）。不返回 args/result、prompt、观察文本、模型地址或整个工具响应。
- 字段内容不可变。同一来源重复返回可去重，内容变化则报冲突。无新增内容返回200和空列表，不返回409。游标绑定运行，不使用时间戳；不能越过尚未消费的完整行。客户端每约2秒拉取，失败指数退避到最多30秒；单请求15秒超时（含JSON响应体，可配置），主动取消不当成网络故障；终态单次最多追赶5页，避免长循环阻塞。
- `done` 表示流已结束且游标后没有待消费数据。业务运行变为终态时，仍先读完增量尾页，再请求正式产物。不能在最后的订单/汇总尚未发送时提前声明 done。

## 固定日汇总与订单证据

`day_summaries[]` 是 **该业务日的增量值**，不是截至当日累计。每天至多一份固定内容，重传内容必须一致：

```json
{
  "step":1, "orders":1, "quantity":1, "revenue_fen":990,
  "posts":2, "comments":1,
  "verified_orders":[{
    "order_id":"order_synthetic", "entity_id":"synthetic_person_01",
    "brand_id":"brand_alpha", "product_name":"样例商品",
    "quantity":1, "amount_fen":990
  }]
}
```

金额为整数分；数量、金额必须与订单证据相符，订单跨天不重复。`posts` 包含成功 create_post 和 publish_ad，`comments` 为成功 create_comment，排除 initialization。被拒、未知、失败不计入成功结果。

兼容 `verified_order_ids` 数组，但只有对应快报已经包含完整购买数量、金额、品牌、商品与人物时才能核实；信息不齐不成单，页面明确提示。推荐始终返回上例完整证据，使汇总先于快报到达时仍可准确显示统计。动画必须等相应快报出现后才播放。

订单在购买时提交，**日汇总不是数据库事务的日末结算**。没有证据的购买只显示“尝试购买 · 订单待核对”，不计销量、不取杯；有对应固定汇总后升级同一事件。该天已有汇总而仍无订单证据时标“订单未核实”，不删掉记录。页面使用“本日进行中，汇总尚未更新”。

`metrics.json` 不保证每天采样。后端应在每步结束时保存固定的 `step_summary`（或同等逐日快照），与 completed_step 对应；不能用下一天已经开始后的当前全库计数冒充上一天。实时日志、订单、汇总应由引擎负责人核对读取一致性。

## 状态、权限和终态

- 登录 → 会话归属 → 运行归属；只读已登记引擎目录，固定白名单文件，检查路径和符号链接。不开放任意路径、整个运行目录或原始日志下载。
- JSONL 只消费已写完且以换行结束的行，运行中未写完末行留待下一次；中间坏行不能默默跳过。failed/cancelled 已停止后残缺末行不能永远等待：后端返回固定 `TRUNCATED_AUDIT_TAIL` 警告、不给该残行生成动作，完整尾流读完可置done=true并切正式部分回放；completed 却有残行应视作完整性异常。高层动作与 economic_action receipt 不可重复计数。
- 401：清除当前场景中的私有输入并提示登录。详情404：不存在或无权限；初始化接口404：提示“团队后端尚未提供实时接口，运行结束后可查看回放”，继续轮询运行详情；events404：明确提示接口不存在或无权访问。409：准备中，自动等待，不伪造空结果。
- 后端模拟继续运行时，暂停观看只停止动画。队列最多32项、同人最多2项，历史快报仍保留；“跟随最新进度”丢弃积压动画，保留已确认统计。三维/GIS仅在当前标签页内存共享状态，刷新重新读取，不用localStorage或跨标签通信。
- failed/cancelled 保留已确认结果并标部分。终态增量尾页读完后，获取 trajectory、population-snapshot、plan，按既有严格校验核对引擎运行、冻结版本、订单和人物；正式记录优先，计数差异明确提示。产物409继续等；已是正式回放的视图切换不再重载数据。

## 团队接入与验收

当前只有场景侧和本地 mock。团队需确认路径，实现上述两个只读接口、固定逐日快照并完成权限和一致性测试。既有三个终态接口保持终态限制，不应为了实时展示解除它们的保护。

已另行提供仓库外的团队后端参考补丁，基于301fca1；尚未合并、未部署。纯标准库测试已验证，Linux FastAPI/真实引擎回归仍待执行，具体结果见里程碑交付记录。补丁不是前端构建的一部分，不进入公开仓库或Pages。

本地验收命令：`node scripts/test-live-run.cjs`（先构建embed）。只访问本机5194、只用合成数据；不依赖团队服务。覆盖多批/重复页、pending→verified、缺订单、被拒/未知、失败部分、401/404/409、断网恢复、无接口降级、尾流和终态、宽窄短整页iframe、两视图状态与画布身份。

需要 Alemax067 确认：两个路径及字段、日汇总固定快照由谁提供、帧内使用的地图选择规则、默认轮询间隔和限流。师兄确认并完成团队后端联调前，不发布本分支。
