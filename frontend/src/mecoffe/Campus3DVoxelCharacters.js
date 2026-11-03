// YuLan's composed body/head frames, sampled into shallow 3D voxel surfaces.
// The simulation owns every actor transform; this batch only reads it.
import * as THREE from 'three'
import { atlasFrameDraw, pixelFigureLayout, pixelFrameIndex } from './campus3dPixelModel.js'
import { loadYuLanAssets, buildVoxelGeometry } from './YuLanAssetFactory.js'
import { voxelizeRGBA } from './yulanAssetModel.js'
import { CHARACTER_ROLE_COLORS } from './Campus3DCharacters.js'

export const VOXEL_CHARACTER_HEIGHT = 8.5

function drawFrame(context, assets, frame, x = 0, y = 0) {
  const draw=atlasFrameDraw(frame,x,y)
  context.save();context.translate(...draw.translate)
  if(draw.rotation)context.rotate(draw.rotation)
  context.drawImage(assets.images[frame.sheet],...draw.source,...draw.destination)
  context.restore()
}

/** Preserve the 2D head/body recipe, then nearest-sample at a bounded height. */
export function composeVoxelCharacterRGBA(layout,assets,resolution=40) {
  const height=Math.max(16,Math.min(48,Math.round(resolution)))
  const factor=height/layout.bounds.height,width=Math.max(1,Math.round(layout.bounds.width*factor))
  return layout.bodies.map(body=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d',{willReadFrequently:true})
    context.imageSmoothingEnabled=false
    context.scale(factor,factor);context.translate(-layout.bounds.x,-layout.bounds.y)
    drawFrame(context,assets,body)
    for(const layer of layout.headLayers)drawFrame(context,assets,layer.frame,layer.x,layer.y)
    const rgba=context.getImageData(0,0,width,height)
    return {data:rgba.data,width,height}
  })
}

/** Cache keys encode original atlas parts, not a synthetic role-only avatar. */
export function voxelAppearanceKey(layout,{resolution=40,depth=2}={}) {
  return `${layout.appearance.animation}|${Object.entries(layout.appearance.head).map(([part,index])=>`${part}:${index}`).join(',')}|${resolution}|${depth}`
}

export function voxelCharacterFrameModels(rasters,{depth=2,height=VOXEL_CHARACTER_HEIGHT}={}) {
  if(!Array.isArray(rasters)||!rasters.length)throw new Error('Voxel characters require body/head RGBA frames')
  return rasters.map(raster=>voxelizeRGBA(raster.data,raster.width,raster.height,
    {pixelSize:height/raster.height,depth,alphaThreshold:64}))
}

