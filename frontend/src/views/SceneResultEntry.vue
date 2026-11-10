<template>
  <main class="scene-result-entry" data-testid="scene-result-entry" :data-mode="mode" :data-result-hash="bundle?.scene_result?.result_sha256||''">
    <header class="scene-inputs">
      <strong>本地 SceneResult 开发验收 · 位置示意</strong>
      <label>SceneResult 与模拟输入 <input aria-label="SceneResult 与模拟输入" type="file" accept=".json" @change="importInput"/></label>
      <label>地图库根目录 <input aria-label="地图库根目录" type="file" webkitdirectory multiple @change="importMaps"/></label>
      <label>展示模式 <select v-model="mode" aria-label="SceneResult 展示模式" @change="load"><option value="config">配置预览</option><option value="replay">终态回放</option><option value="live">M14 实时</option></select></label>
      <RouterLink :to="{path:view==='gis'?'/mecoffe3d':'/mecoffe-gis',query:{scene:'local'}}">{{view==='gis'?'三维沙盘':'GIS 地图'}} ↗</RouterLink>
      <button v-if="mode==='live'&&liveState" :disabled="livePage>=(bundle.live?.pages?.length||0)" @click="advanceLive">应用下一批合成实时事件</button>
    </header>
    <p v-if="error" role="alert" data-testid="scene-result-error">{{error}}</p>
    <p v-else-if="loading" role="status">正在校验场景结果与地图…</p>
    <p v-else-if="!bundle">请选择本地输入文件；地图库根目录中应包含 map_id/map_version/manifest.json。</p>
    <section v-else-if="none" class="none-scene" data-testid="scene-none">
      <header class="none-heading"><span aria-hidden="true">◈</span><div><p>人物网络与活动</p><h1>本实验未启用地图</h1></div></header>
      <div class="none-explanation"><strong>纯网络模式</strong><p>{{bundle.scene_result.reason}}</p><p>保留人物、关系与事件，不生成地图位置或行走路线。</p></div>
      <div class="none-metrics"><div><span>模拟人物</span><b>{{nonePeople.length}} 人</b></div><div><span>人物关系</span><b>{{bundle.snapshot.edges.length}} 条</b></div><div><span>活动记录</span><b>{{noneEvents.length}} 条</b></div></div>
      <div class="none-columns">
        <section class="none-card"><h2>人物与关系</h2><ul class="none-people"><li v-for="person in nonePeople" :key="person.id"><strong>{{person.name}}</strong><span>{{person.roleLabel}}</span><details><summary>人物标识与角色说明</summary><p>{{person.roleDescription||'暂无说明'}}</p><code>{{person.id}} · {{person.role}}</code></details></li></ul></section>
        <section class="none-card"><h2>关系列表</h2><ul class="none-relations"><li v-for="(edge,i) in bundle.snapshot.edges" :key="i"><strong>{{nameOf(edge.source)}}</strong><span>{{sceneRelationLabel(edge.relation)}}</span><strong>{{nameOf(edge.target)}}</strong></li></ul><p v-if="!bundle.snapshot.edges.length">暂无人物关系。</p></section>
      </div>
      <section class="none-card"><h2>事件记录</h2><article v-for="(event,i) in noneEvents" :key="event.key||event.id||i" class="none-event" data-testid="none-event"><strong>{{nameOf(typeof event.actor==='string'?event.actor:event.actor.entity_id)}}</strong> · {{sceneActionLabel(event.action)}} · {{sceneOutcomeLabel(event.outcome,event.action==='purchase_product'?event.evidence_status:null)}}<details><summary>记录标识</summary><code>{{event.key||event.id||i}} · {{typeof event.actor==='string'?event.actor:event.actor.entity_id}} · {{event.action}}</code></details></article><p v-if="!noneEvents.length">{{mode==='config'?'配置预览，尚未运行模拟。':'暂未收到事件。'}}</p></section>
    </section>
    <template v-else-if="scene">
      <MeCoffeGis v-if="view==='gis'" :key="revision" :preview-scenario="scene" :live-state="liveState"/>
      <MeCoffe3D v-else :key="revision" :scenario="scene" :live-state="liveState"/>
    </template>
  </main>
