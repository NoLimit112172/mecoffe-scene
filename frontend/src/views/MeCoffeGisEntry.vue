<template><SceneResultEntry v-if="sceneLocal" view="gis"/><ConfigPreviewEntry v-else-if="hasConfigPreviewRoute(route.query)" view="gis"/><MeCoffeGis v-else/></template>
<script setup>
import {useRoute} from 'vue-router'
import {computed,defineAsyncComponent} from 'vue'
import {hasConfigPreviewRoute} from '../mecoffe/configPreviewStore.js'
const route=useRoute()
const ConfigPreviewEntry=defineAsyncComponent(()=>import('./ConfigPreviewEntry.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
const sceneLocal=computed(()=>import.meta.env.DEV&&route.query.scene==='local')
const SceneResultEntry=import.meta.env.DEV?defineAsyncComponent(()=>import('./SceneResultEntry.vue')):null
</script>
