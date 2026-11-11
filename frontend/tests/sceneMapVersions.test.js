import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {loadSceneMap,PUBLISHED_SCENE_ASSETS} from '../src/mecoffe/sceneMap.js'

const directory=new URL('../../data/maps/',import.meta.url)
const ref=version=>({map_id:'ustc-gaoxin',map_version:version,manifest_sha256:createHash('sha256').update(fs.readFileSync(new URL('ustc-gaoxin/'+version+'/manifest.json',directory))).digest('hex')})
function options(versions,calls){
  return {mapsBase:'/scene-maps/',assets:PUBLISHED_SCENE_ASSETS,fetcher:async url=>{
    calls.push(url)
    const relative=url.slice('/scene-maps/'.length),version=relative.split('/')[1]
    if(!versions.includes(version))return {ok:false,status:404}
    return {ok:true,arrayBuffer:async()=>fs.readFileSync(new URL(relative,directory))}
  }}
}
test('one mapsBase concurrently serves v1/v2 and alternating loads never share files',async()=>{
  const calls=[],opts=options(['1','2'],calls)
  const [v1,v2]=await Promise.all([loadSceneMap(ref('1'),opts),loadSceneMap(ref('2'),opts)])
  const original1=structuredClone(v1.files),original2=structuredClone(v2.files)
  assert.equal(v1.files['quality.json'].function_counts.dining,0)
  assert.equal(v2.files['quality.json'].function_counts.dining,3)
  v1.files['campus3d.json'].buildings[0].name='synthetic mutation in first returned object'
  for(const version of ['2','1','2','1']){
    const current=await loadSceneMap(ref(version),opts)
    assert.equal(current.manifest.map_version,version)
    assert.deepEqual(current.files,version==='1'?original1:original2)
    assert.deepEqual(current.map_ref,ref(version))
  }
  assert(calls.some(url=>url.startsWith('/scene-maps/ustc-gaoxin/1/')))
  assert(calls.some(url=>url.startsWith('/scene-maps/ustc-gaoxin/2/')))
  assert(calls.every(url=>url.startsWith('/scene-maps/ustc-gaoxin/')))
})
test('v1 reference with only v2 mounted fails and never requests v2 or legacy',async()=>{
  const calls=[]
  await assert.rejects(()=>loadSceneMap(ref('1'),options(['2'],calls)),error=>error.code==='MAP_FILE_MISSING')
  assert.deepEqual(calls,['/scene-maps/ustc-gaoxin/1/manifest.json'])
})
test('wrong manifest digest is rejected without trying another map version',async()=>{
  const calls=[]
  await assert.rejects(()=>loadSceneMap({...ref('1'),manifest_sha256:ref('2').manifest_sha256},options(['1','2'],calls)),
    error=>error.code==='MAP_HASH_MISMATCH')
  assert.deepEqual(calls,['/scene-maps/ustc-gaoxin/1/manifest.json'])
})
