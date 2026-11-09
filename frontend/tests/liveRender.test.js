import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {indexScene,stateAt} from '../src/mecoffe/replay.js'
import {confirmedPresentationTotals,refreshLiveIndex,takeLiveAnimations,liveEventLabel,advanceLiveMotion,enqueueLivePurchase} from '../src/mecoffe/liveRender.js'
import {buildGenericReplayScenario} from '../src/mecoffe/genericReplay.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'
import {Campus3DScene} from '../src/mecoffe/Campus3DScene.js'
import * as THREE from 'three'

function fixture(){return {people:[{id:'sample_01'}],campus:{locations:[]},brands:[{brand_id:'sample_brand'}],events:[],days:[{step:1}],relationships:[]}}
test('both map KPIs use a verified day summary even when its matching event arrives later',()=>{
  const scene=fixture(),index=indexScene(scene),summary={orders:1,quantity:2,revenue_fen:1800,posts:3,comments:1}
  assert.equal(stateAt(index,0).orders,0)
  const totals=confirmedPresentationTotals(index,0,summary)
  assert.deepEqual(totals,{...summary,source:'day_summary'})
  assert.deepEqual(index.prefix[0].cups,{sample_brand:0},'no invented brand breakdown')
  scene.events=[{key:'order_event',actor:'sample_01',step:1,type:'purchase',order_id:'order_sample',brand_id:'sample_brand',quantity:2,amount_fen:1800}]
  refreshLiveIndex(index,scene)
  assert.deepEqual(confirmedPresentationTotals(index,1,summary),totals,'late event cannot double the confirmed totals')
  assert.deepEqual(confirmedPresentationTotals(index,0),{orders:0,quantity:0,revenue_fen:0,posts:0,comments:0,source:'replay_cursor'})
  assert.deepEqual(confirmedPresentationTotals(index,1),{orders:1,quantity:2,revenue_fen:1800,posts:0,comments:0,source:'replay_cursor'})
  assert.equal(confirmedPresentationTotals(null,0,summary).orders,1)
})
test('live append and order confirmation keep the existing rendering index and count once',()=>{
  const scene=fixture(),index=indexScene(scene),retained=index
  scene.events=[{key:'run:1:0',actor:'sample_01',step:1,type:'purchase_pending',outcome:'executed',order_id:'order_1',brand_id:'sample_brand',quantity:2,amount_fen:1800}]
  refreshLiveIndex(index,scene)
  assert.equal(index,retained);assert.equal(stateAt(index,1).orders,0)
  scene.events[0]={...scene.events[0],type:'purchase'}
  refreshLiveIndex(index,scene)
  assert.equal(stateAt(index,1).orders,1);assert.equal(stateAt(index,1).cups.sample_brand,2)
  refreshLiveIndex(index,scene)
  assert.equal(stateAt(index,1).orders,1)
})
test('paused animation consumption is frozen and replayed pages cannot replay effects',()=>{
  const event={key:'run:2:0',actor:'sample_01',type:'post',action:'create_post',text:'合成片段'},seen=new Set()
  assert.deepEqual(takeLiveAnimations({paused:true,animationQueue:[event]},seen),[])
  assert.equal(seen.size,0)
  assert.deepEqual(takeLiveAnimations({animationQueue:[event,event]},seen),[event])
  assert.deepEqual(takeLiveAnimations({animationQueue:[event]},seen),[])
  assert.deepEqual(takeLiveAnimations({animationQueue:[{...event,key:'quiet',action:'refresh'}]},seen),[])
})
test('animation batches stay bounded and an old retained queue item never repeats after many updates',()=>{
  const seen=new Set(Array.from({length:1050},(_,i)=>`seen-${i}`))
  const events=Array.from({length:100},(_,i)=>({key:`run:${i}:0`,type:'post'}))
  assert.equal(takeLiveAnimations({animationQueue:events},seen).length,32)
  assert.equal(seen.size,1082)
  assert.deepEqual(takeLiveAnimations({animationQueue:[{key:'seen-0',type:'post'}]},new Set(['seen-0|post||'])),[])
  const pending={key:'run:200:0',type:'purchase_pending'},confirmed={...pending,type:'purchase',order_id:'order_sample'}
  assert.equal(takeLiveAnimations({animationQueue:[pending]},seen).length,1)
  assert.equal(takeLiveAnimations({animationQueue:[confirmed]},seen).length,1)
})
test('short live labels never claim unverified, declined or unknown purchases succeeded',()=>{
  assert.match(liveEventLabel({type:'purchase_pending'}),/待核对/)
  assert.equal(liveEventLabel({type:'purchase_pending',evidence_status:'unverified'}),'订单未核实')
  assert.equal(liveEventLabel({type:'declined',outcome:'declined'}),'动作被拒绝')
  assert.equal(liveEventLabel({type:'unknown',outcome:'unknown'}),'结果未知')
  assert.equal(liveEventLabel({type:'post',text:''}),'发帖')
  assert(liveEventLabel({type:'post',text:'文'.repeat(100)}).length<60)
})
test('live physical clock advances independently of incoming history and caps a long frame',()=>{
  const calls=[],motion={purchases:[{old:true}],sync(...args){calls.push(args)}}
  const first=advanceLiveMotion(motion,200,3)
  assert.equal(first,3.2);assert.deepEqual(motion.purchases,[]);assert.deepEqual(calls,[[0,3.2]])
  assert.equal(advanceLiveMotion(motion,5000,first),3.45)
  assert.equal(advanceLiveMotion(motion,-20,first),first)
})
test('embedded map layouts follow the parent and have a collapsible narrow-screen panel',()=>{
  for(const file of ['MeCoffe3D.vue','MeCoffeGis.vue']){
    const source=readFileSync(new URL(`../src/views/${file}`,import.meta.url),'utf8')
    assert.match(source,/max-width:900px/);assert.match(source,/aria-expanded="detailsOpen"/)
    assert.match(source,/min-height:0/);assert.match(source,/overflow:hidden/)
    assert.match(source,/defineExpose\(\{applyLiveUpdate,followLiveLatest\}\)/)
    assert.match(source,/liveState\?\.revision/)
  }
})
test('GIS and sandbox retain people and route caches when a pending order becomes verified',()=>{
  const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))
  const manifest=read('../public/mecoffe/scenarios/ustc-history/scenario.json')
  const map={manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,read('../public/mecoffe/scenarios/ustc-history/'+name)]))}
  const bundle=Object.fromEntries(['trajectory','snapshot','plan'].map(name=>[name,read(`./fixtures/generic-replay/${name}.json`)]))
  const scenario=buildGenericReplayScenario(bundle,map),scene=scenario.files['trajectory.json']
  const purchase=structuredClone(scene.events.find(e=>e.type==='purchase'))
  scenario.manifest.preview_mode='live';scene.events=[]
  const index=indexScene(scene),gis=new GisReplay(scenario)
  const sandbox=new Campus3DScene({campus:scenario.files['campus3d.json'],mapping:scenario.files['location_mapping.json'],index,
    entrances:scenario.files['entrances.json'],landcovers:scenario.files['landcover.json'].features})
  sandbox.scene=new THREE.Scene();sandbox.placePeople();sandbox.liveMode=true
  const gisPeople=gis.people,sandboxPeople=sandbox.people,gisRouteCache=gis.motion.routes
  scene.events=[{...purchase,type:'purchase_pending'}]
  refreshLiveIndex(index,scene);gis.updateLive()
  assert.equal(stateAt(index,1).orders,0);assert.equal(gis.pending,0);assert.equal(sandbox.indoor.pending,0)
  scene.events=[purchase];refreshLiveIndex(index,scene);gis.updateLive()
  gis.event(purchase);sandbox.playLiveEvent(purchase)
  gis.event(purchase);sandbox.playLiveEvent(purchase)
  assert.equal(gis.pending,1);assert.equal(sandbox.indoor.pending,1)
  assert.equal(gis.people,gisPeople);assert.equal(sandbox.people,sandboxPeople);assert.equal(gis.motion.routes,gisRouteCache)
  for(let i=0;i<20;i++){gis.advanceLive(100);sandbox.updateWalkers(.1)}
  assert.equal(gis.motion.accounting.accounted,scene.people.length)
  assert.equal(sandbox.indoor.accounting.accounted,scene.people.length)
  assert.equal(stateAt(gis.index,1).orders,stateAt(index,1).orders)
  const activeGis=gis.people.get(purchase.actor).walker,activeSandbox=sandbox.indoor.people.get(purchase.actor).walker
  assert(activeGis);assert(activeSandbox)
  // New decisions can arrive far faster than the illustrative trip can finish.
  for(let i=1;i<=100;i++){
    const event={...purchase,key:`live_long_${i}`,order_id:`order_live_long_${i}`}
    scene.events.push(event);gis.event(event);sandbox.playLiveEvent(event)
    assert(gis.people.get(event.actor).queue.length<=2)
    assert(sandbox.indoor.people.get(event.actor).queue.length<=2)
    assert.equal(gis.people.get(event.actor).walker,activeGis)
    assert.equal(sandbox.indoor.people.get(event.actor).walker,activeSandbox)
  }
  gis.updateLive();refreshLiveIndex(index,scene)
  assert.deepEqual(gis.people.get(purchase.actor).queue.map(item=>item.event.order_id),['order_live_long_99','order_live_long_100'])
  assert.equal(stateAt(gis.index,scene.events.length).orders,101)
  assert.equal(stateAt(index,scene.events.length).orders,101)
  const previousEvents=scene.events,people=gis.people,indexBefore=gis.index
  gis.followLiveLatest()
  assert.equal(gis.pending,0);assert.equal(gis.motion.purchases.length,0);assert.equal(gis.liveSeconds,0)
  assert.equal(gis.people,people);assert.equal(gis.index,indexBefore);assert.equal(scene.events,previousEvents)
  assert.equal(stateAt(gis.index,scene.events.length).orders,101)
  gis.dispose();sandbox.dispose()
})

test('live trip admission ignores duplicate and non-success updates without dropping queued work',()=>{
  const person={queue:[{event:{key:'old_1'}},{event:{key:'old_2'}}],walker:{phase:'outbound'}},seen=new Set(['duplicate'])
  const motion={people:new Map([['sample_01',person]]),seen,event(event){seen.add(event.order_id||event.key);person.queue.push({event})}}
  const before=person.queue.slice(),walker=person.walker
  assert.equal(enqueueLivePurchase(motion,{actor:'sample_01',key:'duplicate',type:'purchase',outcome:'executed'}),false)
  assert.equal(enqueueLivePurchase(motion,{actor:'sample_01',key:'declined',type:'purchase',outcome:'declined'}),false)
  assert.equal(enqueueLivePurchase(motion,{actor:'sample_01',key:'pending',type:'purchase_pending',outcome:'executed'}),false)
  assert.deepEqual(person.queue,before);assert.equal(person.walker,walker)
  assert.throws(()=>enqueueLivePurchase(motion,{},0),/上限/)
})
