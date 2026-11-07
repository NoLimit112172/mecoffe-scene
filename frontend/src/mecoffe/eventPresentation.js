// Readable presentation only. Original action outcomes and payloads remain untouched.
const ACTION_LABELS=Object.freeze({
  purchase_product:'购买',create_post:'发帖',create_comment:'评论',publish_ad:'投放广告',
  set_product_price:'调价',follow:'关注',interview:'访谈',
})
const NON_SUCCESS=new Set(['declined','unknown','failed'])
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
export function actionLabel(action){return Object.hasOwn(ACTION_LABELS,action)?ACTION_LABELS[action]:String(action||'未命名动作')}
export function unsuccessfulOutcome(event){
  const value=event?.outcome||event?.type
  return NON_SUCCESS.has(value)?value:null
}
function readable(value,keys,depth=0){
  if(depth>5)return ''
  if(typeof value==='string'){
    const text=value.trim()
    if(!text)return ''
    // Exporters may wrap the result itself, or individual reason fields, in JSON.
    if(/^[\[{"]/.test(text)){
      try{return readable(JSON.parse(text),keys,depth+1)}catch{
        // Bracketed prose such as [库存] 不足 is still a human message.
        if(text.startsWith('{')||/^\[\s*[\[{"\d-]/u.test(text))return ''
      }
    }
    return text.replace(/\s+/g,' ')
  }
  if(object(value)){
    for(const key of keys){
      if(!Object.hasOwn(value,key))continue
      const message=readable(value[key],keys,depth+1)
      if(message)return message
    }
  }
  if(Array.isArray(value))return value.map(item=>readable(item,keys,depth+1)).filter(Boolean).join('；')
  return ''
}
/** Choose human-readable result fields without dumping unrelated evidence into prose. */
export function eventResultMessage(event){
  const outcome=unsuccessfulOutcome(event)
  const keys=outcome==='unknown'?['message','reason','error','detail','explanation']:['reason','error','message','detail','explanation']
  const raw=Object.hasOwn(event||{},'raw_result')?event.raw_result:undefined
  const message=readable(raw,keys)||readable(event?.text,keys)
  if(message)return Array.from(message).length>240?Array.from(message).slice(0,240).join('')+'…':message
  return outcome==='unknown'?'未提供进一步说明':'未提供可读原因'
}
export function describeUnsuccessfulEvent(actor,event){
  const outcome=unsuccessfulOutcome(event),action=actionLabel(event.action)
  const status=outcome==='declined'?'被拒绝':outcome==='unknown'?'结果未知':'执行失败'
  return `${actor} 的${action}${status}：${eventResultMessage(event)}`
}
/** A separate disclosure retains raw values, including strings, booleans and null. */
export function rawEventResult(event){
  return {action:event?.action??null,outcome:event?.outcome??event?.type??null,
    raw_result:Object.hasOwn(event||{},'raw_result')?event.raw_result:event?.text??null}
}
