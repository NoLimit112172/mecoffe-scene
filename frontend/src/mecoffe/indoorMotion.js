// One deterministic presentation clock and occupancy model for GIS and sandbox.
// No new OASIS locations/actions and no edits to the original A* graph.
import {createRouting,routeBetweenMappings,resolveHomeKey,brandLocationKey} from './campus3dRouting.js'
import {positionAtCursor} from './campus3dPlayback.js'
import {tripQueueEntries} from './renderPerformance.js'
import {displayRoutePoints} from './campus3dCrowd.js'
import {buildSpatialEnvironment} from './campus3dSpatial.js'

export const INDOOR_DEFAULTS=Object.freeze({doorSeconds:.5,shopSeconds:6,speedMps:100,headwaySeconds:.4,secondsPerDay:12,hz:60})
const point=p=>({x:p[0],y:p[1]})
export const outsidePerson=p=>Boolean(p.walker&&!['waiting','dwell'].includes(p.walker.phase))
export const indoorBuilding=p=>!p.walker||p.walker.phase==='waiting'?p.homeBuilding:p.walker.phase==='dwell'?p.walker.shopBuilding:null
export function auditPeople(people,buildingIds){
  const ids=new Set(),issues=[];let inside=0,visible=0
  for(const p of people){
    if(ids.has(p.id))issues.push(`${p.id}: duplicate`);ids.add(p.id)
    const building=indoorBuilding(p),outside=outsidePerson(p)
    if(outside){visible++;if(!Number.isFinite(p.x)||!Number.isFinite(p.y))issues.push(`${p.id}: invalid position`)}
    else if(building&&buildingIds.has(building))inside++
    else issues.push(`${p.id}: no building`)
    if(Boolean(building)===outside)issues.push(`${p.id}: ambiguous state`)
  }
  const total=ids.size,accounted=inside+visible
  return {total,visible,inside,accounted,unassigned:total-accounted,valid:issues.length===0&&accounted===total,issues}
}
export function indoorSnapshot(people){
  const buildings={},persons={}
  for(const p of people){const id=indoorBuilding(p);persons[p.id]={buildingId:id,phase:p.walker?.phase||'home',outside:outsidePerson(p)};if(id)(buildings[id]||=[]).push(p.id)}
  for(const ids of Object.values(buildings))ids.sort()
  return {buildings,persons,inside:Object.values(buildings).reduce((n,ids)=>n+ids.length,0)}
}
export function displayDate(time,position,index){
  if(!time)return null
  const offset=index?.days[0]?.step===0?1:0,pos=Math.max(0,position-offset)
  const lastStep=index?Math.max(1,...index.days.map(day=>day.step)):time.steps
  const k=Math.min(time.steps-1,lastStep-1,Math.floor(pos)),date=time.intervals[k].start.slice(0,10)
  return {label:`第 ${k+1} ${time.step_unit==='hour'?'小时':'天'} · ${date}`,progress:Math.round((position>=(index?.days.length??time.steps)?1:pos%1)*100)}
}
export class IndoorMotion {
  constructor({campus,mapping,index,entrances,landcovers=[],options={}}){
    if(entrances?.schema_version!=='mecoffe.entrances.v1')throw new Error('场景缺少楼栋入口，请重新生成场景')
    this.campus=campus;this.mapping=mapping;this.index=index;this.entrances=entrances;this.options={...INDOOR_DEFAULTS,...options}
    this.routing=createRouting(campus,mapping);this.byBuilding=new Map();this.routes=new Map();this.people=new Map();this.revision=0
    this.buildingIds=new Set(campus.buildings.map(b=>b.osm_id))
    const byEntrance=new Map(entrances.entrances.map(e=>[e.id,e]))
    for(const e of entrances.entrances){if(this.byBuilding.has(e.building_id)&&!index?.scene.meta?.scene_result)throw new Error('每栋楼只能有一个推断入口');if(!this.byBuilding.has(e.building_id))this.byBuilding.set(e.building_id,e)}
    for(const [key,anchor]of this.routing.anchors){const entry=mapping.mappings[key],door=entry.entrance_id?byEntrance.get(entry.entrance_id):this.byBuilding.get(anchor.building.osm_id);if(!door||door.building_id!==anchor.building.osm_id||!this.routing.nodes.has(door.road_node_id))throw new Error('楼栋入口与步行图不匹配');anchor.node=this.routing.nodes.get(door.road_node_id);anchor.door=door}
    this.obstacles=buildSpatialEnvironment(campus,landcovers).obstacles
    for(const person of index?.scene.people||[]){if(person.out_of_scene)continue;const key=resolveHomeKey(person),anchor=this.routing.anchors.get(key);if(!anchor)throw new Error('人物缺少楼栋映射');this.people.set(person.id,{id:person.id,person,key,homeBuilding:anchor.building.osm_id,homeDoor:anchor.door,home:point(anchor.door.point),...point(anchor.door.point),heading:0,queue:[],walker:null,hasCoffee:false,transitionScale:1})}
    this.purchases=(index?.scene.events||[]).flatMap((event,i)=>event.type==='purchase'&&(!event.outcome||event.outcome==='executed')?[{event,tick:Math.floor(positionAtCursor(index,i+1)*this.options.secondsPerDay*this.options.hz+1e-7)}]:[])
    this.reset()
  }
  reset(){this.tick=0;this.nextPurchase=0;this.unreachable=0;this.seen=new Set();this.departures=new Map();for(const p of this.people.values())Object.assign(p,{...p.home,walker:null,queue:[],hasCoffee:false,transitionScale:1});this.revision++}
  sync(position,drainSeconds=0){
    const eventLimit=Math.floor(position*this.options.secondsPerDay*this.options.hz+1e-7)
    const target=Math.floor((position*this.options.secondsPerDay+drainSeconds)*this.options.hz+1e-7)
    if(target<this.tick)this.reset()
    while(this.tick<target){this.tick++;while(this.purchases[this.nextPurchase]?.tick<=Math.min(this.tick,eventLimit))this.event(this.purchases[this.nextPurchase++].event);this.admit();for(const p of this.people.values())this.move(p,1/this.options.hz)}
  }
  event(event){
    if(event.type!=='purchase'||(event.outcome&&event.outcome!=='executed'))return
    const p=this.people.get(event.actor),order=event.order_id||event.key;if(!p||this.seen.has(order))return;this.seen.add(order)
    const path=this.pathFor(p,brandLocationKey(this.index,event.brand_id));if(!path){this.unreachable++;return}p.queue.push({event,...path})
  }
  pathFor(p,target){
    const key=p.key+'|'+target
    if(!this.routes.has(key)){
      const route=routeBetweenMappings(this.routing,p.key,target),a=this.routing.anchors.get(p.key)?.door,b=this.routing.anchors.get(target)?.door
      if(!route||!a||!b){this.routes.set(key,null)}else{
        const core=displayRoutePoints(route.points,this.obstacles,{radius:2.7,laneOffset:4})
        const back=displayRoutePoints([...route.points].reverse(),this.obstacles,{radius:2.7,laneOffset:4})
        const points=[...a.connector.map(point),...core,...[...b.connector].reverse().map(point)]
        const clean=points.filter((q,i)=>!i||Math.hypot(q.x-points[i-1].x,q.y-points[i-1].y)>1e-6)
        const returning=[...b.connector.map(point),...back,...[...a.connector].reverse().map(point)]
        this.routes.set(key,{route,points:clean,returning,shopBuilding:b.building_id,shopDoor:b})
      }
    }
    return this.routes.get(key)
  }
  async prepareRoutes(signal){
    for(const {event}of this.purchases){
      if(signal?.aborted)throw new DOMException('场景加载已取消','AbortError')
      const p=this.people.get(event.actor),target=brandLocationKey(this.index,event.brand_id)
      if(p&&!this.routes.has(p.key+'|'+target)){this.pathFor(p,target);await new Promise(resolve=>setTimeout(resolve,0))}
    }
  }
  admit(){
    for(const p of tripQueueEntries(this.people.values(),this.active,12,2)){
      const next=p.queue.shift(),key=next.route.node_ids.join('>'),now=this.tick/this.options.hz
      const at=Math.max(now,(this.departures.get(key)??-Infinity)+this.options.headwaySeconds);this.departures.set(key,at)
      p.hasCoffee=false;p.transitionScale=0;p.walker={...next,phase:'waiting',until:at,elapsed:0,next:1,moving:false}
    }
  }
  move(p,delta){
    const w=p.walker;if(!w)return
    const change=phase=>{w.phase=phase;w.elapsed=0;w.moving=['outbound','return'].includes(phase);this.revision++}
    if(w.phase==='waiting'){if(this.tick/this.options.hz<w.until)return;change('exit-home')}
    if(['exit-home','exit-shop','enter-shop','enter-home'].includes(w.phase)){
      w.elapsed+=delta;const f=Math.min(1,w.elapsed/this.options.doorSeconds);p.transitionScale=w.phase.startsWith('exit')?f:1-f
      const door=w.phase.endsWith('home')?p.homeDoor:w.shopDoor
      if(door.outward){const inward=w.phase.startsWith('enter')?f:1-f;p.x=door.point[0]-door.outward[0]*2*inward;p.y=door.point[1]-door.outward[1]*2*inward;p.heading=Math.atan2(door.outward[0],-door.outward[1])+(w.phase.startsWith('enter')?Math.PI:0)}
      if(f<1)return
      if(w.phase==='enter-home'){p.walker=null;Object.assign(p,p.home);p.transitionScale=1;this.revision++;return}
      if(w.phase==='enter-shop'){change('dwell');p.transitionScale=0;return}
      if(w.phase==='exit-shop'){w.points=w.returning;w.next=1;change('return')}else change('outbound')
      return
    }
    if(w.phase==='dwell'){w.elapsed+=delta;if(w.elapsed>=this.options.shopSeconds){p.hasCoffee=true;change('exit-shop')}return}
    let budget=this.options.speedMps*delta
    while(budget>0){const q=w.points[w.next];if(!q){change(w.phase==='outbound'?'enter-shop':'enter-home');break}
      const dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),f=d<1e-9?1:Math.min(1,budget/d)
      if(d)p.heading=Math.atan2(dx,-dy);p.x+=dx*f;p.y+=dy*f;budget-=d*f;if(f===1)w.next++;else break
    }
  }
  get active(){return [...this.people.values()].filter(p=>p.walker).length}
  get pending(){return this.active+[...this.people.values()].reduce((n,p)=>n+p.queue.length,0)}
  get snapshot(){if(this.lastRevision!==this.revision){this.lastRevision=this.revision;this.lastSnapshot=indoorSnapshot(this.people.values())}return this.lastSnapshot}
  get outside(){return [...this.people.values()].filter(outsidePerson)}
  get accounting(){const value=auditPeople(this.people.values(),this.buildingIds);if(!this.index?.scene.meta?.scene_result)return value;const out=this.index.scene.people.filter(p=>p.out_of_scene).length;return {...value,total:value.total+out,accounted:value.accounted+out,out_of_scene:out}}
  personLocation(id){if(this.index?.people.get(id)?.out_of_scene)return {buildingId:null,name:'场景外',inside:false,phase:'out_of_scene'};const p=this.people.get(id),insideId=p&&indoorBuilding(p),phase=p?.walker?.phase||'home',buildingId=insideId||(['enter-shop','exit-shop'].includes(phase)?p.walker.shopBuilding:['enter-home','exit-home'].includes(phase)?p.homeBuilding:null),building=this.campus.buildings.find(b=>b.osm_id===buildingId);return {buildingId,name:building?.name||'',inside:Boolean(insideId),phase}}
}
