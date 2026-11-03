<template>
  <div class="map-preview-page"><header><div><p>MAP → ASSET CATALOG → 3D</p><h1>{{campus?.title || '通用地图建模预览'}}</h1></div><nav><RouterLink to="/mecoffe3d/assets">素材库</RouterLink><RouterLink to="/mecoffe3d">中科大回放</RouterLink><button @click="renderer?.resetCamera()">全景</button></nav></header>
    <p class="notice" data-testid="map-preview-notice">{{campusId === 'nus' ? 'NUS 仅用于验证建模流水线，没有模拟数据。' : '此地图仅用于验证建模流水线，没有模拟数据。'}}{{campus?.source?.license === 'ODbL-1.0' ? '楼栋与道路来自 OpenStreetMap；' : '地图来源见输入文件的许可记录；'}}缺失高度采用明确的展示默认值。</p>
    <div v-if="error" role="alert">{{error}}</div><div class="model-layout"><main ref="host" aria-label="通用地图三维模型"></main><aside v-if="campus"><h2>建模结果</h2><dl><dt>楼栋</dt><dd>{{summary.buildings}}</dd><dt>道路分段</dt><dd>{{summary.roads}}</dd><dt>原型分配记录</dt><dd>{{summary.assignments}}</dd><dt>默认高度楼栋</dt><dd>{{campus.stats.default_height_buildings}}</dd></dl><p>未加载 MeCoffe 人物、订单、回放或地点映射。</p><h2>选择楼栋查看</h2><template v-if="selected"><b>{{selected.building.name}}</b><p>{{selected.building.osm_id}}</p><p>{{selected.assignment?.prototype_id}}</p><p>{{selected.building.height_m}} 米 · {{selected.building.height_source}}</p><p>{{selected.assignment?.reason?.join('；')}}</p></template><p v-else>拖动旋转、滚轮缩放，点击楼栋查看原型与高度来源。</p><details><summary>来源与许可</summary><p>{{campus.source.source_url}}</p><p>{{campus.source.downloaded_at_utc}}</p><code>{{campus.source.sha256}}</code><p>{{campus.source.attribution}} · {{campus.source.license}}</p></details></aside></div>
    <footer><a v-if="campus?.source?.license === 'ODbL-1.0'" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a><span v-else>{{campus?.source?.attribution || '调用方提供的地图'}}</span> · 通用流水线预览，不生成智能体行为</footer></div>
</template>
<script setup>
import {onMounted,onBeforeUnmount,ref,shallowRef} from 'vue'
import {RouterLink} from 'vue-router'
import {MapSceneRenderer,previewMapSummary} from '../mecoffe/MapSceneRenderer.js'
const props=defineProps({campusId:{type:String,required:true}})
const host=ref(null),campus=shallowRef(null),summary=ref({}),selected=shallowRef(null),error=ref('');let renderer=null,disposed=false
const controller=new AbortController()
onMounted(async()=>{try{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(props.campusId))throw new Error('校区 ID 无效')
  const base=`${import.meta.env.BASE_URL}mecoffe/campuses/${props.campusId}/`
  const [data,assignments]=await Promise.all(['campus3d.json','asset_assignments.json'].map(async name=>{const response=await fetch(base+name,{signal:controller.signal});if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);return response.json()}))
  if(disposed)return;campus.value=data;summary.value=previewMapSummary(data,assignments);document.title=`${data.title} · 建模流水线预览`
  renderer=new MapSceneRenderer({host:host.value,campus:data,assignments,onSelect:value=>{selected.value=value}}).init()
}catch(e){if(e.name!=='AbortError')error.value=e.message||String(e)}})
onBeforeUnmount(()=>{disposed=true;controller.abort();renderer?.dispose()})
</script>
<style scoped>
.map-preview-page{position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;padding:24px;background:#edf2ec;color:#244b46;font-family:'Microsoft YaHei',sans-serif;text-align:left}header{display:flex;justify-content:space-between;align-items:center}header p{font-size:11px;letter-spacing:2px;margin:0;color:#6f8c7d}h1{font-size:24px;margin:7px 0}nav{display:flex;gap:16px;align-items:center}a{color:#277b68}button{padding:8px 16px;background:#fff;border:1px solid #cbd9cb;border-radius:6px;color:#244b46}.notice{padding:12px 16px;margin:0;background:#fff7db;border:1px solid #e5d596;border-radius:8px;font-size:13px}.model-layout{display:flex;gap:16px;min-height:0;flex:1}main{position:relative;flex:1;min-width:0;overflow:hidden;border:1px solid #d2dfd1;border-radius:12px}aside{width:280px;overflow:auto;padding:20px;background:#fff;border-radius:12px;font-size:12px;line-height:1.8}h2{font-size:15px;margin:0 0 14px}dl{display:grid;grid-template-columns:1fr auto;gap:8px}dd{margin:0;font-weight:700}code{overflow-wrap:anywhere;font-size:10px}footer{font-size:11px;color:#6c8879}@media(max-width:800px){aside{width:200px}.map-preview-page{padding:12px}header{align-items:flex-start}h1{font-size:18px}}
</style>
