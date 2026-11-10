import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {loadSceneMap,sceneMapDirectory} from '../src/mecoffe/sceneMap.js'
import {checkScenePlacement} from '../src/mecoffe/scenePlacement.js'
import {normalizeConfigPreview,buildConfigPreviewScenario} from '../src/mecoffe/configPreview.js'
import {buildGenericReplayScenario} from '../src/mecoffe/genericReplay.js'
import {createLiveState,validateLiveBootstrap,applyLivePage,buildLiveScenario,syncLiveScenario} from '../src/mecoffe/liveRun.js'
import {IndoorMotion} from '../src/mecoffe/indoorMotion.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'
import {indexScene} from '../src/mecoffe/replay.js'
import {brandLocationKey} from '../src/mecoffe/campus3dRouting.js'
import {shopsInBuilding,buildingShopLabel} from '../src/mecoffe/shopPresentation.js'
import {readOptionalSceneResult} from '../src/mecoffe/sceneRenderStore.js'
const root=path.resolve(import.meta.dirname,'fixtures/scene-render'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const sum=bytes=>createHash('sha256').update(bytes).digest('hex')
function fetcher(overrides={},calls=[]){return async url=>{
  calls.push(url);const name=url.replace('/maps/','')
  if(Object.hasOwn(overrides,name)){const raw=overrides[name];return raw===null?{ok:false,status:404}:{ok:true,arrayBuffer:async()=>Buffer.from(raw)}}
  const file=path.join(root,'maps',name)
  return fs.existsSync(file)?{ok:true,arrayBuffer:async()=>fs.readFileSync(file)}:{ok:false,status:404}
}}
function options(b,overrides={},calls=[]){const m=read(`maps/${b.scene_result.map_ref.map_id}/1/manifest.json`);return {mapsBase:'/maps/',assets:{version:m.asset_library_version,catalog_sha256:m.catalog_sha256},fetcher:fetcher(overrides,calls)}}
function config(b,map){const input=normalizeConfigPreview({network:b.snapshot,roles:b.roles,seed:b.plan.runtime.seed});return buildConfigPreviewScenario({...input,scenePlan:b.plan,sceneConfigId:b.config_id},map,{},b.scene_result)}
const replay=(b,map)=>buildGenericReplayScenario({...b,sceneResult:b.scene_result,context:{config_id:b.config_id}},map)
for(const suffix of ['a','b'])test(`map_ref loads ${suffix} title and strictly verified files`,async()=>{
  const b=read(`input-${suffix}.json`),map=await loadSceneMap(b.scene_result.map_ref,options(b))
  assert.equal(map.manifest.map_id,b.scene_result.map_ref.map_id)
  assert.match(map.manifest.title,suffix==='a'?/合成校园甲/:/公开几何/)
  checkScenePlacement(b.scene_result,{snapshot:b.snapshot,plan:b.plan,config_id:b.config_id,map})
})
test('missing files and wrong hashes fail without requesting legacy config-map',async()=>{
  const b=read('input-a.json'),id=b.scene_result.map_ref.map_id,calls=[]
  for(const replacement of [null,'{}']){
    await assert.rejects(()=>loadSceneMap(b.scene_result.map_ref,options(b,{[id+'/1/campus3d.json']:replacement},calls)),e=>['MAP_HASH_MISMATCH','MAP_FILE_MISSING'].includes(e.code))
  }
  assert(calls.every(url=>!url.includes('config-map')&&!url.includes('ustc')))
  const bad={...b.scene_result.map_ref,manifest_sha256:'0'.repeat(64)}
  await assert.rejects(()=>loadSceneMap(bad,options(b)),e=>e.code==='MAP_HASH_MISMATCH')
})
test('manifest identity, required files and asset versions are checked even with an authentic outer hash',async()=>{
  const b=read('input-a.json'),id=b.scene_result.map_ref.map_id,name=id+'/1/manifest.json',original=read('maps/'+name)
  for(const change of [m=>m.map_version='2',m=>m.asset_library_version='unavailable',m=>m.catalog_sha256='0'.repeat(64),m=>delete m.files['entrances.json'],m=>m.files['../secret.json']='0'.repeat(64)]){
    const m=structuredClone(original);change(m);const bytes=JSON.stringify(m),ref={...b.scene_result.map_ref,manifest_sha256:sum(bytes)}
    await assert.rejects(()=>loadSceneMap(ref,options(b,{[name]:bytes})),e=>['MAP_VERSION_MISMATCH','ASSET_VERSION_MISMATCH','INVALID_MAP_MANIFEST'].includes(e.code))
  }
  for(const id of ['..','a/b','%2e%2e'])assert.throws(()=>sceneMapDirectory({...b.scene_result.map_ref,map_id:id}))
})
test('source_refs mismatch fails before constructing any scene',async()=>{
  const b=read('input-a.json'),map=await loadSceneMap(b.scene_result.map_ref,options(b))
  assert.throws(()=>checkScenePlacement(b.scene_result,{snapshot:b.snapshot,plan:{...b.plan,plan_revision:2},config_id:b.config_id,map}),e=>e.code==='REF_MISMATCH')
  assert.throws(()=>checkScenePlacement(b.scene_result,{snapshot:b.snapshot,plan:b.plan,config_id:'different',map}),e=>e.code==='REF_MISMATCH')
})
test('config, replay and live use identical placement, outside people, independent and shared stores',async()=>{
  const b=read('input-a.json'),map=await loadSceneMap(b.scene_result.map_ref,options(b)),c=config(b,map),r=replay(b,map)
  const state=createLiveState(validateLiveBootstrap(b.live.bootstrap,{session:'synthetic-live-session',run:b.live.bootstrap.run_id}));state.sceneResult=b.scene_result
  const l=buildLiveScenario(state,map)
  const places=s=>s.files['trajectory.json'].people.map(p=>[p.id,p.location_key,p.out_of_scene])
  assert.deepEqual(places(c),places(r));assert.deepEqual(places(c),places(l))
  for(const s of [c,r,l]){
    assert.equal(s.manifest.title,map.manifest.title)
    const index=indexScene(s.files['trajectory.json']),motion=new IndoorMotion({campus:s.files['campus3d.json'],mapping:s.files['location_mapping.json'],index,entrances:s.files['entrances.json'],landcovers:s.files['landcover.json'].features})
    const gis=new GisReplay(s)
    assert.deepEqual(motion.accounting,gis.motion.accounting)
    assert.equal(motion.accounting.total,7);assert.equal(motion.accounting.inside,5);assert.equal(motion.accounting.out_of_scene,2);assert.equal(motion.accounting.valid,true)
    const shop=b.scene_result.service_points.find(p=>p.brand_id==='brand_alpha')
    assert.equal(shopsInBuilding(index,s.files['location_mapping.json'],shop.building_id).length,2)
    const label=buildingShopLabel(index,s.files['location_mapping.json'],shop.building_id)
    for(const service of b.scene_result.service_points.filter(p=>p.building_id===shop.building_id))assert(label.includes(service.brand_name))
    assert.equal(index.brands.get('brand_gamma').out_of_scene,true)
    assert.equal(brandLocationKey(index,'brand_gamma'),null)
    const person=motion.people.get('synthetic_person_01'),route=motion.pathFor(person,brandLocationKey(index,'brand_alpha'))
    assert.equal(route.shopBuilding,shop.building_id)
    assert.deepEqual(route.shopDoor.point,s.files['entrances.json'].entrances.find(e=>e.id===shop.entrance_id).point)
    assert.notEqual(route.shopBuilding,motion.people.get('synthetic_person_03').homeBuilding)
    assert(!motion.people.has('synthetic_person_07'))
    assert.equal(index.people.size,7) // outside actors and events stay in the data index
  }
  let next=state
  for(const page of b.live.pages)next=applyLivePage(next,page)
  syncLiveScenario(next,l);assert.deepEqual(places(c),places(l));assert.equal(l.files['trajectory.json'].summary.orders,2)
})
test('none verifies source without a map and never becomes a spatial scene',()=>{
  const b=read('input-none.json')
  assert.equal(checkScenePlacement(b.scene_result,{snapshot:b.snapshot,plan:b.plan,config_id:b.config_id}).mode,'none')
  assert.equal(b.scene_result.map_ref,null);assert.equal(b.scene_result.assignments.length,0)
})
test('reserved 404 hook returns an explained legacy result; other errors are not swallowed',async()=>{
  const value=await readOptionalSceneResult('/api/sessions/sample/configs/sample/stages/scene',{fetcher:async()=>({ok:false,status:404})})
  assert.equal(value.legacy,true);assert.match(value.message,/legacy/)
  await assert.rejects(()=>readOptionalSceneResult('/api/sample',{fetcher:async()=>({ok:false,status:401})}),/401/)
})
