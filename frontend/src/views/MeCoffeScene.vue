<template>
  <div class="mc-page">
    <header class="mc-header">
      <div class="mc-brand">
        <div class="mc-logo"><i class="fa-solid fa-mug-hot"></i></div>
        <div>
          <h1>MeCoffe 校园场景沙盘</h1>
          <p v-if="meta && isDemo">新版动态演示 · <code>快照 v{{ meta.snapshot_revision }}</code> · {{ scene.people.length }} 人 / {{ followingEdges.length }} 条初始关注</p>
          <p v-else-if="meta && isNetwork">新版人物关系网络 · <code>快照 v{{ meta.snapshot_revision }}</code> · 点击人物查看关注关系</p>
          <p v-else-if="meta">历史运行回放 · <code>{{ shortRun }}</code> · 不调用模型、不改动模拟</p>
        </div>
      </div>
      <div class="mc-brands">
        <nav class="mc-mode" aria-label="场景数据模式">
          <button :class="{ on: requestedMode === 'demo' }" :aria-pressed="requestedMode === 'demo'" :disabled="loading" @click="loadScene('demo')">新版演示</button>
          <button :class="{ on: requestedMode === 'network' }" :aria-pressed="requestedMode === 'network'" :disabled="loading" @click="loadScene('network')">关系网络</button>
          <button :class="{ on: requestedMode === 'history' }" :aria-pressed="requestedMode === 'history'" :disabled="loading" @click="loadScene('history')">历史回放</button>
        </nav>
        <span v-for="brand in brands" :key="brand.brand_id" class="mc-brand-chip" :style="{ '--c': brand.color }">
          <i class="fa-solid fa-store"></i>{{ brand.product_name }}
        </span>
      </div>
    </header>

    <div v-if="loadError" class="mc-error">数据加载失败：{{ loadError }}。请重新运行本地启动脚本生成场景数据。</div>

    <template v-else-if="index">
      <div v-if="isDemo" class="mc-demo-notice"><i class="fa-solid fa-film"></i><span>基于 v{{ meta.snapshot_revision }} 网络的规则演示，非 OASIS 运行结果。人物与关注来自新版快照；购买、传播、价格均按示例规则演出。</span><a v-if="meta.source_url" :href="meta.source_url" target="_blank" rel="noopener noreferrer">网络来源</a></div>
      <div v-if="runNotice" class="mc-notice"><i class="fa-solid fa-circle-info"></i>{{ runNotice }}</div>

      <details v-if="matchedSourceSync" class="mc-source-sync">
        <summary>当前回放 v{{ matchedSourceSync.displayed_run.snapshot_revision }} · 最新人物关系输入 v{{ matchedSourceSync.latest_snapshot.revision }}：{{ matchedSourceSync.latest_snapshot.agent_count }} 人 / {{ matchedSourceSync.latest_snapshot.relationship_count }} 条关系，待配套运行</summary>
        <div class="mc-source-details">
          <p>当前回放：{{ matchedSourceSync.displayed_run.agent_count }} 人 / {{ matchedSourceSync.displayed_run.relationship_count }} 条初始关系；最新输入：{{ matchedSourceSync.latest_snapshot.agent_count }} 人 / {{ matchedSourceSync.latest_snapshot.relationship_count }} 条初始关系。</p>
          <p v-if="matchedSourceSync.comparison">相对当前输入：新增 {{ matchedSourceSync.comparison.added_relationships }} 条关系，移除 {{ matchedSourceSync.comparison.removed_relationships }} 条关系，修改 {{ matchedSourceSync.comparison.changed_nodes }} 个人物。</p>
          <p>当前地图、事件和销量仍对应旧运行；新关系尚未用于该次模拟。</p>
          <p v-if="matchedSourceSync.note">{{ matchedSourceSync.note }}</p>
          <div class="mc-source-links">
            <span>核对时间：{{ matchedSourceSync.checked_at }}</span>
            <a :href="matchedSourceSync.latest_snapshot.source_url" target="_blank" rel="noopener noreferrer">新版人物关系文件</a>
            <template v-if="matchedSourceSync.source_urls">
              <a v-if="matchedSourceSync.source_urls.repository" :href="matchedSourceSync.source_urls.repository" target="_blank" rel="noopener noreferrer">共享仓库</a>
              <a v-if="matchedSourceSync.source_urls.network" :href="matchedSourceSync.source_urls.network" target="_blank" rel="noopener noreferrer">关系模块说明</a>
              <a v-if="matchedSourceSync.source_urls.engine" :href="matchedSourceSync.source_urls.engine" target="_blank" rel="noopener noreferrer">OASIS 验证说明</a>
            </template>
          </div>
        </div>
      </details>

      <section v-if="isNetwork" class="mc-kpis">
        <div v-for="item in networkKpis" :key="item.label" class="mc-kpi">
          <div class="mc-kpi-icon" :style="{ '--k': item.color }"><i :class="item.icon"></i></div>
          <div class="mc-kpi-body"><span>{{ item.label }}</span><strong>{{ item.value }}<small> {{ item.unit }}</small></strong><em>{{ item.note }}</em></div>
        </div>
      </section>
      <section v-else class="mc-kpis">
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#2f6fb3"><i class="fa-solid fa-calendar-day"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '演示日期' : '当前日期' }}</span><strong>{{ currentDay.label }}</strong>
            <em :class="{ warn: !currentDay.complete }">{{ currentDay.complete ? stageText : '本日记录不完整' }}</em></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#1f8a70"><i class="fa-solid fa-mug-saucer"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '演示订单' : '成交订单' }}</span><strong>{{ state.orders }}<small> 单</small></strong>
            <div class="mc-share"><b v-for="brand in brands" :key="brand.brand_id" :style="{ background: brand.color, flex: state.cups[brand.brand_id] || 0.0001 }"></b></div>
            <em><template v-for="brand in brands" :key="brand.brand_id"><i :style="{ color: brand.color }">●</i>{{ state.cups[brand.brand_id] }} </template></em></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#c0603f"><i class="fa-solid fa-yen-sign"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '演示金额' : '成交额' }}</span><strong>¥{{ totalRevenue }}</strong>
            <em><template v-for="brand in brands" :key="brand.brand_id"><i :style="{ color: brand.color }">●</i>¥{{ (state.revenueFen[brand.brand_id] / 100).toFixed(1) }} </template></em></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#7a5bd1"><i class="fa-solid fa-comments"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '演示发帖 / 评论' : '帖子 / 评论' }}</span><strong>{{ state.posts }}<small> / {{ state.comments }}</small></strong>
            <em v-if="isDemo">初始关注 {{ followingEdges.length }} 条</em><em v-else>失败动作 {{ state.failed }} · 关注 {{ state.follows }}</em></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#d99a1b"><i class="fa-solid fa-bullhorn"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '演示广告触达' : '广告实际返回' }}</span><strong>{{ state.reachedAny }}<small> 人</small></strong>
            <em><template v-for="brand in brands" :key="brand.brand_id"><i :style="{ color: brand.color }">●</i>{{ state.reached[brand.brand_id] }} 人 </template></em></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi-icon" style="--k:#4c5a52"><i class="fa-solid fa-users"></i></div>
          <div class="mc-kpi-body"><span>{{ isDemo ? '新版网络人物' : '模拟人物' }}</span><strong>{{ scene.people.length }}<small> 人</small></strong><em>{{ roleSummary }}</em></div>
        </div>
      </section>

      <main class="mc-main">
        <div class="mc-map">
          <div ref="mapEl" class="mc-canvas"></div>

          <div class="mc-map-tools">
            <label v-if="!isNetwork" class="mc-toggle" :class="{ on: walkMode }">
              <input v-model="walkMode" type="checkbox" /><span class="knob"></span>购买时走到门店
            </label>
            <button class="mc-icon-btn" title="查看全图" @click="campus?.fitAll()"><i class="fa-solid fa-expand"></i></button>
          </div>

          <div v-if="isNetwork" class="mc-map-legend">
            <span><i class="fa-solid fa-arrow-right" style="color:#2f6fb3"></i>蓝线：此人关注谁</span>
            <span><i class="fa-solid fa-arrow-left" style="color:#d99a1b"></i>橙线：谁关注此人</span>
            <p>采用新版网络的实际有向关系。点击人物或名册查看；校园位置按角色示意分配。</p>
          </div>
          <div v-else class="mc-map-legend">
            <span><i class="fa-solid fa-message" style="color:#3d6fb6"></i>发帖</span>
            <span><i class="fa-solid fa-comments" style="color:#8a5bd1"></i>评论</span>
            <span><i class="fa-solid fa-person-walking" style="color:#1f8a70"></i>{{ walkMode ? '买咖啡：走到门店' : '买咖啡：连线' }}</span>
            <span><i class="fa-solid fa-bullhorn" style="color:#d99a1b"></i>广告进信息流</span>
            <span v-if="!isDemo"><i class="fa-solid fa-lightbulb" style="color:#e0a21b"></i>访谈</span>
            <p v-if="isDemo"><i class="fa-solid fa-film"></i> 规则演示：购买触发走路与到店，发帖和评论触发气泡；关注关系决定传播对象。点击人物可查看关系。</p>
            <p v-else><i class="fa-solid fa-hand-pointer"></i> 鼠标停在楼上可看楼内各层。楼栋分配、走路去门店都是示意，OASIS 本次运行没有位置数据。</p>
          </div>

          <transition name="mc-pop">
            <div v-if="hoverCard" class="mc-hover" :style="hoverStyle">
              <div class="mc-hover-head">
                <div>
                  <strong>{{ hoverCard.name }}</strong>
                  <span>{{ hoverCard.locationName }}<template v-if="hoverCard.pinned"> · 已固定</template></span>
                </div>
                <div class="mc-hover-count"><b>{{ hoverCard.residents.length - hoverCard.away.length }}</b> 在楼内<template v-if="hoverCard.away.length"> · <b>{{ hoverCard.away.length }}</b> 外出</template></div>
                <button v-if="hoverCard.pinned" class="mc-hover-close" title="收起" @click="campus?.unpin()"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div class="mc-hover-roles">
                <span v-for="(n, label) in hoverRoles" :key="label">{{ label }} {{ n }}</span>
              </div>
              <ul class="mc-hover-list">
                <li v-for="id in hoverCard.residents" :key="id" :class="{ away: hoverCard.away.includes(id), on: id === selectedId }" @click="selectPerson(id)">
                  <span class="mc-dot" :style="{ background: roleColor(personOf(id).role) }"></span>
                  <span class="name">{{ personOf(id).name }}</span>
                  <span v-if="hoverCard.away.includes(id)" class="status"><i class="fa-solid fa-person-walking"></i> 去买咖啡</span>
                  <span class="cups"><i v-for="(cups, brandId) in cupsOf(id)" :key="brandId" :style="{ background: brandColor(brandId) }">☕{{ cups }}</i></span>
                </li>
              </ul>
            </div>
          </transition>
        </div>

        <aside class="mc-side">
          <nav class="mc-tabs">
            <button v-for="tab in tabs" :key="tab.id" :class="{ on: activeTab === tab.id }" @click="activeTab = tab.id">
              <i :class="tab.icon"></i>{{ tab.label }}
            </button>
          </nav>

          <div v-if="activeTab === 'person'" class="mc-pane">
            <div v-if="!selected" class="mc-empty"><i class="fa-regular fa-hand-pointer"></i>点击地图或楼内的人物，或在“名册”中选择。</div>
            <template v-else>
              <div class="mc-person-card" :style="{ '--rc': roleColor(selected.role) }">
                <div class="mc-avatar">{{ selected.name.slice(0, 1) }}</div>
                <div class="mc-person-main">
                  <h2>{{ selected.name }}</h2>
                  <p><span class="mc-role-chip">{{ selected.role_label }}</span>{{ placeText(selected) }}<span v-if="selected.age"> · {{ selected.age }} 岁</span></p>
                  <code>{{ selected.id }}</code>
                </div>
              </div>
              <div v-if="walkingNow" class="mc-live"><i class="fa-solid fa-person-walking"></i>正在去咖啡店的路上</div>
              <p class="mc-bio">{{ selected.bio }}</p>
              <dl class="mc-profile">
                <template v-if="selected.profile.coffee_preferences"><dt><i class="fa-solid fa-heart"></i>偏好</dt><dd>{{ selected.profile.coffee_preferences.join('、') }}</dd></template>
                <template v-if="selected.profile.coffee_budget_30d_cny !== undefined"><dt><i class="fa-solid fa-wallet"></i>30 天预算</dt><dd>¥{{ selected.profile.coffee_budget_30d_cny }}</dd></template>
                <template v-if="selected.profile.personality"><dt><i class="fa-solid fa-user"></i>性格</dt><dd>{{ selected.profile.personality }}</dd></template>
                <template v-if="selected.profile.purchase_strategy"><dt><i class="fa-solid fa-chess"></i>购买策略</dt><dd>{{ selected.profile.purchase_strategy }}</dd></template>
                <template v-if="selected.profile.promotion_goal"><dt><i class="fa-solid fa-bullseye"></i>经营目标</dt><dd>{{ selected.profile.promotion_goal }}</dd></template>
                <dt v-if="!isNetwork"><i class="fa-solid fa-mug-saucer"></i>{{ isDemo ? '演示购买' : '已购买' }}</dt>
                <dd v-if="!isNetwork">
                  <span v-if="!Object.keys(selectedPurchases).length" class="muted">截至当前尚无订单</span>
                  <span v-for="(cups, brandId) in selectedPurchases" :key="brandId" class="mc-tag" :style="{ '--c': brandColor(brandId) }">{{ brandName(brandId) }} {{ cups }} 杯</span>
                </dd>
              </dl>
              <details v-if="hasNewNetwork" class="mc-relations" :open="isNetwork">
                <summary>初始关系：关注 {{ selectedFollowing.length }} 人 / 被关注 {{ selectedFollowers.length }} 人</summary>
                <h3><i class="fa-solid fa-user-plus"></i>关注 {{ selectedFollowing.length }} 人 <small>此人 → 对方</small></h3>
                <p v-if="!selectedFollowing.length" class="mc-empty">没有主动关注。</p>
                <div class="mc-relation-list"><button v-for="person in selectedFollowing" :key="person.id" @click="selectPerson(person.id, true)"><span class="mc-dot" :style="{ background: roleColor(person.role) }"></span>{{ person.name }}<small>{{ person.role_label }}</small></button></div>
                <h3><i class="fa-solid fa-users"></i>被关注 {{ selectedFollowers.length }} 人 <small>对方 → 此人</small></h3>
                <p v-if="!selectedFollowers.length" class="mc-empty">暂无其他人物关注。</p>
                <div class="mc-relation-list"><button v-for="person in selectedFollowers" :key="person.id" @click="selectPerson(person.id, true)"><span class="mc-dot" :style="{ background: roleColor(person.role) }"></span>{{ person.name }}<small>{{ person.role_label }}</small></button></div>
                <p class="mc-network-note">{{ isDemo ? '初始关系来自新版快照；本页行为由演示规则产生，不代表模型自主决策。' : '这些是新版快照中的初始关注关系，尚未产生对应的购买、发帖或访谈记录。' }}</p>
              </details>
              <h3 v-if="!isNetwork"><i class="fa-solid fa-clock-rotate-left"></i>{{ isDemo ? '演示行为' : '行为记录' }} <small>截至当前，最新在前</small></h3>
              <ul v-if="!isNetwork" class="mc-feed">
                <li v-if="!selectedHistory.length" class="mc-empty">当前时间点之前没有记录。</li>
                <li v-for="event in selectedHistory" :key="event.key" :class="['t-' + event.type]">
                  <i :class="['mc-feed-icon', typeIcon(event.type)]"></i>
                  <div><span class="mc-when">{{ dayLabel(event.step) }} · {{ stageLabel(event.stage) }}</span>
                    <span class="mc-what">{{ describe(event) }}</span></div>
                </li>
              </ul>
            </template>
          </div>

          <div v-else-if="activeTab === 'feed'" class="mc-pane">
            <ul class="mc-feed">
              <li v-if="!recentEvents.length" class="mc-empty"><i class="fa-solid fa-play"></i>点击“播放”开始{{ isDemo ? '新版动态演示' : '回放' }}。</li>
              <li v-for="event in recentEvents" :key="event.key" :class="['t-' + event.type, 'clickable']" @click="selectPerson(event.actor, true)">
                <i :class="['mc-feed-icon', typeIcon(event.type)]"></i>
                <div><span class="mc-when">{{ dayLabel(event.step) }} · {{ stageLabel(event.stage) }} · {{ typeLabel(event.type) }}</span>
                  <span class="mc-what">{{ describe(event) }}</span></div>
              </li>
            </ul>
          </div>

          <div v-else class="mc-pane">
            <div class="mc-filter">
              <div class="mc-search"><i class="fa-solid fa-magnifying-glass"></i><input v-model="query" placeholder="搜索姓名或编号" /></div>
              <select v-model="roleFilter">
                <option value="">全部角色</option>
                <option v-for="(label, role) in roleLabels" :key="role" :value="role">{{ label }}</option>
              </select>
            </div>
            <ul class="mc-roster">
              <li v-for="person in roster" :key="person.id" :class="{ on: person.id === selectedId }" @click="selectPerson(person.id, true)">
                <span class="mc-dot" :style="{ background: roleColor(person.role) }"></span>
                <span class="name">{{ person.name }}</span>
                <span class="where">{{ buildingName(person) }}</span>
                <span class="cups"><i v-for="(cups, brandId) in cupsOf(person.id)" :key="brandId" :style="{ background: brandColor(brandId) }">☕{{ cups }}</i></span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      <footer v-if="isNetwork" class="mc-network-footer">
        <i class="fa-solid fa-circle-check"></i><span>新版网络已采用：{{ scene.people.length }} 人、{{ followingEdges.length }} 条关注。尚无配套行为轨迹，旧运行可在“历史回放”查看。</span>
        <a v-if="meta.source_url" :href="meta.source_url" target="_blank" rel="noopener noreferrer">查看网络来源</a>
      </footer>
      <footer v-else class="mc-footer">
        <div class="mc-transport">
          <button class="mc-play" :title="playing ? '暂停' : '播放'" @click="togglePlay">
            <i :class="playing ? 'fa-solid fa-pause' : atEnd ? 'fa-solid fa-rotate-right' : 'fa-solid fa-play'"></i>
            <span>{{ playing ? '暂停' : (atEnd ? '重新播放' : '播放') }}</span>
          </button>
          <button class="mc-icon-btn" title="上一天" @click="jumpDay(-1)"><i class="fa-solid fa-backward-step"></i></button>
          <button class="mc-icon-btn" title="下一条事件" @click="stepEvent(1)"><i class="fa-solid fa-forward"></i></button>
          <button class="mc-icon-btn" title="下一天" @click="jumpDay(1)"><i class="fa-solid fa-forward-step"></i></button>
          <div class="mc-speed">
            <button v-for="s in [0.5, 1, 2, 4]" :key="s" :class="{ on: speed === s }" @click="speed = s">{{ s }}×</button>
          </div>
          <span class="mc-progress"><b>{{ cursor }}</b> / {{ scene.events.length }} 条{{ isDemo ? '演示' : '' }}事件<template v-if="!isDemo"> · 当日未操作 {{ currentDay.noop }} 次</template><template v-else> · v{{ meta.snapshot_revision }} / {{ followingEdges.length }} 条关注</template></span>
        </div>
        <div class="mc-timeline">
          <div class="mc-track">
            <div class="mc-track-fill" :style="{ width: progressPct + '%' }"></div>
          </div>
          <div class="mc-days">
            <button v-for="(day, k) in days" :key="day.step" :class="{ on: k === dayIndex, past: k < dayIndex, partial: !day.complete }"
              :style="{ '--heat': dayHeat(k) }" :title="dayTitle(day)" @click="seekDay(k)">
              {{ day.step === 0 ? '初' : day.step }}
            </button>
          </div>
        </div>
        <div ref="chartEl" class="mc-chart"></div>
      </footer>
    </template>

    <div v-else class="mc-loading"><i class="fa-solid fa-spinner fa-spin"></i> 正在加载场景数据…</div>
  </div>
