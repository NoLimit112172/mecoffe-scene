import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { buildingSuite, cropRectangle, wallModules, voxelizeRGBA, voxelSurface, YULAN_BUILDING_TYPES, YULAN_DECORATION_SETS } from '../src/mecoffe/yulanAssetModel.js'
import { YuLanAssetFactory, buildVoxelGeometry } from '../src/mecoffe/YuLanAssetFactory.js'
import { YuLanCampusStyle } from '../src/mecoffe/YuLanCampusStyle.js'

const frames = new Map()
for(let i=0;i<3;i++)for(const [key,frame] of Object.entries(JSON.parse(readFileSync(new URL(`../public/assets/bgrd-${i}.json`,import.meta.url),'utf8')).frames))frames.set(key,frame)

test('all ten YuLan suites and their three original variants resolve real atlas parts with explicit villa-derived crops',()=>{
  for(const type of YULAN_BUILDING_TYPES)for(const model of [1,2,3]) {
    const suite=buildingSuite(type,model)
    for(const part of ['base','floor','roof']) {
      const frame=frames.get(suite[part].key)
      assert.ok(frame,`${type}/${model}/${part}`)
      const crop=cropRectangle(frame.sourceSize.w,frame.sourceSize.h,suite[part].crop)
      assert.ok(crop.width>0 && crop.height>0)
    }
    assert.equal(suite.source,type<27?'native-modules':'derived-villa-bands')
  }
  for(const keys of Object.values(YULAN_DECORATION_SETS))for(const key of keys)assert.ok(frames.has(key),key)
  assert.throws(()=>buildingSuite(999),/Unknown/)
  assert.throws(()=>cropRectangle(20,20,[.8,0,.5,1]),/Invalid/)
})

test('modular walls close convex, concave and clockwise footprints exactly, without changing source shape or height',()=>{
  const polygons=[[[0,0],[18,0],[18,10],[0,10],[0,0]],[[0,0],[20,0],[20,8],[8,8],[8,19],[0,19],[0,0]],[[0,0],[0,10],[18,10],[18,0],[0,0]],[[0,0],[9,0],[4,7]]]
  for(const polygon of polygons) {
    const original=structuredClone(polygon)
    const result=wallModules(polygon,{levels:3,height:12.75,moduleWidth:7})
    assert.deepEqual(polygon,original)
    assert.equal(result.height,12.75)
    assert.equal(result.modules.filter(p=>p.part==='base').length,1)
    for(let level=0;level<3;level++) {
      const panels=result.modules.filter(p=>p.level===level)
      for(let i=0;i<panels.length;i++)assert.deepEqual(panels[i].end,panels[(i+1)%panels.length].start)
      assert.ok(panels.every(p=>p.width<=7+1e-8))
    }
    assert.equal(Math.max(...result.modules.map(p=>p.y+p.height/2)),12.75)
  }
  assert.throws(()=>wallModules([[0,0],[1,1],[2,2]]),/nonzero/)
})

test('opaque RGBA pixels produce exactly depth voxels, transparent pixels produce none, and internal faces are culled',()=>{
  const rgba=new Uint8ClampedArray([255,0,0,255,0,255,0,0,0,0,255,255,10,20,30,0])
  const original=rgba.slice()
  const model=voxelizeRGBA(rgba,2,2,{depth:3,pixelSize:.5})
  assert.equal(model.opaquePixels,2)
  assert.equal(model.voxels.length,6)
  assert.deepEqual(rgba,original)
  assert.equal(voxelSurface(model).faceCount,22)
  const solid=voxelizeRGBA(new Uint8Array([255,0,0,255,0,255,0,255]),2,1,{depth:2})
  assert.equal(voxelSurface(solid).faceCount,16)
  const blank=voxelizeRGBA(new Uint8Array(16),2,2)
  assert.equal(voxelSurface(blank).indices.length,0)
  assert.throws(()=>voxelizeRGBA(rgba,3,2),/Invalid/)
})

test('voxel geometry merges coloured samples into one indexed geometry with finite bounds',()=>{
  const model=voxelizeRGBA(new Uint8Array([255,80,20,255,20,160,255,255]),2,1,{depth:3,pixelSize:.2})
  const geometry=buildVoxelGeometry(model)
  assert.equal(geometry.userData.voxelCount,6)
  assert.equal(geometry.attributes.color.count,geometry.attributes.position.count)
  assert.equal(geometry.index.count,geometry.userData.faceCount*6)
  assert.ok(geometry.boundingBox.min.x<0 && geometry.boundingBox.max.x>0)
  assert.equal(geometry.boundingBox.min.y,0)
  assert.ok([...geometry.attributes.normal.array].every(Number.isFinite))
  geometry.dispose()
})

