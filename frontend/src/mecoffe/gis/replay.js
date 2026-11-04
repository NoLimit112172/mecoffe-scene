import {indexScene} from '../replay.js'
import {cursorAtPosition,advancePosition,positionAtCursor} from '../campus3dPlayback.js'
import {createRouting,routeBetweenMappings,resolveHomeKey} from '../campus3dRouting.js'
import {standingSlots,nearestClearPosition,displayRoutePoints} from '../campus3dCrowd.js'
import {buildSpatialEnvironment} from '../campus3dSpatial.js'
import {tripQueueEntries} from '../renderPerformance.js'
import {localToLngLat,ROLE_COLORS} from './model.js'

/** Presentation playback only. Original OASIS events / A* graph stay immutable.
 * Day/cursor advancement and the 100 display-metres/s speed match the sandbox.
 */
export class GisReplay {
  constructor(scenario){
    this.scenario=scenario;this.campus=scenario.files['campus3d.json'];this.position=0;this.cursor=0;this.seconds=0;this.seen=new Set();this.routes=new Map();this.disposed=false;this.unreachable=0
    const data=scenario.manifest.simulation_data?scenario.files['trajectory.json']:null
    this.index=data?indexScene(data):null;this.people=new Map()
    if(!data)return
    this.routing=createRouting(this.campus,scenario.files['location_mapping.json'])
    const environment=buildSpatialEnvironment(this.campus,scenario.files['landcover.json'].features)
    this.obstacles=environment.obstacles
    const sorted=[...data.people].sort((a,b)=>a.id.localeCompare(b.id))
    const slots=standingSlots(sorted.map(p=>({id:p.id,origin:this.routing.anchors.get(resolveHomeKey(p)).node})),this.obstacles,{radius:2.7,gap:1})
    for(const person of sorted){const home=slots.find(p=>p.id===person.id);this.people.set(person.id,{id:person.id,person,key:resolveHomeKey(person),home:{x:home.x,y:home.y},x:home.x,y:home.y,queue:[],walker:null,hasCoffee:false,heading:0})}
  }
  get maxPosition(){return this.index?.days.length??this.scenario.manifest.simulation_time.steps}
  seek(position){
    this.position=Math.max(0,Math.min(this.maxPosition,Number(position)||0));this.cursor=this.index?cursorAtPosition(this.index,this.position):0;this.seen.clear();this.unreachable=0
    for(const event of this.index?.scene.events.slice(0,this.cursor)||[])if(event.type==='purchase')this.seen.add(event.order_id||event.key)
    for(const entry of this.people.values())Object.assign(entry,{...entry.home,queue:[],walker:null,hasCoffee:false})
  }
  event(event){
    const entry=this.people.get(event.actor)
    if(!entry||event.type!=='purchase'||this.seen.has(event.order_id||event.key))return
    this.seen.add(event.order_id||event.key)
    const key=`${entry.key}|shop_${event.brand_id}`
    if(!this.routes.has(key))this.routes.set(key,routeBetweenMappings(this.routing,entry.key,`shop_${event.brand_id}`))
    const route=this.routes.get(key)
    if(!route){this.unreachable++;return}
    entry.queue.push({event,route})
  }
  admit(){
    const active=[...this.people.values()].filter(e=>e.walker).length
    for(const entry of tripQueueEntries(this.people.values(),active,12,2)){
      const next=entry.queue.shift(),occupied=[...this.people.values()].filter(e=>e!==entry).flatMap(e=>[{x:e.x,y:e.y,radius:2.7},...(e.walker?.servicePoint?[{...e.walker.servicePoint,radius:2.7}]:[])])
      const end=nearestClearPosition(next.route.points.at(-1),this.obstacles,{radius:2.7,occupied})
      const points=displayRoutePoints(next.route.points,this.obstacles,{radius:2.7,laneOffset:4,start:entry,end})
      const returning=displayRoutePoints([...next.route.points].reverse(),this.obstacles,{radius:2.7,laneOffset:4,start:end,end:entry.home})
      entry.hasCoffee=false;entry.walker={...next,points,returning,servicePoint:end,next:1,phase:'outbound',dwell:0}
    }
  }
  advance(milliseconds,speed=1){
    const delta=Math.min(250,Math.max(0,milliseconds))/1000*Math.max(0,speed)
    this.seconds+=delta
    if(this.index){
      const previous=this.cursor
      this.position=advancePosition(this.index,this.position,milliseconds,speed,12)
      this.cursor=cursorAtPosition(this.index,this.position)
      for(let i=previous;i<this.cursor;i++)this.event(this.index.scene.events[i])
      this.admit()
      for(const entry of this.people.values())this.move(entry,delta)
    }else this.position=Math.min(this.maxPosition,this.position+delta/12)
  }
  move(entry,delta){
    const w=entry.walker;if(!w)return
    if(w.phase==='dwell'){
      w.dwell+=delta
      if(w.dwell<.85)return
      w.phase='return';w.points=w.returning;w.next=1
    }
    let remaining=100*delta
    while(remaining>0&&entry.walker){
      const next=w.points[w.next]
      if(!next){
        if(w.phase==='outbound'){w.phase='dwell';entry.hasCoffee=true}else{entry.walker=null;entry.x=entry.home.x;entry.y=entry.home.y}
        break
      }
      const dx=next.x-entry.x,dy=next.y-entry.y,d=Math.hypot(dx,dy),f=d<1e-8?1:Math.min(1,remaining/d)
      if(d>0)entry.heading=Math.atan2(dx,-dy)
      entry.x+=dx*f;entry.y+=dy*f;remaining-=d*f
      if(f===1)w.next++;else break
    }
  }
  get active(){return [...this.people.values()].filter(p=>p.walker).length}
  get pending(){return this.active+[...this.people.values()].reduce((n,p)=>n+p.queue.length,0)}
  previewPosition(){return this.index?positionAtCursor(this.index,Math.max(0,this.index.scene.events.findIndex(e=>e.type==='purchase'))):0}
  personData(){return [...this.people.values()].map(p=>({...p,lngLat:localToLngLat(p,this.campus.projection)}))}
  pointFeatures(ready=new Set()){
    return {type:'FeatureCollection',features:this.personData().map(p=>({type:'Feature',id:p.id,geometry:{type:'Point',coordinates:p.lngLat},properties:{id:p.id,name:p.person.name,role:p.person.role,color:ROLE_COLORS[p.person.role]||'#68868a',walking:Boolean(p.walker),modelReady:ready.has(p.id)}}))}
  }
  routeFeatures(){
    return {type:'FeatureCollection',features:[...this.people.values()].filter(p=>p.walker).map(p=>({type:'Feature',id:p.id,properties:{id:p.id},geometry:{type:'LineString',coordinates:p.walker.points.map(q=>localToLngLat(q,this.campus.projection))}}))}
  }
  dispose(){this.disposed=true;this.people.clear();this.routes.clear()}
}
