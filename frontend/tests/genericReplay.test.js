import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {buildGenericReplayScenario, loadRunReplay, validateRunReplay} from '../src/mecoffe/genericReplay.js'
import {indexScene, stateAt} from '../src/mecoffe/replay.js'
import {IndoorMotion} from '../src/mecoffe/indoorMotion.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'
import {Campus3DScene} from '../src/mecoffe/Campus3DScene.js'
import * as THREE from 'three'

const read = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/generic-replay/${name}.json`, import.meta.url)))
const sample = () => ({trajectory:read('trajectory'), snapshot:read('snapshot'), plan:read('plan')})
function mapScenario() {
  const buildings=Array.from({length:5},(_,i)=>({osm_id:`synthetic/building_${i}`,name:`样例建筑 ${i+1}`,kind:'education',polygon:[[i*30,0],[i*30+20,0],[i*30+20,20],[i*30,20],[i*30,0]]}))
  return {manifest:{id:'synthetic-map',title:'完全合成的测试地图',simulation_data:false,simulation_time:{start:'2026-01-01T00:00:00+08:00'}},files:{
    'campus3d.json':{campus_id:'synthetic-map',title:'完全合成的测试地图',buildings},
    'asset_assignments.json':{assignments:[]},'landcover.json':{features:[]},
    'gis/buildings.geojson':{type:'FeatureCollection',features:buildings.map(b=>({type:'Feature',id:b.osm_id,properties:{}}))},
  }}
}
const sceneOf = bundle => buildGenericReplayScenario(bundle,mapScenario()).files['trajectory.json']
const code = expected => error => error.code===expected
const response = value => ({ok:true,status:200,json:async()=>value})
function mock(bundle=sample(), detail={id:'business_run',config_id:'config_test',status:'completed',engine_run_id:'engine_synthetic_replay'}) {
  return async url=>response(url.endsWith('/artifacts/trajectory')?bundle.trajectory
    :url.endsWith('/artifacts/population-snapshot')?bundle.snapshot
      :url.endsWith('/stages/plan')?{name:'plan',status:'completed',payload:bundle.plan}:detail)
}

test('generic replay keeps arbitrary roles, three owner-linked brands and exact successful business outcomes',()=>{
  const bundle=sample(), map=mapScenario(), before=JSON.stringify({bundle,map})
  const result=buildGenericReplayScenario(bundle,map), scene=result.files['trajectory.json'], index=indexScene(scene)
  assert.equal(result.manifest.preview_mode,'replay')
  assert.equal(result.manifest.simulation_data,true)
  assert.equal(scene.meta.config_preview,false)
  assert.equal(scene.meta.generic_replay,true)
  assert.equal(scene.meta.synthetic,true)
  assert.match(result.manifest.title,/合成样例/)
  assert.equal(scene.meta.snapshot_revision,2)
  assert.deepEqual([...new Set(scene.people.map(p=>p.role))].sort(),['operator','research','visitor'])
  assert.equal(scene.people.length,7)
  assert.equal(scene.relationships.length,4)
  assert.equal(scene.brands.length,3)
  for(const brand of scene.brands){
    assert.equal(brand.location_id,index.people.get(brand.owner_entity_id).location_key)
    assert.equal(brand.merchant_id,brand.owner_entity_id)
    assert(!brand.location_id.startsWith('shop_'))
  }
  assert.equal(scene.events.length,9)
  assert.equal(scene.summary.orders,2)
  assert.equal(scene.summary.revenue_fen,2190)
  assert.equal(scene.summary.declined,1)
  assert.equal(scene.summary.unknown,1)
  assert.equal(scene.summary.failed,1)
  assert.equal(scene.summary.noop,1)
  assert.equal(scene.events.find(e=>e.type==='ad').brand_id,'brand_beta')
  assert.equal(scene.events.find(e=>e.type==='price').brand_id,'brand_gamma')
  assert.deepEqual(scene.events.find(e=>e.type==='ad').targeted,['synthetic_person_01','synthetic_person_02'])
  assert.equal(scene.events.find(e=>e.type==='purchase').target,'synthetic_person_03')
  assert.equal(stateAt(index,scene.events.length).orders,2)
  assert.equal(stateAt(index,scene.events.length).posts,2)
  for(const event of scene.events.filter(e=>['declined','unknown','failed'].includes(e.type))){
    assert.equal(event.outcome,event.type)
    assert.equal(event.order_id,undefined)
    assert.equal(event.brand_id,undefined)
    assert(event.action)
  }
  assert.equal(JSON.stringify({bundle,map}),before)
  assert.deepEqual(result,buildGenericReplayScenario(bundle,map))
})

test('optional role field titles are preserved and role or source order does not change seeded homes',()=>{
  const bundle=sample()
  bundle.roles={population_request:Object.fromEntries(['visitor','operator','research'].map(role=>[role,{description:`样例${role}说明`,count:bundle.snapshot.nodes.filter(n=>n.role===role).length,generate:{interest_topic:{title:'研究主题'},spending_limit_yuan:{title:'预算上限'}}}]))}
  const scene=sceneOf(bundle)
  assert.equal(scene.people[0].profile_fields.find(f=>f.key==='interest_topic').label,'研究主题')
  assert.equal(scene.people[0].role_label,'样例visitor说明')
  const original=Object.fromEntries(scene.people.map(p=>[p.id,p.location_key]))
  bundle.snapshot.nodes.reverse();bundle.trajectory.agents.reverse()
  assert.deepEqual(Object.fromEntries(sceneOf(bundle).people.map(p=>[p.id,p.location_key])),original)
})

test('replay dates preserve declared positive and negative timezone calendar days across midnight',()=>{
  for(const [timezone,start,expected] of [
    ['Asia/Shanghai','2026-01-01T00:00:00+08:00',['2026-01-01T00:00:00+08:00','2026-01-02T00:00:00+08:00']],
    ['America/New_York','2026-01-01T23:00:00-05:00',['2026-01-01T23:00:00-05:00','2026-01-02T23:00:00-05:00']],
    ['UTC','2026-01-01T00:00:00Z',['2026-01-01T00:00:00Z','2026-01-02T00:00:00Z']],
  ]){
    const bundle=sample();bundle.plan.runtime.time={...bundle.plan.runtime.time,start_time:start,timezone}
    const time=buildGenericReplayScenario(bundle,mapScenario()).manifest.simulation_time
    assert.equal(time.start,expected[0]);assert.deepEqual(time.intervals.map(i=>i.start),expected)
    assert.equal(Date.parse(time.intervals[0].start),Date.parse(start))
  }
  const hourly=sample();hourly.trajectory.metadata.step_unit='hour';hourly.plan.runtime.time={start_time:'2026-01-01T23:30:00+08:00',timezone:'Asia/Shanghai'}
  assert.deepEqual(buildGenericReplayScenario(hourly,mapScenario()).manifest.simulation_time.intervals.map(i=>i.start),['2026-01-01T23:30:00+08:00','2026-01-02T00:30:00+08:00'])
  const invalid=sample();invalid.plan.runtime.time.timezone='invalid/timezone'
  assert.throws(()=>sceneOf(invalid),error=>error.code==='INVALID_REPLAY'&&/计划时区无效/.test(error.message))
})

test('frozen snapshot, plan, population and initial relationship mismatches fail before rendering',()=>{
  for(const mutate of [
    b=>b.trajectory.metadata.snapshot_id='another',
    b=>b.trajectory.metadata.snapshot_revision++,
  ]){const b=sample();mutate(b);assert.throws(()=>sceneOf(b),code('SNAPSHOT_MISMATCH'))}
  for(const mutate of [b=>b.plan.population.snapshot_revision++,b=>b.plan.plan_id='another',b=>b.plan.runtime.num_steps++,
    b=>delete b.plan.population,b=>delete b.plan.schema_version,b=>delete b.plan.plan_id,b=>delete b.plan.plan_revision,
    b=>delete b.trajectory.metadata.plan_id,b=>delete b.trajectory.metadata.plan_revision]){
    const b=sample();mutate(b);assert.throws(()=>sceneOf(b),code('PLAN_MISMATCH'))
  }
  const population=sample();population.trajectory.agents.pop();assert.throws(()=>sceneOf(population),code('POPULATION_MISMATCH'))
  const missingCount=sample();delete missingCount.plan.population.expected_agent_count;assert.throws(()=>sceneOf(missingCount),code('POPULATION_MISMATCH'))
  const duplicate=sample();duplicate.trajectory.initial_relationships.push(duplicate.trajectory.initial_relationships[0]);assert.throws(()=>sceneOf(duplicate),code('INVALID_REPLAY'))
  const dangling=sample();dangling.trajectory.initial_relationships[0].source='missing';assert.throws(()=>sceneOf(dangling),code('UNKNOWN_PERSON'))
})

test('public USTC routes use brand owners doors and share seven-person accounting in GIS and sandbox',()=>{
  const root=new URL('../public/mecoffe/scenarios/ustc-history/',import.meta.url)
  const manifest=JSON.parse(fs.readFileSync(new URL('scenario.json',root)))
  const map={manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,JSON.parse(fs.readFileSync(new URL(name,root)))]))}
  const bundle=sample()
  bundle.placementRules={roles:{visitor:'way/1435368246',research:'way/1435377501'},entities:{
    synthetic_person_03:'way/1435377506',synthetic_person_04:'way/1435377504',synthetic_person_05:'way/1435377494',
  }}
  const scenario=buildGenericReplayScenario(bundle,map),index=indexScene(scenario.files['trajectory.json'])
  const args={campus:scenario.files['campus3d.json'],mapping:scenario.files['location_mapping.json'],index,
    entrances:scenario.files['entrances.json'],landcovers:scenario.files['landcover.json'].features}
  const motion=new IndoorMotion(args),gis=new GisReplay(scenario),sandbox=new Campus3DScene(args)
  sandbox.scene=new THREE.Scene();sandbox.placePeople()
  assert.equal(motion.purchases.length,2)
  assert.equal(motion.purchases.filter(p=>p.event.actor==='synthetic_person_02').length,0)
  for(const {event}of motion.purchases){
    const brand=index.brands.get(event.brand_id),owner=index.people.get(brand.owner_entity_id)
    const target=motion.routing.anchors.get(owner.location_key).door
    const path=motion.pathFor(motion.people.get(event.actor),brand.location_id)
    assert(path,'successful purchase has a reachable path')
    assert.equal(path.shopBuilding,target.building_id)
    const end=path.points.at(-1)
    assert(Math.hypot(end.x-target.point[0],end.y-target.point[1])<1e-6)
  }
  const visited=new Set(),coffees=new Set()
  for(let tick=0;tick<=100;tick++){
    const position=Math.min(3,tick/25),drain=Math.max(0,tick/25-3)*12
    motion.sync(position,drain)
    const accounting=motion.accounting
    assert.equal(accounting.visible+accounting.inside,7)
    assert.equal(accounting.valid,true)
    for(const person of motion.people.values()){
      if(person.walker)visited.add(person.id)
      if(person.hasCoffee)coffees.add(person.id)
    }
    const refused=motion.people.get('synthetic_person_02')
    assert.equal(refused.queue.length,0);assert.equal(refused.walker,null);assert.equal(refused.hasCoffee,false)
  }
  assert(visited.has('synthetic_person_01'));assert(visited.has('synthetic_person_07'))
  assert(coffees.has('synthetic_person_01'));assert(coffees.has('synthetic_person_07'))
  for(const position of [0,1.2,1.45,1.7,2,2.3,2.8,3,1.4,0]){
    gis.seek(position);sandbox.setIndoorPosition(position)
    assert.deepEqual(sandbox.indoor.snapshot,gis.occupancy)
    assert.equal(gis.occupancy.inside+gis.personData().length,7)
    for(const [id,person]of gis.people){
      const other=sandbox.indoor.people.get(id)
      assert.equal(person.x,other.x);assert.equal(person.y,other.y)
    }
  }
})

test('order evidence, integer-fen money and plan owner associations prevent false sales',()=>{
  for(const mutate of [
    b=>b.trajectory.objects.orders.pop(),
    b=>b.trajectory.objects.orders[0].amount_fen++,
    b=>b.trajectory.objects.orders[0].quantity=2,
    b=>b.trajectory.objects.orders[0].entity_id='synthetic_person_02',
    b=>b.trajectory.objects.orders[0].unit_price_fen++,
    b=>b.trajectory.actions.find(a=>a.action==='purchase_product').outcome='declined',
  ]){const b=sample();mutate(b);assert.throws(()=>sceneOf(b),code('ORDER_MISMATCH'))}
  const fractional=sample();fractional.trajectory.actions.find(a=>a.action==='purchase_product').result.amount_fen=9.9
  assert.throws(()=>sceneOf(fractional),code('INVALID_REPLAY'))
  const unknownOwner=sample();unknownOwner.plan.economy.brands[0].owner_entity_id='missing'
  assert.throws(()=>sceneOf(unknownOwner),code('UNKNOWN_PERSON'))
  const wrongOwner=sample();wrongOwner.trajectory.actions.find(a=>a.action==='publish_ad').actor.entity_id='synthetic_person_01'
  assert.throws(()=>sceneOf(wrongOwner),code('INVALID_BRAND'))
  const wrongTarget=sample();wrongTarget.trajectory.actions.find(a=>a.action==='purchase_product').targets[0].owner_entity_id='synthetic_person_04'
  assert.throws(()=>sceneOf(wrongTarget),code('INVALID_BRAND'))
  const ambiguous=sample();ambiguous.plan.economy.brands[2].owner_entity_id='synthetic_person_04'
  ambiguous.trajectory.objects.ads=[]
  assert.throws(()=>sceneOf(ambiguous),code('AMBIGUOUS_BRAND'))
  const evidence=sample();evidence.plan.economy.brands.push({brand_id:'brand_extra',owner_entity_id:'synthetic_person_04'})
  assert.equal(sceneOf(evidence).events.find(e=>e.type==='ad').brand_id,'brand_beta')
})

test('social-only plans need no economy and failed partial runs remain visibly partial',()=>{
  const b=sample();delete b.plan.economy
  b.trajectory.actions=b.trajectory.actions.filter(a=>!['purchase_product','publish_ad','set_product_price'].includes(a.action))
  b.trajectory.objects.orders=[];b.trajectory.objects.ads=[]
  const scene=sceneOf(b)
  assert.equal(scene.brands.length,0);assert.equal(scene.summary.orders,0)
  b.trajectory.status='failed';b.trajectory.partial=true;b.trajectory.metadata.completed_steps=1
  const partial=sceneOf(b)
  assert.equal(partial.meta.status,'failed');assert.equal(partial.meta.partial,true)
  assert.equal(partial.days.at(-1).complete,false)
  b.trajectory.partial=false;assert.throws(()=>sceneOf(b),code('INVALID_TRAJECTORY'))
})

test('malformed optional evidence fails clearly and unknown prototype-like actions remain ordinary events',()=>{
  for(const mutate of [b=>b.trajectory.agents[0]=null,b=>b.trajectory.initial_relationships[0]=null,
    b=>b.trajectory.objects.ads={},b=>b.trajectory.objects.posts={},b=>b.plan.economy.brands[0]=null,
    b=>b.plan.economy.products[0]=null,b=>b.trajectory.actions[0].targets={}]){
    const bundle=sample();mutate(bundle)
    assert.throws(()=>sceneOf(bundle),error=>error.name==='ConfigPreviewError')
  }
  const bundle=sample();bundle.trajectory.actions[0].action='constructor'
  assert.equal(sceneOf(bundle).events[0].type,'other')
})

test('terminal loader fetches the exact run frozen artifacts and same config plan using same-origin cookies',async()=>{
  const calls=[], fetcher=mock(),signal=new AbortController().signal
  const bundle=await loadRunReplay({session:'session_test',run:'business_run',signal,fetcher:async(url,options)=>{calls.push({url,options});return fetcher(url,options)}})
  assert.deepEqual(bundle.context,{session_id:'session_test',run_id:'business_run',config_id:'config_test',engine_run_id:'engine_synthetic_replay'})
  assert.deepEqual(calls.map(c=>c.url).sort(),[
    '/api/sessions/session_test/runs/business_run','/api/sessions/session_test/runs/business_run/artifacts/trajectory',
    '/api/sessions/session_test/runs/business_run/artifacts/population-snapshot','/api/sessions/session_test/configs/config_test/stages/plan',
  ].sort())
  assert(calls.every(c=>c.options.credentials==='same-origin'&&c.options.cache==='no-store'&&c.options.signal===signal&&!c.options.headers))
  validateRunReplay(bundle)
  assert.equal(sceneOf(bundle).meta.application_run_id,'business_run')
})

test('loader separates login, missing, pending, malformed, unavailable and aborted responses',async()=>{
  for(const [status,expected] of [[401,'LOGIN_REQUIRED'],[404,'REPLAY_NOT_FOUND'],[409,'RUN_PENDING'],[500,'HTTP_ERROR']]){
    await assert.rejects(()=>loadRunReplay({session:'s',run:'r',fetcher:async()=>({ok:false,status})}),code(expected))
  }
  await assert.rejects(()=>loadRunReplay({session:'https://external.invalid',run:'r',fetcher:async()=>{throw Error('must not fetch')}}),code('INVALID_CONTEXT'))
  await assert.rejects(()=>loadRunReplay({session:'s',run:'r',fetcher:async()=>{throw TypeError('offline')}}),code('NETWORK_ERROR'))
  await assert.rejects(()=>loadRunReplay({session:'s',run:'r',fetcher:async()=>({ok:true,status:200,json:async()=>{throw Error('bad JSON')}})}),code('INVALID_RESPONSE'))
  const abort=new DOMException('cancelled','AbortError')
  await assert.rejects(()=>loadRunReplay({session:'s',run:'r',fetcher:async()=>{throw abort}}),e=>e===abort)
  let count=0
  await assert.rejects(()=>loadRunReplay({session:'s',run:'r',fetcher:async()=>{count++;return response({id:'r',config_id:'c',status:'running'})}}),code('RUN_PENDING'))
  assert.equal(count,1)
})

test('loader rejects cross-run and cross-configuration data and accepts coherent failed partial output',async()=>{
  const load=fetcher=>loadRunReplay({session:'session_test',run:'business_run',fetcher})
  const b=sample()
  await assert.rejects(()=>load(mock(b,{id:'other',config_id:'c',status:'completed'})),code('RUN_MISMATCH'))
  await assert.rejects(()=>load(mock(b,{id:'business_run',config_id:'c',status:'completed',engine_run_id:'other_engine'})),code('RUN_MISMATCH'))
  b.snapshot.snapshot_revision++
  await assert.rejects(()=>load(mock(b)),code('SNAPSHOT_MISMATCH'))
  const fetcher=mock()
  await assert.rejects(()=>load(async url=>url.endsWith('/stages/plan')?response({name:'plan',status:'pending',payload:null}):fetcher(url)),code('PLAN_PENDING'))
  await assert.rejects(()=>load(async url=>url.endsWith('/stages/plan')?response({name:'plan',status:'completed',config_id:'wrong',payload:read('plan')}):fetcher(url)),code('PLAN_MISMATCH'))
  for(const ending of ['/stages/plan','/artifacts/trajectory'])await assert.rejects(()=>load(async url=>url.endsWith(ending)?response(null):fetcher(url)),e=>e.code==='INVALID_RESPONSE'&&/响应格式不正确/.test(e.message))
  const partial=sample();partial.trajectory.status='failed';partial.trajectory.partial=true
  const result=await load(mock(partial,{id:'business_run',config_id:'config_test',status:'failed'}))
  assert.equal(result.trajectory.partial,true)
})