export class VoxelCharacterBatch {
  constructor({scene,entries,resolution=40,depth=2}={}) {
    if(!scene||!entries)throw new Error('VoxelCharacterBatch requires the existing scene and entries')
    this.scene=scene;this.entries=entries
    this.resolution=Math.max(16,Math.min(48,Math.round(Number(resolution)||40)))
    this.depth=Math.max(1,Math.min(3,Math.round(Number(depth)||2)))
    this.group=new THREE.Group();this.group.name='mecoffe-yulan-voxel-characters'
    this.actors=new Map();this.cache=new Map();this.materials=new Set();this.quality='high';this.disposed=false
    this.inverseBatch=new THREE.Matrix4()
    this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,flatShading:true})
    this.materials.add(this.material)
    this.markerGeometry=new THREE.CircleGeometry(1.25,16)
    this.cupGeometry=new THREE.CylinderGeometry(.35,.27,.86,8)
    this.lidGeometry=new THREE.CylinderGeometry(.38,.38,.12,8)
    this.cupMaterial=new THREE.MeshStandardMaterial({color:'#fff0d5',roughness:.8})
    this.lidMaterial=new THREE.MeshStandardMaterial({color:'#5e483d',roughness:.8})
    this.materials.add(this.cupMaterial);this.materials.add(this.lidMaterial)
    this.roleMaterials=new Map()
  }

  async init({assets,rasterize=composeVoxelCharacterRGBA}={}) {
    if(this.initialized||this.disposed)return this
    const loaded=assets||await loadYuLanAssets()
    try {
      if(this.disposed)return this
      let count=0
      for(const entry of this.entries.values()) {
        if(this.disposed)break
        const layout=pixelFigureLayout(entry.person,loaded.atlas)
        const key=voxelAppearanceKey(layout,{resolution:this.resolution,depth:this.depth})
        if(!this.cache.has(key)) {
          const rasters=rasterize(layout,loaded,this.resolution)
          const models=voxelCharacterFrameModels(rasters,{depth:this.depth})
          const frames=models.map(buildVoxelGeometry)
          this.cache.set(key,{frames,appearance:layout.appearance,statistics:frames.map(frame=>({...frame.userData}))})
        }
        const cached=this.cache.get(key)
        const root=new THREE.Group();root.matrixAutoUpdate=false
        root.name=`voxel-person-${entry.person.id}`
        root.userData={person:entry.person,source:'YuLan atlas body + identical 2D head composition',license:'Apache-2.0'}
        const mesh=new THREE.Mesh(cached.frames[0],this.material)
        mesh.castShadow=this.quality==='high';mesh.receiveShadow=false
        mesh.userData.voxelCharacter=true
        root.add(mesh)
        let roleMaterial=this.roleMaterials.get(entry.person.role)
        if(!roleMaterial) {
          roleMaterial=new THREE.MeshBasicMaterial({color:CHARACTER_ROLE_COLORS[entry.person.role]||'#397fca',transparent:true,opacity:.88,side:THREE.DoubleSide,depthWrite:false})
          this.roleMaterials.set(entry.person.role,roleMaterial);this.materials.add(roleMaterial)
        }
        const marker=new THREE.Mesh(this.markerGeometry,roleMaterial);marker.rotation.x=-Math.PI/2;marker.position.y=.09;root.add(marker)
        const cup=new THREE.Group()
        const body=new THREE.Mesh(this.cupGeometry,this.cupMaterial);cup.add(body)
        const lid=new THREE.Mesh(this.lidGeometry,this.lidMaterial);lid.position.y=.49;cup.add(lid)
        cup.position.set(1.25,3.4,.7);cup.visible=false;root.add(cup)
        this.group.add(root)
        this.actors.set(entry.person.id,{entry,layout,cached,root,mesh,marker,cup,frame:0,walking:false,startedAt:0,lastSeconds:0})
        count++
        // Avoid blocking the UI while adapting a large roster for the first time.
        if(count%8===0&&typeof window!=='undefined')await new Promise(resolve=>setTimeout(resolve,0))
      }
      if(!this.disposed){this.scene.add(this.group);this.initialized=true;this.update(0)}
      return this
    } catch(error) {this.dispose();throw error}
    finally {if(!assets)for(const image of loaded.images)image.close?.()}
  }

  update(seconds=0) {
    if(this.disposed||!this.group.visible)return
    this.group.updateWorldMatrix(true,false)
    this.inverseBatch.copy(this.group.matrixWorld).invert()
    for(const actor of this.actors.values()) {
      const {entry}=actor
      const visible=entry.presentationVisible!==false&&entry.figure.visible!==false
      actor.root.visible=visible
      if(!visible)continue
      entry.figure.updateWorldMatrix(true,false)
      actor.root.matrix.multiplyMatrices(this.inverseBatch,entry.figure.matrixWorld)
      actor.root.matrixWorldNeedsUpdate=true
      const walking=Boolean(entry.walker&&entry.walker.phase!=='dwell')
      if(walking&&(!actor.walking||seconds<actor.lastSeconds))actor.startedAt=seconds
      const frame=pixelFrameIndex(seconds-actor.startedAt,walking,actor.cached.frames.length)
      if(frame!==actor.frame){actor.mesh.geometry=actor.cached.frames[frame];actor.frame=frame}
      actor.cup.visible=Boolean(entry.hasCoffee||entry.walker?.phase==='return')
      actor.walking=walking;actor.lastSeconds=seconds
    }
  }

  setVisible(visible){this.group.visible=Boolean(visible)}
  setQuality(quality){this.quality=quality==='low'?'low':'high';for(const actor of this.actors.values())actor.mesh.castShadow=this.quality==='high'}

  dispose() {
    if(this.disposed)return
    this.disposed=true;this.group.removeFromParent();this.group.clear()
    for(const cached of this.cache.values())for(const geometry of cached.frames)geometry.dispose()
    for(const geometry of [this.markerGeometry,this.cupGeometry,this.lidGeometry])geometry.dispose()
    for(const mat of this.materials)mat.dispose()
    this.cache.clear();this.materials.clear();this.roleMaterials.clear();this.actors.clear()
  }
}
