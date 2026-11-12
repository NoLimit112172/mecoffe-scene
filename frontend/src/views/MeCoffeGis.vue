<template>
  <div class="gis-page" :class="{'integrated-page':isIntegratedScene,'details-open':detailsOpen}" :data-live-mode="isLive" :data-live-revision="liveState?.revision || 0" :data-indoor-occupancy="JSON.stringify(occupancy.buildings)" :data-inside="occupancy.inside" :data-person-accounting="JSON.stringify(occupancy.accounting)" :data-position="position.toFixed(6)" :data-cursor="cursor" :data-active-walkers="activeWalkers" :data-ready-models="modelStatus.visibleReady||0" :data-render-frames="telemetry.renderFrames||0" :data-worst-frame="telemetry.worstFrameMs||0" :data-average-fps="telemetry.averageFps||0" :data-model-draw-calls="telemetry.drawCalls||0">
    <header class="gis-header"><div class="gis-brand"><span class="gis-logo">◈</span><div><p>MECOFFE / GIS</p><h1>{{scenario?.manifest.title || 'GIS 校园活动地图'}}</h1></div></div><nav>
      <details v-if="!isIntegratedScene" ref="scenarioPicker" class="scenario-picker" @keydown.esc.prevent="closeScenarioPicker" @focusout="blurScenarioPicker">
        <summary aria-label="GIS 场景" aria-haspopup="listbox">场景 · {{scenarioChoices.find(item=>item.id===scenarioId)?.title || '选择场景'}} <span>⌄</span></summary>
        <div role="listbox" aria-label="可用场景" class="scenario-options" @keydown.down.prevent="moveScenarioOption($event,1)" @keydown.up.prevent="moveScenarioOption($event,-1)">
          <button v-for="item in scenarioChoices" :key="item.id" :data-scenario-id="item.id" role="option" :aria-selected="item.id===scenarioId" @click="changeScenario(item.id)">{{item.title}}<small>{{item.simulation_data?'有模拟回放':'地图预览'}}</small></button>
        </div>
      </details>
      <RouterLink :to="sandboxUrl">沙盘模式 ↗</RouterLink><RouterLink to="/mecoffe3d/assets">素材库 ↗</RouterLink><RouterLink to="/licenses">来源与许可</RouterLink></nav></header>
    <p class="gis-notice" role="note">ⓘ 人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据。建筑缺失高度采用标注的估算或默认值。</p>
    <ScenePlacementDetails v-if="previewScenario?.files['trajectory.json']?.meta.scene_result" :result="previewScenario.files['trajectory.json'].meta.scene_result" :people="previewScenario.files['trajectory.json'].people"/>
    <div v-if="error" class="gis-error" role="alert"><strong>场景未能完整显示</strong><span>{{error}}</span><button @click="load">重新加载</button></div>
    <template v-if="scenario">
      <section class="gis-metrics" aria-label="场景概览"><div><span>建筑</span><strong>{{layers?.buildings.features.length || 0}}<small> 栋</small></strong></div><div><span>道路与步道</span><strong>{{layers?.roads.features.length || 0}}<small> 段</small></strong></div><div><span>模拟人物</span><strong>{{population}}<small> 人</small></strong></div><div><span>{{isLive?'已核实订单':hasSimulation?'回放订单':'模拟状态'}}</span><strong>{{hasSimulation?orders:isConfigPreview?'配置预览':'尚无模拟数据'}}<small v-if="hasSimulation"> 单</small></strong></div><div v-if="!isConfigPreview"><span>{{isLive?"模拟进度":"模拟日期 · "+clock?.timezone}}</span><strong class="clock" data-testid="gis-time">{{isLive?liveProgress.label:dateDisplay?.label}}</strong></div></section>
      <p class="gis-data-note" data-testid="gis-data-notice">{{isLive?('实时模式 · '+liveProgress.message+'。仅已核实订单计入销量；楼栋与路线为展示示意。'):isConfigPreview?'配置预览 · 尚未运行模拟 · 事件 0 · 订单 0 · 楼栋安置为展示示意。':hasSimulation?`${scenario.files['trajectory.json'].meta.synthetic?'合成样例 · 运行回放':scenario.files['trajectory.json'].meta.partial?'部分运行记录':'已有 OASIS 运行记录'} · 完成 ${scenario.files['trajectory.json'].meta.completed_steps}/${scenario.files['trajectory.json'].meta.total_steps} 步；缺失记录未补造。`:'尚无模拟数据 · 仅显示地图、建筑及场景模拟时间，不生成人物或活动。'}}<span v-if="unreachable"> · {{unreachable}} 笔购买未找到可通行展示路线</span></p>
    </template>
    <p v-if="isGenericReplay" class="gis-data-note" data-testid="replay-outcomes">本记录含被拒 {{replayOutcomeCounts.declined}} 条 · 结果未知 {{replayOutcomeCounts.unknown}} 条。楼栋与路线为展示示意。</p>
    <p v-if="(hasSimulation||isConfigPreview)&&occupancy.accounting" class="population-accounting" data-testid="person-accounting">人物去向：室外 {{occupancy.accounting.visible}} + 楼内 {{occupancy.accounting.inside}}<template v-if="occupancy.accounting.out_of_scene"> + 场景外 {{occupancy.accounting.out_of_scene}}</template> = {{occupancy.accounting.total}} 人 · {{occupancy.accounting.valid?'全部可定位':'请重新加载场景'}}</p>
    <button v-if="isIntegratedScene" class="gis-details-toggle" :aria-expanded="detailsOpen" aria-controls="gis-scene-details" @click="detailsOpen=!detailsOpen">{{detailsOpen?'收起详情':'人物与地图详情'}}</button>
    <div class="gis-layout">
      <main class="gis-map-wrap"><div ref="host" class="gis-map" aria-label="GIS 校园地图"></div><div v-if="loading" class="gis-loading" role="status">正在准备地图…</div><template v-else-if="scenario"><div class="gis-map-tools"><span class="gis-map-badge">{{basemap==='offline'?'离线矢量地图':'OpenStreetMap 底图'}}</span><button @click="renderer?.resetCamera()">全景</button><button :disabled="!selectedPerson" @click="renderer?.focusPerson(selectedPerson.id)">人物特写</button></div><div class="gis-legend"><b>图例</b><span><i style="background:#8fb3bf"></i>教学 / 科研</span><span><i style="background:#d6b78e"></i>住宿</span><span><i style="background:#99cbd4"></i>水域</span><span><i style="background:#3185a0;border-radius:50%"></i>人物 · 远景简化</span><div v-if="isIntegratedScene" class="gis-role-key" aria-label="角色图例"><span v-for="person in legendPeople" :key="person.role" :title="person.role_description || person.role_label"><i :style="{background:displayRoleColor(person.role,ROLE_COLORS)}"></i>{{person.role_label}}</span></div><small>拖动平移 · 右键拖动旋转 / 倾斜 · 滚轮缩放</small></div><div v-if="modelStatus.visibleTotal" class="gis-model-status" role="status">{{modelStatus.visibleReady===modelStatus.visibleTotal?'近景三维人物':`人物模型准备中 ${modelStatus.visibleReady||0}/${modelStatus.visibleTotal}`}}<button v-if="modelStatus.failed" @click="load">重试</button></div></template></main>
      <aside id="gis-scene-details" class="gis-panel">
        <section><h2>地图与图层</h2><label class="basemap-label">底图<select aria-label="底图" v-model="basemap" :disabled="loading" @change="setBasemap"><option v-for="item in basemaps" :key="item.id" :value="item.id">{{item.label}}</option></select></label><p v-if="basemapNote" class="panel-hint" role="status">{{basemapNote}}</p><div class="layer-grid"><label v-for="(label,key) in layerLabels" :key="key"><input type="checkbox" :aria-label="`${label}图层`" v-model="visibility[key]" :disabled="loading" @change="setLayers"/>{{label}}</label></div></section>
        <section><h2>查找地点</h2><input class="gis-search" type="search" aria-label="搜索楼栋或地点" v-model="query" placeholder="搜索楼名或地点名称"/><div class="search-results"><button v-for="item in results" :key="item.layer+item.feature.id" @click="renderer?.focusFeature(item)"><strong>{{item.feature.properties.name||'未命名地点'}}</strong><small>{{item.info.category.name}} <span v-if="item.info.category.code" class="gis-data-code">{{item.info.category.code}}</span><span v-for="location in item.info.locations" :key="location.id"> · {{location.name}} <span class="gis-data-code">{{location.id}}</span></span></small></button><p v-if="query&&!results.length" class="panel-hint">未找到匹配地点。</p></div></section>
        <section v-if="selected" class="gis-info" data-testid="gis-query-card"><h2>{{selectedPerson?'人物信息':'地点信息'}}</h2><template v-if="selectedPerson"><h3>{{selectedPerson.name}}</h3><span class="role-badge" :title="selectedPerson.role_description || selectedPerson.role_label">{{selectedPerson.role_label}}</span><details v-if="selectedPerson.role_description" class="role-description"><summary>角色说明</summary><p>{{selectedPerson.role_description}}</p><small>角色标识：{{selectedPerson.role}}</small></details><p>{{selectedPerson.bio || '暂无画像摘要'}}</p><ConfigProfileFields v-if="isIntegratedScene" :person="selectedPerson"/><button @click="renderer?.focusPerson(selectedPerson.id)">定位并查看人物</button><h4>{{isConfigPreview?'示意安置':'当前活动'}}</h4><p>{{selectedPlacement}}</p><div v-for="event in activity" :key="event.key" class="activity-item" :data-event-outcome="event.outcome || event.type">{{describeEvent(index,event)}}<EventResultDetails :event="event"/></div><div v-if="isConfigPreview" class="config-relations"><h4>关注 {{personFollowing.length}} 人 · 被关注 {{personFollowers.length}} 人</h4><button v-for="person in personFollowing" :key="person.id" @click="focusScenePerson(person)">{{person.name}}</button></div><p v-if="!activity.length" class="panel-hint">{{isConfigPreview?'尚未运行模拟。':'当前时间之前暂无该人物活动。'}}</p></template><template v-else><h3>{{selected.feature.properties.name || selectedInfo.category.name}}</h3>
          <dl><dt>类别</dt><dd>{{selectedInfo.category.name}} <small v-if="selectedInfo.category.code" class="gis-data-code">{{selectedInfo.category.code}}</small></dd><dt v-if="selected.feature.properties.height_m">高度</dt><dd v-if="selected.feature.properties.height_m">{{selected.feature.properties.height_m}} 米</dd><dt v-if="selected.feature.properties.height_m">高度来源</dt><dd v-if="selected.feature.properties.height_m">{{heightDescription(selected.feature.properties.height_source)}}</dd><dt>素材原型</dt><dd>{{selectedInfo.prototype.name}} <small v-if="selectedInfo.prototype.code" class="gis-data-code">{{selectedInfo.prototype.code}}</small></dd><dt>OASIS 地点</dt><dd><span v-for="location in selectedInfo.locations" :key="location.id" class="mapped-location">{{location.name}} <small class="gis-data-code">{{location.id}}</small></span><span v-if="!selectedInfo.locations.length">无显式映射</span></dd></dl>
          <section v-if="buildingShops.length" class="building-shops" data-testid="building-shops"><h4>本楼门店（示意）</h4><div v-for="shop in buildingShops" :key="shop.brandId" :data-shop-brand="shop.brandId"><b>{{shop.name}}</b><span>{{shop.productName}}</span><small>{{shop.brandId}}</small></div></section>
          <p v-for="entry in selectedEntrances" :key="entry.id" class="panel-hint">{{entry.source==='osm'?'OSM 入口标注':'推断入口'}}（示意） <button @click="renderer?.focusFeature({layer:'entrances',feature:layers.entrances.features.find(f=>f.id===entry.id)})">定位入口</button></p><div v-if="buildingResidents.length" class="indoor-residents"><h4>楼内 {{buildingResidents.length}} 人（示意）</h4><button v-for="person in buildingResidents" :key="person.id" :data-person-id="person.id" @click="focusScenePerson(person)">{{person.name}} · <span :title="person.role_description || person.role_label">{{person.role_label}}</span></button></div>
          <div v-if="selectedInfo.uses" data-testid="building-uses"><p>主用途：{{selectedInfo.uses.primary.join('、')}}</p><p>楼内服务：{{selectedInfo.uses.services.join('、')||'暂无证据'}}</p><small v-if="selectedInfo.uses.fromServices">仅据楼内兴趣点推断</small></div>
          <details class="data-details"><summary>数据详情</summary><p class="panel-hint">数据来源 ID <span>{{selectedInfo.sourceId}}</span></p></details>
        </template></section>
        <section v-if="population"><h2>人物 <small>{{population}} 人</small></h2><div class="gis-roster"><button v-for="person in roster" :key="person.id" :data-person-id="person.id" @click="focusScenePerson(person)"><span :style="{background:displayRoleColor(person.role,ROLE_COLORS)}"></span>{{person.name}}<small :title="person.role_description || person.role_label">{{person.role_label}}</small></button></div></section>
        <section v-if="scenario" class="panel-hint"><p>{{scenario.manifest.map.source.attribution}}</p><p>地图坐标：WGS84<br/>空间位置与路线：展示示意</p></section>
      </aside>
    </div>
    <footer v-if="scenario&&!isConfigPreview&&!isLive" class="gis-timeline"><div class="gis-play-row"><button class="gis-play" :disabled="loading" @click="togglePlay">{{playing?'暂停':hasSimulation?'播放回放':'播放时间'}}</button><button :disabled="loading" @click="jump(-1)">上一步</button><button :disabled="loading" @click="jump(1)">下一步</button><button v-if="hasSimulation" :disabled="loading" @click="previewWalking">看人物行走</button><label>速度 <select aria-label="回放速度" v-model.number="speed"><option v-for="value in [.5,1,2,4,8]" :value="value" :key="value">{{value}}×</option></select></label><span class="timeline-summary">{{currentStep}} <small v-if="hasSimulation">· {{activeWalkers}} 人在途</small></span></div><input aria-label="GIS 模拟时间进度" type="range" min="0" :max="maxPosition" step="0.001" v-model.number="position" @input="seek"/><div class="gis-time-endpoints"><span>天内回放进度 {{dateDisplay?.progress||0}}% · 昼夜变化为展示效果 · 起始日期 {{scenario.manifest.simulation_time.start.slice(0,10)}}</span><span>{{hasSimulation?'依据已有运行记录回放':'按场景清单的时间步推进'}}</span></div></footer>
  </div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,shallowRef,triggerRef,watch} from 'vue'
