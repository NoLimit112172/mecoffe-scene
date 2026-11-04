import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {textTextureMetrics,screenLine,updateScreenLine} from '../src/mecoffe/Campus3DAnnotations.js'
import {Campus3DEntrances,entrancePose} from '../src/mecoffe/Campus3DEntrances.js'
import {IndoorMotion,auditPeople} from '../src/mecoffe/indoorMotion.js'
import {Campus3DScene} from '../src/mecoffe/Campus3DScene.js'
import {indexScene} from '../src/mecoffe/replay.js'
import {pointInRing} from '../src/mecoffe/campus3dEnvironmentModel.js'
import {RealCharacterBatch} from '../src/mecoffe/Campus3DRealCharacters.js'
import {displayBounds,pointInDisplay} from '../src/mecoffe/campus3dDisplay.js'

const read=relative=>JSON.parse(readFileSync(new URL(relative,import.meta.url)))
const root='../public/mecoffe/scenarios/ustc-history/',campus=read(root+'campus3d.json'),mapping=read(root+'location_mapping.json'),entrances=read(root+'entrances.json'),data=read(root+'trajectory.json'),index=indexScene(data)
const motion=()=>new IndoorMotion({campus,mapping,entrances,index,landcovers:read(root+'landcover.json').features})

test('text rasterization is at least 2x and bounded at 3x even on high-DPI displays',()=>{
  for(const dpr of [0,1,1.25,2,3,4]){const s=textTextureMetrics(120,dpr);assert(s.ratio>=2&&s.ratio<=3);assert.equal(s.height,s.logicalHeight*s.ratio);assert.equal(s.width,s.logicalWidth*s.ratio)}
})
test('relationship ribbons retain 2.8 CSS pixel width on resize and update existing buffers',()=>{
  const line=screenLine([{x:0,y:0,z:0},{x:1,y:2,z:0},{x:4,y:0,z:0}]),buffer=line.geometry.attributes.instanceStart.data
  assert.equal(line.material.linewidth,2.8);assert.equal(line.material.worldUnits,false);assert.equal(line.material.depthTest,false)
  line.onBeforeRender({getViewport:v=>v.set(0,0,1300,700)});assert.deepEqual(line.material.resolution.toArray(),[1300,700])
  updateScreenLine(line,[{x:10,y:0,z:0},{x:11,y:2,z:0},{x:14,y:0,z:0}]);assert.equal(line.geometry.attributes.instanceStart.data,buffer);assert.equal(buffer.array[0],10)
  line.geometry.dispose();line.material.dispose()
})
test('each USTC building has one wall-centred door, facing normal to the facade',()=>{
  assert.equal(entrances.entrances.length,campus.buildings.length);assert.equal(new Set(entrances.entrances.map(e=>e.building_id)).size,campus.buildings.length)
  const doors=new Campus3DEntrances({scene:new THREE.Scene(),campus,entrances})
  assert.equal(doors.frames.size,31);assert.equal(doors.group.children.length,3)
  for(const entry of entrances.entrances){
    const [a,b]=entry.facade;assert.equal(entry.placement,'facade_midpoint');assert(Math.hypot(entry.point[0]-(a[0]+b[0])/2,entry.point[1]-(a[1]+b[1])/2)<1e-5)
    assert(Math.abs((b[0]-a[0])*entry.outward[0]+(b[1]-a[1])*entry.outward[1])<1e-5)
    const pose=entrancePose(entry,campus.buildings.find(b=>b.osm_id===entry.building_id));assert(Math.abs(Math.sin(pose.heading)-entry.outward[0])<1e-6)
  }
  doors.dispose()
})
test('every purchase corridor begins and ends at the same single doors, in both directions',async()=>{
  const m=motion();await m.prepareRoutes()
  for(const [key,path]of m.routes){assert(path,key);const [home,shop]=key.split('|'),a=m.routing.anchors.get(home).door.point,b=m.routing.anchors.get(shop).door.point
    for(const [p,q]of [[path.points[0],a],[path.points.at(-1),b],[path.returning[0],b],[path.returning.at(-1),a]])assert(Math.hypot(p.x-q[0],p.y-q[1])<1e-5)
  }
})
test('full USTC replay conserves 100 locatable people without outdoor walkers inside buildings',async()=>{
  const m=motion(),bounds=displayBounds(campus,{mapping});await m.prepareRoutes();let samples=0,visibleSamples=0
  for(let pos=0;pos<=index.days.length;pos+=.025){m.sync(pos);const audit=m.accounting;assert(audit.valid,JSON.stringify(audit));assert.equal(audit.visible+audit.inside,100);samples++
    for(const p of m.outside){visibleSamples++;assert(pointInDisplay([p.x,p.y],bounds),`${p.id} left the displayed campus`);if(!p.walker.moving)continue
      for(const b of campus.buildings)assert(!pointInRing([p.x,p.y],b.polygon)||(b.holes||[]).some(h=>pointInRing([p.x,p.y],h)),`${p.id} inside ${b.name}`)
    }
  }
  assert(samples>900&&visibleSamples>100)
  const invalid=[...m.people.values()].map(p=>({...p}));invalid[0].homeBuilding='missing';invalid[0].walker=null
  assert.equal(auditPeople(invalid,m.buildingIds).valid,false)
})
test('all 100 roster entries focus a known home building and indoor relationships attach to roofs',()=>{
  const view=new Campus3DScene({campus,mapping,index,entrances});view.scene=new THREE.Scene();view.relationLayer=new THREE.Group();view.placePeople()
  view.camera=new THREE.PerspectiveCamera();view.controls={target:new THREE.Vector3(),update(){}}
  for(const p of data.people){assert.equal(view.focusPerson(p.id),p.id);assert.equal(view.indoorSelectedBuilding,view.indoor.personLocation(p.id).buildingId);assert(Number.isFinite(view.camera.position.x))}
  assert(view.relationLayer.children.length>0)
  assert(view.relationLayer.children.every(l=>l.isLine2&&l.material.linewidth===2.8))
  for(const id of view.relationLayer.children[0].userData.people){const location=view.indoor.personLocation(id),building=campus.buildings.find(b=>b.osm_id===location.buildingId);assert(view.relationshipEndpoint(id).y>building.height_m)}
})
test('both presentation mapping sources and the prepared scenario use the requested cafeterias',()=>{
  for(const m of [mapping,read('../public/mecoffe/campus3d_mapping.json'),read('../../scene/campus3d_mapping.json')]){
    assert.equal(m.mappings.shop_merchant_001.osm_name,'学生食堂B区');assert.equal(m.mappings.shop_merchant_001.osm_id,'way/1435377506')
    assert.equal(m.mappings.shop_merchant_002.osm_name,'教工食堂');assert(m.mappings.shop_merchant_001.illustrative)
  }
})
test('prepared GLB characters retain provenance and valid binary hashes',()=>{
  const manifest=read('../public/mecoffe/assets3d/valid/manifest.json')
  for(const m of manifest.models){const bytes=readFileSync(new URL('../public/mecoffe/assets3d/valid/'+m.glb,import.meta.url));assert.equal(bytes.toString('utf8',0,4),'glTF');assert.equal(createHash('sha256').update(bytes).digest('hex'),m.glb_sha256);assert.equal(bytes.length,m.glb_bytes);assert(m.source_git_blob&&m.sha256)
    const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());assert(doc.skins[0].joints.length>20);assert(doc.meshes.every(m=>m.primitives.every(p=>!p.targets)))
  }
})
test('new actors remain hidden until asynchronous shader preparation finishes',async()=>{
  const source=new THREE.Group();source.add(new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial()))
  const person={id:'demo',role:'undergraduate_consumer'},figure=new THREE.Group(),entries=new Map([['demo',{person,figure,inView:true,presentationVisible:true}]]);let release,preparing=false
  const wait=new Promise(r=>{release=r}),batch=new RealCharacterBatch({scene:new THREE.Scene(),entries,assets:null,prepareActor:async root=>{preparing=true;assert.equal(root.visible,false);await wait}})
  const initialized=batch.init({assets:{sample:source}})
  while(!preparing)await new Promise(r=>setTimeout(r,0))
  batch.update(1);assert.equal(batch.isReady('demo'),false);assert(batch.group.children.every(o=>!o.visible))
  release();await initialized;assert.equal(batch.isReady('demo'),true);batch.dispose();source.children[0].geometry.dispose();source.children[0].material.dispose()
})
