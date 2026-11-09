import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {LIVE_API_PATHS,LIVE_QUEUE_LIMIT,liveApiPath,validateLiveBootstrap,normalizeLiveEvent,createLiveState,applyLivePage,
  setLivePaused,followLatestLive,takeLiveAnimations,buildLiveScenario,syncLiveScenario,compareLiveTerminal,createLiveRunSession} from '../src/mecoffe/liveRun.js'
import {acquireLiveRunSession,clearLiveRunSessions} from '../src/mecoffe/liveRunStore.js'

const read=name=>JSON.parse(fs.readFileSync(new URL(`fixtures/generic-replay/${name}.json`,import.meta.url)))
function fixture(){
  const snapshot=read('snapshot'),plan=read('plan'),trajectory=read('trajectory')
  const bootstrap={schema_version:'scene.live.v1',run_id:'business_run',engine_run_id:trajectory.run_id,config_id:'config_test',
    status:'running',phase:'steps',snapshot,plan,metadata:{snapshot_id:snapshot.snapshot_id,snapshot_revision:snapshot.snapshot_revision,plan_id:plan.plan_id,plan_revision:plan.plan_revision},synthetic:true}
  return {bootstrap,trajectory,snapshot,plan}
}
const checked=()=>validateLiveBootstrap(fixture().bootstrap,{session:'session_test',run:'business_run'})
const state=()=>createLiveState(checked())
function event(overrides={}){return {source:{run_id:'engine_synthetic_replay',audit_line:1,tool_call_index:0},step:1,agent:{entity_id:'synthetic_person_01'},action:'create_post',outcome:'executed',text:'明确标注的合成发帖内容',...overrides}}
function purchase(overrides={}){
  const {plan}=fixture(),product=plan.economy.products[0]
  return event({action:'purchase_product',product_name:product.product_name,brand_id:product.brand_id,order_id:'order_live_01',quantity:1,amount_fen:990,...overrides})
}
function page(overrides={}){return {status:'running',completed_step:0,active_step:1,events:[],day_summaries:[],next_cursor:'cursor_1',done:false,...overrides}}
function day(overrides={}){
  const p=purchase()
  return {step:1,orders:1,quantity:1,revenue_fen:990,posts:0,comments:0,
    verified_orders:[{order_id:p.order_id,entity_id:p.agent.entity_id,brand_id:p.brand_id,product_name:p.product_name,quantity:1,amount_fen:990}],...overrides}
}
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(value)})
const detail=(status='running')=>({id:'business_run',engine_run_id:'engine_synthetic_replay',config_id:'config_test',status})
function mapScenario(){
  const buildings=Array.from({length:3},(_,i)=>({osm_id:`synthetic/building_${i}`,name:`样例楼 ${i}`,kind:'education',polygon:[[i*30,0],[i*30+20,0],[i*30+20,20],[i*30,20],[i*30,0]]}))
  return {manifest:{id:'synthetic-map',title:'合成测试地图',simulation_data:false,simulation_time:{start:'2026-01-01T00:00:00+08:00'}},files:{
    'campus3d.json':{campus_id:'synthetic-map',title:'合成测试地图',buildings},'asset_assignments.json':{assignments:[]},'landcover.json':{features:[]},
    'gis/buildings.geojson':{type:'FeatureCollection',features:buildings.map(b=>({type:'Feature',id:b.osm_id,properties:{}}))}}}
}
const errorCode=code=>error=>error.code===code
function sessionWith(fetcher,extra={}){return createLiveRunSession({session:'session_test',run:'business_run',fetcher,setTimer:()=>0,clearTimer:()=>{},...extra})}
function liveFetcher(overrides={}){return async url=>{
  if(url.includes('/stages/roles'))return response(null,404)
  if(url.includes('/scene/bootstrap'))return overrides.bootstrap?.(url)||response(fixture().bootstrap)
  if(url.includes('/scene/events'))return overrides.events?.(url)||response(page())
  return overrides.detail?.(url)||response(detail())
}}

