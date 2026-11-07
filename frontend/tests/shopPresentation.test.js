import test from 'node:test'
import assert from 'node:assert/strict'
import {shopEntries,shopName,shopsInBuilding,buildingShopLabel,shopLabelFeatures,shopLetter} from '../src/mecoffe/shopPresentation.js'

function sample(){
  const brands=['gamma','alpha','beta'].map(id=>({brand_id:`brand_${id}`,owner_entity_id:`sample_owner_${id}`,location_id:`place_${id}`,product_name:`样例商品${id}`}))
  const index={scene:{brands},brands:new Map(brands.map(brand=>[brand.brand_id,brand]))}
  const mapping={mappings:Object.fromEntries(['alpha','beta','gamma'].map(id=>[`place_${id}`,{osm_id:'synthetic/building'}]))}
  return {index,mapping}
}
test('brand identity assigns stable letters independent of input order or co-located owners',()=>{
  const {index,mapping}=sample(),before=JSON.stringify({index,mapping})
  const entries=shopEntries(index)
  assert.deepEqual(entries.map(shop=>[shop.brandId,shop.letter,shop.ordinal]),[['brand_alpha','A',0],['brand_beta','B',1],['brand_gamma','C',2]])
  assert.equal(shopName(index,'brand_beta'),'门店 B（示意）')
  for(const shop of entries){assert.equal(shop.ownerId,`sample_owner_${shop.brandId.slice(6)}`);assert.equal(shop.locationId,`place_${shop.brandId.slice(6)}`)}
  assert.equal(JSON.stringify({index,mapping}),before)
  index.scene.brands.reverse()
  assert.deepEqual(shopEntries(index),entries)
})
test('all brands sharing one mapped building receive a complete compact label',()=>{
  const {index,mapping}=sample()
  assert.equal(shopsInBuilding(index,mapping,'synthetic/building').length,3)
  assert.equal(buildingShopLabel(index,mapping,'synthetic/building','样例食堂'),'样例食堂 · 门店 A / B / C（示意）')
  assert.equal(buildingShopLabel(index,mapping,'other','样例教学楼'),'样例教学楼')
  assert.deepEqual(shopsInBuilding(null,mapping,'synthetic/building'),[])
  mapping.mappings.place_gamma.osm_id='other';mapping.mappings.place_beta.osm_id='other'
  assert.equal(buildingShopLabel(index,mapping,'synthetic/building','样例食堂'),'门店 A（示意）· 样例食堂')
})
test('GIS source receives the same multi-store label while original geometry and properties stay immutable',()=>{
  const {index,mapping}=sample(),feature={type:'Feature',id:'synthetic/building',properties:{name:'样例食堂',height_m:9},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}
  const collection={type:'FeatureCollection',features:[feature,{...feature,id:'empty',properties:{name:'样例空楼'}}]},before=JSON.stringify(collection)
  const labelled=shopLabelFeatures(index,mapping,collection)
  assert.equal(labelled.features[0].properties.display_shop_label,buildingShopLabel(index,mapping,feature.id,feature.properties.name))
  assert.equal(labelled.features[0].geometry,feature.geometry)
  assert.equal(labelled.features[1],collection.features[1])
  assert.equal(JSON.stringify(collection),before)
})
test('letters continue after Z and legacy mapping ids keep their original two-shop identity',()=>{
  assert.equal(shopLetter(0),'A');assert.equal(shopLetter(25),'Z');assert.equal(shopLetter(26),'AA');assert.equal(shopLetter(701),'ZZ');assert.equal(shopLetter(702),'AAA')
  const index={scene:{brands:[{brand_id:'merchant_002'},{brand_id:'merchant_001'}]}}
  assert.equal(shopName(index,'merchant_001'),'门店 A（示意）')
  assert.equal(shopName(index,'missing'),'missing')
  assert.equal(shopsInBuilding(index,{mappings:{shop_merchant_002:{osm_id:'synthetic/cafe'}}},'synthetic/cafe')[0].letter,'B')
})
