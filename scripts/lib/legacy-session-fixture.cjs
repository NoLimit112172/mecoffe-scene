// Exact SessionDetail linkage for old synthetic runs. Missing map is deliberate;
// a 404 response is never used as evidence that this is a legacy configuration.
function legacySession({session,config,run,status='running'}){
  const scenario='synthetic-scenario';
  return {session:{id:session,title:'合成旧会话',created_at:'2026-01-01T00:00:00Z'},messages:[],turns:[],
    scenarios:[{id:scenario,turn_id:'synthetic-turn',version:1,content:{title:'合成旧需求',goal:'离线展示测试'},created_at:'2026-01-01T00:00:00Z'}],
    configs:[{id:config,scenario_id:scenario,parent_config_id:null,seed:42,engine:'oasis',status:'completed',error:null,
      created_at:'2026-01-01T00:00:00Z',stages:['roles','personas','network','plan'].map(name=>({name,status:'completed',reused:false,error:null}))}],
    runs:run?[{id:run,config_id:config,status,phase:'steps',current_step:0,total_steps:2,error:null,created_at:'2026-01-01T00:00:00Z'}]:[]};
}
module.exports={legacySession};
