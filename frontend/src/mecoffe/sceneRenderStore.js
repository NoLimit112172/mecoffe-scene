// Development-only caller owns this memory. No storage, URL data or broadcasts.
let retained={bundle:null,files:[],mode:'config',livePage:0}
export const localSceneInput=()=>retained
export function rememberLocalScene(value){retained={...retained,...value}}
export function localMapFetcher(files,fallback=fetch){
  const entries=new Map()
  for(const file of files){
    const path=file.webkitRelativePath.split('/').slice(1).join('/')
    if(!path||entries.has(path))throw new Error('本地图目录为空或包含重复路径')
    entries.set(path,file)
  }
  return async(url,options)=>{
    const prefix='/__local_scene_maps__/'
    if(!String(url).startsWith(prefix))return fallback(url,options)
    const file=entries.get(String(url).slice(prefix.length))
    if(!file)return {ok:false,status:404}
    return {ok:true,status:200,arrayBuffer:()=>file.arrayBuffer()}
  }
}
/** Reserved hook, not called by current default team entries. 404 is legacy, not failure. */
export async function readOptionalSceneResult(url,{fetcher=fetch,signal}={}){
  if(typeof url!=='string'||!/^\/api\/(?!\/)/.test(url)||/[?#\\]/.test(url)||url.split('/').includes('..'))throw new Error('场景接口必须是明确的同源 API 路径')
  const response=await fetcher(url,{signal,cache:'no-store',credentials:'same-origin'})
  if(response.status===404)return {result:null,legacy:true,message:'团队尚未提供 SceneResult，使用中科大 legacy 展示路径。'}
  if(!response.ok)throw new Error(`场景结果读取失败（${response.status}）`)
  return {result:await response.json(),legacy:false,message:''}
}
