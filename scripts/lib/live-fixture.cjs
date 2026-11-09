// Entirely synthetic, versioned test fixtures. Never reads private data.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'frontend/tests/fixtures/generic-replay',name+'.json'),'utf8'));
function liveFixture(){
  const snapshot=read('snapshot'),plan=read('plan'),trajectory=read('trajectory');
  const session='synthetic-live-session',run='synthetic-live-run',config='synthetic-live-config';
  const prefix=`/api/sessions/${session}/runs/${run}`,stages=`/api/sessions/${session}/configs/${config}/stages/`;
  const brands=plan.economy.brands,products=plan.economy.products;
  const roles={population_request:Object.fromEntries([...new Set(snapshot.nodes.map(n=>n.role))].map(role=>[role,{
    description:{visitor:'合成校园访客',operator:'合成门店经营者',research:'合成科研人员'}[role],count:snapshot.nodes.filter(n=>n.role===role).length,generate:{},
  }]))};
  const bootstrap={schema_version:'scene.live.v1',run_id:run,engine_run_id:trajectory.run_id,config_id:config,status:'running',phase:'steps',snapshot,plan,
    metadata:{snapshot_id:snapshot.snapshot_id,snapshot_revision:snapshot.snapshot_revision,plan_id:plan.plan_id,plan_revision:plan.plan_revision},synthetic:true};
  const events=trajectory.actions.map(action=>{
    const result=action.result||{},args=action.args||{},product=products.find(p=>p.product_name===(result.product_name||args.product_name));
    const brand=product?.brand_id||brands.find(b=>b.owner_entity_id===action.actor.entity_id)?.brand_id;
    return {source:{run_id:trajectory.run_id,audit_line:action.audit_line,tool_call_index:0},step:action.step,agent:{entity_id:action.actor.entity_id},
      action:action.action,outcome:action.outcome,stage:action.stage,text:args.content||'',message:result.reason||result.message||'',
      ...(brand?{brand_id:brand}:{}),...(product?{product_name:product.product_name}:{}),
      ...(result.order_id?{order_id:result.order_id,quantity:result.quantity,amount_fen:result.amount_fen}:{}),
      ...(result.post_id?{post_id:result.post_id}:{}),...(result.cost_fen!=null?{cost_fen:result.cost_fen}:{}),
      ...(action.action==='set_product_price'?{price_fen:result.price??args.price_fen}:{}),
      ...(action.action==='follow'?{target:action.targets.find(t=>t.type==='agent').entity_id}:{}),
    };
  });
  const missing={...structuredClone(events.find(e=>e.action==='purchase_product'&&e.outcome==='executed')),
    source:{run_id:trajectory.run_id,audit_line:11,tool_call_index:0},agent:{entity_id:'synthetic_person_02'},order_id:'synthetic_missing_order'};
  function day(step){
    const orders=trajectory.objects.orders.filter(order=>order.step===step);
    return {step,orders:orders.length,quantity:orders.reduce((n,o)=>n+o.quantity,0),revenue_fen:orders.reduce((n,o)=>n+o.amount_fen,0),
      posts:trajectory.actions.filter(a=>a.step===step&&a.origin!=='initialization'&&a.outcome==='executed'&&['create_post','publish_ad'].includes(a.action)).length,
      comments:0,verified_orders:orders.map(o=>({order_id:o.order_id,entity_id:o.entity_id,brand_id:o.brand_id,product_name:o.product_name,quantity:o.quantity,amount_fen:o.amount_fen}))};
  }
  function page(phase='pending'){
    const complete=['second','terminal','partial'].includes(phase)?2:phase==='confirmed'?1:0;
    const active=complete===2?2:1;
    return {status:phase==='partial'?'failed':'running',completed_step:complete,active_step:active,
      events:phase==='pending'?[events[0],events[1],missing]:[...events.filter(e=>e.step<=active),missing],
      day_summaries:Array.from({length:complete},(_,i)=>day(i+1)),next_cursor:complete===2?'synthetic-cursor-2':complete===1?'synthetic-cursor-1':'synthetic-cursor-pending',done:phase==='partial'};
  }
  return {snapshot,plan,trajectory,session,run,config,prefix,stages,roles,bootstrap,events,missing,page,
    detail:status=>({id:run,config_id:config,engine_run_id:trajectory.run_id,status})};
}
module.exports={liveFixture};
