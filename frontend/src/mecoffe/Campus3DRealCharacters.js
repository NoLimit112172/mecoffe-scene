import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS, rocketboxModelForPerson, rocketboxHash,
  rocketboxTextureUrl, rocketboxLodNames, normalizeRocketboxBounds, rocketboxCharacterPose } from './rocketboxCharacterModel.js'

export { REAL_CHARACTER_HEIGHT, REAL_CHARACTER_RADIUS } from './rocketboxCharacterModel.js'

const BASE = `${import.meta.env?.BASE_URL || '/'}mecoffe/assets3d/rocketbox/`
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=='
const sources = new Map()
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

async function acquireModel(id, loader) {
  if (loader) return { source: await loader(id), release() {} }
  if (!manifestPromise) manifestPromise = fetch(`${BASE}manifest.json`).then(response => {
    if (!response.ok) throw new Error(`Rocketbox manifest: HTTP ${response.status}`)
    return response.json()
  }).catch(error => { manifestPromise = null; throw error })
  const manifest = await manifestPromise, record = manifest.models.find(model => model.id === id)
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
  model.traverse(bone => { if (bone.isBone) { bones.set(bone.name.replace(/\s/g,'_'),bone); rest.push({bone,quaternion:bone.quaternion.clone(),position:bone.position.clone()}) } })
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
  constructor({scene,entries,modelId}={}) {
    if(!scene||!entries)throw new Error('RealCharacterBatch requires a scene and entries')
    this.scene=scene;this.entries=entries;this.modelId=modelId
    this.group=new THREE.Group();this.group.name='mecoffe-rocketbox-real-characters'
    this.actors=[];this.resources=[];this.leases=[];this.quality='high';this.disposed=false;this.initialized=false
    this.inverse=new THREE.Matrix4();this.cupPosition=new THREE.Vector3()
  }

  async init({assets,loader,modelId=this.modelId}={}) {
    if(this.disposed||this.initialized)return this
    if(this.promise)return this.promise
    this.promise=this.initialize({assets,loader,modelId})
    return this.promise
  }

  async initialize({assets,loader,modelId}) {
    try {
      const entries=[...this.entries.values()].sort((a,b)=>String(a.person.id).localeCompare(String(b.person.id)))
      const ids=[...new Set(entries.map(entry=>rocketboxModelForPerson(entry.person,modelId)))],models=new Map()
      const provided=assets?.models || assets
      for(const id of ids){
        const source=provided instanceof Map?provided.get(id):provided?.[id]
        const lease=source?{source,release(){}}:await acquireModel(id,loader)
        if(this.disposed){lease.release();return this}
        this.leases.push(lease);models.set(id,lease.source)
      }
      const cupGeometry=new THREE.CylinderGeometry(.20,.16,.44,12),lidGeometry=new THREE.CylinderGeometry(.22,.22,.06,12)
      const cupMaterial=new THREE.MeshStandardMaterial({color:'#fff5df',roughness:.8}),lidMaterial=new THREE.MeshStandardMaterial({color:'#3c3028',roughness:.8})
      this.resources.push(cupGeometry,lidGeometry,cupMaterial,lidMaterial)
      const normalizations=new Map()
      for(const entry of entries){
        const id=rocketboxModelForPerson(entry.person,modelId),actor=normalizedModel(models.get(id),normalizations.get(id)),root=new THREE.Group()
        normalizations.set(id,actor.normalization)
        root.name=`rocketbox-${entry.person.id}`;root.matrixAutoUpdate=false;root.userData={person:entry.person,modelId:id,displayAvatar:true}
        const cup=new THREE.Group(),body=new THREE.Mesh(cupGeometry,cupMaterial),lid=new THREE.Mesh(lidGeometry,lidMaterial)
        lid.position.y=.25;cup.add(body,lid);cup.visible=false;cup.name='held-coffee'
        root.add(actor.pivot,cup);this.group.add(root)
        actor.model.traverse(object=>{if(object.isMesh){object.castShadow=this.quality==='high';object.receiveShadow=true;object.frustumCulled=false;object.userData.person=entry.person}})
        this.actors.push({...actor,entry,root,cup,modelId:id,phase:(rocketboxHash(entry.person.id)%1024)/1024*Math.PI*2})
      }
      this.scene.add(this.group);this.initialized=true;this.update(0);return this
    }catch(error){this.dispose();throw error}
  }

  update(seconds=0) {
    if(this.disposed||!this.initialized||!this.group.visible)return
    this.group.updateWorldMatrix(true,false);this.inverse.copy(this.group.matrixWorld).invert()
    for(const actor of this.actors){
      const {entry,root,rig,cup}=actor
      root.visible=entry.presentationVisible!==false&&entry.figure.visible!==false
      if(!root.visible)continue
      entry.figure.updateWorldMatrix(true,false);root.matrix.multiplyMatrices(this.inverse,entry.figure.matrixWorld);root.matrixWorldNeedsUpdate=true
      const walking=Boolean(entry.walker&&entry.walker.phase!=='dwell'&&entry.walker.moving!==false)
      const pose=rocketboxCharacterPose(seconds,actor.phase,walking,Boolean(entry.hasCoffee))
      applyPose(rig,pose)
      cup.visible=pose.coffee
      if(cup.visible){const hand=rig.bones.get('Bip01_R_Hand');if(hand){hand.getWorldPosition(this.cupPosition);root.worldToLocal(this.cupPosition);cup.position.copy(this.cupPosition);cup.position.y+=.10;cup.position.z+=.12}else cup.position.set(.85,4.4,.8)}
    }
  }

  setVisible(value){this.group.visible=Boolean(value)}
  setQuality(value){this.quality=value==='low'?'low':'high';this.group.traverse(object=>{if(object.isMesh)object.castShadow=this.quality==='high'})}
  dispose(){
    if(this.disposed)return
    this.disposed=true;this.group.removeFromParent()
    for(const actor of this.actors)actor.model.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.dispose()})
    for(const resource of this.resources)resource.dispose()
    for(const lease of this.leases)lease.release()
    this.resources.length=0;this.leases.length=0;this.actors.length=0;this.group.clear()
  }
}
