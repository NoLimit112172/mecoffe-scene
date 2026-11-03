// Display-only metres. No values here are surveyed elevations or routing data.
import { prototypeParams } from './assetCatalog.js'
import { pointInRing, segmentDistance } from './campus3dEnvironmentModel.js'

export const TERRAIN_LEVELS = Object.freeze({
  baseBottom: -19, stoneTop: -13, earthTop: -5.1, outsideTop: -3.8,
  externalRoadBottom: -3.7, externalRoad: -3, externalSidewalk: -2.48, externalCurb: -2.34,
  campusPlinth: .08, campusRoad: .14, campusGrass: .62, campusCurb: .72, buildingBase: .94,
})
export const TERRAIN_BASE_PADDING = 135
const EPS = 1e-7
const PATHS = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway'])
export function campusRoadWidth(road) { return prototypeParams(PATHS.has(road.highway) ? 'road.footway' : 'road.campus').width_m }
export function signedArea(points) { return points.reduce((a,p,i)=>{const q=points[(i+1)%points.length];return a+p[0]*q[1]-q[0]*p[1]},0)/2 }
export function openRing(ring) {
  const points = ring.map(point=>point.slice(0,2))
  if (points.length>1 && Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<EPS) points.pop()
  return points
}
function boundsOf(points) { return {minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))} }
function overlaps(a,b) { return a.minX<=b.maxX+EPS&&a.maxX>=b.minX-EPS&&a.minY<=b.maxY+EPS&&a.maxY>=b.minY-EPS }
function clipSide(points,a,b,keepInside) {
  const cross=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
  const out=[]
  for(let i=0;i<points.length;i++) {
    const p=points[i],q=points[(i+1)%points.length],cp=cross(p),cq=cross(q)
    const pin=keepInside?cp>=-EPS:cp<=EPS,qin=keepInside?cq>=-EPS:cq<=EPS
    if(pin)out.push(p.slice())
    if(pin!==qin){const t=cp/(cp-cq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])])}
  }
  return out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>EPS)
}

/** Exact convex polygon subtraction. Kept pieces are convex and disjoint. */
export function subtractConvexPolygon(subject, clip) {
  let candidate=openRing(subject), cutter=openRing(clip)
  if(candidate.length<3)return[]
  if(cutter.length<3 || !overlaps(boundsOf(candidate),boundsOf(cutter)))return[candidate]
  if(signedArea(cutter)<0)cutter.reverse()
  const pieces=[]
  for(let i=0;i<cutter.length&&candidate.length>=3;i++) {
    const a=cutter[i],b=cutter[(i+1)%cutter.length]
    const outside=clipSide(candidate,a,b,false)
    if(outside.length>=3&&Math.abs(signedArea(outside))>EPS)pieces.push(outside)
    candidate=clipSide(candidate,a,b,true)
  }
  return pieces
}

export function subtractTerrainCuts(polygons, cuts) {
  let pieces=polygons.map(openRing).filter(p=>p.length>=3).map(points=>({points,bounds:boundsOf(points)}))
  for(const cut of cuts) {
    const cutBounds=boundsOf(cut), next=[]
    for(const piece of pieces) {
      if(!overlaps(piece.bounds,cutBounds)){next.push(piece);continue}
      for(const points of subtractConvexPolygon(piece.points,cut))next.push({points,bounds:boundsOf(points)})
    }
    pieces=next
  }
  return pieces.map(piece=>piece.points)
}

/** Rectangle/cap union used to cut real road slots out of the turf, not overpaint it. */
export function roadCorridors(roads, extraWidth=0) {
  const shapes=[]
  for(const road of roads) {
    const radius=campusRoadWidth(road)/2+extraWidth, points=road.points||[]
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1])
      if(length<EPS)continue
      const nx=-(b[1]-a[1])/length*radius,ny=(b[0]-a[0])/length*radius
      shapes.push([[a[0]+nx,a[1]+ny],[a[0]-nx,a[1]-ny],[b[0]-nx,b[1]-ny],[b[0]+nx,b[1]+ny]])
    }
    for(const [x,y]of points)shapes.push(Array.from({length:8},(_,i)=>[x+Math.cos(i*Math.PI/4)*radius,y+Math.sin(i*Math.PI/4)*radius]))
  }
  return shapes
}

const terrainRoadCache=new WeakMap()
export function terrainSurfaceHeight(point, campus) {
  const p=Array.isArray(point)?{x:point[0],y:point[1]}:point
  if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw new Error('Terrain point must be finite')
  let segments=terrainRoadCache.get(campus)
  if(!segments){segments=[];for(const road of campus.roads||[]){const radius=campusRoadWidth(road)/2;for(let i=1;i<(road.points||[]).length;i++){const a=road.points[i-1],b=road.points[i];segments.push({a,b,radius,minX:Math.min(a[0],b[0])-radius-EPS,maxX:Math.max(a[0],b[0])+radius+EPS,minY:Math.min(a[1],b[1])-radius-EPS,maxY:Math.max(a[1],b[1])+radius+EPS})}}terrainRoadCache.set(campus,segments)}
  for(const s of segments)if(p.x>=s.minX&&p.x<=s.maxX&&p.y>=s.minY&&p.y<=s.maxY&&segmentDistance(p,s.a,s.b)<=s.radius+EPS)return TERRAIN_LEVELS.campusRoad
  const polygons=campus.boundary_polygons?.length?campus.boundary_polygons:[{outer:campus.boundary||[],holes:[]}]
  return polygons.some(poly=>pointInRing(p,poly.outer)&&!(poly.holes||[]).some(hole=>pointInRing(p,hole)))?TERRAIN_LEVELS.campusGrass:TERRAIN_LEVELS.outsideTop
}

export function terrainBaseBounds(bounds,padding=TERRAIN_BASE_PADDING) {
  if(!Number.isFinite(padding)||padding<0||![bounds.minX,bounds.maxX,bounds.minY,bounds.maxY].every(Number.isFinite))throw new Error('Invalid terrain bounds')
  return {minX:bounds.minX-padding,maxX:bounds.maxX+padding,minY:bounds.minY-padding,maxY:bounds.maxY+padding}
}

/** Small miter-limited presentation footing, independent of footprint/route data. */
export function offsetTerrainRing(ring,distance) {
  const points=openRing(ring),orientation=signedArea(points)>=0?1:-1
  return points.map((p,i)=>{
    const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length]
    const lengthA=Math.hypot(p[0]-a[0],p[1]-a[1]),lengthB=Math.hypot(b[0]-p[0],b[1]-p[1])
    const n1=[orientation*(p[1]-a[1])/(lengthA||1),-orientation*(p[0]-a[0])/(lengthA||1)]
    const n2=[orientation*(b[1]-p[1])/(lengthB||1),-orientation*(b[0]-p[0])/(lengthB||1)]
    const dot=1+n1[0]*n2[0]+n1[1]*n2[1],factor=Math.min(Math.abs(distance)*2,Math.abs(distance)/(Math.max(.2,dot))) * Math.sign(distance)
    return [p[0]+(n1[0]+n2[0])*factor,p[1]+(n1[1]+n2[1])*factor]
  })
}
