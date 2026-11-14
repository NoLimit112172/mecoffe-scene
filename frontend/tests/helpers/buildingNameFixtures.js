// Public, byte-frozen USTC v2 geometry plus wholly synthetic people/brands.
// Explicit overrides make this a display fixture, not a new placement algorithm.
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {sceneDigest,validateSceneResult} from '../../src/mecoffe/sceneResult.js'
import {teamFixture,rehash,clone} from './teamSceneFixtures.js'

export const USTC_NAME_CASES=Object.freeze({
  dormitory:{id:'way/1435368245',name:'5号楼'},
  diningStaff:{id:'way/1435377504',name:'教工食堂'},
  diningStudent:{id:'way/1435377505',name:'学生食堂A区'},
  unnamed:{id:'way/1501639766',name:'未命名楼栋'},
})

export function ustcBuildingNamesFixture(){
  const b=teamFixture(2),mapRoot=new URL('../../../data/maps/',import.meta.url)
  const read=name=>JSON.parse(fs.readFileSync(new URL(`ustc-gaoxin/2/${name}`,mapRoot),'utf8'))
  const manifestBytes=fs.readFileSync(new URL('ustc-gaoxin/2/manifest.json',mapRoot))
  const campus=read('campus3d.json'),entrances=read('entrances.json')
  const buildings=new Map(campus.buildings.map(item=>[item.osm_id,item]))
  const result=b.scene_result
  result.scene_id='scene_synthetic_ustc_building_names'
  result.map_ref={map_id:'ustc-gaoxin',map_version:'2',manifest_sha256:createHash('sha256').update(manifestBytes).digest('hex')}
  result.rules.role_prefs.visitor.functions=['dormitory']
  result.rules.overrides={entities:{},brands:{}}
  const place=(entry,id)=>{
    const building=buildings.get(id),entrance=entrances.entrances.find(item=>item.building_id===id&&item.scene_reachable)
    if(!building||!entrance)throw Error(`Public USTC fixture is missing reachable building ${id}`)
    Object.assign(entry,{status:'placed',building_id:id,entrance_id:entrance.id,
      reason:'合成显示验收：按已确认的指定楼栋安置，入口可达',fallback_used:null,
      evidence:clone((building.function_evidence||[]).filter(item=>item.source!=='name_keyword'))})
    result.rules.overrides[Object.hasOwn(entry,'entity_id')?'entities':'brands'][entry.entity_id??entry.brand_name]=id
  }
  for(const entry of result.assignments){
    if(entry.entity_id==='synthetic_person_06')place(entry,USTC_NAME_CASES.unnamed.id)
    else if(entry.status==='placed')place(entry,USTC_NAME_CASES.dormitory.id)
  }
  for(const entry of result.service_points){
    if(entry.brand_id==='brand_alpha')place(entry,USTC_NAME_CASES.diningStaff.id)
    if(entry.brand_id==='brand_beta')place(entry,USTC_NAME_CASES.diningStudent.id)
  }
  result.warnings=result.warnings.filter(warning=>!warning.refs.includes('synthetic_person_06'))
  result.assignment_meta.rules_sha256=sceneDigest(result.rules)
  rehash(result)
  validateSceneResult(result,{snapshot:b.snapshot,plan:b.plan,map:{map_ref:result.map_ref,campus,entrances}})
  return {...b,mapRoot,buildingNamesCases:USTC_NAME_CASES}
}
