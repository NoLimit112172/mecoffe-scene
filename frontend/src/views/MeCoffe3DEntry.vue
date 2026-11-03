<template><MapScenePreview v-if="campus" :key="campus" :campus-id="campus"/><MeCoffe3D v-else/></template>
<script setup>
import {computed,defineAsyncComponent} from 'vue'
import {useRoute} from 'vue-router'
const route=useRoute(),campus=computed(()=>typeof route.query.campus==='string'?route.query.campus:'')
const MapScenePreview=defineAsyncComponent(()=>import('./MapScenePreview.vue'))
const MeCoffe3D=defineAsyncComponent(()=>import('./MeCoffe3D.vue'))
</script>
