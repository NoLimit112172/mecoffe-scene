<template>
  <div class="campus3d-page" :class="{'integrated-page':isIntegratedScene,'details-open':detailsOpen}" :data-live-mode="isLive" :data-live-revision="liveState?.revision || 0" :data-indoor-occupancy="JSON.stringify(indoorState.buildings)" :data-inside="indoorState.inside" :data-person-accounting="JSON.stringify(indoorState.accounting)">
    <header class="page-header">
      <div class="title-group"><span class="logo"><i aria-hidden="true" class="fa-solid fa-cubes"></i></span><div><h1>{{scenario?.manifest.title || '中科大高新校区 · 三维校园沙盘'}}</h1><p>MeCoffe / 阶段 1 · OSM 建筑体块与步行路网</p></div></div>
      <div class="header-actions">
        <nav v-if="!scenario" aria-label="场景数据模式" class="mode-switch">
          <button v-for="mode in modes" :key="mode.key" :class="{ active: requestedMode === mode.key }" :aria-pressed="requestedMode === mode.key" :disabled="loading" @click="loadScene(mode.key)">{{ mode.label }}</button>
        </nav>
        <Campus3DVisualControls :building-style="scenario?.manifest.style?.buildings || 'yulan'" v-model:character-pool="characterPool" :quality="quality" @update:quality="chooseQuality" v-model:cycle="dayCycle" v-model:hour="previewHour" :clock="'光照：展示效果'" />
        <span v-if="styleBusy" role="status" class="style-status">正在准备三维素材…</span>
        <RouterLink v-if="!isIntegratedScene" to="/mecoffe" class="old-page">二维沙盘 ↗</RouterLink>
        <RouterLink :to="{path:'/mecoffe-gis',query:isIntegratedScene?previewQuery(route.query):{scenario:scenario?.manifest.id || 'ustc-history'}}" class="old-page">GIS 模式 ↗</RouterLink>
        <RouterLink to="/mecoffe3d/assets" class="old-page">场景素材库 ↗</RouterLink>
      </div>
    </header>

    <div class="spatial-notice" role="note"><i aria-hidden="true" class="fa-solid fa-circle-info"></i><strong>建筑与道路来自 OpenStreetMap；人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据</strong></div>
    <div v-if="loadError" class="error-panel" role="alert"><strong>三维场景未能加载</strong><p>{{ loadError }}</p><button @click="loadScene(requestedMode)">重新加载</button><RouterLink to="/mecoffe">打开原二维页面</RouterLink></div>
    <p v-if="styleError" role="alert" class="data-notice">{{styleError}}</p>

    <template v-if="index && !loadError">
      <div v-if="!isConfigPreview&&!isLive" class="data-notice" data-testid="simulation-time">{{dayDisplay?.label || currentDay.label}} · 天内回放进度 {{dayDisplay?.progress || 0}}% · 昼夜变化为展示效果</div>
      <div class="data-notice" :class="requestedMode" data-testid="data-notice">{{ dataNotice }}</div>
      <p v-if="isGenericReplay" class="data-notice" data-testid="replay-outcomes">本记录含被拒 {{replayOutcomeCounts.declined}} 条 · 结果未知 {{replayOutcomeCounts.unknown}} 条；仅已执行的动作计入成功结果。</p>
      <p v-if="indoorState.accounting" class="population-accounting" data-testid="person-accounting">人物去向：室外 {{indoorState.accounting.visible}} + 楼内 {{indoorState.accounting.inside}} = {{indoorState.accounting.total}} 人 · {{indoorState.accounting.valid?'全部可定位':'请重新加载场景'}}<span v-if="selectedId"> · <i aria-hidden="true" style="color:#4c8ba6">━</i> 关注他人 <i aria-hidden="true" style="color:#b49b61">━</i> 被关注（楼内连接屋顶）<template v-if="isIntegratedScene"> <i aria-hidden="true" style="color:#9366a6">━</i> 竞争关系</template></span></p>

      <p v-if="qualityNotice" role="status" class="data-notice">{{ qualityNotice }}</p>
      <section class="kpis" aria-label="回放指标">
        <div><span>{{ isLive ? liveProgress.label : isNetwork ? '人物关系输入' : currentDay.label }}</span><strong>{{ scene.people.length }}<small> 人</small></strong><em>快照 {{ meta.snapshot_revision ? `v${meta.snapshot_revision}` : '历史版本' }}</em></div>
        <div><span>{{isConfigPreview?'初始关系':'初始关注关系'}}</span><strong>{{ isConfigPreview?scene.relationships.length:follows.length }}<small> 条</small></strong><em>{{ isNetwork ? '静态网络，尚未运行' : '与原数据保持一致' }}</em></div>
        <div><span>{{ isLive ? '已核实订单 / 金额' : isConfigPreview ? '事件 / 订单' : isDemo ? '演示订单 / 金额' : '回放订单 / 金额' }}</span><strong data-testid="order-count">{{ confirmedTotals.orders }}<small> 单</small></strong><em>¥{{ revenue }} · {{ isLive ? `日汇总 · 已收到 ${scene.events.length} 条活动` : isNetwork ? '无行为轨迹' : `${cursor} / ${scene.events.length} 条事件` }}</em></div>
        <div><span>人物移动 · 展示层</span><strong data-testid="active-walkers">{{ motion.active }}<small> 人在途</small></strong><em>排队 {{ motion.queued }} 笔<span v-if="motion.unreachable"> · 不可达 {{ motion.unreachable }} 笔</span></em></div>
      </section>

      <button v-if="isIntegratedScene" class="details-toggle" :aria-expanded="detailsOpen" aria-controls="three-scene-details" @click="detailsOpen=!detailsOpen">{{detailsOpen?'收起详情':'人物与场景详情'}}</button>
      <main class="main-layout">
        <section class="map-panel" aria-label="中科大高新校区三维场景">
          <div ref="mapEl" class="map-canvas"></div>
          <div class="map-top"><div class="map-badge"><b>USTC · 高新校区</b><span>{{ campusData?.buildings.length || 0 }} 栋建筑 / {{ campusData?.roads.length || 0 }} 段道路</span></div><div class="map-camera-buttons"><button class="reset-camera" title="放大查看选中人物或当前行人" @click="focusPerson"><i aria-hidden="true" class="fa-solid fa-person-walking"></i> 人物特写</button><button class="reset-camera" title="恢复校园全景" @click="renderer?.resetCamera()"><i aria-hidden="true" class="fa-solid fa-expand"></i> 全景</button></div></div>
          <div v-if="hoverCard" class="hover-card" :style="hoverStyle">
            <b>{{ hoverCard.name }}</b>
            <template v-if="hoverCard.type === 'building'">
              <span v-if="hoverCard.preview" class="hover-interior">
                楼内 {{ indoorState.buildings[hoverCard.building.osm_id]?.length || 0 }} 人 · 位置示意
              </span>
              <span>{{ hoverCard.building.levels }} 层 / {{ hoverCard.building.height_m }} 米 · {{ hoverCard.building.levels_source === 'default' ? '展示默认高度' : '来源见地图数据' }}</span>
              <span>点击查看楼栋详情</span>
            </template>
            <span v-else>点击查看人物与事件</span>
          </div>
          <div class="map-legend"><span><i aria-hidden="true" style="background:#7c9cab"></i>教学 / 科研</span><span><i aria-hidden="true" style="background:#bc7859"></i>住宿</span><span><i aria-hidden="true" style="background:#65a89b"></i>公共设施</span><div class="role-key"><span v-for="(color, role) in legendRoles" :key="role" :title="roleDescriptions[role] || roleLabels[role] || role"><i aria-hidden="true" :style="{background:color}"></i>{{ roleLabels[role] || role }}</span></div><p>写实人物为外观示意；脚下颜色表示角色<br>人物活动限制在建成区校界内<br>水域不可行走，仅跨水道路 / 桥面可通行<br>跑道外圈、球场排布、桥型与水深：展示设定<br>树木、路灯、长椅、草地纹理：<b>装饰</b><br>楼顶人数与光照：展示示意；楼层仍为默认值<br>校外道路仅展示，不参与寻路<br>左键旋转 · 右键平移 · 滚轮缩放</p></div>
          <a class="osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      <div v-if="characterStatus.visibleReady < characterStatus.visibleTotal || characterStatus.failed" class="data-notice character-loading" role="status"><span>正在加载人物 {{ characterStatus.visibleReady || 0 }}/{{ characterStatus.visibleTotal || 0 }}…</span><button v-if="characterStatus.failed" @click="renderer?.retryCharacters()">重试 {{ characterStatus.failed }} 个模型</button></div>
          <div v-if="loading" class="map-loading">正在构建校园三维体块…</div>
        </section>

        <aside id="three-scene-details" class="side-panel">
          <div class="side-panel-header">
            <p class="panel-caption">场景详情</p>
            <nav class="side-tabs" aria-label="场景信息">
              <button v-for="tab in tabs" :key="tab.key" type="button"
                :class="{ active: activeTab === tab.key }" :aria-pressed="activeTab === tab.key" @click="activeTab = tab.key">
                <i aria-hidden="true" :class="['fa-solid', tab.icon]"></i><span>{{ tab.label }}</span>
              </button>
            </nav>
          </div>
          <div v-if="activeTab === 'events'" class="side-content">
            <div class="section-heading"><h2>{{ isNetwork ? '关注关系输入' : '事件记录' }}</h2><small>{{ isLive ? (meta.synthetic ? '合成实时快报' : '实时快报') : isDemo ? '规则演示' : isNetwork ? '尚未运行' : isGenericReplay ? (meta.synthetic ? '合成回放' : '运行回放') : '历史 OASIS' }}</small></div>
            <p v-if="isNetwork" class="muted">此模式只有人物与关注关系，没有订单或可播放的行为。选择“人物”可查看关注对象。</p>
            <p v-else-if="!recentEvents.length" class="empty">播放或单步查看事件。购买事件会触发沿 OSM 路网的往返动画。</p>
            <div v-if="recentEvents.length" class="event-list">
              <article v-for="event in recentEvents" :key="event.key" class="event-entry" :data-event-outcome="event.outcome || event.type"><button class="event-row" type="button" @click="selectPerson(event.actor)">
                <span class="event-meta">
                  <span>{{ event.step === 0 ? '初始化' : `第 ${event.step} 天` }}</span>
                  <span class="event-kind">{{ eventTypeLabel(event) }}</span>
                </span>
                <span>{{ describeEvent(index, event) }}</span>
              </button><EventResultDetails :event="event"/></article>
            </div>
            <div v-if="!isLive" class="brand-totals"><div v-for="shop in displayedShops" :key="shop.brandId" :data-shop-brand="shop.brandId"><i aria-hidden="true" :style="{ background: brandColors[shop.ordinal % brandColors.length] }"></i><span><b class="shop-name">{{shop.name}}</b><small>{{shop.productName}}</small></span><b>{{ state.cups[shop.brandId] }} 杯</b></div></div>
          </div>
          <div v-else-if="activeTab === 'people'" class="side-content">
            <div class="section-heading"><h2>人物名册</h2><small>{{ roster.length }} 人</small></div>
            <label class="search"><i aria-hidden="true" class="fa-solid fa-magnifying-glass"></i><input v-model="query" placeholder="搜索人物姓名或编号" aria-label="搜索人物" /></label>
            <article v-if="selected" class="person-detail">
              <div class="person-title">
                <span class="person-dot" :style="{ background: roleColor(selected.role) }"></span>
                <h2>{{ selected.name }}</h2><small :title="selected.role_description || selected.role_label">{{ selected.role_label }}</small>
              </div>
              <code>{{ selected.id }}</code>
              <p class="person-placement"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>{{ personPlacement(selected.id) }}</p>
              <p v-if="selected.bio" class="person-bio">{{ selected.bio }}</p><details v-if="selected.role_description" class="role-description"><summary>角色说明</summary><p>{{selected.role_description}}</p><small>角色标识：{{selected.role}}</small></details>
              <ConfigProfileFields v-if="isIntegratedScene" :person="selected"/>
              <details v-if="mappingEntry(selected)?.note" class="mapping-note">
                <summary>位置说明</summary><p>{{ mappingEntry(selected).note }}</p>
              </details>
              <dl class="person-stats">
                <div><dt>关注</dt><dd>{{ selectedFollowing.length }}</dd></div>
                <div><dt>被关注</dt><dd>{{ selectedFollowers.length }}</dd></div>
              </dl>
              <div v-if="selectedFollowing.length" class="relation-buttons" aria-label="关注对象"><button v-for="person in selectedFollowing" :key="person.id" @click="selectPerson(person.id)">{{ person.name }}</button></div>
              <div v-if="isIntegratedScene&&otherRelations.length" class="relation-buttons"><span>竞争关系</span><button v-for="entry in otherRelations" :key="entry.source+entry.target" @click="selectPerson(entry.other.id)">{{entry.other.name}}</button></div>
              <div v-if="selectedHistory.length" class="person-history">
                <h3>近期行为</h3>
                <ol><li v-for="event in selectedHistory.slice(0, 5)" :key="event.key">{{ describeEvent(index, event) }}<EventResultDetails :event="event"/></li></ol>
              </div>
            </article>
            <p v-if="!roster.length" class="empty">没有匹配的人物。</p>
            <div class="roster" aria-label="人物名册"><button v-for="person in roster" :key="person.id" :data-person-id="person.id" :class="{ selected: selectedId === person.id }" @click="selectPerson(person.id)"><span class="person-dot" :style="{ background: roleColor(person.role) }"></span><span>{{ person.name }}<small :title="person.role_description || person.role_label">{{ isGenericReplay ? person.role_label + (mappedBuilding(person)?.name ? ' · ' + mappedBuilding(person).name : '') : mappedBuilding(person)?.name || person.role_label }}</small></span><i aria-hidden="true" v-if="selectedId === person.id" class="fa-solid fa-chevron-right"></i></button></div>
          </div>
          <div v-else-if="activeTab === 'building'" class="side-content">
            <div class="section-heading"><h2>楼栋详情</h2></div>
            <p v-if="!selectedBuilding" class="empty">点击地图上的楼栋，查看楼内人员。</p>
            <template v-else>
              <div class="building-summary">
                <i class="fa-solid fa-building" aria-hidden="true"></i>
                <div><h3>{{ selectedBuilding.name }}</h3><p>楼内 {{ buildingResidents.length }} 人（示意）</p></div>
              </div>
              <section v-if="buildingShops.length" class="building-shops" data-testid="building-shops"><h4>本楼门店（示意）</h4><div v-for="shop in buildingShops" :key="shop.brandId" :data-shop-brand="shop.brandId"><b>{{shop.name}}</b><span>{{shop.productName}}</span><small>{{shop.brandId}}</small></div></section>
              <p v-if="!buildingResidents.length" class="empty">当前没有楼内人员。</p>
              <div v-else class="roster" aria-label="楼内人员">
                <button v-for="person in buildingResidents" :key="person.id" @click="selectPerson(person.id)">
                  <span class="person-dot" :style="{ background: roleColor(person.role) }"></span><span>{{ person.name }}<small :title="person.role_description || person.role_label">{{ person.role_label }}</small></span>
                </button>
              </div>
            </template>
          </div>
          <div v-else class="side-content">
            <div class="section-heading"><h2>真实楼栋 · 示意对应</h2><small>{{Object.keys(mappingData?.mappings || {}).length}} 个地点</small></div><p class="muted">轮廓与楼名来自 OSM。{{isConfigPreview?'下面是当前配置的展示映射。楼栋安置为示意。':'下面是原沙盘地点的人工展示映射，咖啡店不是核实店址。'}}</p>
            <div v-for="[key, entry] in Object.entries(mappingData?.mappings || {})" :key="key" class="mapping-row">
              <b><i class="fa-solid fa-location-dot" aria-hidden="true"></i>{{ buildingById.get(entry.osm_id)?.name || entry.osm_id }}</b>
              <small>{{ key }}</small><p>{{ entry.note }}</p>
            </div>
          </div>
        </aside>
      </main>

      <footer v-if="!isConfigPreview&&!isLive" class="timeline-panel" aria-label="回放时间轴">
        <div class="timeline-header">
          <div class="timeline-heading">
            <i class="fa-solid fa-clock" aria-hidden="true"></i>
            <div>
              <p class="panel-caption">{{ isNetwork ? '关系网络' : '回放时间轴' }}</p>
              <strong class="current-day" data-testid="current-day">{{ isNetwork ? '静态快照' : currentDay.label }}</strong>
            </div>
            <span v-if="!isNetwork && !currentDay.complete" class="timeline-status partial-status">记录不完整</span>
            <span v-else-if="!isNetwork && atEnd" class="timeline-status">{{ draining ? '等待人物返回' : '已到末尾' }}</span>
          </div>
          <div class="playback-controls">
            <button class="play-button" :disabled="loading || isNetwork" :aria-label="playing || draining ? '暂停回放' : '播放回放'" @click="togglePlay">
              <i aria-hidden="true" :class="playing || draining ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>{{ playing || draining ? '暂停' : '播放' }}
            </button>
            <div class="day-step-controls" role="group" aria-label="回放步进">
              <button :disabled="loading || isNetwork" @click="jumpDay(-1)"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i>上一天</button>
              <button :disabled="loading || isNetwork || cursor >= scene.events.length" @click="stepEvent">下一事件</button>
              <button :disabled="loading || isNetwork" @click="jumpDay(1)">下一天<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            </div>
            <button class="walking-button" :disabled="loading || isNetwork" title="跳转到首笔购买事件并播放人物往返" @click="previewWalking"><i class="fa-solid fa-person-walking" aria-hidden="true"></i>看人物行走</button>
            <label class="speed-control">速度 <select v-model.number="speed" :disabled="isNetwork"><option v-for="n in [0.5, 1, 2, 4, 8]" :key="n" :value="n">{{ n }}×</option></select></label>
          </div>
        </div>
        <div v-if="!isNetwork" class="timeline-track">
          <span class="progress-label">总进度</span>
          <input :disabled="loading" :value="dayPosition" :max="days.length" min="0" step="0.001" type="range" aria-label="回放时间进度"
            :style="{ '--progress': `${progressPercent}%` }" @input="seek(Number($event.target.value))" />
          <output>{{ Math.round(progressPercent) }}%</output>
        </div>
        <div v-if="!isNetwork" class="day-buttons" aria-label="按天跳转">
          <button v-for="(day, k) in days" :key="day.step" :disabled="loading"
            :class="{ active: dayIndex === k, elapsed: k < dayIndex, partial: !day.complete }" :aria-current="dayIndex === k ? 'step' : undefined"
            :title="`${day.label}${day.complete ? '' : '（不完整）'}`" :aria-label="`跳转到${day.label}`" @click="seek(k)">{{ day.step === 0 ? '初' : day.step }}</button>
        </div>
        <p v-else class="network-footer">关系网络模式没有时间轨迹；购买、发帖、访谈结果均为零，不借用旧运行。</p>
      </footer>
    </template>
    <div v-else-if="loading && !loadError" class="initial-loading">正在读取 OSM 校园与回放数据…</div>
  </div>
