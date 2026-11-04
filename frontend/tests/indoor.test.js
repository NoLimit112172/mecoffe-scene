import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {IndoorMotion,indoorBuilding,displayDate} from '../src/mecoffe/indoorMotion.js'
import {GisReplay} from '../src/mecoffe/gis/replay.js'
import {Campus3DScene} from '../src/mecoffe/Campus3DScene.js'
import {indexScene} from '../src/mecoffe/replay.js'

export function prepared(id='ustc-history'){
  const root=new URL(`../public/mecoffe/scenarios/${id}/`,import.meta.url),manifest=JSON.parse(readFileSync(new URL('scenario.json',root)))
  return {manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,JSON.parse(readFileSync(new URL(name,root)))]))}
}
function motion(s,options={}){return new IndoorMotion({campus:s.files['campus3d.json'],mapping:s.files['location_mapping.json'],entrances:s.files['entrances.json'],landcovers:s.files['landcover.json'].features,index:indexScene(s.files['trajectory.json']),options})}
test('all idle people are inside, absent from render/LOD input, and roofs conserve the population',()=>{
  const s=prepared(),replay=new GisReplay(s)
  assert.equal(replay.occupancy.inside,100);assert.equal(replay.personData().length,0);assert.equal(replay.pointFeatures().features.length,0)
  const id=[...replay.people.keys()][0];assert(replay.personLocation(id).inside)
})
test('door animation, hidden shop dwell, coffee return and home entry follow a complete display-only cycle',()=>{
  const s=prepared(),event=s.files['trajectory.json'].events.find(e=>e.type==='purchase'),before=JSON.stringify(s)
  const m=motion(s,{shopSeconds:2});m.purchases=[];m.event(event);m.sync(0,.25)
  const p=m.people.get(event.actor),shop=m.routing.anchors.get(`shop_${event.brand_id}`).building.osm_id
  assert.notDeepEqual(p.walker.points,[...p.walker.returning].reverse(),'return keeps its own side of the walking corridor')
  assert.equal(p.walker.phase,'exit-home');assert(p.transitionScale>0&&p.transitionScale<1);assert.equal(m.snapshot.inside,99)
  let t=.25
  const until=condition=>{while(t<100&&!condition()){t+=1/60;m.sync(0,t)}assert(condition())}
  until(()=>p.walker.phase==='enter-shop');assert.equal(m.outside.length,1)
  const door=m.byBuilding.get(shop).point;assert(Math.hypot(p.x-door[0],p.y-door[1])<.001)
  until(()=>p.walker.phase==='dwell');assert.equal(indoorBuilding(p),shop);assert.equal(m.outside.length,0);assert.equal(m.snapshot.inside,100)
  const start=t;m.sync(0,t+1);t+=1;assert.equal(p.walker.phase,'dwell')
  until(()=>p.walker.phase==='exit-shop');assert(t-start>=1.95);assert(p.hasCoffee)
  until(()=>p.walker.phase==='enter-home');until(()=>!p.walker)
  assert.equal(indoorBuilding(p),p.homeBuilding);assert.equal(m.snapshot.inside,100);assert.equal(m.outside.length,0);assert(p.hasCoffee)
  assert.equal(JSON.stringify(s),before)
})
test('GIS and sandbox share exact occupancy at the same replay position, including backward seeks',()=>{
  const s=prepared(),gis=new GisReplay(s),sandbox=new Campus3DScene({campus:s.files['campus3d.json'],mapping:s.files['location_mapping.json'],index:indexScene(s.files['trajectory.json']),entrances:s.files['entrances.json'],landcovers:s.files['landcover.json'].features})
  sandbox.scene=new THREE.Scene();sandbox.placePeople()
  for(const pos of [0,1.1,1.5,2,2.8,1.3,0]){gis.seek(pos);sandbox.setIndoorPosition(pos);assert.deepEqual(sandbox.indoor.snapshot,gis.occupancy);assert.equal(gis.occupancy.inside+gis.personData().length,100)}
  assert([...sandbox.people.values()].every(p=>!p.presentationVisible))
})
test('day labels contain date and replay percentage but never pretend OASIS supplied a time of day',()=>{
  const s=prepared(),index=indexScene(s.files['trajectory.json']),label=displayDate(s.manifest.simulation_time,2.5,index)
  assert.match(label.label,/第 2 天.*2026-10-02/);assert.equal(label.progress,50);assert(!/\d\d:\d\d/.test(label.label))
})
test('the partial last recorded day stays day 24 at the end instead of fabricating day 25',()=>{
  const s=prepared(),index=indexScene(s.files['trajectory.json']),end=displayDate(s.manifest.simulation_time,index.days.length,index)
  assert.match(end.label,/第 24 天.*2026-10-24/);assert.equal(end.progress,100)
})
test('draining a single step animates only purchases already reached by the replay cursor',()=>{
  const s=prepared(),m=motion(s),event=s.files['trajectory.json'].events.find(e=>e.type==='purchase')
  m.purchases=[{event:{...event,key:'now',order_id:'now'},tick:30},{event:{...event,key:'future',order_id:'future'},tick:60}]
  m.sync(.05,4);assert(m.seen.has('now'));assert(!m.seen.has('future'))
})
test('route preparation warms only existing purchase corridors and keeps all idle people hidden',async()=>{
  const s=prepared(),before=JSON.stringify(s),m=motion(s)
  await m.prepareRoutes();assert(m.routes.size>0);assert.equal(m.seen.size,0);assert.equal(m.pending,0);assert.equal(m.snapshot.inside,100);assert.equal(m.outside.length,0);assert.equal(JSON.stringify(s),before)
})
