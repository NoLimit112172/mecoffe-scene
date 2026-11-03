import {characterLodGeometry,consolidateMaterialGroups} from './renderPerformance.js'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { campusAssignments } from './campusCharacterModel.js'
import { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS, ROCKETBOX_MODELS, rocketboxAssignments, rocketboxHumanModels, rocketboxHash,
  rocketboxTextureUrl, rocketboxLodNames, normalizeRocketboxBounds, rocketboxCharacterPose } from './rocketboxCharacterModel.js'

export { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS } from './rocketboxCharacterModel.js'

const BASE = `${import.meta.env?.BASE_URL || '/'}mecoffe/assets3d/rocketbox/`
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=='
const sources = new Map()
const characterLods=new WeakMap()
const loadQueue = []
let activeLoads = 0
const manifestPromises=new Map()
const slots = ['map','alphaMap','normalMap','bumpMap','specularMap','emissiveMap','aoMap','roughnessMap','metalnessMap']

function disposeSource(source) {
  const geometries = new Set(), materials = new Set(), textures = new Set()
  source.traverse(object => { if (object.geometry) geometries.add(object.geometry); if(characterLods.has(object.geometry))geometries.add(characterLods.get(object.geometry)); for (const material of [object.material].flat().filter(Boolean)) { materials.add(material); for (const slot of slots) if (material[slot]) textures.add(material[slot]) } })
  for (const resource of [...geometries,...materials,...textures]) resource.dispose()
}

function repairMaterials(source) {
  const replacements = new Map(), discarded = new Set()
  source.traverse(object => {
    if (!object.isMesh) return
    object.frustumCulled = false
    const convert = old => {
      if (replacements.has(old)) return replacements.get(old)
      const hair = /opacity|hair|lash/i.test(old.name)
      if (old.map) { old.map.colorSpace = THREE.SRGBColorSpace; old.map.anisotropy = 4 }
      const material = new THREE.MeshStandardMaterial({ name: old.name, color: 0xffffff, map: old.map || null,
        roughness: .88, metalness: 0, alphaTest: hair ? .38 : 0, side: hair ? THREE.DoubleSide : THREE.FrontSide })
      for (const slot of slots) if (slot !== 'map' && old[slot] && old[slot] !== old.map) discarded.add(old[slot])
      replacements.set(old,material); old.dispose(); return material
    }
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material)
  })
  for (const texture of discarded) texture.dispose()
}

export function canonicalizeValidSkeleton(source) {
  source.updateMatrixWorld(true)
  const canonical=new Map(),duplicates=[]
  source.traverse(bone=>{if(!bone.isBone)return;if(canonical.has(bone.name)){
    const first=canonical.get(bone.name)
    if(bone.matrixWorld.elements.some((v,i)=>Math.abs(v-first.matrixWorld.elements[i])>1e-5))throw new Error(`VALID 重名骨骼姿态不一致：${bone.name}`)
    duplicates.push(bone)
  }else canonical.set(bone.name,bone)})
  const parents=[...canonical.values()].map(bone=>{
    let parent=bone.parent;while(parent?.isBone&&parent.name===bone.name)parent=parent.parent
    return {bone,parent:parent?.isBone?canonical.get(parent.name):parent}
  })
  for(const {bone,parent}of parents)if(parent&&bone.parent!==parent)parent.attach(bone)
  source.traverse(mesh=>{if(!mesh.isSkinnedMesh)return
    const old=mesh.skeleton
    mesh.skeleton=new THREE.Skeleton(old.bones.map(b=>canonical.get(b.name)),old.boneInverses.map(m=>m.clone()))
    old.dispose()
  })
  for(const bone of duplicates)bone.removeFromParent()
  source.updateMatrixWorld(true)
  return source
}

