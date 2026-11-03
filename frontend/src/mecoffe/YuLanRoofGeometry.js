import * as THREE from 'three'
import { roofPlan } from './yulanRoofModel.js'

function shapeOf(building) {
  const shape=new THREE.Shape(building.polygon.map(([x,y])=>new THREE.Vector2(x,y)))
  for(const hole of building.holes||[])shape.holes.push(new THREE.Path(hole.map(([x,y])=>new THREE.Vector2(x,y))))
  return shape
}
function material(color,roughness=.9) { return new THREE.MeshStandardMaterial({color,roughness}) }
function mesh(geometry,paint,name) {
  const object=new THREE.Mesh(geometry,paint);object.name=name;object.castShadow=object.receiveShadow=true;return object
}
function box(group,size,position,paint,name,angle=0) {
  const object=mesh(new THREE.BoxGeometry(...size),paint,name)
  object.position.set(...position);object.rotation.y=angle;group.add(object);return object
}
function equipment(item,plan,materials) {
  const group=new THREE.Group(),floor=plan.height+plan.slabThickness
  group.name=`roof-${item.kind}`;group.position.set(item.x,floor,-item.y);group.rotation.y=item.angle
  group.userData={roofEquipment:true,...item,illustrative:true}
  const {width:w,depth:d,height:h}=item
  box(group,[w+.3,.2,d+.3],[0,.1,0],materials.concrete,'equipment-plinth')
  if(item.kind==='water-tank') {
    const tank=mesh(new THREE.CylinderGeometry(w*.43,w*.43,h,16),materials.metal,'water-tank-volume')
    tank.position.y=.2+h/2;group.add(tank)
    for(const elevation of [.35,h*.5,h+.18]) {
      const ring=mesh(new THREE.TorusGeometry(w*.435,.045,4,24),materials.trim,'tank-hoop');ring.rotation.x=Math.PI/2;ring.position.y=elevation;group.add(ring)
    }
  } else if(item.kind==='solar') {
    for(const x of [-w*.3,w*.3])box(group,[.15,h,.15],[x,h/2,0],materials.metal,'solar-support')
    const panel=box(group,[w,.14,d],[0,h,0],materials.solar,'solar-panel');panel.rotation.x=-.21
    for(let i=1;i<5;i++){const seam=box(group,[.035,.04,d],[(-.5+i/5)*w,h+.09,0],materials.trim,'solar-cell-seam');seam.rotation.x=-.21}
  } else if(item.kind==='green-roof') {
    box(group,[w,h,d],[0,h/2,0],materials.concrete,'roof-planter')
    box(group,[w-.3,.16,d-.3],[0,h+.04,0],materials.green,'roof-planting')
  } else {
    box(group,[w,h,d],[0,.2+h/2,0],item.kind==='stairwell'?materials.concrete:materials.metal,'equipment-volume')
    box(group,[w+.18,.16,d+.18],[0,.2+h,0],materials.trim,'equipment-cap')
    if(item.kind==='stairwell')box(group,[w*.3,h*.65,.08],[0,h*.45,d/2+.05],materials.door,'stair-door')
    else for(const x of [-w*.22,w*.22]) {
      const fan=mesh(new THREE.CylinderGeometry(w*.18,w*.18,.07,12),materials.dark,'vent-fan');fan.position.set(x,h+.32,0);group.add(fan)
    }
  }
  return group
}

function pitchedRoof(plan,materials) {
  const group=new THREE.Group(),m=plan.metrics,c=Math.cos(m.angle),s=Math.sin(m.angle)
  const u0=m.minU-plan.eaves,u1=m.maxU+plan.eaves,v0=m.minV-plan.eaves,v1=m.maxV+plan.eaves,vc=(v0+v1)/2
  const base=plan.height+plan.slabThickness,top=base+plan.rise
  const point=(u,v,h)=>[u*c-v*s,h,-(u*s+v*c)]
  const points=[point(u0,v0,base),point(u1,v0,base),point(u1,v1,base),point(u0,v1,base),point(u0,vc,top),point(u1,vc,top)]
  const indices=[0,1,5,0,5,4,3,4,5,3,5,2,0,4,3,1,2,5,0,3,2,0,2,1]
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));geometry.setIndex(indices);geometry.computeVertexNormals()
  const roof=mesh(geometry,materials.tile,'pitched-roof-solid');roof.material.flatShading=true;group.add(roof)
  const midU=(u0+u1)/2
  box(group,[u1-u0,.2,.35],point(midU,vc,top+.08),materials.trim,'roof-ridge',m.angle)
  for(const v of [v0,v1])box(group,[u1-u0,.26,.22],point(midU,v,base-.08),materials.trim,'roof-eaves-fascia',m.angle)
  // Raised narrow battens describe actual sloped geometry, not an oblique image.
  for(let side=0;side<2;side++)for(let t=.2;t<1;t+=.2) {
    const v=side?v1-(v1-vc)*t:v0+(vc-v0)*t
    box(group,[u1-u0,.045,.05],point(midU,v,base+plan.rise*t+.04),materials.trim,'tile-row',m.angle)
  }
  return group
}

export function createYuLanRoof(building,options={}) {
  const plan=roofPlan(building,options),group=new THREE.Group()
  group.name='yulan-procedural-roof';group.userData={roofPlan:plan,roofTextureApplied:false,illustrative:true}
  const materials={surface:material('#bdc4c2'),concrete:material('#e0e1d8'),trim:material('#738389'),
    metal:material('#a1b2b7',.52),dark:material('#47575d'),solar:material('#274b66',.42),
    green:material('#6f945b'),door:material('#677e87'),tile:material(plan.tileColor)}
  const slab=mesh(new THREE.ExtrudeGeometry(shapeOf(building),{depth:plan.slabThickness,bevelEnabled:false}),materials.surface,'roof-slab')
  slab.rotation.x=-Math.PI/2;slab.position.y=plan.height;group.add(slab)
  if(plan.kind==='pitched')group.add(pitchedRoof(plan,materials))
  else {
    const segments=[]
    for(const ring of [building.polygon,...(building.holes||[])])for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue
      const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),x=(a[0]+b[0])/2,y=(a[1]+b[1])/2
      segments.push({length,angle,x,y})
    }
    // A courtyard or a detailed OSM outline still costs two parapet draw calls.
    for(const cap of [false,true]) {
      const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),cap?materials.trim:materials.concrete,segments.length)
      batch.name=cap?'parapet-cap':'roof-parapet';batch.castShadow=batch.receiveShadow=true
      const dummy=new THREE.Object3D()
      for(const [index,segment] of segments.entries()) {
        dummy.position.set(segment.x,plan.height+plan.slabThickness+(cap?plan.parapetHeight:plan.parapetHeight/2),-segment.y)
        dummy.rotation.y=segment.angle
        dummy.scale.set(segment.length+(cap ? .15 : 0),cap ? .13 : plan.parapetHeight,plan.parapetWidth+(cap ? .2 : 0))
        dummy.updateMatrix();batch.setMatrixAt(index,dummy.matrix)
      }
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();group.add(batch)
    }
    for(const item of plan.equipment)group.add(equipment(item,plan,materials))
  }
  const used=new Set()
  group.traverse(child=>{if(child.material)used.add(child.material)})
  for(const paint of Object.values(materials))if(!used.has(paint))paint.dispose()
  return group
}
