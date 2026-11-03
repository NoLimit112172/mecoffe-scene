import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { buildSpatialEnvironment, waterPointClear, waterSegmentClear, waterDepthAt, bridgeHeightAt } from '../src/mecoffe/campus3dSpatial.js'
import { outsideBuildings, clearDisplaySegment, displayRoutePoints, nearestClearPosition, stepSeparatedCrowd } from '../src/mecoffe/campus3dCrowd.js'
import { createWaterBasin, createBridge } from '../src/mecoffe/Campus3DWater.js'
import { Campus3DBase } from '../src/mecoffe/Campus3DBase.js'
import { createDisplayCampus } from '../src/mecoffe/campus3dDisplay.js'
import { pointInRing } from '../src/mecoffe/campus3dEnvironmentModel.js'
import { createAssetPreview } from '../src/mecoffe/AssetPreviewRenderer.js'
import { getPrototype } from '../src/mecoffe/assetCatalog.js'

const mini=()=>buildSpatialEnvironment({buildings:[],roads:[{osm_id:'crossing',highway:'footway',points:[[-10,0],[30,0]]}]},[
  {osm_id:'lake',name:'示例湖',kind:'water',polygon:[[0,-50],[20,-50],[20,50],[0,50],[0,-50]]},
])
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'))

test('open water blocks standing and continuous movement; only the complete bridge footprint permits crossing',()=>{
  const s=mini(),water=s.waters[0],bridge=s.bridges[0]
  assert.equal(s.bridges.length,1);assert.equal(bridge.verified_bridge,false)
  assert.equal(waterPointClear({x:10,y:8},water,8),false)
  assert.equal(outsideBuildings({x:10,y:8},s.obstacles,8),false)
  assert.equal(waterPointClear({x:10,y:0},water,8),true)
  assert.equal(waterPointClear({x:10,y:3.9},water,8),false,'feet cannot overhang the bridge edge')
  assert.equal(waterSegmentClear({x:-10,y:8},{x:30,y:8},water,8),false,'two dry endpoints cannot skip the river')
  assert.equal(clearDisplaySegment({x:-10,y:0},{x:30,y:0},s.obstacles,8),true)
  assert.equal(clearDisplaySegment({x:-10,y:-8},{x:30,y:8},s.obstacles,8),false,'diagonal shortcuts may not leave the deck')
  const dry=nearestClearPosition({x:10,y:15},s.obstacles,{radius:8})
  assert(waterPointClear(dry,water,8))
  const moved=stepSeparatedCrowd([{id:'person',x:-2,y:8,radius:8,target:{x:8,y:8}}],s.obstacles)[0]
  assert(waterPointClear(moved,water,8));assert(moved.x<0)
})

test('display routing uses bridge portals while preserving the input route and keeps swept segments dry',()=>{
  const s=mini(),route=[{x:-12,y:8},{x:32,y:8}],before=JSON.stringify(route)
  const result=displayRoutePoints(route,s.obstacles,{radius:8,laneOffset:0})
  assert.equal(JSON.stringify(route),before)
  assert(result.length>2)
  assert(result.some(p=>Math.abs(p.y)<1e-6),'a bridge landing is part of the detour')
  for(let i=1;i<result.length;i++)assert(waterSegmentClear(result[i-1],result[i],s.waters[0],8))
  assert(Math.abs(bridgeHeightAt({x:10,y:0},s.bridges[0])-1.05)<1e-7)
  assert.equal(bridgeHeightAt({x:10,y:10},s.bridges[0]),null)
})

test('lake bed has reproducible spatially varying depth and true 3D banks; water is below the road',()=>{
  const s=mini(),water=s.waters[0],before=JSON.stringify(water.polygon),basin=createWaterBasin(water),bridge=createBridge(s.bridges[0])
  assert(waterDepthAt({x:10,y:10},water)>waterDepthAt({x:.1,y:10},water))
  assert.equal(waterDepthAt({x:-3,y:0},water),0)
  assert.equal(waterDepthAt({x:10,y:10},water),waterDepthAt({x:10,y:10},water))
  const bed=basin.getObjectByName('起伏湖底（设定深度）'),surface=basin.getObjectByName('半透明水面')
  assert(bed.userData.depthRange.max-bed.userData.depthRange.min>.5)
  assert(new THREE.Box3().setFromObject(bed).min.y<water.settings.surface-1)
  assert(new THREE.Box3().setFromObject(basin.getObjectByName('下凹岸坡')).getSize(new THREE.Vector3()).y>1)
  assert(surface.material.transparent&&surface.material.opacity<1)
  assert(water.settings.surface<.14)
  assert(new THREE.Box3().setFromObject(bridge).max.y>2)
  assert.equal(JSON.stringify(water.polygon),before)
})

test('real campus lake holes remove grass instead of painting water over roads; both cross-water roads get bridges',()=>{
  const campus=json('../../scene/campus3d.json'),mapping=json('../../scene/campus3d_mapping.json'),features=json('../public/mecoffe/campus3d_landcover.json').features
  const before=JSON.stringify({campus,mapping,features}),display=createDisplayCampus(campus,{mapping,landcovers:features})
  const s=buildSpatialEnvironment(display.campus,display.landcovers),scene=new THREE.Scene()
  assert.equal(s.waters.length,1);assert.equal(s.bridges.length,2)
  for(const bridge of s.bridges)assert(waterSegmentClear(bridge.start,bridge.end,s.waters[0],8.25))
  const base=new Campus3DBase({scene,campus:display.campus,displayBounds:display.bounds,waters:s.waters}).init(),water=s.waters[0]
  for(let x=-125;x<-15;x+=8)for(let y=-370;y<-30;y+=8)if(pointInRing({x,y},water.polygon))assert(!base.grassPieces.some(piece=>pointInRing({x,y},piece)),`grass over lake at ${x},${y}`)
  assert.equal(JSON.stringify({campus,mapping,features}),before)
  base.dispose()
})

test('water and bridge library cards render their real geometry and depth/width variants',async()=>{
  for(const id of ['landcover.water','road.bridge']){
    const prototype=getPrototype(id),items=[]
    for(const variant of prototype.variants){const preview=await createAssetPreview(prototype,variant.id);const b=new THREE.Box3().setFromObject(preview.object);assert(Number.isFinite(b.min.y));items.push(b.getSize(new THREE.Vector3()).toArray());preview.dispose()}
    assert.notDeepEqual(items[0],items[1])
  }
})
