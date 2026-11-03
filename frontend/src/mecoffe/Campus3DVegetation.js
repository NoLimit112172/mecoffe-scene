import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import manifest from '../../public/mecoffe/assets3d/kenney/manifest.json' with {type:'json'}
import { TERRAIN_LEVELS } from './campus3dTerrain.js'

const templates=new Map()
async function sourceFor(record){
  if(!templates.has(record.id))templates.set(record.id,new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL||'/'}mecoffe/assets3d/kenney/${record.file}`).then(g=>g.scene).catch(e=>{templates.delete(record.id);throw e}))
  return templates.get(record.id)
}
export function vegetationParts(source,height=10) {
  source.updateMatrixWorld(true)
  const box=new THREE.Box3().setFromObject(source),scale=height/(box.max.y-box.min.y),center=box.getCenter(new THREE.Vector3()),parts=[]
  if(!Number.isFinite(scale)||scale<=0)throw new Error('植被模型高度无效')
  source.traverse(mesh=>{if(!mesh.isMesh)return
    const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).translate(-center.x,-box.min.y,-center.z).scale(scale,scale,scale)
    const material=[mesh.material].flat().map(m=>{const clone=m.clone();clone.roughness=.95;return clone})
    parts.push({geometry,material:material.length===1?material[0]:material})
  })
  return parts
}
export async function vegetationPreview(id){
  const record=manifest.models.find(m=>m.id===id);if(!record)throw new Error(`植被原型不存在：${id}`)
  const group=new THREE.Group();group.name=`Kenney 三维植被 ${id}`
  for(const part of vegetationParts(await sourceFor(record),record.kind==='tree'?10:2))group.add(new THREE.Mesh(part.geometry,part.material))
  group.userData={assetPrototype:`vegetation.kenney.${id}`,source:manifest.source_url,license:'CC0-1.0',true3d:true}
  return group
}
export function disposeVegetation(group){const resources=new Set();group.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))resources.add(m)});for(const r of resources)r.dispose();group.removeFromParent();group.clear()}

export class Campus3DVegetation {
  constructor({scene,environment}){this.scene=scene;this.environment=environment;this.group=new THREE.Group();this.group.name='Kenney 原生三维乔木与灌木（装饰）'}
  async init(){
    const points=this.environment.placements.trees,trees=manifest.models.filter(m=>m.kind==='tree'),shrubs=manifest.models.filter(m=>m.kind==='shrub')
    const selected=manifest.models.map(record=>({record,points:record.kind==='tree'?points.filter((p,i)=>i%trees.length===trees.indexOf(record)):points.filter((p,i)=>i%4===0&&Math.floor(i/4)%shrubs.length===shrubs.indexOf(record))}))
    for(const {record,points:locations}of selected){
      if(!locations.length)continue
      const source=await sourceFor(record);if(this.disposed)return this
      for(const part of vegetationParts(source,record.kind==='tree'?10:2)){
        const batch=new THREE.InstancedMesh(part.geometry,part.material,locations.length),dummy=new THREE.Object3D()
        for(const [i,p]of locations.entries()){dummy.position.set(p.x,TERRAIN_LEVELS.campusGrass,-p.y);dummy.rotation.y=p.angle||0;dummy.scale.setScalar(p.scale||1);dummy.updateMatrix();batch.setMatrixAt(i,dummy.matrix)}
        batch.instanceMatrix.needsUpdate=true;batch.castShadow=true;batch.receiveShadow=true
        batch.userData={assetPrototype:`vegetation.kenney.${record.id}`,true3d:true,illustrative:true}
        this.environment.registerDecorationBatch(batch,locations);this.group.add(batch)
      }
    }
    this.environment.trees.visible=false
    this.environment.trees=this.group
    this.environment.setAgentClearance(this.environment.avoidance)
    this.scene.add(this.group);return this
  }
  dispose(){if(this.disposed)return;this.disposed=true;disposeVegetation(this.group)}
}
