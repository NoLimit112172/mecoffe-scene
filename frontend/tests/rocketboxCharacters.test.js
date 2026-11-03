import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { RealCharacterBatch } from '../src/mecoffe/Campus3DRealCharacters.js'
import { AssetPreviewRenderer } from '../src/mecoffe/AssetPreviewRenderer.js'
import { installYuLanPreviewFactories } from '../src/mecoffe/assetPreviewYulan.js'
import { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS, ROCKETBOX_MODELS, rocketboxModelForPerson,
  rocketboxTextureUrl, rocketboxLodNames, normalizeRocketboxBounds, rocketboxCharacterPose, rocketboxAssignments, rocketboxHumanModels } from '../src/mecoffe/rocketboxCharacterModel.js'

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

const turn=()=>new Promise(resolve=>setImmediate(resolve))
const inventory=(count=115)=>({models:Array.from({length:count},(_,i)=>({id:`human-${String(i).padStart(3,'0')}`,human:true,category:i<40?'adults':i<44?'children':'professions'}))})
function lazyEntries(count,visible=count) {
  const scene=new THREE.Scene(),entries=new Map()
  for(let i=0;i<count;i++){const entry=makeEntry(`agent-${i}`);entry.presentationVisible=i<visible;scene.add(entry.figure);entries.set(entry.person.id,entry)}
  return {scene,entries}
}

test('115-human manifest supports unique deterministic assignments and excludes animals',()=>{
  const manifest=inventory();manifest.models.push({id:'animal_dog',human:false,category:'animals'})
  const ids=rocketboxHumanModels(manifest).map(m=>m.id),people=Array.from({length:100},(_,i)=>({id:`source-${i}`,role:'consumer'}))
  const first=rocketboxAssignments(people,ids),second=rocketboxAssignments([...people].reverse(),[...ids].reverse())
  assert.equal(ids.length,115);assert.equal(new Set(first.values()).size,100)
  assert.deepEqual(first,second)
  assert.deepEqual(first,rocketboxAssignments(people.map(p=>({...p,role:'merchant'})),ids))
  const small=rocketboxAssignments(people,ids.slice(0,4)),counts=new Map()
  for(const id of small.values())counts.set(id,(counts.get(id)||0)+1)
  assert.deepEqual([...counts.values()],[25,25,25,25])
})

test('lazy batches load only visible identities, at most three globally, without per-frame duplicate promises',async()=>{
  const a=lazyEntries(100,4),b=lazyEntries(100,3),waiting=[],calls=[],shared=sourceModel('Male_Adult_14')
  let active=0,maximum=0
  const loader=id=>new Promise(resolve=>{calls.push(id);active++;maximum=Math.max(maximum,active);waiting.push(()=>{active--;resolve(shared)})})
  const first=new RealCharacterBatch(a),second=new RealCharacterBatch(b)
  await first.init({manifest:inventory(),loader,lazy:true});await second.init({manifest:inventory(),loader,lazy:true});await turn()
  assert.equal(calls.length,3);assert.equal(first.getStats().ready,0)
  for(let i=0;i<100;i++){first.update(i/60);second.update(i/60)}
  assert.equal(calls.length,3)
  for(let round=0;round<8&&(first.getStats().queued+first.getStats().loading+second.getStats().queued+second.getStats().loading);round++){waiting.splice(0).forEach(resolve=>resolve());await turn()}
  await Promise.all([first.whenIdle(),second.whenIdle()])
  assert.equal(maximum,3);assert.equal(calls.length,7);assert.equal(first.getStats().visibleReady,4);assert.equal(second.getStats().visibleReady,3)
  assert(first.isReady('agent-0'));assert(!first.isReady('agent-99'))
  assert.equal(first.getStats().available,115);assert.deepEqual(first.getStats().counts,{adults:40,children:4,professions:71})
  first.dispose();second.dispose()
})

test('undefined visibility does not cause a hundred-model startup fetch; new visibility schedules on demand',async()=>{
  const setup=lazyEntries(100,0);for(const entry of setup.entries.values())delete entry.presentationVisible
  let calls=0;const batch=new RealCharacterBatch(setup)
  await batch.init({manifest:inventory(),loader:async()=>{calls++;return sourceModel('Male_Adult_14')},lazy:true});await batch.whenIdle()
  assert.equal(calls,0)
  setup.entries.get('agent-12').presentationVisible=true;batch.update(2);await batch.whenIdle()
  assert.equal(calls,1);assert(batch.isReady('agent-12'));assert.equal(batch.getStats().visibleReady,1)
  batch.dispose()
})

