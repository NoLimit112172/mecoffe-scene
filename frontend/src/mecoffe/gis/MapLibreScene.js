import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {GisCharacterLayer} from './CharacterLayer.js'
import {applyBasemap,sourceAttribution} from './basemaps.js'
import {CATEGORY_COLORS,emptyCollection,featureCentre,mapBounds} from './model.js'
import {localToLngLat} from './model.js'
import {IndoorRoofLabels} from './IndoorLayer.js'

const GROUPS={
  buildings:['buildings','building-outlines','building-labels','building-selection'],
  roads:['road-case','roads','footpaths','road-labels'],water:['water-fill','water-outline'],
  landcover:['campus-fill','landcover-fill','boundary-outline'],pois:['pois','poi-labels','poi-selection'],
  people:['people-halo','people-points','people-selection'],tracks:['tracks'],
  entrances:['entrance-points'],
}
const font={'text-font':['sans-serif'],'text-size':12,'text-allow-overlap':false,'text-ignore-placement':false,'text-padding':5,'text-max-width':12}
const textPaint={'text-color':'#304f49','text-halo-color':'#fffcf2','text-halo-width':1.8}
const colour=['match',['get','category'],...Object.entries(CATEGORY_COLORS).flat(),'#b7c4c3']
const roadWidth=(multiplier=1,extra=0)=>['interpolate',['linear'],['zoom'],14,1*multiplier+extra,17,5*multiplier+extra,19,14*multiplier+extra,22,55*multiplier+extra]