async function loadSource(record) {
  const base=record.runtime_base||BASE
  const manager = new THREE.LoadingManager(), failures = [],embedded=new Set()
  let ready
  const settled = new Promise(resolve => { ready = resolve })
  manager.onLoad = ready
  manager.onError = url => failures.push(url)
  manager.setURLModifier(url => {if(url.startsWith('blob:'))embedded.add(url);return rocketboxTextureUrl(url, record, base) ?? BLANK})
  // FBX chooses handlers from the ORIGINAL extension, before URL rewriting.
  manager.addHandler(/\.tga$/i, new THREE.TextureLoader(manager))
  const source = await new FBXLoader(manager).loadAsync(`${base}${record.fbx}`)
  await settled
  for(const url of embedded)URL.revokeObjectURL(url)
  if (failures.length) { disposeSource(source); throw new Error(`Rocketbox texture failed: ${failures.join(', ')}`) }
  repairMaterials(source)
  if(record.ethnicity==='Asian'){
    // VALID also bundles dense internal teeth/glands and authoring lights.
    // Outdoor campus avatars keep the body and both eyes; mouth interiors
    // are unnecessary for this replay and would triple skinning work.
    const removed=[]
    source.traverse(o=>{if(o.isLight||o.isMesh&&/teeth|gland/i.test(o.name))removed.push(o)})
    for(const o of removed){o.removeFromParent();o.geometry?.dispose()}
    canonicalizeValidSkeleton(source)
    source.traverse(o=>{if(o.isMesh){const old=o.geometry;o.geometry=mergeVertices(old);old.dispose();characterLods.set(o.geometry,consolidateMaterialGroups(characterLodGeometry(o.geometry)))}})
  }
  source.traverse(object=>{if(object.isMesh&&Array.isArray(object.material))consolidateMaterialGroups(object.geometry)})
  const meshes = []; source.traverse(object => { if (object.isMesh) meshes.push(object) })
  const keep = new Set(rocketboxLodNames(meshes.map(mesh => mesh.name)))
  for (const mesh of meshes) if (!keep.has(mesh.name)) mesh.removeFromParent()
  source.userData.rocketboxModelId = record.id
  return source
}

function queueLoad(work) {
  return new Promise((resolve,reject) => { loadQueue.push({work,resolve,reject}); drainLoads() })
}
function drainLoads() {
  while (activeLoads < 3 && loadQueue.length) {
    const task = loadQueue.shift(); activeLoads++
    Promise.resolve().then(task.work).then(task.resolve,task.reject).finally(() => { activeLoads--; drainLoads() })
  }
}
function loadManifest(library='rocketbox') {
  const base=library==='valid'?`${import.meta.env?.BASE_URL||'/'}mecoffe/assets3d/valid/`:BASE
  if (!manifestPromises.has(library)) manifestPromises.set(library,fetch(`${base}manifest.json`).then(response => {
    if (!response.ok) throw new Error(`Rocketbox manifest: HTTP ${response.status}`)
    return response.json()
  }).catch(error => { manifestPromises.delete(library); throw error }))
  return manifestPromises.get(library)
}

async function acquireModel(id, loader, record) {
  if (loader) return { source: await loader(id), release() {} }
  if (!record) throw new Error(`Rocketbox manifest is missing ${id}`)
  let cached = sources.get(id)
  if (!cached) { cached = { refs: 0, promise: loadSource(record) }; sources.set(id,cached); cached.promise.catch(() => { if (sources.get(id) === cached) sources.delete(id) }) }
  cached.refs++
  try {
    const source = await cached.promise
    return { source, release() { if (--cached.refs === 0 && sources.get(id) === cached) { sources.delete(id); disposeSource(source) } } }
  } catch (error) { cached.refs--; throw error }
}

