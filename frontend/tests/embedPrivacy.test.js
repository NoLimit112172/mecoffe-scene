import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
import {configMapContents, embedCatalog, embedFiles} from '../embed/build-tools.mjs'
import {configMapPlugin} from '../embed/embed-plugin.mjs'

const require=createRequire(import.meta.url),{findings,auditArtifact}=require('../../scripts/audit-public.cjs')
const publicRoot=path.resolve(import.meta.dirname,'../public')
const catalog=JSON.parse(fs.readFileSync(path.join(publicRoot,'mecoffe/assets3d/catalog.json'),'utf8'))

test('embed allowlist excludes every population, run and person-specific catalog record',()=>{
  const published=embedCatalog(catalog)
  assert(published.prototypes.every(item=>item.source.type!=='rocketbox'&&!item.params.person_id))
  const files=embedFiles(publicRoot,{...catalog,prototypes:catalog.prototypes.filter(item=>item.source.type!=='rocketbox'&&!item.params.person_id)})
  assert(files.length>0)
  assert(files.every(name=>name==='favicon.svg'||name.startsWith('assets/')||name.startsWith('mecoffe/assets3d/')))
  assert(!files.some(name=>/snapshot|trajectory|latest-network|latest-demo|scene\.json/.test(name)))
})

test('fixed configuration map is reproducible, hashed and contains geometry without old people or shop mappings',()=>{
  const first=configMapContents(publicRoot),second=configMapContents(publicRoot)
  assert.deepEqual([...first.keys()],[...second.keys()])
  const manifest=JSON.parse(first.get('scenario.json'))
  assert.equal(manifest.simulation_data,false)
  assert(!first.has('trajectory.json')&&!first.has('population_snapshot.json')&&!first.has('location_mapping.json'))
  for(const [name,expected]of Object.entries(manifest.files)){
    assert(first.get(name).equals(second.get(name)))
    assert.equal(crypto.createHash('sha256').update(first.get(name)).digest('hex'),expected)
  }
  const buildings=JSON.parse(first.get('gis/buildings.geojson'))
  assert(buildings.features.every(feature=>!feature.properties.location_ids))
  assert(JSON.parse(first.get('gis/pois.geojson')).features.every(feature=>!feature.properties.illustrative))
})

test('every build mode emits the same safe configuration map as the development middleware',()=>{
  const emitted=[]
  const plugin=configMapPlugin(path.resolve(publicRoot,'..'))
  plugin.generateBundle.call({emitFile:asset=>emitted.push(asset)})
  const expected=configMapContents(publicRoot)
  assert.equal(emitted.length,expected.size)
  for(const asset of emitted){
    assert.equal(asset.type,'asset')
    assert(asset.fileName.startsWith('mecoffe/config-map/'))
    assert(Buffer.from(asset.source).equals(expected.get(asset.fileName.slice('mecoffe/config-map/'.length))))
  }
})

test('privacy audit rejects raw or wrapped private-style configuration and force-staged private paths',()=>{
  const snapshot={schema_version:'1.0',snapshot_id:'fixture-case',snapshot_revision:1,dataset_version:'team-data',nodes:[{entity_id:'member_1',role:'custom_role',name:'An actual user',static_attributes:{age:24},dynamic_attributes:{}}],edges:[]}
  assert(findings(JSON.stringify(snapshot),'tests/renamed.json').some(item=>item.kind==='privateConfiguration'))
  assert(findings(JSON.stringify({payload:{snapshot}}),'tests/wrapped.json').some(item=>item.kind==='privateConfiguration'))
  assert(findings('{}','data/private/renamed.json').some(item=>item.kind==='privatePath'))
  assert(findings('{}','other/fixtures/mecoffe8/snapshot.json').some(item=>item.kind==='privatePath'))
  assert(findings(JSON.stringify({population_request:{custom_role:{count:1,generate:{}}}}),'tests/prep.json').some(item=>item.kind==='privateConfiguration'))
  const synthetic={...snapshot,dataset_version:'synthetic-only',nodes:[{...snapshot.nodes[0],name:'样例人物 01'}]}
  assert.equal(findings(JSON.stringify(synthetic),'tests/synthetic.json').length,0)
  assert(findings(JSON.stringify({...synthetic,nodes:snapshot.nodes}),'tests/mislabelled.json').some(item=>item.kind==='privateConfiguration'))
  const normalized={schema:'mecoffe.scene.v1',meta:{config_preview:true},people:[{id:'sample_01',name:'样例人物 01'}],events:[]}
  assert(findings(JSON.stringify(normalized),'tests/normalized.json').some(item=>item.kind==='privateConfiguration'))
  assert(findings(JSON.stringify({files:{'trajectory.json':normalized}}),'tests/wrapped-preview.json').some(item=>item.kind==='privateConfiguration'))
})

test('privacy audit also reads ignored build artifacts before publication',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mecoffe-private-audit-'))
  try{
    fs.writeFileSync(path.join(temp,'data.json'),JSON.stringify({payload:{population_request:{custom:{count:2}}}}))
    assert(auditArtifact(temp).some(item=>item.kind==='privateConfiguration'))
  }finally{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true})}
})
