import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// ExtrudeGeometry emits one group per wall segment. Regroup the exact same
// triangle indices by material, preserving all positions, winding and UVs.
export function consolidateMaterialGroups(geometry) {
  if(geometry.groups.length<3)return geometry
  const groups=new Map(),indices=[]
  for(const group of geometry.groups){if(!groups.has(group.materialIndex))groups.set(group.materialIndex,[]);const list=groups.get(group.materialIndex);for(let i=group.start;i<group.start+group.count;i++)list.push(geometry.index?geometry.index.getX(i):i)}
  geometry.clearGroups()
  for(const [material,list]of groups){geometry.addGroup(indices.length,list.length,material);for(const value of list)indices.push(value)}
  geometry.setIndex(indices)
  return geometry
}

// Bound visual work only; never discard/rewrite orders or their source routes.
export function tripQueueEntries(entries,active,limit=12,perStore=2) {
  const people=[...entries],counts=new Map(),result=[]
  for(const entry of people){const brand=entry.walker?.event?.brand_id;if(brand)counts.set(brand,(counts.get(brand)||0)+1)}
  const candidates=people.filter(entry=>!entry.walker&&entry.queue?.length)
    .sort((a,b)=>(a.queue[0].event.i??0)-(b.queue[0].event.i??0)||a.person.id.localeCompare(b.person.id))
  for(const entry of candidates){if(result.length>=Math.max(0,limit-active))break;const brand=entry.queue[0].event.brand_id;if(brand&&(counts.get(brand)||0)>=perStore)continue;result.push(entry);if(brand)counts.set(brand,(counts.get(brand)||0)+1)}
  return result
}

// Static objects only. Keep invisible originals as metadata/picking proxies;
// merged geometry belongs to the returned batch, original resources to caller.
export function batchStaticMeshes(root) {
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert(), buckets = new Map(), originals = []
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || !mesh.visible) return
    const material = mesh.material
    if (material.transparent || mesh.userData.bloom) return
    const attributes = Object.keys(mesh.geometry.attributes).sort().join(',')
    const key = JSON.stringify([material.type, material.color?.getHex(), material.map?.uuid, material.emissiveMap?.uuid,
      material.roughness, material.metalness, material.side, material.alphaTest, material.vertexColors,
      material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits, mesh.castShadow, mesh.receiveShadow, attributes])
    if (!buckets.has(key)) buckets.set(key, { material, source: mesh, geometries: [] })
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    geometry.clearGroups()
    geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
    buckets.get(key).geometries.push(geometry)
    originals.push(mesh)
  })
  const group = new THREE.Group()
  group.name = 'static-material-batches'
  for (const {material, source, geometries} of buckets.values()) {
    const geometry = mergeGeometries(geometries)
    for (const part of geometries) part.dispose()
    if (!geometry) throw new Error('Static geometry attributes do not match')
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow
    mesh.matrixAutoUpdate = false; group.add(mesh)
  }
  for (const mesh of originals) mesh.visible = false
  root.add(group)
  root.updateWorldMatrix(true,true)
  return {group, inputMeshes: originals.length, outputMeshes: group.children.length}
}

/** Ignore pauses/loading and healthy windows. A manual quality choice wins. */
export class AdaptiveQuality {
  constructor({windowMs=5000, threshold=30}={}) {this.windowMs=windowMs;this.threshold=threshold;this.reset()}
  reset() {this.start=null;this.frames=0;this.notified=false;this.manual=false}
  chooseManually() {this.manual=true}
  sample(now, active, quality) {
    if (!active || quality!=='high' || this.manual || this.notified) {this.start=null;this.frames=0;return false}
    if (this.start===null) {this.start=now;this.frames=0;return false}
    this.frames++
    const elapsed=now-this.start
    if(elapsed<this.windowMs)return false
    const slow=this.frames*1000/elapsed<this.threshold
    this.start=now;this.frames=0
    if(slow)this.notified=true
    return slow
  }
}

export function shadowNeedsRefresh(previousPhase, phase, force=false) {
  return force || previousPhase===null || Math.abs(phase-previousPhase)>=1/120
}

/** Cluster source vertices without dropping UV/skin/material boundaries.
 * Keep complete vertex attributes; only index topology changes. Full source
 * geometry is retained for portraits. No source FBX is rewritten. */
export function characterLodGeometry(source, divisions=55) {
  source.computeBoundingBox()
  const cell=Math.max(source.boundingBox.max.y-source.boundingBox.min.y,.001)/divisions
  const position=source.attributes.position, uv=source.attributes.uv, skin=source.attributes.skinIndex
  const clusters=new Map(), remap=[]
  for(let i=0;i<position.count;i++) {
    const key=[Math.round(position.getX(i)/cell),Math.round(position.getY(i)/cell),Math.round(position.getZ(i)/cell),
      uv?Math.floor(uv.getX(i)*16):0,uv?Math.floor(uv.getY(i)*16):0,
      skin?skin.getX(i):0,skin?skin.getY(i):0].join(':')
    if(!clusters.has(key))clusters.set(key,i)
    remap[i]=clusters.get(key)
  }
  const geometry=source.clone(), indices=[], count=source.index?.count||position.count
  geometry.clearGroups()
  for(const group of source.groups.length?source.groups:[{start:0,count,materialIndex:0}]) {
    const start=indices.length
    for(let j=group.start;j<Math.min(count,group.start+group.count);j+=3) {
      const a=remap[source.index?source.index.getX(j):j],b=remap[source.index?source.index.getX(j+1):j+1],c=remap[source.index?source.index.getX(j+2):j+2]
      if(a!==b&&b!==c&&a!==c)indices.push(a,b,c)
    }
    geometry.addGroup(start,indices.length-start,group.materialIndex)
  }
  geometry.setIndex(indices)
  return geometry
}
