// Pure display recipes. These do not rewrite OSM heights, footprints or assignments.
import { normalizedFootprint } from './yulanAssetModel.js'

export const ROUND_FACADE_VARIANTS = Object.freeze(['22:2', '24:2', '25:1', '25:2', '25:3'])
export const ROOF_SEED = 2026

function hash(value) {
  let result = 2166136261
  for (const ch of String(value)) result = Math.imul(result ^ ch.codePointAt(0), 16777619)
  return result >>> 0
}
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

export function footprintMetrics(polygon) {
  const { points, area } = normalizedFootprint(polygon)
  const ring = points.slice(0, -1)
  let perimeter = 0, longest = 0, angle = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b[0]-a[0], b[1]-a[1])
    perimeter += length
    if (length > longest) { longest = length; angle = Math.atan2(b[1]-a[1], b[0]-a[0]) }
  }
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const local = ring.map(([x,y]) => [x*cosine+y*sine, -x*sine+y*cosine])
  const minU = Math.min(...local.map(p=>p[0])), maxU = Math.max(...local.map(p=>p[0]))
  const minV = Math.min(...local.map(p=>p[1])), maxV = Math.max(...local.map(p=>p[1]))
  const width = maxU-minU, depth = maxV-minV, centerU = (minU+maxU)/2, centerV = (minV+maxV)/2
  const center = { x:centerU*cosine-centerV*sine, y:centerU*sine+centerV*cosine }
  const radii = ring.map(p=>Math.hypot(p[0]-center.x,p[1]-center.y))
  const radius = radii.reduce((a,b)=>a+b,0)/radii.length
  const radialVariation = Math.sqrt(radii.reduce((sum,r)=>sum+(r-radius)**2,0)/radii.length)/(radius||1)
  const circularity = 4*Math.PI*Math.abs(area)/(perimeter*perimeter)
  return { points, area:Math.abs(area), perimeter, angle, minU,maxU,minV,maxV,width,depth,center,
    rectangularity:Math.abs(area)/(width*depth), circularity, radialVariation,
    isRound:ring.length>=8 && circularity>.86 && radialVariation<.16 && Math.max(width,depth)/Math.min(width,depth)<1.2 }
}

/** Audited atlas pairs have curved tower walls. A square's circularity is only pi/4. */
export function compatibleYuLanFacade(building, { type=21, model=1, seed=ROOF_SEED }={}) {
  type=Number(type); model=Number(model)
  const requested={type,model}, metrics=footprintMetrics(building.polygon)
  if (!ROUND_FACADE_VARIANTS.includes(`${type}:${model}`) || metrics.isRound) {
    return {...requested,requested,changed:false,reason:'Source facade is compatible with the display footprint'}
  }
  const candidates = type===22 ? [{type:22,model:1},{type:22,model:3}]
    : type===24 ? [{type:24,model:1},{type:24,model:3}]
      : [{type:26,model:1},{type:26,model:2}]
  const selected=candidates[hash(`${seed}|${building.osm_id || building.feature_id || JSON.stringify(building.polygon)}|facade`)%candidates.length]
  return {...selected,requested,changed:true,reason:'Round tower atlas facade replaced by a rectilinear facade for a non-round footprint'}
}

function segmentDistance(point,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy
  const t=length2?clamp(((point.x-a[0])*dx+(point.y-a[1])*dy)/length2,0,1):0
  return Math.hypot(point.x-a[0]-dx*t,point.y-a[1]-dy*t)
}
function inside(point,ring) {
  let value=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[i],[bx,by]=ring[j]
    if((ay>point.y)!==(by>point.y) && point.x<(bx-ax)*(point.y-ay)/(by-ay)+ax)value=!value
  }
  return value
}

export function pointOnRoof(point, building, clearance=0) {
  if(!inside(point,building.polygon) || (building.holes||[]).some(hole=>inside(point,hole)))return false
  return [building.polygon,...(building.holes||[])].every(ring=>ring.every((p,i)=>segmentDistance(point,p,ring[(i+1)%ring.length])>=clearance-1e-7))
}