test('draft API paths are centralized, same-origin and safely constrained',()=>{
  assert.equal(liveApiPath('bootstrap',{session:'session_test',run:'business_run'}),'/api/sessions/session_test/runs/business_run/scene/bootstrap')
  assert(Object.values(LIVE_API_PATHS).every(path=>path.startsWith('/api/')))
  assert.throws(()=>liveApiPath('events',{session:'../../private',run:'run'}),errorCode('INVALID_LIVE'))
  assert.throws(()=>liveApiPath('arbitrary',{session:'session',run:'run'}),errorCode('INVALID_LIVE'))
})

test('bootstrap strictly binds business run, engine run and frozen revisions',()=>{
  assert.equal(checked().snapshot.nodes.length,7)
  for(const [mutate,code] of [
    [b=>b.run_id='another','RUN_MISMATCH'],[b=>b.metadata.snapshot_revision++,'SNAPSHOT_MISMATCH'],
    [b=>b.metadata.plan_revision++,'PLAN_MISMATCH'],[b=>b.plan.population.expected_agent_count++,'POPULATION_MISMATCH'],
  ]){const b=fixture().bootstrap;mutate(b);assert.throws(()=>validateLiveBootstrap(b,{session:'session_test',run:'business_run'}),errorCode(code))}
  assert.throws(()=>validateLiveBootstrap(fixture().bootstrap,{session:'session_test',run:'business_run',detail:{...detail(),config_id:'another'}}),errorCode('RUN_MISMATCH'))
  const b=fixture().bootstrap;b.roles={bad:'optional'}
  assert.equal(validateLiveBootstrap(b,{session:'session_test',run:'business_run'}).roles,undefined)
})

test('normalization accepts only display whitelist and explicit outcomes',()=>{
  const e=normalizeLiveEvent(event({prompt:'SECRET_TEST_SENTINEL',args:{observations:['private']},result:{url:'hidden'},text:'样例\u0000正文'}),checked())
  assert.equal(e.text,'样例正文');assert.equal(e.key,'engine_synthetic_replay:1:0')
  for(const key of ['prompt','args','result','observations'])assert.equal(e[key],undefined)
  assert.throws(()=>normalizeLiveEvent(event({outcome:'success'}),checked()),errorCode('INVALID_LIVE'))
  assert.throws(()=>normalizeLiveEvent(event({agent:{entity_id:'not_in_snapshot'}}),checked()),errorCode('UNKNOWN_PERSON'))
  assert.throws(()=>normalizeLiveEvent(event({source:{run_id:'wrong',audit_line:1,tool_call_index:0}}),checked()),errorCode('RUN_MISMATCH'))
})

test('a pending purchase gets only an attempt bubble; evidence upgrades it once to a successful animation',()=>{
  let s=applyLivePage(state(),page({events:[purchase()]}))
  assert.equal(s.events[0].type,'purchase_pending');assert.equal(s.events[0].evidence_status,'pending')
  assert.equal(s.summary.orders,0);assert.equal(s.summary.revenue_fen,0);assert.equal(s.animationQueue.length,1);assert.equal(s.animationQueue[0].type,'purchase_pending')
  s=applyLivePage(s,page({completed_step:1,day_summaries:[day()],next_cursor:'cursor_2'}))
  assert.equal(s.events[0].type,'purchase');assert.equal(s.events[0].evidence_status,'verified')
  assert.equal(s.summary.orders,1);assert.equal(s.summary.revenue_fen,990);assert.equal(s.animationQueue.length,2);assert.equal(s.animationQueue.filter(e=>e.type==='purchase').length,1)
  const after=applyLivePage(s,page({completed_step:1,events:[purchase()],day_summaries:[day()],next_cursor:'cursor_2'}))
  assert.equal(after.summary.orders,1);assert.equal(after.animationQueue.length,2)
})

