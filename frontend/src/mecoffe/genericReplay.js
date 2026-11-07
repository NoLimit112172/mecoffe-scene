import {normalizeConfigPreview, buildConfigPreviewScenario, ConfigPreviewError} from './configPreview.js'

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const OUTCOMES = new Set(['executed', 'failed', 'declined', 'unknown', 'noop'])
const ACTION_TYPES = {create_post:'post', create_comment:'comment', purchase_product:'purchase', publish_ad:'ad',
  follow:'follow', interview:'interview', set_product_price:'price'}
const clone = value => structuredClone(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function fail(code, message) { throw new ConfigPreviewError(code, message) }
function integer(value, name, minimum=0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_REPLAY', `${name}必须是有效整数`)
  return value
}
function array(value, name) {
  if (!Array.isArray(value)) fail('INVALID_REPLAY', `运行记录缺少${name}`)
  return value
}
function contextId(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_CONTEXT', `${name}无效`)
  return value
}
function assertPerson(id, people, label) {
  if (!people.has(id)) fail('UNKNOWN_PERSON', `${label}引用了人物快照中不存在的主体`)
}
/** 校验终态运行的冻结输入，保留业务运行编号和引擎运行编号各自的含义。 */
export function validateRunReplay({trajectory, snapshot, plan, roles, context={}}) {
  if (!object(trajectory) || trajectory.kind !== 'oasis.interaction_trajectory' || trajectory.schema_version !== '1.0') {
    fail('INVALID_TRAJECTORY', '轨迹不是受支持的 OASIS 运行记录')
  }
  if (!TERMINAL.has(trajectory.status)) fail('RUN_PENDING', '运行尚未结束，终态轨迹还未准备完成')
  if (typeof trajectory.partial !== 'boolean' || (trajectory.status !== 'completed' && !trajectory.partial)) {
    fail('INVALID_TRAJECTORY', '失败或取消运行必须保留部分记录标记')
  }
  if (!object(snapshot) || !object(plan) || !object(trajectory.metadata)) fail('INVALID_REPLAY', '缺少配套快照或计划')
  const meta = trajectory.metadata
  if(plan.schema_version!=='1.0'||typeof plan.plan_id!=='string'||!plan.plan_id.trim()||
      !Number.isSafeInteger(plan.plan_revision)||plan.plan_revision<1||!object(plan.population)) {
    fail('PLAN_MISMATCH','执行计划缺少受支持的格式、编号、版本或冻结人物信息')
  }
  if (meta.snapshot_id !== snapshot.snapshot_id || meta.snapshot_revision !== snapshot.snapshot_revision) {
    fail('SNAPSHOT_MISMATCH', '轨迹与冻结快照的编号或版本不一致，请提供该次运行使用的快照')
  }
  if (plan.population.snapshot_id !== snapshot.snapshot_id || plan.population.snapshot_revision !== snapshot.snapshot_revision) {
    fail('PLAN_MISMATCH', '执行计划与冻结快照不一致')
  }
  if (meta.plan_id !== plan.plan_id || meta.plan_revision !== plan.plan_revision) fail('PLAN_MISMATCH', '轨迹与执行计划的编号或版本不一致')
  const completed = integer(meta.completed_steps, '完成步数')
  const total = integer(meta.total_steps, '计划步数', 1)
  if (completed > total || total > 10000) fail('INVALID_REPLAY', '运行步数范围无效')
  if (plan.runtime?.num_steps != null && plan.runtime.num_steps !== total) fail('PLAN_MISMATCH', '轨迹与执行计划的步数不一致')
  // Optional role-stage metadata wins; otherwise use only explicit frozen
  // snapshot role descriptions. Native plan policy IDs carry no identity text.
  const normalized = normalizeConfigPreview({network:snapshot, roles, seed:plan.runtime?.seed})
  const ids = new Set(snapshot.nodes.map(node=>node.entity_id))
  if(plan.population.expected_agent_count!==ids.size)fail('POPULATION_MISMATCH','计划人数与冻结人物快照不一致')
  const agents = array(trajectory.agents, 'agents')
  if (agents.some(agent=>!object(agent)) || agents.length !== ids.size || new Set(agents.map(agent=>agent.entity_id)).size !== ids.size || agents.some(agent=>!ids.has(agent.entity_id))) {
    fail('POPULATION_MISMATCH', '轨迹人物与冻结快照不一致')
  }
  const initialEdges = new Set()
  for (const edge of array(trajectory.initial_relationships, 'initial_relationships')) {
    if(!object(edge))fail('INVALID_REPLAY','初始关系格式无效')
    assertPerson(edge.source,ids,'初始关系'); assertPerson(edge.target,ids,'初始关系')
    if (edge.source === edge.target || !['follow','competition'].includes(edge.relation)) fail('INVALID_REPLAY','初始关系类型或端点无效')
    const edgeKey=JSON.stringify([edge.source,edge.target,edge.relation])
    if(initialEdges.has(edgeKey))fail('INVALID_REPLAY','运行记录包含重复初始关系')
    initialEdges.add(edgeKey)
  }
  array(trajectory.actions, 'actions')
  if (!object(trajectory.objects)) fail('INVALID_REPLAY', '轨迹缺少对象证据')
  array(trajectory.objects.orders, 'objects.orders')
  for(const key of ['posts','ads'])if(trajectory.objects[key]!=null)array(trajectory.objects[key],`objects.${key}`)
  if (context.engine_run_id != null && context.engine_run_id !== trajectory.run_id) fail('RUN_MISMATCH', '轨迹不属于所选引擎运行')
  return normalized
}

function economyIndex(plan, people) {
  const brands = new Map(), products = new Map(), byOwner = new Map()
  const economy = plan.economy
  if (economy == null) return {brands, products, byOwner}
  for (const brand of array(economy.brands,'计划品牌')) {
    if(!object(brand))fail('INVALID_BRAND','计划品牌格式无效')
    contextId(brand.brand_id, '品牌编号'); assertPerson(brand.owner_entity_id,people,'品牌经营者')
    if (brands.has(brand.brand_id)) fail('INVALID_BRAND','计划包含重复品牌编号')
    brands.set(brand.brand_id,brand)
    const owned=byOwner.get(brand.owner_entity_id)||[]; owned.push(brand.brand_id); byOwner.set(brand.owner_entity_id,owned)
  }
  for (const product of array(economy.products,'计划商品')) {
    if (!object(product) || typeof product.product_name !== 'string' || !product.product_name || products.has(product.product_name) || !brands.has(product.brand_id)) {
      fail('INVALID_PRODUCT','计划商品与品牌对应关系无效')
    }
    products.set(product.product_name,product)
  }
  return {brands, products, byOwner}
}
function brandForAction(action, economy, evidenceBrandId) {
  const args=action.args||{}, result=object(action.result)?action.result:{}, targets=action.targets||[]
  const target=targets.find(item=>item.type==='product')
  const product=economy.products.get(result.product_name || args.product_name || target?.product_name)
  const brandId=product?.brand_id || result.brand_id || target?.brand_id || evidenceBrandId
  if (brandId) {
    if (!economy.brands.has(brandId) || (target?.brand_id && target.brand_id!==brandId) ||
        (result.brand_id && result.brand_id!==brandId) || (evidenceBrandId && evidenceBrandId!==brandId)) fail('INVALID_BRAND','动作商品与计划品牌不一致')
    return brandId
  }
  const owned=economy.byOwner.get(action.actor.entity_id)||[]
  if (owned.length!==1) fail('AMBIGUOUS_BRAND','无法唯一确定经营者对应的品牌，请提供商品或品牌标识')
  return owned[0]
}
function resultText(value) { return typeof value==='string'?value:JSON.stringify(value??{}) }
function buildEvents(trajectory, economy, people) {
  const events=[], seenActions=new Set(), seenOrders=new Set(), noop=new Map()
  const orders=new Map()
  for (const order of trajectory.objects.orders) {
    if (!object(order) || !order.order_id || orders.has(order.order_id)) fail('INVALID_ORDERS','订单证据编号无效或重复')
    orders.set(order.order_id,order)
  }
  for (const [index,action] of trajectory.actions.entries()) {
    if (!object(action)||typeof action.id!=='string'||seenActions.has(action.id)||!OUTCOMES.has(action.outcome)) fail('INVALID_ACTION','动作编号或结果状态无效')
    seenActions.add(action.id)
    if(action.targets!=null&&!Array.isArray(action.targets))fail('INVALID_ACTION','动作目标必须是数组')
    if(action.targets?.some(target=>!object(target)))fail('INVALID_ACTION','动作目标格式无效')
    if(action.args!=null&&!object(action.args))fail('INVALID_ACTION','动作参数必须是对象')
    const actor=action.actor?.entity_id; assertPerson(actor,people,'动作')
    const step=integer(action.step,'动作步号')
    if(step>trajectory.metadata.total_steps)fail('INVALID_ACTION','动作超出计划步数')
    if(typeof action.action!=='string'||!action.action)fail('INVALID_ACTION','动作缺少名称')
    if(action.outcome==='noop'){noop.set(step,(noop.get(step)||0)+1);continue}
    const event={key:action.id,step,line:action.audit_line??index+1,sequence:action.sequence??index+1,
      stage:action.origin==='initialization'?'initialization':action.phase||action.stage||'unknown', origin:action.origin,
      actor, action:action.action, outcome:action.outcome, raw_result:clone(action.result??null)}
    integer(event.line,'动作审计序号');integer(event.sequence,'动作顺序')
    if(action.outcome!=='executed'){
      event.type=action.outcome;event.text=resultText(action.result);events.push(event);continue
    }
    const args=object(action.args)?action.args:{},result=object(action.result)?action.result:{}
    event.type=Object.hasOwn(ACTION_TYPES,action.action)?ACTION_TYPES[action.action]:'other'
    if(action.action==='purchase_product'){
      const orderId=result.order_id
      if(!orderId||!orders.has(orderId))fail('ORDER_MISMATCH','成功购买动作缺少配套订单证据')
      if(seenOrders.has(orderId))continue
      const order=orders.get(orderId),brandId=brandForAction(action,economy),brand=economy.brands.get(brandId)
      const amount=integer(result.amount_fen??order.amount_fen??order.amount,'订单金额')
      const quantity=integer(result.quantity??args.purchase_num??order.quantity??1,'购买数量',1)
      if(order.brand_id!==brandId||(order.entity_id!=null&&order.entity_id!==actor)||
          (order.amount_fen??order.amount)!==amount || (order.quantity!=null&&order.quantity!==quantity) ||
          (order.product_name!=null&&order.product_name!==(result.product_name||args.product_name)))fail('ORDER_MISMATCH','成功购买动作与订单证据不一致')
      const unitPrice=order.unit_price_fen??order.unit_price
      if(unitPrice!=null && integer(unitPrice,'订单单价')*quantity!==amount)fail('ORDER_MISMATCH','订单数量、单价和金额不一致')
      const target=(action.targets||[]).find(item=>item.type==='product')
      if(target?.owner_entity_id&&target.owner_entity_id!==brand.owner_entity_id)fail('INVALID_BRAND','购买目标与品牌经营者不一致')
      seenOrders.add(orderId)
      Object.assign(event,{order_id:orderId,brand_id:brandId,target:brand.owner_entity_id,amount_fen:amount,quantity,
        product_name:result.product_name||args.product_name||order.product_name})
    }else if(action.action==='publish_ad'||action.action==='set_product_price'){
      const ad=action.action==='publish_ad'?(trajectory.objects.ads||[]).find(ad=>ad.post_id===result.post_id):null
      const brandId=brandForAction(action,economy,ad?.brand_id)
      if(economy.brands.get(brandId).owner_entity_id!==actor)fail('INVALID_BRAND','广告或调价主体不是该品牌经营者')
      event.brand_id=brandId
      if(action.action==='publish_ad'){
        const targeted=ad?.target_entity_ids||[]
        for(const id of targeted)assertPerson(id,people,'广告受众')
        Object.assign(event,{post_id:result.post_id,text:args.content||'',cost_fen:integer(result.cost_fen??ad?.cost_fen??ad?.cost??0,'广告金额'),targeted:clone(targeted)})
      }else event.price_fen=integer(result.price_fen??result.price??args.price_fen??args.price,'商品价格')
    }else if(action.action==='create_post')Object.assign(event,{post_id:result.post_id,text:args.content||''})
    else if(action.action==='create_comment'){
      const target=(action.targets||[]).find(item=>item.type==='post')
      if(target?.author_entity_id)assertPerson(target.author_entity_id,people,'评论')
      Object.assign(event,{post_id:args.post_id,target:target?.author_entity_id,text:args.content||''})
    }else if(action.action==='follow'){
      event.target=(action.targets||[]).find(item=>item.type==='agent')?.entity_id
      assertPerson(event.target,people,'关注')
    }else if(action.action==='interview')Object.assign(event,{text:result.content||'',round:'other'})
    events.push(event)
  }
  if(seenOrders.size!==orders.size)fail('ORDER_MISMATCH','订单证据与成功动作未完全对应，无法生成可信回放')
  events.sort((a,b)=>a.step-b.step||a.line-b.line||a.sequence-b.sequence||a.key.localeCompare(b.key))
  events.forEach((event,index)=>{event.i=index})
  return {events,noop}
}
function replayTime(plan,meta,mapTime){
  const source=plan.runtime?.time?.start_time, start=source||mapTime?.start||'2026-01-01T00:00:00+08:00'
  const startMs=Date.parse(start)
  if(!Number.isFinite(startMs))fail('INVALID_REPLAY','计划起始时间无效')
  const timezone=plan.runtime?.time?.timezone||mapTime?.timezone||'Asia/Shanghai'
  let formatter
  try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'})}
  catch{fail('INVALID_REPLAY','计划时区无效，请提供受支持的 IANA 时区名称')}
  const localTimestamp=milliseconds=>{
    const parts=Object.fromEntries(formatter.formatToParts(new Date(milliseconds)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))
    const rawOffset=parts.timeZoneName.replace(/^GMT/,'')
    const offset=!rawOffset||rawOffset==='+00:00'?'Z':rawOffset
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
  }
  const unit=meta.step_unit==='hour'?'hour':'day',duration=unit==='hour'?3600000:86400000
  return {start:localTimestamp(startMs),timezone,step_unit:unit,steps:meta.total_steps,
    intervals:Array.from({length:meta.total_steps},(_,i)=>({start:localTimestamp(startMs+i*duration),end:localTimestamp(startMs+(i+1)*duration)}))}
}

/** 将团队格式终态记录转换为两种地图共用的通用回放。 */
export function buildGenericReplayScenario(bundle,mapScenario){
  const {trajectory,snapshot,plan,context={},placementRules={}}=bundle
  const normalized=validateRunReplay(bundle)
  const scenario=buildConfigPreviewScenario(normalized,mapScenario,placementRules)
  const scene=scenario.files['trajectory.json'], people=new Map(scene.people.map(person=>[person.id,person]))
  const economy=economyIndex(plan,people),{events,noop}=buildEvents(trajectory,economy,people)
  const products=[...economy.products.values()]
  scene.brands=[...economy.brands.values()].map(brand=>({brand_id:brand.brand_id,merchant_id:brand.owner_entity_id,
    owner_entity_id:brand.owner_entity_id,location_id:people.get(brand.owner_entity_id).location_key,
    product_name:products.filter(product=>product.brand_id===brand.brand_id).map(product=>product.product_name).join('、')||brand.brand_id}))
  scene.events=events;scene.relationships=clone(trajectory.initial_relationships)
  scene.posts=Object.fromEntries((trajectory.objects.posts||[]).map(post=>[String(post.post_id),{author:post.author_entity_id,content:post.content||''}]))
  const byType=Object.fromEntries([...new Set(events.map(event=>event.type))].map(type=>[type,events.filter(event=>event.type===type).length]))
  const purchases=events.filter(event=>event.type==='purchase'),lastStep=Math.max(0,trajectory.metadata.completed_steps,...events.map(event=>event.step),...noop.keys())
  scene.summary={people:people.size,relationships:scene.relationships.length,events:events.length,orders:purchases.length,
    revenue_fen:purchases.reduce((sum,event)=>sum+event.amount_fen,0),noop:[...noop.values()].reduce((a,b)=>a+b,0),
    declined:byType.declined||0,unknown:byType.unknown||0,failed:byType.failed||0,by_type:byType}
  scene.days=Array.from({length:lastStep+1},(_,step)=>({step,label:step===0?'初始化':`第 ${step} ${trajectory.metadata.step_unit==='day'?'天':'步'}`,
    complete:step<=trajectory.metadata.completed_steps,counts:Object.fromEntries([...new Set(events.filter(e=>e.step===step).map(e=>e.type))].map(type=>[type,events.filter(e=>e.step===step&&e.type===type).length])),noop:noop.get(step)||0}))
  Object.assign(scene.meta,{mode:'generic_replay',config_preview:false,generic_replay:true,run_id:trajectory.run_id,
    synthetic:trajectory.metadata.synthetic===true,
    application_run_id:context.run_id||null,config_id:context.config_id||null,session_id:context.session_id||null,
    status:trajectory.status,partial:trajectory.partial,plan_id:plan.plan_id,plan_revision:plan.plan_revision,
    completed_steps:trajectory.metadata.completed_steps,total_steps:trajectory.metadata.total_steps,step_unit:trajectory.metadata.step_unit,
    time_source:plan.runtime?.time?.start_time?'plan':'display_default',limitations:clone(trajectory.metadata.limitations||[])})
  scenario.manifest={...scenario.manifest,id:'generic-replay',title:scene.meta.synthetic?'合成样例 · 通用运行回放':'通用模拟 · 运行回放',preview_mode:'replay',simulation_data:true,
    context:clone(context),simulation_time:replayTime(plan,trajectory.metadata,mapScenario.manifest.simulation_time)}
  return scenario
}

/** 按草案接口读取运行详情、冻结快照、轨迹及该次配置的计划。 */
export async function loadRunReplay({session,run,signal,fetcher=fetch}={}){
  contextId(session,'会话编号');contextId(run,'运行编号')
  const prefix=`/api/sessions/${encodeURIComponent(session)}/runs/${encodeURIComponent(run)}`
  async function read(url,label){
    let response
    try{response=await fetcher(url,{signal,cache:'no-store',credentials:'same-origin'})}
    catch(error){if(error.name==='AbortError')throw error;fail('NETWORK_ERROR','运行服务暂时无法连接，请稍后重试')}
    if(response.status===401)fail('LOGIN_REQUIRED','登录已失效，请返回团队网站重新登录')
    if(response.status===404)fail('REPLAY_NOT_FOUND',`${label}不存在或当前账号无权访问`)
    if(response.status===409)fail('RUN_PENDING','运行产物尚未准备完成，请等待任务结束后重试')
    if(!response.ok)fail('HTTP_ERROR',`运行服务暂不可用（${response.status}）`)
    try{return await response.json()}catch{fail('INVALID_RESPONSE',`${label}不是有效 JSON`)}
  }
  const detail=await read(prefix,'运行')
  if(!object(detail)||detail.id!==run)fail('RUN_MISMATCH','运行详情与所选运行不一致')
  if(!TERMINAL.has(detail.status))fail('RUN_PENDING','运行尚未结束，终态轨迹还未准备完成')
  const config=contextId(detail.config_id,'配置编号')
  const [trajectory,snapshot,stage]=await Promise.all([
    read(prefix+'/artifacts/trajectory','运行轨迹'),read(prefix+'/artifacts/population-snapshot','冻结快照'),
    read(`/api/sessions/${encodeURIComponent(session)}/configs/${encodeURIComponent(config)}/stages/plan`,'执行计划')])
  if(!object(stage))fail('INVALID_RESPONSE','执行计划响应格式不正确')
  if(!object(trajectory))fail('INVALID_RESPONSE','运行轨迹响应格式不正确')
  if(stage.name!=='plan'||stage.status!=='completed'||!object(stage.payload))fail('PLAN_PENDING','该次运行的执行计划尚未准备完成')
  if(stage.config_id!=null&&stage.config_id!==config)fail('PLAN_MISMATCH','执行计划不属于该次运行的配置')
  if(trajectory.status!==detail.status)fail('RUN_MISMATCH','运行状态与轨迹状态不一致，请稍后重试')
  const result={trajectory,snapshot,plan:stage.payload,context:{session_id:session,run_id:run,config_id:config}}
  if(detail.engine_run_id!=null)result.context.engine_run_id=detail.engine_run_id
  validateRunReplay(result)
  return result
}
