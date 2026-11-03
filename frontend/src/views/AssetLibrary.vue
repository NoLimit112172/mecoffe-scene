<template>
  <div ref="rootEl" class="asset-library-page">
    <header class="library-header">
      <div><p class="eyebrow">MECOFFE · ASSET LIBRARY</p><h1>三维素材库</h1><p>浏览、旋转和选择原型。原型定义显示样式，不产生模拟行为或新的地图事实。</p></div>
      <RouterLink to="/mecoffe3d" class="back-link">返回三维校园 ↗</RouterLink>
    </header>
    <section class="library-toolbar" aria-label="素材筛选">
      <label><span>范围</span><select v-model="scope" aria-label="素材范围"><option value="campus">当前校区使用的素材</option><option value="">全部原型与原始素材</option></select></label>
      <label class="search-label"><span>搜索</span><input v-model="search" type="search" aria-label="搜索素材" placeholder="名称、类型或原型 ID" /></label>
      <label><span>类别</span><select v-model="category" aria-label="素材类别"><option value="">全部类别</option><option v-for="(label,key) in categories" :key="key" :value="key">{{ label }} · {{ stats.categories[key] || 0 }}</option></select></label>
      <label><span>来源</span><select v-model="source" aria-label="素材来源"><option value="">全部来源</option><option value="procedural">程序生成</option><option value="yulan">YuLan · Apache-2.0</option><option value="osm">OSM · ODbL</option><option value="valid">VALID 校园人物 · MIT</option><option value="kenney">Kenney 三维植被 · CC0</option><option value="rocketbox">Rocketbox 原始库 · MIT</option></select></label>
      <label v-if="source === 'rocketbox'"><span>人物分类</span><select v-model="humanGroup" aria-label="人物素材分类"><option value="">全部人形</option><option value="adults">成年人便装</option><option value="professions">职业装</option><option value="children">儿童</option></select></label>
      <span class="result-count" data-testid="asset-count">{{ filtered.length }} / {{ stats.total }} 个原型</span>
      <span class="renderer-note">单一 WebGL 画布 · 拖动卡片旋转</span>
    </section>
    <nav v-if="pagination.pageCount > 1" class="asset-pagination" aria-label="素材分页"><button :disabled="pagination.page === 1" @click="changePage(pagination.page-1)">上一页</button><span>第 {{ pagination.page }} / {{ pagination.pageCount }} 页 · 每页 {{ pagination.pageSize }} 个预览</span><button :disabled="pagination.page === pagination.pageCount" @click="changePage(pagination.page+1)">下一页</button></nav>
    <p v-if="pageError" class="page-error" role="alert">{{ pageError }}</p>
    <div class="asset-grid" aria-label="三维素材原型">
      <article v-for="prototype in pagination.items" :key="prototype.id" class="asset-card" :data-asset-card="prototype.id">
        <div :ref="el => setPreviewElement(prototype.id,el)" class="asset-preview" :data-asset-preview="prototype.id" :aria-label="`${prototype.title}三维预览，可拖动旋转`">
          <img v-if="!captions[prototype.id] && prototype.preview" class="fallback-preview" :src="prototype.preview" alt="原型缩略图，三维预览加载中" />
          <span class="preview-status" :class="{error:errors[prototype.id]}">{{ errors[prototype.id] || captions[prototype.id] || '正在准备三维预览…' }}</span>
        </div>
        <div class="asset-info">
          <div class="card-title"><h2>{{ prototype.title || prototype.id }}</h2><span>{{ categories[prototype.category] }}</span></div>
          <code class="prototype-id">{{ prototype.id }}</code>
          <p class="match-rule" :title="describeMatch(prototype.match)">{{ describeMatch(prototype.match) }}</p>
          <p v-if="prototype.scene_instance" class="match-rule">校内实例：{{ prototype.scene_instance.id }}</p>
          <p v-if="prototype.geometry_source" class="match-rule">地图几何：OpenStreetMap · ODbL-1.0；模型许可见下方</p>
          <label class="variant-label"><span>{{ prototype.category === 'character' ? '预览动作' : '变体' }}</span><select :value="selectedVariant(prototype)" :aria-label="`${prototype.title}变体`" @change="chooseVariant(prototype.id,$event.target.value)"><option v-for="variant in prototype.variants" :key="variant.id" :value="variant.id">{{ variant.title || variant.label || variant.id }}</option></select><small>{{ prototype.kind === 'parametric' ? '参数化生成器' : '固定模型' }}</small></label>
          <div class="provenance"><span :class="`source source-${prototype.source.type}`">{{ sourceLabels[prototype.source.type] }}</span><b>{{ prototype.license.spdx }}</b></div>
          <p class="source-path">{{ prototype.source.path }}</p>
          <a v-if="safeSourceUrl(prototype.source.url)" :href="safeSourceUrl(prototype.source.url)" target="_blank" rel="noopener noreferrer" class="source-link">查看来源 ↗</a>
          <details><summary>参数、匹配与许可</summary><dl><dt>匹配规则</dt><dd><pre>{{ pretty(prototype.match) }}</pre></dd><dt>当前参数</dt><dd><pre>{{ pretty(previewParams(prototype,selectedVariant(prototype))) }}</pre></dd><dt>来源</dt><dd>{{ prototype.source.title }}<br>{{ prototype.source.author }}</dd><dt>许可记录</dt><dd>{{ prototype.license.path || prototype.license.url }}<br>{{ prototype.license.note }}</dd></dl></details>
        </div>
      </article>
    </div>
    <p v-if="!filtered.length" class="no-results">没有匹配的原型，请调整搜索或筛选条件。</p>
    <footer class="library-footer">目录版本 {{ ASSET_CATALOG.schema_version }} · YuLan、Rocketbox、VALID、Kenney、项目程序生成与 © OpenStreetMap contributors 各自保留来源和许可。人物分类仅描述素材外观；校园与回放数据不受这里的预览选项影响。</footer>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ASSET_CATALOG, catalogStats, queryPrototypes } from '../mecoffe/assetCatalog.js'