</template>

<script setup>
import {publicUrl} from '../mecoffe/publicUrl.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import { CampusScene, BRAND_COLORS } from '../mecoffe/CampusScene'
import {
  indexScene, stateAt, dayIndexAt, dailySeries, personHistory, personPurchases, cupsByPersonAt,
  describeEvent, EVENT_LABELS, STAGE_LABELS,
} from '../mecoffe/replay'

const SECONDS_PER_DAY = 4
const DEMO_SECONDS_PER_DAY = 8
const MAX_ANIMATIONS_PER_FRAME = 30
const ROLE_COLORS = { merchant: '#a0672d', undergraduate_consumer: '#3f78b5', graduate_consumer: '#4f9a5a', teacher_consumer: '#9a5fb0' }
const TYPE_ICONS = {
  post: 'fa-solid fa-message', comment: 'fa-solid fa-comments', purchase: 'fa-solid fa-mug-saucer',
  ad: 'fa-solid fa-bullhorn', exposure: 'fa-solid fa-rss', follow: 'fa-solid fa-user-plus',
  interview: 'fa-solid fa-lightbulb', failed: 'fa-solid fa-triangle-exclamation', price: 'fa-solid fa-tag',
}

const mapEl = ref(null)
const chartEl = ref(null)
const index = shallowRef(null)
const loadError = ref('')
const sourceSync = shallowRef(null)
const campus = shallowRef(null)
const requestedMode = ref('demo')
const loading = ref(true)
let loadGeneration = 0
let chart = null