/** A dense boundary/interior check prevents even small courtyards being covered. */
export function equipmentFitsRoof(item,building,clearance=1.1) {
  const cosine=Math.cos(item.angle),sine=Math.sin(item.angle)
  const nx=Math.max(2,Math.ceil(item.width/.6)),ny=Math.max(2,Math.ceil(item.depth/.6))
  for(let i=0;i<=nx;i++)for(let j=0;j<=ny;j++) {
    const u=(i/nx-.5)*item.width,v=(j/ny-.5)*item.depth
    if(!pointOnRoof({x:item.x+u*cosine-v*sine,y:item.y+u*sine+v*cosine},building,clearance))return false
  }
  // Reject a complete courtyard enclosed by equipment even when its vertices
  // happen to fall between the regular sampling points.
  for(const hole of building.holes||[])for(const [x,y] of hole) {
    const dx=x-item.x,dy=y-item.y
    if(Math.abs(dx*cosine+dy*sine)<item.width/2 && Math.abs(-dx*sine+dy*cosine)<item.depth/2)return false
  }
  return true
}

export function roofType(building,{type=21}={}) {
  const metrics=footprintMetrics(building.polygon)
  const residential=Number(type)>=27 || ['house','detached','terrace','residential'].includes(building.tags?.building)
  const small=metrics.area<=600 && Math.max(metrics.width,metrics.depth)<=40 && Math.min(metrics.width,metrics.depth)<=24
  return residential && small && Number(building.height_m ?? building.height ?? 10)<16 && metrics.rectangularity>.97 && !(building.holes||[]).length ? 'pitched' : 'flat'
}

const TILE_PALETTE={27:['#c96c28','#c35c25','#c97531'],28:['#ca6b29','#c36b2f','#297c81'],29:['#575f80','#bc642b','#bd6c32'],30:['#73637e','#c97530','#6b627b']}

export function roofPlan(building,{type=21,model=1,seed=ROOF_SEED}={}) {
  const metrics=footprintMetrics(building.polygon),kind=roofType(building,{type})
  const id=String(building.osm_id || building.feature_id || JSON.stringify(building.polygon))
  const height=Number(building.height_m ?? building.height ?? 9.6)
  const plan={kind,id,seed,height,metrics,slabThickness:.42,parapetHeight:.95,parapetWidth:.55,
    eaves:.65,rise:clamp(Math.min(metrics.width,metrics.depth)*.27,1.4,4.2),
    tileColor:(TILE_PALETTE[type]||['#496f7b'])[Math.max(0,Number(model)-1)%((TILE_PALETTE[type]||[]).length||1)],
    equipment:[],source:'Program-generated roof; YuLan reference palette; no roof image is projected',illustrative:true}
  if(kind==='pitched')return plan
  const target=Math.min(12,Math.max(2,Math.floor(metrics.area/700)+2))
  const categories=['stairwell','hvac','water-tank','vent','solar','green-roof']
  const sizes={stairwell:[4.8,3.8,2.8],hvac:[3.5,2.6,1.55],'water-tank':[3.2,3.2,2.5],vent:[1.4,1.4,1.6],solar:[5.4,3.5,.9],'green-roof':[4.5,3.5,.48]}
  let state=hash(`${seed}|${id}|roof`)
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  const cosine=Math.cos(metrics.angle),sine=Math.sin(metrics.angle)
  const candidates=[]
  // Stratified coverage spreads a few readable devices across long wings.
  for(let u=0;u<9;u++)for(let v=0;v<7;v++) {
    const lu=metrics.minU+(u+.2+random()*.6)/9*metrics.width
    const lv=metrics.minV+(v+.2+random()*.6)/7*metrics.depth
    candidates.push({x:lu*cosine-lv*sine,y:lu*sine+lv*cosine,order:random()})
  }
  candidates.sort((a,b)=>a.order-b.order)
  for(const point of candidates) {
    const category=categories[(plan.equipment.length+hash(id)%categories.length)%categories.length]
    const [width,depth,itemHeight]=sizes[category]
    const item={kind:category,x:point.x,y:point.y,angle:metrics.angle,width,depth,height:itemHeight}
    if(!equipmentFitsRoof(item,building))continue
    if(plan.equipment.some(other=>Math.hypot(other.x-item.x,other.y-item.y)<Math.hypot(width,depth)/2+Math.hypot(other.width,other.depth)/2+1.2))continue
    plan.equipment.push(item)
    if(plan.equipment.length>=target)break
  }
  return plan
}
