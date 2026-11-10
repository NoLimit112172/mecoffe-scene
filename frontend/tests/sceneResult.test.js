import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {canonicalSceneJson,sceneDigest,validateSceneResult} from '../src/mecoffe/sceneResult.js'

const directory=new URL('../../adapter/scene_service/fixtures/',import.meta.url)
const read=name=>JSON.parse(fs.readFileSync(new URL(name,directory),'utf8'))
for(const name of read('index.json').cases){
  test(`shared Python/JS SceneResult fixture: ${name}`,()=>{
    const value=read(name),context=read(value.context_ref),contextBefore=structuredClone(context)
    assert.equal(value.synthetic,true)
    if(value.valid){const before=structuredClone(value);assert.deepEqual(validateSceneResult(value.result,context),value.result);assert.deepEqual(value,before)}
    else assert.throws(()=>validateSceneResult(value.result,context),e=>e.code===value.code)
    assert.deepEqual(context,contextBefore)
  })
}
test('portable canonical JSON handles numeric keys, astral ordering, Unicode and integral numbers',()=>{
  const value={'10':'十','2':'二','𐀀':'astral','\ue000':'bmp',n:-0,text:'\r\n\u2028🙂'}
  const expected='{"10":"十","2":"二","n":0,"text":"\\r\\n\u2028🙂","\ue000":"bmp","𐀀":"astral"}'
  assert.equal(canonicalSceneJson(value),expected)
  assert.equal(sceneDigest(value),createHash('sha256').update(expected,'utf8').digest('hex'))
  for(const bad of [1.25,9007199254740992,NaN,Infinity,undefined,'\ud800'])assert.throws(()=>canonicalSceneJson(bad),e=>e.code==='INVALID_JSON')
})
test('required fields and nested hashes cannot be bypassed with a recomputed outer digest',()=>{
  for(const key of Object.keys(read('map-valid.json').result).filter(k=>k!=='result_sha256')){
    const {result}=read('map-valid.json');delete result[key]
    result.result_sha256=sceneDigest(Object.fromEntries(Object.entries(result).filter(([k])=>k!=='result_sha256')))
    assert.throws(()=>validateSceneResult(result),e=>e.code==='INVALID_SCENE')
  }
})
test('none rejects retained spatial data even if all hashes are self-consistent',()=>{
  const {result}=read('none-valid.json');result.map_ref=read('map-valid.json').result.map_ref
  result.result_sha256=sceneDigest(Object.fromEntries(Object.entries(result).filter(([k])=>k!=='result_sha256')))
  assert.throws(()=>validateSceneResult(result),e=>e.code==='INVALID_SCENE')
})
