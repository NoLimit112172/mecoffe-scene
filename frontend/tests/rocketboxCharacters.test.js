import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { RealCharacterBatch } from '../src/mecoffe/Campus3DRealCharacters.js'
import { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS, ROCKETBOX_MODELS, rocketboxModelForPerson,
  rocketboxTextureUrl, rocketboxLodNames, normalizeRocketboxBounds, rocketboxCharacterPose } from '../src/mecoffe/rocketboxCharacterModel.js'

const makeEntry = id => ({person:{id,role:'undergraduate_consumer'},figure:new THREE.Group(),walker:null,hasCoffee:false})
const modelPath = id => new URL(`../public/mecoffe/assets3d/rocketbox/${id}/${id}.fbx`,import.meta.url)
const parsed = new Map()
function sourceModel(id) {
  if(parsed.has(id))return parsed.get(id)
  // Texture bytes have separate provenance/hash checks. Node tests exercise the
  // exact real skinned geometry; image decoding belongs to browser QA.
  class FakeTextureLoader extends THREE.TextureLoader { load(url){const texture=new THREE.Texture();texture.userData.source=url;return texture} }
  const manager=new THREE.LoadingManager();manager.addHandler(/\.tga$/i,new FakeTextureLoader(manager))
  const bytes=fs.readFileSync(modelPath(id)),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  const source=new FBXLoader(manager).parse(buffer,'');parsed.set(id,source);return source
}
async function batchFor(ids=ROCKETBOX_MODELS) {
  const scene=new THREE.Scene(),entries=new Map(ids.map((id,index)=>[id,makeEntry(`person-${index}`)])),assets=new Map(ids.map(id=>[id,sourceModel(id)]))
  const batches=[]
  for(const [index,id]of ids.entries()) {const entry=entries.get(id);scene.add(entry.figure);const batch=new RealCharacterBatch({scene,entries:new Map([[entry.person.id,entry]]),modelId:id});await batch.init({assets});batches.push(batch)}
  return {scene,entries,batches}
}

test('real avatar mapping is stable, visual-only and validates explicit variants',()=>{
  const person={id:'original-agent-17',role:'teacher_consumer',profile:{untouched:true}},copy=JSON.stringify(person)
  assert.equal(rocketboxModelForPerson(person),rocketboxModelForPerson({...person,role:'merchant'}))
  assert.equal(rocketboxModelForPerson(person,'Male_Adult_14'),'Male_Adult_14')
  assert.equal(JSON.stringify(person),copy)
  assert.equal(new Set(Array.from({length:100},(_,i)=>rocketboxModelForPerson({id:`p${i}`}))).size,4)
  assert.throws(()=>rocketboxModelForPerson(person,'unknown'),/Unknown/)
})

test('FBX texture paths rewrite only recorded PNGs, LOD selects lowest available',()=>{
  const model={textures:[{source_name:'f001_body_color.tga',path:'Female_Adult_01/Textures/f001_body_color.png'}]}
  assert.equal(rocketboxTextureUrl('C:\\Export\\Textures\\f001_body_color.tga',model,'/demo/'),'/demo/Female_Adult_01/Textures/f001_body_color.png')
  assert.equal(rocketboxTextureUrl('/Textures/f001_body_normal.tga',model),null)
  assert.equal(rocketboxTextureUrl('/model.fbx',model),'/model.fbx')
  assert.deepEqual(rocketboxLodNames(['body_LOD0','body_LOD2','hair_LOD2','eyes']),['body_LOD2','hair_LOD2','eyes'])
  assert.deepEqual(rocketboxLodNames(['single-real-skinned-mesh']),['single-real-skinned-mesh'])
})

test('normalization reserves height and radius; absolute pose freezes at equal seconds',()=>{
  const fit=normalizeRocketboxBounds({min:[-100,-2,-70],max:[100,180,70]})
  assert(fit.scale[1]*182<=REAL_CHARACTER_HEIGHT)
  assert(Math.hypot(100,70)*fit.scale[0]<REAL_CHARACTER_RADIUS)
  assert.throws(()=>normalizeRocketboxBounds({min:[0,0,0],max:[1,0,1]}),/Invalid/)
  assert.deepEqual(rocketboxCharacterPose(4,.2,true,true),rocketboxCharacterPose(4,.2,true,true))
  assert.notDeepEqual(rocketboxCharacterPose(4,.2,true,true),rocketboxCharacterPose(4.2,.2,true,true))
  assert.equal(rocketboxCharacterPose(4,.2,false,false).leftLeg,0)
})

