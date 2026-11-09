<template>
  <section class="live-panel" data-testid="live-panel" :data-mode="state.mode" :data-status="state.status" :data-paused="Boolean(state.paused)">
    <template v-if="state.mode!=='replay'">
      <div class="live-toolbar">
        <div><span class="live-status" :class="state.status">{{statusText}}</span><strong v-if="state.bootstrap">第 {{Math.max(1,state.activeStep||state.completedStep||1)}}/{{state.bootstrap.plan.runtime.num_steps}} 天</strong><span v-if="state.bootstrap" class="live-step">当前第 {{state.activeStep||0}} 步 · 已完成 <b data-testid="live-completed">{{state.completedStep||0}}</b> 天</span></div>
        <div class="live-actions" v-if="state.bootstrap"><button @click="$emit('pause',!state.paused)">{{state.paused?'继续观看':'暂停观看'}}</button><button @click="$emit('follow')">跟随最新进度</button></div>
      </div>
      <p class="live-message" :class="{warning:state.error||state.partial}" role="status">{{state.message}}<button v-if="state.error" @click="$emit('retry')">重新读取</button></p>
      <p v-if="state.paused" class="live-message">已暂停画面，不影响后台模拟；统计与数据仍会接收。</p>
      <template v-if="state.bootstrap">
        <div class="live-totals" aria-label="已确认日汇总"><span>已核实订单 <b data-testid="live-orders">{{state.summary.orders}}</b></span><span>销量 <b data-testid="live-quantity">{{state.summary.quantity}}</b></span><span>金额 ¥{{(state.summary.revenue_fen/100).toFixed(2)}}</span><span>发帖 <b data-testid="live-posts">{{state.summary.posts}}</b></span><span class="live-muted">日汇总确认后更新</span></div>
        <p v-if="state.evidenceWarning" class="live-message warning">{{state.evidenceWarning}}</p>
        <details class="live-feed" data-testid="live-feed" open><summary>决策快报 <small>{{state.events.length}} 条 · 被拒 {{state.summary.declined}} · 结果未知 {{state.summary.unknown}}</small></summary><div class="live-cards"><article v-for="event in recent" :key="event.key" :data-live-event="event.key" :data-evidence="event.evidence_status" :data-outcome="event.outcome"><span>{{personName(event.actor)}} · 第 {{event.step}} 天</span><b>{{eventLabel(event)}}</b><p v-if="event.text">{{event.text}}</p><small v-if="event.message">{{event.message}}</small></article><p v-if="!recent.length" class="live-muted">等待已完成决策的活动；查询与刷新不播放动画。</p></div></details>
      </template>
    </template>
    <p v-else class="live-message" :class="{warning:state.differences?.length||state.partial}" role="status" data-testid="live-terminal">{{state.partial?'运行失败 · 已切换部分正式回放':'已切换正式回放，冻结版本校验通过'}}<span v-if="state.differences?.length">；实时累计与正式记录有差异，以正式回放为准：{{differenceText}}</span><span v-else>；{{state.bootstrap?'实时累计核对一致':'已读取终态产物'}}。</span></p>
  </section>
</template>
<script setup>
import {computed} from 'vue'
import {actionLabel} from '../mecoffe/eventPresentation.js'
const props=defineProps({state:{type:Object,required:true}})
defineEmits(['pause','follow','retry'])
const statusText=computed(()=>({queued:'排队中',initializing:'初始化中',running:'运行中',failed:'运行失败 · 部分结果',cancelled:'运行停止 · 部分结果',completed:'正在准备正式回放',unavailable:'需要重新登录'}[props.state.status]||'正在读取'))
const recent=computed(()=>(props.state.events||[]).slice(-6).reverse())
const personName=id=>props.state.bootstrap?.snapshot.nodes.find(p=>p.entity_id===id)?.name||id
function eventLabel(event){
  if(event.action==='purchase_product'&&event.outcome==='executed')return event.evidence_status==='verified'?'购买已核实':event.evidence_status==='unverified'?'订单未核实':'尝试购买 · 订单待核对'
  const suffix={declined:'被拒绝',failed:'执行失败',unknown:'结果未知',noop:'无操作'}[event.outcome]
  return actionLabel(event.action)+(suffix?' · '+suffix:'')
}
const differenceText=computed(()=>(props.state.differences||[]).map(d=>`${({orders:'订单',quantity:'销量',revenue_fen:'金额（分）',posts:'发帖',comments:'评论'})[d.field]||d.field} ${d.live}→${d.official}`).join('，'))
</script>
<style scoped>
.live-panel{flex-shrink:0;background:#fffdfa;border-bottom:1px solid #d4dfd7;padding:8px 18px;color:#294c45;font:12px/1.5 'Microsoft YaHei',sans-serif;min-height:0;max-height:38%;overflow:auto}.live-toolbar,.live-toolbar>div,.live-actions,.live-totals{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.live-toolbar{justify-content:space-between}.live-status{padding:2px 8px;border-radius:20px;background:#e7eee9;color:#406e5e;font-weight:700}.live-status.running{background:#dceee8;color:#17715f}.live-status.failed,.live-status.cancelled{background:#fae7dc;color:#96542e}.live-step,.live-muted{color:#77877f;font-size:11px}.live-message{margin:4px 0;font-size:11px;color:#55766c}.live-message.warning{color:#935b29}.live-message button{margin-left:12px}.live-panel button{border:1px solid #c6d8cd;border-radius:6px;padding:4px 10px;background:#f3f7f2;color:#286c58;font:inherit;cursor:pointer}.live-totals{gap:16px;margin:5px 0}.live-totals b{font-size:15px;margin-left:4px}.live-feed summary{cursor:pointer;font-weight:600;font-size:11px}.live-feed summary small{font-weight:400;color:#7c8d84;margin-left:8px}.live-cards{display:flex;gap:8px;overflow:auto;max-height:90px;padding:5px 0 2px}.live-cards article{flex:0 0 230px;border:1px solid #dde6df;border-radius:7px;padding:5px 9px;background:#f8faf6;max-height:76px;overflow:auto}.live-cards article[data-evidence=pending],.live-cards article[data-evidence=unverified]{background:#fff7e8;border-color:#e7d5ad}.live-cards article[data-evidence=verified]{background:#e9f4ef;border-color:#b7d9ca}.live-cards article span,.live-cards article small{display:block;font-size:10px;color:#778c80}.live-cards b{font-size:11px}.live-cards p{margin:3px 0;max-width:42em;overflow-wrap:anywhere;font-size:11px}
@media(max-width:900px),(max-height:650px){.live-panel{padding:5px 10px;max-height:34%}.live-toolbar,.live-toolbar>div{gap:5px}.live-panel button{padding:3px 7px}.live-totals{gap:8px}.live-totals b{font-size:13px}.live-cards{max-height:64px}.live-step{display:none}}
</style>
