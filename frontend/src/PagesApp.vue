<template><router-view/><RouterLink v-if="$route.name!=='licenses'" class="site-license" to="/licenses">来源与许可</RouterLink></template>
<script setup>import {RouterLink} from 'vue-router'</script>
<style>.site-license{position:fixed;right:12px;bottom:1px;z-index:30;padding:0 5px;font:10px/13px system-ui,sans-serif;color:#277b68;background:#f2f5eef0;border-radius:4px;text-decoration:none}</style>
