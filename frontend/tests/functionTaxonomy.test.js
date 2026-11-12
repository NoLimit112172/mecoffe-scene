import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {validateSceneResult,sceneDigest} from '../src/mecoffe/sceneResult.js'
import {sceneEvidenceLabel,buildingUseInfo,FUNCTION_LABELS,FUNCTION_COLORS} from '../src/mecoffe/sceneLabels.js'
import {featureInfo} from '../src/mecoffe/gis/labels.js'
import {gisLayers} from '../src/mecoffe/gis/model.js'
import {buildingPalette} from '../src/mecoffe/campus3dEnvironmentModel.js'
import {loadSceneMap,PUBLISHED_SCENE_ASSETS} from '../src/mecoffe/sceneMap.js'
import {buildScenePlacement} from '../src/mecoffe/scenePlacement.js'
import {previewMapSummary} from '../src/mecoffe/MapSceneRenderer.js'

const directory=new URL('./fixtures/scene-taxonomy/',import.meta.url)
const input=()=>JSON.parse(fs.readFileSync(new URL('input-v3.json',directory),'utf8'))
const context=b=>({map:b.map,snapshot:b.snapshot,plan:b.plan})
test('v3 primary/service result validates with exact frozen map and source context',()=>{
  const b=input(),result=b.expected.result,before=structuredClone(b)
  assert.deepEqual(validateSceneResult(result,context(b)),result)
  assert.deepEqual(b,before)
  assert.equal(result.schema_version,'scene.result.v3')
  const store=result.service_points.find(p=>p.brand_name==='合成品牌甲')
  assert.equal(store.building_id,'synthetic/b0');assert.ok(store.evidence.every(e=>e.layer==='service'))
})
test('v3 rejects forged service evidence on a person and unsupported policy',()=>{
  const b=input(),result=b.expected.result
  result.assignments[0].evidence[0].layer='service'
  result.result_sha256=sceneDigest(Object.fromEntries(Object.entries(result).filter(([k])=>k!=='result_sha256')))
  assert.throws(()=>validateSceneResult(result),e=>e.code==='INVALID_SCENE')
  const other=input();delete other.map.evidence_rules
  assert.throws(()=>validateSceneResult(other.expected.result,context(other)),e=>e.code==='REF_MISMATCH')
})
test('v3 map context rejects forbidden primary uses even if eligible was forged',()=>{
  const b=input();b.map.campus.buildings[0].functions=['medical','transport']
  assert.throws(()=>validateSceneResult(b.expected.result,context(b)),e=>e.code==='REF_MISMATCH')
})
test('Chinese use labels, layers, AI confidence and 20-category colours',()=>{
  const b=input(),hospital=b.map.campus.buildings[0],info=buildingUseInfo(hospital)
  assert.deepEqual(info.primary,['医疗·医院']);assert.deepEqual(info.services,['餐饮·餐厅'])
  assert.equal(buildingPalette(hospital).wall,info.colour)
  assert.equal(sceneEvidenceLabel('poi',{layer:'service'}),'楼内兴趣点 · 楼内服务')
  assert.equal(sceneEvidenceLabel('ai_inferred',{layer:'primary',confidence_pct:84}),'AI 推断（把握 84%） · 主用途')
  assert.equal(Object.keys(FUNCTION_LABELS).length,20)
  assert.deepEqual(Object.keys(FUNCTION_LABELS).sort(),Object.keys(FUNCTION_COLORS).sort())
  assert.ok(Object.values(FUNCTION_COLORS).every(c=>/^#[a-f0-9]{6}$/.test(c)))
  assert.equal(featureInfo({id:hospital.osm_id,properties:hospital}).uses.primary[0],'医疗·医院')
})
test('frozen v3 map loads and preserves identical placements for Three/GIS',async()=>{
  const b=input(),fetcher=async url=>{
    const name=String(url).replace(/^\/maps\//,'')
    try{return new Response(fs.readFileSync(new URL(`maps/${name}`,directory)))}catch{return new Response('',{status:404})}
  }
  const map=await loadSceneMap(b.map.map_ref,{mapsBase:'/maps/',assets:PUBLISHED_SCENE_ASSETS,fetcher})
  assert.equal(map.mapContext.evidence_rules.version,'auto-evidence.2')
  assert.equal(previewMapSummary(map.files['campus3d.json'],map.files['asset_assignments.json']).buildings,8)
  const populationRequest={synthetic_student:{description:'合成学生'},synthetic_operator:{description:'合成经营者'}}
  const result=buildScenePlacement({...b,populationRequest,scenePlan:b.plan,sceneConfigId:b.intent.config_id},map,b.expected.result)
  const layers=gisLayers(result),hospital=layers.buildings.features.find(f=>f.id==='synthetic/b0')
  assert.deepEqual(featureInfo(hospital).uses.services,['餐饮·餐厅'])
  assert.equal(hospital.properties.function_colour,FUNCTION_COLORS.medical)
  assert.equal(result.files['trajectory.json'].people.length,b.snapshot.nodes.length)
  const store=b.expected.result.service_points.find(s=>s.brand_name==='合成品牌甲')
  const mapping=Object.values(result.files['location_mapping.json'].mappings).find(m=>m.osm_id===store.building_id)
  assert.equal(mapping.entrance_id,store.entrance_id)
})