test('summary can arrive before the event without losing verification or duplicating an order',()=>{
  let s=applyLivePage(state(),page({completed_step:1,day_summaries:[day()]}))
  assert.equal(s.summary.orders,1);assert.equal(s.animationQueue.length,0)
  s=applyLivePage(s,page({completed_step:1,events:[purchase()]}))
  assert.equal(s.events[0].type,'purchase');assert.equal(s.animationQueue.length,1)
})

test('completed day without matching order keeps the attempt visible as unverified',()=>{
  const s=applyLivePage(state(),page({completed_step:1,events:[purchase()],day_summaries:[day({orders:0,quantity:0,revenue_fen:0,verified_orders:[]})]}))
  assert.equal(s.events[0].evidence_status,'unverified');assert.equal(s.events[0].text,'订单未核实')
  assert.equal(s.summary.orders,0);assert.equal(s.animationQueue.length,1);assert.equal(s.animationQueue[0].evidence_status,'unverified');assert.equal(s.animationQueue.filter(e=>e.type==='purchase').length,0)
})

test('ID-only confirmation requires complete action evidence and exact totals',()=>{
  const summary=day({verified_orders:[],verified_order_ids:['order_live_01']})
  let s=applyLivePage(state(),page({completed_step:1,events:[purchase({amount_fen:undefined})],day_summaries:[summary]}))
  assert.equal(s.events[0].type,'purchase_pending');assert.equal(s.animationQueue.filter(e=>e.type==='purchase').length,0)
  assert.equal(s.summary.orders,0);assert.equal(s.events[0].evidence_status,'incomplete');assert.match(s.evidenceWarning,/证据不完整/)
  assert.throws(()=>applyLivePage(state(),page({completed_step:1,events:[purchase()],day_summaries:[{...summary,revenue_fen:1000}]})),errorCode('ORDER_MISMATCH'))
})

test('declined, failed, unknown and noop never produce a successful order',()=>{
  const events=['declined','failed','unknown','noop'].map((outcome,i)=>purchase({outcome,source:{run_id:'engine_synthetic_replay',audit_line:i+1,tool_call_index:0}}))
  const s=applyLivePage(state(),page({events}))
  assert.equal(s.summary.orders,0);assert.equal(s.summary.declined,1);assert.equal(s.summary.unknown,1);assert.equal(s.summary.failed,1);assert.equal(s.summary.noop,1)
  assert(!s.events.some(e=>e.type==='purchase'));assert(!s.animationQueue.some(e=>e.type==='purchase'))
})

test('bad pages cannot mutate state or advance cursor; immutable origins cannot change',()=>{
  const initial=state(),before=structuredClone(initial)
  assert.throws(()=>applyLivePage(initial,page({events:[event(),event({agent:{entity_id:'invalid'}})]})),errorCode('UNKNOWN_PERSON'))
  assert.deepEqual(initial,before)
  const once=applyLivePage(initial,page({events:[event()]}))
  assert.throws(()=>applyLivePage(once,page({events:[event({text:'changed'})],next_cursor:'bad'})),errorCode('EVENT_CONFLICT'))
  assert.equal(once.cursor,'cursor_1')
  assert.throws(()=>applyLivePage(once,page({completed_step:2,active_step:1})),errorCode('INVALID_LIVE'))
})

test('summary and action mismatch refuses false sales instead of silently rewriting them',()=>{
  assert.throws(()=>applyLivePage(state(),page({completed_step:1,events:[purchase({amount_fen:1000})],day_summaries:[day()]})),errorCode('ORDER_MISMATCH'))
  assert.throws(()=>applyLivePage(state(),page({completed_step:1,day_summaries:[day({revenue_fen:1000})]})),errorCode('ORDER_MISMATCH'))
  const s=applyLivePage(state(),page({completed_step:1,day_summaries:[day()]}))
  assert.throws(()=>applyLivePage(s,page({completed_step:1,day_summaries:[day({posts:1})]})),errorCode('SUMMARY_CONFLICT'))
  assert.throws(()=>applyLivePage(state(),page({completed_step:1,events:[purchase({outcome:'unknown'})],day_summaries:[day()]})),errorCode('ORDER_MISMATCH'))
})