const dayPos = ref(0)
const playing = ref(false)
const manualAnimation = ref(false)
const speed = ref(1)
const walkMode = ref(true)
const selectedId = ref(null)
const activeTab = ref('person')
const query = ref('')
const roleFilter = ref('')
const hoverCard = ref(null)
const walkTick = ref(0)       // 行人状态变化时递增，让“正在路上”等提示刷新
const tabs = computed(() => [
  { id: 'person', label: '人物', icon: 'fa-solid fa-id-card' },
  ...(!isNetwork.value ? [{ id: 'feed', label: '事件流', icon: 'fa-solid fa-list-ul' }] : []),
  { id: 'roster', label: '名册', icon: 'fa-solid fa-users' },
])

const scene = computed(() => index.value?.scene)
const meta = computed(() => scene.value?.meta)
const isNetwork = computed(() => meta.value?.mode === 'network_snapshot')
const isDemo = computed(() => meta.value?.mode === 'network_demo')
const hasNewNetwork = computed(() => isNetwork.value || isDemo.value)
const followingEdges = computed(() => (scene.value?.relationships || []).filter(edge => edge.relation === 'follow'))
const merchantIds = computed(() => new Set((scene.value?.people || []).filter(person => person.role === 'merchant').map(person => person.id)))
const peerFollows = computed(() => followingEdges.value.filter(edge => !merchantIds.value.has(edge.source) && !merchantIds.value.has(edge.target)).length)
const merchantFollows = computed(() => followingEdges.value.filter(edge => !merchantIds.value.has(edge.source) && merchantIds.value.has(edge.target)).length)
const networkKpis = computed(() => [
  { label: '网络人物', value: scene.value?.people.length || 0, unit: '人', note: roleSummary.value, icon: 'fa-solid fa-users', color: '#4c5a52' },
  { label: '初始关注关系', value: followingEdges.value.length, unit: '条', note: `快照 v${meta.value?.snapshot_revision}`, icon: 'fa-solid fa-share-nodes', color: '#2f6fb3' },
  { label: '消费者间关注', value: peerFollows.value, unit: '条', note: '消费者 → 其他消费者', icon: 'fa-solid fa-user-group', color: '#7a5bd1' },
  { label: '商家粉丝关系', value: merchantFollows.value, unit: '条', note: '消费者 → 商家', icon: 'fa-solid fa-user-plus', color: '#d99a1b' },
  { label: '商家', value: merchantIds.value.size, unit: '家', note: '点击商家查看粉丝', icon: 'fa-solid fa-store', color: '#a0672d' },
  { label: '网络状态', value: '已采用', unit: '', note: '行为模拟待运行', icon: 'fa-solid fa-circle-check', color: '#1f8a70' },
])
// 核对说明只适用于它所记录的运行，换入另一批轨迹时不沿用旧提示。
const matchedSourceSync = computed(() => {
  const sync = sourceSync.value
  const displayed = sync?.displayed_run
  if (hasNewNetwork.value || sync?.status !== 'awaiting_matching_run' || !meta.value || !sync.latest_snapshot) return null
  if (displayed?.run_id !== meta.value.run_id
    || displayed.snapshot_id !== meta.value.snapshot_id
    || displayed.snapshot_sha256 !== meta.value.sources?.snapshot_sha256) return null
  return sync
})
const shortRun = computed(() => (meta.value?.run_id || '').slice(0, 16) + '…')
const days = computed(() => index.value?.days || [])
const brands = computed(() => (scene.value?.brands || []).map((b, k) => ({ ...b, color: BRAND_COLORS[k % BRAND_COLORS.length] })))
const roleLabels = computed(() => Object.fromEntries((scene.value?.people || []).map(p => [p.role, p.role_label])))
const buildingNames = computed(() => {
  const names = new Map()
  for (const location of scene.value?.campus.locations || []) {
    for (const building of location.buildings || []) names.set(building.building_id, building.name)
  }
  return names
})

