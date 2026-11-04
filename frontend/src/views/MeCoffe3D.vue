<template>
  <div class="campus3d-page" :data-indoor-occupancy="JSON.stringify(indoorState.buildings)" :data-inside="indoorState.inside">
    <header class="page-header">
      <div class="title-group"><span class="logo"><i class="fa-solid fa-cubes"></i></span><div><h1>{{scenario?.manifest.title || '中科大高新校区 · 三维校园沙盘'}}</h1><p>MeCoffe / 阶段 1 · OSM 建筑体块与步行路网</p></div></div>
      <div class="header-actions">
        <nav v-if="!scenario" aria-label="场景数据模式" class="mode-switch">
          <button v-for="mode in modes" :key="mode.key" :class="{ active: requestedMode === mode.key }" :aria-pressed="requestedMode === mode.key" :disabled="loading" @click="loadScene(mode.key)">{{ mode.label }}</button>
        </nav>
        <Campus3DVisualControls :building-style="scenario?.manifest.style?.buildings || 'yulan'" v-model:character-pool="characterPool" :quality="quality" @update:quality="chooseQuality" v-model:cycle="dayCycle" v-model:hour="previewHour" :clock="'光照：展示效果'" />
        <span v-if="styleBusy" role="status" class="style-status">正在准备三维素材…</span>
        <RouterLink to="/mecoffe" class="old-page">二维沙盘 ↗</RouterLink>
        <RouterLink :to="{path:'/mecoffe-gis',query:{scenario:scenario?.manifest.id || 'ustc-history'}}" class="old-page">GIS 模式 ↗</RouterLink>
        <RouterLink to="/mecoffe3d/assets" class="old-page">场景素材库 ↗</RouterLink>
      </div>
    </header>

    <div class="spatial-notice" role="note"><i class="fa-solid fa-circle-info"></i><strong>建筑与道路来自 OpenStreetMap；人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据</strong></div>
    <div v-if="loadError" class="error-panel" role="alert"><strong>三维场景未能加载</strong><p>{{ loadError }}</p><button @click="loadScene(requestedMode)">重新加载</button><RouterLink to="/mecoffe">打开原二维页面</RouterLink></div>
    <p v-if="styleError" role="alert" class="data-notice">{{styleError}}</p>

    <template v-if="index && !loadError">
      <div class="data-notice" data-testid="simulation-time">{{dayDisplay?.label || currentDay.label}} · 天内回放进度 {{dayDisplay?.progress || 0}}% · 昼夜变化为展示效果</div>
      <div class="data-notice" :class="requestedMode" data-testid="data-notice">{{ dataNotice }}</div>

      <p v-if="qualityNotice" role="status" class="data-notice">{{ qualityNotice }}</p>
      <section class="kpis" aria-label="回放指标">
        <div><span>{{ isNetwork ? '人物关系输入' : currentDay.label }}</span><strong>{{ scene.people.length }}<small> 人</small></strong><em>快照 {{ meta.snapshot_revision ? `v${meta.snapshot_revision}` : '历史版本' }}</em></div>
        <div><span>初始关注关系</span><strong>{{ follows.length }}<small> 条</small></strong><em>{{ isNetwork ? '静态网络，尚未运行' : '与原数据保持一致' }}</em></div>
        <div><span>{{ isDemo ? '演示订单 / 金额' : '回放订单 / 金额' }}</span><strong data-testid="order-count">{{ state.orders }}<small> 单</small></strong><em>¥{{ revenue }} · {{ isNetwork ? '无行为轨迹' : `${cursor} / ${scene.events.length} 条事件` }}</em></div>
        <div><span>人物移动 · 展示层</span><strong data-testid="active-walkers">{{ motion.active }}<small> 人在途</small></strong><em>排队 {{ motion.queued }} 笔<span v-if="motion.unreachable"> · 不可达 {{ motion.unreachable }} 笔</span></em></div>
      </section>

      <main class="main-layout">
        <section class="map-panel" aria-label="中科大高新校区三维场景">
          <div ref="mapEl" class="map-canvas"></div>
          <div class="map-top"><div class="map-badge"><b>USTC · 高新校区</b><span>{{ campusData?.buildings.length || 0 }} 栋建筑 / {{ campusData?.roads.length || 0 }} 段道路</span></div><div class="map-camera-buttons"><button class="reset-camera" title="放大查看选中人物或当前行人" @click="focusPerson"><i class="fa-solid fa-person-walking"></i> 人物特写</button><button class="reset-camera" title="恢复校园全景" @click="renderer?.resetCamera()"><i class="fa-solid fa-expand"></i> 全景</button></div></div>
          <div v-if="hoverCard" class="hover-card" :style="hoverStyle"><b>{{ hoverCard.name }}</b><template v-if="hoverCard.type === 'building'"><span>OSM {{ hoverCard.building.osm_id }}</span><span>{{ hoverCard.building.levels }} 层 / {{ hoverCard.building.height_m }} 米 · {{ hoverCard.building.levels_source === 'default' ? '展示默认高度' : '来源见地图数据' }}</span></template><span v-else>点击查看人物与事件</span></div>
          <div class="map-legend"><span><i style="background:#7c9cab"></i>教学 / 科研</span><span><i style="background:#bc7859"></i>住宿</span><span><i style="background:#65a89b"></i>公共设施</span><div class="role-key"><span v-for="(color, role) in CHARACTER_ROLE_COLORS" :key="role"><i :style="{background:color}"></i>{{ roleNames[role] }}</span></div><p>写实人物为外观示意；脚下颜色表示角色<br>人物活动限制在建成区校界内<br>水域不可行走，仅跨水道路 / 桥面可通行<br>跑道外圈、球场排布、桥型与水深：展示设定<br>树木、路灯、长椅、草地纹理：<b>装饰</b><br>楼顶人数与光照：展示示意；楼层仍为默认值<br>校外道路仅展示，不参与寻路<br>左键旋转 · 右键平移 · 滚轮缩放</p></div>
          <a class="osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      <div v-if="characterStatus.visibleReady < characterStatus.visibleTotal || characterStatus.failed" class="data-notice character-loading" role="status"><span>正在加载人物 {{ characterStatus.visibleReady || 0 }}/{{ characterStatus.visibleTotal || 0 }}…</span><button v-if="characterStatus.failed" @click="renderer?.retryCharacters()">重试 {{ characterStatus.failed }} 个模型</button></div>
          <div v-if="loading" class="map-loading">正在构建校园三维体块…</div>
        </section>

        <aside class="side-panel">
          <nav class="side-tabs" aria-label="场景信息"><button v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.label }}</button></nav>
          <div v-if="activeTab === 'events'" class="side-content">
            <div class="section-heading"><h2>{{ isNetwork ? '关注关系输入' : '事件记录' }}</h2><small>{{ isDemo ? '规则演示' : isNetwork ? '尚未运行' : '历史 OASIS' }}</small></div>
            <p v-if="isNetwork" class="muted">此模式只有人物与关注关系，没有订单或可播放的行为。选择“人物”可查看关注对象。</p>
            <p v-else-if="!recentEvents.length" class="empty">播放或单步查看事件。购买事件会触发沿 OSM 路网的往返动画。</p>
            <button v-for="event in recentEvents" :key="event.key" class="event-row" @click="selectPerson(event.actor)"><span class="event-meta">{{ event.step === 0 ? '初始化' : `第 ${event.step} 天` }} · {{ EVENT_LABELS[event.type] || event.type }}</span><span>{{ describeEvent(index, event) }}</span></button>
            <div class="brand-totals"><div v-for="(brand, i) in scene.brands" :key="brand.brand_id"><i :style="{ background: brandColors[i % 2] }"></i><span>{{ brand.product_name }}</span><b>{{ state.cups[brand.brand_id] }} 杯</b></div></div>
          </div>
          <div v-else-if="activeTab === 'people'" class="side-content">
            <label class="search"><i class="fa-solid fa-magnifying-glass"></i><input v-model="query" placeholder="搜索人物姓名或编号" aria-label="搜索人物" /></label>
            <div v-if="selected" class="person-detail"><div class="person-title"><span class="person-dot" :style="{ background: roleColor(selected.role) }"></span><h2>{{ selected.name }}</h2><small>{{ selected.role_label }}</small></div><code>{{ selected.id }}</code><p>{{personPlacement(selected.id)}}</p><p class="mapping-note">{{ mappingEntry(selected)?.note }}</p><p class="person-bio">{{ selected.bio }}</p><p>关注 {{ selectedFollowing.length }} 人 · 被关注 {{ selectedFollowers.length }} 人</p><div class="relation-buttons"><button v-for="person in selectedFollowing" :key="person.id" @click="selectPerson(person.id)">{{ person.name }}</button></div><div v-if="selectedHistory.length" class="person-history"><h3>截至当前的行为</h3><p v-for="event in selectedHistory.slice(0, 5)" :key="event.key">{{ describeEvent(index, event) }}</p></div></div>
            <div class="roster" aria-label="人物名册"><button v-for="person in roster" :key="person.id" :data-person-id="person.id" :class="{ selected: selectedId === person.id }" @click="selectPerson(person.id)"><span class="person-dot" :style="{ background: roleColor(person.role) }"></span><span>{{ person.name }}<small>{{ mappedBuilding(person)?.name || person.role_label }}</small></span><i v-if="selectedId === person.id" class="fa-solid fa-chevron-right"></i></button></div>
          </div>
          <div v-else-if="activeTab === 'building'" class="side-content"><h2>{{selectedBuilding?.name || '楼栋'}}</h2><p>楼内 {{buildingResidents.length}} 人（示意）</p><div class="roster"><button v-for="person in buildingResidents" :key="person.id" @click="selectPerson(person.id)">{{person.name}} · {{person.role_label}}</button></div></div>
          <div v-else class="side-content">
            <div class="section-heading"><h2>真实楼栋 · 示意对应</h2><small>8 个地点</small></div><p class="muted">轮廓与楼名来自 OSM。下面是原沙盘地点的人工展示映射，咖啡店不是核实店址。</p>
            <div v-for="[key, entry] in Object.entries(mappingData?.mappings || {})" :key="key" class="mapping-row"><small>{{ key }}</small><b>{{ buildingById.get(entry.osm_id)?.name || entry.osm_id }}</b><p>{{ entry.note }}</p></div>
          </div>
        </aside>
      </main>

      <footer class="timeline-panel">
        <div class="playback-controls"><button class="play-button" :disabled="loading || isNetwork" :aria-label="playing || draining ? '暂停回放' : '播放回放'" @click="togglePlay"><i :class="playing || draining ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>{{ playing || draining ? '暂停' : '播放' }}</button><button :disabled="loading || isNetwork" title="上一天" @click="jumpDay(-1)">上一天</button><button :disabled="loading || isNetwork || cursor >= scene.events.length" @click="stepEvent">下一事件</button><button :disabled="loading || isNetwork" title="下一天" @click="jumpDay(1)">下一天</button><button :disabled="loading || isNetwork" title="跳转到首笔购买事件并播放人物往返" @click="previewWalking">看人物行走</button><label>速度 <select v-model.number="speed" :disabled="isNetwork"><option v-for="n in [0.5, 1, 2, 4, 8]" :key="n" :value="n">{{ n }}×</option></select></label><strong class="current-day" data-testid="current-day">{{ currentDay.label }}<small v-if="!currentDay.complete"> · 记录不完整</small><small v-else-if="atEnd"> · {{ draining ? '等待人物返回' : '已到末尾' }}</small></strong></div>
        <div v-if="!isNetwork" class="timeline-track"><input :disabled="loading" :value="dayPosition" :max="days.length" min="0" step="0.001" type="range" aria-label="回放时间进度" @input="seek(Number($event.target.value))" /><span>{{ Math.round(progressPercent) }}%</span></div>
        <div v-if="!isNetwork" class="day-buttons" aria-label="按天跳转"><button v-for="(day, k) in days" :key="day.step" :disabled="loading" :class="{ active: dayIndex === k, partial: !day.complete }" :title="`${day.label}${day.complete ? '' : '（不完整）'}`" :aria-label="`跳转到${day.label}`" @click="seek(k)">{{ day.step === 0 ? '初' : day.step }}</button></div><p v-else class="network-footer">关系网络模式没有时间轨迹；购买、发帖、访谈结果均为零，不借用旧运行。</p>
      </footer>
    </template>
    <div v-else-if="loading && !loadError" class="initial-loading">正在读取 OSM 校园与回放数据…</div>
  </div>
