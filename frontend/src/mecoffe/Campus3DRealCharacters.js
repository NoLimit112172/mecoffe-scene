import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS, ROCKETBOX_MODELS, rocketboxAssignments, rocketboxHumanModels, rocketboxHash,
  rocketboxTextureUrl, rocketboxLodNames, normalizeRocketboxBounds, rocketboxCharacterPose } from './rocketboxCharacterModel.js'

export { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS } from './rocketboxCharacterModel.js'

const BASE = `${import.meta.env?.BASE_URL || '/'}mecoffe/assets3d/rocketbox/`
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=='
const sources = new Map()
const loadQueue = []
let activeLoads = 0
let manifestPromise
const slots = ['map','alphaMap','normalMap','bumpMap','specularMap','emissiveMap','aoMap','roughnessMap','metalnessMap']

function disposeSource(source) {
  const geometries = new Set(), materials = new Set(), textures = new Set()
  source.traverse(object => { if (object.geometry) geometries.add(object.geometry); for (const material of [object.material].flat().filter(Boolean)) { materials.add(material); for (const slot of slots) if (material[slot]) textures.add(material[slot]) } })
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

async function loadSource(record) {
  const manager = new THREE.LoadingManager(), failures = []
  let ready
  const settled = new Promise(resolve => { ready = resolve })
  manager.onLoad = ready
  manager.onError = url => failures.push(url)
  manager.setURLModifier(url => rocketboxTextureUrl(url, record, BASE) ?? BLANK)
  // FBX chooses handlers from the ORIGINAL extension, before URL rewriting.
  manager.addHandler(/\.tga$/i, new THREE.TextureLoader(manager))
  const source = await new FBXLoader(manager).loadAsync(`${BASE}${record.fbx}`)
  await settled
  if (failures.length) { disposeSource(source); throw new Error(`Rocketbox texture failed: ${failures.join(', ')}`) }
  repairMaterials(source)
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
function loadManifest() {
  if (!manifestPromise) manifestPromise = fetch(`${BASE}manifest.json`).then(response => {
    if (!response.ok) throw new Error(`Rocketbox manifest: HTTP ${response.status}`)
    return response.json()
  }).catch(error => { manifestPromise = null; throw error })
  return manifestPromise
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

function rigFor(model) {
  const bones = new Map(), rest = []
  model.traverse(bone => { if (bone.isBone) { bones.set(bone.name.replace(/\s/g,'_').replace(/^Bip\d+_/,'Bip01_'),bone); rest.push({bone,quaternion:bone.quaternion.clone(),position:bone.position.clone()}) } })
  return { model, bones, rest, world: new THREE.Quaternion(), parent: new THREE.Quaternion(), delta: new THREE.Quaternion(), from: new THREE.Vector3(), to: new THREE.Vector3(), origin: new THREE.Vector3() }
}

function aim(rig, name, childName, direction) {
  const bone = rig.bones.get(name), child = rig.bones.get(childName)
  if (!bone || !child) return
  bone.updateWorldMatrix(true,false)
  bone.getWorldPosition(rig.origin); child.getWorldPosition(rig.from); rig.from.sub(rig.origin).normalize()
  rig.to.set(...direction).normalize().transformDirection(rig.model.matrixWorld)
  rig.delta.setFromUnitVectors(rig.from,rig.to)
  bone.getWorldQuaternion(rig.world); rig.world.premultiply(rig.delta)
  bone.parent.getWorldQuaternion(rig.parent); bone.quaternion.copy(rig.parent.invert().multiply(rig.world))
  bone.updateWorldMatrix(false,false)
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
    aim(rig,`${prefix}UpperArm`,`${prefix}Forearm`,[sign*.10,-Math.cos(arm),Math.sin(arm)])
    aim(rig,`${prefix}Forearm`,`${prefix}Hand`,[sign*.06,-Math.cos(arm+elbow),Math.sin(arm+elbow)])
  }
  const head=rig.bones.get('Bip01_Head')
  if(head)head.rotateX(pose.headTilt)
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
  constructor({scene,entries,modelId,pool='all',onReady}={}) {
    if(!scene||!entries)throw new Error('RealCharacterBatch requires a scene and entries')
    this.scene=scene;this.entries=entries;this.modelId=modelId;this.pool=pool;this.onReady=onReady
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
      this.manifest=manifest||assets?.manifest||((assets||loader)?{models:(suppliedIds.length?suppliedIds:ROCKETBOX_MODELS).map(id=>({id,human:true,category:'adults'}))}:await loadManifest())
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
    const candidates=this.modelId||this.pool==='all'?humans:humans.filter(model=>model.category===this.pool)
    if(!candidates.length)throw new Error(`No Rocketbox avatars in pool ${this.pool}`)
    this.available=humans.length;this.candidateCount=candidates.length
    this.modelRecords=new Map(humans.map(model=>[model.id,model]))
    this.assignments=rocketboxAssignments([...this.entries.values()].map(entry=>entry.person),candidates.map(model=>model.id),this.modelId)
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
    actor.model.traverse(object=>{if(object.isMesh){object.castShadow=this.quality==='high';object.receiveShadow=true;object.frustumCulled=false;object.userData.person=entry.person}})
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

  update(seconds=0) {
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
      const walking=Boolean(entry.walker&&entry.walker.phase!=='dwell'&&entry.walker.moving!==false)
      const poseKey=`${seconds}:${walking}:${Boolean(entry.hasCoffee)}`
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
    if(!['all','adults','children','professions'].includes(pool))throw new Error(`Unknown Rocketbox pool: ${pool}`)
    if(this.disposed||pool===this.pool||this.modelId)return this
    if(!rocketboxHumanModels(this.manifest).some(model=>pool==='all'||model.category===pool))throw new Error(`No Rocketbox avatars in pool ${pool}`)
    this.generation++;for(const record of this.records.values())this.releaseRecord(record)
    this.pool=pool;this.configureRecords();this.onReady?.({status:'reset',pool});this.update(this.lastSeconds);return this
  }
  setVisible(value){this.group.visible=Boolean(value);if(value)this.update(this.lastSeconds);else this.evictHidden()}
  setQuality(value){this.quality=value==='low'?'low':'high';this.group.traverse(object=>{if(object.isMesh)object.castShadow=this.quality==='high'})}
  dispose(){
    if(this.disposed)return
    this.disposed=true;this.generation++;this.group.removeFromParent()
    for(const record of this.records.values())this.releaseRecord(record)
    for(const resource of this.resources)resource.dispose()
    this.resources.length=0;this.actors.length=0;this.readyIds.clear();this.group.clear()
  }
}
