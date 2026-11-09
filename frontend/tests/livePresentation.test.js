import test from 'node:test'
import assert from 'node:assert/strict'
import {describeEvent} from '../src/mecoffe/replay.js'

const index={scene:{meta:{live_run:true},brands:[]},people:new Map([['sample_01',{name:'合成人物'}]])}
test('live comments without an author reference do not invent names or missing text',()=>{
  assert.equal(describeEvent(index,{actor:'sample_01',type:'comment'}),'合成人物 评论了一条帖子')
  assert.equal(describeEvent(index,{actor:'sample_01',type:'comment',text:'合成评论'}),'合成人物 评论了一条帖子：合成评论')
})
test('pending and unverified live purchases never read as a successful purchase',()=>{
  const event={actor:'sample_01',type:'purchase_pending',outcome:'executed'}
  assert.equal(describeEvent(index,event),'合成人物 尝试购买 · 订单待核对')
  assert.equal(describeEvent(index,{...event,evidence_status:'unverified'}),'合成人物 订单未核实')
})
