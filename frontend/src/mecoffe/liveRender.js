import {indexScene,stateAt} from './replay.js'

/** 保持渲染器持有的索引身份，只更新运行数据，地图和人物模型无需重建。 */
export function refreshLiveIndex(index, scene) {
  const next=indexScene(scene)
  Object.assign(index,next)
  return index
}

/** 日汇总可能先到；全局指标使用核实汇总，不用尚未补齐的动作列表代替。 */
export function confirmedPresentationTotals(index,cursor,liveSummary=null){
  if(liveSummary)return {orders:liveSummary.orders||0,quantity:liveSummary.quantity||0,revenue_fen:liveSummary.revenue_fen||0,
    posts:liveSummary.posts||0,comments:liveSummary.comments||0,source:'day_summary'}
  const state=index?stateAt(index,cursor):null
  return {orders:state?.orders||0,quantity:Object.values(state?.cups||{}).reduce((n,v)=>n+v,0),
    revenue_fen:Object.values(state?.revenueFen||{}).reduce((n,v)=>n+v,0),posts:state?.posts||0,comments:state?.comments||0,source:'replay_cursor'}
}

/** 队列只决定展示，不改变已经确认的订单；状态升级可以产生一次新动画。 */
export function takeLiveAnimations(state, seen) {
  if(state?.paused)return []
  const result=[]
  for(const event of (state?.animationQueue||[]).slice(-32)){
    const value=event.event||event
    const token=`${value.key}|${value.type}|${value.order_id||''}|${value.evidence_status||''}`
    if(seen.has(token))continue
    seen.add(token)
    if(!['refresh','trend','search_posts','search_user','do_nothing'].includes(value.action)&&value.type!=='noop')result.push(value)
  }
  // Retain one token per displayed update until this run's view is disposed.
  // Evicting by size could replay a quiet actor whose old queue item remains
  // while another actor produces many newer updates.
  return result
}

/** 三维和 GIS 使用相同的短文案，不把未核实的购买画成成功。 */
export function liveEventLabel(event) {
  if(event.evidence_status==='unverified')return '订单未核实'
  if(event.type==='purchase_pending'||event.type==='purchase_unverified')return event.type==='purchase_unverified'?'订单未核实':'尝试购买 · 订单待核对'
  if(event.type==='purchase')return '订单已核实'
  if(event.outcome==='declined')return '动作被拒绝'
  if(event.outcome==='failed')return '动作失败'
  if(event.outcome==='unknown')return '结果未知'
  const label={post:'发帖',comment:'评论',ad:'广告',follow:'关注',price:'调价',interview:'访谈'}[event.type]
  return label?`${label}${event.text?' · '+event.text.slice(0,45):''}`:'活动更新'
}

/** 独立展示时钟推进已核实的行走，不按会变化的事件数组回放旧订单。 */
export function advanceLiveMotion(motion, milliseconds, elapsedSeconds=0) {
  const next=elapsedSeconds+Math.min(250,Math.max(0,Number(milliseconds)||0))/1000
  motion.purchases=[]
  motion.sync(0,next)
  return next
}

/** 限制已进入人物内部的待执行队列；当前行走与真实订单记录保持不变。 */
export function enqueueLivePurchase(motion,event,limit=2){
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('实时人物动画队列上限必须为正整数')
  if(event?.type!=='purchase'||event.outcome&&event.outcome!=='executed')return false
  const person=motion?.people.get(event.actor),order=event.order_id||event.key
  if(!person||motion.seen.has(order))return false
  motion.event(event)
  if(person.queue.length>limit)person.queue.splice(0,person.queue.length-limit)
  return person.queue.some(item=>item.event===event)
}
