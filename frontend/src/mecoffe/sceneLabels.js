import {presentRole} from './rolePresentation.js'
const evidenceNames={building_tag:'建筑标签',poi:'楼内兴趣点',annotation:'人工补注',name_keyword:'名称推断（弱）'}
export const sceneEvidenceLabel=source=>evidenceNames[source]||'其他证据'
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
