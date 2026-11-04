import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import crypto from 'node:crypto'
import {loadScenario,loadScenarioDirectory,directoryScenarioId,scenarioTime} from '../src/mecoffe/scenario.js'
import {localToLngLat,lngLatToLocal,gisLayers,mapBounds,searchPlaces,simulationPosition,chooseModels,heightDescription} from '../src/mecoffe/gis/model.js'
import {GisReplay,DISPLAY_ROUTE_HEADWAY,nextDisplayDeparture} from '../src/mecoffe/gis/replay.js'
import {cursorAtPosition,advancePosition} from '../src/mecoffe/campus3dPlayback.js'
import {applyBasemap,basemapAdapter,sourceAttribution,OSM_ATTRIBUTION} from '../src/mecoffe/gis/basemaps.js'
import {featureInfo} from '../src/mecoffe/gis/labels.js'
import {mapDependencyNotices} from '../pages/dependency-notices.mjs'
import {fileURLToPath} from 'node:url'
const root=new URL('../public/mecoffe/scenarios/',import.meta.url)
function scenario(id){const base=new URL(id+'/',root),manifest=JSON.parse(readFileSync(new URL('scenario.json',base)));return {manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,JSON.parse(readFileSync(new URL(name,base)))]))}}

test('GIS directory discovers arbitrary third scenarios and default without hard-coded campus IDs',async()=>{
  const document={schema_version:'mecoffe.scenario-index.v1',default_id:'third-campus',scenarios:['first','second','third-campus'].map(id=>({id,title:`地点 ${id}`,simulation_data:false,manifest_sha256:'a'.repeat(64)}))}
  const directory=await loadScenarioDirectory({base:'/mecoffe-scene/',fetcher:async url=>{assert.equal(url,'/mecoffe-scene/mecoffe/scenarios/index.json');return {ok:true,json:async()=>document}}})
  assert.equal(directoryScenarioId(directory), 'third-campus');assert.equal(directoryScenarioId(directory,'second'),'second');assert.equal(directory.scenarios.length,3)
  assert.throws(()=>directoryScenarioId(directory,'missing'),/目录/)
  const code=readFileSync(new URL('../src/views/MeCoffeGis.vue',import.meta.url),'utf8')
  assert(!code.includes('ustc-history'));assert(!code.includes('nus-hourly'));assert(code.includes('scenarioChoices'))
  await assert.rejects(loadScenarioDirectory({fetcher:async()=>({ok:false,status:404})}),/目录/)
})

test('OSM data and raster share canonical attribution; independent sources retain their credit',()=>{
  assert.equal(sourceAttribution('© OpenStreetMap contributors'),OSM_ATTRIBUTION)
  assert.equal(sourceAttribution(OSM_ATTRIBUTION),OSM_ATTRIBUTION)
  const credits=new Set([sourceAttribution('© OpenStreetMap contributors'),basemapAdapter('osm').source.attribution])
  assert.equal(credits.size,1)
  credits.add(sourceAttribution('© 某大学 GIS 数据中心'));assert.equal(credits.size,2)
  assert.equal(sourceAttribution('<script>bad</script>'),'&lt;script&gt;bad&lt;/script&gt;')
})

test('query and search labels resolve Chinese catalog names, readable locations and quiet-code fallbacks',()=>{
  const fixture={id:'way/1',properties:{category:'library',prototype_id:'building.education',location_ids:['lib']}}
  const options={catalog:{prototypes:[{id:'building.education',title:'教学科研'}]},mapping:{mappings:{lib:{osm_name:'图书中心'}}}}
  const info=featureInfo(fixture,options)
  assert.deepEqual(info.category,{name:'图书馆',code:''});assert.deepEqual(info.prototype,{name:'教学科研',code:''});assert.deepEqual(info.locations,[{name:'图书中心',id:'lib'}]);assert.equal(info.sourceId,'way/1')
  const unknown=featureInfo({properties:{category:'custom',prototype_id:'unknown',location_ids:[]}})
  assert.equal(unknown.category.code,'custom');assert.equal(unknown.prototype.code,'unknown')
  assert.equal(featureInfo(fixture,{...options,mapping:{mappings:{lib:{display_name:'主图书馆',osm_name:'图书中心'}}}}).locations[0].name,'主图书馆')
})