const VALID_BONES={Hips:'Bip01_Pelvis',Head:'Bip01_Head',LeftUpLeg:'Bip01_L_Thigh',RightUpLeg:'Bip01_R_Thigh',LeftLeg:'Bip01_L_Calf',RightLeg:'Bip01_R_Calf',LeftFoot:'Bip01_L_Foot',RightFoot:'Bip01_R_Foot',LeftToeBase:'Bip01_L_Toe0',RightToeBase:'Bip01_R_Toe0',LeftArm:'Bip01_L_UpperArm',RightArm:'Bip01_R_UpperArm',LeftForeArm:'Bip01_L_Forearm',RightForeArm:'Bip01_R_Forearm',LeftHand:'Bip01_L_Hand',RightHand:'Bip01_R_Hand'}
const boneKey=name=>VALID_BONES[name]||name.replace(/\s/g,'_').replace(/^Bip\d+_/,'Bip01_')
function rigFor(model) {
  const bones=new Map(),boneSets=new Map(),rest=[],used=new Set()
  model.traverse(o=>{if(o.isSkinnedMesh)for(const b of o.skeleton.bones){used.add(b);for(let p=b.parent;p?.isBone;p=p.parent)used.add(p)}})
  model.traverse(bone => { if (bone.isBone&&used.has(bone)) {const key=boneKey(bone.name);if(!bones.has(key))bones.set(key,bone);if(!boneSets.has(key))boneSets.set(key,[]);boneSets.get(key).push(bone);rest.push({bone,quaternion:bone.quaternion.clone(),position:bone.position.clone()}) } })
  model.updateWorldMatrix(true,true)
  const armSigns={}
  for(const side of ['L','R']){const b=bones.get(`Bip01_${side}_UpperArm`);if(b){const p=model.worldToLocal(b.getWorldPosition(new THREE.Vector3()));armSigns[side]=Math.sign(p.x)|| (side==='L'?-1:1)}}
  return { model, bones, boneSets, rest, armSigns, world: new THREE.Quaternion(), parent: new THREE.Quaternion(), delta: new THREE.Quaternion(), from: new THREE.Vector3(), to: new THREE.Vector3(), origin: new THREE.Vector3() }
}

function aim(rig, name, childName, direction) {
  for(const bone of rig.boneSets.get(name)||[]){
  const child=bone.children.find(c=>boneKey(c.name)===childName)
  if (!child) continue
  bone.updateWorldMatrix(true,false)
  bone.getWorldPosition(rig.origin); child.getWorldPosition(rig.from); rig.from.sub(rig.origin).normalize()
  rig.to.set(...direction).normalize().transformDirection(rig.model.matrixWorld)
  rig.delta.setFromUnitVectors(rig.from,rig.to)
  bone.getWorldQuaternion(rig.world); rig.world.premultiply(rig.delta)
  bone.parent.getWorldQuaternion(rig.parent); bone.quaternion.copy(rig.parent.invert().multiply(rig.world))
  bone.updateWorldMatrix(false,false)
  }
}

function applyPose(rig, pose) {
  for (const rest of rig.rest) { rest.bone.quaternion.copy(rest.quaternion); rest.bone.position.copy(rest.position) }
  rig.model.updateWorldMatrix(true,true)
  for (const [side,sign] of [['L',-1],['R',1]]) {
    const key = side === 'L' ? 'left' : 'right', prefix = `Bip01_${side}_`
    const leg=pose[`${key}Leg`], knee=pose[`${key}Knee`], arm=pose[`${key}Arm`], elbow=pose[`${key}Elbow`]
    aim(rig,`${prefix}Thigh`,`${prefix}Calf`,[0,-Math.cos(leg),Math.sin(leg)])
    aim(rig,`${prefix}Calf`,`${prefix}Foot`,[0,-Math.cos(leg-knee),Math.sin(leg-knee)])
    aim(rig,`${prefix}Foot`,`${prefix}Toe0`,[0,0,1])
    const outward=rig.armSigns[side]||sign
    aim(rig,`${prefix}UpperArm`,`${prefix}Forearm`,[outward*.14,-Math.cos(arm),Math.sin(arm)])
    aim(rig,`${prefix}Forearm`,`${prefix}Hand`,[outward*.08,-Math.cos(arm+elbow),Math.sin(arm+elbow)])
  }
  for(const head of rig.boneSets.get('Bip01_Head')||[])head.rotateX(pose.headTilt)
  rig.model.updateWorldMatrix(true,true)
  // SkinnedMesh overrides updateMatrixWorld (not updateWorldMatrix) to refresh
  // bindMatrixInverse. Calling it prevents normalization being applied twice.
  rig.model.updateMatrixWorld(true)
  rig.model.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.update()})
}