</template>
<script setup>
import {computed,defineAsyncComponent,onBeforeUnmount,ref,shallowRef} from 'vue'
import {RouterLink} from 'vue-router'
import {normalizeConfigPreview,buildConfigPreviewScenario} from '../mecoffe/configPreview.js'
import {buildGenericReplayScenario,validateRunReplay} from '../mecoffe/genericReplay.js'
import {validateLiveBootstrap,createLiveState,applyLivePage,buildLiveScenario,syncLiveScenario} from '../mecoffe/liveRun.js'
import {checkScenePlacement} from '../mecoffe/scenePlacement.js'
import {loadSceneMap,loadBundledSceneAssets} from '../mecoffe/sceneMap.js'
import {localSceneInput,rememberLocalScene,localMapFetcher} from '../mecoffe/sceneRenderStore.js'
import {scenePeopleLabels,sceneRelationLabel,sceneActionLabel,sceneOutcomeLabel} from '../mecoffe/sceneLabels.js'
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue')),MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
defineProps({view:{type:String,default:'three'}})
const saved=localSceneInput(),bundle=shallowRef(saved.bundle),files=shallowRef(saved.files),mode=ref(saved.mode)
const scene=shallowRef(null),error=ref(''),loading=ref(false),none=ref(false),revision=ref(0),liveState=shallowRef(null),livePage=ref(0)
const normalizedInput=shallowRef(null)
const nonePeople=computed(()=>scenePeopleLabels(normalizedInput.value?.snapshot,normalizedInput.value?.populationRequest))
const names=computed(()=>new Map(nonePeople.value.map(person=>[person.id,person.name])))
const nameOf=id=>names.value.get(id)||'未知人物'
const noneEvents=computed(()=>mode.value==='config'?[]:mode.value==='live'?liveState.value?.events||[]:bundle.value?.trajectory?.actions||[])
let controller=null,generation=0
async function importInput(event){
  const file=event.target.files[0];if(!file)return
  const token=++generation;controller?.abort();bundle.value=null;scene.value=null;none.value=false;error.value='';liveState.value=null;loading.value=true
  rememberLocalScene({bundle:null,files:files.value,mode:mode.value,livePage:0})
  try{const value=JSON.parse(await file.text());if(token!==generation)return;bundle.value=value;await load()}
  catch(e){if(token===generation){error.value=e.message;loading.value=false}}
}
async function importMaps(event){files.value=Array.from(event.target.files);await load()}
async function load(){
  const token=++generation;controller?.abort();controller=new AbortController();scene.value=null;none.value=false;error.value='';liveState.value=null;livePage.value=0
  if(!bundle.value){loading.value=false;return}
  loading.value=true
  try{
    const b=bundle.value,result=b.scene_result
    if(!result)throw new Error('本地输入缺少 SceneResult；此入口不会回退中科大')
    const normalized=normalizeConfigPreview({network:b.snapshot,roles:b.roles,seed:b.plan?.runtime?.seed})
    normalizedInput.value=normalized
    checkScenePlacement(result,{snapshot:b.snapshot,plan:b.plan,config_id:b.config_id})
    if(mode.value==='replay')validateRunReplay({...b,context:{config_id:b.config_id}})
    if(mode.value==='live'){
      const raw=b.live?.bootstrap,bootstrap=validateLiveBootstrap(raw,{session:'synthetic-live-session',run:raw?.run_id})
      checkScenePlacement(result,{snapshot:bootstrap.snapshot,plan:bootstrap.plan,config_id:bootstrap.config_id})
      let state=createLiveState(bootstrap);state.sceneResult=result
      const retained=localSceneInput(),count=retained.bundle===b&&retained.mode==='live'?retained.livePage||0:0
      for(let i=0;i<count;i++)state=applyLivePage(state,b.live.pages[i])
      liveState.value=state;livePage.value=count
    }
    if(result.mode==='none'){none.value=true;rememberLocalScene({bundle:b,files:files.value,mode:mode.value,livePage:livePage.value});return}
    const signal=controller.signal,fetcher=localMapFetcher(files.value)
    const assets=await loadBundledSceneAssets({signal})
    const map=await loadSceneMap(result.map_ref,{mapsBase:'/__local_scene_maps__/',assets,fetcher,signal})
    if(token!==generation)return
    checkScenePlacement(result,{snapshot:b.snapshot,plan:b.plan,config_id:b.config_id,map})
    if(mode.value==='config')scene.value=buildConfigPreviewScenario({...normalized,scenePlan:b.plan,sceneConfigId:b.config_id},map,{},result)
    else if(mode.value==='replay')scene.value=buildGenericReplayScenario({...b,context:{config_id:b.config_id},sceneResult:result},map)
    else{
      const state=liveState.value,bootstrap=state.bootstrap
      checkScenePlacement(result,{snapshot:bootstrap.snapshot,plan:bootstrap.plan,config_id:bootstrap.config_id,map})
      scene.value=buildLiveScenario(state,map)
    }
    revision.value++;rememberLocalScene({bundle:b,files:files.value,mode:mode.value,livePage:livePage.value})
  }catch(e){if(token===generation&&e.name!=='AbortError'){error.value=`${e.code||'SCENE_LOAD_ERROR'}：${e.message}`;scene.value=null;none.value=false}}
  finally{if(token===generation)loading.value=false}
}
function advanceLive(){try{const next=applyLivePage(liveState.value,bundle.value.live.pages[livePage.value]);if(scene.value)syncLiveScenario(next,scene.value);liveState.value=next;livePage.value++;rememberLocalScene({livePage:livePage.value})}catch(e){error.value=`${e.code||'SCENE_LIVE_ERROR'}：${e.message}`;scene.value=null}}
if(bundle.value)void load()
onBeforeUnmount(()=>{generation++;controller?.abort()})
</script>
<style scoped>.scene-result-entry{height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto;background:#f0f4ee;color:#244b3c}.scene-inputs{padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#e3eee8;font:12px sans-serif;flex-shrink:0}.scene-inputs label{display:flex;align-items:center;gap:4px}.scene-inputs input{max-width:210px}.scene-inputs a{color:#176e58}.scene-result-entry>[role=alert]{padding:20px;color:#8a3a27}.scene-result-entry :deep(.campus3d-page),.scene-result-entry :deep(.gis-page){position:relative;inset:auto;flex:1;min-height:0}.none-scene{padding:20px;overflow:auto}:global(#app:has(>.scene-result-entry)){height:100%;min-height:0}</style>
<style scoped>.none-scene{flex:1;min-height:0;box-sizing:border-box;padding:clamp(16px,3vw,32px);font:14px/1.7 'Microsoft YaHei',sans-serif}.none-heading{display:flex;align-items:center;gap:14px;margin-bottom:20px}.none-heading>span{font-size:32px;color:#267b67}.none-heading h1{font-size:24px;margin:0}.none-heading p{margin:0;color:#628072}.none-explanation{padding:16px 20px;border:1px solid #d2e2d8;border-radius:10px;background:#f8fbf8}.none-explanation p{margin:5px 0}.none-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}.none-metrics>div,.none-card{border:1px solid #d6e1d8;border-radius:10px;background:#fff;padding:16px}.none-metrics span{display:block;color:#678070;font-size:12px}.none-metrics b{font-size:23px}.none-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.none-card h2{font-size:16px;margin:0 0 10px}.none-card ul{list-style:none;margin:0;padding:0}.none-people li,.none-relations li,.none-event{border-bottom:1px solid #e9eee9;padding:10px 0}.none-people li>span{margin-left:10px;color:#648575}.none-card details{font-size:12px;color:#718579;overflow-wrap:anywhere}.none-relations li{display:flex;gap:10px;flex-wrap:wrap}.none-relations span{color:#718579}@media(max-width:650px){.none-columns{grid-template-columns:1fr}.none-heading h1{font-size:21px}.none-metrics{gap:6px}.none-metrics>div{padding:10px}.none-metrics b{font-size:19px}}</style>
