import fs from 'node:fs'
import {sceneDigest} from '../../src/mecoffe/sceneResult.js'

const fixtureUrl=name=>new URL(`../fixtures/${name}`,import.meta.url)
const read=name=>JSON.parse(fs.readFileSync(fixtureUrl(name),'utf8'))
export const clone=value=>structuredClone(value)
export function rehash(result){delete result.result_sha256;result.result_sha256=sceneDigest(result);return result}
export function teamFixture(version=2){
  if(version===3){
    const b=read('scene-taxonomy/input-v3.json')
    const template=read('scene-render/input-a.json').plan
    const snapshot={schema_version:'1.0',selection_request_id:'synthetic-selection',seed:42,edges:[],...b.snapshot}
    const plan={...template,...b.plan,population:{...b.plan.population,expected_agent_count:snapshot.nodes.length},economy:{...template.economy,
      brands:b.plan.economy.brands.map((brand,i)=>({...template.economy.brands[i],...brand})),
      products:b.plan.economy.products.map((product,i)=>({...template.economy.products[i],...product}))}}
    const roles={synthetic:true,population_request:Object.fromEntries([...new Set(b.snapshot.nodes.map(n=>n.role))].map(role=>[role,{description:role==='synthetic_student'?'合成学生':'合成经营者',count:b.snapshot.nodes.filter(n=>n.role===role).length,generate:{}}]))}
    return {synthetic:true,config_id:b.intent.config_id,snapshot,plan,scene_result:b.expected.result,roles,mapRoot:fixtureUrl('scene-taxonomy/maps/')}
  }
  const b=read('scene-render/input-a.json')
  // The frozen source fixture is v1. Upgrade only this in-memory synthetic
  // copy; neither historical JSON nor a published map is rewritten.
  b.scene_result.schema_version='scene.result.v2';rehash(b.scene_result)
  return {...b,mapRoot:fixtureUrl('scene-render/maps/')}
}
export function stage(name,payload,status='completed',error=null){return {name,status,reused:false,error,payload}}
export function mapStage(b){return stage('map',{schema_version:'scene.map-stage.v1',map_id:`map_${b.config_id}`,seed:b.scene_result.assignment_meta.assignment_seed,title:'合成团队地图',building_names:{},scene:clone(b.scene_result),provenance:{compiler:'synthetic test'}})}
export function sessionFixture(b,options={}){
  const sid=options.sid||'synthetic-team-session',run=options.run||'synthetic-team-run'
  const map=Object.hasOwn(options,'map')?options.map:true
  const content={engine:'oasis',title:'合成场景',goal:'离线测试',background:'完全合成，不使用团队人物',duration_days:b.plan.runtime.num_steps,
    roles:Object.entries(b.roles.population_request).map(([name,spec])=>({name,description:spec.description,count:spec.count,behavior:'合成测试',allowed_actions:[],decision_interval:1})),
    commerce:null,result_focus:'检查场景展示'}
  if(map!==undefined)content.map=map
  const selected={id:'synthetic-selected-scenario',turn_id:'synthetic-turn',version:1,content,created_at:'2026-01-01T00:00:00Z'}
  const metadata=name=>({name,status:'completed',reused:false,error:null})
  return {session:{id:sid,title:'合成会话',created_at:'2026-01-01T00:00:00Z'},messages:[],turns:[],
    scenarios:[selected,{id:'synthetic-latest-scenario',turn_id:'synthetic-turn-next',version:2,content:{...clone(content),map:false},created_at:'2026-01-02T00:00:00Z'}],
    configs:[{id:b.config_id,scenario_id:selected.id,parent_config_id:null,seed:b.plan.runtime.seed,engine:'oasis',status:'completed',error:null,created_at:'2026-01-01T00:00:00Z',stages:['roles','personas','network','plan',...(map===true?['map']:[])].map(metadata)}],
    runs:[{id:run,config_id:b.config_id,status:'running',phase:'steps',current_step:0,total_steps:b.plan.runtime.num_steps,error:null,created_at:'2026-01-01T00:00:00Z'}]}
}
export function mockTeamApi(b,options={}){
  const sid=options.sid||'synthetic-team-session',prefix=`/api/sessions/${sid}`,calls=[]
  const routes=new Map([[prefix,sessionFixture(b,{sid,map:options.legacy?undefined:options.map??true})],
    [`${prefix}/configs/${b.config_id}/stages/map`,mapStage(b)],
    [`${prefix}/configs/${b.config_id}/stages/plan`,stage('plan',clone(b.plan))],
    [`${prefix}/configs/${b.config_id}/stages/network`,stage('network',{snapshot:clone(b.snapshot),provenance:{}})]])
  const fetcher=async(url,init={})=>{
    calls.push({url:String(url),init})
    const value=routes.get(String(url))
    if(value instanceof Error)throw value
    if(value instanceof Response)return value.clone()
    return value===undefined?new Response('{}',{status:404}):new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
  }
  return {sid,prefix,calls,routes,fetcher}
}
