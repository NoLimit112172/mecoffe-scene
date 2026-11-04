import * as THREE from 'three'

export function entrancePose(entry,building){
  const p=entry.point,q=entry.connector.find(q=>Math.hypot(q[0]-p[0],q[1]-p[1])>.05)
  const ring=building.polygon,c=[ring.reduce((a,q)=>a+q[0],0)/ring.length,ring.reduce((a,q)=>a+q[1],0)/ring.length]
  let dx=entry.outward?.[0]??(q?q[0]-p[0]:p[0]-c[0]),dy=entry.outward?.[1]??(q?q[1]-p[1]:p[1]-c[1]),d=Math.hypot(dx,dy)||1
  return {x:p[0],y:p[1],outward:{x:dx/d,y:dy/d},heading:Math.atan2(dx,-dy),height:Math.min(10,building.height_m*.8),width:5.6}
}

// One frame per authoritative inferred entry, three instanced draws for all buildings.
export class Campus3DEntrances{
  constructor({scene,campus,entrances,elevation=()=>.1}){
    this.group=new THREE.Group();this.group.name='inferred-building-doors';scene.add(this.group)
    const buildings=new Map(campus.buildings.map(b=>[b.osm_id,b])),entries=entrances.entrances
    this.frames=new Map();const box=new THREE.BoxGeometry(1,1,1)
    const material=color=>new THREE.MeshStandardMaterial({color,roughness:.55,emissive:color,emissiveIntensity:.12})
    this.rim=new THREE.InstancedMesh(box,material(0xf4d493),entries.length*3)
    this.panel=new THREE.InstancedMesh(box,material(0x163e43),entries.length)
    this.threshold=new THREE.InstancedMesh(box,material(0xd4ccb7),entries.length)
    this.group.add(this.rim,this.panel,this.threshold)
    const object=new THREE.Object3D(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3()
    const place=(mesh,index,pose,offset,sizing)=>{
      object.rotation.set(0,pose.heading,0);rotation.copy(object.quaternion)
      position.set(...offset).applyQuaternion(rotation).add(new THREE.Vector3(pose.x,elevation({x:pose.x,y:pose.y}),-pose.y))
      mesh.setMatrixAt(index,new THREE.Matrix4().compose(position,rotation,scale.set(...sizing)))
    }
    entries.forEach((entry,i)=>{
      const b=buildings.get(entry.building_id),pose=entrancePose(entry,b),h=pose.height,w=pose.width
      this.frames.set(entry.building_id,{entry,pose})
      place(this.panel,i,pose,[0,h/2,.28],[w,h,.65])
      place(this.rim,i*3,pose,[-w/2,h/2,.65],[.48,h+.5,.65])
      place(this.rim,i*3+1,pose,[w/2,h/2,.65],[.48,h+.5,.65])
      place(this.rim,i*3+2,pose,[0,h,.65],[w+.5,.5,.65])
      place(this.threshold,i,pose,[0,.15,1.4],[w+1,.3,2.8])
    })
    for(const mesh of this.group.children){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.receiveShadow=true}
  }
  setVisible(value){this.group.visible=Boolean(value)}
  dispose(){const geometry=this.rim.geometry;for(const mesh of this.group.children)mesh.material.dispose();geometry.dispose();this.group.removeFromParent();this.frames.clear()}
}