function cursorFor(position) {
  const list = days.value
  if (!list.length) return 0
  if (position >= list.length) return scene.value.events.length
  const k = Math.floor(position)
  const day = list[k]
  return Math.floor(day.start + (position - k) * (day.end - day.start))
}

const cursor = computed(() => cursorFor(dayPos.value))
const dayIndex = computed(() => Math.min(days.value.length - 1, Math.floor(dayPos.value)))
const currentDay = computed(() => days.value[dayIndex.value] || { label: '', complete: true, noop: 0 })
const atEnd = computed(() => dayPos.value >= days.value.length)
const progressPct = computed(() => (days.value.length ? (Math.min(dayPos.value, days.value.length) / days.value.length) * 100 : 0))
const state = computed(() => stateAt(index.value, cursor.value))
const totalRevenue = computed(() => (Object.values(state.value.revenueFen).reduce((a, b) => a + b, 0) / 100).toFixed(2))
const stageText = computed(() => {
  if (atEnd.value) return isDemo.value ? `${days.value.length} 天演示已结束` : '回放已结束'
  const event = scene.value.events[cursor.value - 1]
  return event && event.step === currentDay.value.step ? `${playing.value ? '进行中' : '已暂停'}：${stageLabel(event.stage)}` : '点击播放开始'
})
const roleSummary = computed(() => {
  const counts = {}
  for (const p of scene.value?.people || []) counts[p.role_label] = (counts[p.role_label] || 0) + 1
  return Object.entries(counts).map(([label, n]) => `${label} ${n}`).join(' · ')
})
const runNotice = computed(() => {
  if (!meta.value || hasNewNetwork.value) return ''
  const notes = []
  if (meta.value.partial || meta.value.status !== 'completed') {
    notes.push(`本次运行状态为 ${meta.value.status}：完整完成 ${meta.value.completed_steps}/${meta.value.total_steps} 天，之后的日子记录不完整`)
  }
  const rounds = new Set(scene.value.events.filter(e => e.type === 'interview').map(e => e.round))
  if (rounds.has('pre') && !rounds.has('post')) notes.push('只有第 1 天的基线访谈，后测访谈未执行，暂不能做偏好前后对照')
  return notes.join('；') + (notes.length ? '。' : '')
})

