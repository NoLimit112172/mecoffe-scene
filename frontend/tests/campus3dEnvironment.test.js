import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { buildingPalette, dayLighting, decorationAvoidsAgents, decorationVisibility, decorationIsClear, decorationPlacements, seededRandom, windowPattern } from '../src/mecoffe/campus3dEnvironmentModel.js'
import { Campus3DEnvironment } from '../src/mecoffe/Campus3DEnvironment.js'
import { YuLanCampusStyle } from '../src/mecoffe/YuLanCampusStyle.js'

const campus = JSON.parse(readFileSync(new URL('../../scene/campus3d.json', import.meta.url), 'utf8'))

test('display lighting is continuous, periodic and much darker at night', () => {
  assert.deepEqual(dayLighting(0), dayLighting(1))
  assert.deepEqual(dayLighting(.25), dayLighting(2.25))
  assert.deepEqual(dayLighting(NaN), dayLighting(.25))
  assert.ok(dayLighting(.25).strength > dayLighting(.75).strength * 8)
  assert.equal(dayLighting(.25).night, 0)
  assert.equal(dayLighting(.75).night, 1)
  // A dark blue sky must not force all non-emissive scenery to black. The
  // ambient fill remains cool and readable while direct light stays much lower.
  const brightness = hex => hex.slice(1).match(/../g).reduce((sum, value) => sum + parseInt(value, 16), 0) / (3 * 255)
  const midnight = dayLighting(.75)
  assert.ok(brightness(midnight.sky) < .2)
  assert.ok(brightness(midnight.ambientSky) > .6)
  assert.ok(brightness(midnight.ambientGround) > .5)
  assert.ok(midnight.hemi >= .7 && midnight.hemi < dayLighting(.25).hemi)
  assert.equal(dayLighting(.25).ambientSky, dayLighting(.25).horizon)
  assert.equal(dayLighting(0).hour, 6)
  assert.equal(dayLighting(.5).hour, 18)
  for (let step = 0; step <= 1000; step += 1) {
    const value = dayLighting(step / 1000)
    assert.ok(value.night >= 0 && value.night <= 1)
    assert.ok(value.sunDirection.every(Number.isFinite))
    for (const key of ['sky', 'horizon', 'fog', 'sun']) assert.match(value[key], /^#[a-f0-9]{6}$/)
    assert.ok(Math.abs(value.night - dayLighting((step + 1) / 1000).night) < .02)
  }
})

test('building palettes distinguish major campus uses without changing buildings', () => {
  const before = structuredClone(campus.buildings)
  assert.notEqual(buildingPalette({ kind: 'dormitory' }).wall, buildingPalette({ kind: 'education' }).wall)
  assert.notEqual(buildingPalette({ name: '图书教育中心A区' }).accent, buildingPalette({ name: '教工食堂' }).accent)
  for (const building of campus.buildings) assert.match(buildingPalette(building).wall, /^#[a-f0-9]{6}$/)
  assert.deepEqual(campus.buildings, before)
})

test('fixed random seeds reproduce window masks and decoration candidates', () => {
  assert.deepEqual(windowPattern('same-building'), windowPattern('same-building'))
  assert.notDeepEqual(windowPattern('building-A'), windowPattern('building-B'))
  const a = seededRandom('same')
  const b = seededRandom('same')
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b))
  const before = JSON.stringify(campus)
  assert.deepEqual(decorationPlacements(campus), decorationPlacements(campus))
  assert.equal(JSON.stringify(campus), before)
})

test('decoration stays outside buildings, roads and campus holes and never modifies routes', () => {
  const before = structuredClone(campus.walk_graph)
  const decor = decorationPlacements(campus)
  assert.equal(decor.illustrative, true)
  assert.match(decor.label, /装饰/)
  assert.ok(decor.trees.length > 20)
  const all = [...decor.trees, ...decor.lamps, ...decor.benches]
  assert.ok(all.every(point => decorationIsClear(point, campus)))
  for (let i = 0; i < all.length; i += 1) {
    assert.ok(all.slice(i + 1).every(other => Math.hypot(all[i].x - other.x, all[i].y - other.y) >= 8))
  }
  assert.deepEqual(campus.walk_graph, before)
})

test('OSM sports and water areas remain free of decorative furniture', () => {
  const features = JSON.parse(readFileSync(new URL('../public/mecoffe/campus3d_landcover.json', import.meta.url), 'utf8')).features
  const decor = decorationPlacements(campus, { landcovers: features })
  const all = [...decor.trees, ...decor.lamps, ...decor.benches]
  assert.ok(all.length > 20)
  assert.ok(all.every(point => decorationIsClear(point, campus, 7, features)))
})

test('decoration full crowns avoid crowd standing zones and lane-safe presentation routes',()=>{
  const avoidance={points:[{x:0,y:0,radius:3}],routes:[{points:[{x:20,y:-30},{x:20,y:30}]}],clearance:14}
  assert.equal(decorationAvoidsAgents({x:10,y:0,scale:1},avoidance),false,'crown would touch waiting person')
  assert.equal(decorationAvoidsAgents({x:36,y:10,scale:1},avoidance),false,'crown would touch expanded walking corridor')
  assert.equal(decorationAvoidsAgents({x:50,y:10,scale:1},avoidance),true)
  const original=decorationPlacements(campus),all=[...original.trees,...original.lamps,...original.benches]
  const busy={points:all.slice(0,5).map(p=>({...p,radius:5})),routes:campus.roads.slice(0,5),clearance:14}
  const before=JSON.stringify({campus,busy}),filtered=decorationPlacements(campus,{avoidance:busy})
  assert.ok([...filtered.trees,...filtered.lamps,...filtered.benches].every(p=>decorationAvoidsAgents(p,busy)))
  assert.equal(JSON.stringify({campus,busy}),before)
})