import { AssetPreviewRenderer } from '../mecoffe/AssetPreviewRenderer.js'
import { ASSET_CATEGORY_LABELS, describeMatch, previewParams, safeSourceUrl, paginateAssets } from '../mecoffe/assetPreviewModel.js'

const route=useRoute(),rootEl=ref(null),search=ref(''),category=ref(''),source=ref(route.query.source === 'rocketbox'?'rocketbox':''),pageError=ref('')
const scope=ref(route.query.source?'':'campus'),humanGroup=ref(''),page=ref(1)
const variants=reactive({}),captions=reactive({}),errors=reactive({})
const elements=new Map(),categories=ASSET_CATEGORY_LABELS,stats=catalogStats()
const sourceLabels={procedural:'程序生成',yulan:'YuLan 图集',osm:'OpenStreetMap',rocketbox:'Microsoft Rocketbox',valid:'VALID 校园人物',kenney:'Kenney 三维植被'}
const hasIndividualAvatars=ASSET_CATALOG.prototypes.some(item=>item.source.type==='rocketbox'&&item.params.model_id)
let renderer=null,disposed=false,removeYuLanFactories=null
const filtered=computed(()=>queryPrototypes(null,{category:category.value || undefined,text:search.value}).filter(item=>(!source.value||item.source.type===source.value)
  && (!scope.value||item.scene_scope==='ustc')
  && (!humanGroup.value || source.value!=='rocketbox' || item.params.group===humanGroup.value)
  && !(hasIndividualAvatars && source.value==='rocketbox' && !search.value && item.id==='character.rocketbox')))
const pagination=computed(()=>paginateAssets(filtered.value,page.value,12))
function changePage(value){page.value=value;if(rootEl.value)rootEl.value.scrollTop=0}
const pretty=value=>JSON.stringify(value,null,2)
const selectedVariant=prototype=>variants[prototype.id] || prototype.variants[0]?.id || 'default'
function setPreviewElement(id,element) {if(element)elements.set(id,element);else elements.delete(id)}
function chooseVariant(id,value) {
  const prototype=ASSET_CATALOG.prototypes.find(item=>item.id===id)
  if(prototype&&selectedVariant(prototype)===value)return
  variants[id]=value;delete errors[id];delete captions[id]
}
async function syncItems() {
  await nextTick()
  if(disposed||!renderer)return
  renderer.setItems(pagination.value.items.map(prototype=>({prototype,variant:selectedVariant(prototype),element:elements.get(prototype.id)})).filter(item=>item.element))
}
watch([search,category,source,humanGroup,scope],()=>{page.value=1})
watch([filtered,variants,page],()=>{void syncItems()},{deep:true})
onMounted(async()=>{
  document.title='MeCoffe · 三维素材库'
  try {
    const {installYuLanPreviewFactories}=await import('../mecoffe/assetPreviewYulan.js')
    if(disposed)return
    removeYuLanFactories=installYuLanPreviewFactories()
    renderer=new AssetPreviewRenderer({host:rootEl.value,onCaption:(id,text)=>{captions[id]=text},onError:(id,text)=>{errors[id]=`预览失败：${text}`}})
    void syncItems()
  }
  catch(error){pageError.value=`三维预览不可用：${error.message || error}。目录与许可信息仍可浏览。`}
})
onBeforeUnmount(()=>{disposed=true;renderer?.dispose();renderer=null;removeYuLanFactories?.();elements.clear()})
</script>

