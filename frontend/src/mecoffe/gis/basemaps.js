import {safeAttribution} from './model.js'
// Canonical markup lets MapLibre's attribution control deduplicate OSM across
// the vector data and raster source. Keep unrelated source credits intact.
export const OSM_ATTRIBUTION='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
export function sourceAttribution(value){
  const text=String(value||'地图来源见场景清单')
  const plain=text.replace(/<[^>]*>/g,'').replace(/&copy;|&#169;/gi,'©').replace(/\s+/g,' ').trim()
  return /^©?\s*OpenStreetMap contributors$/i.test(plain)?OSM_ATTRIBUTION:safeAttribution(text)
}
// Phase 2 providers implement this descriptor contract; no vendor SDK or keys.
export const BASEMAP_ADAPTERS=Object.freeze({
  offline:{id:'offline',label:'场景矢量 · 离线',online:false,source:null,layer:null},
  osm:{id:'osm',label:'OpenStreetMap · 在线',online:true,
    source:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,
      attribution:OSM_ATTRIBUTION},
    layer:{id:'basemap-raster',type:'raster',source:'basemap-raster',paint:{'raster-opacity':.88,'raster-fade-duration':150}}},
})
export function basemapAdapter(id){const value=BASEMAP_ADAPTERS[id];if(!value)throw new Error('底图类型暂不支持');return value}
export function applyBasemap(map,id){
  const adapter=basemapAdapter(id)
  if(map.getLayer('basemap-raster'))map.removeLayer('basemap-raster')
  if(map.getSource('basemap-raster'))map.removeSource('basemap-raster')
  if(adapter.source){map.addSource('basemap-raster',adapter.source);map.addLayer(adapter.layer,'campus-fill')}
  map.setPaintProperty('campus-fill','fill-opacity',adapter.online ? .18 : 1)
  map.setPaintProperty('landcover-fill','fill-opacity',adapter.online ? .35 : .85)
  return adapter
}
