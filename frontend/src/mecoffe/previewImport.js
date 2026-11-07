import {ConfigPreviewError, normalizeConfigPreview} from './configPreview.js'

const MAX_FILES = 32
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const decoder = new TextDecoder('utf-8', {fatal:true})

function fail(message) { throw new ConfigPreviewError('INVALID_IMPORT', message) }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
const CRC_TABLE = Uint32Array.from({length:256}, (_,index) => {
  let value=index
  for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0)
  return value>>>0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc=(crc>>>8)^CRC_TABLE[(crc^byte)&0xff]
  return (crc ^ 0xffffffff) >>> 0
}
function safeName(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part=>part==='..')) {
    fail('压缩包包含无效路径，请只放入配置 JSON 文件')
  }
}
async function inflate(bytes, expected) {
  if (typeof DecompressionStream !== 'function') fail('当前浏览器不支持 ZIP 解压，请解压后一次选择 JSON 文件')
  let stream
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')) }
  catch { fail('当前浏览器不支持此 ZIP 压缩格式，请解压后一次选择 JSON 文件') }
  const reader = stream.getReader(), chunks = []
  let size=0
  try {
    while (true) {
      const {done,value}=await reader.read()
      if (done) break
      size+=value.byteLength
      if (size>expected || size>MAX_FILE_BYTES) {
        await reader.cancel()
        fail('ZIP 文件解压后过大或大小信息不正确')
      }
      chunks.push(value)
    }
  } catch(error) {
    if (error instanceof ConfigPreviewError) throw error
    fail('ZIP 压缩数据损坏，请重新导出')
  } finally { reader.releaseLock() }
  const result=new Uint8Array(size)
  let offset=0
  for (const chunk of chunks) {result.set(chunk,offset);offset+=chunk.byteLength}
  return result
}

/** 只在内存中读取 ZIP 的 JSON，拒绝加密、多卷、ZIP64 和超限内容。 */
export async function readPreviewZip(buffer) {
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer)
  if(bytes.byteLength>MAX_FILE_BYTES)fail('ZIP 文件不能超过 16 MB')
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let end=-1
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--) {
    if(view.getUint32(pos,true)===0x06054b50 && pos+22+view.getUint16(pos+20,true)===bytes.length){end=pos;break}
  }
  if(end<0)fail('ZIP 文件目录损坏或格式不受支持')
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true)
  if(view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0 || view.getUint16(end+8,true)!==count || count===65535 || directoryOffset===0xffffffff)fail('只支持普通单卷 ZIP，请重新打包 JSON 文件')
  if(!count || count>MAX_FILES || directoryOffset+directorySize!==end)fail('ZIP 文件目录无效或文件超过 32 个')
  const files=[],names=new Set()
  let offset=directoryOffset,total=0
  for(let index=0;index<count;index++){
    if(offset+46>end || view.getUint32(offset,true)!==0x02014b50)fail('ZIP 文件目录损坏')
    const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true)
    const compressed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true)
    const extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true)
    if(offset+46+nameLength+extra+comment>end)fail('ZIP 文件目录损坏')
    let name
    try {name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength))}catch{fail('ZIP 文件名不是有效 UTF-8，请重新打包')}
    safeName(name)
    if(names.has(name))fail('ZIP 中存在同名文件，请保留一份对应配置')
    names.add(name)
    offset+=46+nameLength+extra+comment
    if(name.endsWith('/'))continue
    if(flags & 1)fail('不支持加密 ZIP，请使用未加密的 JSON 文件')
    if(method!==0 && method!==8)fail('ZIP 压缩方式不受支持，请使用普通 ZIP')
    if(size>MAX_FILE_BYTES || (total+=size)>MAX_TOTAL_BYTES)fail('ZIP 解压内容不能超过 32 MB，单个文件不能超过 16 MB')
    if(localOffset+30>directoryOffset || view.getUint32(localOffset,true)!==0x04034b50)fail('ZIP 文件数据位置无效')
    const localFlags=view.getUint16(localOffset+6,true),localMethod=view.getUint16(localOffset+8,true)
    const localNameLength=view.getUint16(localOffset+26,true),localExtra=view.getUint16(localOffset+28,true)
    const start=localOffset+30+localNameLength+localExtra
    if(localFlags!==flags || localMethod!==method || start+compressed>directoryOffset)fail('ZIP 文件头与目录不一致')
    let localName
    try {localName=decoder.decode(bytes.subarray(localOffset+30,localOffset+30+localNameLength))}catch{fail('ZIP 文件头损坏')}
    if(localName!==name)fail('ZIP 文件名与目录不一致')
    const compressedBytes=bytes.subarray(start,start+compressed)
    const content=method===0?compressedBytes:await inflate(compressedBytes,size)
    if(content.byteLength!==size || crc32(content)!==crc)fail('ZIP 文件校验失败，请重新导出')
    if(/\.json$/i.test(name))files.push({name,bytes:content})
  }
  if(offset!==end)fail('ZIP 文件目录长度不一致')
  if(!files.length)fail('ZIP 中没有 JSON 配置文件')
  return files
}

