<template><ConfigPreviewEntry v-if="hasConfigPreviewRoute(route.query)"/><ScenarioEntry v-else-if="scenario" :key="scenario" :scenario-id="scenario"/><MapScenePreview v-else-if="campus" :key="campus" :campus-id="campus"/><MeCoffe3D v-else/></template>
<script setup>
import {computed,defineAsyncComponent} from 'vue'
import {useRoute} from 'vue-router'
import {hasConfigPreviewRoute} from '../mecoffe/configPreviewStore.js'
const ConfigPreviewEntry=defineAsyncComponent(()=>import('./ConfigPreviewEntry.vue'))
const ScenarioEntry=defineAsyncComponent(()=>import('./ScenarioEntry.vue'))
const route=useRoute(),scenario=computed(()=>typeof route.query.scenario==='string'?route.query.scenario:''),campus=computed(()=>typeof route.query.campus==='string'?route.query.campus:'')
const MapScenePreview=defineAsyncComponent(()=>import('./MapScenePreview.vue'))
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
</script>
