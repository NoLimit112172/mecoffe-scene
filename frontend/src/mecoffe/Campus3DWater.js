import * as THREE from 'three'
import { waterDepthAt } from './campus3dSpatial.js'
import { TERRAIN_LEVELS, offsetTerrainRing, openRing } from './campus3dTerrain.js'

const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,side:THREE.DoubleSide,...extra})
const verticesGeometry=(vertices,colors)=>{
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))
  if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
  g.computeVertexNormals();g.computeBoundingBox();return g
}
function mesh(group,geometry,material,name){const object=new THREE.Mesh(geometry,material);object.name=name;object.receiveShadow=true;group.add(object);return object}
export function waterTriangles(ring,maxEdge=10) {
  const points=openRing(ring),triangles=THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(...p)),[]),result=[]
  const queue=triangles.map(t=>({p:t.map(i=>points[i]),depth:0}))
  while(queue.length){
    const {p,depth}=queue.pop(),edges=p.map((a,i)=>Math.hypot(a[0]-p[(i+1)%3][0],a[1]-p[(i+1)%3][1]))
    const length=Math.max(...edges)
    if(length<=maxEdge||depth>=12){result.push(p);continue}
    const i=edges.indexOf(length),a=p[i],b=p[(i+1)%3],c=p[(i+2)%3],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]
    queue.push({p:[a,mid,c],depth:depth+1},{p:[mid,b,c],depth:depth+1})
  }
  return result
}
export function createWaterBasin(water) {
  const group=new THREE.Group();group.name=`有深度的水域 ${water.name}`
  const triangles=waterTriangles(water.polygon),bed=[],surface=[],bedColors=[],surfaceColors=[],depths=[]
  const shallow=new THREE.Color('#c0b18a'),deep=new THREE.Color('#3e665e'),paleWater=new THREE.Color('#72afac'),deepWater=new THREE.Color('#326e86')
  for(const triangle of triangles)for(const [x,y]of triangle){
    const depth=waterDepthAt({x,y},water),t=depth/water.settings.maxDepth
    depths.push(depth);bed.push(x,water.settings.surface-depth,-y);surface.push(x,water.settings.surface,-y)
    const a=shallow.clone().lerp(deep,t),b=paleWater.clone().lerp(deepWater,t)
    bedColors.push(a.r,a.g,a.b);surfaceColors.push(b.r,b.g,b.b)
  }
  const floor=mesh(group,verticesGeometry(bed,bedColors),mat('#ffffff',{vertexColors:true}),'起伏湖底（设定深度）')
  floor.userData.depthRange={min:Math.min(...depths.filter(d=>d>0)),max:Math.max(...depths)}
  const top=mesh(group,verticesGeometry(surface,surfaceColors),mat('#ffffff',{vertexColors:true,transparent:true,opacity:.64,depthWrite:false,roughness:.24,metalness:.12}),'半透明水面')
  top.renderOrder=2
  const outer=openRing(water.polygon),inner=offsetTerrainRing(water.polygon,-water.settings.bankWidth),bank=[]
  for(let i=0;i<outer.length;i++){
    const j=(i+1)%outer.length,p=[[outer[i][0],TERRAIN_LEVELS.campusGrass,-outer[i][1]],[outer[j][0],TERRAIN_LEVELS.campusGrass,-outer[j][1]],
      [inner[j][0],water.settings.surface-.1,-inner[j][1]],[inner[i][0],water.settings.surface-.1,-inner[i][1]]]
    for(const n of [0,1,2,0,2,3])bank.push(...p[n])
  }
  mesh(group,verticesGeometry(bank),mat('#a69f83'),'下凹岸坡')
  group.userData={osm_id:water.osm_id,kind:'water',illustrative_depth:true,depthRange:floor.userData.depthRange,waterSurface:water.settings.surface}
  return group
}
export function createBridge(bridge) {
  const group=new THREE.Group();group.name=bridge.style==='road-surface'?'跨水道路通行面（显示处理）':'跨水桥梁（示意原型）'
  const dx=bridge.end.x-bridge.start.x,dy=bridge.end.y-bridge.start.y,length=Math.hypot(dx,dy),nx=-dy/length,nz=-dx/length
  const at=(s,lateral=0)=>new THREE.Vector3(bridge.start.x+dx*s/length+nx*lateral,bridge.roadHeight+(bridge.deckHeight-bridge.roadHeight)*Math.max(0,Math.min(1,s/bridge.approach,(length-s)/bridge.approach)),-bridge.start.y-dy*s/length+nz*lateral)
  const points=[0,Math.min(bridge.approach,length/2),Math.max(length-bridge.approach,length/2),length],deck=[]
  for(let i=1;i<points.length;i++){
    const a=at(points[i-1],-bridge.width/2),b=at(points[i-1],bridge.width/2),c=at(points[i],bridge.width/2),d=at(points[i],-bridge.width/2)
    for(const p of [a,b,c,a,c,d])deck.push(...p.toArray())
    for(const [p,q]of [[a,d],[b,c]])for(const r of [p,q,q.clone().add(new THREE.Vector3(0,-.45,0)),p,q.clone().add(new THREE.Vector3(0,-.45,0)),p.clone().add(new THREE.Vector3(0,-.45,0))])deck.push(...r.toArray())
  }
  mesh(group,verticesGeometry(deck),mat(bridge.style==='road-surface'?'#667471':'#d5d0b8'),'有厚度桥面与两端坡道')
  const steel=mat('#6b7c79'),stone=mat('#b8b3a0')
  for(const side of bridge.style==='road-surface'?[]:[-1,1]){
    const rail=[]
    for(let s=0;s<=length+.01;s+=3){const p=at(Math.min(s,length),side*(bridge.width/2-.2));const post=new THREE.Mesh(new THREE.BoxGeometry(.17,1.2,.17),steel);post.position.copy(p).y+=.6;group.add(post)}
    for(let i=1;i<points.length;i++)for(const height of [.55,1.2]){
      const a=at(points[i-1],side*(bridge.width/2-.2)),b=at(points[i],side*(bridge.width/2-.2));a.y+=height;b.y+=height;rail.push(...a.toArray(),...b.toArray())
    }
    group.add(new THREE.LineSegments(verticesGeometry(rail),new THREE.LineBasicMaterial({color:'#677975'})))
  }
  if(length>24&&bridge.style!=='road-surface')for(const t of [.35,.65]){
    const p=at(t*length),height=p.y+2.4,foot=new THREE.Mesh(new THREE.BoxGeometry(1.4,height,bridge.width*.72),stone)
    foot.position.set(p.x,p.y-height/2-.2,p.z);foot.rotation.y=Math.atan2(dy,dx);group.add(foot)
  }
  group.userData={...bridge,kind:'bridge',illustrative:true}
  return group
}
export class Campus3DWater {
  constructor({scene,spatial}){this.scene=scene;this.spatial=spatial;this.group=new THREE.Group();this.group.name='水域、岸坡与桥梁（展示空间规则）'}
  init(){for(const water of this.spatial.waters)this.group.add(createWaterBasin(water));for(const bridge of this.spatial.bridges)this.group.add(createBridge(bridge));this.scene.add(this.group);return this}
  dispose(){if(this.disposed)return;this.disposed=true;this.group.removeFromParent();const resources=new Set();this.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))resources.add(m)});for(const r of resources)r.dispose();this.group.clear()}
}
