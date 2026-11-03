import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {readFileSync} from 'node:fs'
import {AdaptiveQuality,batchStaticMeshes,characterLodGeometry,shadowNeedsRefresh,consolidateMaterialGroups,tripQueueEntries} from '../src/mecoffe/renderPerformance.js'
import {scenarioId,scenarioTime,loadScenario} from '../src/mecoffe/scenario.js'
import {spatialJob} from '../src/mecoffe/spatialWorker.js'
import {dayLighting} from '../src/mecoffe/campus3dEnvironmentModel.js'

const json=name=>JSON.parse(readFileSync(new URL('../public/mecoffe/scenarios/'+name+'/scenario.json',import.meta.url),'utf8'))
test('static batches preserve world geometry and reduce identical material draws',()=>{
  const root=new THREE.Group();root.position.set(10,4,-2)
  for(let i=0;i<5;i++){const g=new THREE.Group();g.position.set(i*10,3,2);g.rotation.y=i*.1;const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,8,2),new THREE.MeshStandardMaterial({color:'#abcdef'}));g.add(mesh);root.add(g)}
  const bounds=new THREE.Box3().setFromObject(root),result=batchStaticMeshes(root)
  assert.equal(result.inputMeshes,5);assert.equal(result.outputMeshes,1)
  const batchBounds=new THREE.Box3().setFromObject(result.group)
  assert(bounds.min.distanceTo(batchBounds.min)<1e-5);assert(bounds.max.distanceTo(batchBounds.max)<1e-5)
  assert.equal(root.children.filter(o=>o!==result.group).every(g=>g.children[0].visible===false),true)
})
test('character LOD retains complete UV/skin attributes and nondegenerate triangles',()=>{
  const source=new THREE.SphereGeometry(1,64,48),count=source.attributes.position.count
  source.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;source.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4))
  const lod=characterLodGeometry(source,10)
  assert(lod.index.count<source.index.count)
  assert.deepEqual(lod.attributes.skinWeight.array,source.attributes.skinWeight.array)
  for(let i=0;i<lod.index.count;i+=3){const a=lod.index.getX(i),b=lod.index.getX(i+1),c=lod.index.getX(i+2);assert(a!==b&&b!==c&&a!==c)}
  assert.deepEqual(source.attributes.position.array,lod.attributes.position.array)
})
test('material regrouping preserves every triangle and its material assignment',()=>{
  const geometry=new THREE.BoxGeometry(2,3,4)
  geometry.groups.forEach((group,index)=>{group.materialIndex=index%2})
  const assigned=g=>{const result=[];for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i+=3)result.push(`${group.materialIndex}:${[0,1,2].map(k=>g.index.getX(i+k)).join(',')}`);return result.sort()}
  const before=assigned(geometry)
  consolidateMaterialGroups(geometry)
  assert.equal(geometry.groups.length,2);assert.deepEqual(assigned(geometry),before)
})
test('adaptive quality requires a sustained active window and never overrides manual choice',()=>{
  const policy=new AdaptiveQuality({windowMs:1000})
  for(let t=0;t<1000;t+=100)assert.equal(policy.sample(t,true,'high'),false)
  assert.equal(policy.sample(1000,true,'high'),true)
  assert.equal(policy.sample(2000,true,'high'),false)
  const manual=new AdaptiveQuality({windowMs:1000});manual.chooseManually();assert.equal(manual.sample(0,true,'high'),false);assert.equal(manual.sample(2000,true,'high'),false)
  const paused=new AdaptiveQuality({windowMs:1000});paused.sample(0,true,'high');paused.sample(5000,false,'high');assert.equal(paused.sample(10000,true,'high'),false)
  assert.equal(shadowNeedsRefresh(.25,.251),false);assert.equal(shadowNeedsRefresh(.25,.30),true);assert.equal(shadowNeedsRefresh(.25,.25,true),true)
})
test('scenario dates and sunlight use actual day/hour intervals and declared timezone',()=>{
  const daily=json('ustc-history').simulation_time,hourly=json('nus-hourly').simulation_time
  assert.equal(scenarioTime(daily,1).label,'2026-10-02 06:00')
  assert.equal(scenarioTime(daily,.5).hour,18)
  assert.equal(scenarioTime(hourly,1.5).label,'2026-11-03 07:30')
  assert.equal(scenarioTime(hourly,18).phase,.75)
  assert.equal(dayLighting(scenarioTime(hourly,6).phase).hour,12)
  assert.equal(dayLighting(scenarioTime(hourly,18).phase).night,1)
  assert.throws(()=>scenarioId('../escape'));assert.throws(()=>scenarioTime({...hourly,timezone:'invalid/zone'}))
  assert.throws(()=>scenarioTime({...hourly,intervals:[{start:'bad',end:'bad'}]}))
})
test('scenario loader reports missing, invalid and hash-mismatched files',async()=>{
  await assert.rejects(loadScenario('none',{fetcher:async()=>({ok:false,status:404})}),/404/)
  await assert.rejects(loadScenario('bad',{fetcher:async()=>({ok:true,text:async()=>'{bad'})}),/格式/)
  const manifest=json('nus-hourly')
  await assert.rejects(loadScenario('nus-hourly',{fetcher:async url=>({ok:true,text:async()=>url.endsWith('scenario.json')?JSON.stringify(manifest):'{}'})}),/改变/)
})
test('background geometry jobs preserve routes and no-route waiting result',()=>{
  const points=[{x:0,y:0},{x:10,y:0}]
  assert.deepEqual(spatialJob({kind:'route',points,options:{radius:1,laneOffset:0}},[]),points)
  assert.deepEqual(spatialJob({kind:'replan',start:points[0],goals:[points[1]],people:[],radius:1},[]),{points})
  assert.equal(spatialJob({kind:'replan',start:points[0],goals:[points[1]],people:[{...points[1],radius:2}],radius:1},[]),null)
})
test('campus UI hides implementation-only matching text and the obsolete scope selector',()=>{
  for(const file of ['views/MeCoffe3D.vue','components/Campus3DVisualControls.vue','views/AssetLibrary.vue']){
    const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
    assert.doesNotMatch(source,/性别匹配|按画像性别|当前校区使用的素材|素材范围/)
  }
})
test('visual trip admission is bounded and FIFO without consuming or modifying orders',()=>{
  const entries=Array.from({length:20},(_,i)=>({person:{id:String(i)},queue:[{event:{i:20-i}}]}))
  const source=JSON.stringify(entries)
  assert.deepEqual(tripQueueEntries(entries,10).map(e=>e.queue[0].event.i),[1,2])
  assert.equal(tripQueueEntries(entries,12).length,0)
  assert.equal(tripQueueEntries(entries,0).length,12)
  entries[19].walker={};assert.equal(tripQueueEntries(entries,11)[0],entries[18])
  delete entries[19].walker;assert.equal(JSON.stringify(entries),source)
  const branded=Array.from({length:10},(_,i)=>({person:{id:String(i)},queue:[{event:{i,brand_id:i%2?'b':'a'}}]}))
  const admitted=tripQueueEntries(branded,0)
  assert.equal(admitted.length,4)
  assert.equal(admitted.filter(e=>e.queue[0].event.brand_id==='a').length,2)
  assert.equal(branded.reduce((n,e)=>n+e.queue.length,0),10)
})
