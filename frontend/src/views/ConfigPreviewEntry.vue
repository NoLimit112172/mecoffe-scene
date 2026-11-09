<template>
  <div class="config-preview" data-testid="config-preview" :data-people="data?.people.length || 0" :data-edges="data?.relationships.length || 0" :data-orders="data?.summary.orders || 0">
    <header class="preview-bar">
      <div>
        <strong>{{liveState&&liveState.mode!=='replay'?'运行中 · 实时场景':isReplay?(data?.meta.synthetic?'合成样例 · 运行回放':'运行回放'):'配置预览 · 尚未运行模拟'}}</strong>
        <p>楼栋与路线为展示示意。<template v-if="data">人物 {{data.people.length}} · 关系 {{data.relationships.length}} · 事件 {{data.events.length}} · 订单 {{data.summary.orders}}</template><template v-else>按当前选择的数据加载</template></p>
      </div>
      <RouterLink :to="{path:view==='gis'?'/mecoffe3d':'/mecoffe-gis',query:sourceQuery}">{{view==='gis'?'三维沙盘':'GIS 地图'}} ↗</RouterLink>
    </header>
    <LiveRunPanel v-if="liveState" :state="liveState" @pause="liveSession?.pause($event)" @follow="followLatest" @retry="liveSession?.retry()"/>
    <ConfigImportPanel v-if="local" :busy="loading" @start="clearSource" @loaded="useImported" @error="showImportError"/>
    <div v-if="error" class="preview-message" role="alert" data-testid="config-preview-error">
      <h1>{{isReplay?'运行回放暂不可用':'配置预览暂不可用'}}</h1><p>{{error}}</p><button v-if="!local" @click="load">重新读取</button>
    </div>
    <p v-else-if="loading" class="preview-message" role="status">正在读取数据与校园地图…</p>
    <template v-else-if="scene">
      <MeCoffeGis v-if="view==='gis'" ref="mapView" :key="revision" :preview-scenario="scene" :live-state="liveState"/>
      <MeCoffe3D v-else ref="mapView" :key="revision" :scenario="scene" :live-state="liveState"/>
    </template>
    <p v-else-if="local" class="preview-message">可直接加载合成样例，或一次选择需要预览的文件。</p>
  </div>
