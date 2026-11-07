<template>
  <ConfigPreviewEntry v-if="hasConfigPreviewRoute(route.query)" :view="view"/>
  <main v-else class="embed-welcome" data-testid="embed-welcome">
    <p class="eyebrow">SOCIAL-SIM · 场景展示</p><h1>请从团队网站打开场景</h1>
    <p>在配置页点击“三维预览 / GIS”，页面会自动读取所选配置。运行回放入口将在运行结束后提供。</p>
    <p>配置预览需要 <code>session</code> 和 <code>config</code> 参数，运行回放需要 <code>session</code> 和 <code>run</code> 参数。登录状态由团队网站提供。</p>
    <details @toggle="debugOpen=$event.target.open"><summary>开发者调试</summary><p>可使用合成样例或本地文件检查场景，数据仅保存在当前标签页内存中。</p><ConfigPreviewEntry v-if="debugOpen" :view="view" local-mode/></details>
  </main>
</template>
<script setup>
import {ref} from 'vue'
import {useRoute} from 'vue-router'
import ConfigPreviewEntry from './ConfigPreviewEntry.vue'
import {hasConfigPreviewRoute} from '../mecoffe/configPreviewStore.js'
defineProps({view:{type:String,default:'three'}})
const route=useRoute(),debugOpen=ref(false)
</script>
<style scoped>.embed-welcome{background:#f1f5f1;color:#24483e;min-height:100vh;padding:clamp(30px,7vw,90px);box-sizing:border-box;font:16px/1.9 'Microsoft YaHei',sans-serif}.eyebrow{color:#638176;font-size:12px;letter-spacing:2px}.embed-welcome h1{font-size:28px}.embed-welcome>p{max-width:850px}.embed-welcome code{padding:2px 7px;background:#e2ebe5;border-radius:5px}.embed-welcome details{margin-top:30px;padding:20px;background:white;border:1px solid #d4e2d9;border-radius:12px}.embed-welcome summary{cursor:pointer;font-weight:600}</style>
