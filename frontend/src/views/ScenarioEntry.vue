<template>
  <div v-if="error" class="scenario-message" role="alert"><h1>场景未能加载</h1><p>{{error}}</p><button @click="load">重新加载</button><RouterLink to="/mecoffe3d">返回校园</RouterLink></div>
  <template v-else-if="scenario"><MeCoffe3D v-if="scenario.manifest.simulation_data" :scenario="scenario"/><MapScenePreview v-else :campus-id="scenario.manifest.map.campus_id" :scenario="scenario"/></template>
  <div v-else class="scenario-message" role="status">正在加载场景…</div>
</template>
<script setup>
import {onMounted,onBeforeUnmount,shallowRef,ref} from 'vue'
import {RouterLink} from 'vue-router'
import {loadScenario} from '../mecoffe/scenario.js'
import MeCoffe3D from './MeCoffe3D.vue'
import MapScenePreview from './MapScenePreview.vue'
const props=defineProps({scenarioId:{type:String,required:true}}),scenario=shallowRef(null),error=ref('')
let controller=null,disposed=false
async function load(){controller?.abort();controller=new AbortController();error.value='';try{const value=await loadScenario(props.scenarioId,{signal:controller.signal});if(!disposed)scenario.value=value}catch(e){if(e.name!=='AbortError'&&!disposed)error.value=e.message}}
onMounted(load);onBeforeUnmount(()=>{disposed=true;controller?.abort()})
</script>
<style scoped>.scenario-message{padding:50px;color:#244b46;background:#edf2ec;min-height:100vh}.scenario-message a{margin:20px}</style>
