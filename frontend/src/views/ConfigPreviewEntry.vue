<template>
  <div class="config-preview" data-testid="config-preview" :data-people="data?.people.length || 0" :data-edges="data?.relationships.length || 0" :data-orders="data?.summary.orders || 0">
    <header class="preview-bar">
      <div>
        <strong>{{isReplay?(data?.meta.synthetic?'合成样例 · 运行回放':'运行回放'):'配置预览 · 尚未运行模拟'}}</strong>
        <p>楼栋与路线为展示示意。<template v-if="data">人物 {{data.people.length}} · 关系 {{data.relationships.length}} · 事件 {{data.events.length}} · 订单 {{data.summary.orders}}</template><template v-else>按当前选择的数据加载</template></p>
      </div>
      <RouterLink :to="{path:view==='gis'?'/mecoffe3d':'/mecoffe-gis',query:sourceQuery}">{{view==='gis'?'三维沙盘':'GIS 地图'}} ↗</RouterLink>
    </header>
    <ConfigImportPanel v-if="local" :busy="loading" @start="clearSource" @loaded="useImported" @error="showImportError"/>
    <div v-if="error" class="preview-message" role="alert" data-testid="config-preview-error">
      <h1>{{isReplay?'运行回放暂不可用':'配置预览暂不可用'}}</h1><p>{{error}}</p><button v-if="!local" @click="load">重新读取</button>
    </div>
    <p v-else-if="loading" class="preview-message" role="status">正在读取数据与校园地图…</p>
    <template v-else-if="scene">
      <MeCoffeGis v-if="view==='gis'" :key="revision" :preview-scenario="scene"/>
      <MeCoffe3D v-else :key="revision" :scenario="scene"/>
    </template>
    <p v-else class="preview-message">可直接加载合成样例，或一次选择需要预览的文件。</p>
  </div>
</template>
<script setup>
import {computed,defineAsyncComponent,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {RouterLink,useRoute} from 'vue-router'
import ConfigImportPanel from '../components/ConfigImportPanel.vue'
import {loadConfigPreview,buildConfigPreviewScenario} from '../mecoffe/configPreview.js'
import {buildGenericReplayScenario,loadRunReplay} from '../mecoffe/genericReplay.js'
import {loadConfigMap} from '../mecoffe/configMap.js'
import {localPreviewInput,rememberLocalPreview,previewQuery} from '../mecoffe/configPreviewStore.js'
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
const props=defineProps({view:{type:String,default:'three'},localMode:{type:Boolean,default:false}})
const route=useRoute()
const local=computed(()=>props.localMode||route.query.preview==='local')
const sourceQuery=computed(()=>local.value?{preview:'local'}:previewQuery(route.query))
const scene=shallowRef(null),error=ref(''),loading=ref(false),revision=ref(0)
const data=computed(()=>scene.value?.files['trajectory.json'])
const isReplay=computed(()=>route.query.run!=null||scene.value?.manifest.preview_mode==='replay')
let controller=null,generation=0
function clearSource(){generation++;controller?.abort();scene.value=null;error.value='';rememberLocalPreview(null)}
function showImportError(message){clearSource();loading.value=false;error.value=typeof message==='string'?message:message.message}
function useImported(value){void load(value)}
async function load(provided){
  const token=++generation
  controller?.abort();controller=new AbortController();scene.value=null;error.value=''
  let bundle=local.value?(provided?.kind?provided:localPreviewInput()):null
  if(local.value&&!bundle){loading.value=false;return}
  loading.value=true
  try {
    const signal=controller.signal
    if(!local.value){
      if(route.query.run!=null){
        if(route.query.config!=null)throw new Error('运行回放只需 session 和 run 参数，请移除 config 参数')
        bundle={kind:'replay',...await loadRunReplay({session:route.query.session,run:route.query.run,signal})}
      } else bundle={kind:'config',input:await loadConfigPreview({session:route.query.session,config:route.query.config,signal})}
    }
    const map=await loadConfigMap({signal})
    if(token!==generation)return
    const next=bundle.kind==='replay'?buildGenericReplayScenario(bundle,map):buildConfigPreviewScenario(bundle.input,map,bundle.input.placementRules || {})
    if(local.value)rememberLocalPreview(bundle)
    scene.value=next;revision.value++
  } catch(e){if(e.name!=='AbortError'&&token===generation)error.value=e.message}
  finally{if(token===generation)loading.value=false}
}
watch(()=>[route.query.session,route.query.config,route.query.run,route.query.preview],()=>load(),{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<style scoped>
.config-preview{height:100vh;display:flex;flex-direction:column;overflow:auto;background:#f0f4ee;min-height:100vh;color:#24453f}.preview-bar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 22px;background:#e6f1ed;border-bottom:1px solid #c7dbd3}.preview-bar strong{font-size:16px}.preview-bar p{margin:5px 0 0;font-size:12px;color:#50746b}.preview-bar a{color:#167967;font-weight:600;white-space:nowrap}.preview-message{padding:45px;max-width:850px;margin:auto;line-height:1.8}.preview-message h1{font-size:21px}.preview-message button{border:0;border-radius:6px;background:#237d68;color:white;padding:9px 18px;cursor:pointer}
.config-preview :deep(.campus3d-page){position:relative;inset:auto;flex:1;min-height:650px}.config-preview :deep(.gis-page){flex:1;min-height:0}.config-preview :deep(.gis-map){height:calc(100vh - 360px);min-height:430px}
</style>