test('animation queues are globally bounded, coalesced by person and do not pause the run',()=>{
  const events=Array.from({length:100},(_,i)=>event({source:{run_id:'engine_synthetic_replay',audit_line:i+1,tool_call_index:0},agent:{entity_id:`synthetic_person_0${i%7+1}`}}))
  let s=applyLivePage(state(),page({events}));assert(s.animationQueue.length<=LIVE_QUEUE_LIMIT)
  assert(s.animationQueue.filter(e=>e.actor==='synthetic_person_01').length<=2)
  s=setLivePaused(s,true);assert.equal(takeLiveAnimations(s).events.length,0)
  const running=applyLivePage(s,page({completed_step:1,day_summaries:[day({orders:0,quantity:0,revenue_fen:0,verified_orders:[],posts:100})]}))
  assert.equal(running.completedStep,1);assert.equal(running.summary.posts,100);assert.equal(running.paused,true)
  const latest=followLatestLive(running);assert.equal(latest.paused,false);assert.equal(latest.animationQueue.length,0)
  assert.equal(latest.events.length,100)
})

test('quiet lookups and noop do not flood the map with effects',()=>{
  const events=['refresh','search_posts','trend','do_nothing'].map((action,i)=>event({action,outcome:action==='do_nothing'?'noop':'executed',source:{run_id:'engine_synthetic_replay',audit_line:i+1,tool_call_index:0}}))
  assert.equal(applyLivePage(state(),page({events})).animationQueue.length,0)
})

test('scene updates preserve map, population and mapping identities in both display modes',()=>{
  let s=state();const map=mapScenario(),scenario=buildLiveScenario(s,map)
  const geometry=scenario.files['campus3d.json'],people=scenario.files['trajectory.json'].people,mapping=scenario.files['location_mapping.json']
  s=applyLivePage(s,page({events:[event(),purchase({source:{run_id:'engine_synthetic_replay',audit_line:2,tool_call_index:0}})]}))
  assert.equal(syncLiveScenario(s,scenario),scenario);assert.equal(scenario.files['campus3d.json'],geometry)
  assert.equal(scenario.files['trajectory.json'].people,people);assert.equal(scenario.files['location_mapping.json'],mapping)
  assert.equal(scenario.manifest.preview_mode,'live');assert.equal(scenario.files['trajectory.json'].meta.live_run,true)
  assert.equal(scenario.files['trajectory.json'].summary.orders,0)
  assert.equal(scenario.files['trajectory.json'].events.length,2)
})

test('failed live state retains verified summaries and explicitly marks partial results',()=>{
  const s=applyLivePage(state(),page({status:'failed',completed_step:1,events:[purchase()],day_summaries:[day()],done:true}))
  assert.equal(s.partial,true);assert.equal(s.summary.orders,1);assert.match(s.message,/部分/)
  assert.throws(()=>applyLivePage(s,page({status:'running',completed_step:1})),errorCode('INVALID_LIVE'))
})

test('terminal comparison reports differences instead of pretending live totals are authoritative',()=>{
  const bundle=fixture(),s=state(),diff=compareLiveTerminal(s,bundle)
  assert(diff.some(d=>d.field==='orders'&&d.official===2));assert(diff.some(d=>d.field==='revenue_fen'&&d.official===2190))
})

test('controller polls with same-origin credentials, cursor continuation and optional role fallback',async()=>{
  const calls=[],session=sessionWith(async(url,options)=>{calls.push({url,options});return liveFetcher({events:()=>response(page({events:[event()]}))})(url)})
  await session.pollOnce();await session.pollOnce()
  assert.equal(session.snapshot().events.length,1)
  assert(calls.every(c=>c.options.credentials==='same-origin'&&c.options.cache==='no-store'))
  assert(calls.some(c=>c.url.includes('after=cursor_1')))
  assert.equal(calls.filter(c=>c.url.endsWith('/scene/bootstrap')).length,1)
  assert.equal(calls.filter(c=>c.url.endsWith('/stages/roles')).length,1)
  session.stop()
})