// 每天订单量，用于给时间轴着色
const ordersPerDay = computed(() => days.value.map(day => {
  let n = 0
  for (let i = day.start; i < day.end; i += 1) if (scene.value.events[i].type === 'purchase') n += 1
  return n
}))
const maxOrders = computed(() => Math.max(1, ...ordersPerDay.value))
const dayHeat = (k) => (ordersPerDay.value[k] / maxOrders.value).toFixed(3)
const dayTitle = (day) => `${day.label}：${ordersPerDay.value[days.value.indexOf(day)]} 单${day.complete ? '' : '（记录不完整）'}`

const selected = computed(() => (selectedId.value ? index.value?.people.get(selectedId.value) : null))
const selectedFollowing = computed(() => followingEdges.value.filter(edge => edge.source === selectedId.value).map(edge => index.value?.people.get(edge.target)).filter(Boolean))
const selectedFollowers = computed(() => followingEdges.value.filter(edge => edge.target === selectedId.value).map(edge => index.value?.people.get(edge.source)).filter(Boolean))
const selectedHistory = computed(() => (selectedId.value ? personHistory(index.value, selectedId.value, cursor.value, 80) : []))
const selectedPurchases = computed(() => (selectedId.value ? personPurchases(index.value, selectedId.value, cursor.value) : {}))
const walkingNow = computed(() => { walkTick.value; return selectedId.value && campus.value?.isWalking(selectedId.value) })
const recentEvents = computed(() => {
  const list = []
  for (let i = cursor.value - 1; i >= 0 && list.length < 60; i -= 1) list.push(scene.value.events[i])
  return list
})
const cupsMap = computed(() => index.value ? cupsByPersonAt(index.value, cursor.value) : new Map())
const roster = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (scene.value?.people || []).filter(p => (!roleFilter.value || p.role === roleFilter.value)
    && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)))
})

const hoverRoles = computed(() => {
  const counts = {}
  for (const id of hoverCard.value?.residents || []) {
    const label = personOf(id).role_label
    counts[label] = (counts[label] || 0) + 1
  }
  return counts
})
const hoverStyle = computed(() => {
  const card = hoverCard.value
  const box = mapEl.value?.getBoundingClientRect()
  if (!card || !box) return {}
  // 卡片放在楼的侧面，不挡住楼内剖面：右侧放得下就放右侧，否则放左侧
  const width = 280
  const gap = 14
  const fitsRight = card.right + gap + width <= box.width - 12
  const left = fitsRight ? card.right + gap : Math.max(12, card.left - gap - width)
  const top = Math.min(Math.max(12, card.top), Math.max(12, box.height - 320))
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
})

const personOf = (id) => index.value.people.get(id)
const describe = (event) => (isDemo.value ? '【演示】' : '') + describeEvent(index.value, event)
const typeLabel = (type) => EVENT_LABELS[type] || type
const typeIcon = (type) => TYPE_ICONS[type] || 'fa-solid fa-circle'
const stageLabel = (stage) => STAGE_LABELS[stage] || stage
const dayLabel = (step) => (step === 0 ? '初始化' : `第 ${step} 天`)
const brandColor = (id) => brands.value.find(b => b.brand_id === id)?.color || '#666'
const brandName = (id) => brands.value.find(b => b.brand_id === id)?.product_name || id
const roleColor = (role) => ROLE_COLORS[role] || '#777'
const cupsOf = (id) => cupsMap.value.get(id) || {}
const buildingName = (person) => buildingNames.value.get(person.building_id) || index.value.locations.get(person.home_location_id)?.name || ''
const placeText = (person) => (person.indoor ? ` 在 ${buildingName(person)}` : ` 在自家门店`)

function selectPerson(id, focus = false) {
  selectedId.value = id
  activeTab.value = 'person'
  campus.value?.select(id)
  if (hasNewNetwork.value) campus.value?.showNetworkRelations(id)
  if (focus) campus.value?.focus(id)
}

// ---------- 播放 ----------
let frame = 0
let lastTime = 0

function animateRange(from, to) {
  const events = scene.value.events
  const begin = Math.max(from, to - MAX_ANIMATIONS_PER_FRAME)
  for (let i = from; i < begin; i += 1) {
    if (events[i].type === 'purchase') campus.value.addCup(events[i].actor, events[i].brand_id)
  }
  for (let i = begin; i < to; i += 1) campus.value.playEvent(events[i])
}

function loop(now) {
  if (!playing.value) return
  const dt = lastTime ? Math.min(100, now - lastTime) : 0
  lastTime = now
  const before = cursor.value
  const secondsPerDay = isDemo.value ? DEMO_SECONDS_PER_DAY : SECONDS_PER_DAY
  dayPos.value = Math.min(days.value.length, dayPos.value + (dt / 1000) * speed.value / secondsPerDay)
  if (cursor.value > before) animateRange(before, cursor.value)
  if (atEnd.value) { manualAnimation.value = isDemo.value; playing.value = false; return }
  frame = requestAnimationFrame(loop)
}

function togglePlay() {
  if (isNetwork.value || loading.value) return
  manualAnimation.value = false
  if (playing.value) { playing.value = false; cancelAnimationFrame(frame); return }
  if (atEnd.value) seek(0)
  playing.value = true
  lastTime = 0
  frame = requestAnimationFrame(loop)
}

function seek(position) {
  dayPos.value = Math.max(0, Math.min(days.value.length, position))
  campus.value?.clearFx()
  campus.value?.resetWalkers()
  campus.value?.setCups(cupsByPersonAt(index.value, cursor.value))
  manualAnimation.value = false
}

function seekDay(k) { seek(k) }

function jumpDay(delta) {
  const target = Math.floor(dayPos.value) + delta
  seek(delta < 0 && dayPos.value % 1 > 0 ? Math.floor(dayPos.value) : target)
}

function stepEvent(delta) {
  if (isNetwork.value || loading.value) return
  playing.value = false
  manualAnimation.value = isDemo.value
  const target = Math.min(scene.value.events.length, cursor.value + delta)
  const before = cursor.value
  const k = dayIndexAt(index.value, target)
  const day = days.value[k]
  const span = Math.max(1, day.end - day.start)
  dayPos.value = target >= scene.value.events.length ? days.value.length : k + Math.min(0.999999, (target - day.start + 0.5) / span)
  if (cursor.value > before) animateRange(before, cursor.value)
  const event = scene.value.events[target - 1]
  if (event) {
    const previousTab = activeTab.value
    selectPerson(event.actor, false)
    if (isDemo.value && previousTab === 'feed') activeTab.value = 'feed'
  }
}

watch(speed, (value) => campus.value?.setSpeed(value))
watch(walkMode, (value) => campus.value?.setWalkMode(value))
watch([playing, manualAnimation, isDemo], () => {
  campus.value?.setPlaybackPaused(isDemo.value && !playing.value && !manualAnimation.value)
})