test('same-route departures are staggered only in display time, without editing events or A* nodes',()=>{
  const s=scenario('ustc-history'),before=JSON.stringify(s),replay=new GisReplay(s)
  const peers=[...replay.people.values()].filter(p=>p.key==='ug_dorm_west').slice(0,2),purchase=replay.index.scene.events.find(e=>e.type==='purchase')
  assert.equal(peers.length,2)
  for(const [i,person]of peers.entries())replay.event({...purchase,actor:person.id,key:`headway-${i}`,order_id:`headway-${i}`})
  replay.admit()
  const [first,second]=peers
  assert.equal(first.walker.phase,'waiting');assert.equal(second.walker.phase,'waiting')
  assert.equal(second.walker.until-first.walker.until,DISPLAY_ROUTE_HEADWAY)
  assert.deepEqual(first.walker.route.node_ids,second.walker.route.node_ids)
  replay.motion.purchases=[];replay.motion.sync(0,.25)
  assert.equal(first.walker.phase,'exit-home');assert.equal(second.walker.phase,'waiting')
  replay.motion.sync(0,1.2);assert.equal(first.walker.phase,'outbound');assert.equal(second.walker.phase,'outbound')
  assert(Math.hypot(first.x-second.x,first.y-second.y)>5)
  assert.equal(nextDisplayDeparture(1,10),10);assert.equal(nextDisplayDeparture(1,1),1+DISPLAY_ROUTE_HEADWAY)
  assert.equal(JSON.stringify(s),before);replay.seek(0);assert.equal(replay.motion.departures.size,0)

})

test('published map dependency notices include the pinned SDK and its actual dependency copyrights',()=>{
  const notices=mapDependencyNotices(fileURLToPath(new URL('../',import.meta.url)))
  assert.match(notices,/maplibre-gl@6\.16\.0/);assert.match(notices,/MapLibre contributors/);assert.match(notices,/@mapbox\/tiny-sdf/);assert.match(notices,/BSD-3-Clause/)
  assert(!notices.includes(fileURLToPath(new URL('../',import.meta.url))))
})

