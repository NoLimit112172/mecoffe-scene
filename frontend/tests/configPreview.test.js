import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {normalizeConfigPreview, loadConfigPreview, buildConfigPreviewScenario} from '../src/mecoffe/configPreview.js'
import {indexScene, stateAt} from '../src/mecoffe/replay.js'
import {IndoorMotion} from '../src/mecoffe/indoorMotion.js'

const snapshot = JSON.parse(fs.readFileSync(new URL('./fixtures/config-preview/snapshot.json', import.meta.url)))
const preparation = JSON.parse(fs.readFileSync(new URL('./fixtures/config-preview/preparation.json', import.meta.url)))
const stage = (name, payload, status = 'completed') => ({name, status, reused: false, error: null, payload})
const sample = () => normalizeConfigPreview({network: snapshot, roles: preparation})
function mapScenario() {
  const buildings = ['way/c', 'way/a', 'way/b'].map((osm_id, i) => ({osm_id, name: `样例建筑 ${i + 1}`, kind: 'education', polygon: [[i,0],[i+1,0],[i+1,1],[i,1],[i,0]]}))
  return {manifest: {id:'map-only',title:'合成地图',simulation_data:false,map:{source:{attribution:'合成地图'}}}, files: {
    'campus3d.json': {campus_id:'synthetic-map',title:'合成地图',buildings},
    'asset_assignments.json': {assignments:[]}, 'landcover.json': {features:[]},
    'gis/buildings.geojson': {type:'FeatureCollection',features:buildings.map(b=>({type:'Feature',id:b.osm_id,properties:{location_ids:['old-location']}}))},
    'gis/pois.geojson': {type:'FeatureCollection',features:[{id:'real-poi',properties:{}},{id:'old-shop',properties:{illustrative:true}}]},
    'trajectory.json': {privateOldRun:'must not survive'}, 'population_snapshot.json': {oldData:'must not survive'},
  }}
}

test('configuration preview accepts raw synthetic files and completed StageDetail responses without mutating them', () => {
  const before=JSON.stringify({snapshot,preparation})
  const raw=sample(), remote=normalizeConfigPreview({network:stage('network',{snapshot}),roles:stage('roles',preparation),session:'sample-session',config:'sample-config'})
  assert.deepEqual(raw.snapshot,remote.snapshot)
  assert.deepEqual(raw.populationRequest,preparation.population_request)
  assert.equal(raw.context.seed,42)
  assert.equal(remote.context.config_id,'sample-config')
  assert.equal(JSON.stringify({snapshot,preparation}),before)
  raw.snapshot.nodes[0].name='edited copy'
  assert.equal(snapshot.nodes[0].name,'样例人物 01')
})

test('remote preview only requests same-origin stage endpoints with browser credentials and distinguishes auth/missing/pending', async () => {
  const calls=[]
  const value=await loadConfigPreview({session:'sample-session',config:'sample-config',fetcher:async (url,options)=>{
    calls.push({url,options})
    return {ok:true,status:200,json:async()=>url.endsWith('/network')?stage('network',{snapshot}):stage('roles',preparation)}
  }})
  assert.equal(value.context.source,'remote')
  assert.deepEqual(calls.map(c=>c.url).sort(),['/api/sessions/sample-session/configs/sample-config/stages/network','/api/sessions/sample-session/configs/sample-config/stages/roles'])
  assert(calls.every(c=>c.options.credentials==='same-origin'&&c.options.cache==='no-store'&&!c.options.headers))
  for (const [status,code] of [[401,'LOGIN_REQUIRED'],[404,'CONFIG_NOT_FOUND'],[503,'HTTP_ERROR']]) {
    await assert.rejects(()=>loadConfigPreview({session:'s',config:'c',fetcher:async()=>({ok:false,status})}),error=>error.code===code)
  }
  await assert.rejects(()=>loadConfigPreview({session:'https://external.invalid',config:'c',fetcher:async()=>{throw Error('must not fetch')}}),e=>e.code==='INVALID_CONTEXT')
  await assert.rejects(()=>loadConfigPreview({session:'s',config:'c',fetcher:async()=>{throw TypeError('offline')}}),e=>e.code==='NETWORK_ERROR')
  const abort=new DOMException('cancelled','AbortError')
  await assert.rejects(()=>loadConfigPreview({session:'s',config:'c',fetcher:async()=>{throw abort}}),e=>e===abort)
})

