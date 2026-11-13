// Team map-stage presentation binding. No database, compilation or revision rewriting.
import {checkScenePlacement} from './scenePlacement.js'
import {describeSceneIssue} from './sceneIssues.js'

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
const canonical=value=>JSON.stringify(order(value))
function order(value){
  if(Array.isArray(value))return value.map(order)
  if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])]))
  return value
}
function error(code,message){const e=new Error(message);e.code=code;return e}
const blocked=(context,message,code='REF_MISMATCH')=>({...context,kind:'blocked',message,code,placement:null,revisionNote:''})

export async function loadTeamScene({session,config,run,fetcher=fetch,signal}={}){
  if(!identifier(session)||!identifier(config)||(run!=null&&!identifier(run)))throw error('INVALID_CONTEXT','会话、配置或运行编号无效')
  const base=`/api/sessions/${encodeURIComponent(session)}`
  async function read(url){
    let response
    try{response=await fetcher(url,{signal,cache:'no-store',credentials:'same-origin'})}
    catch(e){if(e.name==='AbortError')throw e;throw error('NETWORK_ERROR','团队服务暂时无法连接，请稍后重试')}
    if(response.status===401)throw error('LOGIN_REQUIRED','登录已失效，请返回团队网站重新登录')
    if(!response.ok)throw error(response.status===404?'CONFIG_NOT_FOUND':'HTTP_ERROR',`团队数据不可读取（${response.status}）`)
    try{return await response.json()}catch(e){if(e.name==='AbortError')throw e;throw error('INVALID_RESPONSE','团队服务返回的不是有效 JSON')}
  }
  const detail=await read(base)
  if(!object(detail)||detail.session?.id!==session||!Array.isArray(detail.configs)||!Array.isArray(detail.scenarios))throw error('INVALID_RESPONSE','会话详情与所选会话不一致，不能判断是否启用地图')
  const configs=detail.configs.filter(item=>object(item)&&item.id===config)
  if(configs.length!==1)throw error('CONFIG_NOT_FOUND','这份配置不在当前会话中，不能按旧版场景处理')
  const selected=configs[0]
  if(!identifier(selected.scenario_id))throw error('CONFIG_NOT_FOUND','这份配置缺少有效的需求版本引用，不能按旧配置处理')
  const scenarios=detail.scenarios.filter(item=>object(item)&&item.id===selected.scenario_id)
  if(scenarios.length!==1||!object(scenarios[0].content))throw error('CONFIG_NOT_FOUND','找不到这份配置对应的需求版本，不能使用会话最新需求代替')
  if(run!=null){
    const runs=Array.isArray(detail.runs)?detail.runs.filter(item=>object(item)&&item.id===run):[]
    if(runs.length!==1||runs[0].config_id!==config)throw error('RUN_MISMATCH','运行与所选配置或会话不一致')
  }
  const requirement=scenarios[0].content
  const context={configId:config,config:selected,requirement,sceneResult:null,revisionNote:''}
  if(!Object.hasOwn(requirement,'map'))return {...context,kind:'legacy',message:'旧版示意场景，未使用地图阶段'}
  if(requirement.map===false)return {...context,kind:'none',message:'这份配置未启用地图'}
  if(requirement.map!==true)return blocked(context,'这份需求的地图开关无效，不能作为旧配置显示','INVALID_INPUT')
  let stage
  try{stage=await read(`${base}/configs/${encodeURIComponent(config)}/stages/map`)}
  catch(e){if(e.name==='AbortError'||e.code==='LOGIN_REQUIRED')throw e;return blocked({...context,stage:{name:'map',status:'missing'}},e.code==='CONFIG_NOT_FOUND'?'这份配置启用了地图，但地图阶段尚未登记或不可读取。请先在配置页处理地图阶段。':e.message,e.code)}
  context.stage=stage
  if(!object(stage)||stage.name!=='map'||(stage.config_id!=null&&stage.config_id!==config))return blocked(context,'地图阶段不属于这份配置，不能显示落楼位置')
  if(stage.status!=='completed')return blocked(context,stage.status==='failed'
    ? `地图阶段失败：${stage.error?.message||stage.error?.user_message||stage.error?.code||'请在配置页查看原因后重试'}`
    : `地图阶段${stage.status==='running'?'正在生成':'尚未完成'}，暂不显示地图。`,stage.error?.code||'MAP_NOT_READY')
  try{
    const wrapper=stage.payload
    if(!object(wrapper)||wrapper.schema_version!=='scene.map-stage.v1'||!object(wrapper.scene)||!['scene.result.v2','scene.result.v3'].includes(wrapper.scene.schema_version)||wrapper.scene.mode!=='map')throw error('INVALID_INPUT','地图阶段缺少完整的 v2/v3 SceneResult，或结果与启用地图的需求不一致')
    const [planStage,networkStage]=await Promise.all(['plan','network'].map(name=>read(`${base}/configs/${encodeURIComponent(config)}/stages/${name}`)))
    for(const [name,value] of [['plan',planStage],['network',networkStage]]){
      if(!object(value)||value.name!==name||value.status!=='completed'||!object(value.payload)||(value.config_id!=null&&value.config_id!==config))throw error('REF_MISMATCH',`配置的${name==='plan'?'计划':'人口快照'}尚未准备完成或引用不一致`)
    }
    const configPlan=planStage.payload,configSnapshot=networkStage.payload.snapshot
    checkScenePlacement(wrapper.scene,{snapshot:configSnapshot,plan:configPlan,config_id:config})
    return {...context,kind:'map',message:'按这份配置冻结的场景显示，位置为示意。',title:wrapper.title,
      sceneResult:wrapper.scene,configPlan,configSnapshot}
  }catch(e){
    if(e.name==='AbortError'||e.code==='LOGIN_REQUIRED')throw e
    return blocked(context,e.code==='REF_MISMATCH'?`配置地图引用不一致：${e.message}`:describeSceneIssue(e).user_message,e.code||'INVALID_INPUT')
  }
}

