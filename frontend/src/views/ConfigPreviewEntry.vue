<template>
  <div class="config-preview" data-testid="config-preview" :data-people="scene?.files['trajectory.json'].people.length || 0" :data-edges="scene?.files['trajectory.json'].relationships.length || 0">
    <header class="preview-bar">
      <div><strong>配置预览 · 尚未运行模拟</strong><p>楼栋安置为展示示意。事件 0 · 订单 0<span v-if="scene"> · 关系 {{scene.files['trajectory.json'].relationships.length}} 条</span></p></div>
      <RouterLink :to="{path:view==='gis'?'/mecoffe3d':'/mecoffe-gis',query:sourceQuery}">{{view==='gis'?'三维沙盘':'GIS 地图'}} ↗</RouterLink>
    </header>
    <form v-if="local" class="upload-bar" @submit.prevent="useFiles">
      <label>人物关系文件<input aria-label="人物关系文件" type="file" :disabled="loading" accept=".json,application/json" @change="pickFile($event,'network')"/></label>
      <label>角色字段文件<input aria-label="角色字段文件" type="file" :disabled="loading" accept=".json,application/json" @change="pickFile($event,'roles')"/></label>
      <label>楼栋安置规则（可选）<input aria-label="楼栋安置规则" type="file" :disabled="loading" accept=".json,application/json" @change="pickFile($event,'placement')"/></label>
      <button :disabled="loading || !uploads.network || !uploads.roles">加载配置</button>
      <small>支持 snapshot.json 与 preparation.json，或两个阶段的接口响应。文件仅在本标签页内存中使用。</small>
    </form>
    <div v-if="error" class="preview-message" role="alert" data-testid="config-preview-error"><h1>配置预览暂不可用</h1><p>{{error}}</p><button v-if="!local" @click="load">重新读取配置</button></div>
    <p v-else-if="loading" class="preview-message" role="status">正在读取配置与校园地图…</p>
    <template v-else-if="scene"><MeCoffeGis v-if="view==='gis'" :key="revision" :preview-scenario="scene"/><MeCoffe3D v-else :key="revision" :scenario="scene"/></template>
    <p v-else class="preview-message">选择人物关系文件与角色字段文件，然后加载配置。</p>
  </div>
</template>
<script setup>
import {computed,defineAsyncComponent,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {RouterLink,useRoute} from 'vue-router'
import {loadConfigPreview,normalizeConfigPreview,buildConfigPreviewScenario} from '../mecoffe/configPreview.js'
import {loadConfigMap} from '../mecoffe/configMap.js'
import {localPreviewInput,rememberLocalPreview,previewQuery} from '../mecoffe/configPreviewStore.js'
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
const props=defineProps({view:{type:String,default:'three'}}),route=useRoute()
const local=computed(()=>route.query.preview==='local'),sourceQuery=computed(()=>previewQuery(route.query))
const scene=shallowRef(null),error=ref(''),loading=ref(false),revision=ref(0),uploads=ref({network:null,roles:null})
let controller=null,generation=0
function pickFile(event,key){uploads.value={...uploads.value,[key]:event.target.files?.[0]||null}}
async function useFiles(){
  const files={...uploads.value}
  const token=++generation;controller?.abort();rememberLocalPreview(null)
  scene.value=null;error.value='';loading.value=true
  try {
    const [network,roles]=await Promise.all(['network','roles'].map(async key=>JSON.parse(await files[key].text())))
    if(token!==generation)return
    const input=normalizeConfigPreview({network,roles})
    input.placementRules=files.placement?JSON.parse(await files.placement.text()):{}
    if(token!==generation)return
    rememberLocalPreview(input)
    await load(input)
  } catch(e) {if(token!==generation)return;error.value=e instanceof SyntaxError?'配置文件不是有效 JSON，请检查后重试':e.message;loading.value=false}
}
async function load(provided){
  const token=++generation;controller?.abort();controller=new AbortController();scene.value=null;error.value=''
  const cached=local.value?(provided?.snapshot?provided:localPreviewInput()):null
  if(local.value&&!cached){loading.value=false;return}
  loading.value=true
  try {
    const signal=controller.signal
    const input=cached || await loadConfigPreview({session:route.query.session,config:route.query.config,signal})
    const map=await loadConfigMap({signal})
    if(token!==generation)return
    scene.value=buildConfigPreviewScenario(input,map,input.placementRules || {})
    revision.value++
  } catch(e) {if(e.name!=='AbortError'&&token===generation)error.value=e.message}
  finally {if(token===generation)loading.value=false}
}
watch(()=>[route.query.session,route.query.config,route.query.preview],()=>load(),{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<style scoped>
.config-preview{height:100vh;display:flex;flex-direction:column;overflow:auto;background:#f0f4ee;min-height:100vh;color:#24453f}.preview-bar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 22px;background:#e6f1ed;border-bottom:1px solid #c7dbd3}.preview-bar strong{font-size:16px}.preview-bar p{margin:5px 0 0;font-size:12px;color:#50746b}.preview-bar a{color:#167967;font-weight:600;white-space:nowrap}.upload-bar{flex-shrink:0;display:flex;align-items:end;gap:15px;flex-wrap:wrap;padding:12px 22px;background:white;border-bottom:1px solid #d6e2dc}.upload-bar label{display:grid;gap:6px;font-size:12px}.upload-bar input{max-width:260px}.upload-bar small{color:#6c8079;font-size:11px}.upload-bar button,.preview-message button{border:0;border-radius:6px;background:#237d68;color:white;padding:9px 18px;cursor:pointer}.upload-bar button:disabled{opacity:.5}.preview-message{padding:45px;max-width:850px;margin:auto;line-height:1.8}.preview-message h1{font-size:21px}
.config-preview :deep(.campus3d-page){position:relative;inset:auto;flex:1;min-height:650px}.config-preview :deep(.gis-page){flex:1;min-height:0}.config-preview :deep(.gis-map){height:calc(100vh - 360px);min-height:430px}
</style>