test('failed fetch stays a visible fallback until explicit retry, then reaches ready without losing person state',async()=>{
  const setup=lazyEntries(1),events=[];let calls=0
  const batch=new RealCharacterBatch({...setup,onReady:event=>events.push(event.status)})
  const entry=setup.entries.get('agent-0');entry.walker={phase:'outbound',route:{node_ids:['a','b']}};entry.hasCoffee=true
  const before=JSON.stringify(entry.walker)
  await batch.init({manifest:inventory(),loader:async()=>{if(++calls===1)throw new Error('simulated connection loss');return sourceModel('Male_Adult_14')},lazy:true})
  await batch.whenIdle();assert.equal(batch.getStats().failed,1);assert.equal(batch.isReady(entry.person.id),false)
  for(let i=0;i<50;i++)batch.update(i);assert.equal(calls,1)
  await batch.retryFailed();assert.equal(calls,2);assert(batch.isReady(entry.person.id));assert.deepEqual(events,['failed','ready'])
  assert.equal(JSON.stringify(entry.walker),before);assert.equal(batch.actors[0].cup.visible,true)
  batch.dispose()
})

test('disposing during model loading never reattaches geometry or calls late readiness callbacks',async()=>{
  const setup=lazyEntries(1),events=[];let resolve
  const batch=new RealCharacterBatch({...setup,onReady:event=>events.push(event.status)})
  await batch.init({manifest:inventory(),loader:()=>new Promise(done=>{resolve=done}),lazy:true});await turn()
  batch.dispose();resolve(sourceModel('Male_Adult_14'));await turn();await turn()
  assert.equal(batch.group.parent,null);assert.equal(batch.group.children.length,0);assert.equal(batch.actors.length,0);assert.deepEqual(events,[])
})

test('pool switching invalidates pending old avatars but leaves agent, route and world transform untouched',async()=>{
  const setup=lazyEntries(1),entry=setup.entries.get('agent-0');entry.figure.position.set(10,2,30);entry.walker={phase:'return',route:{node_ids:['c','b','a']}}
  const snapshot=JSON.stringify({person:entry.person,walker:entry.walker,position:entry.figure.position.toArray()}),waiters=[]
  const batch=new RealCharacterBatch({...setup,pool:'adults'})
  await batch.init({manifest:inventory(),loader:id=>new Promise(resolve=>waiters.push({id,resolve})),lazy:true});await turn()
  const oldId=batch.assignments.get(entry.person.id);await batch.setPool('children');await turn()
  const newId=batch.assignments.get(entry.person.id);assert.notEqual(oldId,newId)
  waiters.forEach(item=>item.resolve(sourceModel('Male_Adult_14')));await batch.whenIdle()
  assert.equal(batch.actors.length,1);assert.equal(batch.actors[0].modelId,newId);assert.equal(batch.getStats().candidates,4)
  assert.equal(JSON.stringify({person:entry.person,walker:entry.walker,position:entry.figure.position.toArray()}),snapshot)
  await assert.rejects(batch.setPool('unknown'),/Unknown/);batch.dispose()
})

test('hidden avatars retain at most eight warm clones and are reconstructed when needed',async()=>{
  const setup=lazyEntries(15);let calls=0
  const batch=new RealCharacterBatch(setup)
  await batch.init({manifest:inventory(),loader:async()=>{calls++;return sourceModel('Male_Adult_14')},lazy:true});await batch.whenIdle()
  assert.equal(batch.actors.length,15)
  for(const entry of setup.entries.values())entry.presentationVisible=false
  batch.update(4);assert.equal(batch.actors.length,8);assert.equal(batch.readyIds.size,8)
  const evicted=[...setup.entries.values()].find(entry=>!batch.isReady(entry.person.id));evicted.presentationVisible=true;batch.update(5);await batch.whenIdle()
  assert(batch.isReady(evicted.person.id));assert.equal(calls,16);batch.dispose()
})

test('explicit catalog variant ignores pool and awaits exactly its one requested model',async()=>{
  const setup=lazyEntries(1),requested=inventory().models[50].id,calls=[]
  const batch=new RealCharacterBatch({...setup,modelId:requested,pool:'children'})
  await batch.init({manifest:inventory(),loader:async id=>{calls.push(id);return sourceModel('Male_Adult_14')},lazy:true})
  assert.deepEqual(calls,[requested]);assert.equal(batch.actors[0].modelId,requested);assert(batch.isReady('agent-0'))
  await batch.setPool('adults');assert.deepEqual(calls,[requested]);batch.dispose()
})