</template>

<script setup>
import {IS_PAGES} from '../mecoffe/publicUrl.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Campus3DVisualControls from '../components/Campus3DVisualControls.vue'
import { Campus3DScene } from '../mecoffe/Campus3DScene.js'
import { describeEvent, EVENT_LABELS, indexScene, personHistory, stateAt } from '../mecoffe/replay.js'
import { advancePosition, clampPosition, cursorAtPosition, dataFileForMode, positionAtCursor, validateDataMode } from '../mecoffe/campus3dPlayback.js'
import { resolveHomeKey } from '../mecoffe/campus3dRouting.js'
import { CHARACTER_ROLE_COLORS } from '../mecoffe/characterDisplay.js'
import {scenarioTime} from '../mecoffe/scenario.js'
import {displayDate} from '../mecoffe/indoorMotion.js'
import { visualClock } from '../mecoffe/campus3dPresentation.js'

const props=defineProps({scenario:{type:Object,default:null}})
const modes = [{ key: 'demo', label: '新版演示' }, { key: 'network', label: '关系网络' }, { key: 'history', label: '历史回放' }]
const tabs = [{ key: 'events', label: '事件' }, { key: 'people', label: '人物' }, { key: 'mapping', label: '地点映射' }, {key:'building',label:'楼栋'}]
const brandColors = ['#22856e', '#bd7545']
const index = shallowRef(null)
const campusData = shallowRef(null)
const indoorState=shallowRef({buildings:{},persons:{},inside:0}), selectedBuildingId=ref(null), sourceTime=shallowRef(null)
const selectedBuilding=computed(()=>campusData.value?.buildings.find(b=>b.osm_id===selectedBuildingId.value))
const buildingResidents=computed(()=>(indoorState.value.buildings[selectedBuildingId.value]||[]).map(id=>index.value?.people.get(id)).filter(Boolean))
function personPlacement(id){const state=indoorState.value.persons[id],b=campusData.value?.buildings.find(b=>b.osm_id===state?.buildingId);return state?.buildingId?`在 ${b?.name || '楼栋'} 内（示意）`:'正在进出楼或沿步行路线移动（示意）'}
const mappingData = shallowRef(null)
const mapEl = ref(null)
const loading = ref(true)
const loadError = ref('')
const requestedMode = ref('demo')
const activeTab = ref('events')
const selectedId = ref(null)
const query = ref('')
const hoverCard = shallowRef(null)
const playing = ref(false)
const draining = ref(false)
const speed = ref(1)
const quality = ref('high')
const qualityNotice=ref('')
let manualQuality=false
function chooseQuality(value){qualityNotice.value='';manualQuality=true;quality.value=value;renderer?.performancePolicy.chooseManually();renderer?.setQuality(value)}
const characterPool = ref('campus')
const characterStatus = ref({available:0,visibleReady:0,visibleTotal:0,failed:0})
const styleBusy = ref(0)
const styleError = ref('')
const dayCycle = ref(true)
const previewHour = ref(12)
const roleNames = { undergraduate_consumer:'本科生', graduate_consumer:'研究生', teacher_consumer:'教师', merchant:'商家' }
const dayPosition = ref(0)
const motion = ref({ active: 0, queued: 0, unreachable: 0 })
const pendingEffects = ref(0)
const hasPendingAnimation = () => Boolean(motion.value.pending || motion.value.active || motion.value.queued || pendingEffects.value)
let renderer = null
let generation = 0
let controller = null
let frame = 0
let lastTime = 0, precisePosition=0, lastUiTime=0