test('incomplete, failed, mismatched and structurally invalid configuration inputs cannot become an empty preview', () => {
  for (const status of ['pending','running','completed']) assert.throws(()=>normalizeConfigPreview({network:stage('network',null,status),roles:preparation}),e=>e.code==='STAGE_PENDING')
  assert.throws(()=>normalizeConfigPreview({network:stage('network',null,'failed'),roles:preparation}),e=>e.code==='STAGE_FAILED')
  assert.throws(()=>normalizeConfigPreview({network:stage('roles',{snapshot}),roles:preparation}),e=>e.code==='INVALID_STAGE')
  const stale=structuredClone(preparation);stale.population_request.visitor.count=4
  assert.throws(()=>normalizeConfigPreview({network:snapshot,roles:stale}),e=>e.code==='ROLE_MISMATCH')
  const dangling=structuredClone(snapshot);dangling.edges[0].target='missing_person'
  assert.throws(()=>normalizeConfigPreview({network:dangling,roles:preparation}),e=>e.code==='INVALID_RELATIONSHIP')
  const missingId=structuredClone(snapshot);delete missingId.nodes[0].entity_id
  assert.throws(()=>normalizeConfigPreview({network:missingId,roles:preparation}),e=>e.code==='INVALID_PERSON')
  const duplicate=structuredClone(snapshot);duplicate.nodes.push(duplicate.nodes[0])
  assert.throws(()=>normalizeConfigPreview({network:duplicate,roles:preparation}),e=>e.code==='DUPLICATE_PERSON')
  const duplicateEdge=structuredClone(snapshot);duplicateEdge.edges.push(duplicateEdge.edges[0])
  assert.throws(()=>normalizeConfigPreview({network:duplicateEdge,roles:preparation}),e=>e.code==='DUPLICATE_RELATIONSHIP')
  assert.throws(()=>normalizeConfigPreview({network:{...stage('network',{snapshot}),config_id:'another'},roles:preparation,config:'selected'}),e=>e.code==='CONFIG_MISMATCH')
})

test('arbitrary roles get deterministic indoor locations, raw profile values and Chinese generated/static labels', () => {
  const input=sample(), map=mapScenario(), before=JSON.stringify({input,map})
  const result=buildConfigPreviewScenario(input,map), scene=result.files['trajectory.json']
  assert.equal(result.manifest.preview_mode,'config')
  assert.equal(result.manifest.simulation_data,false)
  assert.equal(scene.meta.status,'not_run')
  assert.equal(scene.meta.run_id,null)
  assert.equal(scene.meta.snapshot_revision,2)
  assert.equal(scene.people.length,6)
  assert.equal(scene.relationships.length,5)
  assert.deepEqual(scene.relationships,snapshot.edges)
  assert.equal(scene.events.length,0)
  assert.equal(scene.summary.orders,0)
  assert(scene.people.every(p=>p.indoor&&p.location_key===p.building_id&&p.location_key===p.home_location_id))
  assert.equal(new Set(scene.people.filter(p=>p.role==='visitor').map(p=>p.location_key)).size,1)
  const fields=scene.people[0].profile_fields
  assert.equal(fields.find(f=>f.key==='visit_goal').label,'参观目的')
  assert.equal(fields.find(f=>f.key==='gender').label,'性别')
  assert.equal(fields.find(f=>f.key==='custom_static').label,'custom_static')
  assert.deepEqual(scene.people[0].dynamic_attributes,snapshot.nodes[0].dynamic_attributes)
  assert.deepEqual(scene.people[0].static_attributes,snapshot.nodes[0].static_attributes)
  assert.equal(scene.people[0].gender,'m')
  assert.equal(scene.people[1].gender,'f')
  assert.equal(scene.brands.length,0)
  assert(!result.files['population_snapshot.json'])
  assert.equal(result.files['gis/pois.geojson'].features.length,1)
  assert.equal(JSON.stringify({input,map}),before)
  assert.equal(stateAt(indexScene(scene),0).orders,0)
  const reversed=structuredClone(input);reversed.snapshot.nodes.reverse()
  const byId=value=>Object.fromEntries(value.files['trajectory.json'].people.map(p=>[p.id,p.location_key]))
  assert.deepEqual(byId(result),byId(buildConfigPreviewScenario(reversed,map)))
  const reordered=structuredClone(map);reordered.files['campus3d.json'].buildings.reverse()
  assert.deepEqual(byId(result),byId(buildConfigPreviewScenario(input,reordered)))
  assert.deepEqual(result,buildConfigPreviewScenario(input,map))
})

