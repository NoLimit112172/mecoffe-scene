import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {indexPixelAtlases,pixelFigureLayout} from '../src/mecoffe/campus3dPixelModel.js'
import {VoxelCharacterBatch,voxelAppearanceKey,voxelCharacterFrameModels,composeVoxelCharacterRGBA} from '../src/mecoffe/Campus3DVoxelCharacters.js'

const atlas=indexPixelAtlases([0,1,2].map(i=>JSON.parse(readFileSync(new URL(`../public/assets/bgrd-${i}.json`,import.meta.url),'utf8'))))
function rasters(){return [0,1,2].map(i=>({width:2,height:2,data:new Uint8ClampedArray([220,120+i*20,80,255,0,0,0,0,30,50,80,255,50,90,130,255])}))}

test('voxel frames preserve occupied RGBA samples, exclude transparent pixels and have fixed display height',()=>{
 const models=voxelCharacterFrameModels(rasters(),{depth:2})
 assert.equal(models.length,3)
 for(const model of models){assert.equal(model.opaquePixels,3);assert.equal(model.voxels.length,6);assert.equal(model.pixelSize*model.height,8.5)}
 assert.notDeepEqual(models[0].voxels,models[1].voxels)
})

test('appearance cache keys retain exact 2D head/body parts and bounded voxel resolution',()=>{
 const a=pixelFigureLayout({id:'undergraduate_consumer_003',role:'undergraduate_consumer'},atlas)
 assert.match(voxelAppearanceKey(a),/^character\/m\/5_4\|f:7,e:17,m:21,h:11\|40\|2$/)
 assert.notEqual(voxelAppearanceKey(a,{resolution:48,depth:3}),voxelAppearanceKey(a))
})

test('composition draws the same body and layered head order at no more than 48 sampled rows',()=>{
 const old=globalThis.document,draws=[]
 globalThis.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>({imageSmoothingEnabled:true,save(){},restore(){},translate(){},rotate(){},scale(){},drawImage(image,...args){draws.push({image,args})},getImageData(){return{data:new Uint8ClampedArray(canvas.width*canvas.height*4)}}});return canvas}}
 try {
  const layout=pixelFigureLayout({id:'teacher_consumer_001',role:'teacher_consumer'},atlas)
  const images=[{sheet:0},{sheet:1},{sheet:2}]
  const frames=composeVoxelCharacterRGBA(layout,{atlas,images},500)
  assert.ok(frames.every(frame=>frame.height===48&&frame.width===24))
  assert.equal(draws.length,3*(1+layout.headLayers.length))
  assert.equal(draws[0].image,images[layout.bodies[0].sheet])
  assert.equal(draws[1].image,images[layout.headLayers[0].frame.sheet])
 } finally {if(old===undefined)delete globalThis.document;else globalThis.document=old}
})

test('voxel actor freezes frames, follows route yaw, keeps cups and never changes source transforms',async()=>{
 const scene=new THREE.Scene(),figure=new THREE.Group();figure.position.set(23,.35,-56);figure.rotation.y=Math.PI/2;figure.scale.setScalar(2);scene.add(figure)
 const person={id:'undergraduate_consumer_003',role:'undergraduate_consumer'}
 const entry={person,figure,walker:{phase:'outbound',points:[{x:23,y:56}]},presentationVisible:true,hasCoffee:false}
 const position=figure.position.clone(),quaternion=figure.quaternion.clone(),scale=figure.scale.clone(),route=JSON.stringify(entry.walker.points)
 const batch=await new VoxelCharacterBatch({scene,entries:new Map([[person.id,entry]]),resolution:500,depth:100}).init({assets:{atlas,images:[]},rasterize:rasters})
 assert.equal(batch.resolution,48);assert.equal(batch.depth,3)
 const actor=batch.actors.get(person.id)
 batch.update(0);batch.update(.1)
 assert.equal(actor.frame,1);assert.equal(actor.mesh.geometry.userData.voxelCount,9)
 const matrix=actor.root.matrix.clone();batch.update(.1);assert.deepEqual(actor.root.matrix,matrix)
 actor.root.updateWorldMatrix(true,false)
 const rotation=new THREE.Quaternion();actor.root.getWorldQuaternion(rotation);assert.ok(rotation.angleTo(figure.quaternion)<1e-8)
 entry.walker.phase='dwell';entry.hasCoffee=true;batch.update(.2)
 assert.equal(actor.frame,0);assert.equal(actor.cup.visible,true)
 entry.walker.phase='return';batch.update(.3);assert.equal(actor.cup.visible,true)
 entry.presentationVisible=false;batch.update(.3);assert.equal(actor.root.visible,false)
 batch.setVisible(false);assert.equal(batch.group.visible,false)
 batch.setVisible(true);batch.setQuality('low');assert.equal(actor.mesh.castShadow,false)
 assert.deepEqual(figure.position,position);assert.deepEqual(figure.quaternion.toArray(),quaternion.toArray());assert.deepEqual(figure.scale,scale);assert.equal(JSON.stringify(entry.walker.points),route)
 let disposed=0;const geometries=[...batch.cache.values()].flatMap(item=>item.frames);for(const geometry of geometries)geometry.addEventListener('dispose',()=>disposed++)
 batch.dispose();batch.dispose();assert.equal(disposed,geometries.length);assert.equal(batch.actors.size,0);assert.equal(scene.children.includes(batch.group),false)
})

test('equal original appearance recipes share merged frame geometry instead of duplicating it',async()=>{
 const scene=new THREE.Scene(),entries=new Map()
 for(const id of ['a','b'])entries.set(id,{person:{id:'same-source-person',role:'teacher_consumer'},figure:new THREE.Group()})
 let compositions=0
 const batch=await new VoxelCharacterBatch({scene,entries}).init({assets:{atlas,images:[]},rasterize:()=>{compositions++;return rasters()}})
 assert.equal(compositions,1);assert.equal(batch.cache.size,1)
 batch.dispose()
})
