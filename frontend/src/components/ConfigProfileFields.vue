<template>
  <div v-if="person?.profile_fields?.length" class="profile-fields">
    <dl aria-label="人物属性"><div v-for="field in person.profile_fields" :key="field.source+':'+field.key"><dt>{{field.label}}</dt><dd>{{format(display(field))}}</dd></div></dl>
    <details class="raw-fields"><summary>数据详情</summary><dl aria-label="原始人物属性"><div v-for="field in person.profile_fields" :key="field.source+':'+field.key"><dt><code>{{field.key}}</code></dt><dd>{{raw(field.value)}}</dd></div></dl></details>
  </div>
</template>
<script setup>
import {displayStaticAttributeValue} from '../mecoffe/staticAttributeValues.js'
defineProps({person:{type:Object,default:null}})
function raw(value){return JSON.stringify(value)}
function display(field){return field.source==='static'?displayStaticAttributeValue(field.key,field.value):field.value}
function format(value){if(value===null)return '未提供';if(Array.isArray(value))return value.join('、');if(typeof value==='object')return JSON.stringify(value);return String(value)}
</script>
<style scoped>
.profile-fields{margin:14px 0}.profile-fields dl{display:grid;gap:0;margin:0}.profile-fields dl>div{padding:9px 0;border-top:1px solid #e5ece6}.profile-fields dt{font-size:12px;font-weight:600;color:#34574d}.profile-fields dd{margin:5px 0 0;color:#4b655c;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.raw-fields{margin-top:12px;font-size:11px;color:#70847b}.raw-fields summary{cursor:pointer}.raw-fields code{font-size:10px;overflow-wrap:anywhere}
</style>
