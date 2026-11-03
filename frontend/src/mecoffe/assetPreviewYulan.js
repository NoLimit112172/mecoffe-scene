// Asset-browser factories own their previews independently of the campus.
import * as THREE from 'three'
import { registerPreviewFactory } from './AssetPreviewRenderer.js'
import { previewParams } from './assetPreviewModel.js'
import { YuLanAssetFactory,disposeYuLanObject } from './YuLanAssetFactory.js'

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
  removers.push(registerPreviewFactory('rocketbox-character',async(prototype,variant,{signal}={})=>{
    const {RealCharacterBatch,REAL_CHARACTER_HEIGHT,REAL_CHARACTER_RADIUS}=await import('./Campus3DRealCharacters.js')
    const cancelled=()=>Object.assign(new Error('Rocketbox preview request cancelled'),{name:'AbortError'})
    if(signal?.aborted)throw cancelled()
    if(disposed)throw new Error('Rocketbox preview session has ended')
    const p=previewParams(prototype,variant),scene=new THREE.Scene(),person={id:`rocketbox-preview-${p.model_id}`,role:'undergraduate_consumer'}
    const entry={person,figure:new THREE.Group(),walker:p.preview_pose==='idle'||p.preview_pose==='coffee'?null:{phase:'outbound',moving:true},presentationVisible:true,hasCoffee:p.preview_pose==='coffee'}
    const batch=new RealCharacterBatch({scene,entries:new Map([[person.id,entry]]),modelId:p.model_id})
    // Dispose before eager init settles: queued RealCharacterBatch tasks check
    // disposed/generation before starting their network request. In-flight
    // shared source leases are released normally when their load completes.
    const abort=()=>batch.dispose()
    signal?.addEventListener('abort',abort,{once:true})
    try {
      if(signal?.aborted){abort();throw cancelled()}
      await batch.init()
      if(signal?.aborted)throw cancelled()
      if(disposed){batch.dispose();throw new Error('Rocketbox preview session has ended')}
      const object=new THREE.Group();object.add(entry.figure,batch.group)
      return {object,bounds:new THREE.Box3(new THREE.Vector3(-REAL_CHARACTER_RADIUS,0,-REAL_CHARACTER_RADIUS),new THREE.Vector3(REAL_CHARACTER_RADIUS,REAL_CHARACTER_HEIGHT,REAL_CHARACTER_RADIUS)),
        setPreviewTransform:({scale,center})=>{entry.figure.scale.setScalar(scale);entry.figure.position.copy(center).multiplyScalar(-scale)},
        update:seconds=>batch.update(seconds),dispose:()=>batch.dispose(),caption:'Rocketbox 原始带骨骼人物 · MIT · 程序步态'}
    }catch(error){batch.dispose();throw error}
    finally {signal?.removeEventListener('abort',abort)}
  }))
  return ()=>{if(disposed)return;disposed=true;for(const remove of removers)remove();factory?.dispose()}
}
