import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {readFileSync} from 'node:fs'
import {TERRAIN_LEVELS as L,campusRoadWidth,offsetTerrainRing,roadCorridors,signedArea,subtractConvexPolygon,subtractTerrainCuts,terrainBaseBounds,terrainSurfaceHeight} from '../src/mecoffe/campus3dTerrain.js'
import {Campus3DBase} from '../src/mecoffe/Campus3DBase.js'
import {createDisplayCampus} from '../src/mecoffe/campus3dDisplay.js'
import {pointInRing,segmentDistance} from '../src/mecoffe/campus3dEnvironmentModel.js'
import {createAssetPreview} from '../src/mecoffe/AssetPreviewRenderer.js'

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))
const campus=json('../../scene/campus3d.json'),mapping=json('../../scene/campus3d_mapping.json')

test('sand-table layers have true thickness and coherent campus, road and sidewalk heights',()=>{
  assert.ok(L.baseBottom<L.stoneTop&&L.stoneTop<L.earthTop&&L.earthTop<L.outsideTop)
  assert.ok(L.outsideTop<L.externalRoadBottom&&L.externalRoadBottom<L.externalRoad)
  assert.ok(L.externalRoad<L.externalSidewalk&&L.externalSidewalk<L.externalCurb)
  assert.ok(L.externalCurb<L.campusPlinth&&L.campusPlinth<L.campusRoad)
  assert.ok(L.campusRoad<L.campusGrass&&L.campusGrass<L.campusCurb&&L.campusCurb<L.buildingBase)
  assert.equal(L.campusRoad,.14,'Retain the existing display route surface datum')
  const miniature={boundary:[[-10,-10],[10,-10],[10,10],[-10,10]],roads:[{highway:'footway',points:[[-8,0],[8,0]]}]}
  assert.equal(terrainSurfaceHeight([0,0],miniature),L.campusRoad)
  assert.equal(terrainSurfaceHeight({x:0,y:8},miniature),L.campusGrass)
  assert.equal(terrainSurfaceHeight([30,0],miniature),L.outsideTop)
  assert.throws(()=>terrainSurfaceHeight([NaN,0],miniature))
})

test('convex subtraction removes physical road space without overlapping kept pieces or losing area',()=>{
  const square=[[0,0],[10,0],[10,10],[0,10]],cut=[[3,-1],[7,-1],[7,11],[3,11]]
  const before=JSON.stringify({square,cut}),pieces=subtractConvexPolygon(square,cut)
  assert.equal(pieces.reduce((sum,p)=>sum+Math.abs(signedArea(p)),0),60)
  assert.ok(pieces.every(p=>!pointInRing({x:5,y:5},p)))
  assert.equal(JSON.stringify({square,cut}),before)
  assert.deepEqual(subtractConvexPolygon(square,[[-1,-1],[11,-1],[11,11],[-1,11]]),[])
  const cross=subtractTerrainCuts([square],[cut,[[-1,4],[11,4],[11,6],[-1,6]]])
  assert.ok(Math.abs(cross.reduce((sum,p)=>sum+Math.abs(signedArea(p)),0)-48)<1e-8)
  assert.equal(subtractConvexPolygon(square,[[20,20],[30,20],[30,30],[20,30]]).length,1)
})

test('road slots and footing expansion use presentation copies, including reverse polygon winding',()=>{
  const roads=[{highway:'footway',points:[[0,0],[20,0],[20,20]]}],before=JSON.stringify(roads)
  const cuts=roadCorridors(roads,.72)
  assert.ok(cuts.some(cut=>pointInRing({x:10,y:0},cut)))
  assert.ok(cuts.some(cut=>pointInRing({x:20,y:10},cut)))
  assert.ok(!cuts.some(cut=>pointInRing({x:30,y:30},cut)))
  assert.equal(JSON.stringify(roads),before)
  const ring=[[0,0],[10,0],[10,10],[0,10],[0,0]]
  for(const input of [ring,[...ring].reverse()])assert.ok(Math.abs(signedArea(offsetTerrainRing(input,1)))>100)
  assert.deepEqual(terrainBaseBounds({minX:0,maxX:10,minY:0,maxY:10},5),{minX:-5,maxX:15,minY:-5,maxY:15})
})

test('real campus grass is physically cut away from every road centreline and base resources are restorable',()=>{
  const before=JSON.stringify(campus),display=createDisplayCampus(campus,{mapping}),scene=new THREE.Scene()
  const previous=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial())
  previous.userData.environmentKind='ground';scene.add(previous)
  const base=new Campus3DBase({scene,campus:display.campus,displayBounds:display.bounds}).init()
  assert.equal(previous.visible,false)
  assert.ok(base.grassPieces.length>1)
  for(const road of display.campus.roads)for(let i=1;i<road.points.length;i++) {
    const a=road.points[i-1],b=road.points[i]
    for(const t of [.1,.3,.5,.7,.9]) {
      const point={x:a[0]+t*(b[0]-a[0]),y:a[1]+t*(b[1]-a[1])}
      assert.ok(!base.grassPieces.some(piece=>pointInRing(point,piece)),`${road.osm_id}: grass covers route centre`)
    }
  }
  let meshCount=0
  base.group.traverse(object=>{if(object.isMesh){meshCount++;assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite))}})
  assert.ok(meshCount>10)
  assert.equal(base.contactShadows.children.length,1,'contact seams share one batched mesh')
  base.setQuality('low');assert.equal(base.contactShadows.visible,false)
  base.setQuality('high');assert.equal(base.contactShadows.visible,true)
  base.dispose();base.dispose();assert.equal(previous.visible,true);assert.equal(scene.children.length,1)
  assert.equal(JSON.stringify(campus),before)
})

test('terrain and foundation gallery cards render actual volume and the same elevation hierarchy',async()=>{
  const terrain={id:'landcover.layered-base',category:'landcover',params:{generator:'layered-base'},source:{type:'procedural'}}
  const footing={id:'building.component.foundation',category:'building',params:{generator:'foundation'},source:{type:'procedural'}}
  const a=await createAssetPreview(terrain),b=await createAssetPreview(footing)
  try {
    const heights=(group,name)=>{const box=new THREE.Box3().setFromObject(group.getObjectByName(name));return {bottom:box.min.y,top:box.max.y}}
    for(const [name,bottom,top]of [['base-stone',L.baseBottom,L.stoneTop],['base-earth',L.stoneTop,L.earthTop],['external-road',L.externalRoadBottom,L.externalRoad],['campus-road',L.campusPlinth,L.campusRoad]]) {
      const bounds=heights(a.object,name)
      assert.ok(Math.abs(bounds.bottom-bottom)<1e-5&&Math.abs(bounds.top-top)<1e-5,name)
      assert.ok(bounds.top>bounds.bottom,`${name}: a solid thickness is required`)
    }
    assert.ok(heights(a.object,'external-sidewalk-4.3').top>heights(a.object,'external-road').top)
    assert.ok(heights(a.object,'campus-turf--16.8').top>heights(a.object,'campus-road').top)
    const foundation=heights(b.object,'foundation-solid')
    assert.ok(Math.abs(foundation.bottom-L.campusRoad)<1e-6&&Math.abs(foundation.top-L.buildingBase)<1e-6)
    assert.ok(Math.abs(heights(b.object,'foundation-building-context').bottom-foundation.top)<1e-6)
    assert.match(a.caption,/实体侧面/);assert.match(b.caption,/实体基座/)
    for(const preview of [a,b])preview.object.traverse(mesh=>{if(mesh.isMesh)assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite))})
  } finally {a.dispose();b.dispose()}
})