function normalizedModel(source, cachedNormalization) {
  const model=cloneSkeleton(source),rig=rigFor(model)
  applyPose(rig,rocketboxCharacterPose(0,0,false,false))
  const box=cachedNormalization?null:new THREE.Box3().setFromObject(model,true)
  const normalization=cachedNormalization||normalizeRocketboxBounds({min:box.min.toArray(),max:box.max.toArray()})
  const pivot=new THREE.Group(),scale=new THREE.Group()
  model.position.add(new THREE.Vector3(...normalization.offset));scale.scale.set(...normalization.scale)
  scale.add(model);pivot.add(scale)
  // A six-millimetre sole allowance covers skin-weight blending at a straight
  // knee; the whole posed figure still stays within the allocated 8.5m height.
  pivot.position.y=.006
  return {pivot,model,rig,normalization}
}

export class RealCharacterBatch {
  constructor({scene,entries,modelId,pool='all',library,onReady}={}) {
    if(!scene||!entries)throw new Error('RealCharacterBatch requires a scene and entries')
    this.scene=scene;this.entries=entries;this.modelId=modelId;this.pool=pool;this.onReady=onReady
    this.library=library||(pool==='campus'?'valid':'rocketbox')
    this.group=new THREE.Group();this.group.name='mecoffe-rocketbox-real-characters'
    this.actors=[];this.resources=[];this.records=new Map();this.readyIds=new Set();this.pending=new Set()
    this.normalizations=new Map();this.quality='high';this.disposed=false;this.initialized=false
    this.generation=0;this.epoch=0;this.lastSeconds=0;this.inverse=new THREE.Matrix4();this.actorMatrix=new THREE.Matrix4();this.cupPosition=new THREE.Vector3()
  }

  async init(options={}) {
    if(this.disposed||this.initialized)return this
    if(!this.promise)this.promise=this.initialize(options)
    return this.promise
  }

  async initialize({assets,loader,manifest,modelId=this.modelId,lazy=false}) {
    try {
      this.modelId=modelId;this.loader=loader;this.provided=assets?.models||assets
      const suppliedIds=this.provided instanceof Map?[...this.provided.keys()]:Object.keys(this.provided||{})
      this.injectedSources=Boolean(manifest||assets||loader)
      this.manifest=manifest||assets?.manifest||((assets||loader)?{models:(suppliedIds.length?suppliedIds:ROCKETBOX_MODELS).map(id=>({id,human:true,category:'adults'}))}:await loadManifest(this.library))
      if(this.disposed)return this
      this.eager=Boolean(modelId||((assets||loader)&&!lazy));this.strictVisibility=!this.eager
      this.cupGeometry=new THREE.CylinderGeometry(.20,.16,.44,12);this.lidGeometry=new THREE.CylinderGeometry(.22,.22,.06,12)
      this.cupMaterial=new THREE.MeshStandardMaterial({color:'#fff5df',roughness:.8});this.lidMaterial=new THREE.MeshStandardMaterial({color:'#3c3028',roughness:.8})
      this.resources.push(this.cupGeometry,this.lidGeometry,this.cupMaterial,this.lidMaterial)
      this.configureRecords();this.scene.add(this.group);this.initialized=true
      if(this.eager){for(const record of this.records.values())this.request(record,true);await this.whenIdle();const failed=[...this.records.values()].find(r=>r.state==='failed');if(failed)throw failed.error}
      this.update(0);return this
    }catch(error){this.dispose();throw error}
  }

  configureRecords() {
    const humans=rocketboxHumanModels(this.manifest)
    this.counts=humans.reduce((counts,model)=>{const category=model.category||'adults';counts[category]=(counts[category]||0)+1;return counts},{})
    const candidates=this.modelId||['all','campus'].includes(this.pool)?humans:humans.filter(model=>model.category===this.pool)
    if(!candidates.length)throw new Error(`No Rocketbox avatars in pool ${this.pool}`)
    this.available=humans.length;this.candidateCount=candidates.length
    this.modelRecords=new Map(humans.map(model=>[model.id,{...model,runtime_base:model.runtime_base||this.manifest.runtime_base}]))
    const people=[...this.entries.values()].map(entry=>entry.person)
    this.assignments=this.pool==='campus'&&!this.modelId?campusAssignments(people,candidates):rocketboxAssignments(people,candidates.map(model=>model.id),this.modelId)
    this.records=new Map([...this.entries.values()].map(entry=>[String(entry.person.id),{entry,modelId:this.assignments.get(String(entry.person.id)),state:'idle',lastUsed:0}]))
  }