test('all four pinned FBXs have independently cloned full-volume skinned bodies and meshes shared from source',async()=>{
  const {batches}=await batchFor()
  for(const [index,batch]of batches.entries()){
    const actor=batch.actors[0],source=sourceModel(ROCKETBOX_MODELS[index]),meshes=[];actor.model.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o)})
    assert.equal(meshes.length,1)
    assert.equal(meshes[0].skeleton.bones.length,80)
    const original=source.getObjectByName(meshes[0].name)
    assert.equal(meshes[0].geometry,original.geometry)
    assert.notEqual(meshes[0].skeleton.bones[0],original.skeleton.bones[0])
    assert.equal(actor.root.userData.person,actor.entry.person)
    const bounds=new THREE.Box3().setFromObject(actor.model,true),size=bounds.getSize(new THREE.Vector3())
    assert(size.y>8.2&&size.y<=8.5,`${actor.modelId}: ${size.toArray()}`);assert(size.z>.5&&size.x>1)
    batch.dispose()
  }
})

test('world root transforms, stopped walking, coffee and visibility remain owned by existing entries',async()=>{
  const {batches,entries}=await batchFor(['Female_Adult_01']),batch=batches[0],entry=entries.values().next().value,actor=batch.actors[0]
  entry.figure.position.set(50,2,-20);entry.figure.rotation.y=1.2;entry.figure.scale.setScalar(1.7)
  entry.walker={phase:'outbound',moving:true,route:{node_ids:['a','b']}};entry.hasCoffee=true
  const route=JSON.stringify(entry.walker.route)
  batch.update(3);entry.figure.updateWorldMatrix(true,false)
  assert.deepEqual(actor.root.matrixWorld.toArray(),entry.figure.matrixWorld.toArray())
  assert.equal(actor.cup.visible,true)
  const before=actor.rig.rest.map(r=>r.bone.quaternion.toArray());batch.update(3)
  assert.deepEqual(actor.rig.rest.map(r=>r.bone.quaternion.toArray()),before)
  entry.walker.moving=false;batch.update(4)
  const stoppedLeg=actor.rig.bones.get('Bip01_L_Thigh').quaternion.toArray();batch.update(4.5)
  assert.deepEqual(actor.rig.bones.get('Bip01_L_Thigh').quaternion.toArray(),stoppedLeg)
  assert.equal(JSON.stringify(entry.walker.route),route)
  entry.presentationVisible=false;batch.update(5);assert.equal(actor.root.visible,false)
  batch.setVisible(false);assert.equal(batch.group.visible,false)
  batch.setQuality('low');actor.model.traverse(o=>{if(o.isMesh)assert.equal(o.castShadow,false)})
  batch.dispose();assert.equal(batch.group.parent,null)
})

test('real deformed vertices stay inside shared collision envelope through walking and coffee poses',async()=>{
  const {batches}=await batchFor()
  const vertex=new THREE.Vector3()
  for(const batch of batches){
    const actor=batch.actors[0];actor.entry.walker={phase:'outbound',moving:true}
    let minY=Infinity,maxY=-Infinity,maxRadius=0
    for(let step=0;step<48;step++){
      actor.entry.hasCoffee=step>=24;batch.update(step/48/1.55)
      actor.model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);maxRadius=Math.max(maxRadius,Math.hypot(vertex.x,vertex.z))}
      })
      if(actor.cup.visible){const box=new THREE.Box3().setFromObject(actor.cup,true);maxRadius=Math.max(maxRadius,Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z))))}
    }
    assert(minY>=-1e-5,`${actor.modelId} sole y=${minY}`)
    assert(maxY<=REAL_CHARACTER_HEIGHT,`${actor.modelId} height=${maxY}`)
    assert(maxRadius<=REAL_CHARACTER_RADIUS,`${actor.modelId} radius=${maxRadius}`)
    batch.dispose()
  }
})

test('disposing a batch releases skeletons and owned cups but preserves injected shared model resources',async()=>{
  const {batches}=await batchFor(['Male_Adult_14']),batch=batches[0],source=sourceModel('Male_Adult_14')
  let geometryDisposals=0,skeletonDisposals=0
  source.traverse(o=>{if(o.geometry)o.geometry.addEventListener('dispose',()=>geometryDisposals++)})
  batch.actors[0].model.traverse(o=>{if(o.isSkinnedMesh){const original=o.skeleton.dispose.bind(o.skeleton);o.skeleton.dispose=()=>{skeletonDisposals++;original()}}})
  batch.dispose();batch.dispose()
  assert.equal(geometryDisposals,0);assert.equal(skeletonDisposals,1)
})