</template>

<script setup>
import {IS_PAGES} from '../mecoffe/publicUrl.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue'
import {confirmedPresentationTotals,refreshLiveIndex,takeLiveAnimations} from '../mecoffe/liveRender.js'
import { RouterLink, useRoute } from 'vue-router'
import ConfigProfileFields from '../components/ConfigProfileFields.vue'
import EventResultDetails from '../components/EventResultDetails.vue'
import {shopEntries, shopsInBuilding} from '../mecoffe/shopPresentation.js'
import {previewQuery} from '../mecoffe/configPreviewStore.js'
import Campus3DVisualControls from '../components/Campus3DVisualControls.vue'
import { Campus3DScene } from '../mecoffe/Campus3DScene.js'
import { describeEvent, eventTypeLabel, indexScene, personHistory, stateAt } from '../mecoffe/replay.js'
import { advancePosition, clampPosition, cursorAtPosition, dataFileForMode, positionAtCursor, validateDataMode } from '../mecoffe/campus3dPlayback.js'
import { resolveHomeKey } from '../mecoffe/campus3dRouting.js'
import { CHARACTER_ROLE_COLORS, displayRoleColor } from '../mecoffe/characterDisplay.js'
import {scenarioTime} from '../mecoffe/scenario.js'
import {displayDate} from '../mecoffe/indoorMotion.js'
import {liveProgressPresentation} from '../mecoffe/livePresentation.js'
import { visualClock } from '../mecoffe/campus3dPresentation.js'