import {RouterLink,useRoute,useRouter} from 'vue-router'
import ConfigProfileFields from '../components/ConfigProfileFields.vue'
import ScenePlacementDetails from '../components/ScenePlacementDetails.vue'
import EventResultDetails from '../components/EventResultDetails.vue'
import {shopsInBuilding} from '../mecoffe/shopPresentation.js'
import {previewQuery} from '../mecoffe/configPreviewStore.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import {loadScenario,loadScenarioDirectory,directoryScenarioId,scenarioTime} from '../mecoffe/scenario.js'
import {personHistory,describeEvent} from '../mecoffe/replay.js'
import {GisReplay} from '../mecoffe/gis/replay.js'
import {displayRoleColor} from '../mecoffe/characterDisplay.js'
import {gisLayers,searchPlaces,heightDescription,simulationPosition,ROLE_COLORS} from '../mecoffe/gis/model.js'
import {BASEMAP_ADAPTERS} from '../mecoffe/gis/basemaps.js'
import {createGisDisplay} from '../mecoffe/gis/engine.js'
import {ASSET_CATALOG} from '../mecoffe/assetCatalog.js'
import {featureInfo} from '../mecoffe/gis/labels.js'
import {displayDate} from '../mecoffe/indoorMotion.js'
import {liveProgressPresentation} from '../mecoffe/livePresentation.js'
import {confirmedPresentationTotals,takeLiveAnimations} from '../mecoffe/liveRender.js'
const props=defineProps({previewScenario:{type:Object,default:null},liveState:{type:Object,default:null}})
const isLive=computed(()=>props.previewScenario?.manifest.preview_mode==='live'),detailsOpen=ref(false)
const liveProgress=computed(()=>liveProgressPresentation(props.liveState||{}))
const isConfigPreview=computed(()=>props.previewScenario?.manifest.preview_mode==='config')
const isGenericReplay=computed(()=>props.previewScenario?.manifest.preview_mode==='replay')
const isIntegratedScene=computed(()=>isConfigPreview.value||isGenericReplay.value||isLive.value)
const route=useRoute(),router=useRouter(),directory=shallowRef(null),scenarioPicker=ref(null)
const scenarioChoices=computed(()=>directory.value?.scenarios||[]),scenarioId=computed(()=>typeof route.query.scenario==='string'?route.query.scenario:directory.value?.default_id||'')
const scenario=shallowRef(null),layers=shallowRef(null),index=shallowRef(null),host=ref(null),loading=ref(true),error=ref(''),query=ref(''),selected=shallowRef(null)
const position=ref(0),cursor=ref(0),playing=ref(false),speed=ref(1),activeWalkers=ref(0),unreachable=ref(0),modelStatus=ref({}),basemap=ref('offline'),basemapNote=ref('')
const telemetry=ref({}),occupancy=shallowRef({buildings:{},persons:{},inside:0})
const visibility=reactive({buildings:true,roads:true,water:true,landcover:true,pois:true,people:true,tracks:true,entrances:true}),layerLabels={buildings:'建筑',roads:'道路',water:'水域',landcover:'地表',pois:'点位',people:'人物',tracks:'轨迹',entrances:'入口'}
const basemaps=Object.values(BASEMAP_ADAPTERS),hasSimulation=computed(()=>Boolean(scenario.value?.manifest.simulation_data)),population=computed(()=>index.value?.people.size||0),roster=computed(()=>[...(index.value?.people.values()||[])])
const maxPosition=computed(()=>index.value?.days.length||scenario.value?.manifest.simulation_time.steps||1),orders=computed(()=>confirmedPresentationTotals(index.value,cursor.value,isLive.value?props.liveState?.summary:null).orders)
const clock=computed(()=>scenario.value?scenarioTime(scenario.value.manifest.simulation_time,index.value?simulationPosition(index.value,position.value):position.value):null)
const dateDisplay=computed(()=>scenario.value?displayDate(scenario.value.manifest.simulation_time,position.value,index.value):null)
const selectedPlacement=computed(()=>{position.value;if(selectedPerson.value?.out_of_scene)return '场景外（示意，不在地图落位）';const location=replay?.personLocation(selectedPerson.value?.id);return location?.inside?`在 ${location.name} 内（示意）`:location?.phase?.startsWith('enter')?`正在进入 ${location.name}（示意）`:location?.phase?.startsWith('exit')?`正在走出 ${location.name}（示意）`:'沿步行路线移动（示意）'})
const selectedEntrances=computed(()=>{const f=selected.value?.feature;if(!f)return [];return (scenario.value?.files['entrances.json']?.entrances||[]).filter(e=>e.building_id===(f.properties.building_id||f.id))})
const buildingResidents=computed(()=>selected.value?.type==='feature'?(occupancy.value.buildings[selected.value.feature.id]||[]).map(id=>index.value?.people.get(id)).filter(Boolean):[])
const buildingShops=computed(()=>index.value&&selected.value?.type==='feature'?shopsInBuilding(index.value,scenario.value.files['location_mapping.json'],selected.value.feature.properties.building_id || selected.value.feature.id):[])
const legendPeople=computed(()=>[...new Map(roster.value.map(person=>[person.role,person])).values()])
const currentStep=computed(()=>index.value?index.value.days[Math.min(index.value.days.length-1,Math.floor(position.value))]?.label:dateDisplay.value?.label.split(' · ')[0])
const labelOptions=computed(()=>({catalog:ASSET_CATALOG,mapping:scenario.value?.files['location_mapping.json']||{}}))
const results=computed(()=>layers.value?searchPlaces(layers.value,query.value).map(item=>({...item,info:featureInfo(item.feature,labelOptions.value)})):[]),sandboxUrl=computed(()=>({path:'/mecoffe3d',query:isIntegratedScene.value?previewQuery(route.query):{scenario:scenarioId.value}}))
const selectedInfo=computed(()=>selected.value?.type==='feature'?featureInfo(selected.value.feature,labelOptions.value):null)
const selectedPerson=computed(()=>selected.value?.type==='person'?index.value?.people.get(selected.value.id):null),selectedWalking=computed(()=>{position.value;return Boolean(replay?.people.get(selectedPerson.value?.id)?.walker)})
const activity=computed(()=>selectedPerson.value&&index.value?personHistory(index.value,selectedPerson.value.id,cursor.value,5):[])
const replayOutcomeCounts=computed(()=>({declined:index.value?.scene.events.filter(e=>e.type==='declined').length||0,unknown:index.value?.scene.events.filter(e=>e.type==='unknown').length||0}))
const personFollowing=computed(()=>(index.value?.scene.relationships||[]).filter(e=>e.relation==='follow'&&e.source===selectedPerson.value?.id).map(e=>index.value.people.get(e.target)))
const personFollowers=computed(()=>(index.value?.scene.relationships||[]).filter(e=>e.relation==='follow'&&e.target===selectedPerson.value?.id))
let renderer=null,replay=null,controller=null,frame=0,lastTime=0,lastUi=0,lastMap=0,lastDraw=0,generation=0,disposed=false
function sync(){if(!replay)return;position.value=replay.position;cursor.value=replay.cursor;activeWalkers.value=replay.personData().length;unreachable.value=replay.unreachable;occupancy.value={...replay.occupancy,accounting:replay.motion?.accounting};telemetry.value=renderer?.getStats()||{}}
function tick(now){
  if(disposed)return
  const delta=lastTime?now-lastTime:0;lastTime=now
  if(isLive.value&&replay&&!props.liveState?.paused)replay.advanceLive(delta)
  if(!isLive.value&&playing.value&&replay){replay.advance(delta,speed.value);if(replay.position>=replay.maxPosition&&!replay.pending)playing.value=false}
  if(now-lastMap>=50){renderer?.setPeople();lastMap=now}
  if(now-lastUi>=200){sync();lastUi=now}
  // MapLibre schedules its own camera/model-load paints. A paused map needs
  // no continuous GPU loop; playback is capped independently of display Hz.
  if((playing.value||(isLive.value&&!props.liveState?.paused&&replay?.pending))&&now-lastDraw>=1000/90){renderer?.requestFrame();lastDraw=now}
  frame=requestAnimationFrame(tick)
}
async function load(){
  const token=++generation;controller?.abort();controller=new AbortController();playing.value=false;loading.value=true;error.value='';selected.value=null;query.value='';modelStatus.value={};basemap.value='offline';basemapNote.value=''
  renderer?.dispose();renderer=null;replay?.dispose();replay=null
  scenario.value=null;layers.value=null;index.value=null;position.value=0;cursor.value=0;activeWalkers.value=0
  try{
    let value=props.previewScenario
    if(!value){
      const nextDirectory=await loadScenarioDirectory({signal:controller.signal})
      if(disposed||token!==generation)return
      directory.value=nextDirectory
      const id=directoryScenarioId(nextDirectory,route.query.scenario)
      value=await loadScenario(id,{signal:controller.signal,includeGis:true})
      if(disposed||token!==generation)return
      const entry=nextDirectory.scenarios.find(item=>item.id===id)
      if(entry.title!==value.manifest.title||entry.simulation_data!==value.manifest.simulation_data)throw new Error('场景目录已过期，请重新生成目录')
    }
    const geo=gisLayers(value),nextReplay=new GisReplay(value);replay=nextReplay;index.value=nextReplay.index;scenario.value=value;layers.value=geo
    await nextReplay.prepare(controller.signal);if(disposed||token!==generation)return
    await nextTick();if(disposed||token!==generation)return
    const display=await createGisDisplay({host:host.value,layers:geo,replay:nextReplay,describeFeature:feature=>featureInfo(feature,{catalog:ASSET_CATALOG,mapping:value.files['location_mapping.json']||{}}),signal:controller.signal,onSelect:item=>{selected.value=item},onStatus:value=>{modelStatus.value=value},onError:e=>{if(token===generation&&!disposed)error.value=e.message||String(e)},onBasemapFallback:message=>{basemap.value='offline';basemapNote.value=message}})
    if(disposed||token!==generation){display.dispose();return}
    renderer=display;renderer.setLayers(visibility);sync();loading.value=false;if(isLive.value)applyLiveUpdate(props.liveState);document.title=`${value.manifest.title} · GIS 模式`
  }catch(e){if(e.name!=='AbortError'&&token===generation&&!disposed){loading.value=false;error.value=e.message||String(e)}}
}
function focusScenePerson(person){selected.value={type:'person',id:person.id};if(!person.out_of_scene)renderer?.focusPerson(person.id)}
function closeScenarioPicker(){if(scenarioPicker.value){scenarioPicker.value.open=false;scenarioPicker.value.querySelector('summary').focus()}}
function blurScenarioPicker(event){if(!scenarioPicker.value.contains(event.relatedTarget))scenarioPicker.value.open=false}
function changeScenario(id){closeScenarioPicker();router.push({path:'/mecoffe-gis',query:{scenario:id}})}
function moveScenarioOption(event,direction){const options=[...scenarioPicker.value.querySelectorAll('[role=option]')];options[(options.indexOf(document.activeElement)+direction+options.length)%options.length]?.focus()}
function setLayers(){renderer?.setLayers(visibility)}
function setBasemap(){basemapNote.value='';renderer?.setBasemap(basemap.value)}
function seek(){if(!replay)return;playing.value=false;replay.seek(Number(position.value));sync();renderer?.setPeople();renderer?.requestFrame()}
function jump(delta){position.value=Math.max(0,Math.min(maxPosition.value,Math.floor(position.value)+delta));seek()}
function togglePlay(){if(!replay)return;if(playing.value)sync();if(replay.position>=replay.maxPosition&&!replay.pending){position.value=0;seek()}playing.value=!playing.value;lastTime=0}
function previewWalking(){if(!replay?.index)return;position.value=replay.previewPosition();seek();playing.value=true;lastTime=0;const first=replay.index.scene.events.find(e=>e.type==='purchase');if(first)renderer?.select({type:'person',id:first.actor})}
const liveAnimationSeen=new Set()
/** 复用同一个 MapLibre 实例与模型，仅更新实时数据和已核实动作。 */
function applyLiveUpdate(state=props.liveState){
  if(!isLive.value||!renderer||!replay||!state)return
  if(state.paused)return
  replay.updateLive();triggerRef(index)
  const animations=takeLiveAnimations(state,liveAnimationSeen)
  for(const event of animations)if(event.type==='purchase')replay.event(event)
  renderer.showLiveEvents(animations)
  renderer.setPeople();renderer.requestFrame();sync()
}
function followLiveLatest(){
  if(!replay)return
  replay.followLiveLatest()
  for(const item of renderer?.liveBubbles||[])item.element.remove();if(renderer)renderer.liveBubbles=[]
  for(const event of props.liveState?.animationQueue||[])liveAnimationSeen.add(`${event.key}|${event.type}|${event.order_id||''}|${event.evidence_status||''}`)
  renderer?.setPeople();renderer?.requestFrame();sync()
}
watch(()=>props.liveState?.revision,()=>applyLiveUpdate())
watch(()=>props.liveState?.paused,()=>applyLiveUpdate())
defineExpose({applyLiveUpdate,followLiveLatest})
watch(()=>route.query.scenario,load)
watch(playing,value=>renderer?.setMeasuring(value))
onMounted(()=>{load();frame=requestAnimationFrame(tick)})
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();cancelAnimationFrame(frame);renderer?.dispose();replay?.dispose()})
</script>
<style scoped>
.population-accounting{font-size:12px;color:#385f54;margin:4px 1px 8px}
.gis-page{background:#f3f5ee;color:#244b46;min-height:100vh;padding:16px;box-sizing:border-box;text-align:left;font:13px/1.5 'Microsoft YaHei',Arial,sans-serif}
.gis-page *{box-sizing:border-box}
.gis-header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:14px}
.gis-brand{display:flex;gap:12px;align-items:center}
.gis-logo{display:grid;place-items:center;font-size:28px;color:white;background:#287c68;border-radius:12px;width:44px;height:44px}
.gis-brand p{margin:0;font-size:10px;letter-spacing:2px;color:#718c81}
.gis-brand h1{font-size:21px;margin:1px 0}
.gis-header nav{display:flex;align-items:center;gap:18px}
.scenario-picker{position:relative;max-width:440px}
.scenario-picker>summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;border:1px solid #ccd8ca;background:#fffefa;border-radius:6px;padding:7px 10px}
.scenario-picker>summary::-webkit-details-marker{display:none}
.scenario-picker>summary span{margin-left:auto}
.scenario-options{position:absolute;right:0;top:calc(100% + 6px);z-index:10;width:max-content;min-width:100%;max-width:min(440px,90vw);padding:5px;background:#fffefa;border:1px solid #ccd8ca;border-radius:8px;box-shadow:0 8px 24px #244b4630}
.scenario-options button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:10px 12px}
.scenario-options button[aria-selected=true]{background:#e7efe1}
.scenario-options small{display:block;font-size:10px;color:#718479;margin-top:3px}
.gis-header a{color:#327b68;text-decoration:none;font-weight:600}
.gis-header label{display:flex;align-items:center;gap:8px}
button,select,input{font:inherit;color:inherit}
button,select{border:1px solid #ccd8ca;background:#fffefa;border-radius:6px;padding:7px 10px}
button{cursor:pointer}
button:disabled{cursor:default;opacity:.45}
button:hover:not(:disabled){border-color:#548b76;background:#edf3e9}
input[type=checkbox],input[type=range]{accent-color:#287c68}
.gis-notice{margin:0 0 10px;padding:9px 13px;background:#fff6dc;border:1px solid #e8d69a;border-radius:7px;color:#6c5c31;font-size:12px}
.gis-error{display:flex;align-items:center;gap:15px;padding:12px;border:1px solid #c67453;background:#fff4e9;margin-bottom:10px;border-radius:6px}
.gis-metrics{display:grid;grid-template-columns:repeat(4,1fr) 1.65fr;gap:10px;margin-bottom:8px}
.gis-metrics>div{background:#fff;border:1px solid #dce3d7;border-radius:9px;padding:9px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.gis-metrics span{color:#718479;font-size:11px}
.gis-metrics strong{font-size:24px;white-space:nowrap}
.gis-metrics small{font-size:11px;font-weight:400}
.gis-metrics .clock{font-size:16px}
.gis-data-note{margin:0 0 10px;color:#5b7a6e;font-size:11px}
.gis-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:12px}
.gis-map-wrap{position:relative;border:1px solid #d3ddce;border-radius:12px;overflow:hidden;background:#e9eee8}
.gis-map{height:calc(100vh - 335px);min-height:520px;width:100%}
.gis-loading{position:absolute;inset:0;display:grid;place-items:center;background:#e9eee8e8;font-size:16px}
.gis-map-tools{position:absolute;top:14px;left:14px;display:flex;align-items:center;gap:7px}
.gis-map-badge{padding:7px 10px;border-radius:5px;background:#fffcf2e8;box-shadow:0 2px 10px #345b4520;font-size:11px}
.gis-map-tools button{box-shadow:0 2px 10px #345b4510}
.gis-legend{position:absolute;left:12px;bottom:40px;background:#fffdf4ed;padding:12px;border:1px solid #d9e1d1;border-radius:7px;display:flex;align-items:center;gap:11px;font-size:10px;flex-wrap:wrap;max-width:380px;pointer-events:none}
.gis-legend span{display:flex;align-items:center;gap:4px}
.gis-legend i{width:8px;height:8px;display:inline-block}
.gis-legend small{width:100%;color:#7c8b7d;font-size:9px}
.gis-model-status{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);padding:5px 12px;background:#fefcf0e8;border-radius:12px;font-size:11px}
.gis-panel{height:calc(100vh - 335px);min-height:520px;overflow:auto;background:#fff;border:1px solid #dce3d7;border-radius:10px;padding:0 16px}
.gis-panel section{padding:15px 0;border-bottom:1px solid #e6ebe2}
.gis-panel h2{font-size:13px;margin:0 0 10px}
.gis-panel h2 small{font-size:11px;font-weight:400;color:#75877d}
.basemap-label{display:flex;align-items:center;justify-content:space-between;font-size:12px}
.basemap-label select{width:196px}
.layer-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 2px;margin-top:14px;font-size:11px}
.layer-grid label{display:flex;align-items:center;gap:3px}
.gis-search{width:100%;border:1px solid #d5ded0;background:#f3f6ef;border-radius:6px;padding:9px 10px}
.search-results{max-height:215px;overflow:auto}
.search-results button{display:block;border:0;border-bottom:1px solid #e7ece2;background:transparent;width:100%;text-align:left;padding:10px 5px}
.search-results small{display:block;color:#7f8f81;font-size:10px;margin-top:3px}
.panel-hint{color:#7a8b7c;font-size:11px;overflow-wrap:anywhere}
.gis-info h3{margin:4px 0 8px;font-size:17px}
.role-badge{font-size:10px;background:#e5efdf;padding:3px 7px;border-radius:4px}
.gis-info p{font-size:12px;line-height:1.8}
.gis-info h4{font-size:12px;margin-bottom:4px}
.activity-item{border-left:2px solid #b6cbb0;padding-left:8px}
.gis-info dl{display:grid;grid-template-columns:70px 1fr;font-size:12px;gap:8px}
.gis-info dt{color:#7b8b7e}
.gis-info dd{margin:0;overflow-wrap:anywhere}
.gis-data-code,:deep(.gis-data-code){color:#8a978f;font-size:10px;overflow-wrap:anywhere;font-weight:400}
.mapped-location{display:block}
.indoor-residents button{display:block;width:100%;text-align:left;margin:4px 0;font-size:11px}
.data-details{font-size:11px;color:#708578;margin-top:12px}
.data-details summary{cursor:pointer}
.data-details p span{display:block;margin-top:4px}
.gis-roster{max-height:210px;overflow:auto}
.gis-roster button{display:flex;align-items:center;gap:6px;width:100%;background:transparent;border:0;border-bottom:1px solid #eef0eb;padding:8px 0;font-size:12px}
.gis-roster button>span{height:7px;width:7px;border-radius:50%}
.gis-roster small{margin-left:auto;font-size:10px;color:#87958b}
.gis-timeline{background:#fff;border:1px solid #dce3d7;border-radius:9px;padding:10px 12px;margin-top:10px}
.gis-play-row{display:flex;gap:8px;align-items:center}
.gis-play-row button{font-size:12px}
.gis-play-row label{display:flex;gap:6px;align-items:center;font-size:11px}
.gis-play-row select{padding:4px}
.gis-play-row .gis-play{background:#287c68;color:white;border-color:#287c68;min-width:88px}
.gis-play-row .gis-play:hover{background:#206956}
.timeline-summary{margin-left:auto;font-size:12px}
.timeline-summary small{font-size:10px;color:#769080}
.gis-timeline input[type=range]{width:100%;height:7px;margin:13px 0 4px}
.gis-time-endpoints{display:flex;justify-content:space-between;color:#8a978b;font-size:9px}

:deep(.maplibregl-popup-content){border-radius:9px;padding:16px 22px 12px 14px;color:#244b46;font:12px/1.6 'Microsoft YaHei',sans-serif;box-shadow:0 3px 18px #294a3728}
:deep(.gis-popup-content strong){font-size:15px}
:deep(.gis-popup-content p){margin:6px 0 0;overflow-wrap:anywhere}
:deep(.maplibregl-ctrl-attrib){font-size:10px;background:#fffdf1e8}
:deep(.maplibregl-ctrl-scale){background:#fffdf1d9;font-size:10px}

@media(max-width:1000px){.gis-header{align-items:flex-start}
.gis-header nav{gap:9px;flex-wrap:wrap;justify-content:flex-end}
.gis-layout{grid-template-columns:minmax(0,1fr) 260px}
.gis-metrics{grid-template-columns:repeat(4,1fr)}
.gis-metrics>div:last-child{grid-column:1/-1}
.gis-metrics .clock{font-size:14px}
.gis-map,.gis-panel{height:calc(100vh - 335px)}
.basemap-label{display:block}
.basemap-label select{width:100%;margin-top:6px}
.layer-grid{grid-template-columns:repeat(3,1fr)}
}

@media(max-width:640px){.gis-page{padding:9px}
.gis-header{display:block}
.gis-brand h1{font-size:18px}
.gis-header nav{justify-content:flex-start;margin-top:10px;font-size:11px;gap:11px}
.gis-header nav label{width:100%}
.scenario-picker{width:100%;max-width:100%}
.gis-header nav select{flex:1}
.gis-metrics{gap:5px}
.gis-metrics>div{padding:6px;display:block}
.gis-metrics strong{font-size:19px;display:block}
.gis-metrics>div:last-child{display:flex}
.gis-layout{display:flex;flex-direction:column}
.gis-map{height:530px;min-height:530px}
.gis-panel{height:auto;min-height:0;max-height:650px}
.gis-map-tools{gap:4px;left:8px;top:8px;flex-wrap:wrap;max-width:270px}
.gis-map-tools button{font-size:11px;padding:6px}
.gis-legend{max-width:280px;gap:7px}
.gis-play-row{flex-wrap:wrap}
.gis-play-row button{padding:6px}
.timeline-summary{margin-left:0}
.gis-timeline{margin-top:8px}
}

</style>

<style scoped>
.gis-role-key{display:flex;gap:8px;flex-wrap:wrap;width:100%}.building-shops{padding:10px;background:#f3f8f4;border:1px solid #d9e6dc;border-radius:8px;margin:14px 0}.building-shops h4{margin:0 0 10px;font-size:12px}.building-shops>div{display:grid;gap:4px;padding:8px 0;border-top:1px solid #dee8df}.building-shops b{color:#286952;font-size:12px}.building-shops span,.building-shops small{color:#6e8377;font-size:11px;overflow-wrap:anywhere}.role-description{font-size:11px;color:#617d6e;margin:10px 0}.role-description summary{cursor:pointer}.role-description p{line-height:1.7}.role-description small{overflow-wrap:anywhere}
</style>

<style scoped>.gis-role-key [title]{pointer-events:auto}</style>

<style scoped>
.gis-details-toggle{display:none}
.gis-page.integrated-page{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.integrated-page .gis-layout{flex:1;min-height:0;position:relative}
.integrated-page .gis-map-wrap{min-height:0;min-width:0}
.integrated-page .gis-map{height:100%;min-height:0}
.integrated-page .gis-panel{height:100%;min-height:0;overflow:auto}
.integrated-page .gis-header{margin-bottom:6px}
.integrated-page .gis-brand h1{font-size:17px}
.integrated-page .gis-brand p{display:none}
.integrated-page .gis-metrics>div{padding:5px 9px}
.integrated-page .gis-data-note{margin-bottom:5px}
@media(max-width:900px){
 .integrated-page .gis-details-toggle{display:block;align-self:flex-end;font-size:11px;padding:5px 9px;margin-bottom:5px}
 .integrated-page .gis-layout{display:flex;flex-direction:row}
 .integrated-page .gis-map-wrap{flex:1}
 .integrated-page .gis-map{height:100%;min-height:0}
 .integrated-page .gis-panel{display:none}
 .integrated-page.details-open .gis-panel{display:block;position:absolute;right:6px;top:6px;bottom:6px;width:min(310px,85%);height:auto;max-height:none;z-index:8;background:#fff;box-shadow:0 5px 24px #24473730}
 .integrated-page .gis-header nav{gap:7px;font-size:11px}
 .integrated-page .gis-header nav a:nth-child(n+2){display:none}
 .integrated-page .gis-legend{max-width:230px;gap:5px;padding:5px}
 .integrated-page .gis-legend small{display:none}
}
@media(max-height:650px){
 .gis-page.integrated-page{padding:8px 10px}
 .integrated-page .gis-header,.integrated-page .gis-metrics,.integrated-page .gis-data-note{display:none}
 .integrated-page .gis-notice{font-size:10px;padding:5px 8px;margin-bottom:4px}
 .integrated-page .population-accounting{font-size:10px;margin:0 0 4px}
}
</style>
