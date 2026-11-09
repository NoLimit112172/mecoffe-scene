import test from 'node:test'
import assert from 'node:assert/strict'
import {describeEvent} from '../src/mecoffe/replay.js'
import {liveProgressPresentation,liveEventCardTitle,liveEventCardBody} from '../src/mecoffe/livePresentation.js'

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

const progressState=(completedStep=0,activeStep=1,extra={})=>({status:'running',completedStep,activeStep,bootstrap:{plan:{runtime:{num_steps:2}}},message:'本日进行中，汇总尚未更新',...extra})
test('a fixed day summary advances the displayed day even before active_step catches up',()=>{
  const state=progressState(1,1),before=JSON.stringify(state),result=liveProgressPresentation(state)
  assert.equal(result.label,'第 2/2 天')
  assert.equal(result.day,2)
  assert.equal(result.completed,1)
  assert.equal(result.message,'第 2 天进行中，汇总尚未更新')
  assert.equal(result.allCalculated,false)
  assert.equal(JSON.stringify(state),before)
  assert.equal(liveProgressPresentation(progressState(0,1)).label,'第 1/2 天')
})
test('all days computed waits for finalization without displaying a fictitious next day',()=>{
  const result=liveProgressPresentation(progressState(2,2))
  assert.equal(result.day,2)
  assert.equal(result.allCalculated,true)
  assert.equal(result.label,'全部天数已计算')
  assert.equal(result.message,'全部天数已计算，等待运行收尾')
  assert(!result.label.includes('3'))
  assert.equal(liveProgressPresentation(progressState(1,1,{bootstrap:{plan:{runtime:{num_steps:1}}}})).day,1)
})
test('day presentation keeps login, partial-run and terminal artifact wait messages intact',()=>{
  for(const state of [
    progressState(1,1,{error:{code:'NETWORK_ERROR'},message:'实时请求超时，将自动重试'}),
    progressState(1,2,{status:'failed',message:'运行失败，保留已确认结果（部分）'}),
    progressState(2,2,{message:'运行已结束，正在接收剩余活动与日汇总…'}),
    progressState(2,2,{status:'completed',message:'正式回放产物暂未就绪，正在等待…'}),
  ])assert.equal(liveProgressPresentation(state).message,state.message)
})
test('purchase cards show concrete evidence instead of repeating their status title',()=>{
  const plan={economy:{brands:[{brand_id:'brand_beta'},{brand_id:'brand_alpha'}]}}
  const event={action:'purchase_product',outcome:'executed',product_name:'合成商品',brand_id:'brand_beta',quantity:2,order_id:'order_sample'}
  for(const evidence_status of ['pending','verified','unverified']){
    const value={...event,evidence_status,text:liveEventCardTitle({...event,evidence_status})},body=liveEventCardBody(value,plan)
    assert.match(body,/合成商品/);assert.match(body,/门店 B（示意）/)
    assert.match(body,/数量 2/);assert.match(body,/订单号：order_sample/)
    assert.notEqual(body,liveEventCardTitle(value))
  }
  assert.equal(liveEventCardBody({...event,order_id:undefined},plan),'合成商品 · 门店 B（示意） · 数量 2 · 尚无订单号')
  assert.equal(liveEventCardBody({...event,brand_id:'unknown_brand'},plan),'合成商品 · 数量 2 · 订单号：order_sample')
})
test('cards without extra evidence have no duplicate or invented body',()=>{
  for(const evidence_status of ['pending','verified','unverified']){
    const event={action:'purchase_product',outcome:'executed',evidence_status}
    event.text=liveEventCardTitle(event)
    assert.equal(liveEventCardBody(event),'')
  }
  assert.equal(liveEventCardBody({action:'create_post',outcome:'executed',text:'发帖'}),'')
  assert.equal(liveEventCardBody({action:'create_post',outcome:'executed',text:'确实存在的合成正文'}),'确实存在的合成正文')
})
