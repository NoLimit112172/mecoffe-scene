import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {buildingName,hasBuildingName} from '../src/mecoffe/buildingDisplay.js'
import {validateSceneResult} from '../src/mecoffe/sceneResult.js'
import {ustcBuildingNamesFixture,USTC_NAME_CASES} from './helpers/buildingNameFixtures.js'

test('building display uses real named dormitory and both public USTC dining buildings',()=>{
  const campus=JSON.parse(fs.readFileSync(new URL('../../data/maps/ustc-gaoxin/2/campus3d.json',import.meta.url),'utf8'))
  for(const {id,name}of [USTC_NAME_CASES.dormitory,USTC_NAME_CASES.diningStaff,USTC_NAME_CASES.diningStudent]){
    const building=campus.buildings.find(item=>item.osm_id===id),before=structuredClone(building)
    assert.equal(buildingName(building),name)
    assert.equal(hasBuildingName(building),true)
    assert.deepEqual(building,before,'display must not alter frozen building data')
  }
})

test('empty, absent, non-text and exact builder fallback names display 未命名楼栋',()=>{
  for(const building of [{},{name:null},{name:42},{name:''},{name:' \t '},
    {osm_id:'way/1501639766',name:'未命名建筑（way/1501639766）'},
    {name:'historical display fallback',name_source:'display_fallback'}]){
    const before=structuredClone(building)
    assert.equal(buildingName(building),'未命名楼栋')
    assert.equal(hasBuildingName(building),false)
    assert.deepEqual(building,before)
  }
  assert.equal(buildingName(), '未命名楼栋')
  assert.equal(buildingName({name:'  教工食堂  '}),'教工食堂')
  assert.equal(buildingName({osm_id:'way/other',name:'未命名建筑（正式名称）'}),'未命名建筑（正式名称）','only the exact generated placeholder may be hidden')
})

test('USTC name display fixture retains official map bytes, valid scene hashes and evidence key/value/ref',()=>{
  const b=ustcBuildingNamesFixture(),result=structuredClone(b.scene_result)
  const campus=JSON.parse(fs.readFileSync(new URL('ustc-gaoxin/2/campus3d.json',b.mapRoot),'utf8'))
  const entrances=JSON.parse(fs.readFileSync(new URL('ustc-gaoxin/2/entrances.json',b.mapRoot),'utf8'))
  const before=structuredClone(campus)
  assert.deepEqual(validateSceneResult(result,{snapshot:b.snapshot,plan:b.plan,map:{map_ref:result.map_ref,campus,entrances}}),result)
  for(const service of result.service_points.filter(item=>item.status==='placed')){
    assert.deepEqual(service.evidence,[{function:'dining',key:'functions',ref:service.building_id,source:'annotation',value:'dining'}])
  }
  const unnamed=campus.buildings.find(item=>item.osm_id===USTC_NAME_CASES.unnamed.id)
  assert.equal(unnamed.name,'未命名建筑（way/1501639766）')
  assert.equal(buildingName(unnamed),'未命名楼栋')
  assert.deepEqual(campus,before)
  assert.deepEqual(b.scene_result,result,'display assertions must not rewrite SceneResult or evidence')
})