test('GIS coordinates invert the recorded projection in both hemispheres with sub-half-metre accuracy',()=>{
  for(const id of ['ustc-history','nus-hourly']){
    const s=scenario(id),p=s.files['campus3d.json'].projection
    for(const b of s.files['campus3d.json'].buildings)for(const [x,y] of b.polygon){const restored=lngLatToLocal(localToLngLat({x,y},p),p);assert(Math.hypot(x-restored.x,y-restored.y)<.5)}
    const layers=gisLayers(s);assert.equal(layers.buildings.features.length,s.files['campus3d.json'].buildings.length);assert.equal(mapBounds(layers).length,2)
    const first=layers.buildings.features.find(f=>f.properties.name)
    assert(searchPlaces(layers,first.properties.name).some(row=>row.feature.id===first.id))
  }
  const p={method:'local_equirectangular',origin_lon:-120,origin_lat:-33,earth_radius_m:6371008.8}
  assert(Math.abs(lngLatToLocal(localToLngLat({x:-500,y:900},p),p).y-900)<.5)
  assert.throws(()=>localToLngLat({x:0,y:0},{}),/坐标/)
})
test('scenario GIS loading verifies nested GeoJSON hashes, keeps legacy loading lean, and rejects path traversal',async()=>{
  const base=new URL('nus-hourly/',root),calls=[]
  const fetcher=async url=>{const name=url.split('/nus-hourly/')[1];calls.push(name);return {ok:true,text:async()=>readFileSync(new URL(name,base),'utf8')}}
  const old=await loadScenario('nus-hourly',{fetcher});assert(!old.files['gis/buildings.geojson']);assert(!calls.some(name=>name.startsWith('gis/')))
  const loaded=await loadScenario('nus-hourly',{fetcher,includeGis:true});assert.equal(loaded.files['gis/buildings.geojson'].features.length,226)
  const malicious={...loaded.manifest,files:{'gis/../../secret.geojson':'a'.repeat(64)}}
  await assert.rejects(loadScenario('nus-hourly',{includeGis:true,fetcher:async()=>({ok:true,text:async()=>JSON.stringify(malicious)})}),/文件名/)
  const manifest={...loaded.manifest,files:{'gis/buildings.geojson':crypto.createHash('sha256').update('wrong').digest('hex')}}
  await assert.rejects(loadScenario('nus-hourly',{includeGis:true,fetcher:async url=>({ok:true,text:async()=>url.endsWith('scenario.json')?JSON.stringify(manifest):'{}'})}),/改变/)
})
test('basemap switches preserve vector sources and never add a remote request in default mode',()=>{
  const layers=new Map(),sources=new Map(),paint=[]
  const map={getLayer:id=>layers.get(id),getSource:id=>sources.get(id),addLayer:l=>layers.set(l.id,l),addSource:(id,s)=>sources.set(id,s),removeLayer:id=>layers.delete(id),removeSource:id=>sources.delete(id),setPaintProperty:(...p)=>paint.push(p)}
  assert.equal(applyBasemap(map,'offline').online,false);assert.equal(sources.size,0)
  applyBasemap(map,'osm');assert.equal(sources.get('basemap-raster').tiles[0],'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  assert.match(sources.get('basemap-raster').attribution,/OpenStreetMap contributors/)
  applyBasemap(map,'offline');assert.equal(sources.size,0);assert.equal(layers.size,0);assert.equal(paint.at(-1)[2],.85)
  assert.throws(()=>basemapAdapter('gaode'),/暂不支持/)
})
test('near-model LOD has an explicit budget, selection priority and offscreen culling',()=>{
  const people=Array.from({length:100},(_,i)=>({id:String(i),lngLat:[i*10,i*2]})),options={project:([x,y])=>({x,y}),width:500,height:400,zoom:20,selectedId:'4',maxModels:6}
  assert.equal(chooseModels(people,{...options,zoom:17}).size,0)
  const visible=chooseModels(people,options);assert.equal(visible.size,6);assert(visible.has('4'));assert(!visible.has('99'))
})
test('NUS has no fabricated people, purchases or paths; time follows the supplied hourly intervals',()=>{
  const s=scenario('nus-hourly'),replay=new GisReplay(s)
  replay.advance(250,4);assert.equal(replay.people.size,0);assert.equal(replay.pointFeatures().features.length,0);assert.equal(replay.routeFeatures().features.length,0);assert.equal(replay.index,null)
  replay.seek(6);assert.equal(scenarioTime(s.manifest.simulation_time,replay.position).label,'2026-11-03 12:00')
})
test('history replay shares the sandbox cursor/clock, uses its A* graph, and leaves input data immutable',()=>{
  const s=scenario('ustc-history'),original=JSON.stringify(s),replay=new GisReplay(s),position=replay.previewPosition()
  replay.seek(position)
  assert.equal(replay.cursor,cursorAtPosition(replay.index,position))
  assert.equal(simulationPosition(replay.index,2),1)
  replay.advance(200,1)
  assert.equal(replay.position,advancePosition(replay.index,position,200,1,12));assert(replay.active>0)
  const actor=[...replay.people.values()].find(p=>p.walker),route=actor.walker.route
  assert(route.node_ids.every(id=>replay.routing.nodes.has(id)))
  const before={x:actor.x,y:actor.y};for(let tick=0;tick<10;tick++)replay.advance(100,1);assert(Math.hypot(before.x-actor.x,before.y-actor.y)>0)
  assert.equal(JSON.stringify(s),original)
  replay.seek(0);assert.equal(replay.active,0);assert.equal(replay.pending,0)
  assert.equal(heightDescription('default'),'展示默认高度')
})
