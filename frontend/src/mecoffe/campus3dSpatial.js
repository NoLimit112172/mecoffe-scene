// Presentation-space rules. Source OSM/A* data and OASIS events stay immutable.
import { pointInRing, segmentDistance } from './campus3dEnvironmentModel.js'

const EPS=1e-7
const FOOT_DIRECTIONS=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[.707,-.707],[-.707,.707],[-.707,-.707]]
export const WATER_SETTINGS=Object.freeze({surface:-.55,shallowDepth:.22,maxDepth:2.8,bankWidth:1.8,footRadiusRatio:.18})
const asPoint=p=>Array.isArray(p)?{x:p[0],y:p[1]}:p
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})
const bounds=ring=>({minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minY:Math.min(...ring.map(p=>p[1])),maxY:Math.max(...ring.map(p=>p[1]))})
const inBounds=(p,b,pad=0)=>p.x>=b.minX-pad&&p.x<=b.maxX+pad&&p.y>=b.minY-pad&&p.y<=b.maxY+pad

function intersectionT(a,b,c,d) {
  const rx=b.x-a.x,ry=b.y-a.y,sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx
  if(Math.abs(den)<EPS)return null
  const qx=c[0]-a.x,qy=c[1]-a.y,t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den
  return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS?Math.max(0,Math.min(1,t)):null
}
function cuts(a,b,rings) {
  const result=[0,1]
  for(const ring of rings)for(let i=0;i<ring.length-1;i++){
    const t=intersectionT(a,b,ring[i],ring[i+1]);if(t!==null)result.push(t)
  }
  return result.sort((a,b)=>a-b).filter((t,i,list)=>!i||t-list[i-1]>EPS)
}
export function waterIntervals(a,b,ring) {
  a=asPoint(a);b=asPoint(b)
  const list=cuts(a,b,[ring]),intervals=[]
  for(let i=1;i<list.length;i++)if(pointInRing(mix(a,b,(list[i-1]+list[i])/2),ring))intervals.push([list[i-1],list[i]])
  return intervals
}
export function bridgePolygon(a,b,width) {
  const length=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/length*width/2,ny=(b.x-a.x)/length*width/2
  return [[a.x+nx,a.y+ny],[a.x-nx,a.y-ny],[b.x-nx,b.y-ny],[b.x+nx,b.y+ny],[a.x+nx,a.y+ny]]
}

export function buildSpatialEnvironment(campus,landcovers=[],settings={}) {
  const options={...WATER_SETTINGS,...settings}
  const waters=landcovers.filter(f=>(f.kind||f.properties?.kind)==='water'||f.properties?.natural==='water').map(f=>({
    osm_id:f.osm_id,name:f.name||f.properties?.name||'水域',kind:'water',polygon:f.polygon||f.geometry.coordinates[0],holes:[],
    settings:options,bridges:[],illustrative_depth:true,cache:new Map(),
  }))
  const bridges=[]
  for(const water of waters) {
    water.bounds=bounds(water.polygon)
    for(const road of campus.roads||[])for(let i=1;i<road.points.length;i++) {
      if(road.tunnel)continue
      const a=asPoint(road.points[i-1]),b=asPoint(road.points[i]),length=Math.hypot(b.x-a.x,b.y-a.y)
      if(length<EPS)continue
      for(const [lo,hi]of waterIntervals(a,b,water.polygon)) {
        if((hi-lo)*length<.9)continue
        const approach=10,start=mix(a,b,lo-approach/length),end=mix(a,b,hi+approach/length)
        const width=['footway','path','pedestrian','steps'].includes(road.highway)?8:10
        const bridge={id:`bridge:${road.osm_id}:${i}:${bridges.length}`,road_id:road.osm_id,water_id:water.osm_id,
          start,end,wetStart:mix(a,b,lo),wetEnd:mix(a,b,hi),width,approach,deckHeight:Number(road.layer)<0?.28:1.05,roadHeight:.14,
          style:Number(road.layer)<0?'road-surface':'bridge',original_layer:road.layer??'0',
          polygon:bridgePolygon(start,end,width),source:'OSM road/water intersection',illustrative:true,verified_bridge:false,
          grade_note:'Road/water overlap resolved in display only. A negative layer alone is not an explicit tunnel; source tags are unchanged.'}
        // Adjacent source segments may overlap: one physical straight crossing
        // is drawn once, while all source identities remain in provenance.
        const duplicate=bridges.find(other=>other.water_id===water.osm_id&&Math.hypot(other.wetStart.x-bridge.wetStart.x,other.wetStart.y-bridge.wetStart.y)<1&&Math.hypot(other.wetEnd.x-bridge.wetEnd.x,other.wetEnd.y-bridge.wetEnd.y)<1)
        if(!duplicate){bridges.push(bridge);water.bridges.push(bridge)}
      }
    }
    water.portals=water.bridges.flatMap(bridge=>[bridge.start,bridge.end])
  }
  const areas=(campus.boundary_polygons?.length?campus.boundary_polygons:[{outer:campus.boundary||[],holes:[]}]).filter(a=>a.outer.length>=4)
  const boundary=areas.length?{kind:'campus-boundary',osm_id:'display-campus-area',polygon:areas[0].outer,holes:[],areas}:null
  return {waters,bridges,boundary,obstacles:[...(boundary?[boundary]:[]),...(campus.buildings||[]),...waters],settings:options}
}