test('dynamic decoration mask keeps candidate indices and reserves larger atlas envelopes', () => {
  const points=[{x:0,y:0,scale:1},{x:50,y:0,scale:1},{x:100,y:0,scale:1}]
  const before=JSON.stringify(points)
  const avoidance={points:[{x:0,y:4,radius:4}],routes:[[{x:80,y:-10},{x:80,y:10}]],clearance:3}
  assert.deepEqual(decorationVisibility(points,avoidance,[8,28,8]),[false,false,true])
  assert.deepEqual(decorationVisibility(points,{}),[true,true,true])
  assert.equal(JSON.stringify(points),before)
})

test('real procedural and YuLan decoration instances hide for detours, restore matrices, and retain quality visibility', async () => {
  const scene=new THREE.Scene(),renderer={shadowMap:{enabled:false,type:THREE.PCFShadowMap,autoUpdate:true},capabilities:{getMaxAnisotropy:()=>1}}
  const environment=new Campus3DEnvironment({scene,campus,mapping:{mappings:{}},buildingMeshes:new Map(),renderer})
  const points=[{x:0,y:0,angle:.2,scale:1},{x:50,y:0,angle:.4,scale:1},{x:100,y:0,angle:.6,scale:1},{x:150,y:0,angle:.8,scale:1}]
  const before=JSON.stringify({points,campus})
  environment.placements={trees:points,lamps:points,benches:points}
  environment.trees=new THREE.Group();environment.group.add(environment.trees)
  environment.sun={castShadow:true,shadow:{}}
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(5,10,5),new THREE.MeshBasicMaterial(),points.length)
  const original=[]
  points.forEach((p,i)=>{const matrix=new THREE.Matrix4().makeTranslation(p.x,5,-p.y);mesh.setMatrixAt(i,matrix);original.push(matrix.clone())})
  environment.trees.add(mesh)
  environment.registerDecorationBatch(mesh,points)
  // Geometry/instance handling is real; only the 2D lamp-glow paint needs DOM.
  const previousDocument=globalThis.document
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})}
  try { environment.drawFurniture() }
  finally { if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument }
  assert.equal(environment.decorationBatches.length,8,'tree batch, three lamp parts and four bench parts are all registered')
  const prototype={id:'vegetation.yulan.tree_group',category:'vegetation',style:'yulan',subtype:'tree_group',params:{decorationSet:'tree_group'}}
  const factory={createDecoration:()=>{
    const group=new THREE.Group()
    // Wider than the generic 8 m reserve: geometry envelope must be respected.
    group.add(new THREE.Mesh(new THREE.BoxGeometry(28,7,4),new THREE.MeshBasicMaterial()))
    return group
  }}
  const style=new YuLanCampusStyle({scene,campus:{buildings:[]},buildingMeshes:new Map(),environment,prototypes:[prototype]})
  await style.init({factory})
  style.setEnabled(true)
  const atlasOriginal=style.decorationBatches.map(batch=>batch.matrices.map(matrix=>matrix.clone()))
  const busy={points:[{x:0,y:0,radius:4}],routes:[[{x:50,y:-20},{x:50,y:20}]],clearance:8}
  environment.setAgentClearance(busy)
  assert.deepEqual(mesh.userData.decorationVisibility,[false,false,true,true])
  for(const batch of environment.decorationBatches) {
    assert.deepEqual(batch.visible,[false,false,true,true])
    for(let i=0;i<2;i++) {const matrix=new THREE.Matrix4();batch.mesh.getMatrixAt(i,matrix);assert.equal(matrix.determinant(),0)}
  }
  for(const batch of style.decorationBatches) {
    assert.deepEqual(batch.visible,decorationVisibility(batch.points,busy,batch.radii))
    batch.visible.forEach((visible,i)=>{const matrix=new THREE.Matrix4();batch.mesh.getMatrixAt(i,matrix);assert.equal(matrix.determinant()===0,!visible)})
  }
  const wideOnly={points:[{x:112,y:0,radius:0}],routes:[]}
  environment.setAgentClearance(wideOnly)
  assert.equal(mesh.userData.decorationVisibility[2],true,'procedural tree clears this point')
  const wideBatch=style.decorationBatches.find(batch=>batch.points.some(p=>p.x===100))
  assert.equal(wideBatch.visible[wideBatch.points.findIndex(p=>p.x===100)],false,'wide atlas tree reserves its full measured shape')
  environment.setQuality('low');style.setQuality('low')
  environment.setAgentClearance({})
  assert.equal(environment.trees.visible,false)
  assert.equal(style.decorationGroups.get('trees').visible,false)
  environment.setQuality('high');style.setQuality('high');style.setEnabled(false)
  assert.equal(environment.trees.visible,true)
  for(let i=0;i<points.length;i++) {const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);assert.deepEqual(matrix.elements,original[i].elements)}
  style.decorationBatches.forEach((batch,b)=>batch.matrices.forEach((_,i)=>{
    const matrix=new THREE.Matrix4();batch.mesh.getMatrixAt(i,matrix)
    // Instance attributes round to float32; saved source matrices share it.
    assert.deepEqual(matrix.elements,atlasOriginal[b][i].elements)
  }))
  assert.equal(JSON.stringify({points,campus}),before)
  assert.equal(environment.clearanceListeners.size,1)
  style.dispose()
  assert.equal(environment.clearanceListeners.size,0)
  environment.dispose();mesh.geometry.dispose();mesh.material.dispose()
})
