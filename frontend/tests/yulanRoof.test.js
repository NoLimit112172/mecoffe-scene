import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { roofType,roofPlan,equipmentFitsRoof,footprintMetrics,compatibleYuLanFacade,ROUND_FACADE_VARIANTS } from '../src/mecoffe/yulanRoofModel.js'
import { createYuLanRoof } from '../src/mecoffe/YuLanRoofGeometry.js'
import { YuLanAssetFactory,disposeYuLanObject } from '../src/mecoffe/YuLanAssetFactory.js'
import { createAssetPreview } from '../src/mecoffe/AssetPreviewRenderer.js'

const rectangle=(width=24,depth=16)=>[[0,0],[width,0],[width,depth],[0,depth],[0,0]]

test('small rectangular residences have pitched roofs while campus blocks, long wings and courtyards remain flat',()=>{
  assert.equal(roofType({polygon:rectangle(),height_m:12},{type:27}),'pitched')
  assert.equal(roofType({polygon:rectangle(),height_m:12},{type:21}),'flat')
  assert.equal(roofType({polygon:rectangle(80,30),height_m:12},{type:27}),'flat')
  assert.equal(roofType({polygon:rectangle(60,3),height_m:12},{type:29}),'flat')
  assert.equal(roofType({polygon:rectangle(),height_m:24},{type:27}),'flat')
  assert.equal(roofType({polygon:rectangle(),holes:[rectangle(2,2)],height_m:12},{type:27}),'flat')
  assert.equal(roofType({polygon:[[0,0],[24,0],[24,8],[12,8],[12,16],[0,16],[0,0]],height_m:12},{type:27}),'flat')
  const angle=.37
  const rotated=rectangle().map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)])
  assert.equal(roofType({polygon:rotated,height_m:12},{type:28}),'pitched')
})

test('roof equipment is deterministic by building ID and seed and stays off courtyard openings and outside edges',()=>{
  const building={osm_id:'roof-courtyard',polygon:rectangle(55,40),holes:[[[15,8],[35,8],[35,31],[15,31],[15,8]]],height_m:14}
  const original=structuredClone(building),first=roofPlan(building)
  assert.deepEqual(first,roofPlan(building))
  assert.notDeepEqual(first.equipment,roofPlan(building,{seed:99}).equipment)
  assert.ok(first.equipment.length>=3)
  assert.ok(first.equipment.every(item=>equipmentFitsRoof(item,building)))
  assert.equal(equipmentFitsRoof({x:25,y:19.5,width:25,depth:28,angle:0},building),false)
  assert.deepEqual(building,original)
})

test('every real USTC roof device fits its original footprint and the campus contains varied true roof equipment',()=>{
  const campus=JSON.parse(readFileSync(new URL('../public/mecoffe/campus3d.json',import.meta.url),'utf8'))
  const before=structuredClone(campus),types=new Set()
  for(const building of campus.buildings){
    const plan=roofPlan(building)
    for(const item of plan.equipment){assert.ok(equipmentFitsRoof(item,building),building.osm_id);types.add(item.kind)}
  }
  for(const type of ['stairwell','hvac','water-tank','vent','solar','green-roof'])assert.ok(types.has(type),type)
  assert.deepEqual(campus,before)
})

test('verified round tower atlas variants cannot be applied to square or elongated footprints',()=>{
  const circle=Array.from({length:25},(_,i)=>[10*Math.cos(i/24*Math.PI*2),10*Math.sin(i/24*Math.PI*2)])
  assert.equal(footprintMetrics(circle).isRound,true)
  assert.equal(footprintMetrics(rectangle(20,20)).isRound,false)
  for(const pair of ROUND_FACADE_VARIANTS){
    const [type,model]=pair.split(':').map(Number)
    for(const polygon of [rectangle(20,20),rectangle(100,15)]){
      const building={osm_id:'immutable-id',polygon},before=structuredClone(building)
      const selected=compatibleYuLanFacade(building,{type,model})
      assert.equal(selected.changed,true,pair)
      assert.ok(!ROUND_FACADE_VARIANTS.includes(`${selected.type}:${selected.model}`))
      assert.deepEqual(selected,compatibleYuLanFacade(building,{type,model}))
      assert.deepEqual(building,before)
    }
    const selected=compatibleYuLanFacade({polygon:circle},{type,model})
    assert.equal(selected.changed,false)
    assert.deepEqual([selected.type,selected.model],[type,model])
  }
})

