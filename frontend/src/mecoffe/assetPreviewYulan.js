// Installed only by the asset browser. The default campus does not preload
// atlas-derived buildings or voxel character geometry through this module.
import * as THREE from 'three'
import { registerPreviewFactory } from './AssetPreviewRenderer.js'
import { previewParams } from './assetPreviewModel.js'
import { YuLanAssetFactory,disposeYuLanObject } from './YuLanAssetFactory.js'
import { VoxelCharacterBatch } from './Campus3DVoxelCharacters.js'

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
    return {object,dispose:()=>disposeYuLanObject(object),caption:prototype.category==='building'?'YuLan 原图集 · 模块化墙层与屋顶':'YuLan 原图集 · RGBA 体素与合并表面'}
  }
  const removers=[registerPreviewFactory('yulan-building',createAsset),registerPreviewFactory('yulan-decoration',createAsset)]
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
