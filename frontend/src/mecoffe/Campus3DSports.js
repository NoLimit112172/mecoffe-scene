import * as THREE from 'three'
import { sportsLayouts, SPORTS_DIMENSIONS, TRACK_DIMENSIONS as TRACK, stadiumRing } from './campus3dSportsModel.js'
import { TERRAIN_LEVELS } from './campus3dTerrain.js'

const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.88,side:THREE.DoubleSide,...extra})
function slab(group,w,l,h,color,x=0,y=0,z=0) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),material(color));mesh.position.set(x,y+h/2,z);mesh.receiveShadow=true;group.add(mesh);return mesh
}
function lines(group,paths,y=.23,color='#fff5dd',width=.10) {
  const vertices=[]
  for(const path of paths)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!d)continue
    const nx=-(b[1]-a[1])/d*width/2,nz=(b[0]-a[0])/d*width/2
    const p=[[a[0]+nx,y,a[1]+nz],[a[0]-nx,y,a[1]-nz],[b[0]-nx,y,b[1]-nz],[b[0]+nx,y,b[1]+nz]]
    for(const k of [0,1,2,0,2,3])vertices.push(...p[k])
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals()
  group.add(new THREE.Mesh(geometry,material(color)))
}
const rectangle=(w,l,cx=0,cz=0)=>[[cx-w/2,cz-l/2],[cx+w/2,cz-l/2],[cx+w/2,cz+l/2],[cx-w/2,cz+l/2],[cx-w/2,cz-l/2]]
const arc=(x,z,r,from=0,to=Math.PI*2,count=64)=>Array.from({length:count+1},(_,i)=>[x+Math.cos(from+(to-from)*i/count)*r,z+Math.sin(from+(to-from)*i/count)*r])
function net(group,width,height,z=0) {
  for(const x of [-width/2,width/2])slab(group,.13,.13,height,'#466363',x,.2,z)
  const positions=[]
  for(let x=-width/2;x<=width/2+.001;x+=.35)positions.push(x,.3,z,x,height+.2,z)
  for(let y=.3;y<=height+.2;y+=.25)positions.push(-width/2,y,z,width/2,y,z)
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#ecf0d9',transparent:true,opacity:.65})))
  slab(group,width,.07,.06,'#fff5dd',0,height+.17,z)
}
function basketballHoop(group,z,side) {
  slab(group,.2,.2,3.6,'#d8dfd7',0,.2,z+side*1.3)
  slab(group,.15,1.3,.15,'#d8dfd7',0,3.65,z+side*.65)
  const board=slab(group,1.8,.12,1.05,'#e6f0ec',0,3.05,z+side*.45);board.userData.equipment='backboard'
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.225,.035,6,20),material('#e96938'));rim.rotation.x=Math.PI/2;rim.position.set(0,3.25,z);group.add(rim)
  const strings=[];for(let i=0;i<8;i++){const a=i*Math.PI/4;strings.push(Math.cos(a)*.225,3.23,z+Math.sin(a)*.225,Math.cos(a)*.14,2.82,z+Math.sin(a)*.14)}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(strings,3));group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#f0edda'})))
}
export function createCourt(sport,options={}) {
  const d=SPORTS_DIMENSIONS[sport],group=new THREE.Group();group.name=`运动场模型 ${sport}`
  group.userData={sport,nominal_dimensions:{width:d.width,length:d.length},illustrative:true}
  const color=options.surface_color||{basketball:'#b76b50',tennis:'#477b7c',badminton:'#527d66',soccer:'#549359'}[sport]
  slab(group,d.width+2*d.runoff,d.length+2*d.runoff,.18,'#607a70')
  slab(group,d.width,d.length,.035,color,0,.18)
  const paths=[rectangle(d.width,d.length)]
  if(sport==='basketball') {
    paths.push([[-d.width/2,0],[d.width/2,0]],arc(0,0,1.8))
    for(const side of [-1,1]){
      const z=side*(d.length/2-1.575)
      slab(group,4.9,5.8,.006,'#d7a678',0,.218,side*(d.length/2-2.9))
      paths.push(rectangle(4.9,5.8,0,side*(d.length/2-2.9)),arc(0,side*(d.length/2-5.8),1.8),arc(0,z,6.75,side<0?0:Math.PI,side<0?Math.PI:Math.PI*2))
      basketballHoop(group,z,side)
    }
  } else if(sport==='tennis') {
    paths.push(rectangle(8.23,d.length),[[-d.width/2,0],[d.width/2,0]],rectangle(8.23,12.8),[[0,-6.4],[0,6.4]])
    net(group,d.width+1,1.07)
  } else if(sport==='badminton') {
    paths.push(rectangle(5.18,d.length),[[-3.05,-1.98],[3.05,-1.98]],[[-3.05,1.98],[3.05,1.98]],[[0,-6.7],[0,-1.98]],[[0,1.98],[0,6.7]],[[-3.05,-5.94],[3.05,-5.94]],[[-3.05,5.94],[3.05,5.94]])
    net(group,d.width,1.55)
  } else {
    paths.push([[-34,0],[34,0]],arc(0,0,9.15))
    for(const side of [-1,1]) {
      paths.push(rectangle(40.32,16.5,0,side*(52.5-8.25)),rectangle(18.32,5.5,0,side*(52.5-2.75)))
      const z=side*52.5
      for(const x of [-3.66,3.66])slab(group,.12,.12,2.44,'#fff3de',x,.2,z)
      slab(group,7.44,.12,.12,'#fff3de',0,2.52,z)
      slab(group,7.32,1.8,.05,'#cbd5b4',0,.21,z+side*.9)
    }
  }
  lines(group,paths,.23)
  return group
}
export function createTrack400(options={}) {
  const track={...TRACK,lanes:[4,6,8].includes(options.lanes)?options.lanes:8}
  const group=new THREE.Group();group.name='400m八道标准型跑道（示意）'
  const outer=stadiumRing(track.innerRadius+track.lanes*track.laneWidth),inner=stadiumRing(track.innerRadius)
  const shape=new THREE.Shape(outer.map(([x,z])=>new THREE.Vector2(x,z)))
  shape.holes.push(new THREE.Path(inner.map(([x,z])=>new THREE.Vector2(x,z))))
  const ring=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false}),material('#bb6651'));ring.name='八道实体跑道';ring.rotation.x=-Math.PI/2;group.add(ring)
  const grassShape=new THREE.Shape(inner.map(([x,z])=>new THREE.Vector2(x,z)))
  const grass=new THREE.Mesh(new THREE.ShapeGeometry(grassShape),material('#81a46a'));grass.rotation.x=-Math.PI/2;grass.position.y=.18;group.add(grass)
  const paths=[]
  for(let lane=0;lane<=track.lanes;lane++)paths.push(stadiumRing(track.innerRadius+lane*track.laneWidth))
  paths.push([[track.innerRadius,-track.straight/2],[track.innerRadius+track.lanes*track.laneWidth,-track.straight/2]])
  lines(group,paths,.21,'#fff1d9',.12)
  const field=createCourt('soccer');field.position.y=.02;group.add(field)
  group.userData={sport:'track400',nominal_measurement_lap:2*TRACK.straight+2*Math.PI*(TRACK.innerRadius+TRACK.measurementOffset),lanes:track.lanes,asset_id:'landcover.sports.track400',modeling:'400m标准型原型；按用户标注定位，非OSM实测外圈',illustrative:true}
  return group
}
export class Campus3DSports {
  constructor({scene,landcovers}){this.scene=scene;this.landcovers=landcovers;this.group=new THREE.Group();this.group.name='运动场三维素材（展示排布）';this.layouts=sportsLayouts(landcovers)}
  init(){
    for(const layout of this.layouts){
      const place=new THREE.Group(),{frame}=layout;place.position.set(frame.center.x,TERRAIN_LEVELS.campusGrass+.025,-frame.center.y);place.rotation.y=frame.angle
      place.userData={osm_id:layout.feature.osm_id,sport:layout.sport,asset_id:`landcover.sports.${layout.sport}`,source:'OSM pitch + procedural asset',illustrative_layout:true}
      if(layout.track){const track=createTrack400();track.scale.setScalar(Math.min(1.02,frame.width/68,frame.length/105));place.add(track)}
      else if(layout.layout)for(const instance of layout.layout.instances){const court=createCourt(layout.feature.sport);court.position.set(instance.x,0,-instance.y);court.rotation.y=instance.angle;court.scale.setScalar(instance.scale);place.add(court)}
      else {slab(place,Math.min(8,frame.width*.7),Math.min(5,frame.length*.7),.8,'#6b9ab5');place.userData.equipment='athletics demonstration pad'}
      this.group.add(place)
    }
    this.scene.add(this.group);return this
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.group.removeFromParent();disposeSportsObject(this.group)}
}
export function disposeSportsObject(group) {
  const resources=new Set();group.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of [o.material].flat().filter(Boolean))resources.add(m)})
  for(const resource of resources)resource.dispose();group.clear()
}
