// Installed only by the asset browser. The default campus does not preload
// atlas-derived buildings or voxel character geometry through this module.
import * as THREE from 'three'
import { registerPreviewFactory } from './AssetPreviewRenderer.js'
import { previewParams } from './assetPreviewModel.js'
import { YuLanAssetFactory,disposeYuLanObject } from './YuLanAssetFactory.js'
import { VoxelCharacterBatch } from './Campus3DVoxelCharacters.js'
import { YuLanCharacterBatch, YULAN_CHARACTER_HEIGHT, YULAN_CHARACTER_RADIUS } from './Campus3DYuLanCharacters.js'

export function installYuLanPreviewFactories() {
  let factory=null,disposed=false
  const getFactory=async()=>{
    if(disposed)throw new Error('YuLan preview session has ended')
    if(!factory)factory=new YuLanAssetFactory()
    await factory.init()
    if(disposed)throw new Error('YuLan preview session has ended')
    return factory
  }
  const createAsset=async(prototype,variant)=>{
    const generator=await getFactory()
    const object=await generator.create(prototype,{...previewParams(prototype,variant),variant})
    return {object,dispose:()=>disposeYuLanObject(object),caption:prototype.category==='building'?'YuLan 原立面 + 程序三维屋顶':'YuLan 原图集 · RGBA 体素与合并表面'}
  }
  const removers=[registerPreviewFactory('yulan-building',createAsset),registerPreviewFactory('yulan-decoration',createAsset)]
  removers.push(registerPreviewFactory('rocketbox-character',async(prototype,variant)=>{
    const {RealCharacterBatch,REAL_CHARACTER_HEIGHT,REAL_CHARACTER_RADIUS}=await import('./Campus3DRealCharacters.js')
    const p=previewParams(prototype,variant),scene=new THREE.Scene(),person={id:`rocketbox-preview-${p.model_id}`,role:'undergraduate_consumer'}
    const entry={person,figure:new THREE.Group(),walker:{phase:'outbound',moving:true},presentationVisible:true,hasCoffee:false}
    const batch=new RealCharacterBatch({scene,entries:new Map([[person.id,entry]]),modelId:p.model_id})
    try {
      await batch.init()
      if(disposed){batch.dispose();throw new Error('Rocketbox preview session has ended')}
      const object=new THREE.Group();object.add(entry.figure,batch.group)
      return {object,bounds:new THREE.Box3(new THREE.Vector3(-REAL_CHARACTER_RADIUS,0,-REAL_CHARACTER_RADIUS),new THREE.Vector3(REAL_CHARACTER_RADIUS,REAL_CHARACTER_HEIGHT,REAL_CHARACTER_RADIUS)),
        setPreviewTransform:({scale,center})=>{entry.figure.scale.setScalar(scale);entry.figure.position.copy(center).multiplyScalar(-scale)},
        update:seconds=>batch.update(seconds),dispose:()=>batch.dispose(),caption:'Rocketbox 原始带骨骼人物 · MIT · 程序步态'}
    }catch(error){batch.dispose();throw error}
  }))
  removers.push(registerPreviewFactory('yulan3d-character',async(prototype,variant)=>{
    const p=previewParams(prototype,variant),scene=new THREE.Scene()
    const role=p.role || 'undergraduate_consumer'
    const knownId={undergraduate_consumer:'undergraduate_consumer_003',graduate_consumer:'graduate_consumer_001',teacher_consumer:'teacher_consumer_001',merchant:'merchant_001'}[role]
    const person={id:p.person_id || knownId || `yulan3d-preview-${role}`,role,...(p.gender?{gender:p.gender}:{})}
    const entry={person,figure:new THREE.Group(),walker:{phase:'outbound'},presentationVisible:true,hasCoffee:false}
    const batch=new YuLanCharacterBatch({scene,entries:new Map([[person.id,entry]])})
    try {
      const source=await getFactory()
      await batch.init({assets:source.assets})
      if(disposed){batch.dispose();throw new Error('YuLan preview session has ended')}
      const object=new THREE.Group();object.add(entry.figure,batch.group)
      return {object,bounds:new THREE.Box3(new THREE.Vector3(-YULAN_CHARACTER_RADIUS,0,-YULAN_CHARACTER_RADIUS),new THREE.Vector3(YULAN_CHARACTER_RADIUS,YULAN_CHARACTER_HEIGHT,YULAN_CHARACTER_RADIUS)),
        setPreviewTransform:({scale,center})=>{entry.figure.scale.setScalar(scale);entry.figure.position.copy(center).multiplyScalar(-scale)},
        update:seconds=>batch.update(seconds),dispose:()=>batch.dispose(),caption:'YuLan 原配色与五官 · 封闭立体头身 · 分关节动画'}
    } catch(error){batch.dispose();throw error}
  }))
  removers.push(registerPreviewFactory('voxel-character',async(prototype,variant)=>{
    const p=previewParams(prototype,variant),scene=new THREE.Scene()
    const role=p.role || 'undergraduate_consumer'
    const knownId={undergraduate_consumer:'undergraduate_consumer_003',graduate_consumer:'graduate_consumer_001',teacher_consumer:'teacher_consumer_001',merchant:'merchant_001'}[role]
    const person={id:p.person_id || knownId || `voxel-preview-${role}`,role,...(p.gender?{gender:p.gender}:{})}
    const entry={person,figure:new THREE.Group(),walker:{phase:'outbound'},presentationVisible:true,hasCoffee:false}
    const batch=new VoxelCharacterBatch({scene,entries:new Map([[person.id,entry]]),resolution:p.resolution || 40,depth:p.depth || 2})
    try {
      await batch.init()
      if(disposed){batch.dispose();throw new Error('YuLan preview session has ended')}
      const object=new THREE.Group();object.add(entry.figure,batch.group)
      return {object,bounds:new THREE.Box3(new THREE.Vector3(-2.3,0,-1.3),new THREE.Vector3(2.3,8.5,1.3)),
        setPreviewTransform:({scale,center})=>{entry.figure.scale.setScalar(scale);entry.figure.position.copy(center).multiplyScalar(-scale)},
        update:seconds=>batch.update(seconds),dispose:()=>batch.dispose(),caption:'YuLan 三帧人物 · RGBA 厚度体素'}
    } catch(error){batch.dispose();throw error}
  }))
  return ()=>{if(disposed)return;disposed=true;for(const remove of removers)remove();factory?.dispose()}
}
