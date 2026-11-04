// Phase 2 providers implement this descriptor contract; no vendor SDK or keys.
export const BASEMAP_ADAPTERS=Object.freeze({
  offline:{id:'offline',label:'场景矢量 · 离线',online:false,source:null,layer:null},
  osm:{id:'osm',label:'OpenStreetMap · 在线',online:true,
    source:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,
      attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'},
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
