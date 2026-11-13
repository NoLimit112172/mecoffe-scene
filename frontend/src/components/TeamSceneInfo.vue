<template>
  <section class="team-scene-info" :data-testid="kind==='none'?'team-scene-none':'team-scene-blocked'">
    <header><p>人物、关系与活动</p><h1>{{kind==='none'?'这份配置未启用地图':'这份配置的地图暂不可用'}}</h1></header>
    <div class="scene-info-notice" :role="kind==='blocked'?'alert':'note'">
      <strong>{{kind==='none'?'无地图展示':stageLabel}}</strong><p>{{message}}</p>
      <p>保留能够核实的人物与活动记录，不生成地图位置或行走路线。</p>
      <button v-if="kind==='blocked'" type="button" @click="$emit('retry')">重新读取</button>
    </div>
    <dl class="scene-info-metrics"><div><dt>人物</dt><dd>{{hasPeople?`${people.length} 人`:'待取得'}}</dd></div><div><dt>关系</dt><dd>{{hasRelationships?`${relationships.length} 条`:'待取得'}}</dd></div><div><dt>事件</dt><dd>{{activityUnavailable?'待核实':`${events.length} 条`}}</dd></div><div><dt>已核实订单</dt><dd>{{activityUnavailable?'待核实':`${summary.orders||0} 笔`}}</dd></div></dl>
    <div class="scene-info-columns">
      <section class="scene-info-card"><h2>人物与角色</h2><ul><li v-for="person in people" :key="person.id"><strong>{{person.name}}</strong><span>{{person.roleLabel}}</span><details><summary>人物详情</summary><p>{{person.roleDescription||'暂无角色说明'}}</p><code>{{person.id}} · {{person.role}}</code></details></li></ul><p v-if="!people.length">暂未取得人物快照。</p></section>
      <section class="scene-info-card"><h2>人物关系</h2><ul><li v-for="(edge,index) in relationships" :key="index" class="scene-info-relation"><strong>{{personName(edge.source)}}</strong><span>{{sceneRelationLabel(edge.relation)}}</span><strong>{{personName(edge.target)}}</strong></li></ul><p v-if="!relationships.length">{{hasRelationships?'暂无人物关系。':'暂未取得关系数据。'}}</p></section>
    </div>
    <section class="scene-info-card"><h2>事件记录</h2>
      <article v-for="(event,index) in events" :key="event.key||event.id||index" class="scene-info-event" :data-team-event="event.key||event.id||index" :data-event-outcome="event.outcome||event.type">
        <small>第 {{event.step||0}} 步 · {{eventTypeLabel(event)}}</small><p>{{describeEvent(displayIndex,event)}}</p><EventResultDetails :event="event"/>
      </article>
      <p v-if="!events.length">{{activityUnavailable?'活动证据未通过校验，暂不展示。':mode==='config'?'配置预览，尚未运行模拟。':'暂未收到活动记录。'}}</p>
    </section>
    <section class="scene-info-card"><h2>订单记录</h2><p class="scene-info-muted">仅核实成功的订单计入统计；待核对、被拒绝和失败记录仍保留。</p>
      <article v-for="(event,index) in orders" :key="event.key||event.id||index" class="scene-info-order" :data-team-order="event.key||event.id||index">
        <strong>{{personName(event.actor)}} · {{brandName(event.brand_id,event.product_name)}}</strong>
        <p>{{sceneOutcomeLabel(event.outcome,event.evidence_status)}}<template v-if="verified(event)"> · 数量 {{event.quantity||1}} · 金额 ¥{{((event.amount_fen||0)/100).toFixed(2)}}</template></p>
        <EventResultDetails :event="event"/>
        <details><summary>订单标识与原始结果</summary><code>{{event.order_id||'暂无订单标识'}}</code><pre>{{JSON.stringify(event.raw_result??null,null,2)}}</pre></details>
      </article>
      <p v-if="!orders.length">{{activityUnavailable?'订单证据未通过校验，暂不展示订单。':mode==='config'?'尚未运行模拟，没有订单。':'暂无订单活动。'}}</p>
    </section>
  </section>
