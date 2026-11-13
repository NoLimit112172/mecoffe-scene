import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {loadTeamScene,prepareTeamPresentation} from '../src/mecoffe/teamScene.js'
import {loadSceneMap,PUBLISHED_SCENE_ASSETS} from '../src/mecoffe/sceneMap.js'
import {buildGenericReplayScenario,buildReplayActivity} from '../src/mecoffe/genericReplay.js'
import {clone,rehash,teamFixture,mockTeamApi,stage,mapStage} from './helpers/teamSceneFixtures.js'

async function load(b=teamFixture(),options={}){const api=mockTeamApi(b,options);return {...api,b,context:await loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher})}}
const blocked=value=>{assert.equal(value.kind,'blocked');assert.equal(typeof value.message,'string');assert(value.message.trim());assert(!value.placement)}
for(const version of [2,3])test(`team stage v${version}: exact config scenario, native snapshot/plan and complete immutable SceneResult`,async()=>{
  const b=teamFixture(version),before=JSON.stringify(b),api=mockTeamApi(b)
  const context=await loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher})
  assert.equal(context.kind,'map');assert.equal(context.configId,b.config_id)
  assert.deepEqual(context.sceneResult,b.scene_result);assert.deepEqual(context.configPlan,b.plan);assert.deepEqual(context.configSnapshot,b.snapshot)
  assert.equal(context.stage.payload.schema_version,'scene.map-stage.v1')
  assert.equal(JSON.stringify(b),before)
  assert.equal(api.calls[0].url,api.prefix)
  assert.deepEqual(api.calls.map(c=>c.url).sort(),[api.prefix,...['map','plan','network'].map(name=>`${api.prefix}/configs/${b.config_id}/stages/${name}`)].sort())
  for(const call of api.calls){assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.cache,'no-store');assert(!call.init.headers?.Authorization);assert(!call.init.method||call.init.method==='GET')}
})
test('explicit map false and legacy missing field remain different; neither requests map stage',async()=>{
  for(const [options,kind]of [[{map:false},'none'],[{legacy:true},'legacy']]){
    const {context,calls}=await load(teamFixture(),options)
    assert.equal(context.kind,kind);assert(calls.every(c=>!c.url.endsWith('/stages/map')))
    assert.equal(calls.filter(c=>c.url==='/api/sessions/synthetic-team-session').length,1)
  }
})
test('null/string/numeric map flags are blocked rather than silently treated as none or legacy',async()=>{
  for(const value of [null,'false',0,1]){
    const b=teamFixture(),api=mockTeamApi(b),detail=api.routes.get(api.prefix);detail.scenarios[0].content.map=value
    blocked(await loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher}))
  }
})
test('missing config/scenario, wrong session and inconsistent run-to-config links never become legacy',async()=>{
  for(const [mutate,code] of [[d=>d.configs=[],'CONFIG_NOT_FOUND'],[d=>d.scenarios=d.scenarios.slice(1),'CONFIG_NOT_FOUND'],[d=>d.session.id='another','INVALID_RESPONSE'],[d=>d.runs[0].config_id='another','RUN_MISMATCH']]){
    const b=teamFixture(),api=mockTeamApi(b);mutate(api.routes.get(api.prefix))
    await assert.rejects(()=>loadTeamScene({session:api.sid,config:b.config_id,run:'synthetic-team-run',fetcher:api.fetcher}),e=>e.code===code)
    assert.equal(api.calls.length,1)
  }
})
test('session failures and malformed HTTP data do not masquerade as missing legacy map fields',async()=>{
  for(const [value,code] of [[new Response('{}',{status:401}),'LOGIN_REQUIRED'],[new Response('{}',{status:404}),'CONFIG_NOT_FOUND'],[new Response('{}',{status:409}),'HTTP_ERROR'],[new Response('<html>bad</html>'),'INVALID_RESPONSE'],[new TypeError('offline'),'NETWORK_ERROR']]){
    const b=teamFixture(),api=mockTeamApi(b);api.routes.set(api.prefix,value)
    await assert.rejects(()=>loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher}),e=>e.code===code)
  }
})
test('explicit true with map 404, failed/pending stage or placeholder shell is blocked',async()=>{
  for(const value of [new Response('{}',{status:404}),stage('map',null,'running'),stage('map',null,'failed',{code:'MAP_NOT_READY',message:'合成地图库未准备好'}),stage('map',{schema_version:'1.0',places:[]})]){
    const b=teamFixture(),api=mockTeamApi(b);api.routes.set(`${api.prefix}/configs/${b.config_id}/stages/map`,value)
    blocked(await loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher}))
  }
})
test('map stage rejects result digest tampering and stale source refs even with a recomputed digest',async()=>{
  for(const change of [r=>r.result_sha256='0'.repeat(64),r=>{r.source_refs.config_id='another';rehash(r)},r=>{r.source_refs.snapshot_revision++;rehash(r)},r=>{r.source_refs.plan_revision++;rehash(r)}]){
    const b=teamFixture(),api=mockTeamApi(b),payload=mapStage(b);change(payload.payload.scene)
    api.routes.set(`${api.prefix}/configs/${b.config_id}/stages/map`,payload)
    blocked(await loadTeamScene({session:api.sid,config:b.config_id,fetcher:api.fetcher}))
  }
})
test('same and model-rebound plan revisions reuse frozen placement without changing its result/hash',async()=>{
  const {context,b}=await load(),before=JSON.stringify(context)
  for(const revision of [b.plan.plan_revision,b.plan.plan_revision+1,b.plan.plan_revision+4]){
    const plan={...clone(b.plan),plan_revision:revision},snapshot=clone(b.snapshot),inputs=JSON.stringify({plan,snapshot})
    const value=prepareTeamPresentation(context,{snapshot,plan})
    assert.equal(value.kind,'map');assert.deepEqual(value.placement.result,context.sceneResult)
    assert.deepEqual(value.placement.plan,context.configPlan);assert.deepEqual(value.placement.snapshot,context.configSnapshot)
    assert.equal(value.placement.config_id,b.config_id)
    assert.equal(value.placement.result.result_sha256,context.sceneResult.result_sha256)
    if(revision!==b.plan.plan_revision){assert.match(value.revisionNote,/核对一致/);assert(value.revisionNote.includes(String(revision)))}
    else assert(!value.revisionNote)
    assert.equal(JSON.stringify({plan,snapshot}),inputs)
  }
  assert.equal(JSON.stringify(context),before)
})
test('matching revision is insufficient: whole plan, owners, brands, runtime and plan identity must agree',async()=>{
  const {context,b}=await load()
  const changes=[p=>p.plan_id='another-plan',p=>p.economy.brands[0].owner_entity_id=b.snapshot.nodes[0].entity_id,
    p=>p.economy.products[0].price_fen++,p=>p.runtime.num_steps++,p=>p.platform.type='changed',p=>p.unexpected='changed',p=>p.economy.brands.reverse()]
  for(const mutate of changes)for(const sameRevision of [true,false]){
    const plan=clone(b.plan);if(!sameRevision)plan.plan_revision++;mutate(plan)
    blocked(prepareTeamPresentation(context,{snapshot:b.snapshot,plan}))
  }
})
test('snapshot ID/revision and every person ID/role are bound; array reordering does not reassign people',async()=>{
  const {context,b}=await load()
  for(const change of [s=>s.snapshot_id='another',s=>s.snapshot_revision++,s=>s.nodes.pop(),s=>s.nodes[0].entity_id='another',s=>s.nodes[0].role='another']){
    const snapshot=clone(b.snapshot);change(snapshot);blocked(prepareTeamPresentation(context,{snapshot,plan:b.plan}))
  }
  const snapshot=clone(b.snapshot);snapshot.nodes.reverse()
  const result=prepareTeamPresentation(context,{snapshot,plan:b.plan})
  assert.equal(result.kind,'map');assert.deepEqual(result.placement.result.assignments,b.scene_result.assignments)
})
test('none and legacy do not acquire a placement or rewrite simulation inputs',()=>{
  for(const kind of ['none','legacy']){
    const value=prepareTeamPresentation({kind,configId:'synthetic-config',message:kind},{snapshot:{},plan:{}})
    assert.equal(value.kind,kind);assert(!value.placement)
  }
})
test('actual replay revision 2 preserves original scene hash/ref 1 and records actual revision; forged binding cannot bypass checks',async()=>{
  const {context,b}=await load(),before=JSON.stringify(context.sceneResult)
  const map=await loadSceneMap(b.scene_result.map_ref,{mapsBase:'/maps/',assets:PUBLISHED_SCENE_ASSETS,fetcher:async url=>{
    try{return new Response(fs.readFileSync(new URL(String(url).slice('/maps/'.length),b.mapRoot)))}catch{return new Response('',{status:404})}
  }})
  const runtimePlan={...clone(b.plan),plan_revision:2},trajectory=clone(b.trajectory);trajectory.metadata.plan_revision=2
  const prepared=prepareTeamPresentation(context,{snapshot:b.snapshot,plan:runtimePlan})
  const bundle={snapshot:b.snapshot,plan:runtimePlan,trajectory,roles:b.roles,context:{config_id:b.config_id},scenePlacement:prepared.placement}
  const replay=buildGenericReplayScenario(bundle,map),meta=replay.files['trajectory.json'].meta
  assert.equal(meta.plan_revision,2);assert.equal(meta.scene_result.source_refs.plan_revision,1)
  assert.equal(meta.scene_result.result_sha256,b.scene_result.result_sha256);assert.equal(JSON.stringify(context.sceneResult),before)
  const altered=clone(runtimePlan);altered.runtime.num_steps++
  const alteredTrajectory=clone(trajectory);alteredTrajectory.metadata.total_steps=altered.runtime.num_steps
  assert.throws(()=>buildGenericReplayScenario({...bundle,plan:altered,trajectory:alteredTrajectory,scenePlacement:clone(prepared.placement)},map),e=>e.code==='REF_MISMATCH')
})
test('map-free replay activity keeps successful order IDs, quantities and money evidence',()=>{
  const b=teamFixture(),activity=buildReplayActivity({snapshot:b.snapshot,plan:b.plan,trajectory:b.trajectory,roles:b.roles,context:{config_id:b.config_id}})
  assert.equal(activity.summary.orders,2)
  const purchases=activity.events.filter(e=>e.type==='purchase')
  assert.equal(purchases.length,2)
  for(const order of b.trajectory.objects.orders){
    const event=purchases.find(e=>e.order_id===order.order_id)
    assert(event);assert.equal(event.quantity,order.quantity);assert.equal(event.amount_fen,order.amount_fen)
  }
  assert.equal(activity.summary.revenue_fen,b.trajectory.objects.orders.reduce((sum,o)=>sum+o.amount_fen,0))
})