const props=defineProps({scenario:{type:Object,default:null},liveState:{type:Object,default:null}})
const isLive=computed(()=>props.scenario?.manifest.preview_mode==='live'),detailsOpen=ref(false)
const liveProgress=computed(()=>liveProgressPresentation(props.liveState||{}))
const route=useRoute(),isConfigPreview=computed(()=>props.scenario?.manifest.preview_mode==='config')
const isGenericReplay=computed(()=>props.scenario?.manifest.preview_mode==='replay')
const isIntegratedScene=computed(()=>isConfigPreview.value||isGenericReplay.value||isLive.value)
const modes = [{ key: 'demo', label: '新版演示' }, { key: 'network', label: '关系网络' }, { key: 'history', label: '历史回放' }]
const tabs = [
  { key: 'events', label: '事件', icon: 'fa-list-ul' },
  { key: 'people', label: '人物', icon: 'fa-users' },
  { key: 'mapping', label: '地点映射', icon: 'fa-map-location-dot' },
  { key: 'building', label: '楼栋', icon: 'fa-building' },
]
const brandColors = ['#22856e', '#bd7545', '#578db2', '#966ba7', '#b29646']
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
const dayCycle = ref(!isIntegratedScene.value)
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
const simulatedClock=computed(()=>props.scenario&&!isConfigPreview.value?scenarioTime(props.scenario.manifest.simulation_time,Math.max(0,dayPosition.value-(days.value[0]?.step===0?1:0))):null)
const lightClock = computed(() => simulatedClock.value && dayCycle.value ? {...simulatedClock.value,label:simulatedClock.value.label.slice(11)} : visualClock(dayPosition.value,{cycle:dayCycle.value,hour:previewHour.value}))
function lightSettings(){return simulatedClock.value && dayCycle.value?{cycle:false,hour:simulatedClock.value.hour}:{position:dayPosition.value,cycle:dayCycle.value,hour:previewHour.value}}
const state = computed(() => index.value ? stateAt(index.value, cursor.value) : null)
const confirmedTotals=computed(()=>confirmedPresentationTotals(index.value,cursor.value,isLive.value?props.liveState?.summary:null))
const revenue = computed(() => (confirmedTotals.value.revenue_fen / 100).toFixed(2))
const follows = computed(() => (scene.value?.relationships || []).filter(edge => edge.relation === 'follow'))
const progressPercent = computed(() => days.value.length ? dayPosition.value / days.value.length * 100 : 0)
const buildingById = computed(() => new Map((campusData.value?.buildings || []).map(building => [building.osm_id, building])))
const selected = computed(() => index.value?.people.get(selectedId.value))
const selectedFollowing = computed(() => follows.value.filter(edge => edge.source === selectedId.value).map(edge => index.value.people.get(edge.target)).filter(Boolean))
const selectedFollowers = computed(() => follows.value.filter(edge => edge.target === selectedId.value))
const otherRelations=computed(()=>(scene.value?.relationships||[]).filter(e=>e.relation==='competition'&&(e.source===selectedId.value||e.target===selectedId.value)).map(e=>({...e,other:index.value.people.get(e.source===selectedId.value?e.target:e.source)})))
const selectedHistory = computed(() => selected.value ? personHistory(index.value, selectedId.value, cursor.value, 20) : [])
const recentEvents = computed(() => scene.value?.events.slice(Math.max(0, cursor.value - 30), cursor.value).reverse() || [])
const replayOutcomeCounts=computed(()=>({declined:scene.value?.events.filter(e=>e.type==='declined').length||0,unknown:scene.value?.events.filter(e=>e.type==='unknown').length||0}))
const roster = computed(() => (scene.value?.people || []).filter(person => `${person.name} ${person.id}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const hoverStyle = computed(() => {
  const card = hoverCard.value
  const rect = mapEl.value?.getBoundingClientRect()
  if (!card || !rect) return {}
  const verticalOffset = card.preview ? -96 : 12
  return { left: `${Math.max(10, Math.min(rect.width - 265, card.x - rect.left + 14))}px`, top: `${Math.max(70, Math.min(rect.height - 110, card.y - rect.top + verticalOffset))}px` }
})
const dataNotice = computed(() => {
  if(isLive.value)return `实时模式 · ${liveProgress.value.message}。楼栋与路线为展示示意；仅已核实订单产生取杯动画。`
  if (isGenericReplay.value) return `${meta.value?.synthetic?'合成样例 · ':''}运行回放：${meta.value?.partial?'部分记录 · ':''}完成 ${meta.value?.completed_steps}/${meta.value?.total_steps} 步。楼栋与路线为展示示意${meta.value?.time_source==='display_default'?'，日期为展示设定':''}。`
  if (isConfigPreview.value) return '配置预览 · 尚未运行模拟。人物与关系来自所选配置，楼栋安置为展示示意。事件 0 · 订单 0。'
  if (isDemo.value) return `新版演示：快照 v${meta.value?.snapshot_revision} 的 30 天规则演示，非 OASIS 运行结果。购买与传播按本地示例规则生成。`
  if (isNetwork.value) return `关系网络：快照 v${meta.value?.snapshot_revision} 的静态人物与关注输入，尚未运行；不含购买、发帖或访谈轨迹。`
  return `历史回放：原 OASIS 运行状态 ${meta.value?.status}，完整完成 ${meta.value?.completed_steps}/${meta.value?.total_steps} 天；第 24 天只有部分记录，后续天数未补造。`
})
const mappingEntry = person => mappingData.value?.mappings[resolveHomeKey(person)]
const mappedBuilding = person => buildingById.value.get(mappingEntry(person)?.osm_id)
const roleColor = role => displayRoleColor(role,{ merchant: '#bb7545', undergraduate_consumer: '#3888aa', graduate_consumer: '#8a78b4', teacher_consumer: '#58916a' })
const roleLabels=computed(()=>isIntegratedScene.value?Object.fromEntries((scene.value?.people||[]).map(p=>[p.role,p.role_label])):roleNames)
const roleDescriptions=computed(()=>Object.fromEntries((scene.value?.people||[]).map(p=>[p.role,p.role_description || p.role_label])))
const displayedShops=computed(()=>index.value?shopEntries(index.value):[])
const buildingShops=computed(()=>index.value&&mappingData.value&&selectedBuilding.value?shopsInBuilding(index.value,mappingData.value,selectedBuilding.value.osm_id):[])
const legendRoles=computed(()=>isIntegratedScene.value?Object.fromEntries((scene.value?.people||[]).map(p=>[p.role,roleColor(p.role)])):CHARACTER_ROLE_COLORS)

function selectPerson(id) {
  selectedId.value = id
  activeTab.value = 'people'
  renderer?.focusPerson(id)
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
watch([playing, draining], () => {if(renderer)renderer.timelinePlaying=playing.value;renderer?.setPlaying(isLive.value?!props.liveState?.paused:playing.value || draining.value)})
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
  if(props.scenario){const key=({'latest-network.json':'trajectory.json','scene.json':'trajectory.json','campus3d_mapping.json':'location_mapping.json','campus3d_landcover.json':'landcover.json','campus3d_surroundings.json':'surroundings.json'})[file]||file;return props.scenario.files[key] || (key==='surroundings.json'?{roads:[]}:null)}
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
    if(isLive.value){view.liveMode=true;if(view.indoor)view.indoor.purchases=[];applyLiveUpdate(props.liveState)}
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
const liveAnimationSeen=new Set()
/** 增量更新保留 renderer、人物模型、路网和已在进行的展示动作。 */
function applyLiveUpdate(state=props.liveState){
  if(!isLive.value||!renderer||!index.value||!state)return
  renderer.liveMode=true
  renderer.timelinePlaying=false
  renderer.setPlaying(!state.paused)
  if(state.paused)return
  refreshLiveIndex(index.value,props.scenario.files['trajectory.json'])
  if(renderer.indoor)renderer.indoor.purchases=[]
  for(const event of takeLiveAnimations(state,liveAnimationSeen))renderer.playLiveEvent(event)
  dayPosition.value=index.value.days.length;precisePosition=dayPosition.value
  triggerRef(index)
  renderer.invalidate()
}
function followLiveLatest(){
  if(!renderer)return
  renderer.indoor?.reset();if(renderer.indoor)renderer.indoor.purchases=[]
  renderer.liveMotionSeconds=0;renderer.eventEffects?.reset()
  for(const item of renderer.liveBubbles||[])item.element.remove();renderer.liveBubbles=[]
  for(const event of props.liveState?.animationQueue||[])liveAnimationSeen.add(`${event.key}|${event.type}|${event.order_id||''}|${event.evidence_status||''}`)
  renderer.invalidate()
}
watch(()=>props.liveState?.revision,()=>applyLiveUpdate())
watch(()=>props.liveState?.paused,()=>applyLiveUpdate())
defineExpose({applyLiveUpdate,followLiveLatest})
onMounted(() => { document.title = props.scenario?.manifest.title || 'MeCoffe · 中科大高新校区三维沙盘'; void loadScene(isConfigPreview.value?'network':props.scenario?'history':'demo') })
onBeforeUnmount(() => { generation += 1; controller?.abort(); stopTimeline(); renderer?.dispose(); renderer = null; if (import.meta.env.DEV) delete window.__mecoffe3d })
</script>

<style scoped>
.population-accounting{font-size:12px;color:#385f54;margin:4px 1px 8px}.population-accounting i{font-style:normal;font-size:18px}
.campus3d-page{--ink:#233a39;--muted:#6f817b;--line:#dde3d9;--accent:#277b68;position:fixed;inset:0;display:flex;flex-direction:column;gap:9px;padding:13px 16px;background:#f2f4ee;color:var(--ink);font-family:'Microsoft YaHei',system-ui,sans-serif;text-align:left;overflow:auto;color-scheme:light}
.campus3d-page *{box-sizing:border-box}.campus3d-page button,.campus3d-page input,.campus3d-page select{font:inherit}.campus3d-page button{cursor:pointer;color:inherit}.campus3d-page button:disabled{opacity:.45;cursor:not-allowed}.campus3d-page button:focus-visible,.campus3d-page a:focus-visible{outline:3px solid #4b9ca7;outline-offset:2px}.page-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}.title-group{display:flex;gap:12px;align-items:center}.logo{height:42px;width:42px;border-radius:12px;background:#277b68;color:white;display:grid;place-items:center;font-size:23px}.page-header h1{font-size:20px;margin:0;letter-spacing:.4px}.page-header p{font-size:11px;color:var(--muted);margin:3px 0 0}.header-actions{display:flex;align-items:center;gap:14px}.mode-switch{display:flex;gap:3px;background:#e4e9e1;border:1px solid var(--line);padding:4px;border-radius:10px}.mode-switch button{border:0;background:transparent;padding:7px 12px;font-size:12px;border-radius:7px;white-space:nowrap}.mode-switch .active{background:white;color:var(--accent);font-weight:700;box-shadow:0 1px 4px #233a3915}.old-page{font-size:12px;color:var(--accent);text-decoration:none;white-space:nowrap}.spatial-notice{padding:8px 12px;border:1px solid #e3d59c;background:#fff7db;border-radius:8px;font-size:12px;line-height:1.5;display:flex;gap:9px;align-items:center;flex-shrink:0}.spatial-notice strong{font-weight:500}.data-notice{padding:6px 11px;border-left:3px solid #418c85;background:#e6f0eb;font-size:11px;border-radius:3px;line-height:1.5;flex-shrink:0}.data-notice.history{background:#f7eae1;border-color:#be825a}.data-notice.network{background:#e7eef7;border-color:#6385af}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;flex-shrink:0}.kpis>div{background:white;border:1px solid var(--line);border-radius:10px;padding:9px 14px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px}.kpis span{font-size:11px;color:var(--muted)}.kpis strong{font-size:24px;grid-column:2;grid-row:1/3;white-space:nowrap}.kpis strong small{font-size:11px;font-weight:400}.kpis em{font-style:normal;color:var(--muted);font-size:10px}.main-layout{display:flex;flex:1;min-height:310px;gap:10px}.map-panel{position:relative;flex:1;min-width:0;border:1px solid #cbd9c9;border-radius:12px;overflow:hidden;background:#e3eadc}.map-canvas{position:absolute;inset:0}.map-canvas :deep(canvas){display:block;width:100%;height:100%;touch-action:none}.map-top{position:absolute;left:13px;right:13px;top:12px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}.map-badge{display:flex;flex-direction:column;gap:3px;padding:8px 11px;background:#ffffffde;border-radius:8px;box-shadow:0 2px 10px #233a390c}.map-badge b{font-size:12px}.map-badge span{font-size:10px;color:var(--muted)}.reset-camera{pointer-events:auto;padding:8px 10px;background:#fffffff0;border:1px solid #d3dfd3;border-radius:8px;font-size:11px}.map-legend{position:absolute;left:13px;bottom:12px;background:#ffffffe8;border:1px solid #dbe2d6;padding:8px 10px;border-radius:8px;max-width:280px;font-size:10px;pointer-events:none}.map-legend>span{margin-right:10px;white-space:nowrap}.map-legend i,.brand-totals i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}.map-legend p{color:var(--muted);font-size:10px;margin:6px 0 0;line-height:1.6}.osm-credit{position:absolute;right:8px;bottom:6px;font-size:10px;color:#326959;background:#ffffffe6;padding:3px 6px;border-radius:4px;text-decoration:none}.north-indicator{position:absolute;right:17px;top:64px;display:flex;flex-direction:column;align-items:center;color:#3d6259;font-size:19px;font-weight:700;pointer-events:none}.north-indicator small{font-size:9px;font-weight:400}.hover-card{position:absolute;z-index:3;display:flex;flex-direction:column;gap:4px;padding:10px 13px;border-radius:9px;background:#fffffff5;border:1px solid #cdd9cb;box-shadow:0 6px 18px #233a3918;max-width:255px;pointer-events:none}.hover-card b{font-size:13px}.hover-card span{font-size:10px;color:var(--muted)}.map-loading{position:absolute;inset:0;background:#f2f4eed9;display:grid;place-items:center;color:var(--accent);font-size:14px}.side-panel{width:316px;flex-shrink:0;background:white;border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}.side-content{padding:12px;overflow:auto;flex:1;min-height:0}.empty,.muted{color:var(--muted);font-size:11px;line-height:1.8}.empty{padding:14px 2px}.brand-totals{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}.brand-totals>div{display:flex;align-items:center;font-size:11px;margin:7px 0}.brand-totals span{flex:1}.brand-totals b{white-space:nowrap}.person-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}.initial-loading{margin:auto;color:var(--muted)}.error-panel{margin:30px auto;background:#fff2e8;border:1px solid #d5b19a;border-radius:12px;padding:24px;max-width:700px;line-height:1.8}.error-panel p{font-size:13px}.error-panel a{color:var(--accent);margin-left:14px}.error-panel button{padding:6px 12px;border:1px solid #bfcdb9;background:white;border-radius:6px}
.spatial-notice{position:sticky;top:0;z-index:10}
.header-actions{flex-wrap:wrap;justify-content:flex-end}.map-camera-buttons{display:flex;gap:7px;pointer-events:auto}.role-key{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}.role-key span{white-space:nowrap}.role-key i{border-radius:50%}.map-legend{max-width:310px}
@media(min-width:1600px){.side-panel{width:350px}.page-header h1{font-size:22px}.kpis>div{padding:12px 16px}.side-content{padding:15px}.main-layout{min-height:360px}}
@media(max-width:1000px){.page-header h1{font-size:16px}.side-panel{width:265px}.old-page{display:none}.kpis>div{padding:8px}.kpis strong{font-size:20px}.kpis em{font-size:9px}.mode-switch button{padding:7px 8px}}
@media(max-width:720px){.campus3d-page{padding:9px;gap:7px}.page-header{flex-wrap:wrap}.page-header h1{font-size:16px}.header-actions{width:100%;justify-content:space-between}.old-page{display:block}.spatial-notice{font-size:11px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.main-layout{flex-direction:column;min-height:650px}.map-panel{min-height:370px}.side-panel{width:100%;height:260px}.map-legend{max-width:230px}.north-indicator{display:none}}
</style>

<style scoped>
.details-toggle{display:none}
.integrated-page{height:100%;min-height:0;overflow:hidden}
.integrated-page .main-layout{min-height:0;flex:1;position:relative}
.integrated-page .map-panel{min-height:0}
.integrated-page .side-panel{min-height:0}
.integrated-page .page-header h1{font-size:17px}
.integrated-page .page-header p{display:none}
.integrated-page .header-actions{gap:8px}
.integrated-page .kpis>div{padding:6px 10px}
.integrated-page .population-accounting{margin:0}
@media(max-width:900px){
 .integrated-page .details-toggle{display:block;align-self:flex-end;border:1px solid #b8ccbe;background:#fff;border-radius:7px;padding:5px 10px;font-size:11px}
 .integrated-page .main-layout{flex-direction:row;min-height:0}
 .integrated-page .side-panel{display:none}
 .integrated-page.details-open .side-panel{display:flex;position:absolute;right:6px;top:6px;bottom:6px;width:min(310px,85%);height:auto;z-index:9;box-shadow:0 5px 24px #24473730}
 .integrated-page .map-panel{min-height:0}
 .integrated-page .header-actions{width:auto}
 .integrated-page .old-page{display:none}
 .integrated-page .map-legend{max-width:230px;padding:5px 7px}
 .integrated-page .map-legend p{display:none}
}
@media(max-height:650px){
 .integrated-page{gap:5px;padding:8px 10px}
 .integrated-page .page-header,.integrated-page .kpis,.integrated-page .data-notice{display:none}
 .integrated-page .population-accounting{font-size:10px}
 .integrated-page .spatial-notice{padding:5px 8px;font-size:10px}
}
</style>

<style scoped>
.side-panel-header {
  flex-shrink: 0;
  padding: 13px 11px 10px;
  border-bottom: 1px solid #e3e9e4;
}
.panel-caption { margin: 0 0 6px; color: #526a61; font-size: 11px; font-weight: 650; }
.side-panel-header .panel-caption { padding-left: 3px; }
.hover-card .hover-interior { color: #216658; font-weight: 700; }
.side-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid #e2e9e3;
  border-radius: 9px;
  background: #eef3ef;
}
.side-tabs button {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 4px;
  min-height: 43px;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #4b6259;
  font-size: 11px;
  white-space: nowrap;
}
.side-tabs button i { font-size: 12px; }
.side-tabs button:hover { background: #e2ebe4; }
.side-tabs button.active {
  border-color: #c8ddd1;
  background: #fff;
  color: #1c6250;
  font-weight: 700;
  box-shadow: 0 1px 3px #233a3912;
}
.section-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 9px; }
.section-heading h2 { margin: 0; font-size: 14px; }
.section-heading small {
  padding: 3px 7px;
  border-radius: 5px;
  background: #edf3ee;
  color: #496357;
  font-size: 11px;
  white-space: nowrap;
}
.event-list { display: grid; gap: 5px; }
.side-content .event-row {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 8px 9px;
  text-align: left;
  border: 1px solid #e6ece7;
  border-radius: 7px;
  background: #fbfcfa;
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.side-content .event-row:hover { background: #eff6f0; border-color: #cbded1; }
.event-meta { display: flex; gap: 7px; align-items: center; color: #5e7168; font-size: 11px; }
.event-kind { background: #e8f1ea; color: #32634f; border-radius: 4px; padding: 1px 5px; font-weight: 650; }
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #dce7df;
  border-radius: 8px;
  background: #f7faf7;
  color: #526a61;
  font-size: 12px;
}
.search:focus-within { outline: 2px solid #4b9ca7; outline-offset: 2px; }
.search input { border: 0; outline: 0; min-width: 0; width: 100%; background: transparent; color: var(--ink); }
.person-detail {
  margin: 10px 0;
  padding: 11px;
  border: 1px solid #dbe7de;
  border-radius: 9px;
  background: #f7faf7;
  font-size: 12px;
  line-height: 1.55;
}
.person-title { display: flex; gap: 6px; align-items: center; }
.person-title h2 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.person-title small { margin-left: auto; padding: 2px 6px; border-radius: 4px; background: #e8f0e9; color: #3e5a4f; white-space: nowrap; }
.person-detail code { font-size: 10px; color: #586d64; overflow-wrap: anywhere; }
.person-placement { display: flex; align-items: baseline; gap: 7px; margin: 8px 0 5px; color: #216658; font-weight: 650; }
.person-bio { margin: 5px 0 8px; color: #4f625a; }
.mapping-note { color: #655832; font-size: 11px; }
.mapping-note summary { width: fit-content; cursor: pointer; }
.mapping-note p { margin: 5px 0 0; padding: 6px 8px; border-radius: 5px; background: #f6efdb; }
.person-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 9px 0; }
.person-stats div { display: flex; align-items: baseline; justify-content: space-between; gap: 5px; padding: 5px 7px; border-radius: 5px; background: #e9f1e9; }
.person-stats dt { font-size: 11px; color: #4d665b; }
.person-stats dd { margin: 0; color: #216658; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.relation-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
.relation-buttons button { font-size: 11px; border: 1px solid #d4e2d7; border-radius: 5px; padding: 3px 6px; background: #fff; }
.relation-buttons button:hover { background: #e8f2e9; }
.person-history h3 { margin: 11px 0 5px; font-size: 12px; }
.person-history ol { list-style: none; margin: 0; padding: 0 0 0 9px; border-left: 2px solid #cddfd3; }
.person-history li { padding: 4px 0; color: #4d6259; font-size: 11px; overflow-wrap: anywhere; }
.roster { display: grid; gap: 4px; margin-top: 8px; }
.roster > button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #e5ebe6;
  border-radius: 6px;
  background: #fff;
  text-align: left;
  font-size: 12px;
}
.roster > button > span:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.roster small { display: block; color: #5b7066; font-size: 11px; }
.roster > button:hover, .roster .selected { background: #eef6ef; border-color: #cadfd0; color: #216658; }
.mapping-row, .building-summary { padding: 8px 9px; border: 1px solid #e0e9e1; border-radius: 7px; background: #f7faf7; }
.mapping-row + .mapping-row { margin-top: 6px; }
.mapping-row b { display: block; font-size: 13px; }
.mapping-row i { margin-right: 6px; color: #277b68; }
.mapping-row small { display: block; color: #5b7066; font: 10px ui-monospace, monospace; overflow-wrap: anywhere; }
.mapping-row p, .building-summary p { margin: 4px 0 0; color: #4d6259; font-size: 11px; line-height: 1.55; }
.building-summary { display: flex; align-items: center; gap: 10px; }
.building-summary > i { color: #277b68; }
.building-summary h3 { margin: 0; font-size: 14px; }
.timeline-panel { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; flex-shrink: 0; }
.timeline-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px 14px; }
.timeline-heading { display: flex; align-items: center; gap: 8px; }
.timeline-heading > i { padding: 8px; border-radius: 7px; background: #e9f2eb; color: #277b68; font-size: 14px; }
.timeline-heading .panel-caption { margin: 0 0 2px; }
.current-day { display: block; font-size: 14px; line-height: 1.2; white-space: nowrap; }
.timeline-status { padding: 2px 6px; border-radius: 5px; background: #e9f2eb; color: #416252; font-size: 10px; white-space: nowrap; }
.timeline-status.partial-status { color: #78531f; background: #fbf1dd; }
.playback-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.playback-controls button, .playback-controls select {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid #dce7de;
  border-radius: 7px;
  background: #f7faf7;
  color: var(--ink);
  font-size: 11px;
  white-space: nowrap;
}
.playback-controls button:not(:disabled):hover { border-color: #9bbdad; }
.playback-controls .play-button { min-width: 64px; background: #216658; border-color: #216658; color: #fff; font-weight: 700; }
.playback-controls .play-button:not(:disabled):hover { background: #195346; }
.play-button i, .walking-button i, .day-step-controls .fa-chevron-left { margin-right: 5px; }
.day-step-controls .fa-chevron-right { margin-left: 5px; }
.day-step-controls { display: flex; }
.day-step-controls button { border-radius: 0; }
.day-step-controls button:first-child { border-radius: 7px 0 0 7px; }
.day-step-controls button:last-child { border-radius: 0 7px 7px 0; }
.day-step-controls button + button { margin-left: -1px; }
.day-step-controls button:focus-visible { z-index: 1; }
.speed-control { display: flex; align-items: center; gap: 5px; color: #4f665c; font-size: 11px; }
.timeline-track { display: flex; align-items: center; gap: 8px; margin: 5px 0 1px; }
.progress-label, .timeline-track output { color: #4d665b; font-size: 11px; white-space: nowrap; }
.timeline-track output { width: 33px; text-align: right; font-variant-numeric: tabular-nums; }
.timeline-track input { appearance: none; flex: 1; min-width: 0; height: 20px; margin: 0; background: transparent; cursor: pointer; }
.timeline-track input::-webkit-slider-runnable-track { height: 5px; border-radius: 10px; background: linear-gradient(to right, #277b68 var(--progress), #e0eae2 var(--progress)); }
.timeline-track input::-webkit-slider-thumb { appearance: none; width: 13px; height: 13px; margin-top: -4px; border: 2px solid white; border-radius: 50%; background: #216658; box-shadow: 0 0 0 1px #277b68; }
.timeline-track input::-moz-range-track { height: 5px; border-radius: 10px; background: #e0eae2; }
.timeline-track input::-moz-range-progress { height: 5px; border-radius: 10px; background: #277b68; }
.timeline-track input::-moz-range-thumb { width: 9px; height: 9px; border: 2px solid white; border-radius: 50%; background: #216658; box-shadow: 0 0 0 1px #277b68; }
.day-buttons { display: flex; gap: 4px; overflow-x: auto; padding: 3px; }
.day-buttons button { flex: 1; min-width: 24px; min-height: 24px; padding: 2px 3px; background: #f6f8f5; border: 1px solid #e5ebe5; border-radius: 5px; color: #50665b; font-size: 11px; font-variant-numeric: tabular-nums; }
.day-buttons button.elapsed { background: #e9f3ea; color: #286654; }
.day-buttons button:hover { border-color: #92b5a3; }
.day-buttons button.partial { border-style: dashed; border-color: #b8884c; }
.day-buttons button.active { background: #216658; border-color: #216658; color: white; font-weight: 700; }
.day-buttons button.active.partial { border-color: #f8cb89; }
.network-footer { margin: 6px 0 0; color: var(--muted); font-size: 11px; }
@media (max-width: 720px) {
  .timeline-panel { padding: 8px 9px; }
  .playback-controls button, .playback-controls select { min-height: 37px; }
  .day-buttons button { min-width: 30px; min-height: 30px; }
}
.character-loading{position:absolute;z-index:8;top:70px;left:14px;max-width:340px;display:flex;align-items:center;justify-content:space-between;gap:10px}.character-loading button{border:1px solid #b7cbbb;border-radius:5px;padding:3px 8px;background:white;color:#376e59}
</style>

<style scoped>
.event-entry{min-width:0}.event-entry>.event-row{width:100%;text-align:left}.event-entry :deep(.event-result-details){margin:4px 8px 10px}.brand-totals .shop-name{display:block;font-size:11px;font-weight:600}.brand-totals small{display:block;color:var(--muted);margin-top:3px;line-height:1.5}.building-shops{margin:12px 0;border:1px solid #d8e5dc;border-radius:8px;background:#f5f9f6;padding:10px}.building-shops h4{font-size:12px;margin:0 0 10px}.building-shops>div{padding:8px 0;border-top:1px solid #e0e8e2;display:grid;gap:4px}.building-shops b{font-size:12px;color:#276856}.building-shops span,.building-shops small{font-size:11px;color:#6f837b;overflow-wrap:anywhere}.role-description{font-size:11px;color:#607c71;margin:10px 0}.role-description summary{cursor:pointer}.role-description p{line-height:1.7}.role-description small{overflow-wrap:anywhere}
</style>

<style scoped>.role-key [title]{pointer-events:auto}</style>
