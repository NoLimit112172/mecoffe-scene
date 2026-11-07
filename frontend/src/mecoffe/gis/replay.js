import {displayRoleColor} from '../characterDisplay.js'
import {indexScene} from '../replay.js'
import {cursorAtPosition,advancePosition,positionAtCursor} from '../campus3dPlayback.js'
import {IndoorMotion,INDOOR_DEFAULTS} from '../indoorMotion.js'
import {localToLngLat,ROLE_COLORS} from './model.js'
export const DISPLAY_ROUTE_HEADWAY=INDOOR_DEFAULTS.headwaySeconds
export function nextDisplayDeparture(previous,now){return Math.max(now,(previous??-Infinity)+DISPLAY_ROUTE_HEADWAY)}
export class GisReplay {
  constructor(scenario){
    this.scenario=scenario;this.campus=scenario.files['campus3d.json'];this.position=0;this.cursor=0;this.drainSeconds=0;this.emptyPeople=new Map()
    const data=(scenario.manifest.simulation_data || scenario.manifest.preview_mode==='config')?scenario.files['trajectory.json']:null
    this.index=data?indexScene(data):null
    this.entrances=scenario.files['entrances.json']
    if(data){this.motion=new IndoorMotion({campus:this.campus,mapping:scenario.files['location_mapping.json'],index:this.index,entrances:this.entrances,landcovers:scenario.files['landcover.json'].features});this.routing=this.motion.routing}
  }
  get people(){return this.motion?.people||this.emptyPeople}
  get seconds(){return (this.motion?.tick||0)/INDOOR_DEFAULTS.hz}
  get maxPosition(){return this.index?.days.length??this.scenario.manifest.simulation_time.steps}
  get unreachable(){return this.motion?.unreachable||0}
  get active(){return this.motion?.active||0}
  get pending(){return this.motion?.pending||0}
  get occupancy(){return this.motion?.snapshot||{buildings:{},persons:{},inside:0}}
  seek(position){this.position=Math.max(0,Math.min(this.maxPosition,Number(position)||0));this.cursor=this.index?cursorAtPosition(this.index,this.position):0;this.drainSeconds=0;this.motion?.reset();this.motion?.sync(this.position)}
  event(event){this.motion?.event(event)}
  prepare(signal){return this.motion?.prepareRoutes(signal)||Promise.resolve()}
  admit(){this.motion?.admit()}
  advance(milliseconds,speed=1){
    const delta=Math.min(250,Math.max(0,milliseconds))/1000*Math.max(0,speed)
    if(this.index){const before=this.position;this.position=advancePosition(this.index,this.position,milliseconds,speed,12);this.cursor=cursorAtPosition(this.index,this.position);if(before===this.maxPosition)this.drainSeconds+=delta;this.motion.sync(this.position,this.drainSeconds)}
    else this.position=Math.min(this.maxPosition,this.position+delta/12)
  }
  previewPosition(){return this.index?positionAtCursor(this.index,Math.max(0,this.index.scene.events.findIndex(e=>e.type==='purchase'))):0}
  personLocation(id){return this.motion?.personLocation(id)||{inside:false}}
  personData(){return (this.motion?.outside||[]).map(p=>({...p,lngLat:localToLngLat(p,this.campus.projection)}))}
  pointFeatures(ready=new Set()){
    return {type:'FeatureCollection',features:this.personData().map(p=>({type:'Feature',id:p.id,geometry:{type:'Point',coordinates:p.lngLat},properties:{id:p.id,name:p.person.name,role:p.person.role,color:displayRoleColor(p.person.role,ROLE_COLORS),walking:Boolean(p.walker?.moving),modelReady:ready.has(p.id)}}))}
  }
  routeFeatures(){return {type:'FeatureCollection',features:this.personData().filter(p=>p.walker&&['outbound','return'].includes(p.walker.phase)).map(p=>({type:'Feature',id:p.id,properties:{id:p.id},geometry:{type:'LineString',coordinates:p.walker.points.map(q=>localToLngLat(q,this.campus.projection))}}))}}
  dispose(){this.motion?.people.clear();this.motion?.routes.clear()}
}
