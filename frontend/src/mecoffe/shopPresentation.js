import {brandLocationKey} from './campus3dRouting.js'

// Display identities belong to brand ids, never input array order or a person's role.
export function shopLetter(ordinal) {
  let value=ordinal+1,result=''
  while(value>0){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26)}
  return result
}
export function shopEntries(index) {
  return [...(index?.scene?.brands||[])].sort((a,b)=>a.brand_id<b.brand_id?-1:a.brand_id>b.brand_id?1:0)
    .map((brand,ordinal)=>({brandId:brand.brand_id,ordinal,letter:shopLetter(ordinal),name:`门店 ${shopLetter(ordinal)}（示意）`,
      productName:brand.product_name||brand.brand_id,ownerId:brand.owner_entity_id||brand.merchant_id,
      locationId:brand.location_id||brandLocationKey(index,brand.brand_id)}))
}
export function shopName(index,brandId) {
  return shopEntries(index).find(shop=>shop.brandId===brandId)?.name||brandId||'未命名门店'
}
export function shopsInBuilding(index,mapping,buildingId) {
  return shopEntries(index).filter(shop=>mapping?.mappings?.[shop.locationId]?.osm_id===buildingId)
}
export function buildingShopLabel(index,mapping,buildingId,buildingName='未命名楼栋') {
  const shops=shopsInBuilding(index,mapping,buildingId)
  if(!shops.length)return buildingName
  if(shops.length===1)return `${shops[0].name}· ${buildingName}`
  return `${buildingName} · 门店 ${shops.map(shop=>shop.letter).join(' / ')}（示意）`
}
// Keep original GIS bytes/objects intact; only the renderer's source gets extra text.
export function shopLabelFeatures(index,mapping,collection) {
  return {...collection,features:collection.features.map(feature=>{
    const shops=shopsInBuilding(index,mapping,feature.id)
    return shops.length?{...feature,properties:{...feature.properties,display_shop_label:buildingShopLabel(index,mapping,feature.id,feature.properties.name||'未命名楼栋')}}:feature
  })}
}
