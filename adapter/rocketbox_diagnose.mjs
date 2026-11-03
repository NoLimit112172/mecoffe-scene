// Geometry-only verification using the same Three.js FBXLoader as the browser.
// Texture URLs are recorded without fetching them; PNG pixels are verified by
// rocketbox_assets.py. No Blender installation or renderer changes required.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from '../frontend/node_modules/three/build/three.module.js'
import { FBXLoader } from '../frontend/node_modules/three/examples/jsm/loaders/FBXLoader.js'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const base=path.join(root,'frontend/public/mecoffe/assets3d/rocketbox')
const ids=['Female_Adult_01','Female_Adult_03','Male_Adult_01','Male_Adult_14']
class RecordedTextureLoader extends THREE.Loader {
  load(name) { const texture=new THREE.Texture();texture.userData.sourcePath=String(name);return texture }
}
const bounds=object=>{
  const box=new THREE.Box3().setFromObject(object)
  return {min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()}
}
const models=[]
for(const id of ids) {
  const published=path.join(base,id,`${id}.fbx`)
  const cached=path.join(root,'logs/asset-library/rocketbox-downloads/Assets/Avatars/Adults',id,'Export',`${id}.fbx`)
  const source=fs.existsSync(published)?published:cached
  if(!fs.existsSync(source)){console.log(`${id}: waiting for download`);continue}
  const manager=new THREE.LoadingManager()
  manager.addHandler(/\.tga$/i,new RecordedTextureLoader(manager))
  const raw=fs.readFileSync(source)
  const object=new FBXLoader(manager).parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'')
  object.updateMatrixWorld(true)
  const meshes=[],bones=[],hierarchy=[]
  object.traverse(node=>{
    const parents=[];for(let p=node.parent;p;p=p.parent)parents.unshift(p.name||p.type)
    const nodePath=[...parents,node.name||node.type].join('/')
    hierarchy.push({path:nodePath,type:node.type,visible:node.visible})
    if(node.isBone)bones.push({name:node.name,parent:node.parent?.name,position:node.position.toArray(),worldPosition:node.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:node.quaternion.toArray()})
    if(node.isMesh) {
      const geometry=node.geometry,attrs=geometry.attributes
      if(!attrs.position || !attrs.uv || ![...attrs.position.array,...attrs.uv.array].every(Number.isFinite))throw new Error(`${id}/${node.name}: invalid geometry/UV`)
      if(node.isSkinnedMesh && (!attrs.skinIndex || !attrs.skinWeight))throw new Error(`${id}/${node.name}: no skin weights`)
      let maxWeightError=0
      if(attrs.skinWeight)for(let i=0;i<attrs.skinWeight.count;i++)maxWeightError=Math.max(maxWeightError,Math.abs(1-(attrs.skinWeight.getX(i)+attrs.skinWeight.getY(i)+attrs.skinWeight.getZ(i)+attrs.skinWeight.getW(i))))
      node.skeleton?.update()
      node.computeBoundingBox?.()
      meshes.push({name:node.name,path:nodePath,skinned:Boolean(node.isSkinnedMesh),vertices:attrs.position.count,
        triangles:(geometry.index?.count||attrs.position.count)/3,uvCount:attrs.uv.count,uvBounds:[Math.min(...attrs.uv.array),Math.max(...attrs.uv.array)],
        boneCount:node.skeleton?.bones.length||0,maxWeightError,bounds:bounds(node),
        materials:(Array.isArray(node.material)?node.material:[node.material]).map(material=>({name:material.name,type:material.type,color:material.color?.getHexString(),opacity:material.opacity,transparent:material.transparent,
          textures:Object.fromEntries(['map','alphaMap','normalMap','specularMap','bumpMap','emissiveMap'].filter(key=>material[key]).map(key=>[key,{name:material[key].name,path:material[key].userData.sourcePath}]))}))})
    }
  })
  const result={id,bounds:bounds(object),root:{position:object.position.toArray(),rotation:object.rotation.toArray(),scale:object.scale.toArray()},
    meshCount:meshes.length,boneCount:bones.length,meshes,bones,hierarchy,
    animations:object.animations.map(clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.length}))}
  models.push(result)
  console.log(JSON.stringify({id,bounds:result.bounds,meshes:meshes.map(mesh=>({name:mesh.name,triangles:mesh.triangles,bones:mesh.boneCount,materials:mesh.materials})),boneNames:bones.map(bone=>bone.name),animations:result.animations}))
  const geometries=new Set(),materials=new Set(),textures=new Set()
  object.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(material){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value)}})
  geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());textures.forEach(item=>item.dispose())
}
const output=path.join(root,'logs/asset-library/rocketbox-diagnostics.json')
fs.writeFileSync(output,JSON.stringify({parser:'Three.js FBXLoader',three_revision:THREE.REVISION,models},null,2)+'\n')
const manifestPath=path.join(base,'manifest.json')
if(fs.existsSync(manifestPath)&&models.length===4) {
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
  for(const model of manifest.models) {
    const diagnostic=models.find(result=>result.id===model.id)
    model.diagnostics={parser:`Three.js FBXLoader r${THREE.REVISION}`,bounds:diagnostic.bounds,
      bone_names:diagnostic.bones.map(bone=>bone.name),lods:diagnostic.meshes.map(mesh=>({name:mesh.name,triangles:mesh.triangles,vertices:mesh.vertices,bone_count:mesh.boneCount,uv_count:mesh.uvCount,max_weight_error:mesh.maxWeightError})),
      embedded_animations:diagnostic.animations}
  }
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n')
}
