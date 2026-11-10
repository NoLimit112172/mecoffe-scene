// SceneResult -> presentation only. Never chooses buildings or changes v1 validation.
import {validateSceneResult} from './sceneResult.js'
import {presentRole} from './rolePresentation.js'
export function checkScenePlacement(result,{snapshot,plan,config_id,map}={}){
  if(!plan||!snapshot||typeof config_id!=='string')throw new Error('缺少当前配置、快照或计划引用')
  return validateSceneResult(result,{snapshot,plan,source_refs:{config_id,snapshot_id:snapshot.snapshot_id,snapshot_revision:snapshot.snapshot_revision,plan_id:plan.plan_id,plan_revision:plan.plan_revision},...(map?{map:map.mapContext}:{} )})
}
export function buildScenePlacement(input,map,result){
  // Full source/plan check is performed by the caller; repeat map/snapshot validation before drawing.
  checkScenePlacement(result,{snapshot:input.snapshot,plan:input.scenePlan,config_id:input.sceneConfigId,map})
  if(result.mode!=='map')throw new Error('无地图模式不应创建地图场景')
  const files=structuredClone(map.files),campus=files['campus3d.json'],places=new Map(result.assignments.map(a=>[a.entity_id,a]))
  const mappings={},locations=[]
  function location(key,entry){
    if(entry.status==='out_of_scene')return null
    const b=campus.buildings.find(b=>b.osm_id===entry.building_id)
    mappings[key]={osm_id:entry.building_id,entrance_id:entry.entrance_id,osm_name:b.name,illustrative:true,note:entry.reason}
    locations.push({location_id:key,name:b.name||entry.building_id,kind:b.kind||'other',illustrative:true,buildings:[{building_id:key,name:b.name}],default_for_roles:[]})
    return key
  }
  const people=input.snapshot.nodes.map(node=>{
    const a=places.get(node.entity_id),spec=input.populationRequest[node.role],identity=presentRole(node.role,spec.description)
    const key=location(`scene_person_${node.entity_id}`,a)
    return {...structuredClone(node),id:node.entity_id,name:node.name||node.entity_id,...{role_label:identity.label,role_description:identity.description},
      bio:node.bio||node.description||'',profile:structuredClone(node.dynamic_attributes||{}),
      profile_fields:[...Object.entries(node.static_attributes||{}).map(([key,value])=>({key,label:key,value,source:'static'})),...Object.entries(node.dynamic_attributes||{}).map(([key,value])=>({key,label:spec.generate?.[key]?.title||key,value,source:'dynamic'}))],
      out_of_scene:a.status==='out_of_scene',placement:a,location_key:key,building_id:key,home_location_id:key,indoor:!a.status.startsWith('out'),placement_source:'scene_result'}
  })
  const brands=result.service_points.map(s=>({brand_id:s.brand_id,brand_name:s.brand_name,product_name:s.brand_name,owner_entity_id:s.owner_entity_id,merchant_id:s.owner_entity_id,
    out_of_scene:s.status==='out_of_scene',location_id:location(`scene_service_${s.service_id}`,s),placement:structuredClone(s)}))
  const scene={schema:'mecoffe.scene.v1',meta:{mode:'network_snapshot',config_preview:true,status:'not_run',run_id:null,partial:false,...input.context,
    scene_result:structuredClone(result),completed_steps:0,total_steps:0,placement_rule:'使用已校验的 SceneResult；人物和服务点独立；位置与路线为示意。'},
    people,brands,relationships:structuredClone(input.snapshot.edges),events:[],posts:{},campus:{schema_version:'mecoffe.campus.v2',campus_id:campus.campus_id,title:map.manifest.title,locations},
    summary:{people:people.length,relationships:input.snapshot.edges.length,events:0,orders:0,revenue_fen:0,noop:0,by_type:{}},days:[{step:0,label:'配置预览',complete:true,counts:{},noop:0}]}
  files['trajectory.json']=scene;files['location_mapping.json']={schema_version:'mecoffe.campus3d_mapping.v1',campus_id:campus.campus_id,illustrative:true,mappings}
  for(const f of files['gis/buildings.geojson'].features)f.properties.location_ids=Object.entries(mappings).filter(([,m])=>m.osm_id===f.id).map(([key])=>key)
  return {mapContext:map.mapContext,map_ref:map.map_ref,manifest:{...structuredClone(map.manifest),preview_mode:'config',simulation_data:false,generated_in_memory:true},files}
}