export function campusPointClear(point,boundary,radius=0) {
  return boundary.areas.some(area=>pointInRing(point,area.outer)&&!(area.holes||[]).some(h=>pointInRing(point,h))
    &&[area.outer,...(area.holes||[])].every(ring=>ring.slice(1).every((p,i)=>segmentDistance(point,ring[i],p)>=radius-1e-6)))
}
export function campusSegmentClear(a,b,boundary,radius=0) {
  if(!campusPointClear(a,boundary,radius)||!campusPointClear(b,boundary,radius))return false
  const rings=boundary.areas.flatMap(area=>[area.outer,...(area.holes||[])]),intervals=cuts(a,b,rings)
  if(!intervals.slice(1).every((t,i)=>campusPointClear(mix(a,b,(t+intervals[i])/2),boundary,0)))return false
  if(radius>0)for(const ring of rings)for(let i=1;i<ring.length;i++){
    const c=asPoint(ring[i-1]),d=asPoint(ring[i])
    if(intersectionT(a,b,ring[i-1],ring[i])!==null)return false
    if(Math.min(segmentDistance(a,ring[i-1],ring[i]),segmentDistance(b,ring[i-1],ring[i]),
      segmentDistance(c,[a.x,a.y],[b.x,b.y]),segmentDistance(d,[a.x,a.y],[b.x,b.y]))<radius-1e-6)return false
  }
  return true
}

function openWaterAt(point,water) {
  return inBounds(point,water.bounds)&&pointInRing(point,water.polygon)&&!water.bridges.some(b=>pointInRing(point,b.polygon))
}
export function waterPointClear(point,water,radius=0) {
  // Crowd separation reserves a large visual disc; the contact footprint is
  // smaller. On a bridge the existing swept crowd rules enforce queuing.
  const foot=Math.max(0,radius)*water.settings.footRadiusRatio
  if(!inBounds(point,water.bounds,foot))return true
  return FOOT_DIRECTIONS.every(([x,y])=>!openWaterAt({x:point.x+x*foot,y:point.y+y*foot},water))
}
export function waterSegmentClear(a,b,water,radius=0) {
  const foot=Math.max(0,radius)*water.settings.footRadiusRatio,box=water.bounds
  if(Math.max(a.x,b.x)<box.minX-foot||Math.min(a.x,b.x)>box.maxX+foot||Math.max(a.y,b.y)<box.minY-foot||Math.min(a.y,b.y)>box.maxY+foot)return true
  const key=`${a.x},${a.y}:${b.x},${b.y}:${radius}`
  if(water.cache.has(key))return water.cache.get(key)
  const rings=[water.polygon,...water.bridges.map(bridge=>bridge.polygon)]
  const clear=FOOT_DIRECTIONS.every(([x,y])=>{
    const from={x:a.x+x*foot,y:a.y+y*foot},to={x:b.x+x*foot,y:b.y+y*foot}
    if(openWaterAt(from,water)||openWaterAt(to,water))return false
    const intervals=cuts(from,to,rings)
    return intervals.slice(1).every((t,i)=>!openWaterAt(mix(from,to,(t+intervals[i])/2),water))
  })
  if(water.cache.size>30000)water.cache.clear()
  water.cache.set(key,clear)
  return clear
}
export function waterDepthAt(point,water) {
  point=asPoint(point)
  if(!pointInRing(point,water.polygon))return 0
  let shore=Infinity
  for(let i=1;i<water.polygon.length;i++)shore=Math.min(shore,segmentDistance(point,water.polygon[i-1],water.polygon[i]))
  const {shallowDepth,maxDepth}=water.settings
  const undulation=.76+.24*Math.sin(point.x*.057)*Math.cos(point.y*.037)
  return Math.min(maxDepth,shallowDepth+(maxDepth-shallowDepth)*(1-Math.exp(-shore/6))*undulation)
}
export function bridgeHeightAt(point,bridge) {
  point=asPoint(point)
  if(!pointInRing(point,bridge.polygon))return null
  const dx=bridge.end.x-bridge.start.x,dy=bridge.end.y-bridge.start.y,length=Math.hypot(dx,dy)
  const along=((point.x-bridge.start.x)*dx+(point.y-bridge.start.y)*dy)/(length||1)
  const ramp=Math.max(0,Math.min(1,along/bridge.approach,(length-along)/bridge.approach))
  return bridge.roadHeight+(bridge.deckHeight-bridge.roadHeight)*ramp
}
