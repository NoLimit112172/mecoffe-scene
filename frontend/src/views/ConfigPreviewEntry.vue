<template>
  <div class="config-preview" data-testid="config-preview" :data-people="data?.people.length || 0" :data-edges="data?.relationships.length || 0" :data-orders="data?.summary.orders || 0">
    <header class="preview-bar">
      <div>
        <strong>{{liveState&&liveState.mode!=='replay'?'运行中 · 实时场景':isReplay?(data?.meta.synthetic?'合成样例 · 运行回放':'运行回放'):'配置预览 · 尚未运行模拟'}}</strong>
        <p>{{presentation?.kind==='none'?'人物、关系与事件照常展示。':presentation?.kind==='blocked'?'地图暂不可用，保留能够核实的人物与活动。':'楼栋与路线为展示示意。'}}<template v-if="data">人物 {{data.people.length}} · 关系 {{data.relationships.length}}<template v-if="!data.meta?.activity_unavailable"> · 事件 {{data.events.length}} · 订单 {{data.summary.orders||0}}</template><template v-else> · 活动证据待核实</template></template><template v-else>按当前选择的数据加载</template></p>
        <small v-if="local||presentation?.kind==='legacy'" class="legacy-scene-note" data-testid="legacy-scene-note">{{local?'未提供 SceneResult，使用中科大 legacy 展示路径。':'旧版示意场景，未使用地图阶段'}}</small>
      </div>
      <RouterLink :to="{path:view==='gis'?'/mecoffe3d':'/mecoffe-gis',query:sourceQuery}">{{view==='gis'?'三维沙盘':'GIS 地图'}} ↗</RouterLink>
    </header>
    <LiveRunPanel v-if="liveState" :state="liveState" @pause="liveSession?.pause($event)" @follow="followLatest" @retry="retryLive"/>
    <p v-if="presentation?.revisionNote" class="scene-revision-note" role="note" data-testid="team-scene-revision-note">{{presentation.revisionNote}}</p>
    <ConfigImportPanel v-if="local" :busy="loading" @start="clearSource" @loaded="useImported" @error="showImportError"/>
    <div v-if="error" class="preview-message" role="alert" data-testid="config-preview-error">
      <h1>{{isReplay?'运行回放暂不可用':'配置预览暂不可用'}}</h1><p>{{error}}</p><button v-if="!local" @click="load">重新读取</button>
    </div>
    <p v-else-if="loading" class="preview-message" role="status">正在读取配置与展示数据…</p>
    <TeamSceneInfo v-else-if="presentation&&['none','blocked'].includes(presentation.kind)" :kind="presentation.kind" :message="presentation.message" :stage="presentation.stage"
      :snapshot="activity?.snapshot" :population-request="activity?.populationRequest" :events="activity?.events||[]" :summary="activity?.summary||{}" :plan="activity?.plan" :mode="activity?.mode||'config'" :activity-unavailable="activity?.meta?.activity_unavailable===true" @retry="load"/>
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
import TeamSceneInfo from '../components/TeamSceneInfo.vue'
import {loadConfigPreview,normalizeConfigPreview,buildConfigPreviewScenario} from '../mecoffe/configPreview.js'
import {buildGenericReplayScenario,buildReplayActivity} from '../mecoffe/genericReplay.js'
import {loadConfigMap} from '../mecoffe/configMap.js'
import {loadBundledSceneAssets,loadSceneMap} from '../mecoffe/sceneMap.js'
import {checkScenePlacement} from '../mecoffe/scenePlacement.js'
import {loadTeamScene,prepareTeamPresentation} from '../mecoffe/teamScene.js'
import {describeSceneIssue} from '../mecoffe/sceneIssues.js'
import {localPreviewInput,rememberLocalPreview,previewQuery} from '../mecoffe/configPreviewStore.js'
import {buildLiveScenario,syncLiveScenario} from '../mecoffe/liveRun.js'
import {acquireLiveRunSession,clearLiveRunSessions} from '../mecoffe/liveRunStore.js'
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
const props=defineProps({view:{type:String,default:'three'},localMode:{type:Boolean,default:false}})
const route=useRoute()
const local=computed(()=>props.localMode||route.query.preview==='local')
const sourceQuery=computed(()=>local.value?{preview:'local'}:previewQuery(route.query))
const scene=shallowRef(null),error=ref(''),loading=ref(false),revision=ref(0)
const liveState=shallowRef(null),mapView=ref(null)
const presentation=shallowRef(null),activity=shallowRef(null)
const data=computed(()=>scene.value?.files['trajectory.json']||(activity.value?{people:activity.value.snapshot?.nodes||[],relationships:activity.value.snapshot?.edges||[],events:activity.value.events||[],summary:activity.value.summary||{},meta:activity.value.meta||{}}:null))
const isReplay=computed(()=>route.query.run!=null||scene.value?.manifest.preview_mode==='replay')
let controller=null,generation=0,liveHandle=null,liveSession=null
function releaseLive(){liveHandle?.release();liveHandle=null;liveSession=null}
function clearUnauthorized(){scene.value=null;presentation.value=null;activity.value=null;controller?.abort();releaseLive();clearLiveRunSessions()}
function clearSource(){generation++;controller?.abort();releaseLive();liveState.value=null;scene.value=null;presentation.value=null;activity.value=null;error.value='';rememberLocalPreview(null)}
function showImportError(message){clearSource();loading.value=false;error.value=typeof message==='string'?message:message.message}
function useImported(value){void load(value)}
async function load(provided){
  const token=++generation
  controller?.abort();releaseLive();controller=new AbortController();scene.value=null;error.value='';liveState.value=null;presentation.value=null;activity.value=null
  let bundle=local.value?(provided?.kind?provided:localPreviewInput()):null
  if(local.value&&!bundle){loading.value=false;return}
  loading.value=true
  try {
    const signal=controller.signal
    // Local imports keep their existing legacy path and never inspect a team session.
    if(local.value){
      const map=await loadConfigMap({signal})
      if(token!==generation)return
      scene.value=bundle.kind==='replay'?buildGenericReplayScenario(bundle,map):buildConfigPreviewScenario(bundle.input,map,bundle.input.placementRules||{})
      rememberLocalPreview(bundle);revision.value++;return
    }
    const contexts=new Map(),maps=new Map()
    let assetsPromise=null
    const interrupted=e=>e.name==='AbortError'||e.code==='LOGIN_REQUIRED'
    function blocked(context,e){
      if(interrupted(e))throw e
      const issue=describeSceneIssue(e)
      return {...context,kind:'blocked',placement:null,revisionNote:'',message:/\p{Script=Han}/u.test(e.message||'')?e.message:issue.user_message}
    }
    function contextFor(config){
      if(!contexts.has(config))contexts.set(config,loadTeamScene({session:route.query.session,config,...(route.query.run!=null?{run:route.query.run}:{}),signal}))
      return contexts.get(config)
    }
    async function mapFetch(url,options){
      const response=await fetch(url,options)
      if(response.status===401)throw Object.assign(new Error('登录已失效，请返回团队网站重新登录后重试'),{code:'LOGIN_REQUIRED'})
      return response
    }
    async function preparedView(context,{snapshot,plan}){
      let prepared=prepareTeamPresentation(context,{snapshot,plan})
      if(!['map','legacy'].includes(prepared.kind))return {context:prepared,map:null}
      try{
        let map
        if(prepared.kind==='legacy'){
          if(!maps.has('legacy'))maps.set('legacy',loadConfigMap({signal}))
          map=await maps.get('legacy')
        }else{
          const placement=prepared.placement,key=JSON.stringify(placement.result.map_ref)
          if(!maps.has(key))maps.set(key,(async()=>{
            const assets=await(assetsPromise||=loadBundledSceneAssets({signal,fetcher:mapFetch}))
            return loadSceneMap(placement.result.map_ref,{mapsBase:'/api/scene-maps/',assets,fetcher:mapFetch,signal})
          })())
          map=await maps.get(key)
          checkScenePlacement(placement.result,{snapshot:placement.snapshot,plan:placement.plan,config_id:placement.config_id,map})
        }
        return {context:prepared,map}
      }catch(e){prepared=blocked(prepared,e);return {context:prepared,map:null}}
    }
    function setActivity(input,events=[],summary={},plan=null,mode='config',meta={}){
      activity.value={snapshot:input.snapshot,populationRequest:input.populationRequest,events,summary,plan,mode,meta}
    }
    if(!local.value&&route.query.run!=null){
      if(route.query.config!=null)throw new Error('运行回放只需 session 和 run 参数，请移除 config 参数')
      // One map per view: the shared run controller changes data, never its key.
      let lastReplay=null,livePrepared=null
      let pending=null,applying=false,authenticationLost=false
      async function changed(state){
        if(authenticationLost)return
        pending=state
        if(applying)return
        applying=true
        try{
          while(pending&&token===generation){
            const value=pending;pending=null
            if(value.error?.code==='LOGIN_REQUIRED'){
              authenticationLost=true;pending=null;clearUnauthorized();liveState.value=value;error.value=value.error.message;loading.value=false;continue
            }
            error.value=''
            if(value.mode==='replay'&&value.replayBundle){
              if(lastReplay===value.replayBundle)continue
              const replay=value.replayBundle
              const context=await contextFor(replay.context.config_id)
              const prepared=await preparedView(context,{snapshot:replay.snapshot,plan:replay.plan})
              if(token!==generation)break
              let details
              try{details=buildReplayActivity(replay)}
              catch(e){
                if(prepared.context.kind!=='blocked')throw e
                // A failed activity check must not hide the more specific frozen
                // placement mismatch, nor turn untrusted orders into zero orders.
                let input=null
                try{input=normalizeConfigPreview({network:replay.snapshot,roles:replay.roles,seed:replay.plan?.runtime?.seed})}catch{}
                if(input)setActivity(input,[],{},replay.plan,'replay',{activity_unavailable:true})
                else activity.value=null
                presentation.value={...prepared.context,message:`${prepared.context.message} 活动证据也未通过校验，暂不展示活动和订单。`}
                scene.value=null;lastReplay=replay;liveState.value=value;loading.value=false;continue
              }
              setActivity(details.input,details.events,details.summary,replay.plan,'replay',{synthetic:replay.trajectory.metadata.synthetic===true})
              presentation.value=prepared.context
              if(prepared.map){
                try{scene.value=buildGenericReplayScenario({...replay,scenePlacement:prepared.context.placement},prepared.map);revision.value++}
                catch(e){scene.value=null;presentation.value=blocked(prepared.context,e)}
              }else scene.value=null
              lastReplay=value.replayBundle;loading.value=false
            }else if(value.bootstrap){
              const bootstrap=value.bootstrap
              const input=normalizeConfigPreview({network:bootstrap.snapshot,roles:bootstrap.roles,seed:bootstrap.plan.runtime?.seed})
              if(!livePrepared){
                const context=await contextFor(bootstrap.config_id)
                livePrepared=await preparedView(context,{snapshot:bootstrap.snapshot,plan:bootstrap.plan})
              }
              if(token!==generation)break
              setActivity(input,value.events||[],value.summary||{},bootstrap.plan,'live',{synthetic:bootstrap.synthetic})
              presentation.value=livePrepared.context
              if(livePrepared.map){
                const state={...value,scenePlacement:livePrepared.context.placement}
                try{
                  if(!scene.value){scene.value=buildLiveScenario(state,livePrepared.map);revision.value++}
                  else if(scene.value.manifest.preview_mode==='live')syncLiveScenario(state,scene.value)
                }catch(e){scene.value=null;livePrepared={...livePrepared,context:blocked(livePrepared.context,e),map:null};presentation.value=livePrepared.context}
              }else scene.value=null
              loading.value=false
            }else loading.value=false
            // Revision watchers must only see the already synchronized scene.
            liveState.value=value
          }
        }catch(e){if(e.name!=='AbortError'&&token===generation){scene.value=null;if(e.code==='LOGIN_REQUIRED'){authenticationLost=true;pending=null;clearUnauthorized();liveState.value=null}error.value=e.message;loading.value=false}}
        finally{applying=false}
      }
      liveHandle=acquireLiveRunSession({session:route.query.session,run:route.query.run},state=>void changed(state))
      if(authenticationLost){releaseLive();return}
      liveSession=liveHandle.session;liveSession.start();return
    }
    const context=await contextFor(route.query.config)
    if(token!==generation)return
    presentation.value=context
    let input
    try{input=await loadConfigPreview({session:route.query.session,config:route.query.config,signal})}
    catch(e){
      if(interrupted(e))throw e
      if(context.kind==='blocked')return
      if(context.kind==='none'){presentation.value={...context,message:`${context.message} 人物数据暂不可用：${e.message}`};return}
      if(context.kind==='legacy')throw e
      presentation.value=blocked(context,e);return
    }
    if(token!==generation)return
    const prepared=await preparedView(context,{snapshot:input.snapshot,plan:context.configPlan})
    if(token!==generation)return
    setActivity(input,[],{orders:0},context.configPlan)
    presentation.value=prepared.context
    if(prepared.map){
      try{
        const placement=prepared.context.placement
        scene.value=placement?buildConfigPreviewScenario({...input,scenePlan:placement.plan,sceneConfigId:placement.config_id},prepared.map,{},placement.result):buildConfigPreviewScenario(input,prepared.map)
        revision.value++
      }catch(e){scene.value=null;presentation.value=blocked(prepared.context,e)}
    }
  } catch(e){if(e.name!=='AbortError'&&token===generation){scene.value=null;if(e.code==='LOGIN_REQUIRED'){clearUnauthorized();liveState.value=null}error.value=e.message}}
  finally{if(token===generation)loading.value=false}
}
function followLatest(){liveSession?.followLatest();mapView.value?.followLiveLatest()}
function retryLive(){if(liveSession)liveSession.retry();else void load()}
watch(()=>[route.query.session,route.query.config,route.query.run,route.query.preview],()=>load(),{immediate:true})
onBeforeUnmount(()=>{generation++;controller?.abort();releaseLive()})
</script>
<style scoped>
:global(#app:has(> .config-preview)){height:100%;min-height:0}
.config-preview{height:100%;max-height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#f0f4ee;color:#24453f}.preview-bar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 18px;background:#e6f1ed;border-bottom:1px solid #c7dbd3}.preview-bar strong{font-size:16px}.preview-bar p{margin:4px 0 0;font-size:11px;color:#50746b}.preview-bar a{color:#167967;font-weight:600;white-space:nowrap}.preview-message{padding:24px;max-width:850px;margin:auto;line-height:1.8;overflow:auto;min-height:0}.preview-message h1{font-size:21px}.preview-message button{border:0;border-radius:6px;background:#237d68;color:white;padding:9px 18px;cursor:pointer}
.config-preview :deep(.campus3d-page){position:relative;inset:auto;flex:1;min-height:0}.config-preview :deep(.gis-page){flex:1;min-height:0}.config-preview :deep(.gis-map){height:100%;min-height:0}
.legacy-scene-note{display:block;margin-top:5px;padding:4px 7px;background:#fff1cb;border:1px solid #e4ce8c;border-radius:4px;color:#7b591c;font-size:11px}.scene-revision-note{flex-shrink:0;margin:0;padding:7px 14px;background:#eef6e9;border-bottom:1px solid #d1e1c9;color:#46683a;font-size:11px}
@media(max-width:900px),(max-height:650px){.preview-bar{padding:7px 10px;gap:8px}.preview-bar strong{font-size:13px}.preview-bar p{font-size:10px}.preview-bar a{font-size:12px}.preview-message{padding:16px}}
</style>