  wanted(record) {
    const entry=record.entry
    return this.group.visible&&entry.figure.visible!==false&&entry.inView!==false&&(this.strictVisibility?entry.presentationVisible===true:entry.presentationVisible!==false)
  }

  buildActor(record,source) {
    const {entry,modelId}=record,actor=normalizedModel(source,this.normalizations.get(modelId)),root=new THREE.Group()
    this.normalizations.set(modelId,actor.normalization)
    root.name=`rocketbox-${entry.person.id}`;root.matrixAutoUpdate=false;root.userData={person:entry.person,modelId,displayAvatar:true}
    const cup=new THREE.Group(),body=new THREE.Mesh(this.cupGeometry,this.cupMaterial),lid=new THREE.Mesh(this.lidGeometry,this.lidMaterial)
    lid.position.y=.25;cup.add(body,lid);cup.visible=false;cup.name='held-coffee'
    root.add(actor.pivot,cup);this.group.add(root)
    actor.model.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=true;object.frustumCulled=false;object.userData.person=entry.person;object.userData.bloomOcclusion=false;object.userData.fullGeometry=object.geometry}})
    return {...actor,entry,root,cup,modelId,phase:(rocketboxHash(entry.person.id)%1024)/1024*Math.PI*2}
  }

  request(record,force=false) {
    if(this.disposed||record.state!=='idle')return
    const generation=this.generation
    record.state='queued'
    const task=queueLoad(async()=>{
      if(this.disposed||generation!==this.generation)return
      if(!force&&!this.wanted(record)){record.state='idle';return}
      record.state='loading';let lease
      try {
        const source=this.provided instanceof Map?this.provided.get(record.modelId):this.provided?.[record.modelId]
        lease=source?{source,release(){}}:await acquireModel(record.modelId,this.loader,this.modelRecords.get(record.modelId))
        if(this.disposed||generation!==this.generation){lease.release();return}
        if(!force&&!this.wanted(record)){
          lease.release();record.state='idle';this.onReady?.({entry:record.entry,status:'discarded'});return
        }
        record.actor=this.buildActor(record,lease.source);record.lease=lease;record.state='ready';record.lastUsed=this.epoch
        this.actors.push(record.actor);this.readyIds.add(String(record.entry.person.id));this.update(this.lastSeconds)
        this.onReady?.({entry:record.entry,modelId:record.modelId,status:'ready'})
      }catch(error){
        if(lease&&!record.lease)lease.release()
        if(this.disposed||generation!==this.generation)return
        record.error=error;record.state='failed';this.onReady?.({entry:record.entry,modelId:record.modelId,status:'failed',error})
      }
    })
    this.pending.add(task);task.finally(()=>this.pending.delete(task))
  }

  releaseRecord(record) {
    if(record.actor){record.actor.root.removeFromParent();record.actor.model.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.dispose()});this.actors=this.actors.filter(actor=>actor!==record.actor)}
    record.lease?.release();record.lease=null;record.actor=null;record.state='idle';this.readyIds.delete(String(record.entry.person.id))
  }

  evictHidden() {
    // Retain a small warm set. Exploring all 115 cards/agents must not leave all
    // high-resolution textures resident after they disappear from the scene.
    // Camera-only culling must not evict the current roster representatives:
    // portrait -> overview would otherwise refetch/reclone most of the campus.
    // Only identities removed by selection/replay consume the eight warm slots.
    const hidden=[...this.records.values()].filter(record=>record.actor&&(!this.group.visible||record.entry.presentationVisible===false)).sort((a,b)=>b.lastUsed-a.lastUsed)
    for(const record of hidden.slice(8))this.releaseRecord(record)
  }

  update(seconds=0,camera=null,viewportHeight=800) {
    this.lastSeconds=seconds
    if(this.disposed||!this.initialized||!this.group.visible)return
    this.epoch++;this.group.updateWorldMatrix(true,false);this.inverse.copy(this.group.matrixWorld).invert()
    for(const record of this.records.values()){
      if(this.wanted(record)){record.lastUsed=this.epoch;this.request(record)}
      const actor=record.actor;if(!actor)continue
      const {entry,root,rig,cup}=actor;root.visible=this.wanted(record)
      if(!root.visible)continue
      entry.figure.updateWorldMatrix(true,false);this.actorMatrix.multiplyMatrices(this.inverse,entry.figure.matrixWorld)
      const transformChanged=!root.matrix.equals(this.actorMatrix)
      if(transformChanged){root.matrix.copy(this.actorMatrix);root.matrixWorldNeedsUpdate=true}
      const walking=Boolean(entry.walker&&entry.walker.phase!=='dwell'&&entry.walker.phase!=='planning'&&entry.walker.moving!==false)
      const pixels=camera ? REAL_CHARACTER_HEIGHT*entry.figure.scale.y*viewportHeight/(2*Math.tan(camera.fov*Math.PI/360)*Math.max(1,camera.position.distanceTo(entry.figure.position))) : 100
      const close=pixels>65
      // Portrait/full and distant indexed LOD share the same rig/materials.
      actor.model.traverse(o=>{if(!o.isMesh)return;const full=o.userData.fullGeometry,lod=characterLods.get(full);o.geometry=(!close&&lod)||full||o.geometry})
      const tick=Math.floor(seconds*(walking?20:4))
      const poseKey=`${tick}:${walking}:${Boolean(entry.hasCoffee)}`
      const poseChanged=actor.poseKey!==poseKey
      if(poseChanged){applyPose(rig,rocketboxCharacterPose(seconds,actor.phase,walking,Boolean(entry.hasCoffee)));actor.poseKey=poseKey}
      else if(transformChanged)rig.model.updateMatrixWorld(true)
      cup.visible=Boolean(entry.hasCoffee)
      if(cup.visible&&(poseChanged||transformChanged)){const hand=rig.bones.get('Bip01_R_Hand');if(hand){hand.getWorldPosition(this.cupPosition);root.worldToLocal(this.cupPosition);cup.position.copy(this.cupPosition);cup.position.y+=.10;cup.position.z+=.12}else cup.position.set(.85,4.4,.8)}
    }
    if(!this.eager)this.evictHidden()
  }

  isReady(personId){return this.readyIds.has(String(personId))}
  getStats(){
    const result={total:this.records.size,ready:0,loading:0,queued:0,failed:0,visibleTotal:0,visibleReady:0,available:this.available||0,candidates:this.candidateCount||0,counts:{...this.counts},pool:this.pool}
    for(const record of this.records.values()){if(record.state in result)result[record.state]++;if(this.wanted(record)){result.visibleTotal++;if(record.state==='ready')result.visibleReady++}}
    return result
  }
  async whenIdle(){while(!this.disposed&&this.pending.size)await Promise.allSettled([...this.pending]);return this.getStats()}
  retryFailed(){for(const record of this.records.values())if(record.state==='failed'){record.state='idle';record.error=null}this.update(this.lastSeconds);return this.whenIdle()}
  async setPool(pool){
    if(!['all','adults','children','professions','campus'].includes(pool))throw new Error(`Unknown Rocketbox pool: ${pool}`)
    if(this.disposed||pool===this.pool||this.modelId)return this
    const library=pool==='campus'?'valid':'rocketbox'
    const manifest=!this.injectedSources&&library!==this.library?await loadManifest(library):this.manifest
    if(!rocketboxHumanModels(manifest).some(model=>['all','campus'].includes(pool)||model.category===pool))throw new Error(`No Rocketbox avatars in pool ${pool}`)
    this.generation++;for(const record of this.records.values())this.releaseRecord(record)
    this.library=library;this.manifest=manifest;this.pool=pool;this.configureRecords();this.onReady?.({status:'reset',pool});this.update(this.lastSeconds);return this
  }
  setVisible(value){this.group.visible=Boolean(value);if(value)this.update(this.lastSeconds);else this.evictHidden()}
  setQuality(value){this.quality=value==='low'?'low':'high';this.group.traverse(object=>{if(object.isMesh)object.castShadow=false})}
  dispose(){
    if(this.disposed)return
    this.disposed=true;this.generation++;this.group.removeFromParent()
    for(const record of this.records.values())this.releaseRecord(record)
    for(const resource of this.resources)resource.dispose()
    this.resources.length=0;this.actors.length=0;this.readyIds.clear();this.group.clear()
  }
}
