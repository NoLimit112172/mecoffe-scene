import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {validateSceneResult,sceneDigest} from '../src/mecoffe/sceneResult.js'
import {sceneEvidenceLabel} from '../src/mecoffe/sceneLabels.js'
import {loadSceneMap,PUBLISHED_SCENE_ASSETS} from '../src/mecoffe/sceneMap.js'
const folder=new URL('fixtures/scene-auto/',import.meta.url)
const read=name=>JSON.parse(fs.readFileSync(new URL(name,folder),'utf8'))
const rehash=value=>{delete value.result_sha256;value.result_sha256=sceneDigest(value);return value}
test('v2 frozen automatic evidence loads and old v1 results still validate',async()=>{
  const input=read('input-v2.json'),context=read('context.json')
  assert.equal(input.scene_result.schema_version,'scene.result.v2')
  assert.deepEqual(validateSceneResult(input.scene_result,context),input.scene_result)
  const old=JSON.parse(fs.readFileSync(new URL('fixtures/scene-render/input-a.json',import.meta.url),'utf8'))
  assert.equal(validateSceneResult(old.scene_result).schema_version,'scene.result.v1')
  const map=await loadSceneMap(input.scene_result.map_ref,{mapsBase:'/maps/',assets:PUBLISHED_SCENE_ASSETS,
    fetcher:async url=>({ok:true,arrayBuffer:async()=>fs.readFileSync(new URL('maps/'+url.slice('/maps/'.length),folder))})})
  validateSceneResult(input.scene_result,{...context,map:map.mapContext})
  assert.equal(map.files['ai-evidence.json'].buildings['geojson/synthetic-building-1'].confidence,.84)
  assert.equal(map.files['evidence-rules.json'].version,'auto-evidence.1')
})
test('v2 requires integer AI percent, v1 rejects new evidence, weak keywords never qualify alone',()=>{
  const original=read('input-v2.json').scene_result
  const old=structuredClone(original);old.schema_version='scene.result.v1'
  assert.throws(()=>validateSceneResult(rehash(old)),e=>e.code==='INVALID_SCENE')
  for(const mutate of [e=>delete e.confidence_pct,e=>e.confidence_pct=101,e=>e.confidence_pct=80.5]){
    const bad=structuredClone(original),ai=bad.service_points.flatMap(s=>s.evidence).find(e=>e.source==='ai_inferred')
    mutate(ai)
    assert.throws(()=>validateSceneResult(rehash(bad)),e=>['INVALID_SCENE','INVALID_JSON'].includes(e.code))
  }
  const weak=structuredClone(original),person=weak.assignments.find(a=>a.status==='placed')
  delete weak.rules.overrides.entities[person.entity_id]
  person.evidence=[{function:weak.rules.role_prefs[person.role].functions[0],source:'name_keyword',key:'name',value:'宿舍',ref:person.building_id}]
  weak.assignment_meta.rules_sha256=sceneDigest(weak.rules)
  assert.throws(()=>validateSceneResult(rehash(weak)),e=>e.code==='INVALID_SCENE')
})
test('labels distinguish name rules, AI percentages and optional human confirmation',()=>{
  assert.equal(sceneEvidenceLabel('name_rule'),'名称规则')
  assert.equal(sceneEvidenceLabel('ai_inferred',{confidence_pct:84}),'AI 推断（把握 84%）')
  assert.equal(sceneEvidenceLabel('annotation'),'人工补注')
  assert.equal(sceneEvidenceLabel('name_keyword'),'名称推断（弱）')
})
