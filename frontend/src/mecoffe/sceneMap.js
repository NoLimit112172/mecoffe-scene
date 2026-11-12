// Versioned map loading. No legacy fallback and no renderer/placement decisions.
import {sha256Hex} from './sha256.js'
import publishedLibrary from '../../../adapter/scene_builder/resources/mecoffe-embed-v1/asset-library.json' with {type:'json'}
export const PUBLISHED_SCENE_ASSETS=Object.freeze(publishedLibrary)
export class SceneMapError extends Error {constructor(code,message){super(message);this.code=code}}
const check=(ok,code,message)=>{if(!ok)throw new SceneMapError(code,message)}
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)
const required=['campus3d.json','entrances.json','landcover.json','asset_assignments.json','quality.json',...['buildings','roads','landcover','water','boundary','pois','entrances'].map(n=>`gis/${n}.geojson`)]
const allowed=name=>required.includes(name)||['surroundings.json','evidence-rules.json','ai-evidence.json'].includes(name)
export function sceneMapDirectory(ref,mapsBase='/scene-maps/'){
  check(ref&&id(ref.map_id)&&id(ref.map_version)&&hash(ref.manifest_sha256),'INVALID_MAP_REF','地图引用无效')
  check(typeof mapsBase==='string'&&/^\/(?!\/)[A-Za-z0-9_./-]*$/.test(mapsBase)&&!mapsBase.split('/').includes('..')&&!mapsBase.split('/').includes('.'),'INVALID_MAP_BASE','地图目录必须是受控的同源绝对路径')
  return `${mapsBase.replace(/\/$/,'')}/${ref.map_id}/${ref.map_version}/`
}
async function read(url,{fetcher,signal},expected){
  const response=await fetcher(url,{signal,credentials:'same-origin',cache:'no-store'})
  check(response.ok,'MAP_FILE_MISSING',`地图文件缺失或不可读取：${url}（${response.status}）`)
  const bytes=await response.arrayBuffer()
  check(await sha256Hex(bytes)===expected,'MAP_HASH_MISMATCH',`地图文件哈希不符：${url}`)
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new SceneMapError('INVALID_MAP_JSON',`地图 JSON 无效：${url}`)}
}
export async function loadSceneMap(ref,{mapsBase='/scene-maps/',assets,fetcher=fetch,signal}={}){
  const directory=sceneMapDirectory(ref,mapsBase)
  const manifest=await read(directory+'manifest.json',{fetcher,signal},ref.manifest_sha256)
  check(manifest.schema_version==='scene.map-manifest.v1'&&manifest.map_id===ref.map_id&&manifest.map_version===ref.map_version&&typeof manifest.title==='string'&&manifest.title.trim(),'MAP_VERSION_MISMATCH','地图清单身份或标题不匹配')
  check(assets&&manifest.asset_library_version===assets.version&&hash(manifest.catalog_sha256)&&manifest.catalog_sha256===assets.catalog_sha256,'ASSET_VERSION_MISMATCH',`地图登记的素材库或 catalog 与发布版不匹配；地图摘要 ${manifest.catalog_sha256}，需要 ${assets?.version||'已登记版本'} / ${assets?.catalog_sha256||'有效摘要'}；不能混用源码版 catalog`)
  check(manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files)&&required.every(n=>Object.hasOwn(manifest.files,n)),'INVALID_MAP_MANIFEST','地图清单缺少必需文件')
  check(Object.entries(manifest.files).every(([name,sum])=>allowed(name)&&hash(sum)),'INVALID_MAP_MANIFEST','地图清单包含不允许的文件路径或摘要')
  const files=Object.fromEntries(await Promise.all(Object.entries(manifest.files).map(async([name,sum])=>[name,await read(directory+name,{fetcher,signal},sum)])))
  check(files['quality.json'].status==='ready','MAP_NOT_READY','地图尚未达到场景安置要求')
  check(files['campus3d.json'].buildings?.length&&files['entrances.json'].schema_version==='mecoffe.entrances.v1','INVALID_MAP_MANIFEST','地图缺少楼栋或有效入口')
  files['surroundings.json']||={roads:[]}
  const start='2026-01-01T00:00:00+08:00'
  return {map_ref:structuredClone(ref),mapContext:{map_ref:structuredClone(ref),campus:files['campus3d.json'],entrances:files['entrances.json'],landcover:files['landcover.json'],
      ...(files['evidence-rules.json']?{evidence_rules:files['evidence-rules.json']}: {})},
    manifest:{...manifest,id:manifest.map_id,map:{source:files['campus3d.json'].source||{attribution:'本地地图 · 展示示意'}},
      style:manifest.style||{buildings:'procedural',characters:'campus'},simulation_data:false,
      simulation_time:{start,timezone:'Asia/Shanghai',step_unit:'day',steps:1,intervals:[{start,end:'2026-01-02T00:00:00+08:00'}]}},files}
}
/** Verify a named release; never infer a library version from whatever was fetched. */
export async function loadBundledSceneAssets({base=import.meta.env?.BASE_URL||'/',fetcher=fetch,signal,development=import.meta.env?.DEV||false}={}){
  const response=await fetcher(`${base}mecoffe/assets3d/catalog.json`,{signal,cache:'no-store',credentials:'same-origin'})
  check(response.ok,'ASSET_VERSION_MISMATCH','无法读取当前显示程序的素材 catalog')
  const actual=await sha256Hex(await response.arrayBuffer())
  check(actual===publishedLibrary.catalog_sha256,'ASSET_VERSION_MISMATCH',`${development?'当前为源码素材，与发布版不同':'当前素材 catalog 与已登记发布版不同'}；需要 ${publishedLibrary.version} / ${publishedLibrary.catalog_sha256}，实际 ${actual}`)
  return {version:publishedLibrary.version,catalog_sha256:publishedLibrary.catalog_sha256}
}