<style scoped>
.asset-library-page{position:fixed;inset:0;overflow:auto;background:#f0f3ed;color:#223c3b;font-family:'Microsoft YaHei',system-ui,sans-serif;padding:24px 26px 28px;text-align:left;color-scheme:light}.asset-library-page *{box-sizing:border-box}.library-header,.library-toolbar,.library-footer,.page-error,.no-results{position:relative;z-index:3}.library-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}.eyebrow{font-size:10px;letter-spacing:2px;color:#4d8275;font-weight:800;margin:0 0 6px}.library-header h1{font-size:28px;letter-spacing:1px;margin:0}.library-header>div>p:last-child{font-size:12px;color:#6a7e75;margin:8px 0 0;line-height:1.7}.back-link{font-size:12px;color:#277b68;text-decoration:none;border:1px solid #c8d6c8;padding:9px 13px;border-radius:8px;background:#fff;white-space:nowrap}.library-toolbar{display:flex;align-items:center;gap:15px;padding:12px 15px;background:#fff;border:1px solid #dbe3d7;border-radius:11px;margin-bottom:18px;flex-wrap:wrap}.library-toolbar label{display:flex;align-items:center;gap:8px;font-size:11px;color:#60796d}.library-toolbar input,.library-toolbar select,.variant-label select{font:inherit;color:#2b5149;border:1px solid #d1ddcb;border-radius:6px;padding:6px 8px;background:#f7f9f3}.library-toolbar input{width:230px}.result-count{font-size:12px;font-weight:700;margin-left:auto;color:#277b68}.renderer-note{font-size:10px;color:#7d8c81}.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px;position:relative}.asset-card{background:#fff;border:1px solid #dbe3d7;border-radius:12px;overflow:hidden;min-width:0;box-shadow:0 3px 10px #233e2b05}.asset-preview{position:relative;height:190px;cursor:grab;background:radial-gradient(ellipse at 50% 80%,#dce5d7 0,#eef2e9 55%,#f4f6ee 100%);touch-action:pan-y}.asset-preview:active{cursor:grabbing}.fallback-preview{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:70%;max-height:80%;opacity:.3}.preview-status{position:absolute;left:9px;bottom:8px;max-width:calc(100% - 18px);font-size:9px;color:#61796c;background:#ffffffe8;padding:3px 6px;border-radius:4px;z-index:2;pointer-events:none;line-height:1.5}.preview-status.error{color:#a25d34}.asset-info{position:relative;z-index:2;background:#fff;padding:13px 15px 12px}.card-title{display:flex;gap:10px;align-items:center}.card-title h2{font-size:15px;margin:0;flex:1}.card-title>span{font-size:9px;color:#578170;background:#eaf2e7;padding:3px 5px;border-radius:4px;white-space:nowrap}.prototype-id{display:block;font-size:10px;color:#7c8e81;margin:6px 0;overflow-wrap:anywhere}.match-rule{font-size:10px;line-height:1.6;color:#6e7f74;margin:7px 0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.variant-label{display:flex;align-items:center;gap:6px;font-size:10px;margin:9px 0}.variant-label select{font-size:10px;min-width:94px;max-width:180px;padding:4px 6px}.variant-label small{margin-left:auto;font-size:9px;color:#85907f;white-space:nowrap}.provenance{display:flex;gap:6px;align-items:center;font-size:9px;margin-top:10px}.provenance b{font-weight:500;color:#7a8879;overflow-wrap:anywhere}.source{padding:3px 5px;border-radius:4px;background:#eaf2e7;color:#52846c;white-space:nowrap}.source-yulan{background:#f1eaf7;color:#806299}.source-osm{background:#e6eef4;color:#517b91}.source-path{font-size:9px;color:#8a9587;overflow-wrap:anywhere;line-height:1.6;margin:5px 0 0}.source-link{font-size:10px;color:#398170}.asset-info details{margin-top:10px;border-top:1px solid #edf0e8;padding-top:9px}.asset-info summary{font-size:10px;cursor:pointer;color:#4b7967}.asset-info dl{font-size:10px;line-height:1.6;margin:9px 0 0}.asset-info dt{font-weight:700;color:#527561}.asset-info dd{margin:3px 0 9px;color:#7a8779;overflow-wrap:anywhere}.asset-info pre{font:9px/1.5 Consolas,monospace;white-space:pre-wrap;margin:0;background:#f6f8f2;padding:6px;border-radius:4px;color:#6a7c6d}.library-footer{font-size:10px;color:#7a897b;line-height:1.8;margin-top:24px;background:#f0f3ed}.page-error{border:1px solid #d9b797;background:#fff2df;padding:12px;border-radius:8px;font-size:12px}.no-results{font-size:13px;padding:50px;text-align:center}.asset-library-page button:focus-visible,.asset-library-page select:focus-visible,.asset-library-page input:focus-visible,.asset-library-page a:focus-visible{outline:3px solid #65a58d;outline-offset:2px}@media(max-width:800px){.asset-library-page{padding:16px}.library-header{align-items:flex-start}.library-header h1{font-size:23px}.library-header>div>p:last-child{max-width:400px}.renderer-note{display:none}.library-toolbar{gap:10px}.library-toolbar input{width:170px}.result-count{margin-left:0}.asset-grid{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}}@media(prefers-reduced-motion:reduce){.asset-preview{scroll-behavior:auto}}
</style>

<style scoped>
.asset-pagination{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 18px;font-size:12px}.asset-pagination button{border:1px solid #bed1c0;background:white;border-radius:6px;padding:6px 12px;color:#37634d;cursor:pointer}.asset-pagination button:disabled{opacity:.4;cursor:default}
</style>
