// Engine-independent GIS presentation contract. No MapLibre/Three/Vue imports.
export const GIS_LAYERS=['buildings','roads','landcover','water','boundary','pois']
export const ROLE_COLORS={merchant:'#b86a38',undergraduate_consumer:'#3185a0',graduate_consumer:'#8b6da5',teacher_consumer:'#3e8a68'}
export const CATEGORY_COLORS={dormitory:'#d6b78e',education:'#8fb3bf',library:'#ad9bbd',public:'#83b6a0',commercial:'#d1a06c'}
export function localToLngLat(point,projection){
  const {origin_lon:lon,origin_lat:lat,earth_radius_m:r}=projection
  if(projection.method!=='local_equirectangular'||![lon,lat,r,point.x,point.y].every(Number.isFinite)||r<=0||Math.abs(lat)>=90)throw new Error('地图坐标配置无效')
  return [lon+point.x/(r*Math.cos(lat*Math.PI/180))*180/Math.PI,lat+point.y/r*180/Math.PI]
}
export function lngLatToLocal(point,projection){
  const {origin_lon:lon,origin_lat:lat,earth_radius_m:r}=projection
  localToLngLat({x:0,y:0},projection)
  return {x:r*Math.cos(lat*Math.PI/180)*(point[0]-lon)*Math.PI/180,y:r*(point[1]-lat)*Math.PI/180}
}
export function gisLayers(scenario){
  const result={}
  for(const key of GIS_LAYERS){
    const value=scenario.files[`gis/${key}.geojson`]
    if(value?.type!=='FeatureCollection'||!Array.isArray(value.features))throw new Error(`场景缺少 GIS 图层 ${key}，请重新生成场景包`)
    result[key]=value
  }
  return result
}
export const emptyCollection=()=>({type:'FeatureCollection',features:[]})
function coordinates(geometry){
  if(geometry.type==='Point')return [geometry.coordinates]
  return geometry.coordinates.flat(geometry.type==='MultiPolygon'?2:geometry.type==='Polygon'?1:0)
}
export function featureCentre(feature){
  const points=coordinates(feature.geometry)
  return [points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length]
}
export function mapBounds(layers){
  const source=layers.buildings.features.length?layers.buildings:layers.boundary
  const points=source.features.flatMap(f=>coordinates(f.geometry))
  if(!points.length)throw new Error('场景没有可显示的地图范围')
  return [[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]]
}
export function searchPlaces(layers,query,limit=12){
  const value=query.trim().toLocaleLowerCase()
  if(!value)return []
  return ['buildings','pois'].flatMap(layer=>layers[layer].features.map(feature=>({layer,feature})))
    .filter(({feature:f})=>[f.properties.name,...(f.properties.location_ids||[])].join(' ').toLocaleLowerCase().includes(value)).slice(0,limit)
}
export function heightDescription(source){
  return ({default:'展示默认高度',levels_estimate:'按数据楼层估算',input:'输入数据标注（未经测绘核验）',osm:'OSM 高度标注',measured:'来源标注为实测'})[source]||source||'未提供'
}
// The same replay day-index offset as MeCoffe3D; initialization has no new day.
export function simulationPosition(index,position){return Math.max(0,position-(index?.days[0]?.step===0?1:0))}
export function chooseModels(people,{zoom,project,width,height,selectedId,maxModels=12}){
  if(zoom<18.7)return new Set()
  return new Set(people.map(person=>({person,p:project(person.lngLat)}))
    .filter(({p})=>p.x>=-40&&p.y>=-60&&p.x<=width+40&&p.y<=height+60)
    .sort((a,b)=>(b.person.id===selectedId)-(a.person.id===selectedId)||Math.hypot(a.p.x-width/2,a.p.y-height/2)-Math.hypot(b.p.x-width/2,b.p.y-height/2))
    .slice(0,maxModels).map(({person})=>person.id))
}
export function safeAttribution(value){return String(value||'地图来源见场景清单').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
