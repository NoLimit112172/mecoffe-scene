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
const inventoryPath=path.join(root,'logs/asset-library/rocketbox-inventory.json')
const manifestPath=path.join(base,'manifest.json')
const inventory=JSON.parse(fs.readFileSync(inventoryPath,'utf8'))
const records=inventory.models
class RecordedTextureLoader extends THREE.Loader {
  load(name) { const texture=new THREE.Texture();texture.userData.sourcePath=String(name);return texture }
}
const bounds=object=>{
  const box=new THREE.Box3().setFromObject(object)
  return {min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()}
}
const models=[],failures=[]
for(const record of records) {
  const {id}=record
  const published=path.join(base,id,`${id}.fbx`)
  const cached=path.join(root,'logs/asset-library/rocketbox-downloads',record.fbx_source)
  const source=fs.existsSync(published)?published:cached
  if(!fs.existsSync(source)){failures.push({id,error:'FBX not downloaded'});continue}
  try {
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
      if(!attrs.position || !attrs.uv || !attrs.position.array.every(Number.isFinite) || !attrs.uv.array.every(Number.isFinite))throw new Error(`${id}/${node.name}: invalid geometry/UV`)
      if(node.isSkinnedMesh && (!attrs.skinIndex || !attrs.skinWeight))throw new Error(`${id}/${node.name}: no skin weights`)
      let maxWeightError=0
      if(attrs.skinWeight)for(let i=0;i<attrs.skinWeight.count;i++)maxWeightError=Math.max(maxWeightError,Math.abs(1-(attrs.skinWeight.getX(i)+attrs.skinWeight.getY(i)+attrs.skinWeight.getZ(i)+attrs.skinWeight.getW(i))))
      node.skeleton?.update()
      node.computeBoundingBox?.()
      let uvMin=Infinity,uvMax=-Infinity;for(const value of attrs.uv.array){uvMin=Math.min(uvMin,value);uvMax=Math.max(uvMax,value)}
      meshes.push({name:node.name,path:nodePath,skinned:Boolean(node.isSkinnedMesh),vertices:attrs.position.count,
        triangles:(geometry.index?.count||attrs.position.count)/3,uvCount:attrs.uv.count,uvBounds:[uvMin,uvMax],
        boneCount:node.skeleton?.bones.length||0,maxWeightError,bounds:bounds(node),
        materials:(Array.isArray(node.material)?node.material:[node.material]).map(material=>({name:material.name,type:material.type,color:material.color?.getHexString(),opacity:material.opacity,transparent:material.transparent,
          textures:Object.fromEntries(['map','alphaMap','normalMap','specularMap','bumpMap','emissiveMap'].filter(key=>material[key]).map(key=>[key,{name:material[key].name,path:material[key].userData.sourcePath}]))}))})
    }
  })
  const result={id,bounds:bounds(object),root:{position:object.position.toArray(),rotation:object.rotation.toArray(),scale:object.scale.toArray()},
    meshCount:meshes.length,boneCount:bones.length,meshes,bones,hierarchy,
    animations:object.animations.map(clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.length}))}
  models.push(result)
  const bundledNames=new Set(record.textures.map(item=>path.posix.basename(item.source_path).toLowerCase()))
  result.missingDiffuseMaps=[...new Set(meshes.flatMap(mesh=>mesh.materials.flatMap(material=>Object.entries(material.textures).filter(([slot])=>slot==='map'||slot==='alphaMap').map(([,texture])=>texture.path.split(/[\\/]/).pop().toLowerCase()))).filter(name=>!bundledNames.has(name)))]
  console.log(JSON.stringify({id,meshes:meshes.length,bones:bones.length,height:result.bounds.size[1],triangles:meshes.reduce((sum,mesh)=>sum+mesh.triangles,0),missingDiffuseMaps:result.missingDiffuseMaps}))
  const geometries=new Set(),materials=new Set(),textures=new Set()
  object.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(material){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value)}})
  geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());textures.forEach(item=>item.dispose())
  } catch(error) { failures.push({id,error:String(error)});console.error(`${id}: ${error}`) }
}
const output=path.join(root,'logs/asset-library/rocketbox-diagnostics.json')
fs.writeFileSync(output+'.tmp',JSON.stringify({parser:'Three.js FBXLoader',three_revision:THREE.REVISION,models,failures},null,2)+'\n')
fs.renameSync(output+'.tmp',output)
if(fs.existsSync(manifestPath)&&failures.length===0) {
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
  for(const model of manifest.models) {
    const diagnostic=models.find(result=>result.id===model.id)
    model.diagnostics={parser:`Three.js FBXLoader r${THREE.REVISION}`,bounds:diagnostic.bounds,
      bone_names:diagnostic.bones.map(bone=>bone.name),lods:diagnostic.meshes.map(mesh=>({name:mesh.name,triangles:mesh.triangles,vertices:mesh.vertices,bone_count:mesh.boneCount,uv_count:mesh.uvCount,max_weight_error:mesh.maxWeightError})),
      embedded_animations:diagnostic.animations}
  }
  fs.writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2)+'\n')
  fs.renameSync(manifestPath+'.tmp',manifestPath)
}
console.log(JSON.stringify({parsed:models.length,failures,missingDiffuseMaps:models.filter(model=>model.missingDiffuseMaps.length).map(model=>({id:model.id,maps:model.missingDiffuseMaps}))},null,2))
if(failures.length)process.exitCode=1
