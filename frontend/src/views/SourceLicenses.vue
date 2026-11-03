<template>
  <main class="license-page"><header><p>MECOFFE</p><h1>来源与许可</h1><RouterLink to="/mecoffe3d">返回三维校园 ↗</RouterLink></header>
    <p class="notice">地点和走路路线为展示示意，OASIS 没有位置数据。建筑轮廓与道路来自 OpenStreetMap；默认高度、门店位置、水深、植被布点及部分场地排布均为展示设定。</p>
    <p>本站提供历史 OASIS 回放、关系网络输入和规则演示。规则演示不代表新一轮 OASIS 实验；历史运行的缺失日期没有补造。人物模型不代表画像主体的真实肖像。</p>
    <section v-for="item in sources" :key="item.title"><h2>{{item.title}}</h2><p>{{item.credit}}</p><p>{{item.license}}</p><a :href="item.source" target="_blank" rel="noopener noreferrer">原始来源 ↗</a> · <a :href="item.text" target="_blank" rel="noopener noreferrer">许可全文 ↗</a></section>
    <section><h2>程序生成与地图衍生内容</h2><p>屋顶、沙盘底座、运动场器材、桥型、水深与行走动画由项目程序生成。OSM 衍生数据继续按 ODbL-1.0 提供；YuLan 改编立面继续保留 Apache-2.0。项目生成内容不冒充外部 CC0 资源。</p><a :href="notice" target="_blank" rel="noopener noreferrer">完整 NOTICE</a> · <a href="https://github.com/NoLimit112172/mecoffe-scene/tree/main/data/osm" target="_blank" rel="noopener noreferrer">OSM 原始数据与转换源码</a></section>
    <p>公开构建保留校园所需的 VALID 人物与 Kenney 植被，完整 Rocketbox 原始库保留在本地项目，不随本站发布。</p>
  </main>
</template>
<script setup>
import {onMounted} from 'vue'
import {RouterLink} from 'vue-router'
import {publicUrl,IS_PAGES} from '../mecoffe/publicUrl.js'
const text=(file,remote)=>IS_PAGES?publicUrl('licenses/'+file):remote
const sources=[
  {title:'YuLan-OneSim',credit:'RUC-GSAI / YuLan-OneSim，源提交 9829d72；界面与美术图集的改编保留来源及修改记录。',license:'Apache License 2.0',source:'https://github.com/RUC-GSAI/YuLan-OneSim',text:text('YuLan-Apache-2.0.txt','https://github.com/RUC-GSAI/YuLan-OneSim/blob/main/LICENSE')},
  {title:'OpenStreetMap',credit:'© OpenStreetMap contributors',license:'Open Database License 1.0（ODbL）；地图数据及衍生数据库保留署名与相同方式共享要求。',source:'https://www.openstreetmap.org/copyright',text:'https://opendatacommons.org/licenses/odbl/1-0/'},
  {title:'Kenney Nature Kit 2.1',credit:'Kenney / www.kenney.nl；自愿致谢，CC0 不强制署名。',license:'CC0-1.0',source:'https://kenney.nl/assets/nature-kit',text:publicUrl('mecoffe/assets3d/kenney/License.txt')},
  {title:'VALID Validated Avatar Library',credit:'Copyright (c) 2022 Tiffany Do；University of Central Florida 与 Google 的上游合成人物库。保留完整版权声明和许可文本。',license:'MIT；源提交 c76d2547b5b464415283169d18dffb16bb584eee。',source:'https://github.com/google/valid-avatar-library',text:publicUrl('mecoffe/assets3d/valid/LICENSE')},
  {title:'Three.js / three/addons',credit:'Three.js authors / contributors；包括 FBXLoader、SkeletonUtils、OrbitControls 与后处理。',license:'MIT',source:'https://github.com/mrdoob/three',text:text('Three-MIT.txt','https://github.com/mrdoob/three/blob/dev/LICENSE')},
  {title:'Vue / Vue Router',credit:'Vue 与 Vue Router contributors',license:'MIT；路由与界面框架。',source:'https://github.com/vuejs/core',text:text('Vue-MIT.txt','https://github.com/vuejs/core/blob/main/LICENSE')},
  {title:'PixiJS / pixi-viewport',credit:'PixiJS contributors / David Figatner；二维沙盘渲染与视口。',license:'MIT',source:'https://github.com/pixijs/pixijs',text:text('PixiJS-MIT.txt','https://github.com/pixijs/pixijs/blob/dev/LICENSE')},
  {title:'Apache ECharts',credit:'The Apache Software Foundation / ECharts contributors；二维统计图表。',license:'Apache-2.0；保留 NOTICE。',source:'https://github.com/apache/echarts',text:text('ECharts-Apache-2.0.txt','https://github.com/apache/echarts/blob/master/LICENSE')},
  {title:'Font Awesome Free',credit:'Fonticons, Inc. / Font Awesome contributors',license:'图标 CC BY 4.0、字体 SIL OFL 1.1、代码 MIT；详见原始许可。',source:'https://fontawesome.com/license/free',text:text('FontAwesome-LICENSE.txt','https://github.com/FortAwesome/Font-Awesome/blob/6.x/LICENSE.txt')},
]
const notice=text('NOTICE.md','https://github.com/NoLimit112172/mecoffe-scene/blob/main/NOTICE.md')
onMounted(()=>{document.title='MeCoffe · 来源与许可'})
</script>
<style scoped>.license-page{max-width:1000px;margin:auto;padding:36px 24px 60px;color:#244b46;font:14px/1.85 'Microsoft YaHei',sans-serif;text-align:left;background:#f2f5ee;min-height:100vh}.license-page header{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.license-page header p{font-size:11px;letter-spacing:2px}.license-page h1{font-size:28px}.license-page header a{margin-left:auto}.license-page a{color:#267d68}.notice{padding:16px;border:1px solid #e8d79d;background:#fff6db;border-radius:9px}.license-page section{margin:20px 0;padding:16px 22px;border:1px solid #d6e0d4;border-radius:10px;background:white}.license-page h2{font-size:18px;margin:0 0 8px}.license-page p{margin:8px 0}</style>
