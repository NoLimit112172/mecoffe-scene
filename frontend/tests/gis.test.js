import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import crypto from 'node:crypto'
import {loadScenario,scenarioTime} from '../src/mecoffe/scenario.js'
import {localToLngLat,lngLatToLocal,gisLayers,mapBounds,searchPlaces,simulationPosition,chooseModels,heightDescription} from '../src/mecoffe/gis/model.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'
import {cursorAtPosition,advancePosition} from '../src/mecoffe/campus3dPlayback.js'
import {applyBasemap,basemapAdapter} from '../src/mecoffe/gis/basemaps.js'
import {mapDependencyNotices} from '../pages/dependency-notices.mjs'
import {fileURLToPath} from 'node:url'
const root=new URL('../public/mecoffe/scenarios/',import.meta.url)
function scenario(id){const base=new URL(id+'/',root),manifest=JSON.parse(readFileSync(new URL('scenario.json',base)));return {manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,JSON.parse(readFileSync(new URL(name,base)))]))}}

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
  const before={x:actor.x,y:actor.y};replay.advance(100,1);assert(Math.hypot(before.x-actor.x,before.y-actor.y)>0)
  assert.equal(JSON.stringify(s),original)
  replay.seek(0);assert.equal(replay.active,0);assert.equal(replay.pending,0)
  assert.equal(heightDescription('default'),'展示默认高度')
})