test('missing bootstrap gracefully waits for terminal state and automatically opens strict replay',async()=>{
  let ended=false,loads=0
  const session=sessionWith(liveFetcher({detail:()=>response(detail(ended?'completed':'running')),bootstrap:()=>response(null,404)}),{loadReplay:async()=>{loads++;return {...fixture(),context:{engine_run_id:'engine_synthetic_replay'}}}})
  await session.pollOnce();assert.equal(session.snapshot().mode,'waiting');assert.match(session.snapshot().message,/尚未提供实时接口/)
  ended=true;await session.pollOnce();assert.equal(session.snapshot().mode,'replay');assert.equal(loads,1)
  session.stop()
})

test('initialization keeps its real status when frozen inputs are still being prepared',async()=>{
  const session=sessionWith(liveFetcher({detail:()=>response({...detail('initializing'),phase:'registering_agents'}),bootstrap:()=>response(null,409)}))
  await session.pollOnce()
  assert.equal(session.snapshot().status,'initializing')
  assert.equal(session.snapshot().phase,'registering_agents')
  assert.equal(session.snapshot().error.code,'LIVE_PENDING')
  session.stop()
})

test('a missing run is not misreported as an absent bootstrap feature',async()=>{
  let bootstrapCalls=0
  const session=sessionWith(liveFetcher({detail:()=>response(null,404),bootstrap:()=>{bootstrapCalls++;return response(fixture().bootstrap)}}))
  await session.pollOnce()
  assert.equal(session.snapshot().error.code,'RUN_NOT_FOUND')
  assert.match(session.snapshot().message,/运行不存在或当前账号无权访问/)
  assert.equal(bootstrapCalls,0)
  session.stop()
})

test('401 clears retained private data, while 409 and network failures are recoverable',async()=>{
  let failure=0
  const session=sessionWith(liveFetcher({events:()=>failure===401?response(null,401):failure===409?response(null,409):response(page({events:[event()]}))}))
  await session.pollOnce();assert(session.snapshot().bootstrap)
  failure=409;await session.pollOnce();assert.equal(session.snapshot().error.code,'LIVE_PENDING');assert(session.snapshot().bootstrap)
  failure=401;await session.pollOnce();assert.equal(session.snapshot().error.code,'LOGIN_REQUIRED');assert.equal(session.snapshot().bootstrap,undefined);assert.equal(session.snapshot().events,undefined)
  session.stop()
  const network=sessionWith(async()=>{throw new Error('offline')});await network.pollOnce();assert.equal(network.snapshot().error.code,'NETWORK_ERROR');network.stop()
})

test('terminal artifacts 409 wait and preserve confirmed live state, then strict mismatch rejects',async()=>{
  let finished=false,ready=false,bad=false
  const loader=async()=>{if(!ready)throw Object.assign(new Error('pending'),{code:'RUN_PENDING'});const b=fixture();if(bad)b.plan.plan_revision++;return b}
  const session=sessionWith(liveFetcher({detail:()=>response(detail(finished?'completed':'running')),events:()=>response(page({status:finished?'completed':'running',done:finished,completed_step:1,events:[purchase()],day_summaries:[day()]}))}),{loadReplay:loader})
  await session.pollOnce();finished=true;await session.pollOnce();assert.equal(session.snapshot().summary.orders,1);assert.match(session.snapshot().message,/等待/)
  ready=true;bad=true;await session.pollOnce();assert.equal(session.snapshot().error.code,'PLAN_MISMATCH');assert.notEqual(session.snapshot().mode,'replay')
  bad=false;await session.pollOnce();assert.equal(session.snapshot().mode,'replay');assert(session.snapshot().differences.length)
  session.stop()
})

