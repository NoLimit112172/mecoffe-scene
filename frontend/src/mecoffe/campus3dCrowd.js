// Display geometry only: never writes OSM nodes, A* paths, mappings or events.
import { pointInRing, segmentDistance } from './campus3dEnvironmentModel.js'
import { waterPointClear, waterSegmentClear } from './campus3dSpatial.js'

export const CROWD_GAP = 0.9
export const DISPLAY_RADIUS = 8
const EPS = 1e-6
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)
const array = p => [p.x,p.y]
const cache = new WeakMap()

export function crowdObstacles(buildings = []) {
  if (cache.has(buildings)) return cache.get(buildings)
  const result = buildings.map(building => {
    const ring=building.polygon, holes=building.holes || []
    return {ring,holes,id:building.osm_id,water:building.kind==='water'?building:null,minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),
      minY:Math.min(...ring.map(p=>p[1])),maxY:Math.max(...ring.map(p=>p[1]))}
  })
  cache.set(buildings,result)
  return result
}

export function outsideBuildings(point, buildings, radius = 0) {
  for (const b of crowdObstacles(buildings)) {
    if (point.x < b.minX-radius || point.x > b.maxX+radius || point.y < b.minY-radius || point.y > b.maxY+radius) continue
    if(b.water){if(!waterPointClear(point,b.water,radius))return false;continue}
    if (pointInRing(point,b.ring) && !b.holes.some(ring=>pointInRing(point,ring))) return false
    for (const ring of [b.ring,...b.holes]) for(let i=0;i<ring.length;i++) {
      if(segmentDistance(point,ring[i],ring[(i+1)%ring.length]) < radius-EPS) return false
    }
  }
  return true
}

function orientation(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
function edgesIntersect(a,b,c,d) {
  const p=orientation(a,b,c),q=orientation(a,b,d),r=orientation(c,d,a),s=orientation(c,d,b)
  return p*q < -EPS && r*s < -EPS
}

export function clearDisplaySegment(a,b,buildings,radius=0) {
  if(!outsideBuildings(a,buildings,radius)||!outsideBuildings(b,buildings,radius))return false
  for(const obstacle of crowdObstacles(buildings)) {
    if(Math.max(a.x,b.x)<obstacle.minX-radius || Math.min(a.x,b.x)>obstacle.maxX+radius
      ||Math.max(a.y,b.y)<obstacle.minY-radius || Math.min(a.y,b.y)>obstacle.maxY+radius)continue
    if(obstacle.water){if(!waterSegmentClear(a,b,obstacle.water,radius))return false;continue}
    for(const ring of [obstacle.ring,...obstacle.holes])for(let i=0;i<ring.length;i++) {
      const c={x:ring[i][0],y:ring[i][1]},d={x:ring[(i+1)%ring.length][0],y:ring[(i+1)%ring.length][1]}
      if(edgesIntersect(a,b,c,d))return false
      if(Math.min(segmentDistance(a,array(c),array(d)),segmentDistance(b,array(c),array(d)),
        segmentDistance(c,array(a),array(b)),segmentDistance(d,array(a),array(b)))<radius-EPS)return false
    }
    if(pointInRing({x:(a.x+b.x)/2,y:(a.y+b.y)/2},obstacle.ring)
      && !obstacle.holes.some(ring=>pointInRing({x:(a.x+b.x)/2,y:(a.y+b.y)/2},ring)))return false
  }
  return true
}

export function nearestClearPosition(desired, buildings, { radius=DISPLAY_RADIUS, obstacleRadius=radius, occupied=[], gap=CROWD_GAP, roads=[], roadClearance=0 }={}) {
  const valid=p=>outsideBuildings(p,buildings,obstacleRadius) && occupied.every(q=>distance(p,q)>=radius+(q.radius??radius)+gap-EPS)
    && roads.every(road=>(road.points || road).slice(1).every((b,i)=>segmentDistance(p,
      Array.isArray((road.points||road)[i])?(road.points||road)[i]:array((road.points||road)[i]),Array.isArray(b)?b:array(b))>=roadClearance+radius))
  if(valid(desired))return {x:desired.x,y:desired.y,radius}
  // Deterministic concentric slots, with global reservation across all doors.
  const stride=Math.max(1.25,radius*.65)
  for(let ring=1;ring<=220;ring++) {
    const reach=ring*stride,count=Math.max(16,Math.ceil(2*Math.PI*reach/stride))
    for(let n=0;n<count;n++) {
      const angle=n/count*Math.PI*2,p={x:desired.x+Math.cos(angle)*reach,y:desired.y+Math.sin(angle)*reach}
      if(valid(p))return {...p,radius}
    }
  }
  throw new Error('展示空间不足，无法分配不重叠的站位')
}

export function standingSlots(descriptors,buildings,{radius=DISPLAY_RADIUS,gap=CROWD_GAP,roads=[]}={}) {
  const slots=[]
  for(const entry of [...descriptors].sort((a,b)=>a.id.localeCompare(b.id))) {
    const place=nearestClearPosition(entry.origin,buildings,{radius,gap,occupied:slots,roads,roadClearance:4})
    slots.push({...place,id:entry.id})
  }
  return slots
}

function detour(a,b,buildings,radius) {
  if(clearDisplaySegment(a,b,buildings,radius))return [a,b]
  // These are collision envelope corners, NOT new OSM graph nodes. Retain the
  // original route separately. Concave buildings are conservatively bypassed.
  const candidates=[a,b]
  for(const box of crowdObstacles(buildings))if(box.water) {
    for(const p of box.water.portals)if(outsideBuildings(p,buildings,radius))candidates.push(p)
    // Shoreline bends are useful visibility vertices; a single water AABB
    // would force every shopper around the entire 350m lake.
    const ring=box.ring,margin=radius*box.water.settings.footRadiusRatio+1
    for(let i=0;i<ring.length-1;i++)for(const [dx,dy]of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const p={x:ring[i][0]+dx*margin,y:ring[i][1]+dy*margin}
      if(outsideBuildings(p,buildings,radius))candidates.push(p)
    }
  }
  for(const box of crowdObstacles(buildings))for(const x of [box.minX-radius-.2,box.maxX+radius+.2])
    for(const y of [box.minY-radius-.2,box.maxY+radius+.2]) {
      const p={x,y};if(outsideBuildings(p,buildings,radius))candidates.push(p)
    }
  const costs=new Map([[0,0]]),previous=new Map(),open=new Set([0]),closed=new Set()
  const edgeCache=new Map()
  while(open.size) {
    const at=[...open].sort((i,j)=>costs.get(i)+distance(candidates[i],b)-costs.get(j)-distance(candidates[j],b)||i-j)[0]
    if(at===1){const indexes=[1];while(previous.has(indexes[0]))indexes.unshift(previous.get(indexes[0]));return indexes.map(i=>candidates[i])}
    open.delete(at);closed.add(at)
    for(let to=0;to<candidates.length;to++) {
      if(to===at||closed.has(to))continue
      const cost=costs.get(at)+distance(candidates[at],candidates[to])
      if(cost >= (costs.get(to)??Infinity))continue
      const key=[Math.min(at,to),Math.max(at,to)].join(':')
      if(!edgeCache.has(key))edgeCache.set(key,clearDisplaySegment(candidates[at],candidates[to],buildings,radius))
      if(edgeCache.get(key)){costs.set(to,cost);previous.set(to,at);open.add(to)}
    }
  }
  throw new Error(`建筑遮挡展示路线，无法构造安全走廊 (${a.x.toFixed(2)},${a.y.toFixed(2)}) → (${b.x.toFixed(2)},${b.y.toFixed(2)}), radius=${radius.toFixed(2)}`)
}

export function displayRoutePoints(points,buildings,{radius=DISPLAY_RADIUS,laneOffset=4,start,end}={}) {
  if(!points?.length)return []
  const goals=points.map((p,i)=>{
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)]
    const length=distance(a,b)||1
    return nearestClearPosition({x:p.x-(b.y-a.y)/length*laneOffset,y:p.y+(b.x-a.x)/length*laneOffset},buildings,{radius})
  })
  if(start)goals.unshift(nearestClearPosition(start,buildings,{radius}))
  if(end)goals.push(nearestClearPosition(end,buildings,{radius}))
  const result=[goals[0]]
  for(let i=1;i<goals.length;i++) {
    if(distance(result.at(-1),goals[i])<EPS)continue
    result.push(...detour(result.at(-1),goals[i],buildings,radius).slice(1))
  }
  return result.map(({x,y})=>({x,y}))
}

