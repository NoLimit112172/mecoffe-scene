import * as THREE from 'three'
import {polygonCenter} from './campus3dRouting.js'
import {outsidePerson} from './indoorMotion.js'
import {layoutLabels,personScaleForCamera} from './campus3dScreen.js'
import {TERRAIN_LEVELS} from './campus3dTerrain.js'

export function placeIndoorPeople(view){
  if(!view.routeLayer){view.routeLayer=new THREE.Group();view.scene.add(view.routeLayer)}
  for(const p of view.indoor.people.values()){
    const figure=new THREE.Group(),body=new THREE.Object3D(),color=view.brandColors.get(p.id)||({undergraduate_consumer:0x3888aa,graduate_consumer:0x8a78b4,teacher_consumer:0x58916a,merchant:0xbb7545}[p.person.role]||0x6587a7)
    const base=new THREE.Mesh(new THREE.CircleGeometry(2.6,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.25,depthWrite:false}));base.rotation.x=-Math.PI/2;base.position.y=.05
    const walkHalo=new THREE.Mesh(new THREE.RingGeometry(2.8,3.8,20),new THREE.MeshBasicMaterial({color:0xfff7d6,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));walkHalo.rotation.x=-Math.PI/2;walkHalo.position.y=.12
    const hit=new THREE.Mesh(new THREE.SphereGeometry(4,6,4),new THREE.MeshBasicMaterial({visible:false}));hit.position.y=4.5;hit.userData.person=p.person
    figure.add(body,base,walkHalo,hit);figure.visible=false;figure.position.set(p.x,view.personElevation(p),-p.y);view.scene.add(figure);view.pickTargets.push(hit)
    const anchor=view.indoor.routing.anchors.get(p.key)
    view.people.set(p.id,{person:p.person,key:p.key,anchor,entrance:p.home,home:p.home,figure,body,base,walkHalo,color,record:p,queue:[],walker:null,presentationVisible:false,inView:false,hasCoffee:false})
  }
  view.indoorGlows=new Map()
  view.selection=new THREE.Mesh(new THREE.RingGeometry(4.1,5.2,32),new THREE.MeshBasicMaterial({color:0xffbd49,side:THREE.DoubleSide,depthTest:false}));view.selection.rotation.x=-Math.PI/2;view.selection.visible=false;view.scene.add(view.selection)
  for(const building of view.campus.buildings){
    const shape=new THREE.Shape(building.polygon.map(p=>new THREE.Vector2(...p))),material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3})
    const glow=new THREE.Mesh(new THREE.ShapeGeometry(shape),material);glow.rotation.x=-Math.PI/2;glow.position.y=building.height_m+TERRAIN_LEVELS.buildingBase+.35;glow.visible=false;view.scene.add(glow);view.indoorGlows.set(building.osm_id,glow)
  }
  syncIndoorView(view)
}
function outsidePin(view,entry){
  view.outsidePins??=new Map()
  let el=view.outsidePins.get(entry.person.id)
  if(!el){
    el=document.createElement('button');el.setAttribute('data-outside-person',entry.person.id)
    el.setAttribute('aria-label',`定位 ${entry.person.name}`);el.title=`${entry.person.name} · 室外（示意）`
    Object.assign(el.style,{position:'absolute',width:'11px',height:'11px',padding:'0',border:'2px solid #fff8df',borderRadius:'50%',background:'#'+entry.color.toString(16).padStart(6,'0'),boxShadow:'0 0 0 1px #426a72,0 1px 5px #173c4a88',transform:'translate(-50%,-50%)',pointerEvents:'auto',zIndex:'3',cursor:'pointer'})
    el.onclick=e=>{e.stopPropagation();view.focusPerson(entry.person.id);view.onSelect?.(entry.person.id)}
    view.labelLayer?.append(el);view.outsidePins.set(entry.person.id,el)
  }
  return el
}
export function syncIndoorView(view){
  view.unreachable=view.indoor.unreachable
  view.walkers.clear()
  for(const [id,entry]of view.people){const p=view.indoor.people.get(id);entry.walker=p.walker;entry.queue=p.queue;entry.hasCoffee=p.hasCoffee;entry.presentationVisible=outsidePerson(p);entry.inView=entry.presentationVisible;entry.figure.visible=entry.presentationVisible;entry.figure.position.set(p.x,view.personElevation(p),-p.y);entry.figure.rotation.y=p.heading;if(p.walker)view.walkers.add(id)
    const key=p.walker?.moving?p.walker.event.key+':'+p.walker.phase:null
    if(key&&entry.indoorRouteKey!==key){
      if(entry.indoorRoute){entry.indoorRoute.removeFromParent();entry.indoorRoute.geometry.dispose();entry.indoorRoute.material.dispose()}
      entry.indoorRoute=new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.walker.points.map(q=>new THREE.Vector3(q.x,view.personElevation(q)+.3,-q.y))),new THREE.LineBasicMaterial({color:view.brandColors.get(p.walker.event.brand_id)||0xd88439,transparent:true,opacity:.8}));view.routeLayer.add(entry.indoorRoute);entry.indoorRouteKey=key
    }
    if(entry.indoorRoute)entry.indoorRoute.visible=Boolean(key)
  }
  if(view.indoorUiRevision!==view.indoor.revision){view.indoorUiRevision=view.indoor.revision;view.onIndoor?.({...view.indoor.snapshot,accounting:view.indoor.accounting});updateIndoorGlow(view)}
  const stats=view.getStats(),key=JSON.stringify(stats);if(key!==view.indoorStatsKey){view.indoorStatsKey=key;view.emitStats()}
  view.invalidate()
}
export function updateIndoorGlow(view){
  for(const [id,glow]of view.indoorGlows||[]){const count=view.indoor.snapshot.buildings[id]?.length||0,selected=view.indoorSelectedBuilding===id;glow.visible=view.indoorPreview?.buildingId!==id&&(count>0||selected);glow.material.color.set(selected?0xe8bc56:0xffffff);glow.material.opacity=selected?.35:Math.min(.14,Math.log1p(count)*.035)}
}
export function focusIndoorBuilding(view,id){
  const b=view.campus.buildings.find(b=>b.osm_id===id);if(!b)return
  view.indoorSelectedBuilding=id;updateIndoorGlow(view)
  if(view.host?.dataset)view.host.dataset.focusedBuilding=id
  if(view.camera&&view.controls){const c=polygonCenter(b.polygon),span=Math.max(...b.polygon.map(p=>Math.hypot(p[0]-c.x,p[1]-c.y))),target=new THREE.Vector3(c.x,b.height_m/2,-c.y),normal=view.indoor.byBuilding.get(id)?.outward||[.7,-.7],distance=span*2+65;view.controls.target.copy(target);view.camera.position.copy(target).add(new THREE.Vector3(normal[0]*distance,span+45,-normal[1]*distance));view.controls.update();view.overviewActive=false}
  view.invalidate()
}
export function indoorScreen(view){
  const width=Math.max(1,view.host.clientWidth),height=Math.max(1,view.host.clientHeight);view.camera.updateMatrixWorld()
  for(const entry of view.people.values()){
    if(!entry.presentationVisible){entry.figure.visible=false;entry.inView=false;view.outsidePins?.get(entry.person.id)?.remove();view.outsidePins?.delete(entry.person.id);continue}
    const p=entry.record,projected=entry.figure.position.clone().project(view.camera);entry.inView=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<1.15&&Math.abs(projected.y)<1.15
    const scale=Math.min(2.8,personScaleForCamera(view.camera,entry.figure.position,{width,height,minPixels:12}));entry.figure.scale.setScalar(scale*Math.max(.02,p.transitionScale));entry.figure.visible=entry.inView;entry.base.visible=true;entry.walkHalo.visible=Boolean(p.walker?.moving)
    if(view.labelLayer){const el=outsidePin(view,entry);el.style.display=entry.inView?'block':'none';el.style.left=(projected.x+1)*width/2+'px';el.style.top=(1-projected.y)*height/2+'px'}
  }
  const selected=view.people.get(view.selectedId),shown=selected?.presentationVisible&&selected.inView
  if(view.selection){view.selection.visible=Boolean(shown);if(shown){view.selection.position.copy(selected.figure.position).y+=.12;view.selection.scale.setScalar(selected.figure.scale.x)}}
  if(view.personNameLabel){view.personNameLabel.style.display=shown?'block':'none';if(shown){const p=selected.figure.position.clone().add(new THREE.Vector3(0,9*selected.figure.scale.x,0)).project(view.camera);view.personNameLabel.textContent=`${selected.person.name} · ${selected.person.role_label}`;view.personNameLabel.style.left=Math.max(5,Math.min(width-190,(p.x+1)*width/2-65))+'px';view.personNameLabel.style.top=Math.max(5,(1-p.y)*height/2-24)+'px'}}
  const items=[]
  for(const label of view.labels){const count=view.indoor.snapshot.buildings[label.id]?.length||0;label.badge.textContent=`${count} 人`;label.badge.style.display=count?'inline-block':'none';const p=label.position.clone().project(view.camera),visible=count>0&&view.camera.position.distanceTo(label.position)<3000&&p.z>-1&&p.z<1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1;label.element.style.display=visible?'block':'none';label.leader.style.display=visible?'':'none';if(visible)items.push({id:label.id,x:(p.x+1)*width/2,y:(1-p.y)*height/2,width:label.width,height:label.height})}
  const placed=new Map(layoutLabels(items,{width,height,padding:10,gap:5}).map(p=>[p.id,p]))
  for(const label of view.labels){const p=placed.get(label.id);if(!p)continue;Object.assign(label.element.style,{left:p.left+'px',top:p.top+'px',width:p.width+'px'});label.leader.setAttribute('x1',p.anchorX);label.leader.setAttribute('y1',p.anchorY);label.leader.setAttribute('x2',p.left+p.width/2);label.leader.setAttribute('y2',p.top+p.height/2)}
  view.doorLabels??=new Map()
  for(const [id,door]of view.doorMarkers?.frames||[]){
    let el=view.doorLabels.get(id);const pos=new THREE.Vector3(door.pose.x,view.personElevation({x:door.pose.x,y:door.pose.y})+door.pose.height+2,-door.pose.y),p=pos.clone().project(view.camera)
    const shown=(id===view.indoorSelectedBuilding||view.camera.position.distanceTo(pos)<260)&&p.z>-1&&p.z<1&&Math.abs(p.x)<1&&Math.abs(p.y)<1
    if(!shown){if(el)el.style.display='none';continue}
    if(!el){el=document.createElement('span');el.textContent='入口';el.setAttribute('data-door-building',id);Object.assign(el.style,{position:'absolute',padding:'2px 6px',background:'#174844',color:'#fff5d8',border:'1px solid #e6c57e',borderRadius:'4px',font:'600 12px/18px Microsoft YaHei,sans-serif',transform:'translate(-50%,-100%)',zIndex:'2'});view.labelLayer?.append(el);view.doorLabels.set(id,el)}
    el.style.display='block';el.style.left=(p.x+1)*width/2+'px';el.style.top=(1-p.y)*height/2+'px'
  }
}
