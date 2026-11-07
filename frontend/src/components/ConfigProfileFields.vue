<template><dl v-if="person?.profile_fields?.length" class="profile-fields" aria-label="人物属性"><div v-for="field in person.profile_fields" :key="field.source+':'+field.key"><dt>{{field.label}}<code>{{field.key}}</code></dt><dd>{{format(field.value)}}</dd></div></dl></template>
<script setup>
defineProps({person:{type:Object,default:null}})
function format(value){if(value===null)return '未提供';if(Array.isArray(value))return value.join('、');if(typeof value==='object')return JSON.stringify(value);return String(value)}
</script>
<style scoped>.profile-fields{margin:14px 0;display:grid;gap:0}.profile-fields>div{padding:9px 0;border-top:1px solid #e5ece6}.profile-fields dt{font-size:12px;font-weight:600;color:#34574d}.profile-fields code{display:block;font-size:10px;font-weight:400;color:#87998f;margin-top:2px;overflow-wrap:anywhere}.profile-fields dd{margin:5px 0 0;color:#4b655c;font-size:12px;line-height:1.6;overflow-wrap:anywhere}</style>
