<template>
  <details v-if="unsuccessfulOutcome(event)" class="event-result-details" @click.stop>
    <summary>数据详情</summary><pre aria-label="动作原始数据">{{JSON.stringify(rawEventResult(event),null,2)}}</pre>
  </details>
</template>
<script setup>
import {unsuccessfulOutcome,rawEventResult} from '../mecoffe/eventPresentation.js'
defineProps({event:{type:Object,required:true}})
</script>
<style scoped>
.event-result-details{margin-top:8px;color:#6e807a;font-size:11px;font-weight:400;text-align:left}.event-result-details summary{cursor:pointer;display:list-item}.event-result-details pre{margin:7px 0 0;padding:9px;background:#edf2ef;border:1px solid #dae4dd;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font:10px/1.6 Consolas,monospace}
</style>