const scene = computed(() => index.value?.scene)
const meta = computed(() => scene.value?.meta)
const isNetwork = computed(() => requestedMode.value === 'network')
const isDemo = computed(() => requestedMode.value === 'demo')
const days = computed(() => index.value?.days || [])
const cursor = computed(() => index.value ? cursorAtPosition(index.value, dayPosition.value) : 0)
const atEnd = computed(() => index.value && dayPosition.value >= days.value.length)
const dayIndex = computed(() => Math.max(0, Math.min(days.value.length - 1, Math.floor(dayPosition.value))))
const currentDay = computed(() => days.value[dayIndex.value] || { label: '', complete: true })
const dayDisplay=computed(()=>sourceTime.value?displayDate(sourceTime.value,dayPosition.value,index.value):null)
const simulatedClock=computed(()=>props.scenario?scenarioTime(props.scenario.manifest.simulation_time,Math.max(0,dayPosition.value-(days.value[0]?.step===0?1:0))):null)
const lightClock = computed(() => simulatedClock.value && dayCycle.value ? {...simulatedClock.value,label:simulatedClock.value.label.slice(11)} : visualClock(dayPosition.value,{cycle:dayCycle.value,hour:previewHour.value}))
function lightSettings(){return simulatedClock.value && dayCycle.value?{cycle:false,hour:simulatedClock.value.hour}:{position:dayPosition.value,cycle:dayCycle.value,hour:previewHour.value}}
const state = computed(() => index.value ? stateAt(index.value, cursor.value) : null)
const revenue = computed(() => (Object.values(state.value?.revenueFen || {}).reduce((sum, n) => sum + n, 0) / 100).toFixed(2))
const follows = computed(() => (scene.value?.relationships || []).filter(edge => edge.relation === 'follow'))
const progressPercent = computed(() => days.value.length ? dayPosition.value / days.value.length * 100 : 0)
const buildingById = computed(() => new Map((campusData.value?.buildings || []).map(building => [building.osm_id, building])))
const selected = computed(() => index.value?.people.get(selectedId.value))
const selectedFollowing = computed(() => follows.value.filter(edge => edge.source === selectedId.value).map(edge => index.value.people.get(edge.target)).filter(Boolean))
const selectedFollowers = computed(() => follows.value.filter(edge => edge.target === selectedId.value))
const selectedHistory = computed(() => selected.value ? personHistory(index.value, selectedId.value, cursor.value, 20) : [])
const recentEvents = computed(() => scene.value?.events.slice(Math.max(0, cursor.value - 30), cursor.value).reverse() || [])
const roster = computed(() => (scene.value?.people || []).filter(person => `${person.name} ${person.id}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const hoverStyle = computed(() => {
  const card = hoverCard.value
  const rect = mapEl.value?.getBoundingClientRect()
  if (!card || !rect) return {}
  return { left: `${Math.max(10, Math.min(rect.width - 265, card.x - rect.left + 14))}px`, top: `${Math.max(70, Math.min(rect.height - 110, card.y - rect.top + 12))}px` }
})
const dataNotice = computed(() => {
  if (isDemo.value) return `新版演示：快照 v${meta.value?.snapshot_revision} 的 30 天规则演示，非 OASIS 运行结果。购买与传播按本地示例规则生成。`
  if (isNetwork.value) return `关系网络：快照 v${meta.value?.snapshot_revision} 的静态人物与关注输入，尚未运行；不含购买、发帖或访谈轨迹。`
  return `历史回放：原 OASIS 运行状态 ${meta.value?.status}，完整完成 ${meta.value?.completed_steps}/${meta.value?.total_steps} 天；第 24 天只有部分记录，后续天数未补造。`
})
const mappingEntry = person => mappingData.value?.mappings[resolveHomeKey(person)]
const mappedBuilding = person => buildingById.value.get(mappingEntry(person)?.osm_id)
const roleColor = role => ({ merchant: '#bb7545', undergraduate_consumer: '#3888aa', graduate_consumer: '#8a78b4', teacher_consumer: '#58916a' }[role] || '#637d8a')

function selectPerson(id) {
  selectedId.value = id
  activeTab.value = 'people'
  renderer?.selectPerson(id)
}
function focusPerson() {
  const id = renderer?.focusPerson(selectedId.value)
  if (id) selectPerson(id)
}
function stopTimeline() {
  if(playing.value)dayPosition.value=precisePosition
  playing.value = false
  draining.value = false
  cancelAnimationFrame(frame)
  lastTime = 0
}
function animateRange(from, to) {
  for (let i = from; i < to; i += 1) renderer?.playEvent(scene.value.events[i])
}
function loop(now) {
  if (!playing.value || !index.value) return
  const before=cursorAtPosition(index.value,precisePosition)
  const elapsed=lastTime?now-lastTime:0;lastTime=now
  precisePosition=advancePosition(index.value,precisePosition,elapsed,speed.value,12)
  renderer?.setIndoorPosition(precisePosition)
  animateRange(before,cursorAtPosition(index.value,precisePosition))
  if(now-lastUiTime>=200 || precisePosition>=days.value.length){dayPosition.value=precisePosition;lastUiTime=now}
  if (atEnd.value) {
    draining.value = hasPendingAnimation()
    playing.value = false
    return
  }
  frame = requestAnimationFrame(loop)
}
function togglePlay() {
  if (loading.value || isNetwork.value) return
  if (playing.value || draining.value) { stopTimeline(); return }
  if (atEnd.value && hasPendingAnimation()) { draining.value = true; return }
  if (atEnd.value) seek(0)
  playing.value = true
  lastTime = 0
  frame = requestAnimationFrame(loop)
}
function seek(position) {
  if (!index.value || loading.value) return
  stopTimeline()
  dayPosition.value = clampPosition(index.value, position)
  precisePosition=dayPosition.value
  if(renderer?.indoor){renderer.indoor.reset();renderer.setIndoorPosition(dayPosition.value)}else renderer?.setCursor(cursor.value)
  hoverCard.value = null
}
function jumpDay(delta) {
  const whole = Math.floor(dayPosition.value)
  seek(delta < 0 && dayPosition.value > whole ? whole : whole + delta)
}
function stepEvent() {
  if (loading.value || isNetwork.value || cursor.value >= scene.value.events.length) return
  stopTimeline()
  const before = cursor.value
  dayPosition.value = positionAtCursor(index.value, before + 1)
  precisePosition=dayPosition.value;renderer?.setIndoorPosition(dayPosition.value)
  animateRange(before, cursor.value)
  draining.value = hasPendingAnimation()
}
function previewWalking() {
  if(loading.value || isNetwork.value || !index.value)return
  const next=scene.value.events.findIndex(event=>event.type==='purchase')
  if(next<0)return
  seek(positionAtCursor(index.value,next))
  stepEvent()
  selectPerson(scene.value.events[next].actor)
  renderer?.resetCamera()
}
watch([playing, draining], () => {if(renderer)renderer.timelinePlaying=playing.value;renderer?.setPlaying(playing.value || draining.value)})
watch(speed, value => renderer?.setSpeed(value))
watch(quality, value => renderer?.setQuality(value))
async function applyStyle(method,value) {
  const target=renderer
  if(!target)return
  styleBusy.value++
  try {await target[method](value);if(renderer===target)styleError.value=''}
  catch(error){if(renderer===target)styleError.value=`素材准备失败：${error.message||error}`}
  finally{styleBusy.value--}
}
watch(characterPool, value => void applyStyle('setCharacterPool',value))
watch([dayPosition, dayCycle, previewHour], () => renderer?.setLighting(lightSettings()))

async function fetchJson(file, signal) {
  if(props.scenario){const key=({'scene.json':'trajectory.json','campus3d_mapping.json':'location_mapping.json','campus3d_landcover.json':'landcover.json','campus3d_surroundings.json':'surroundings.json'})[file]||file;return props.scenario.files[key] || (key==='surroundings.json'?{roads:[]}:null)}
  if(file==='entrances.json')file='scenarios/ustc-history/entrances.json'
  const response = await fetch(`${import.meta.env.BASE_URL}mecoffe/${file}`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  return response.json()
}
async function loadScene(mode) {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  stopTimeline()
  renderer?.dispose()
  renderer = null
  if (import.meta.env.DEV) delete window.__mecoffe3d
  index.value = null
  hoverCard.value = null
  selectedId.value = null
  query.value = ''
  dayPosition.value = 0
  motion.value = { active: 0, queued: 0, unreachable: 0 }
  pendingEffects.value = 0
  characterStatus.value={available:0,visibleReady:0,visibleTotal:0,failed:0}
  requestedMode.value = mode
  activeTab.value = isNetwork.value ? 'people' : 'events'
  loading.value = true
  loadError.value = ''
  let view = null
  try {
    const [data, campus, mapping, landcover, surroundings, entrances, timeManifest] = await Promise.all([fetchJson(dataFileForMode(mode), controller.signal), fetchJson('campus3d.json', controller.signal), fetchJson('campus3d_mapping.json', controller.signal), fetchJson('campus3d_landcover.json', controller.signal), fetchJson('campus3d_surroundings.json', controller.signal),fetchJson('entrances.json',controller.signal),props.scenario?Promise.resolve(props.scenario.manifest):fetchJson('scenarios/ustc-history/scenario.json',controller.signal)])
    if (current !== generation) return
    if(entrances?.schema_version!=='mecoffe.entrances.v1')throw new Error('场景缺少楼栋入口，请重新生成场景')
    validateDataMode(data, mode)
    sourceTime.value=timeManifest.simulation_time;precisePosition=0
    campusData.value = campus
    mappingData.value = mapping
    index.value = indexScene(data)
    await nextTick()
    if (current !== generation) return
    view = new Campus3DScene({ host: mapEl.value, campus, mapping, index: index.value, entrances, landcovers:landcover.features, surroundings:surroundings.roads,characterPool:characterPool.value,deferCharacters:IS_PAGES,
      onQuality: value=>{quality.value=value;qualityNotice.value='已调整画质，让回放更流畅。'},
      onIndoor: value=>{indoorState.value=value},onBuildingSelect:id=>{selectedBuildingId.value=id;activeTab.value='building'},
      onHover: card => { hoverCard.value = card }, onSelect: selectPerson,
      onStats: stats => { motion.value = stats; if (draining.value && !hasPendingAnimation()) draining.value = false },
      onVisualActivity: count => { pendingEffects.value = count; if (draining.value && !hasPendingAnimation()) draining.value = false },
      onCharacters: status=>{characterStatus.value=status},
      onError:error=>{
        if(current!==generation)return
        stopTimeline();view?.dispose();renderer=null
        loadError.value=`场景显示遇到问题：${error.message||error}。可点击“重新加载”恢复。`
      },
    })
    await view.init()
    if (current !== generation) { view.dispose(); return }
    renderer = view
    if(manualQuality)view.performancePolicy.chooseManually()
    view.setSpeed(speed.value)
    view.setQuality(quality.value)
    await view.setCharacterPool(characterPool.value)
    if(!IS_PAGES)await view.setBuildingStyle(props.scenario?.manifest.style?.buildings || 'yulan')
    else {
      // Keep the map interactive while the atlas and large models download.
      styleBusy.value++
      view.setBuildingStyle(props.scenario?.manifest.style?.buildings || 'yulan').then(async()=>{
        if(renderer===view&&!view.disposed)await view.initCharacters()
      }).catch(error=>{if(renderer===view)styleError.value=`素材加载失败：${error.message||error}`}).finally(()=>{styleBusy.value--})
    }
    if(current !== generation || renderer !== view){view.dispose();return}
    view.setLighting(lightSettings())
    view.setPlaying(false)
    view.setCursor(0)
    if (import.meta.env.DEV) window.__mecoffe3d = { view, index: index.value, campus, mapping }
  } catch (error) {
    view?.dispose()
    if (current !== generation || error.name === 'AbortError') return
    renderer = null
    loadError.value = `场景数据暂时无法读取：${error.message || error}。请点击“重新加载”重试。`
  } finally {
    if (current === generation) loading.value = false
  }
}
onMounted(() => { document.title = props.scenario?.manifest.title || 'MeCoffe · 中科大高新校区三维沙盘'; void loadScene(props.scenario?'history':'demo') })
onBeforeUnmount(() => { generation += 1; controller?.abort(); stopTimeline(); renderer?.dispose(); renderer = null; if (import.meta.env.DEV) delete window.__mecoffe3d })
</script>

<style scoped>
.campus3d-page{--ink:#233a39;--muted:#6f817b;--line:#dde3d9;--accent:#277b68;position:fixed;inset:0;display:flex;flex-direction:column;gap:9px;padding:13px 16px;background:#f2f4ee;color:var(--ink);font-family:'Microsoft YaHei',system-ui,sans-serif;text-align:left;overflow:auto;color-scheme:light}
.campus3d-page *{box-sizing:border-box}.campus3d-page button,.campus3d-page input,.campus3d-page select{font:inherit}.campus3d-page button{cursor:pointer;color:inherit}.campus3d-page button:disabled{opacity:.45;cursor:not-allowed}.campus3d-page button:focus-visible,.campus3d-page a:focus-visible{outline:3px solid #4b9ca7;outline-offset:2px}.page-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}.title-group{display:flex;gap:12px;align-items:center}.logo{height:42px;width:42px;border-radius:12px;background:#277b68;color:white;display:grid;place-items:center;font-size:23px}.page-header h1{font-size:20px;margin:0;letter-spacing:.4px}.page-header p{font-size:11px;color:var(--muted);margin:3px 0 0}.header-actions{display:flex;align-items:center;gap:14px}.mode-switch{display:flex;gap:3px;background:#e4e9e1;border:1px solid var(--line);padding:4px;border-radius:10px}.mode-switch button{border:0;background:transparent;padding:7px 12px;font-size:12px;border-radius:7px;white-space:nowrap}.mode-switch .active{background:white;color:var(--accent);font-weight:700;box-shadow:0 1px 4px #233a3915}.old-page{font-size:12px;color:var(--accent);text-decoration:none;white-space:nowrap}.spatial-notice{padding:8px 12px;border:1px solid #e3d59c;background:#fff7db;border-radius:8px;font-size:12px;line-height:1.5;display:flex;gap:9px;align-items:center;flex-shrink:0}.spatial-notice strong{font-weight:500}.data-notice{padding:6px 11px;border-left:3px solid #418c85;background:#e6f0eb;font-size:11px;border-radius:3px;line-height:1.5;flex-shrink:0}.data-notice.history{background:#f7eae1;border-color:#be825a}.data-notice.network{background:#e7eef7;border-color:#6385af}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;flex-shrink:0}.kpis>div{background:white;border:1px solid var(--line);border-radius:10px;padding:9px 14px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px}.kpis span{font-size:11px;color:var(--muted)}.kpis strong{font-size:24px;grid-column:2;grid-row:1/3;white-space:nowrap}.kpis strong small{font-size:11px;font-weight:400}.kpis em{font-style:normal;color:var(--muted);font-size:10px}.main-layout{display:flex;flex:1;min-height:310px;gap:10px}.map-panel{position:relative;flex:1;min-width:0;border:1px solid #cbd9c9;border-radius:12px;overflow:hidden;background:#e3eadc}.map-canvas{position:absolute;inset:0}.map-canvas :deep(canvas){display:block;width:100%;height:100%;touch-action:none}.map-top{position:absolute;left:13px;right:13px;top:12px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}.map-badge{display:flex;flex-direction:column;gap:3px;padding:8px 11px;background:#ffffffde;border-radius:8px;box-shadow:0 2px 10px #233a390c}.map-badge b{font-size:12px}.map-badge span{font-size:10px;color:var(--muted)}.reset-camera{pointer-events:auto;padding:8px 10px;background:#fffffff0;border:1px solid #d3dfd3;border-radius:8px;font-size:11px}.map-legend{position:absolute;left:13px;bottom:12px;background:#ffffffe8;border:1px solid #dbe2d6;padding:8px 10px;border-radius:8px;max-width:280px;font-size:10px;pointer-events:none}.map-legend>span{margin-right:10px;white-space:nowrap}.map-legend i,.brand-totals i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}.map-legend p{color:var(--muted);font-size:10px;margin:6px 0 0;line-height:1.6}.osm-credit{position:absolute;right:8px;bottom:6px;font-size:10px;color:#326959;background:#ffffffe6;padding:3px 6px;border-radius:4px;text-decoration:none}.north-indicator{position:absolute;right:17px;top:64px;display:flex;flex-direction:column;align-items:center;color:#3d6259;font-size:19px;font-weight:700;pointer-events:none}.north-indicator small{font-size:9px;font-weight:400}.hover-card{position:absolute;z-index:3;display:flex;flex-direction:column;gap:4px;padding:10px 13px;border-radius:9px;background:#fffffff5;border:1px solid #cdd9cb;box-shadow:0 6px 18px #233a3918;max-width:255px;pointer-events:none}.hover-card b{font-size:13px}.hover-card span{font-size:10px;color:var(--muted)}.map-loading{position:absolute;inset:0;background:#f2f4eed9;display:grid;place-items:center;color:var(--accent);font-size:14px}.side-panel{width:316px;flex-shrink:0;background:white;border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}.side-tabs{display:flex;border-bottom:1px solid var(--line);padding:0 8px;flex-shrink:0}.side-tabs button{flex:1;padding:11px 3px;border:0;border-bottom:2px solid transparent;background:transparent;font-size:12px}.side-tabs .active{color:var(--accent);border-bottom-color:var(--accent);font-weight:700}.side-content{padding:12px;overflow:auto;flex:1;min-height:0}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:6px}.section-heading h2{font-size:13px;margin:0 0 6px}.section-heading small{font-size:10px;color:var(--muted)}.empty,.muted{color:var(--muted);font-size:11px;line-height:1.8}.empty{padding:14px 2px}.event-row{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:10px 4px;border:0;border-bottom:1px solid #edf0e9;background:transparent;font-size:11px;line-height:1.6;overflow-wrap:anywhere}.event-row:hover{background:#f2f6ef}.event-meta{font-size:10px;color:var(--muted)}.brand-totals{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}.brand-totals>div{display:flex;align-items:center;font-size:11px;margin:7px 0}.brand-totals span{flex:1}.brand-totals b{white-space:nowrap}.search{display:flex;align-items:center;gap:8px;background:#f2f5ef;padding:8px 10px;border-radius:7px;font-size:11px;color:var(--muted)}.search input{border:0;outline:0;min-width:0;width:100%;background:transparent;color:var(--ink)}.person-detail{padding:12px 1px;border-bottom:1px solid var(--line);font-size:11px;line-height:1.7}.person-title{display:flex;gap:6px;align-items:center}.person-title h2{font-size:14px;margin:0}.person-title small{color:var(--muted);margin-left:auto}.person-detail code{font-size:10px;color:var(--muted);overflow-wrap:anywhere}.mapping-note{background:#fff6df;border-radius:5px;padding:6px;color:#806b40;font-size:10px}.person-bio{color:var(--muted)}.person-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}.roster>button{width:100%;display:flex;align-items:center;gap:9px;background:transparent;border:0;border-bottom:1px solid #edf0e9;padding:10px 4px;text-align:left;font-size:12px}.roster>button>span:nth-child(2){flex:1}.roster small{display:block;font-size:10px;color:var(--muted);margin-top:2px}.roster .selected{background:#eaf3ed;color:var(--accent)}.relation-buttons{display:flex;flex-wrap:wrap;gap:4px}.relation-buttons button{font-size:10px;background:#f1f5ed;border:1px solid #dde5d7;border-radius:5px;padding:3px 6px}.person-history h3{font-size:12px;margin:12px 0 4px}.person-history p{font-size:10px;color:var(--muted)}.mapping-row{padding:10px 0;border-bottom:1px solid #edf0e9}.mapping-row small{display:block;font-family:monospace;font-size:10px;color:var(--muted)}.mapping-row b{font-size:12px}.mapping-row p{font-size:10px;color:var(--muted);line-height:1.6;margin:4px 0}.timeline-panel{background:white;border:1px solid var(--line);border-radius:10px;padding:9px 12px;flex-shrink:0}.playback-controls{display:flex;gap:7px;align-items:center}.playback-controls>button{border:1px solid #dce3d7;border-radius:7px;background:#f5f7f1;font-size:11px;padding:7px 10px;white-space:nowrap}.playback-controls .play-button{background:var(--accent);border-color:var(--accent);color:white;min-width:75px}.play-button i{margin-right:6px}.playback-controls label{font-size:11px;margin-left:5px;white-space:nowrap}.playback-controls select{border:1px solid var(--line);border-radius:5px;background:white;color:var(--ink);padding:4px;font-size:11px}.current-day{margin-left:auto;font-size:12px;white-space:nowrap}.current-day small{font-weight:400;color:#a3783c;font-size:10px}.timeline-track{display:flex;align-items:center;gap:10px;margin:7px 0 3px}.timeline-track input{accent-color:var(--accent);width:100%;height:12px;cursor:pointer}.timeline-track span{font-size:10px;color:var(--muted);min-width:28px;text-align:right}.day-buttons{display:flex;gap:4px;overflow:auto;padding:3px 0}.day-buttons button{flex:1;min-width:24px;padding:3px 1px;background:#f0f3ec;border:1px solid #e4e8dc;border-radius:4px;font-size:10px}.day-buttons .active{background:var(--accent);border-color:var(--accent);color:white}.day-buttons .partial{border-style:dashed;border-color:#ba864f}.network-footer{margin:7px 0 0;font-size:11px;color:var(--muted)}.initial-loading{margin:auto;color:var(--muted)}.error-panel{margin:30px auto;background:#fff2e8;border:1px solid #d5b19a;border-radius:12px;padding:24px;max-width:700px;line-height:1.8}.error-panel p{font-size:13px}.error-panel a{color:var(--accent);margin-left:14px}.error-panel button{padding:6px 12px;border:1px solid #bfcdb9;background:white;border-radius:6px}
.spatial-notice{position:sticky;top:0;z-index:10}
.header-actions{flex-wrap:wrap;justify-content:flex-end}.map-camera-buttons{display:flex;gap:7px;pointer-events:auto}.role-key{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}.role-key span{white-space:nowrap}.role-key i{border-radius:50%}.map-legend{max-width:310px}
@media(min-width:1600px){.side-panel{width:350px}.page-header h1{font-size:22px}.kpis>div{padding:12px 16px}.side-content{padding:15px}.event-row{font-size:12px}.main-layout{min-height:360px}}
@media(max-width:1000px){.page-header h1{font-size:16px}.side-panel{width:265px}.old-page{display:none}.kpis>div{padding:8px}.kpis strong{font-size:20px}.kpis em{font-size:9px}.current-day{font-size:11px}.mode-switch button{padding:7px 8px}}
@media(max-width:720px){.campus3d-page{padding:9px;gap:7px}.page-header{flex-wrap:wrap}.page-header h1{font-size:16px}.header-actions{width:100%;justify-content:space-between}.old-page{display:block}.spatial-notice{font-size:11px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.main-layout{flex-direction:column;min-height:650px}.map-panel{min-height:370px}.side-panel{width:100%;height:260px}.map-legend{max-width:230px}.playback-controls{flex-wrap:wrap;gap:5px}.playback-controls>button{padding:6px 7px}.current-day{margin-left:0}.timeline-panel{padding:8px}.north-indicator{display:none}}
</style>

<style scoped>
.character-loading{position:absolute;z-index:8;top:70px;left:14px;max-width:340px;display:flex;align-items:center;justify-content:space-between;gap:10px}.character-loading button{border:1px solid #b7cbbb;border-radius:5px;padding:3px 8px;background:white;color:#376e59}
</style>
