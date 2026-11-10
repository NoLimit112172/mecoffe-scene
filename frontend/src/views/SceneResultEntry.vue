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
      <h1>本实验未启用地图</h1><p>{{bundle.scene_result.reason}}</p><p>模拟人物 {{bundle.snapshot.nodes.length}} 人 · 关系 {{bundle.snapshot.edges.length}} 条 · 事件 {{noneEvents.length}} 条</p>
      <h2>人物与关系</h2><p v-for="person in bundle.snapshot.nodes" :key="person.entity_id">{{person.name||person.entity_id}} · {{person.role}}</p>
      <ul><li v-for="(edge,i) in bundle.snapshot.edges" :key="i">{{edge.source}} → {{edge.target}} · {{edge.relation}}</li></ul>
      <h2>事件记录</h2><p v-for="(event,i) in noneEvents" :key="event.key||event.id||i" data-testid="none-event">{{typeof event.actor==='string'?event.actor:event.actor.entity_id}} · {{event.action}} · {{event.outcome}}</p><p v-if="!noneEvents.length">{{mode==='config'?'配置预览，尚未运行模拟。':'暂未收到事件。'}}</p>
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
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue')),MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
defineProps({view:{type:String,default:'three'}})
const saved=localSceneInput(),bundle=shallowRef(saved.bundle),files=shallowRef(saved.files),mode=ref(saved.mode)
const scene=shallowRef(null),error=ref(''),loading=ref(false),none=ref(false),revision=ref(0),liveState=shallowRef(null),livePage=ref(0)
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