test('gallery pagination cancels queued real batches before their requests start and admits the new page',async t=>{
  // Use the production renderer lifecycle, registered Rocketbox factory and
  // actual global three-slot queue. Only network delivery is controlled here.
  const originalInit=RealCharacterBatch.prototype.init,waiting=[],calls=[],batches=[],errors=[],captions=[]
  const source=sourceModel('Male_Adult_14'),manifest=inventory()
  const loader=id=>new Promise(resolve=>{calls.push(id);waiting.push(()=>resolve(source))})
  t.mock.method(RealCharacterBatch.prototype,'init',function(options={}){
    batches.push(this)
    return originalInit.call(this,{...options,manifest,loader})
  })
  const removeFactories=installYuLanPreviewFactories(),renderer=Object.create(AssetPreviewRenderer.prototype)
  Object.assign(renderer,{items:[],views:new Map(),pending:new Map(),failed:new Set(),disposed:false,
    onError:(_id,message)=>errors.push(message),onCaption:id=>captions.push(id)})
  const item=index=>({prototype:{id:`character.${index}`,category:'character',params:{generator:'rocketbox-character',model_id:manifest.models[index].id}},variant:'default',
    element:{isConnected:true,addEventListener(){},removeEventListener(){}}})
  const oldItems=Array.from({length:6},(_,i)=>item(i)),newItems=[100,101,102].map(item),tasks=[]
  try {
    renderer.setItems(oldItems);tasks.push(...oldItems.map(value=>renderer.prepare(value)))
    for(let i=0;i<20&&batches.length<6;i++)await turn()
    assert.equal(batches.length,6);assert.deepEqual(calls,manifest.models.slice(0,3).map(model=>model.id))
    renderer.setItems(newItems)
    assert(batches.every(batch=>batch.disposed),'leaving the page disposes batches before their eager init resolves')
    assert.equal(renderer.pending.size,0)
    tasks.push(...newItems.map(value=>renderer.prepare(value)))
    for(let i=0;i<20&&batches.length<9;i++)await turn()
    assert.equal(batches.length,9);assert.equal(calls.length,3,'only the already-started old requests occupy the three slots')
    waiting.splice(0).forEach(resolve=>resolve())
    for(let i=0;i<20&&calls.length<6;i++)await turn()
    assert.deepEqual(calls,[...manifest.models.slice(0,3),...manifest.models.slice(100,103)].map(model=>model.id),
      'old-page models 3, 4 and 5 must never start network requests')
    waiting.splice(0).forEach(resolve=>resolve());await Promise.all(tasks)
    assert.equal(renderer.views.size,3);assert.deepEqual(errors,[]);assert.equal(renderer.failed.size,0)
    assert.deepEqual(new Set(captions),new Set(newItems.map(value=>value.prototype.id)))
    for(const batch of batches.slice(0,6)) {assert.equal(batch.actors.length,0);assert.equal(batch.group.parent,null)}
    assert(batches.slice(6).every(batch=>batch.actors.length===1))
  } finally {
    renderer.setItems([]);batches.forEach(batch=>batch.dispose());waiting.splice(0).forEach(resolve=>resolve())
    await Promise.allSettled(tasks);removeFactories()
  }
})

test('every installed standard human FBX supports canonical limbs and the same collision envelope',async()=>{
  const root=new URL('../public/mecoffe/assets3d/rocketbox/',import.meta.url)
  const ids=fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory()&&fs.existsSync(modelPath(item.name))).map(item=>item.name).sort()
  assert(ids.length>=4)
  const required=['L_Thigh','R_Thigh','L_Calf','R_Calf','L_UpperArm','R_UpperArm','L_Forearm','R_Forearm','L_Hand','R_Hand','Head'].map(name=>'Bip01_'+name)
  const v=new THREE.Vector3()
  for(const id of ids){
    const {batches}=await batchFor([id]),batch=batches[0],actor=batch.actors[0]
    assert.deepEqual(required.filter(name=>!actor.rig.bones.has(name)),[],id)
    actor.entry.walker={phase:'outbound',moving:true}
    for(let frame=0;frame<4;frame++){
      actor.entry.hasCoffee=frame>=2;batch.update(frame/4/1.55)
      actor.model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){
          mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld)
          assert(v.y>=-1e-5&&v.y<=REAL_CHARACTER_HEIGHT,`${id} vertex height ${v.y}`)
          assert(Math.hypot(v.x,v.z)<=REAL_CHARACTER_RADIUS,`${id} vertex radius`)
        }
      })
      if(actor.cup.visible){const box=new THREE.Box3().setFromObject(actor.cup,true);assert(Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z)))<=REAL_CHARACTER_RADIUS,`${id} cup radius`)}
    }
    batch.dispose()
  }
})