// ---------- 图表 ----------
let chartTimer = 0
function renderChart() {
  if (!chart || !index.value || isNetwork.value) return
  const rows = dailySeries(index.value, cursor.value)
  chart.setOption({
    animationDuration: 300,
    grid: { left: 34, right: 10, top: 28, bottom: 20 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#4c5a52' } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: rows.map(r => (r.step === 0 ? '初' : String(r.step))), axisLabel: { fontSize: 10, color: '#7b8780' }, axisLine: { lineStyle: { color: '#d8d2c4' } }, axisTick: { show: false } },
    yAxis: { type: 'value', name: isDemo.value ? '演示杯/天' : '杯/天', minInterval: 1, nameTextStyle: { fontSize: 10, color: '#7b8780' }, axisLabel: { fontSize: 10, color: '#7b8780' }, splitLine: { lineStyle: { color: '#eee9de' } } },
    series: brands.value.map(brand => ({
      name: brand.product_name, type: 'bar', stack: 'cups', barMaxWidth: 16,
      itemStyle: { color: brand.color, borderRadius: [3, 3, 0, 0] },
      data: rows.map(r => r[brand.brand_id]),
    })),
  })
}
watch(cursor, () => {
  if (chartTimer || isNetwork.value || !index.value) return
  chartTimer = window.setTimeout(() => { chartTimer = 0; renderChart() }, 200)
})

// ---------- 生命周期 ----------
async function loadSourceSync() {
  try {
    const response = await fetch(publicUrl('mecoffe/sync-status.json'), { cache: 'no-store' })
    if (response.ok) sourceSync.value = await response.json()
  } catch {
    // 版本核对文件可选；缺失或格式无效时，现有运行仍可正常回放。
    sourceSync.value = null
  }
}

function destroyRenderedScene() {
  playing.value = false
  manualAnimation.value = false
  cancelAnimationFrame(frame)
  window.clearTimeout(chartTimer)
  chartTimer = 0
  chart?.dispose()
  chart = null
  campus.value?.destroy()
  campus.value = null
  if (import.meta.env.DEV) delete window.__mecoffeScene
}

async function loadScene(mode) {
  if (loading.value && index.value) return
  const generation = ++loadGeneration
  requestedMode.value = mode
  loading.value = true
  loadError.value = ''
  destroyRenderedScene()
  selectedId.value = null
  hoverCard.value = null
  activeTab.value = 'person'
  query.value = ''
  roleFilter.value = ''
  dayPos.value = 0
  index.value = null
  let view = null
  try {
    const filename = mode === 'demo' ? 'latest-demo.json' : mode === 'network' ? 'latest-network.json' : 'scene.json'
    const response = await fetch(publicUrl(`mecoffe/${filename}`), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (generation !== loadGeneration) return
    if (mode === 'network' && data.meta?.mode !== 'network_snapshot') throw new Error('新版网络数据类型不正确')
    if (mode === 'demo' && (data.meta?.mode !== 'network_demo' || data.meta?.illustrative !== true)) throw new Error('新版演示数据类型不正确')
    index.value = indexScene(data)
    await nextTick()
    if (generation !== loadGeneration) return
    view = new CampusScene({
      onSelect: (id) => selectPerson(id),
      onHoverBuilding: (info) => { hoverCard.value = info; walkTick.value += 1 },
    })
    await view.mount(mapEl.value, index.value)
    if (generation !== loadGeneration) { view.destroy(); return }
    view.setSpeed(speed.value)
    view.setWalkMode(!isNetwork.value && walkMode.value)
    campus.value = view
    view.setPlaybackPaused(isDemo.value)
    if (import.meta.env.DEV) window.__mecoffeScene = view
    if (!isNetwork.value && chartEl.value) {
      chart = echarts.init(chartEl.value)
      renderChart()
    }
    const firstActorId = isDemo.value ? scene.value.events.find(event => event.type === 'purchase')?.actor : null
    const firstConsumer = scene.value.people.find(p => p.role !== 'merchant')
    if (firstActorId || firstConsumer) selectPerson(firstActorId || firstConsumer.id)
    if (isDemo.value) {
      view.unpin()
      hoverCard.value = null
      activeTab.value = 'feed'
    }
  } catch (error) {
    if (generation !== loadGeneration) { view?.destroy(); return }
    view?.destroy()
    campus.value = null
    loadError.value = error.message || '无法挂载场景'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

onMounted(() => {
  document.title = 'MeCoffe 校园场景沙盘'
  void loadSourceSync()
  void loadScene('demo')
  window.addEventListener('resize', resizeChart)
})

function resizeChart() { chart?.resize() }

onBeforeUnmount(() => {
  loadGeneration += 1
  window.removeEventListener('resize', resizeChart)
  destroyRenderedScene()
})
</script>

<style scoped>
.mc-page {
  --ink: #1f2b25; --muted: #75817a; --line: #e7e1d4; --card: #ffffff; --bg: #f2efe7; --accent: #1f8a70;
  position: fixed; inset: 0; display: flex; flex-direction: column; gap: 10px;
  padding: 12px 16px; background: radial-gradient(circle at 0 0, #f8f5ee 0, var(--bg) 60%); color: var(--ink); overflow: hidden;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; text-align: left;
}
.mc-page i { font-style: normal; }
.mc-page button { font-family: inherit; cursor: pointer; }

.mc-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mc-brand { display: flex; align-items: center; gap: 12px; }
.mc-logo { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: #fff; font-size: 20px;
  background: linear-gradient(135deg, #1f8a70, #2f6fb3); box-shadow: 0 6px 16px rgba(31,138,112,0.3); }
.mc-brand h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
.mc-brand p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.mc-brand code { font-size: 11px; background: #ece7dc; padding: 1px 5px; border-radius: 4px; }
.mc-brands { display: flex; gap: 8px; flex-wrap: wrap; }
.mc-mode { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: #e4e8df; }
.mc-mode button { padding: 5px 11px; border: 0; border-radius: 7px; background: transparent; color: #59665e; font-size: 12px; }
.mc-mode button.on { background: #fff; color: var(--accent); font-weight: 700; box-shadow: 0 1px 4px #23322a15; }
.mc-mode button:disabled { cursor: wait; opacity: .7; }
.mc-brand-chip { display: inline-flex; gap: 6px; align-items: center; border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 700;
  color: var(--c); background: color-mix(in srgb, var(--c) 12%, white); border: 1px solid color-mix(in srgb, var(--c) 35%, white); }
.mc-notice { display: flex; gap: 8px; align-items: center; background: #fff6df; border: 1px solid #f0d99a; color: #7a5a14; border-radius: 10px; padding: 7px 12px; font-size: 12.5px; }
.mc-demo-notice { display: flex; gap: 8px; align-items: center; flex-shrink: 0; padding: 7px 12px; border: 1px solid #b8d7db; border-radius: 10px; background: #eaf6f5; color: #276365; font-size: 12px; line-height: 1.5; }
.mc-demo-notice span { flex: 1; }
.mc-demo-notice a { color: #276365; white-space: nowrap; text-decoration: underline; }
.mc-source-sync { flex-shrink: 0; border: 1px solid #bfd7ed; border-radius: 10px; background: #edf5fc; color: #275779; font-size: 12px; overflow: auto; max-height: min(26vh, 190px); }
.mc-source-sync summary { padding: 7px 12px; cursor: pointer; line-height: 1.5; font-weight: 600; }
.mc-source-details { padding: 0 12px 9px; border-top: 1px solid #d5e5f3; }
.mc-source-details p { margin: 6px 0; line-height: 1.5; }
.mc-source-links { display: flex; flex-wrap: wrap; gap: 5px 14px; line-height: 1.5; }
.mc-source-links span { color: #5d768c; }
.mc-source-links a { color: #275779; text-decoration: underline; text-underline-offset: 2px; }
.mc-error, .mc-loading { margin: 40px auto; font-size: 15px; color: #8a3b2b; }
.mc-loading { color: var(--muted); }

.mc-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.mc-kpi { background: var(--card); border-radius: 14px; padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start; min-width: 0;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(60,50,30,0.05); border: 1px solid #efeadf; }
.mc-kpi-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; font-size: 15px;
  color: var(--k); background: color-mix(in srgb, var(--k) 13%, white); }
.mc-kpi-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.mc-kpi-body > span { font-size: 11.5px; color: var(--muted); }
.mc-kpi-body strong { font-size: 21px; line-height: 1.25; font-variant-numeric: tabular-nums; }
.mc-kpi-body strong small { font-size: 12px; color: var(--muted); font-weight: 500; }
.mc-kpi-body em { font-style: normal; font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-kpi-body em.warn { color: #b0731a; }
.mc-kpi-body em i { margin-right: 2px; }
.mc-share { display: flex; height: 5px; border-radius: 3px; overflow: hidden; background: #eee9de; margin: 3px 0 2px; }
.mc-share b { display: block; transition: flex 0.3s ease; }

.mc-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 350px; gap: 10px; }
.mc-map { position: relative; border-radius: 16px; overflow: hidden; background: #cfe0c3; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06), 0 4px 18px rgba(60,50,30,0.08); }
.mc-canvas { position: absolute; inset: 0; }
.mc-map-tools { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; align-items: center; }
.mc-icon-btn { width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,0.95); color: var(--ink);
  display: grid; place-items: center; font-size: 13px; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.mc-icon-btn:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.mc-toggle { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.95); border-radius: 10px; padding: 7px 12px 7px 8px; font-size: 12.5px;
  cursor: pointer; user-select: none; box-shadow: 0 2px 6px rgba(0,0,0,0.06); border: 1px solid var(--line); }
.mc-toggle input { display: none; }
.mc-toggle .knob { width: 30px; height: 17px; border-radius: 9px; background: #cfc8b8; position: relative; transition: background 0.2s; }
.mc-toggle .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
.mc-toggle.on .knob { background: var(--accent); }
.mc-toggle.on .knob::after { transform: translateX(13px); }
.mc-map-legend { position: absolute; left: 12px; bottom: 12px; background: rgba(255,255,255,0.94); backdrop-filter: blur(4px); border-radius: 12px; padding: 8px 12px;
  font-size: 11.5px; display: flex; flex-wrap: wrap; gap: 4px 14px; max-width: 560px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
.mc-map-legend span { display: inline-flex; gap: 5px; align-items: center; }
.mc-map-legend p { margin: 2px 0 0; width: 100%; color: var(--muted); font-size: 11px; }

.mc-hover { position: absolute; z-index: 5; background: rgba(255,255,255,0.98); border-radius: 14px; padding: 10px 12px 8px;
  box-shadow: 0 10px 30px rgba(30,40,30,0.18); border: 1px solid #ece6d9; font-size: 12px; }
.mc-hover-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.mc-hover-head strong { display: block; font-size: 14px; }
.mc-hover-head span { color: var(--muted); font-size: 11px; }
.mc-hover-count { color: var(--muted); white-space: nowrap; font-size: 11.5px; }
.mc-hover-count b { color: var(--ink); font-size: 14px; }
.mc-hover-close { border: 0; background: #f1ede4; width: 22px; height: 22px; border-radius: 7px; color: var(--muted); flex-shrink: 0; }
.mc-hover-close:hover { background: #e6e0d2; color: var(--ink); }
.mc-hover-roles { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.mc-hover-roles span { background: #f3efe6; border-radius: 6px; padding: 1px 7px; font-size: 11px; color: #56625b; }
.mc-hover-list { list-style: none; margin: 0; padding: 0; max-height: 190px; overflow-y: auto; }
.mc-hover-list li { display: grid; grid-template-columns: 8px 1fr auto auto; gap: 7px; align-items: center; padding: 3px 4px; border-radius: 6px; cursor: pointer; }
.mc-hover-list li:hover, .mc-hover-list li.on { background: #f1ede3; }
.mc-hover-list li.away .name { color: var(--muted); }
.mc-hover-list .status { color: #b0731a; font-size: 11px; }
.mc-pop-enter-active, .mc-pop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.mc-pop-enter-from, .mc-pop-leave-to { opacity: 0; transform: translateY(4px); }

.mc-side { background: var(--card); border-radius: 16px; display: flex; flex-direction: column; min-height: 0; box-shadow: 0 4px 18px rgba(60,50,30,0.06); border: 1px solid #efeadf; }
.mc-tabs { display: flex; padding: 6px; gap: 4px; border-bottom: 1px solid var(--line); }
.mc-tabs button { flex: 1; border: 0; background: none; padding: 7px 0; font-size: 13px; color: var(--muted); border-radius: 9px; display: flex; gap: 6px; justify-content: center; align-items: center; }
.mc-tabs button:hover { background: #f5f2ea; }
.mc-tabs button.on { color: #fff; background: var(--accent); font-weight: 700; }
.mc-pane { flex: 1; overflow-y: auto; padding: 12px; font-size: 12.5px; }
.mc-empty { color: #8a948e; padding: 12px 0; list-style: none; display: flex; gap: 8px; align-items: center; }
.mc-person-card { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 12px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 16%, white), #fff); border: 1px solid color-mix(in srgb, var(--rc) 25%, white); }
.mc-avatar { width: 46px; height: 46px; border-radius: 14px; color: #fff; display: grid; place-items: center; font-size: 20px; font-weight: 700; flex-shrink: 0; background: var(--rc); box-shadow: 0 4px 10px color-mix(in srgb, var(--rc) 40%, transparent); }
.mc-person-main h2 { margin: 0; font-size: 17px; }
.mc-person-main p { margin: 3px 0; color: #56625b; }
.mc-person-main code { font-size: 10.5px; color: #8a948e; }
.mc-role-chip { background: var(--rc); color: #fff; border-radius: 5px; padding: 0 6px; margin-right: 4px; font-size: 11px; }
.mc-live { margin-top: 8px; background: #fff3d9; color: #9a6514; border-radius: 8px; padding: 5px 10px; display: flex; gap: 6px; align-items: center; animation: mc-pulse 1.4s ease-in-out infinite; }
@keyframes mc-pulse { 50% { opacity: 0.6; } }
.mc-bio { color: #3d4a43; line-height: 1.6; margin: 10px 2px; }
.mc-profile { display: grid; grid-template-columns: 86px 1fr; gap: 6px 8px; margin: 0 0 10px; background: #faf8f3; border-radius: 10px; padding: 10px; }
.mc-profile dt { color: var(--muted); display: flex; gap: 5px; align-items: baseline; }
.mc-profile dt i { width: 12px; color: #a69d88; font-size: 11px; }
.mc-profile dd { margin: 0; line-height: 1.5; }
.mc-profile .muted { color: var(--muted); }
.mc-tag { border: 1px solid var(--c); color: var(--c); border-radius: 6px; padding: 0 6px; margin-right: 4px; font-weight: 700; }
.mc-pane h3 { font-size: 13px; margin: 12px 0 6px; display: flex; gap: 6px; align-items: baseline; }
.mc-pane h3 small { color: var(--muted); font-weight: 400; font-size: 11px; }
.mc-relation-list { display: flex; flex-wrap: wrap; gap: 5px; }
.mc-relations { margin: 10px 0; border-top: 1px solid #e8e4da; padding-top: 8px; }
.mc-relations > summary { cursor: pointer; color: #4b7568; font-size: 12px; font-weight: 600; }
.mc-relation-list button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #e3e7df; padding: 5px 7px; border-radius: 7px; background: #f6f9f3; color: var(--ink); font-size: 12px; }
.mc-relation-list button:hover { border-color: var(--accent); background: #eef6ef; }
.mc-relation-list small { color: var(--muted); font-size: 10px; }
.mc-network-note { color: var(--muted); line-height: 1.6; font-size: 11px; }
.mc-network-footer { display: flex; align-items: center; gap: 9px; padding: 10px 14px; flex-shrink: 0; border-radius: 12px; border: 1px solid #cbded0; background: #f2f9f3; color: #36634c; font-size: 12px; }
.mc-network-footer a { margin-left: auto; white-space: nowrap; color: #36634c; }
.mc-feed { list-style: none; margin: 0; padding: 0; }
.mc-feed li { padding: 7px 8px; border-radius: 10px; margin-bottom: 4px; display: flex; gap: 9px; align-items: flex-start; background: #faf8f3; border-left: 3px solid #ddd5c4; }
.mc-feed li.clickable { cursor: pointer; }
.mc-feed li.clickable:hover { background: #f3efe5; }
.mc-feed li > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mc-feed-icon { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; font-size: 11px; flex-shrink: 0; color: #fff; background: #9aa39e; }
.mc-when { font-size: 11px; color: #8a948e; }
.mc-what { line-height: 1.5; word-break: break-all; }
.t-purchase { border-left-color: #1f8a70 !important; } .t-purchase .mc-feed-icon { background: #1f8a70; }
.t-post { border-left-color: #3d6fb6 !important; } .t-post .mc-feed-icon { background: #3d6fb6; }
.t-comment { border-left-color: #8a5bd1 !important; } .t-comment .mc-feed-icon { background: #8a5bd1; }
.t-ad, .t-exposure { border-left-color: #d99a1b !important; } .t-ad .mc-feed-icon, .t-exposure .mc-feed-icon { background: #d99a1b; }
.t-interview { border-left-color: #e0a21b !important; } .t-interview .mc-feed-icon { background: #e0a21b; }
.t-failed { border-left-color: #d64545 !important; } .t-failed .mc-feed-icon { background: #d64545; }
.t-follow .mc-feed-icon { background: #7d8783; }
.mc-filter { display: flex; gap: 6px; margin-bottom: 10px; }
.mc-search { flex: 1; display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 9px; padding: 0 9px; color: #a69d88; }
.mc-search input { border: 0; outline: none; flex: 1; min-width: 0; padding: 7px 0; font-size: 12.5px; background: none; }
.mc-filter select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 9px; font-size: 12.5px; background: #fff; }
.mc-roster { list-style: none; margin: 0; padding: 0; }
.mc-roster li { display: grid; grid-template-columns: 8px auto 1fr auto; gap: 8px; align-items: center; padding: 6px 6px; border-radius: 8px; cursor: pointer; }
.mc-roster li:hover, .mc-roster li.on { background: #f3efe5; }
.mc-roster .where { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-dot { width: 8px; height: 8px; border-radius: 50%; }
.cups i { font-style: normal; font-size: 10.5px; color: #fff; border-radius: 6px; padding: 0 5px; margin-left: 3px; }

.mc-footer { background: var(--card); border-radius: 16px; padding: 10px 14px; display: grid; grid-template-columns: minmax(0, 1fr) 400px; grid-template-rows: auto auto; gap: 6px 16px;
  box-shadow: 0 4px 18px rgba(60,50,30,0.06); border: 1px solid #efeadf; }
.mc-transport { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
.mc-play { display: inline-flex; gap: 8px; align-items: center; border: 0; border-radius: 11px; padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #1f8a70, #2a9d7f); box-shadow: 0 4px 12px rgba(31,138,112,0.3); min-width: 96px; justify-content: center; transition: transform 0.15s; }
.mc-play:hover { transform: translateY(-1px); }
.mc-speed { display: inline-flex; background: #f1ede4; border-radius: 9px; padding: 3px; }
.mc-speed button { border: 0; background: none; padding: 4px 9px; border-radius: 7px; font-size: 12px; color: var(--muted); }
.mc-speed button.on { background: #fff; color: var(--ink); font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.mc-progress { margin-left: auto; color: var(--muted); font-size: 11.5px; }
.mc-progress b { color: var(--ink); }
.mc-timeline { grid-column: 1; display: flex; flex-direction: column; gap: 6px; }
.mc-track { height: 4px; border-radius: 2px; background: #ece7dc; overflow: hidden; }
.mc-track-fill { height: 100%; background: linear-gradient(90deg, #1f8a70, #2f6fb3); transition: width 0.1s linear; }
.mc-days { display: flex; gap: 3px; }
.mc-days button { flex: 1; min-width: 0; border: 0; border-radius: 6px; padding: 5px 0; font-size: 10.5px; color: #4c5a52;
  background: color-mix(in srgb, #1f8a70 calc(var(--heat) * 55%), #f1ede4); transition: transform 0.1s; }
.mc-days button:hover { transform: translateY(-2px); }
.mc-days button.past { opacity: 0.75; }
.mc-days button.on { background: #24332b; color: #fff; font-weight: 700; opacity: 1; box-shadow: 0 3px 8px rgba(0,0,0,0.25); }
.mc-days button.partial { outline: 1px dashed #c9a14a; outline-offset: -2px; }
.mc-chart { grid-column: 2; grid-row: 1 / span 2; height: 112px; }

@media (max-width: 1100px) {
  .mc-page { overflow-y: auto; }
  .mc-header { flex-wrap: wrap; }
  .mc-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mc-main { flex: none; grid-template-columns: 1fr; }
  .mc-map { height: 60vh; min-height: 340px; }
  .mc-side { height: 440px; }
  .mc-footer { grid-template-columns: 1fr; }
  .mc-chart { grid-column: 1; grid-row: auto; height: 140px; }
  .mc-progress { margin-left: 0; width: 100%; }
}
</style>
