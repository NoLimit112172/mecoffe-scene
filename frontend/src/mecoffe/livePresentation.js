import {actionLabel} from './eventPresentation.js'
import {shopLetter} from './shopPresentation.js'

const TERMINAL=new Set(['completed','failed','cancelled'])
const DEFAULT_MESSAGE='本日进行中，汇总尚未更新'

/** 日汇总公布后即进入下一展示日，不修改引擎尚未推进的 active_step。 */
export function liveProgressPresentation(state={}){
  const rawTotal=state.bootstrap?.plan?.runtime?.num_steps
  const total=Number.isSafeInteger(rawTotal)&&rawTotal>0?rawTotal:0
  const completed=Math.min(total,Math.max(0,Number.isSafeInteger(state.completedStep)?state.completedStep:0))
  const day=total?Math.min(total,completed+1):0
  const allCalculated=total>0&&completed===total
  let message=state.message||''
  // Preserve errors, partial-run notices and the terminal tail/artifact wait.
  if(!state.error&&!TERMINAL.has(state.status)&&(!message||message===DEFAULT_MESSAGE)){
    message=allCalculated?'全部天数已计算，等待运行收尾'
      :state.status==='queued'?'运行正在排队，尚未开始计算'
      :state.status==='initializing'?'正在准备模拟，尚未开始计算'
      :day?`第 ${day} 天进行中，汇总尚未更新`:message
  }
  return {total,completed,day,allCalculated,label:allCalculated?'全部天数已计算':day?`第 ${day}/${total} 天`:'',message}
}

export function liveEventCardTitle(event){
  if(event.action==='purchase_product'&&event.outcome==='executed')return event.evidence_status==='verified'?'购买已核实':event.evidence_status==='unverified'?'订单未核实':'尝试购买 · 订单待核对'
  const suffix={declined:'被拒绝',failed:'执行失败',unknown:'结果未知',noop:'无操作'}[event.outcome]
  return actionLabel(event.action)+(suffix?' · '+suffix:'')
}

/** 购买状态放标题，正文只使用确有证据的商品、示意门店、数量与订单号。 */
export function liveEventCardBody(event,plan={}){
  if(event.action==='purchase_product'){
    const parts=[]
    if(typeof event.product_name==='string'&&event.product_name.trim())parts.push(event.product_name.trim())
    const brands=[...(plan.economy?.brands||[])].sort((a,b)=>a.brand_id<b.brand_id?-1:a.brand_id>b.brand_id?1:0)
    const ordinal=brands.findIndex(brand=>brand.brand_id===event.brand_id)
    if(ordinal>=0)parts.push(`门店 ${shopLetter(ordinal)}（示意）`)
    if(Number.isSafeInteger(event.quantity)&&event.quantity>0)parts.push(`数量 ${event.quantity}`)
    if(typeof event.order_id==='string'&&event.order_id.trim())parts.push(`订单号：${event.order_id.trim()}`)
    else if(parts.length)parts.push('尚无订单号')
    return parts.join(' · ')
  }
  const body=typeof event.text==='string'?event.text.trim():''
  return body===liveEventCardTitle(event)?'':body
}