test('flat roof slab, parapets and equipment are meshes with thickness and no source roof texture',()=>{
  const building={osm_id:'flat-geometry',polygon:rectangle(70,45),height_m:15}
  const roof=createYuLanRoof(building,{type:22,model:1})
  roof.updateMatrixWorld(true)
  const slab=roof.getObjectByName('roof-slab'),bounds=new THREE.Box3().setFromObject(slab)
  assert.ok(Math.abs(bounds.max.y-bounds.min.y-.42)<1e-5)
  assert.ok(roof.getObjectByName('roof-parapet'))
  assert.ok(roof.children.some(child=>child.userData.roofEquipment))
  roof.traverse(item=>{if(item.material)assert.equal(item.material.map,null)})
  assert.equal(roof.userData.roofTextureApplied,false)
  disposeYuLanObject(roof)
})

test('pitched roof is a closed three-dimensional gable with eaves instead of a stretched sprite',()=>{
  const building={osm_id:'little-house',polygon:rectangle(20,12),height_m:8}
  const roof=createYuLanRoof(building,{type:27,model:2})
  roof.updateMatrixWorld(true)
  const solid=roof.getObjectByName('pitched-roof-solid'),bounds=new THREE.Box3().setFromObject(solid)
  assert.ok(solid?.isMesh)
  assert.ok(bounds.max.y-bounds.min.y>2)
  assert.ok(bounds.min.x<0 && bounds.max.x>20)
  assert.equal(solid.material.side,THREE.FrontSide)
  assert.ok(new THREE.Raycaster(new THREE.Vector3(10,30,-3),new THREE.Vector3(0,-1,0)).intersectObject(solid).length>0,'Roof winding faces outward')
  assert.equal(roof.userData.roofPlan.equipment.length,0)
  const counts=new Map(),index=solid.geometry.index
  for(let i=0;i<index.count;i+=3)for(let edge=0;edge<3;edge++){
    const a=index.getX(i+edge),b=index.getX(i+(edge+1)%3),key=[a,b].sort((x,y)=>x-y).join(':')
    counts.set(key,(counts.get(key)||0)+1)
  }
  assert.ok([...counts.values()].every(count=>count===2),'Every solid roof edge belongs to exactly two triangles')
  disposeYuLanObject(roof)
})

test('factory applies compatible facades at its shared entrypoint without mutating source geometry',()=>{
  const factory=new YuLanAssetFactory(),building={osm_id:'square-university',polygon:rectangle(40,20),height_m:14}
  factory.assets={};const keys=[]
  factory.material=part=>{keys.push(part.key);return new THREE.MeshStandardMaterial()}
  const original=structuredClone(building),object=factory.createBuilding(building,{type:22,model:2})
  assert.equal(object.userData.facadeSelection.changed,true)
  assert.ok(keys.every(key=>!key.includes('22_2_') && !key.endsWith('_2.png')))
  assert.deepEqual(building,original)
  disposeYuLanObject(object)
})

test('roof catalog components create the real thick roof generator and preserve distinct variants',async()=>{
  for(const kind of ['flat','pitched']) {
    const prototype={id:`building.component.roof-${kind}`,category:'building',target:'component',source:{type:'procedural'},
      params:{generator:`roof-${kind}`},variants:[{id:'a',params:{seed:2026}},{id:'b',params:{seed:71,width_m:kind==='pitched'?25:48}}]}
    const a=await createAssetPreview(prototype,'a'),b=await createAssetPreview(prototype,'b')
    const roofA=a.object.getObjectByName('yulan-procedural-roof'),roofB=b.object.getObjectByName('yulan-procedural-roof')
    assert.equal(roofA.userData.roofPlan.kind,kind)
    assert.equal(roofB.userData.roofPlan.kind,kind)
    assert.notEqual(roofA.userData.roofPlan.metrics.width,roofB.userData.roofPlan.metrics.width)
    assert.ok(roofA.getObjectByName(kind==='pitched'?'pitched-roof-solid':'roof-parapet'))
    assert.match(a.caption,/程序三维屋顶/)
    a.dispose();b.dispose()
  }
})
