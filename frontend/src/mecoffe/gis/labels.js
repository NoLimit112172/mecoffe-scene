// Shared by the information card, search results and map popup. Display only.
const CATEGORIES={library:'图书馆',education:'教学科研',university:'大学教学楼',school:'教学楼',college:'学院',
  dormitory:'宿舍',apartments:'公寓',residential:'住宅',public:'公共设施',commercial:'商业设施',office:'办公楼',
  building:'建筑',yes:'建筑',hospital:'医疗设施',sports_centre:'体育设施',cafe:'咖啡店',restaurant:'餐饮',
  canteen:'食堂',retail:'商店',mapped_location:'映射地点',poi:'兴趣点'}
const hasChinese=value=>typeof value==='string'&&/\p{Script=Han}/u.test(value)
export function featureInfo(feature,{catalog={prototypes:[]},mapping={}}={}){
  const p=feature.properties||{},prototype=catalog.prototypes.find(item=>item.id===p.prototype_id)
  return {
    category:{name:CATEGORIES[p.category]||'其他类别',code:CATEGORIES[p.category]?'':p.category||''},
    prototype:{name:!p.prototype_id?'未分配':hasChinese(prototype?.title)?prototype.title:'未提供中文名称',code:p.prototype_id&&!hasChinese(prototype?.title)?p.prototype_id:''},
    locations:(p.location_ids||[]).map(id=>{
      const entry=mapping.mappings?.[id]||{}
      return {id,name:entry.display_name||entry.name||entry.osm_name||'未命名地点'}
    }),
    sourceId:String(feature.id??p.feature_id??''),
  }
}
