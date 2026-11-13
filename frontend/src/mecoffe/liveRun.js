// Live input is a read-only projection. It is deliberately separate from the
// strict terminal trajectory format and never invents successful orders.
import {ConfigPreviewError, normalizeConfigPreview} from './configPreview.js'
import {buildGenericReplayScenario, loadRunReplay, validateRunReplay} from './genericReplay.js'

export const LIVE_API_PATHS = Object.freeze({
  run:'/api/sessions/{session}/runs/{run}',
  bootstrap:'/api/sessions/{session}/runs/{run}/scene/bootstrap',
  events:'/api/sessions/{session}/runs/{run}/scene/events',
  roles:'/api/sessions/{session}/configs/{config}/stages/roles',
})
export const LIVE_POLL_MS = 2000
export const LIVE_REQUEST_TIMEOUT_MS = 15000
export const LIVE_QUEUE_LIMIT = 32
const TERMINAL = new Set(['completed','failed','cancelled'])
const STATUSES = new Set(['queued','initializing','running',...TERMINAL])
const OUTCOMES = new Set(['executed','declined','failed','noop','unknown'])
const QUIET = new Set(['refresh','trend','search_posts','search_user','do_nothing'])
const TYPES = {create_post:'post',create_comment:'comment',publish_ad:'ad',follow:'follow',set_product_price:'price'}
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const object = value => value!==null && typeof value==='object' && !Array.isArray(value)
const clone = value => structuredClone(value)
const fail = (code,message) => {throw new ConfigPreviewError(code,message)}
function id(value,label){if(typeof value!=='string'||!ID.test(value))fail('INVALID_LIVE',`${label}无效`);return value}
function integer(value,label,min=0){if(!Number.isSafeInteger(value)||value<min)fail('INVALID_LIVE',`${label}必须是有效整数`);return value}
function text(value,max=500){return typeof value==='string'?Array.from(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')).slice(0,max).join(''):''}
function list(value,label){if(!Array.isArray(value))fail('INVALID_LIVE',`${label}必须是列表`);return value}
function status(value){if(!STATUSES.has(value))fail('INVALID_LIVE','运行状态不受支持');return value}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  return JSON.stringify(value)
}
export function liveApiPath(name,{session,run,config}={}){
  id(session,'会话编号');id(run,'运行编号')
  if(!Object.hasOwn(LIVE_API_PATHS,name))fail('INVALID_LIVE','实时接口名称无效')
  if(name==='roles')id(config,'配置编号')
  return LIVE_API_PATHS[name].replace('{session}',encodeURIComponent(session)).replace('{run}',encodeURIComponent(run)).replace('{config}',encodeURIComponent(config))
}
function baseTrajectory(bootstrap){
  const {snapshot,plan}=bootstrap
  return {kind:'oasis.interaction_trajectory',schema_version:'1.0',run_id:bootstrap.engine_run_id,
    status:'completed',partial:false,metadata:{...bootstrap.metadata,completed_steps:0,total_steps:plan.runtime.num_steps,step_unit:bootstrap.step_unit||'day'},
    agents:snapshot.nodes.map(node=>({entity_id:node.entity_id})),initial_relationships:clone(snapshot.edges),actions:[],objects:{orders:[],posts:[],ads:[]}}
}
/** Validate frozen versions before a single person or activity is displayed. */
export function validateLiveBootstrap(value,{session,run,detail}={}){
  if(!object(value)||value.schema_version!=='scene.live.v1')fail('INVALID_LIVE','实时初始化格式版本不受支持')
  if(value.run_id!==run)fail('RUN_MISMATCH','实时数据不属于当前运行')
  id(value.run_id,'运行编号');id(value.engine_run_id,'引擎运行编号');id(value.config_id,'配置编号')
  if(detail && (detail.id!==run||detail.config_id!==value.config_id||detail.engine_run_id&&detail.engine_run_id!==value.engine_run_id))fail('RUN_MISMATCH','实时初始化与运行详情不一致')
  if(!object(value.snapshot)||!object(value.plan)||!object(value.metadata))fail('INVALID_LIVE','实时初始化缺少冻结输入')
  const result={schema_version:'scene.live.v1',run_id:value.run_id,engine_run_id:value.engine_run_id,config_id:value.config_id,
    session_id:session,status:status(value.status),phase:text(value.phase,80),snapshot:clone(value.snapshot),plan:clone(value.plan),
    metadata:Object.fromEntries(['snapshot_id','snapshot_revision','plan_id','plan_revision'].map(key=>[key,value.metadata[key]])),step_unit:value.step_unit==='hour'?'hour':'day',synthetic:value.synthetic===true}
  const context={session_id:session,run_id:run,config_id:result.config_id,engine_run_id:result.engine_run_id}
  validateRunReplay({trajectory:baseTrajectory(result),snapshot:result.snapshot,plan:result.plan,context})
  // Optional labels cannot turn a valid frozen run into an unavailable map.
  if(value.roles){try{normalizeConfigPreview({network:result.snapshot,roles:value.roles,session,config:result.config_id,seed:result.plan.runtime.seed});result.roles=clone(value.roles)}catch{}}
  return result
}
function economy(bootstrap){
  const brands=new Map(),products=new Map()
  for(const brand of bootstrap.plan.economy?.brands||[])brands.set(brand.brand_id,brand)
  for(const product of bootstrap.plan.economy?.products||[])products.set(product.product_name,product)
  return {brands,products}
}
/** A complete log line is a decision batch; the server splits its tool calls. */
export function normalizeLiveEvent(raw,bootstrap){
  if(!object(raw)||!object(raw.source)||!object(raw.agent)||!OUTCOMES.has(raw.outcome))fail('INVALID_LIVE','实时动作格式无效')
  const source=raw.source,engine=bootstrap.engine_run_id
  if(source.run_id!==engine)fail('RUN_MISMATCH','实时动作属于其他引擎运行')
  const line=integer(source.audit_line,'审计行号',1),call=integer(source.tool_call_index,'工具序号')
  if(call>=10000||line>Math.floor(Number.MAX_SAFE_INTEGER/10000))fail('INVALID_LIVE','动作序号超出支持范围')
  const actor=id(raw.agent.entity_id,'人物编号')
  if(!bootstrap.snapshot.nodes.some(node=>node.entity_id===actor))fail('UNKNOWN_PERSON','实时动作引用了快照外的人物')
  const step=integer(raw.step,'动作步号')
  if(step>bootstrap.plan.runtime.num_steps)fail('INVALID_LIVE','实时动作超出计划步数')
  const action=id(raw.action,'动作名称'),key=`${engine}:${line}:${call}`
  const event={key,source:{run_id:engine,audit_line:line,tool_call_index:call},step,line,sequence:line*10000+call,
    actor,action,outcome:raw.outcome,origin:'live',stage:text(raw.stage,80)||'live',
    type:raw.outcome==='executed'?(TYPES[action]||'other'):raw.outcome,
    text:text(raw.text),message:text(raw.message,240),evidence_status:'not_required'}
  if(raw.outcome!=='executed'&&!event.text)event.text=event.message
  if(raw.target!=null){
    if(!bootstrap.snapshot.nodes.some(node=>node.entity_id===raw.target))fail('UNKNOWN_PERSON','实时动作目标不在快照中')
    event.target=raw.target
  }
  if(raw.post_id!=null&&(typeof raw.post_id==='string'||Number.isSafeInteger(raw.post_id)))event.post_id=raw.post_id
  const index=economy(bootstrap)
  if(raw.brand_id!=null){if(!index.brands.has(raw.brand_id))fail('INVALID_BRAND','实时动作引用了未知品牌');event.brand_id=raw.brand_id}
  if(raw.product_name!=null)event.product_name=text(raw.product_name,160)
  if(raw.order_id!=null)event.order_id=id(raw.order_id,'订单编号')
  if(action==='purchase_product'&&raw.outcome==='executed'){
    const product=index.products.get(raw.product_name)
    if(!product||raw.brand_id&&raw.brand_id!==product.brand_id)fail('INVALID_BRAND','购买商品与冻结计划不一致')
    event.brand_id=product.brand_id;event.target=index.brands.get(product.brand_id).owner_entity_id
    if(raw.order_id!=null)event.order_id=id(raw.order_id,'订单编号')
    if(raw.quantity!=null)event.quantity=integer(raw.quantity,'购买数量',1)
    if(raw.amount_fen!=null)event.amount_fen=integer(raw.amount_fen,'订单金额')
    event.type='purchase_pending';event.evidence_status='pending';event.text='尝试购买 · 订单待核对'
  }
  if(action==='set_product_price'&&raw.price_fen!=null)event.price_fen=integer(raw.price_fen,'商品价格')
  if(action==='publish_ad'&&raw.cost_fen!=null)event.cost_fen=integer(raw.cost_fen,'广告金额')
  // Only these flattened fields cross into the map; args/results/prompts and
  // arbitrary diagnostic dictionaries are deliberately not retained.
  return event
}
function normalizeDay(raw,bootstrap,completedStep){
  if(!object(raw))fail('INVALID_LIVE','日汇总格式无效')
  const step=integer(raw.step,'汇总步号',1)
  if(step>completedStep)fail('INVALID_LIVE','未完成的业务日不能提交日汇总')
  const day={step,orders:integer(raw.orders,'日订单数'),quantity:integer(raw.quantity,'日销量'),
    revenue_fen:integer(raw.revenue_fen,'日金额'),posts:integer(raw.posts,'日发帖数'),comments:integer(raw.comments??0,'日评论数'),verified_orders:[],verified_order_ids:[]}
  const ids=new Set(),people=new Set(bootstrap.snapshot.nodes.map(n=>n.entity_id)),index=economy(bootstrap)
  for(const rawOrder of list(raw.verified_orders||[],'已核实订单')){
    if(!object(rawOrder))fail('INVALID_LIVE','订单证据格式无效')
    const order={order_id:id(rawOrder.order_id,'订单编号'),entity_id:id(rawOrder.entity_id,'订单人物'),brand_id:id(rawOrder.brand_id,'订单品牌'),
      product_name:text(rawOrder.product_name,160),quantity:integer(rawOrder.quantity,'订单数量',1),amount_fen:integer(rawOrder.amount_fen,'订单金额'),step}
    if(ids.has(order.order_id)||!people.has(order.entity_id)||index.products.get(order.product_name)?.brand_id!==order.brand_id)fail('ORDER_MISMATCH','日汇总订单与冻结人物或商品不一致')
    ids.add(order.order_id);day.verified_orders.push(order)
  }
  for(const orderId of list(raw.verified_order_ids||[],'已核实订单编号')){
    id(orderId,'订单编号');if(ids.has(orderId))continue;ids.add(orderId);day.verified_order_ids.push(orderId)
  }
  if(ids.size!==day.orders)fail('ORDER_MISMATCH','日订单数与已核实订单编号数量不一致')
  if(!day.verified_order_ids.length&&(day.verified_orders.reduce((n,o)=>n+o.quantity,0)!==day.quantity||day.verified_orders.reduce((n,o)=>n+o.amount_fen,0)!==day.revenue_fen))fail('ORDER_MISMATCH','日汇总金额或销量与订单证据不一致')
  return day
}
export function createLiveState(bootstrap){
  return {bootstrap:clone(bootstrap),mode:'live',status:bootstrap.status,phase:bootstrap.phase,completedStep:0,activeStep:0,
    journal:new Map(),days:new Map(),events:[],summary:{people:bootstrap.snapshot.nodes.length,relationships:bootstrap.snapshot.edges.length,events:0,orders:0,quantity:0,revenue_fen:0,posts:0,comments:0,declined:0,unknown:0,failed:0,noop:0,by_type:{}},
    cursor:'',done:false,paused:false,animationQueue:[],animated:new Set(),revision:0,message:'本日进行中，汇总尚未更新',error:null,partial:false}
}
function rebuild(state){
  const verified=new Map(),knownIds=new Set(),summary={...state.summary,orders:0,quantity:0,revenue_fen:0,posts:0,comments:0,declined:0,unknown:0,failed:0,noop:0,by_type:{}}
  state.evidenceWarning=''
  for(const day of state.days.values()){
    summary.posts+=day.posts;summary.comments+=day.comments
    for(const order of day.verified_orders){if(knownIds.has(order.order_id))fail('ORDER_MISMATCH','同一订单出现在多个日汇总中');knownIds.add(order.order_id);verified.set(order.order_id,order)}
    const resolved=[...day.verified_orders]
    for(const orderId of day.verified_order_ids){
      if(knownIds.has(orderId))fail('ORDER_MISMATCH','同一订单出现在多个日汇总中');knownIds.add(orderId)
      const matches=[...state.journal.values()].filter(e=>e.order_id===orderId&&e.action==='purchase_product'&&e.outcome==='executed')
      if(matches.length>1)fail('ORDER_MISMATCH','多个动作声明了同一订单')
      const event=matches[0]
      if(event&&event.step===day.step&&event.quantity!=null&&event.amount_fen!=null){
        const order={order_id:orderId,entity_id:event.actor,brand_id:event.brand_id,product_name:event.product_name,quantity:event.quantity,amount_fen:event.amount_fen,step:event.step}
        resolved.push(order);verified.set(orderId,order)
      }else state.evidenceWarning='日汇总的订单证据不完整，等待配套动作；尚未计入成功订单'
    }
    if(resolved.length===day.orders&&(resolved.reduce((n,o)=>n+o.quantity,0)!==day.quantity||resolved.reduce((n,o)=>n+o.amount_fen,0)!==day.revenue_fen))fail('ORDER_MISMATCH','日汇总金额或销量与订单证据不一致')
    summary.orders+=resolved.length;summary.quantity+=resolved.reduce((n,o)=>n+o.quantity,0);summary.revenue_fen+=resolved.reduce((n,o)=>n+o.amount_fen,0)
  }
  for(const event of state.journal.values()){
    if(event.action==='purchase_product'&&event.outcome!=='executed'&&knownIds.has(event.order_id))fail('ORDER_MISMATCH','日汇总订单与被拒绝或未确认的动作冲突')
  }
  const events=[],claimedOrders=new Set()
  for(const original of state.journal.values()){
    const event=clone(original)
    if(event.action==='purchase_product'&&event.outcome==='executed'){
      const day=state.days.get(event.step),order=verified.get(event.order_id)
      if(order){
        if(order.step!==event.step||order.entity_id!==event.actor||order.brand_id!==event.brand_id||order.product_name!==event.product_name||event.quantity!=null&&event.quantity!==order.quantity||event.amount_fen!=null&&event.amount_fen!==order.amount_fen)fail('ORDER_MISMATCH','动作与已核实订单不一致')
        Object.assign(event,{quantity:order.quantity,amount_fen:order.amount_fen})
      }
      if(order){
        if(claimedOrders.has(event.order_id))fail('ORDER_MISMATCH','多个动作声明了同一订单')
        claimedOrders.add(event.order_id);event.type='purchase';event.evidence_status='verified';event.text='购买已核实'
      }else if(day?.verified_order_ids.includes(event.order_id)){event.evidence_status='incomplete';event.text='订单证据不完整，等待核对'}
      else if(day){event.evidence_status='unverified';event.text='订单未核实'}
    }
    if(['declined','unknown','failed','noop'].includes(event.outcome))summary[event.outcome]++
    summary.by_type[event.type]=(summary.by_type[event.type]||0)+1;events.push(event)
  }
  events.sort((a,b)=>a.step-b.step||a.line-b.line||a.source.tool_call_index-b.source.tool_call_index)
  for(const day of state.days.values()){
    if(!day.verified_order_ids.length)continue
    const dayEvents=events.filter(e=>e.type==='purchase'&&e.step===day.step)
    if(dayEvents.length===day.orders&&(dayEvents.reduce((n,e)=>n+e.quantity,0)!==day.quantity||dayEvents.reduce((n,e)=>n+e.amount_fen,0)!==day.revenue_fen))fail('ORDER_MISMATCH','日汇总金额或销量与已核实动作不一致')
  }
  events.forEach((e,i)=>{e.i=i});state.events=events;summary.events=events.length;state.summary=summary
  for(const event of events){
    const animationKey=`${event.key}|${event.type}|${event.order_id||''}|${event.evidence_status}`
    if(state.animated.has(animationKey)||QUIET.has(event.action)||event.outcome==='noop')continue
    state.animated.add(animationKey)
    // Coalesce this person's backlog. Historical events remain in the journal.
    if(state.animationQueue.filter(e=>e.actor===event.actor).length>=2){const at=state.animationQueue.findIndex(e=>e.actor===event.actor);state.animationQueue.splice(at,1)}
    state.animationQueue.push(clone(event));if(state.animationQueue.length>LIVE_QUEUE_LIMIT)state.animationQueue.shift()
  }
}
/** Apply a whole page transactionally; a bad late item never advances cursor. */
export function applyLivePage(previous,page){
  if(!object(page))fail('INVALID_LIVE','实时服务响应格式无效')
  const state=clone(previous),nextStatus=status(page.status)
  const completed=integer(page.completed_step,'已完成步数'),active=integer(page.active_step,'当前步数')
  if(completed<state.completedStep||completed>state.bootstrap.plan.runtime.num_steps||active>state.bootstrap.plan.runtime.num_steps||active<completed)fail('INVALID_LIVE','实时步数倒退或超出计划')
  if(TERMINAL.has(state.status)&&!TERMINAL.has(nextStatus))fail('INVALID_LIVE','终态运行不能返回运行中')
  if(typeof page.next_cursor!=='string'||page.next_cursor.length>2048||typeof page.done!=='boolean')fail('INVALID_LIVE','实时分页信息无效')
  if(page.done&&!TERMINAL.has(nextStatus))fail('INVALID_LIVE','运行中的增量流不能提前结束')
  if(list(page.events,'决策快报').length>200||list(page.day_summaries,'日汇总').length>200)fail('INVALID_LIVE','实时分页超过单页上限')
  for(const raw of list(page.events,'决策快报')){
    const event=normalizeLiveEvent(raw,state.bootstrap),old=state.journal.get(event.key)
    if(event.step>active)fail('INVALID_LIVE','实时动作超出当前业务步')
    if(old&&canonical(old)!==canonical(event))fail('EVENT_CONFLICT','同一来源动作的内容发生变化')
    state.journal.set(event.key,event)
  }
  for(const raw of list(page.day_summaries,'日汇总')){
    const day=normalizeDay(raw,state.bootstrap,completed),old=state.days.get(day.step)
    if(old&&canonical(old)!==canonical(day))fail('SUMMARY_CONFLICT','已确认日汇总的内容发生变化')
    state.days.set(day.step,day)
  }
  state.status=nextStatus;state.completedStep=completed;state.activeStep=active;state.cursor=page.next_cursor;state.done=page.done;state.phase=text(page.phase,80)||state.phase
  state.partial=nextStatus==='failed'||nextStatus==='cancelled';state.error=null
  state.message=state.partial?'运行失败，保留已确认结果（部分）':TERMINAL.has(nextStatus)?'运行已结束，正在核对正式回放':'本日进行中，汇总尚未更新'
  rebuild(state);state.revision++;return state
}
export function setLivePaused(previous,paused){const state=clone(previous);state.paused=Boolean(paused);state.revision++;return state}
export function followLatestLive(previous){const state=clone(previous);state.paused=false;state.animationQueue=[];state.revision++;return state}
export function takeLiveAnimations(previous,limit=4){
  integer(limit,'动画批量',1);const state=clone(previous),events=state.paused?[]:state.animationQueue.splice(0,Math.min(limit,LIVE_QUEUE_LIMIT));return {state,events}
}
function liveSceneBase(state,map){
  const b=state.bootstrap,result=buildGenericReplayScenario({trajectory:baseTrajectory(b),snapshot:b.snapshot,plan:b.plan,roles:b.roles,
    context:{session_id:b.session_id,run_id:b.run_id,config_id:b.config_id,engine_run_id:b.engine_run_id},sceneResult:state.sceneResult,scenePlacement:state.scenePlacement},map)
  result.manifest.preview_mode='live';result.manifest.title=state.sceneResult||state.scenePlacement?map.manifest.title:b.synthetic?'合成样例 · 实时运行':'实时运行';result.manifest.simulation_data=true
  return result
}
/** Build geometry/population once. Later updates preserve all map identities. */
export function buildLiveScenario(state,map){return syncLiveScenario(state,liveSceneBase(state,map))}
export function syncLiveScenario(state,scenario){
  if(scenario.manifest.preview_mode!=='live')fail('INVALID_LIVE','不能将实时数据写入终态场景')
  const scene=scenario.files['trajectory.json'],total=state.bootstrap.plan.runtime.num_steps
  scene.events=clone(state.events);scene.summary=clone(state.summary)
  scene.days=Array.from({length:Math.max(1,state.activeStep,state.completedStep)+1},(_,step)=>({step,label:step===0?'初始化':`第 ${step} 天`,complete:step<=state.completedStep,counts:{},noop:0}))
  Object.assign(scene.meta,{mode:'live_run',config_preview:false,generic_replay:false,live_run:true,status:state.status,partial:state.partial,
    completed_steps:state.completedStep,total_steps:total,active_step:state.activeStep,synthetic:state.bootstrap.synthetic})
  return scenario
}
export function compareLiveTerminal(state,bundle){
  const totals={orders:0,quantity:0,revenue_fen:0,posts:0,comments:0},seen=new Set()
  for(const action of bundle.trajectory.actions){
    if(action.outcome!=='executed'||action.origin==='initialization')continue
    if(action.action==='create_post'||action.action==='publish_ad')totals.posts++
    if(action.action==='create_comment')totals.comments++
  }
  for(const order of bundle.trajectory.objects.orders){if(seen.has(order.order_id))continue;seen.add(order.order_id);totals.orders++;totals.quantity+=order.quantity??1;totals.revenue_fen+=order.amount_fen??order.amount??0}
  return Object.entries(totals).filter(([key,value])=>state.summary[key]!==value).map(([key,value])=>({field:key,live:state.summary[key],official:value}))
}
async function readResponse(fetcher,url,signal){
  let response
  try{response=await fetcher(url,{signal,credentials:'same-origin',cache:'no-store'})}catch(error){if(error.name==='AbortError'||error.code==='NETWORK_ERROR')throw error;fail('NETWORK_ERROR','实时服务暂时无法连接，将自动重试')}
  if(response.status===401)fail('LOGIN_REQUIRED','登录已失效，请返回团队网站重新登录')
  if(response.status===404)fail('LIVE_NOT_FOUND','实时接口不存在或当前账号无权访问')
  if(response.status===409)fail('LIVE_PENDING','实时数据正在准备，将自动重试')
  if(!response.ok)fail('HTTP_ERROR',`实时服务暂不可用（${response.status}），将自动重试`)
  try{
    const value=await response.json()
    if(signal?.aborted)throw Object.assign(new Error('请求已取消'),{name:'AbortError'})
    return value
  }catch(error){if(error.name==='AbortError')throw error;fail('INVALID_RESPONSE','实时服务返回了无效 JSON')}
}
function abortError(){return Object.assign(new Error('请求已取消'),{name:'AbortError'})}
// The deadline covers receiving headers AND consuming JSON. The abort race also
// releases busy when a custom fetcher or a stalled connection ignores abort.
async function fetchWithDeadline(fetcher,url,options,{timeoutMs,setRequestTimer,clearRequestTimer}){
  const request=new AbortController(),parent=options.signal
  let timer,abortListener
  const clearDeadline=()=>{if(timer!==undefined){clearRequestTimer(timer);timer=undefined}}
  const interrupted=new Promise((resolve,reject)=>{
    abortListener=()=>{clearDeadline();reject(abortError());request.abort()}
    if(parent?.aborted){abortListener();return}
    parent?.addEventListener('abort',abortListener,{once:true})
    timer=setRequestTimer(()=>{
      reject(new ConfigPreviewError('NETWORK_ERROR','实时请求超时，将自动重试'))
      request.abort()
    },timeoutMs)
  })
  const work=(async()=>{
    if(parent?.aborted)throw abortError()
    const response=await fetcher(url,{...options,signal:request.signal})
    if(parent?.aborted)throw abortError()
    if(!response.ok)return response
    let value,parseError
    try{value=await response.json()}catch(error){parseError=error}
    if(parent?.aborted)throw abortError()
    return {ok:response.ok,status:response.status,statusText:response.statusText,headers:response.headers,url:response.url,
      json:async()=>{if(parseError)throw parseError;return value}}
  })()
  try{return await Promise.race([work,interrupted])}
  finally{clearDeadline();parent?.removeEventListener('abort',abortListener)}
}
/** One non-overlapping poller per run, retaining state across view switches. */
export function createLiveRunSession({session,run,fetcher=fetch,pollMs=LIVE_POLL_MS,requestTimeoutMs=LIVE_REQUEST_TIMEOUT_MS,onChange=()=>{},loadReplay=loadRunReplay,setTimer=setTimeout,clearTimer=clearTimeout,setRequestTimer=setTimeout,clearRequestTimer=clearTimeout}={}){
  integer(requestTimeoutMs,'实时请求超时',1)
  const urls=Object.fromEntries(['run','bootstrap','events'].map(key=>[key,liveApiPath(key,{session,run})]))
  const timedFetch=(url,options)=>fetchWithDeadline(fetcher,url,options,{timeoutMs:requestTimeoutMs,setRequestTimer,clearRequestTimer})
  let state={mode:'waiting',status:'queued',message:'正在读取运行状态…',error:null,revision:0},controller=null,timer=null,stopped=true,busy=false,attempt=0,noLive=false
  function notify(){onChange(state)}
  async function readEvents(signal,drain=false){
    if(state.done&&TERMINAL.has(state.status))return true
    // Bound each catch-up request batch so an old server and the UI get a
    // breather. A terminal detail is not permission to skip the last pages.
    for(let batch=0;batch<(drain?5:1);batch++){
      const previousCursor=state.cursor
      const page=await readResponse(timedFetch,`${urls.events}?after=${encodeURIComponent(previousCursor)}&limit=200`,signal)
      state=applyLivePage(state,page);notify()
      if(state.done&&TERMINAL.has(state.status))return true
      if(!drain||state.cursor===previousCursor)break
    }
    if(drain){state={...state,message:'运行已结束，正在接收剩余活动与日汇总…',revision:state.revision+1};notify()}
    return false
  }
  async function terminal(signal){
    try{
      const bundle=await loadReplay({session,run,signal,fetcher:timedFetch})
      if(signal?.aborted)throw Object.assign(new Error('请求已取消'),{name:'AbortError'})
      validateRunReplay(bundle)
      if(state.bootstrap&&(bundle.trajectory.run_id!==state.bootstrap.engine_run_id||bundle.snapshot.snapshot_id!==state.bootstrap.snapshot.snapshot_id||bundle.snapshot.snapshot_revision!==state.bootstrap.snapshot.snapshot_revision||bundle.plan.plan_id!==state.bootstrap.plan.plan_id||bundle.plan.plan_revision!==state.bootstrap.plan.plan_revision))fail('RUN_MISMATCH','正式回放与实时运行的冻结版本不一致')
      state={...state,mode:'replay',status:bundle.trajectory.status,partial:bundle.trajectory.partial,replayBundle:bundle,
        differences:state.bootstrap?compareLiveTerminal(state,bundle):[],error:null,message:'正式回放已准备完成',revision:state.revision+1};notify();return true
    }catch(error){
      if(error.code==='RUN_PENDING'){state={...state,message:'运行已结束，正式回放产物暂未就绪，正在等待…',error:{code:error.code,message:error.message}};notify();return false}
      throw error
    }
  }
  async function poll(){
    if(stopped||busy)return
    if(state.mode==='replay'){notify();return}
    busy=true;controller=new AbortController();let finished=false,delay=Math.max(100,pollMs)
    try{
      let detail
      try{detail=await readResponse(timedFetch,urls.run,controller.signal)}catch(error){
        if(error.code==='LIVE_NOT_FOUND')fail('RUN_NOT_FOUND','运行不存在或当前账号无权访问，请核对会话和运行编号')
        throw error
      }
      if(!object(detail)||detail.id!==run)fail('RUN_MISMATCH','运行详情与选择的运行不一致')
      status(detail.status)
      if(!state.bootstrap)state={...state,status:detail.status,phase:text(detail.phase,80)}
      if(state.bootstrap&&(detail.config_id!==state.bootstrap.config_id||detail.engine_run_id!==state.bootstrap.engine_run_id))fail('RUN_MISMATCH','运行详情的冻结配置或引擎运行编号发生变化')
      if(TERMINAL.has(detail.status)){
        if(!state.bootstrap||await readEvents(controller.signal,true))finished=await terminal(controller.signal)
      }
      else if(noLive){state={...state,status:detail.status,message:'团队后端尚未提供实时接口，运行结束后可查看回放',error:null};notify()}
      else{
        if(!state.bootstrap){
          let bootstrap
          try{bootstrap=await readResponse(timedFetch,urls.bootstrap,controller.signal)}catch(error){
            if(error.code!=='LIVE_NOT_FOUND')throw error
            noLive=true;state={...state,status:detail.status,message:'团队后端尚未提供实时接口，运行结束后可查看回放',error:null};notify();return
          }
          const checked=validateLiveBootstrap(bootstrap,{session,run,detail})
          if(!checked.roles){
            try{
              const roles=await readResponse(timedFetch,liveApiPath('roles',{session,run,config:checked.config_id}),controller.signal)
              normalizeConfigPreview({network:checked.snapshot,roles,session,config:checked.config_id,seed:checked.plan.runtime.seed});checked.roles=roles
            }catch(error){if(error.name==='AbortError'||error.code==='LOGIN_REQUIRED')throw error}
          }
          state=createLiveState(checked);notify()
        }
        if(await readEvents(controller.signal))finished=await terminal(controller.signal)
      }
      attempt=0
    }catch(error){
      if(error.name==='AbortError')return
      if(error.code==='LOGIN_REQUIRED'){
        state={mode:'waiting',status:'unavailable',error:{code:error.code,message:error.message},message:error.message,revision:(state.revision||0)+1};stopped=true;notify()
      }else{
        attempt++;delay=Math.min(30000,Math.max(100,pollMs)*2**Math.min(attempt,4))
        const message=error.code==='LIVE_NOT_FOUND'?'实时动作接口不存在或当前账号无权访问，请联系团队管理员':error.message
        state={...state,error:{code:error.code||'LIVE_ERROR',message},message,revision:(state.revision||0)+1};notify()
      }
    }finally{
      busy=false;if(!stopped&&!finished)timer=setTimer(()=>void poll(),delay)
    }
  }
  return {
    start(){if(state.mode==='replay'){notify();return}if(!stopped)return;stopped=false;void poll()},
    stop(){stopped=true;clearTimer(timer);controller?.abort()},
    retry(){clearTimer(timer);if(!busy){stopped=false;void poll()}},
    snapshot(){return state},
    pause(value=true){if(state.bootstrap){state=setLivePaused(state,value);notify()}},
    followLatest(){if(state.bootstrap){state=followLatestLive(state);notify()}},
    takeAnimations(limit=4){if(!state.bootstrap)return [];const result=takeLiveAnimations(state,limit);state=result.state;return result.events},
    async pollOnce(){const wasStopped=stopped;stopped=false;clearTimer(timer);await poll();clearTimer(timer);stopped=wasStopped;return state},
  }
}
