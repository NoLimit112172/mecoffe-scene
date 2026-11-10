<template>
  <details v-if="result" class="scene-placement-details" data-testid="scene-placement-details">
    <summary>安置与依据 · 场外 {{outside.length}} 人 · 服务点 {{result.service_points.length}} 个 · 位置为示意</summary>
    <div class="placement-body">
    <p data-testid="scene-outside">场景外 {{outside.length}} 人，仍计入总人数，不在地图生成位置。</p>
    <div class="placement-grid">
      <article v-for="a in result.assignments" :key="a.entity_id" :data-assignment-person="a.entity_id" :data-building="a.building_id||''" :data-entrance="a.entrance_id||''" :data-placement-status="a.status">
        <b>{{names.get(a.entity_id)||a.entity_id}} · {{a.status==='out_of_scene'?'场景外':a.building_id}}（示意）</b><p>安置理由：{{a.reason}}</p><small v-for="(e,i) in a.evidence" :key="i">证据来源 {{sceneEvidenceLabel(e.source)}} · {{e.key}}={{e.value}} · {{e.ref}}</small>
      </article>
      <article v-for="s in result.service_points" :key="s.service_id" :data-service-brand="s.brand_id" :data-building="s.building_id||''" :data-entrance="s.entrance_id||''" :data-placement-status="s.status">
        <b>{{s.brand_name}} · {{s.status==='out_of_scene'?'服务点在场景外':s.building_id}}（示意）</b><p>安置理由：{{s.reason}}</p><small v-for="(e,i) in s.evidence" :key="i">证据来源 {{sceneEvidenceLabel(e.source)}} · {{e.key}}={{e.value}} · {{e.ref}}</small>
      </article>
    </div>
    <p v-for="(a,i) in result.assumptions" :key="i" style="white-space:pre-wrap">{{a}}</p>
    </div>
  </details>
</template>
<script setup>
import {computed} from 'vue'
import {sceneEvidenceLabel} from '../mecoffe/sceneLabels.js'
const props=defineProps({result:{type:Object,default:null},people:{type:Array,default:()=>[]}})
const outside=computed(()=>props.result?.assignments.filter(a=>a.status==='out_of_scene')||[])
const names=computed(()=>new Map(props.people.map(p=>[p.id||p.entity_id,p.name])))
</script>
<style scoped>.scene-placement-details{position:relative;height:34px;min-height:34px;box-sizing:border-box;background:#f5faf7;border:1px solid #cdded3;padding:0 10px;color:#315b4b;font:12px/1.6 sans-serif;flex-shrink:0;z-index:35}.scene-placement-details summary{cursor:pointer;font-weight:600;line-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.placement-body{position:absolute;top:100%;left:-1px;right:-1px;max-height:min(45vh,420px);overflow:auto;padding:10px;background:#f5faf7;border:1px solid #cdded3;box-shadow:0 10px 22px #163c3429}.placement-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.placement-grid article{padding:8px;background:white;border:1px solid #dce7df;overflow-wrap:anywhere}.placement-grid small{display:block}.placement-grid p{margin:4px 0}</style>