</template>
<script setup>
import {computed} from 'vue'
import EventResultDetails from './EventResultDetails.vue'
import {scenePeopleLabels,sceneRelationLabel,sceneOutcomeLabel} from '../mecoffe/sceneLabels.js'
import {describeEvent,eventTypeLabel} from '../mecoffe/replay.js'
const props=defineProps({kind:{type:String,required:true},message:{type:String,default:''},stage:{type:Object,default:null},
  snapshot:{type:Object,default:null},populationRequest:{type:Object,default:()=>({})},events:{type:Array,default:()=>[]},
  summary:{type:Object,default:()=>({})},plan:{type:Object,default:null},mode:{type:String,default:'config'},activityUnavailable:{type:Boolean,default:false}})
defineEmits(['retry'])
const people=computed(()=>scenePeopleLabels(props.snapshot,props.populationRequest))
const hasPeople=computed(()=>Array.isArray(props.snapshot?.nodes))
const hasRelationships=computed(()=>Array.isArray(props.snapshot?.edges))
const relationships=computed(()=>props.snapshot?.edges||[])
const personIndex=computed(()=>new Map(people.value.map(person=>[person.id,person])))
const personName=id=>personIndex.value.get(typeof id==='string'?id:id?.entity_id)?.name||'未知人物'
const brands=computed(()=>(props.plan?.economy?.brands||[]).map(brand=>({...brand,
  brand_name:(props.plan?.economy?.products||[]).filter(product=>product.brand_id===brand.brand_id).map(product=>product.product_name).join('、')})))
const brandName=(id,product)=>brands.value.find(brand=>brand.brand_id===id)?.brand_name||product||'未提供商品名称'
const displayIndex=computed(()=>({people:personIndex.value,scene:{meta:{generic_replay:true,live_run:props.mode==='live'},brands:brands.value}}))
const orders=computed(()=>props.events.filter(event=>event.type==='purchase'||event.type==='purchase_pending'||event.action==='purchase_product'))
const verified=event=>event.type==='purchase'&&(!event.outcome||event.outcome==='executed')
const stageLabel=computed(()=>({pending:'地图阶段等待中',running:'地图阶段正在生成',failed:'地图阶段失败',completed:'地图结果校验未通过'})[props.stage?.status]||'地图结果不可用')
</script>
<style scoped>
.team-scene-info{flex:1;min-height:0;overflow:auto;padding:clamp(16px,3vw,28px);font:14px/1.7 'Microsoft YaHei',sans-serif;color:#294c42}.team-scene-info>header{margin-bottom:16px}.team-scene-info>header>p{font-size:12px;color:#658174;margin:0}.team-scene-info h1{font-size:23px;margin:2px 0}.scene-info-notice{border:1px solid #d4e1d5;background:#f8fbf6;border-radius:10px;padding:14px 18px}.scene-info-notice[role=alert]{background:#fff8ed;border-color:#e8d8b8}.scene-info-notice p{margin:4px 0}.scene-info-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.scene-info-metrics>div,.scene-info-card{background:white;border:1px solid #d7e2d8;border-radius:10px;padding:14px}.scene-info-metrics dt{font-size:12px;color:#6d8277}.scene-info-metrics dd{font-size:21px;margin:3px 0 0;font-weight:600}.scene-info-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.scene-info-card{margin-bottom:14px;min-width:0}.scene-info-card h2{font-size:15px;margin:0 0 10px}.scene-info-card ul{list-style:none;padding:0;margin:0}.scene-info-card li,.scene-info-event,.scene-info-order{padding:9px 0;border-bottom:1px solid #edf1eb}.scene-info-card li>span{margin-left:10px;color:#668174}.scene-info-card details,.scene-info-event>small,.scene-info-muted{font-size:12px;color:#6a8073}.scene-info-card p{margin:4px 0}.scene-info-relation{display:flex;gap:8px;flex-wrap:wrap}.scene-info-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}.scene-info-card code{overflow-wrap:anywhere}@media(max-width:650px){.scene-info-columns{grid-template-columns:1fr;gap:0}.scene-info-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.team-scene-info h1{font-size:20px}}
</style>
<style scoped>.scene-info-notice button{margin-top:8px;padding:7px 12px;border:1px solid #c6d8c7;border-radius:6px;background:#fff;color:#315f4c;font:inherit;cursor:pointer}</style>
