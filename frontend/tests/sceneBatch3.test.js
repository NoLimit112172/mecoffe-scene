import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {loadBundledSceneAssets,loadSceneMap,PUBLISHED_SCENE_ASSETS} from '../src/mecoffe/sceneMap.js'
import {createHash} from 'node:crypto'
import {sceneEvidenceLabel,scenePeopleLabels,sceneOutcomeLabel} from '../src/mecoffe/sceneLabels.js'
const released=new URL('../../adapter/scene_builder/resources/mecoffe-embed-v1/catalog.json',import.meta.url)
const source=new URL('../public/mecoffe/assets3d/catalog.json',import.meta.url)
const fetchBytes=file=>async()=>({ok:true,arrayBuffer:async()=>fs.readFileSync(file)})
test('named published catalog is verified, not guessed from current page bytes',async()=>{
  assert.deepEqual(await loadBundledSceneAssets({fetcher:fetchBytes(released)}),{version:PUBLISHED_SCENE_ASSETS.version,catalog_sha256:PUBLISHED_SCENE_ASSETS.catalog_sha256})
  await assert.rejects(()=>loadBundledSceneAssets({fetcher:fetchBytes(source),development:true}),e=>e.code==='ASSET_VERSION_MISMATCH'&&/当前为源码素材，与发布版不同/.test(e.message))
  await assert.rejects(()=>loadBundledSceneAssets({fetcher:async()=>({ok:false})}),e=>e.code==='ASSET_VERSION_MISMATCH')
})
test('evidence and pure network labels are Chinese without inventing role identities',()=>{
  assert.deepEqual(['building_tag','poi','annotation','name_keyword'].map(sceneEvidenceLabel),['建筑标签','楼内兴趣点','人工补注','名称推断（弱）'])
  const people=scenePeopleLabels({nodes:[{entity_id:'synthetic_1',role:'visitor',name:'样例人物甲'},{entity_id:'synthetic_2',role:'unrecognized'}]},
    {visitor:{description:'合成校园访客'}})
  assert.equal(people[0].name,'样例人物甲');assert.equal(people[0].roleLabel,'合成校园访客')
  assert.equal(people[1].name,'未命名人物');assert.equal(people[1].roleLabel,'未提供中文角色名');assert.equal(people[1].id,'synthetic_2')
  assert.equal(sceneOutcomeLabel('executed','pending'),'订单待核对');assert.equal(sceneOutcomeLabel('executed','unverified'),'订单未核实')
})
test('formal USTC v1 map loads through the published catalog contract',async()=>{
  const directory=new URL('../../data/maps/ustc-gaoxin/1/',import.meta.url),raw=fs.readFileSync(new URL('manifest.json',directory))
  const map=await loadSceneMap({map_id:'ustc-gaoxin',map_version:'1',manifest_sha256:createHash('sha256').update(raw).digest('hex')},{
    mapsBase:'/maps/',assets:{version:PUBLISHED_SCENE_ASSETS.version,catalog_sha256:PUBLISHED_SCENE_ASSETS.catalog_sha256},
    fetcher:async url=>({ok:true,arrayBuffer:async()=>fs.readFileSync(new URL(url.slice('/maps/ustc-gaoxin/1/'.length),directory))})})
  assert.equal(map.files['campus3d.json'].buildings.length,31)
  assert.equal(map.files['quality.json'].function_counts.dining,0)
  assert.equal(map.manifest.asset_library_version,PUBLISHED_SCENE_ASSETS.version)
})
