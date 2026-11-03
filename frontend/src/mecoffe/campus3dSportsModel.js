export const SPORTS_DIMENSIONS=Object.freeze({
  basketball:{width:15,length:28,runoff:1},tennis:{width:10.97,length:23.77,runoff:1},
  badminton:{width:6.1,length:13.4,runoff:1},soccer:{width:68,length:105,runoff:0},
})
export const TRACK_DIMENSIONS=Object.freeze({innerRadius:36.5,straight:84.39,laneWidth:1.22,lanes:8,measurementOffset:.3})
// The user identified a 400m facility around this mapped soccer field. OSM
// supplies the field, not a surveyed outer track. The wrapper stays explicit.
export const TRACK_HOSTS=Object.freeze(['way/1501639765'])

export function sportsFrame(polygon) {
  const closed=polygon.length>1&&polygon[0][0]===polygon.at(-1)[0]&&polygon[0][1]===polygon.at(-1)[1]
  const points=closed?polygon.slice(0,-1):polygon.slice(),candidates=[]
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],angle=Math.atan2(b[1]-a[1],b[0]-a[0]),c=Math.cos(angle),s=Math.sin(angle)
    const rotated=points.map(([x,y])=>[x*c+y*s,-x*s+y*c])
    const x0=Math.min(...rotated.map(p=>p[0])),x1=Math.max(...rotated.map(p=>p[0])),y0=Math.min(...rotated.map(p=>p[1])),y1=Math.max(...rotated.map(p=>p[1]))
    const x=(x0+x1)/2,y=(y0+y1)/2,w=x1-x0,h=y1-y0
    if(w>1e-6&&h>1e-6)candidates.push({width:Math.min(w,h),length:Math.max(w,h),angle:angle+(w>h?Math.PI/2:0),center:{x:x*c-y*s,y:x*s+y*c},area:w*h})
  }
  if(!candidates.length)throw new Error('运动场轮廓无效')
  return candidates.sort((a,b)=>a.area-b.area)[0]
}
export function stadiumRing(radius,straight=TRACK_DIMENSIONS.straight,segments=64) {
  const points=[]
  for(let i=0;i<=segments;i++){const a=i/segments*Math.PI;points.push([radius*Math.cos(a),straight/2+radius*Math.sin(a)])}
  for(let i=0;i<=segments;i++){const a=Math.PI+i/segments*Math.PI;points.push([radius*Math.cos(a),-straight/2+radius*Math.sin(a)])}
  points.push(points[0].slice());return points
}
export function courtLayout(frame,sport) {
  const d=SPORTS_DIMENSIONS[sport]
  if(!d)throw new Error(`未知球场 ${sport}`)
  if(!(frame.width>.6&&frame.length>.6))throw new Error('运动场范围太小')
  const width=d.width+2*d.runoff,length=d.length+2*d.runoff,choices=[],gap=.65
  for(const rotate of [false,true])for(let columns=1;columns<=6;columns++)for(let rows=1;rows<=6;rows++) {
    const count=columns*rows;if(count>12)continue
    const cellWidth=rotate?length:width,cellLength=rotate?width:length
    const scale=Math.min(1,(frame.width-.6)/(columns*cellWidth+(columns-1)*gap),(frame.length-.6)/(rows*cellLength+(rows-1)*gap))
    if(scale<.8&&count>1)continue
    choices.push({columns,rows,count,rotate,scale,cellWidth,cellLength,gap,area:count*width*length*scale*scale})
  }
  const best=choices.sort((a,b)=>b.count-a.count||b.area-a.area)[0],instances=[]
  for(let row=0;row<best.rows;row++)for(let col=0;col<best.columns;col++)instances.push({x:(col-(best.columns-1)/2)*(best.cellWidth+gap)*best.scale,y:(row-(best.rows-1)/2)*(best.cellLength+gap)*best.scale,scale:best.scale,angle:best.rotate?Math.PI/2:0})
  return {...best,instances,illustrative:true}
}
export function sportsLayouts(features,trackHosts=TRACK_HOSTS) {
  return features.filter(f=>f.kind==='pitch').map(feature=>{
    const frame=sportsFrame(feature.polygon),track=feature.sport==='soccer'&&trackHosts.includes(feature.osm_id)
    return {feature,frame,sport:track?'track400':feature.sport,track,layout:SPORTS_DIMENSIONS[feature.sport]&&!track?courtLayout(frame,feature.sport):null,illustrative_layout:true,source_geometry:feature.osm_id}
  })
}

// The track surrounds the OSM football field. Reserve its complete outer ring
// for scenery clearance, without changing the source landcover or graph.
export function sportsExclusions(features) {
  return sportsLayouts(features).filter(layout=>layout.track).map(({frame,feature})=>{
    const scale=Math.min(1.02,frame.width/68,frame.length/105),c=Math.cos(frame.angle),s=Math.sin(frame.angle)
    const polygon=stadiumRing(TRACK_DIMENSIONS.innerRadius+TRACK_DIMENSIONS.lanes*TRACK_DIMENSIONS.laneWidth+6)
      .map(([x,y])=>[frame.center.x+(x*c-y*s)*scale,frame.center.y+(x*s+y*c)*scale])
    return {kind:'pitch',sport:'track400',osm_id:`display-track:${feature.osm_id}`,polygon,illustrative:true}
  })
}