test('explicit role and entity rules override fallback and reject unknown bindings', () => {
  const input=sample(), map=mapScenario()
  const result=buildConfigPreviewScenario(input,map,{roles:{visitor:'way/a'},entities:{sample_person_02:'way/c'}})
  const mappings=result.files['location_mapping.json'].mappings, people=result.files['trajectory.json'].people
  assert.equal(mappings[people[0].location_key].osm_id,'way/a')
  assert.equal(mappings[people[1].location_key].osm_id,'way/c')
  assert.equal(people[0].placement_source,'explicit')
  for (const rules of [{roles:{unknown:'way/a'}},{roles:{visitor:'missing'}},{entities:{unknown:'way/b'}}]) assert.throws(()=>buildConfigPreviewScenario(input,map,rules),e=>e.code==='INVALID_PLACEMENT')
  const assignments=new Set()
  for(let seed=0;seed<10;seed++) assignments.add(buildConfigPreviewScenario({...input,context:{...input.context,seed}},map).files['trajectory.json'].people[0].location_key)
  assert(assignments.size>1)
})


test('valid prototype-like role identifiers cannot bypass deterministic placement or attribute labels', () => {
  const changed=structuredClone(snapshot), prep=structuredClone(preparation)
  for (const node of changed.nodes) if(node.role==='visitor')node.role='constructor'
  prep.population_request.constructor=prep.population_request.visitor
  delete prep.population_request.visitor
  changed.nodes[0].static_attributes.constructor='raw prototype-like key'
  const result=buildConfigPreviewScenario(normalizeConfigPreview({network:changed,roles:prep}),mapScenario())
  const person=result.files['trajectory.json'].people[0]
  assert(person.location_key)
  assert.equal(person.profile_fields.find(field=>field.key==='constructor').label,'constructor')
})


test('the public USTC map accounts for every synthetic person indoors with shared indoor state', () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../public/mecoffe/${name}`, import.meta.url)))
  const map = {manifest:{id:'ustc-map'},files:{'campus3d.json':read('campus3d.json'),'entrances.json':read('scenarios/ustc-history/entrances.json')}}
  const scenario = buildConfigPreviewScenario(sample(),map)
  const index = indexScene(scenario.files['trajectory.json'])
  const motion = new IndoorMotion({campus:scenario.files['campus3d.json'],mapping:scenario.files['location_mapping.json'],index,entrances:scenario.files['entrances.json']})
  assert.deepEqual(motion.accounting,{total:6,visible:0,inside:6,accounted:6,unassigned:0,valid:true,issues:[]})
  assert.equal(Object.values(motion.snapshot.buildings).flat().length,6)
  for(const person of index.scene.people) assert.equal(motion.personLocation(person.id).inside,true)
  assert.equal(motion.pending,0)
})