export class MapLibreScene {
  constructor({host,layers,replay,describeFeature,onSelect,onError,onStatus,onBasemapFallback,signal}){Object.assign(this,{host,layers,replay,describeFeature,onSelect,onError,onStatus,onBasemapFallback,signal});this.visibility={};this.disposed=false;this.selected=null;this.basemap='offline';this.renderFrames=0;this.frameDurations=[]}
  async init(){
    if(this.signal?.aborted)throw new DOMException('场景加载已取消','AbortError')
    // Bundle the ESM worker AND its shared module, including under Pages base.
    maplibregl.setWorkerUrl(workerUrl);maplibregl.setWorkerCount(2)
    this.map=new maplibregl.Map({container:this.host,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9eee8'}}]},
      center:[this.replay.campus.projection.origin_lon,this.replay.campus.projection.origin_lat],zoom:16,pitch:52,bearing:-15,
      maxZoom:23,maxPitch:75,renderWorldCopies:false,attributionControl:false,pixelRatio:Math.min(devicePixelRatio||1,1.5),
      canvasContextAttributes:{antialias:true},localIdeographFontFamily:'Microsoft YaHei, sans-serif',crossSourceCollisions:true})
    this.map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right')
    this.map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left')
    this.map.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-right')
    this.map.on('render',()=>{this.renderFrames++;if(this.measuring){const now=performance.now();if(this.lastMeasuredFrame)this.frameDurations.push(now-this.lastMeasuredFrame);this.lastMeasuredFrame=now;if(this.frameDurations.length>1800)this.frameDurations.shift()}})
    this.map.on('error',event=>{
      if(this.disposed)return
      if(this.basemap==='osm'&&(event.sourceId==='basemap-raster'||/tile\.openstreetmap/.test(event.error?.message||''))){this.setBasemap('offline');this.onBasemapFallback?.('在线底图暂不可用，已恢复离线地图。');return}
      this.onError?.(event.error||new Error('地图显示失败'))
    })
    await new Promise((resolve,reject)=>{this.map.once('load',resolve);this.map.once('remove',()=>reject(new DOMException('场景加载已取消','AbortError')));this.abort=()=>this.dispose();this.signal?.addEventListener('abort',this.abort,{once:true})})
    if(this.disposed)return this
    this.installLayers();this.resetCamera(false)
    this.resize=new ResizeObserver(()=>{if(!this.disposed)this.map.resize()});this.resize.observe(this.host)
    this.map.on('click',event=>this.click(event))
    this.map.on('mousemove',event=>{if(!this.disposed)this.map.getCanvas().style.cursor=this.hit(event.point)?'pointer':''})
    this.map.getCanvas().addEventListener('webglcontextlost',this.lost=e=>{e.preventDefault();this.onError?.(new Error('图形显示已中断，请重新加载场景'))})
    return this
  }
  installLayers(){
    const m=this.map
    for(const [name,data] of Object.entries(this.layers))m.addSource(name,{type:'geojson',data,promoteId:'feature_id',attribution:name==='boundary'?sourceAttribution(data.source?.attribution):undefined})
    const add=layer=>m.addLayer(layer)
    add({id:'campus-fill',type:'fill',source:'boundary',paint:{'fill-color':'#dbe6cf','fill-opacity':1}})
    add({id:'landcover-fill',type:'fill',source:'landcover',paint:{'fill-color':['match',['get','category'],'pitch','#c1d7ab','track','#ce9c83','parking','#d8d4c4','forest','#91b599','grass','#c9ddb5','#d2dfbe'],'fill-opacity':.85}})
    add({id:'water-fill',type:'fill',source:'water',paint:{'fill-color':'#99cbd4','fill-opacity':.95}})
    add({id:'water-outline',type:'line',source:'water',paint:{'line-color':'#6ba4af','line-width':1}})
    add({id:'boundary-outline',type:'line',source:'boundary',paint:{'line-color':'#91a690','line-width':1.5,'line-dasharray':[3,2]}})
    add({id:'road-case',type:'line',source:'roads',paint:{'line-color':'#f9f6e9','line-width':roadWidth(1,2)},layout:{'line-join':'round','line-cap':'round'}})
    const pathFilter=['in',['get','highway'],['literal',['footway','path','pedestrian','steps','cycleway']]]
    add({id:'roads',type:'line',source:'roads',filter:['!',pathFilter],paint:{'line-color':'#758783','line-width':roadWidth()},layout:{'line-join':'round','line-cap':'round'}})
    add({id:'footpaths',type:'line',source:'roads',filter:pathFilter,paint:{'line-color':'#c1b68d','line-width':roadWidth(.45)},layout:{'line-join':'round','line-cap':'round'}})
    add({id:'buildings',type:'fill-extrusion',source:'buildings',paint:{'fill-extrusion-color':colour,'fill-extrusion-height':['get','height_m'],'fill-extrusion-base':0,'fill-extrusion-opacity':.96,'fill-extrusion-vertical-gradient':true}})
    add({id:'building-outlines',type:'line',source:'buildings',paint:{'line-color':'#6f8c88','line-width':1,'line-opacity':.5}})
    add({id:'building-selection',type:'fill-extrusion',source:'buildings',filter:['==',['get','feature_id'],''],paint:{'fill-extrusion-color':'#e4b756','fill-extrusion-height':['+', ['get','height_m'],.25],'fill-extrusion-opacity':.75}})
    add({id:'building-labels',type:'symbol',source:'buildings',minzoom:15.5,filter:['all',['!=',['get','name'],''],['!=',['get','name_source'],'display_fallback']],layout:{...font,'text-field':['get','name']},paint:textPaint})
    add({id:'road-labels',type:'symbol',source:'roads',minzoom:15,filter:['!=',['get','name'],''],layout:{...font,'symbol-placement':'line','symbol-spacing':250,'text-field':['get','name'],'text-size':11},paint:textPaint})
    add({id:'pois',type:'circle',source:'pois',minzoom:16.5,paint:{'circle-radius':['case',['==',['get','category'],'mapped_location'],5,3],'circle-color':'#b27241','circle-stroke-color':'#fffaf0','circle-stroke-width':1.5}})
    add({id:'poi-labels',type:'symbol',source:'pois',minzoom:18,filter:['!=',['get','name'],''],layout:{...font,'text-field':['get','name'],'text-anchor':'top','text-offset':[0,.7],'text-size':11},paint:textPaint})
    add({id:'poi-selection',type:'circle',source:'pois',filter:['==',['get','feature_id'],''],paint:{'circle-radius':9,'circle-color':'#efbd4c','circle-stroke-color':'#ffffff','circle-stroke-width':2}})
    add({id:'entrance-points',type:'circle',source:'entrances',minzoom:17.5,paint:{'circle-radius':5,'circle-color':['match',['get','source'],'osm','#31896c','#d39138'],'circle-stroke-color':'#ffffff','circle-stroke-width':1.5}})
    const lightColour=['match',['get','category'],'dormitory','#e2ceb1','education','#b1ced4','library','#c5b6d0','public','#a9cfc0','commercial','#dec4a4','#cdd8d4']
    m.setPaintProperty('buildings','fill-extrusion-color',['interpolate',['linear'],['min',40,['coalesce',['feature-state','indoorCount'],0]],0,colour,40,lightColour])
    m.addSource('people',{type:'geojson',data:emptyCollection()});m.addSource('tracks',{type:'geojson',data:emptyCollection()})
    add({id:'tracks',type:'line',source:'tracks',paint:{'line-color':'#d88439','line-width':3,'line-opacity':.85},layout:{'line-cap':'round','line-join':'round'}})
    add({id:'people-halo',type:'circle',source:'people',filter:['==',['get','walking'],true],paint:{'circle-radius':8,'circle-color':'#fff3bd','circle-opacity':.65}})
    add({id:'people-points',type:'circle',source:'people',paint:{'circle-radius':['case',['get','walking'],4.5,3.5],'circle-color':['get','color'],'circle-opacity':['case',['get','modelReady'],0,1],'circle-stroke-color':'#ffffff','circle-stroke-width':1.2,'circle-stroke-opacity':['case',['get','modelReady'],0,1]}})
    add({id:'people-selection',type:'circle',source:'people',filter:['==',['get','id'],''],paint:{'circle-radius':9,'circle-color':'#f0ba4a','circle-opacity':.25,'circle-stroke-color':'#e39c29','circle-stroke-width':2}})
    this.characters=new GisCharacterLayer({replay:this.replay,onStatus:this.onStatus,onError:this.onError});m.addLayer(this.characters)
    this.host.dataset.entranceCount=String(this.characters.doors?.frames.size||0)
    this.roofLabels=new IndoorRoofLabels(this)
    this.setPeople()
  }
  setPeople(){
    if(this.disposed||!this.map.getSource('people'))return
    const data=this.replay.pointFeatures(this.characters.readyIds),key=JSON.stringify(data)
    if(key!==this.peopleKey){this.peopleKey=key;this.map.getSource('people').setData(data)}
    const occupancy=this.replay.occupancy,occupancyKey=JSON.stringify(occupancy.buildings)
    if(occupancyKey!==this.occupancyKey){this.occupancyKey=occupancyKey;for(const f of this.layers.buildings.features)this.map.setFeatureState({source:'buildings',id:f.id},{indoorCount:occupancy.buildings[f.id]?.length||0})}
    const routeKey=[...this.replay.people.values()].filter(p=>p.walker).map(p=>`${p.id}:${p.walker.event.key}:${p.walker.phase}`).join('|')
    if(routeKey!==this.routeKey){this.routeKey=routeKey;this.map.getSource('tracks').setData(this.replay.routeFeatures())}
    if(this.popupPerson&&this.popup)this.popup.setLngLat(this.replay.personData().find(p=>p.id===this.popupPerson)?.lngLat||this.popup.getLngLat())
  }
  setLayers(values){
    this.visibility={...this.visibility,...values}
    for(const [group,ids]of Object.entries(GROUPS))for(const id of ids)this.map.setLayoutProperty(id,'visibility',this.visibility[group]===false?'none':'visible')
    this.characters.setVisible(this.visibility.people!==false);this.characters.doors?.setVisible(this.visibility.entrances!==false&&this.visibility.buildings!==false);this.requestFrame()
  }
  setBasemap(id){if(!this.disposed){applyBasemap(this.map,id);this.basemap=id;this.requestFrame()}}
  hit(point){
    if(this.visibility.people!==false){const person=this.characters.pick(point);if(person)return {type:'person',id:person}}
    const layers=['people-points','people-halo','entrance-points','pois','buildings'].filter(id=>this.map.getLayoutProperty(id,'visibility')!=='none')
    const hits=this.map.queryRenderedFeatures([[point.x-5,point.y-5],[point.x+5,point.y+5]],{layers})
    const p=hits.find(f=>f.source==='people')
    if(p)return {type:'person',id:p.properties.id}
    const feature=hits.find(f=>['pois','buildings','entrances'].includes(f.source))
    if(feature){const id=feature.properties.feature_id??feature.id;const original=this.layers[feature.source].features.find(f=>String(f.id)===String(id));return original?{type:'feature',layer:feature.source,feature:original}:null}
    return null
  }
  click(event){const hit=this.hit(event.point);if(hit)this.select(hit)}
  select(item){
    this.selected=item;this.popup?.remove();this.popupPerson=null;this.characters.selectedId=item.type==='person'?item.id:null
    for(const source of ['building','poi'])this.map.setFilter(`${source}-selection`,['==',['get','feature_id'],item.type==='feature'?String(item.feature.id):''])
    this.map.setFilter('people-selection',['==',['get','id'],item.type==='person'?item.id:''])
    const container=document.createElement('div');container.className='gis-popup-content'
    const title=document.createElement('strong'),body=document.createElement('p');let coordinate
    if(item.type==='person'){
      const record=this.replay.people.get(item.id);if(!record)return
      const location=this.replay.personLocation(item.id)
      if(location.inside)this.map.setFilter('building-selection',['==',['get','feature_id'],location.buildingId])
      title.textContent=record.person.name;body.textContent=record.person.role_label+' · '+(location.inside?`在 ${location.name} 内（示意）`:'正在进出楼或沿步行路线移动（示意）')
      coordinate=localToPoint(record,this.replay)
      this.popupPerson=item.id
    }else{
      const p=item.feature.properties,info=this.describeFeature(item.feature);title.textContent=p.name||info.category.name||'未命名要素'
      appendLabel(body,info.category)
      if(p.height_m)body.append(` · ${p.height_m} 米`)
      body.append(' · ');appendLabel(body,info.prototype)
      for(const location of info.locations){body.append(' · '+location.name+' ');appendCode(body,location.id)}
      if(p.source)body.append(' · '+(p.source==='osm'?'OSM 入口标注':'推断入口')+'（示意）')
      coordinate=featureCentre(item.feature)
    }
    container.append(title,body);this.popup=new maplibregl.Popup({closeButton:true,maxWidth:'320px',offset:14}).setLngLat(coordinate).setDOMContent(container).addTo(this.map)
    this.onSelect?.(item);this.requestFrame()
  }
  focusFeature(item){const centre=featureCentre(item.feature);this.select({type:'feature',...item});this.map.easeTo({center:centre,zoom:Math.max(18.6,this.map.getZoom()),duration:550})}
  focusPerson(id){const record=this.replay.people.get(id);if(!record)return;this.select({type:'person',id});const inside=this.replay.personLocation(id).inside;if(!inside)this.popup?.remove();this.map.easeTo({center:localToPoint(record,this.replay),zoom:inside?18.3:20.3,pitch:inside?52:62,bearing:-22,duration:650})}
  resetCamera(animate=true){this.map.fitBounds(mapBounds(this.layers),{padding:65,pitch:52,bearing:-15,maxZoom:18,duration:animate?600:0})}
  requestFrame(){if(!this.disposed)this.map.triggerRepaint()}
  needsAnimation(){return this.map.getZoom()>=18.7&&this.visibility.people!==false&&this.replay.personData().length>0}
  setMeasuring(value){this.measuring=value;this.lastMeasuredFrame=0;this.frameDurations=[]}
  getStats(){const times=this.frameDurations;return {renderFrames:this.renderFrames,averageFps:times.length?times.length*1000/times.reduce((a,b)=>a+b,0):0,worstFrameMs:times.length?Math.max(...times):0,drawCalls:this.characters?.renderer?.info.render.calls||0}}
  dispose(){if(this.disposed)return;this.disposed=true;this.roofLabels?.dispose();this.signal?.removeEventListener('abort',this.abort);this.resize?.disconnect();this.popup?.remove();this.map?.getCanvas().removeEventListener('webglcontextlost',this.lost);this.map?.remove()}
}
function localToPoint(record,replay){const location=replay.personLocation(record.id),building=location.inside&&replay.campus.buildings.find(b=>b.osm_id===location.buildingId);if(building){const p=building.polygon;return localToLngLat({x:p.reduce((n,v)=>n+v[0],0)/p.length,y:p.reduce((n,v)=>n+v[1],0)/p.length},replay.campus.projection)}return localToLngLat(record,replay.campus.projection)}
function appendCode(parent,value){if(value){const span=document.createElement('small');span.className='gis-data-code';span.textContent=value;parent.append(span)}}
function appendLabel(parent,value){parent.append(value.name);if(value.code){parent.append(' ');appendCode(parent,value.code)}}
