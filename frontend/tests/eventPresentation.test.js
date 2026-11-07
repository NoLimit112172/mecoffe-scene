import test from 'node:test'
import assert from 'node:assert/strict'
import {eventResultMessage,describeUnsuccessfulEvent,rawEventResult,actionLabel} from '../src/mecoffe/eventPresentation.js'
import {describeEvent,indexScene,stateAt,personPurchases,cupsByPersonAt} from '../src/mecoffe/replay.js'

const declined={type:'declined',outcome:'declined',action:'purchase_product',actor:'sample_01',raw_result:{accepted:false,reason:'合成样例：条件未满足',message:'次要说明'}}
test('declined and unknown show readable fields in outcome-specific priority, never a raw JSON object',()=>{
  const before=JSON.stringify(declined)
  assert.equal(eventResultMessage(declined),'合成样例：条件未满足')
  assert.equal(describeUnsuccessfulEvent('样例人物 01',declined),'样例人物 01 的购买被拒绝：合成样例：条件未满足')
  const unknown={...declined,type:'unknown',outcome:'unknown',action:'create_post',raw_result:{reason:'次要原因',message:'未确认写入状态'}}
  assert.equal(eventResultMessage(unknown),'未确认写入状态')
  assert.match(describeUnsuccessfulEvent('样例人物 01',unknown),/发帖结果未知：未确认写入状态/)
  assert.equal(JSON.stringify(declined),before)
})
test('plain strings and nested JSON-wrapped readable messages are normalized without unrelated evidence',()=>{
  for(const [value,expected]of [
    ['请求被拒绝','请求被拒绝'],
    [{reason:'[库存] 不足'},'[库存] 不足'],
    [{reason:'\"库存不足'},'\"库存不足'],
    [JSON.stringify({accepted:false,reason:'条件未满足'}),'条件未满足'],
    [{error:{message:'无法确认回执'}},'无法确认回执'],
    [{reason:JSON.stringify({message:'嵌套说明'})},'嵌套说明'],
    [{detail:['说明一','说明二']},'说明一；说明二'],
    [{message:' 第一行\n  第二行 '},'第一行 第二行'],
  ])assert.equal(eventResultMessage({...declined,raw_result:value}),expected)
  assert.equal(eventResultMessage({...declined,raw_result:undefined,text:JSON.stringify({reason:'旧包装说明'})}),'旧包装说明')
})
test('missing, malformed or non-readable results get a clear fallback, and long prose is bounded',()=>{
  for(const raw_result of [null,false,42,{accepted:false},{constructor:'原型键不作为原因'},'{broken JSON']){
    assert.equal(eventResultMessage({...declined,raw_result}),'未提供可读原因')
  }
  assert.equal(eventResultMessage({type:'unknown',raw_result:{accepted:false}}),'未提供进一步说明')
  assert.equal(actionLabel('constructor'),'constructor')
  const long='合成说明'.repeat(100)
  assert.equal(Array.from(eventResultMessage({...declined,raw_result:{reason:long}})).length,241)
})
test('raw disclosure preserves original action, outcome and exact result type separately from readable prose',()=>{
  for(const value of [{accepted:false,reason:'条件未满足'},JSON.stringify({reason:'条件未满足'}),null,false]){
    const event={...declined,raw_result:value},before=JSON.stringify(event)
    assert.deepEqual(rawEventResult(event),{action:'purchase_product',outcome:'declined',raw_result:value})
    eventResultMessage(event)
    assert.equal(JSON.stringify(event),before)
  }
})
function scene(){return {meta:{generic_replay:true},campus:{locations:[]},brands:[{brand_id:'brand_gamma'},{brand_id:'brand_alpha'},{brand_id:'brand_beta'}],
  people:[{id:'sample_01',name:'样例人物 01'}],days:[{step:1}],events:[
    {key:'success',step:1,type:'purchase',outcome:'executed',actor:'sample_01',brand_id:'brand_alpha',product_name:'样例商品',quantity:1,order_id:'order_1',amount_fen:990},
    {key:'declined',step:1,...declined},
    {key:'unknown',step:1,type:'unknown',outcome:'unknown',actor:'sample_01',action:'create_post',raw_result:{message:'未确认写入'}},
  ]}}
test('generic event store labels share stable brand identities and legacy successful text stays unchanged',()=>{
  const value=scene(),index=indexScene(value),event=value.events[0]
  assert.match(describeEvent(index,event),/门店 A（示意） · 样例商品/)
  assert.match(describeEvent(index,{type:'ad',actor:'sample_01',brand_id:'brand_beta',text:'合成广告'}),/门店 B（示意）/)
  assert.match(describeEvent(index,{type:'price',actor:'sample_01',brand_id:'brand_gamma'}),/门店 C（示意）/)
  index.scene.brands.reverse()
  assert.match(describeEvent(index,event),/门店 A（示意）/)
  delete index.scene.meta.generic_replay
  assert.equal(describeEvent(index,event),'样例人物 01 购买 样例商品 ×1，¥9.90')
})
test('readable descriptions and disclosures do not change rejected or unknown success accounting',()=>{
  const value=scene(),before=JSON.stringify(value),index=indexScene(value)
  for(const event of value.events){describeEvent(index,event);rawEventResult(event)}
  const state=stateAt(index,3)
  assert.equal(state.orders,1);assert.equal(state.posts,0);assert.equal(state.cups.brand_alpha,1);assert.equal(state.revenueFen.brand_alpha,990)
  assert.deepEqual(personPurchases(index,'sample_01',3),{brand_alpha:1})
  assert.deepEqual(cupsByPersonAt(index,3).get('sample_01'),{brand_alpha:1})
  assert.equal(JSON.stringify(value),before)
})