test('store retains state and pause across 3D/GIS switches but releases a different private run',async()=>{
  clearLiveRunSessions();const options={session:'session_test',run:'business_run',fetcher:liveFetcher(),setTimer:()=>0,clearTimer:()=>{}}
  const first=acquireLiveRunSession(options);await first.session.pollOnce();first.session.pause(true);first.release()
  const second=acquireLiveRunSession(options);assert.equal(second.session,first.session);assert.equal(second.session.snapshot().paused,true)
  second.release();const another=acquireLiveRunSession({...options,run:'another_run'})
  assert.notEqual(another.session,first.session);assert.equal(another.session.snapshot().bootstrap,undefined)
  another.release();clearLiveRunSessions()
})

test('polling never overlaps and a disposed request cannot publish a late private response',async()=>{
  let release,requests=0,notifications=0
  const session=sessionWith(async()=>{requests++;return await new Promise(resolve=>{release=resolve})},{onChange:()=>notifications++})
  session.start();session.start();session.retry()
  assert.equal(requests,1)
  session.stop();release(response(detail()))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(notifications,0);assert.equal(session.snapshot().bootstrap,undefined)
})

test('transient failures back off and successful polling returns to the configured interval',async()=>{
  const delays=[];let offline=true
  const session=sessionWith(async(url,options)=>{if(offline)throw new Error('offline');return liveFetcher()(url,options)},
    {setTimer:(callback,delay)=>{delays.push(delay);return 0}})
  await session.pollOnce();assert.equal(delays.at(-1),4000)
  await session.pollOnce();assert.equal(delays.at(-1),8000)
  offline=false;await session.pollOnce();assert.equal(delays.at(-1),2000)
  assert.equal(session.snapshot().mode,'live');session.stop()
})

test('roles remain optional but a roles 401 still clears private initialization',async()=>{
  for(const code of [404,409,500]){
    const session=sessionWith(async(url,options)=>url.endsWith('/stages/roles')?response(null,code):liveFetcher()(url,options))
    await session.pollOnce();assert.equal(session.snapshot().mode,'live');session.stop()
  }
  const login=sessionWith(async(url,options)=>url.endsWith('/stages/roles')?response(null,401):liveFetcher()(url,options))
  await login.pollOnce();assert.equal(login.snapshot().error.code,'LOGIN_REQUIRED');assert.equal(login.snapshot().bootstrap,undefined);login.stop()
})

test('terminal detail drains every final page before comparing official counts',async()=>{
  let ended=false,tail=0,loaded=0
  const bundle=fixture(),order=bundle.trajectory.objects.orders[1]
  const second=purchase({source:{run_id:bundle.trajectory.run_id,audit_line:7,tool_call_index:0},step:2,
    agent:{entity_id:order.entity_id},order_id:order.order_id,product_name:order.product_name,brand_id:order.brand_id,quantity:1,amount_fen:1200})
  const secondDay={step:2,orders:1,quantity:1,revenue_fen:1200,posts:0,comments:0,verified_orders:[{...order}]}
  const session=sessionWith(liveFetcher({
    detail:()=>response(detail(ended?'completed':'running')),
    events:()=>{
      if(!ended)return response(page({events:[purchase()],next_cursor:'initial'}))
      tail++
      if(tail===1)return response(page({status:'completed',completed_step:1,active_step:2,day_summaries:[day({posts:1})],next_cursor:'tail_1'}))
      if(tail===2)return response(page({status:'completed',completed_step:2,active_step:2,events:[second],day_summaries:[secondDay],next_cursor:'tail_2'}))
      return response(page({status:'completed',completed_step:2,active_step:2,next_cursor:'tail_2',done:true}))
    },
  }),{loadReplay:async()=>{loaded++;assert.equal(tail,3);return bundle}})
  await session.pollOnce();assert.equal(session.snapshot().summary.orders,0)
  ended=true;await session.pollOnce()
  assert.equal(tail,3);assert.equal(loaded,1);assert.equal(session.snapshot().mode,'replay');assert.deepEqual(session.snapshot().differences,[])
  const original=session.snapshot().replayBundle;session.stop();session.start()
  assert.equal(loaded,1);assert.equal(session.snapshot().replayBundle,original)
  await session.pollOnce();assert.equal(loaded,1);session.stop()
})