function stage(value,name){
  if(value.name!==name || value.status!=='completed' || !object(value.payload))fail('配置阶段尚未完成或数据格式不正确')
  return value.payload
}
function identify(documents){
  const found={}
  function add(key,value){if(found[key]!==undefined)fail('导入内容中有多份同类数据，请只保留同一批配置');found[key]=value}
  function read(value){
    if(!object(value))fail('配置 JSON 顶层必须是对象')
    if(value.kind==='oasis.interaction_trajectory'){add('trajectory',value);return}
    if(value.name==='network'){add('network',value);return}
    if(value.name==='roles'){add('roles',value);return}
    if(value.name==='plan'){add('plan',stage(value,'plan'));return}
    if(Array.isArray(value.nodes)&&Array.isArray(value.edges)){add('network',value);return}
    if(value.population_request){add('roles',value);return}
    if(value.plan_id&&value.population&&value.runtime){add('plan',value);return}
    if(value.snapshot&&Array.isArray(value.snapshot.nodes)&&!['preparation','roles','plan','simulation_plan','trajectory','population_snapshot'].some(key=>Object.hasOwn(value,key))){add('network',value);return}
    if(Object.hasOwn(value,'roles')||Object.hasOwn(value,'entities')){
      const rules=value.roles||{},entities=value.entities||{}
      if(object(rules)&&object(entities)&&[...Object.values(rules),...Object.values(entities)].every(v=>typeof v==='string')){add('placementRules',value);return}
    }
    const keys=['network','snapshot','population_snapshot','preparation','roles','plan','simulation_plan','trajectory','placementRules','placement_rules']
    const nested=keys.filter(key=>Object.hasOwn(value,key))
    if(nested.length){for(const key of nested){if(key==='placementRules'||key==='placement_rules')add('placementRules',value[key]);else read(value[key])}return}
    if(Object.keys(value).length&&Object.values(value).every(v=>typeof v==='string')){add('placementRules',value);return}
    fail('有 JSON 文件无法识别，请选择快照、角色字段、计划或楼栋安置规则')
  }
  for(const document of documents)read(document)
  if(!found.network)fail('请至少导入一份人物关系快照')
  if(found.trajectory){
    if(!found.plan)fail('运行回放还需要同次计划文件')
    const network=found.network.name==='network'?stage(found.network,'network'):found.network
    return {kind:'replay',trajectory:found.trajectory,snapshot:network.snapshot||network,plan:found.plan,roles:found.roles,placementRules:found.placementRules||{}}
  }
  const input=normalizeConfigPreview({network:found.network,roles:found.roles})
  input.placementRules=found.placementRules||{}
  return {kind:'config',input}
}

/** 一次接收多文件或 ZIP，根据 JSON 内容辨认配置种类。 */
export async function importPreviewFiles(inputFiles){
  const files=Array.from(inputFiles||[])
  if(!files.length)fail('请选择 JSON 文件或 ZIP 压缩包')
  if(files.length>MAX_FILES)fail('一次最多导入 32 个文件')
  const documents=[]
  let total=0,expandedTotal=0
  for(const file of files){
    if(file.size>MAX_FILE_BYTES || (total+=file.size)>MAX_TOTAL_BYTES)fail('导入文件过大，请精简至 32 MB 以内')
    const bytes=new Uint8Array(await file.arrayBuffer())
    const zip=bytes.length>=4 && new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true)===0x04034b50
    const contents=zip?await readPreviewZip(bytes):[{name:file.name,bytes}]
    for(const content of contents){
      expandedTotal+=content.bytes.byteLength
      if(expandedTotal>MAX_TOTAL_BYTES || documents.length>=MAX_FILES)fail('解压后的 JSON 总量不能超过 32 MB 或 32 个文件')
      try{documents.push(JSON.parse(decoder.decode(content.bytes)))}catch(error){if(error instanceof ConfigPreviewError)throw error;fail('有文件不是有效的 UTF-8 JSON，请检查后重试')}
    }
  }
  return identify(documents)
}

export async function loadSyntheticPreview(kind='config'){
  // Vite serves JSON imports as JavaScript modules; native Node requires the
  // JSON import attribute. Keep the same fixtures without browser MIME errors.
  if(kind==='replay'){
    const [snapshot,trajectory,plan]=await Promise.all(import.meta.env?[
      import('../../tests/fixtures/generic-replay/snapshot.json'),
      import('../../tests/fixtures/generic-replay/trajectory.json'),
      import('../../tests/fixtures/generic-replay/plan.json'),
    ]:[
      import('../../tests/fixtures/generic-replay/snapshot.json', {with:{type:'json'}}),
      import('../../tests/fixtures/generic-replay/trajectory.json', {with:{type:'json'}}),
      import('../../tests/fixtures/generic-replay/plan.json', {with:{type:'json'}}),
    ])
    return identify([snapshot.default,trajectory.default,plan.default])
  }
  const [snapshot,preparation]=await Promise.all(import.meta.env?[
    import('../../tests/fixtures/config-preview/snapshot.json'),
    import('../../tests/fixtures/config-preview/preparation.json'),
  ]:[
    import('../../tests/fixtures/config-preview/snapshot.json', {with:{type:'json'}}),
    import('../../tests/fixtures/config-preview/preparation.json', {with:{type:'json'}}),
  ])
  return identify([snapshot.default,preparation.default])
}