test('building factory uses repeated real module materials and exact original geometry instead of a single facade billboard',()=>{
  const factory=new YuLanAssetFactory()
  factory.assets={}
  const made=[]
  factory.material=part=>{made.push(part.key);return new THREE.MeshBasicMaterial({color:0xffffff})}
  const polygon=[[0,0],[30,0],[30,12],[12,12],[12,20],[0,20],[0,0]]
  const group=factory.createBuilding({polygon,levels:4,height_m:17.5},{type:21,model:2,moduleWidth:8})
  assert.ok(made.includes('house/21/21_2_0.png'))
  assert.ok(made.includes('house/21/21_2_1.png'))
  assert.ok(!made.includes('house/21/21_2_2.png'), 'The oblique roof image must no longer become a material')
  assert.equal(group.children.length,4)
  assert.ok(group.userData.moduleCount>20)
  assert.equal(group.userData.originalHeight,17.5)
  group.updateMatrixWorld(true)
  const bounds=new THREE.Box3().setFromObject(group)
  assert.ok(bounds.max.y>17.5, 'The unchanged wall height now supports solid roof details')
  const coreBounds=new THREE.Box3().setFromObject(group.children[0])
  assert.ok(Math.abs(coreBounds.min.x)<1e-5)
  assert.ok(Math.abs(coreBounds.max.x-30)<1e-5)
  assert.equal(group.userData.roofTextureApplied,false)
  group.traverse(item=>{item.geometry?.dispose();if(item.material)item.material.dispose()})
})

test('GeoJSON courtyards remain open in both roof and core and receive inward-facing repeated walls',()=>{
  const polygon=[[0,0],[20,0],[20,20],[0,20],[0,0]]
  // Test both winding orders; the caller's GeoJSON rings stay untouched.
  for(const hole of [[[6,6],[14,6],[14,14],[6,14],[6,6]],[[6,6],[6,14],[14,14],[14,6],[6,6]]]) {
    const building={polygon,holes:[hole],levels:3,height_m:12}
    const before=structuredClone(building)
    const layout=wallModules(polygon,{levels:3,height:12,moduleWidth:5,holes:[hole]})
    assert.deepEqual(wallModules(polygon,{holes:[]}),wallModules(polygon))
    const inner=layout.modules.filter(panel=>panel.hole===0)
    assert.equal(inner.filter(panel=>panel.level===0).reduce((sum,panel)=>sum+panel.width,0),32)
    assert.equal(inner.length,24)
    assert.ok(inner.every(panel=>panel.part==='floor'))
    const factory=new YuLanAssetFactory()
    factory.assets={}
    factory.material=()=>new THREE.MeshBasicMaterial({side:THREE.DoubleSide})
    const group=factory.createBuilding(building,{type:21,model:1,moduleWidth:5})
    group.updateMatrixWorld(true)
    const core=group.children[0],roof=group.getObjectByName('roof-slab')
    const downward=new THREE.Raycaster(new THREE.Vector3(10,30,-10),new THREE.Vector3(0,-1,0))
    assert.equal(downward.intersectObject(core,false).length,0)
    assert.equal(downward.intersectObject(roof,false).length,0)
    downward.ray.origin.set(3,30,-3)
    assert.ok(downward.intersectObject(core,false).length>0)
    assert.ok(downward.intersectObject(roof,false).length>0)
    const courtyard=new THREE.Raycaster(new THREE.Vector3(10,6,-10),new THREE.Vector3(1,0,0))
    const walls=group.children.find(child=>child.name==='yulan-floor-modules')
    assert.ok(Math.abs(courtyard.intersectObject(walls,false)[0].distance-4)<1e-5)
    const position=roof.geometry.attributes.position,index=roof.geometry.index
    let area=0
    for(let i=0;i<(index?.count || position.count);i+=3) {
      const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2
      if(Math.abs(position.getZ(a)-.42)<1e-5 && Math.abs(position.getZ(b)-.42)<1e-5 && Math.abs(position.getZ(c)-.42)<1e-5)
        area+=Math.abs((position.getX(b)-position.getX(a))*(position.getY(c)-position.getY(a))
          -(position.getY(b)-position.getY(a))*(position.getX(c)-position.getX(a)))/2
    }
    assert.equal(area,336)
    assert.deepEqual(building,before)
    group.traverse(item=>{item.geometry?.dispose();item.material?.dispose()})
  }
})

