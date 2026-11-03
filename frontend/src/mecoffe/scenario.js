// Prepared scenario loading only; replay.js remains the simulation log reader.
export function scenarioId(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw new Error('场景编号无效')
  return value
}
export function scenarioTime(time, position=0) {
  if(!time || !['day','hour'].includes(time.step_unit) || !Number.isInteger(time.steps) || time.steps<1 || time.steps>10000)throw new Error('模拟时间配置无效')
  try {new Intl.DateTimeFormat('zh-CN',{timeZone:time.timezone}).format()} catch {throw new Error('模拟时区无效')}
  const intervals=time.intervals
  if(!Array.isArray(intervals)||intervals.length!==time.steps)throw new Error('模拟时间段缺失')
  const clamped=Math.max(0,Math.min(time.steps,Number(position)||0)),index=Math.min(time.steps-1,Math.floor(clamped))
  const a=Date.parse(intervals[index].start),b=Date.parse(intervals[index].end)
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw new Error('模拟时间段无效')
  const milliseconds=a+(b-a)*(clamped===time.steps?1:clamped-index),date=new Date(milliseconds)
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:time.timezone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(date)
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value])),hour=Number(p.hour)+Number(p.minute)/60+Number(p.second)/3600
  // dayLighting / visualClock use phase 0 at 06:00, not at midnight.
  return {iso:date.toISOString(),hour,phase:((hour-6+24)%24)/24,label:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,timezone:time.timezone}
}
export async function loadScenario(id,{signal,fetcher=fetch,base=import.meta.env?.BASE_URL||'/'}={}) {
  const url=`${base}mecoffe/scenarios/${scenarioId(id)}/`
  async function read(name) {
    const response=await fetcher(url+name,{signal,cache:'no-store'})
    if(!response.ok)throw new Error(`场景文件 ${name} 暂不可用（${response.status}）`)
    const text=await response.text()
    let data
    try{data=JSON.parse(text)}catch{throw new Error(`场景文件 ${name} 格式不正确`)}
    return {data,text}
  }
  const {data:manifest}=await read('scenario.json')
  if(manifest.schema_version!=='mecoffe.scenario.v1'||manifest.id!==id||typeof manifest.files!=='object')throw new Error('场景清单格式无效')
  scenarioTime(manifest.simulation_time)
  let previous=-Infinity
  for(const interval of manifest.simulation_time.intervals){const start=Date.parse(interval.start),end=Date.parse(interval.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<previous)throw new Error('模拟时间段无效');previous=end}
  const files={}
  await Promise.all(Object.entries(manifest.files).map(async([name,expected])=>{
    if(!/^[a-z_0-9-]+\.json$/.test(name))throw new Error('场景文件名无效')
    const {data,text}=await read(name)
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)),actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
    if(actual!==expected)throw new Error(`场景文件 ${name} 已改变，请重新生成场景`)
    files[name]=data
  }))
  if(!files['campus3d.json']||!files['asset_assignments.json']||!files['landcover.json'])throw new Error('场景地图文件不完整')
  if(manifest.simulation_data && (!files['trajectory.json']||!files['location_mapping.json']))throw new Error('场景回放文件不完整')
  return {manifest,files}
}
