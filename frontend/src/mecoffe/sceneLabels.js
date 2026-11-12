import {presentRole} from './rolePresentation.js'
const evidenceNames={building_tag:'建筑标签',poi:'楼内兴趣点',annotation:'人工补注',name_keyword:'名称推断（弱）',name_rule:'名称规则'}
export const sceneEvidenceLabel=(source,evidence={})=>{
  const label=source==='ai_inferred'?(Number.isInteger(evidence.confidence_pct)?'AI 推断（把握 '+evidence.confidence_pct+'%）':'AI 推断'):evidenceNames[source]||'其他证据'
  return label+(evidence.layer==='service'?' · 楼内服务':evidence.layer==='primary'?' · 主用途':'')
}
export const FUNCTION_LABELS={dormitory:'宿舍',residential:'住宅',hotel:'酒店住宿',education:'教学',research:'科研',office:'办公',library:'图书馆',industrial:'工业仓储',dining:'餐饮',retail:'零售',life_service:'生活服务',medical:'医疗',government:'政务公共',sports:'体育',culture:'文化娱乐',religious:'宗教',transport:'交通',utility:'后勤设施',construction:'在建或废弃',unknown:'未知'}
export const FUNCTION_COLORS={dormitory:'#d6b78e',residential:'#c5a978',hotel:'#b78b67',education:'#8fb3bf',research:'#6e9db7',office:'#8498b8',library:'#ad9bbd',industrial:'#a19b88',dining:'#dc9870',retail:'#d3ae67',life_service:'#b8ad74',medical:'#ca8995',government:'#7fa69b',sports:'#7da577',culture:'#aa8baa',religious:'#af946e',transport:'#82969e',utility:'#8b9189',construction:'#a49386',unknown:'#b7c4c3'}
const subtypeNames={hospital:'医院',clinic:'诊所',pharmacy:'药店',restaurant:'餐厅',canteen:'食堂',cafe:'咖啡馆',fast_food:'快餐',mall:'商场',supermarket:'超市',convenience:'便利店',hairdresser:'理发',laundry:'洗衣',bank:'银行',dormitory:'宿舍',gatehouse:'门卫',train_station:'车站'}
export function functionUseLabel(functionName,evidence=[]){
  const label=FUNCTION_LABELS[functionName]||'未知'
  const detail=evidence.filter(e=>e.function===functionName&&e.source!=='name_keyword').map(e=>subtypeNames[e.value]||(e.source==='name_rule'&&/\p{Script=Han}/u.test(e.value)?e.value:null)).find(Boolean)
  return detail&&detail!==label?`${label}·${detail}`:label
}
export function buildingUseInfo(building={}){
  const primary=(building.functions||[]).map(f=>functionUseLabel(f,building.function_evidence)),services=(building.services||[]).map(f=>functionUseLabel(f,building.service_evidence))
  const colourKey=(building.functions||[]).find(f=>['transport','utility','construction'].includes(f))||building.functions?.[0]||'unknown'
  return {primary,services,fromServices:building.primary_from_services===true,colour:FUNCTION_COLORS[colourKey]||FUNCTION_COLORS.unknown}
}
export function scenePeopleLabels(snapshot,populationRequest){
  return (snapshot?.nodes||[]).map(person=>{
    const description=populationRequest?.[person.role]?.description||person.role_description||''
    const role=presentRole(person.role,description)
    return {id:person.entity_id,name:person.name?.trim()||'未命名人物',
      roleLabel:/\p{Script=Han}/u.test(role.label)?role.label:'未提供中文角色名',roleDescription:description,role:person.role}
  })
}
export const sceneRelationLabel=relation=>({follow:'关注',competition:'竞争',friend:'好友'})[relation]||'其他关系'
export const sceneActionLabel=action=>({purchase_product:'购买商品',create_post:'发布帖子',create_comment:'发表评论',follow:'关注人物',like_post:'点赞帖子',do_nothing:'无操作',refresh:'刷新信息'})[action]||'其他活动'
export const sceneOutcomeLabel=(outcome,evidence)=>({pending:'订单待核对',incomplete:'订单证据不完整',unverified:'订单未核实',verified:'订单已核实'})[evidence]||({executed:'已执行',declined:'已拒绝',unknown:'结果未知',failed:'失败',noop:'无操作'})[outcome]||'待核对'