</template>
<script setup>
import {computed,defineAsyncComponent,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {RouterLink,useRoute} from 'vue-router'
import ConfigImportPanel from '../components/ConfigImportPanel.vue'
import LiveRunPanel from '../components/LiveRunPanel.vue'
import {loadConfigPreview,buildConfigPreviewScenario} from '../mecoffe/configPreview.js'
import {buildGenericReplayScenario} from '../mecoffe/genericReplay.js'
import {loadConfigMap} from '../mecoffe/configMap.js'
import {localPreviewInput,rememberLocalPreview,previewQuery} from '../mecoffe/configPreviewStore.js'
import {buildLiveScenario,syncLiveScenario} from '../mecoffe/liveRun.js'
import {acquireLiveRunSession} from '../mecoffe/liveRunStore.js'
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
const props=defineProps({view:{type:String,default:'three'},localMode:{type:Boolean,default:false}})
const route=useRoute()
const local=computed(()=>props.localMode||route.query.preview==='local')
const sourceQuery=computed(()=>local.value?{preview:'local'}:previewQuery(route.query))
const scene=shallowRef(null),error=ref(''),loading=ref(false),revision=ref(0)
const liveState=shallowRef(null),mapView=ref(null)
const data=computed(()=>scene.value?.files['trajectory.json'])
const isReplay=computed(()=>route.query.run!=null||scene.value?.manifest.preview_mode==='replay')
let controller=null,generation=0,liveHandle=null,liveSession=null
function releaseLive(){liveHandle?.release();liveHandle=null;liveSession=null}
function clearSource(){generation++;controller?.abort();releaseLive();liveState.value=null;scene.value=null;error.value='';rememberLocalPreview(null)}
function showImportError(message){clearSource();loading.value=false;error.value=typeof message==='string'?message:message.message}
function useImported(value){void load(value)}
async function load(provided){
  const token=++generation
  controller?.abort();releaseLive();controller=new AbortController();scene.value=null;error.value='';liveState.value=null
  let bundle=local.value?(provided?.kind?provided:localPreviewInput()):null
  if(local.value&&!bundle){loading.value=false;return}
  loading.value=true
  try {
    const signal=controller.signal
    if(!local.value&&route.query.run!=null){
      if(route.query.config!=null)throw new Error('运行回放只需 session 和 run 参数，请移除 config 参数')
      // One map per view: the shared run controller changes data, never its key.
      let mapPromise=null,lastReplay=null
      let pending=null,applying=false
      async function changed(state){
        pending=state
        if(applying)return
        applying=true
        try{
          while(pending&&token===generation){
            const value=pending;pending=null
            if(value.error?.code==='LOGIN_REQUIRED'){
              scene.value=null;liveState.value=value;error.value=value.error.message;loading.value=false;continue
            }
            error.value=''
            if(value.mode==='replay'&&value.replayBundle){
              if(lastReplay===value.replayBundle)continue
              const map=await(mapPromise||=loadConfigMap({signal}))
              if(token!==generation)break
              scene.value=buildGenericReplayScenario(value.replayBundle,map)
              lastReplay=value.replayBundle;revision.value++;loading.value=false
            }else if(value.bootstrap){
              const map=await(mapPromise||=loadConfigMap({signal}))
              if(token!==generation)break
              if(!scene.value){scene.value=buildLiveScenario(value,map);revision.value++}
              else if(scene.value.manifest.preview_mode==='live')syncLiveScenario(value,scene.value)
              loading.value=false
            }else loading.value=false
            // Revision watchers must only see the already synchronized scene.
            liveState.value=value
          }
        }catch(e){if(e.name!=='AbortError'&&token===generation){error.value=e.message;loading.value=false}}
        finally{applying=false}
      }
      liveHandle=acquireLiveRunSession({session:route.query.session,run:route.query.run},state=>void changed(state))
      liveSession=liveHandle.session;liveSession.start();return
    }
    if(!local.value){
      bundle={kind:'config',input:await loadConfigPreview({session:route.query.session,config:route.query.config,signal})}
    }
    const map=await loadConfigMap({signal})
    if(token!==generation)return
    const next=bundle.kind==='replay'?buildGenericReplayScenario(bundle,map):buildConfigPreviewScenario(bundle.input,map,bundle.input.placementRules || {})
    if(local.value)rememberLocalPreview(bundle)
    scene.value=next;revision.value++
  } catch(e){if(e.name!=='AbortError'&&token===generation)error.value=e.message}
  finally{if(token===generation)loading.value=false}
}
function followLatest(){liveSession?.followLatest();mapView.value?.followLiveLatest()}
watch(()=>[route.query.session,route.query.config,route.query.run,route.query.preview],()=>load(),{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort();releaseLive()})
</script>
<style scoped>
:global(#app:has(> .config-preview)){height:100%;min-height:0}
.config-preview{height:100%;max-height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#f0f4ee;color:#24453f}.preview-bar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 18px;background:#e6f1ed;border-bottom:1px solid #c7dbd3}.preview-bar strong{font-size:16px}.preview-bar p{margin:4px 0 0;font-size:11px;color:#50746b}.preview-bar a{color:#167967;font-weight:600;white-space:nowrap}.preview-message{padding:24px;max-width:850px;margin:auto;line-height:1.8;overflow:auto;min-height:0}.preview-message h1{font-size:21px}.preview-message button{border:0;border-radius:6px;background:#237d68;color:white;padding:9px 18px;cursor:pointer}
.config-preview :deep(.campus3d-page){position:relative;inset:auto;flex:1;min-height:0}.config-preview :deep(.gis-page){flex:1;min-height:0}.config-preview :deep(.gis-map){height:100%;min-height:0}
@media(max-width:900px),(max-height:650px){.preview-bar{padding:7px 10px;gap:8px}.preview-bar strong{font-size:13px}.preview-bar p{font-size:10px}.preview-bar a{font-size:12px}.preview-message{padding:16px}}
</style>