test('terminal detail waits for a final live page 409 instead of skipping straight to replay',async()=>{
  let ended=false,ready=false,loaded=0
  const session=sessionWith(liveFetcher({detail:()=>response(detail(ended?'completed':'running')),
    events:()=>ended&&!ready?response(null,409):response(page({status:ended?'completed':'running',done:ended}))}),
    {loadReplay:async()=>{loaded++;return fixture()}})
  await session.pollOnce();ended=true;await session.pollOnce()
  assert.equal(loaded,0);assert.equal(session.snapshot().error.code,'LIVE_PENDING');assert.equal(session.snapshot().mode,'live')
  ready=true;await session.pollOnce();assert.equal(loaded,1);assert.equal(session.snapshot().mode,'replay');session.stop()
})

test('every detail poll checks frozen identity before accepting further events',async()=>{
  let changed=false,eventCalls=0
  const session=sessionWith(liveFetcher({detail:()=>response({...detail(),...(changed?{config_id:'another_config'}:{})}),
    events:()=>{eventCalls++;return response(page())}}))
  await session.pollOnce();changed=true;await session.pollOnce()
  assert.equal(session.snapshot().error.code,'RUN_MISMATCH');assert.equal(eventCalls,1);session.stop()
})

test('a hung fetch times out, aborts its request, and automatically retries without staying busy',async()=>{
  const requests=new Map(),polls=[];let hanging=true,abortedSignal,calls=0
  const session=sessionWith(async(url,options)=>{
    calls++;if(hanging){abortedSignal=options.signal;return await new Promise(()=>{})}
    return liveFetcher()(url,options)
  },{requestTimeoutMs:25,setRequestTimer:callback=>{const handle=Symbol();requests.set(handle,callback);return handle},
    clearRequestTimer:handle=>requests.delete(handle),setTimer:(callback,delay)=>{polls.push({callback,delay});return 0}})
  session.start();assert.equal(requests.size,1)
  requests.values().next().value();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(abortedSignal.aborted,true);assert.equal(session.snapshot().error.code,'NETWORK_ERROR');assert.match(session.snapshot().message,/超时/)
  assert.equal(polls.at(-1).delay,4000);assert.equal(requests.size,0)
  hanging=false;polls.at(-1).callback();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(session.snapshot().mode,'live');assert.equal(session.snapshot().error,null);assert(calls>=5);assert.equal(requests.size,0)
  session.stop()
})

test('the request deadline includes a hung JSON body and ignores its late completion',async()=>{
  const requests=new Map();let resolveBody,notifications=0
  const session=sessionWith(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{resolveBody=resolve})}),
    {requestTimeoutMs:25,setRequestTimer:callback=>{const handle=Symbol();requests.set(handle,callback);return handle},clearRequestTimer:handle=>requests.delete(handle),onChange:()=>notifications++})
  session.start();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.size,1)
  requests.values().next().value();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(session.snapshot().error.code,'NETWORK_ERROR');const after=notifications
  resolveBody(detail());await new Promise(resolve=>setImmediate(resolve));assert.equal(notifications,after);assert.equal(session.snapshot().bootstrap,undefined)
  session.stop();assert.equal(requests.size,0)
})

test('stop cancels its deadline immediately and deliberate abort never becomes a timeout error',async()=>{
  const requests=new Map();let release,signal,notifications=0
  const session=sessionWith(async(url,options)=>{signal=options.signal;return await new Promise(resolve=>{release=resolve})},
    {requestTimeoutMs:25,setRequestTimer:callback=>{const handle=Symbol();requests.set(handle,callback);return handle},clearRequestTimer:handle=>requests.delete(handle),onChange:()=>notifications++})
  session.start();assert.equal(requests.size,1);session.stop();assert.equal(requests.size,0);assert.equal(signal.aborted,true)
  await new Promise(resolve=>setImmediate(resolve));release(response(detail()));await new Promise(resolve=>setImmediate(resolve))
  assert.equal(notifications,0);assert.equal(session.snapshot().error,null);assert.equal(session.snapshot().bootstrap,undefined)
})
