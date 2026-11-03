<template>
  <div class="visual-controls">
    <div class="light-control" aria-label="建筑风格"><span>建筑</span><b>{{buildingStyle==='yulan'?'YuLan':'简洁'}}</b></div>
    <div class="light-control" aria-label="人物显示"><span>人物</span><b>写实人物</b></div>
    <div class="quality-control" aria-label="画质"><span>画质</span><button :aria-pressed="quality === 'high'" :class="{active:quality === 'high'}" aria-label="高画质" @click="$emit('update:quality','high')">高</button><button :aria-pressed="quality === 'low'" :class="{active:quality === 'low'}" aria-label="低画质" @click="$emit('update:quality','low')">低</button></div>
    <label class="cycle-control"><input type="checkbox" :checked="cycle" aria-label="日夜循环" @change="$emit('update:cycle',$event.target.checked)" />日夜循环</label>
    <label class="light-control"><select aria-label="光照预览" :value="cycle ? 'auto' : String(hour)" @change="chooseLight($event.target.value)"><option value="auto">跟随回放</option><option value="12">正午</option><option value="18">傍晚</option><option value="23">夜晚</option></select><span>{{ clock }}</span></label>
  </div>
</template>
<script setup>
defineProps({buildingStyle:{type:String,default:'yulan'},characterPool:{type:String,default:'all'},quality:{type:String,default:'high'},cycle:{type:Boolean,default:true},hour:{type:Number,default:12},clock:{type:String,default:'06:00'}})
const emit = defineEmits(['update:characterPool','update:quality','update:cycle','update:hour'])
function chooseLight(value) {
  if (value === 'auto') { emit('update:cycle',true); return }
  emit('update:hour',Number(value))
  emit('update:cycle',false)
}
</script>
<style scoped>
.visual-controls{display:flex;gap:10px;align-items:center;font-size:11px;flex-wrap:wrap;color:#365a50}.quality-control{display:flex;align-items:center;gap:3px;background:#e2eae1;padding:3px 4px;border-radius:7px}.quality-control>span{padding:0 4px}.quality-control button{border:0;border-radius:5px;background:transparent;padding:4px 7px;cursor:pointer;color:#5b736b;font:inherit}.quality-control button.active{background:#277b68;color:white}.cycle-control{display:flex;align-items:center;gap:4px;white-space:nowrap}.cycle-control input{accent-color:#277b68;margin:0}.light-control{display:flex;align-items:center;gap:5px;white-space:nowrap}.light-control select{font:inherit;border:1px solid #cad8c9;border-radius:6px;background:#fff;color:#365a50;padding:5px}.light-control span{font-variant-numeric:tabular-nums;min-width:32px;color:#6b8278}
</style>