export function sweptSeparation(a0,a1,b0,b1) {
  const x=a0.x-b0.x,y=a0.y-b0.y,dx=a1.x-a0.x-b1.x+b0.x,dy=a1.y-a0.y-b1.y+b0.y
  const t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)))
  return Math.hypot(x+dx*t,y+dy*t)
}

// Reflow is for first placement/camera scale changes, never a simulation edit.
export function separateCrowd(people,buildings,{gap=CROWD_GAP}={}) {
  const result=[]
  for(const person of [...people].sort((a,b)=>(Number(b.moving)-Number(a.moving))||a.id.localeCompare(b.id))) {
    result.push({...person,...nearestClearPosition(person,buildings,{radius:person.radius,occupied:result,gap})})
  }
  return result
}

export function stepSeparatedCrowd(people,buildings,{gap=CROWD_GAP}={}) {
  const result=new Map()
  const ordered=[...people].sort((a,b)=>(b.progress||0)-(a.progress||0)||a.id.localeCompare(b.id))
  for(const person of ordered) {
    const target=person.target||person
    const valid=p=>clearDisplaySegment(person,p,buildings,person.radius)
      && people.every(other=>other.id===person.id || sweptSeparation(person,p,other,result.get(other.id)||other)>=person.radius+other.radius+gap-EPS)
    // A zero-length waypoint is already reached. Returning zero here leaves
    // a walker permanently waiting at numerically identical route corners.
    let output={x:person.x,y:person.y},fraction=distance(person,target)<=EPS?1:0
    if(distance(person,target)>EPS) {
      if(valid(target)){output=target;fraction=1}
      else {
        let low=0,high=1
        for(let k=0;k<16;k++) {
          const t=(low+high)/2,p={x:person.x+(target.x-person.x)*t,y:person.y+(target.y-person.y)*t}
          if(valid(p))low=t;else high=t
        }
        fraction=low;output={x:person.x+(target.x-person.x)*low,y:person.y+(target.y-person.y)*low}
        if(low<.15) {
          // Stable right-hand yielding at a crossing. Every candidate is still
          // checked against swept discs and buildings, including the retreat.
          const dx=target.x-person.x,dy=target.y-person.y
          for(const angle of [-Math.PI/3,-Math.PI/2,Math.PI/3,Math.PI/2,-Math.PI*2/3,Math.PI*2/3,Math.PI]) {
            const p={x:person.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:person.y+dx*Math.sin(angle)+dy*Math.cos(angle)}
            if(valid(p)){output=p;fraction=0;break}
          }
        }
      }
    }
    result.set(person.id,{...person,...output,fraction,waiting:distance(person,target)>EPS && fraction<.98})
  }
  return people.map(p=>result.get(p.id))
}