test('optional campus style leaves default meshes alone, restores visibility and never mutates map or graph',async()=>{
  const scene=new THREE.Scene(), first=new THREE.Mesh(), second=new THREE.Mesh()
  first.position.y=.18;second.visible=false
  const campus={buildings:[{osm_id:'a',polygon:[[0,0],[1,0],[1,1],[0,0]],height_m:3},{osm_id:'b',polygon:[[2,0],[3,0],[3,1],[2,0]],height_m:4}],walk_graph:{nodes:[{id:'n',x:0,y:0}],edges:[]}}
  const original=structuredClone(campus)
  const style=new YuLanCampusStyle({scene,campus,buildingMeshes:new Map([['a',first],['b',second]]),resolvePrototype:()=>({id:'building.yulan.house21',params:{atlasType:21}})})
  const factory={createBuilding:()=>new THREE.Group()}
  await style.init({factory})
  assert.equal(first.visible,true)
  assert.equal(second.visible,false)
  assert.equal(style.group.visible,false)
  style.setVisible(true)
  assert.equal(first.visible,false)
  style.setVisible(false)
  assert.equal(first.visible,true)
  assert.equal(second.visible,false)
  assert.deepEqual(campus,original)
  style.dispose()
  assert.equal(style.group.parent,null)
})

test('optional tree relief uses three shared catalog geometries and restores accepted trees across quality switches',async()=>{
  const scene=new THREE.Scene(),trees=new THREE.Group(),unrelated=new THREE.Group()
  const points=Array.from({length:10},(_,index)=>({x:index*10,y:index*3,angle:index*.1,scale:1}))
  const environment={quality:'high',trees,placements:{trees:points,lamps:[{x:0,y:0}],benches:[]},group:unrelated}
  const before=structuredClone(points),keys=[]
  const prototype={id:'vegetation.yulan.tree_group',category:'vegetation',style:'yulan',subtype:'tree_group',params:{decorationSet:'tree_group'},
    variants:YULAN_DECORATION_SETS.tree_group.map((atlasKey,index)=>({id:`v${index}`,params:{atlasKey}})),
    source:{type:'yulan',path:'assets/bgrd-*.png'},license:{spdx:'Apache-2.0',path:'YULAN_LICENSE'}}
  const factory={createDecoration:key=>{
    keys.push(key)
    const result=new THREE.Group()
    result.add(new THREE.Mesh(new THREE.BoxGeometry(2,7,1),new THREE.MeshBasicMaterial({color:0x00ff00})))
    return result
  }}
  const style=new YuLanCampusStyle({scene,campus:{buildings:[]},buildingMeshes:new Map(),environment,prototypes:[prototype]})
  await style.init({factory})
  assert.equal(trees.visible,true)
  assert.equal(unrelated.visible,true)
  const group=style.decorationGroups.get('trees')
  assert.equal(group.children.length,3)
  assert.equal(group.children.reduce((count,batch)=>count+batch.count,0),10)
  assert.deepEqual(keys,YULAN_DECORATION_SETS.tree_group)
  assert.equal(group.userData.assetPrototype,prototype.id)
  assert.equal(group.userData.license.spdx,'Apache-2.0')
  style.setVisible(true)
  assert.equal(trees.visible,false)
  assert.equal(group.visible,true)
  style.setQuality('low')
  assert.equal(trees.visible,false)
  assert.equal(group.visible,false)
  style.setVisible(false)
  assert.equal(trees.visible,false)
  style.setQuality('high')
  assert.equal(trees.visible,true)
  assert.equal(unrelated.visible,true)
  assert.deepEqual(points,before)
  style.dispose()

  environment.quality='low';trees.visible=false
  const initiallyLow=new YuLanCampusStyle({scene,campus:{buildings:[]},buildingMeshes:new Map(),environment,prototypes:[prototype]})
  await initiallyLow.init({factory})
  initiallyLow.setVisible(true)
  initiallyLow.setQuality('high')
  initiallyLow.setVisible(false)
  assert.equal(trees.visible,true)
  initiallyLow.dispose()
})
