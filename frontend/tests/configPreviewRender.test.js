import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {normalizeConfigPreview,buildConfigPreviewScenario} from '../src/mecoffe/configPreview.js'
import {loadConfigMap} from '../src/mecoffe/configMap.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'

const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'))
test('GIS distinguishes population-only configuration from a map without simulation data',async()=>{
  const map={manifest:{id:'map',simulation_data:false,simulation_time:{steps:1}},files:{}}
  for(const [key,name]of Object.entries({'campus3d.json':'campus3d.json','entrances.json':'scenarios/ustc-history/entrances.json','landcover.json':'campus3d_landcover.json'}))map.files[key]=read('../public/mecoffe/'+name)
  const input=normalizeConfigPreview({network:read('./fixtures/config-preview/snapshot.json'),roles:read('./fixtures/config-preview/preparation.json')})
  const scenario=buildConfigPreviewScenario(input,map)
  const preview=new GisReplay(scenario)
  await preview.prepare()
  assert.equal(preview.index.people.size,6)
  assert.equal(preview.occupancy.inside,6)
  assert.equal(preview.motion.accounting.valid,true)
  assert.equal(preview.personData().length,0)
  assert.equal(preview.index.scene.events.length,0)
  assert.equal(preview.pending,0)
  const empty=new GisReplay(map)
  assert.equal(empty.index,null)
  assert.equal(empty.people.size,0)
  preview.dispose();empty.dispose()
})

test('configuration map validates exact response bytes and rejects population file references',async()=>{
  const values={'campus3d.json':{buildings:[]},'entrances.json':{},'landcover.json':{features:[]}}
  const raws=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,JSON.stringify(value)+'\n']))
  const manifest={schema_version:'mecoffe.scenario.v1',simulation_data:false,files:Object.fromEntries(Object.entries(raws).map(([name,raw])=>[name,createHash('sha256').update(raw).digest('hex')]))}
  const fetcher=async url=>new Response(url.endsWith('scenario.json')?JSON.stringify(manifest):raws[url.split('/').at(-1)],{status:200})
  const map=await loadConfigMap({fetcher,base:'/scene/'})
  assert.deepEqual(map.files,values)
  const original=raws['landcover.json'];raws['landcover.json']='{}'
  await assert.rejects(loadConfigMap({fetcher}),/版本不一致/)
  raws['landcover.json']=original;manifest.files['population_snapshot.json']='0'.repeat(64)
  await assert.rejects(loadConfigMap({fetcher}),/无效文件/)
})
