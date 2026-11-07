<template>
  <section class="config-import" aria-label="本地配置导入" @dragover.prevent="dragging=true" @dragleave.prevent="dragging=false" @drop.prevent="dropFiles" :class="{dragging}">
    <div class="import-intro"><strong>一次导入配置或回放文件</strong><p>这是开发调试用；在团队网站里打开时数据会自动读取，不需要导入。</p></div>
    <div class="import-actions">
      <label class="file-choice">选择文件或 ZIP<input aria-label="配置文件" type="file" multiple accept=".json,.zip,application/json,application/zip" :disabled="working" @change="chooseFiles"/></label>
      <button :disabled="working" @click="sample('config')">加载合成样例</button>
      <button :disabled="working" class="secondary" @click="sample('replay')">加载合成回放样例</button>
    </div>
    <p class="import-hint">也可将多个文件或 ZIP 拖到这里。配置预览只需人物快照，角色字段与楼栋规则可选；运行回放需配套轨迹、快照和计划。</p>
    <span v-if="working" role="status">正在识别文件…</span>
  </section>
</template>
<script setup>
import {computed,ref} from 'vue'
import {importPreviewFiles,loadSyntheticPreview} from '../mecoffe/previewImport.js'
const props=defineProps({busy:{type:Boolean,default:false}})
const emit=defineEmits(['start','loaded','error'])
const parsing=ref(false),dragging=ref(false)
const working=computed(()=>props.busy||parsing.value)
async function run(operation){
  if(working.value)return
  parsing.value=true;dragging.value=false;emit('start')
  try{emit('loaded',await operation())}
  catch(error){emit('error',error.message||'文件无法读取，请检查后重试')}
  finally{parsing.value=false}
}
function chooseFiles(event){const files=Array.from(event.target.files||[]);if(files.length)void run(()=>importPreviewFiles(files));event.target.value=''}
function dropFiles(event){dragging.value=false;const files=Array.from(event.dataTransfer?.files||[]);if(files.length)void run(()=>importPreviewFiles(files))}
function sample(kind){void run(()=>loadSyntheticPreview(kind))}
</script>
<style scoped>
.config-import{padding:18px 22px;background:#fff;border-bottom:1px solid #d7e4dd;flex-shrink:0}.config-import.dragging{background:#e6f5ef;outline:2px dashed #2a896f;outline-offset:-6px}.import-intro strong{font-size:14px;color:#244d41}.import-intro p{margin:6px 0 14px;color:#657e73;font-size:12px}.import-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.file-choice{position:relative;display:inline-flex;align-items:center;border:1px solid #91b5a4;border-radius:7px;padding:9px 15px;background:#f4faf6;color:#23664f;font-size:12px;cursor:pointer}.file-choice input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}.file-choice:focus-within{outline:2px solid #2a896f;outline-offset:2px}.import-actions button{border:0;border-radius:7px;padding:10px 16px;background:#267e64;color:#fff;cursor:pointer;font-size:12px}.import-actions .secondary{background:#eaf1ed;color:#335c4d}.import-actions button:disabled{opacity:.5;cursor:wait}.import-hint{font-size:11px;color:#7a8f85;line-height:1.6;margin:12px 0 0}.config-import [role=status]{font-size:12px;color:#267e64}
</style>