function people(snapshot){return snapshot.nodes.map(node=>[node.entity_id,node.role]).sort((a,b)=>a[0].localeCompare(b[0]))}
function withoutRevision(plan){const {plan_revision,...rest}=plan;return rest}
function brandReason(configPlan,actualPlan){
  const before=configPlan.economy||{},after=actualPlan.economy||{}
  const a=before.brands||[],b=after.brands||[]
  if(canonical(a.map(v=>v.brand_id).sort())!==canonical(b.map(v=>v.brand_id).sort()))return '品牌标识或品牌数量与配置计划不一致。'
  for(const brand of a){
    const actual=b.find(value=>value.brand_id===brand.brand_id)
    if(actual?.owner_entity_id!==brand.owner_entity_id){
      const name=(before.products||[]).find(p=>p.brand_id===brand.brand_id)?.product_name||brand.brand_id
      return `品牌“${name}”的经营者与配置计划不一致。`
    }
  }
  const products=plan=>(plan.products||[]).map(value=>[value.product_name,value.brand_id]).sort((x,y)=>canonical(x).localeCompare(canonical(y)))
  if(canonical(products(before))!==canonical(products(after)))return '品牌名称或商品与品牌的对应关系发生变化。'
  return ''
}

/** Keep the frozen result/hash and runtime plan separate. Revision numbers are never rewritten. */
export function prepareTeamPresentation(context,{snapshot,plan}={}){
  if(context.kind!=='map')return {...context,placement:null,revisionNote:''}
  try{
    const {sceneResult,configSnapshot,configPlan,configId}=context
    checkScenePlacement(sceneResult,{snapshot:configSnapshot,plan:configPlan,config_id:configId})
    if(!object(plan)||!object(snapshot)||!Array.isArray(snapshot.nodes))return blocked(context,'运行冻结的计划或人口快照不可读取。')
    if(plan.plan_id!==configPlan.plan_id)return blocked(context,'运行 plan_id 与配置计划不同，不能显示配置里的落楼位置。')
    if(!Number.isSafeInteger(plan.plan_revision)||plan.plan_revision<1)return blocked(context,'运行计划修订号无效。')
    if(snapshot.snapshot_id!==configSnapshot.snapshot_id||snapshot.snapshot_revision!==configSnapshot.snapshot_revision)return blocked(context,'运行人口快照的编号或修订号与配置场景不一致。')
    if(canonical(people(snapshot))!==canonical(people(configSnapshot)))return blocked(context,'人物 ID 或角色与配置时的安置输入不一致。')
    const reason=brandReason(configPlan,plan)
    if(reason)return blocked(context,reason)
    if(canonical(withoutRevision(configPlan))!==canonical(withoutRevision(plan)))return blocked(context,'计划除修订号外的内容也有变化（人口引用、策略、运行设置或商业参数等），不能当作仅模型设置变化。')
    // Repeat existing strict validation against the original configuration,
    // not a rewritten SceneResult pretending to refer to the runtime revision.
    return {...context,placement:{result:sceneResult,snapshot:configSnapshot,plan:configPlan,config_id:configId},
      revisionNote:plan.plan_revision===configPlan.plan_revision?'':`运行使用计划修订 ${plan.plan_revision}；除修订号外的内容已核对一致，安置沿用配置计划。`}
  }catch(e){return blocked(context,`场景安置校验未通过：${e.message}`,e.code||'REF_MISMATCH')}
}
