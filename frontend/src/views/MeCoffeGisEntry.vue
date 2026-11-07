<template><ConfigPreviewEntry v-if="hasConfigPreviewRoute(route.query)" view="gis"/><MeCoffeGis v-else/></template>
<script setup>
import {useRoute} from 'vue-router'
import {defineAsyncComponent} from 'vue'
import {hasConfigPreviewRoute} from '../mecoffe/configPreviewStore.js'
const route=useRoute()
const ConfigPreviewEntry=defineAsyncComponent(()=>import('./ConfigPreviewEntry.vue'))
const MeCoffeGis=defineAsyncComponent(()=>import('./MeCoffeGis.vue'))
</script>
