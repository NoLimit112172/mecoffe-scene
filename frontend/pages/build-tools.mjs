import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {validateScenarioDirectory} from '../src/mecoffe/scenario.js'

export const PAGES_BASE='/mecoffe-scene/'
export const ENTRY_ROUTES=['mecoffe','mecoffe3d','mecoffe3d/assets','mecoffe-gis','licenses']
export function publishedCatalog(catalog,base=PAGES_BASE){
  return {...catalog,prototypes:catalog.prototypes.filter(item=>item.source.type!=='rocketbox').map(item=>({
    ...item,preview:base+item.preview.replace(/^\/+/, '')
  }))}
}

export function safePublicFile(root,relative){
  const resolved=path.resolve(root,relative)
  if(!resolved.startsWith(path.resolve(root)+path.sep))throw new Error('Asset path must stay inside public')
  return resolved
}

/** Explicit artifact allowlist: never copy the whole local public directory. */
export function pagesFiles(publicRoot,catalog){
  const files=new Set(['favicon.svg'])
  function add(relative){if(fs.existsSync(safePublicFile(publicRoot,relative)))files.add(relative);else throw new Error('Missing published asset: '+relative)}
  function directory(relative){for(const entry of fs.readdirSync(safePublicFile(publicRoot,relative),{withFileTypes:true})){if(entry.name.endsWith('.tmp'))continue;const name=relative+'/'+entry.name;if(entry.isSymbolicLink())throw new Error('Symlink assets are not supported');if(entry.isDirectory())directory(name);else add(name)}}
  for(let i=0;i<3;i++){add(`assets/bgrd-${i}.json`);add(`assets/bgrd-${i}.png`)}
  for(const name of ['scene.json','latest-demo.json','latest-network.json','sync-status.json','campus3d.json','campus3d_mapping.json','campus3d_landcover.json','campus3d_surroundings.json'])add('mecoffe/'+name)
  directory('mecoffe/campuses');directory('mecoffe/scenarios')
  add('mecoffe/assets3d/catalog.json')
  for(const item of catalog.prototypes){const preview=item.preview.replace(/^\/+/, '');if(!preview.startsWith('mecoffe/assets3d/previews/'))throw new Error('Unexpected preview path');add(preview)}
  for(const library of ['valid','kenney']){
    const base=`mecoffe/assets3d/${library}/`,manifest=JSON.parse(fs.readFileSync(safePublicFile(publicRoot,base+'manifest.json'),'utf8'))
    add(base+'manifest.json');add(base+manifest.license_file)
    const referenced=new Set(catalog.prototypes.filter(p=>p.source.type===library).map(p=>p.params.model_id).filter(Boolean))
    for(const model of manifest.models)if(referenced.has(model.id)){add(base+(model.fbx||model.file));if(model.glb)add(base+model.glb)}
  }
  return [...files].sort()
}

export function rewriteAssetMetadata(data,base){
  if(Array.isArray(data))return data.map(value=>rewriteAssetMetadata(value,base))
  if(data&&typeof data==='object')return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,
    ['preview','runtime_base'].includes(key)&&typeof value==='string'&&/^\/(?:mecoffe|assets|img|sounds)\//.test(value)?base+value.slice(1):rewriteAssetMetadata(value,base)]))
  return data
}

export function artifactStats(root){
  const files=[]
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else files.push({file:path.relative(root,file).replaceAll('\\','/'),bytes:fs.statSync(file).size})}}
  walk(root)
  return {totalBytes:files.reduce((n,item)=>n+item.bytes,0),files:files.length,largest:files.sort((a,b)=>b.bytes-a.bytes).slice(0,10)}
}

export function assertArtifact(root,base=PAGES_BASE){
  const problems=[]
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else if(/\.(?:html|js|mjs|css|json|geojson|md|txt)$/i.test(file)){
    const text=fs.readFileSync(file,'utf8')
    // Logical Vue route strings are allowed; these directory prefixes denote
    // fetched data/images, not router destinations. Inspect JSON metadata too.
    if(/["'`(=]\s*\/(?:mecoffe|assets|img|sounds)\//.test(text))problems.push(path.relative(root,file)+': root asset URL')
    if(/https?:\/\/[^\s"'<>]*(?:feishu\.cn|larksuite\.com|larkoffice\.com)/i.test(text))problems.push(path.relative(root,file)+': internal document URL')
    if(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/.test(text))problems.push(path.relative(root,file)+': credential-like value')
    if(/[a-z]:[\\/]+Users[\\/]+Lenovo/i.test(text))problems.push(path.relative(root,file)+': local personal path')
  }}}
  walk(root)
  for(const route of ENTRY_ROUTES)if(!fs.existsSync(path.join(root,route,'index.html')))problems.push(`Missing static route ${route}`)
  if(fs.existsSync(path.join(root,'mecoffe/assets3d/rocketbox')))problems.push('Excluded Rocketbox library present')
  // The scenario page rejects any file whose bytes differ from the manifest,
  // so a line-ending change at checkout would break it only after deployment.
  const scenarios=path.join(root,'mecoffe/scenarios')
  const scenarioIds=fs.existsSync(scenarios)?fs.readdirSync(scenarios).filter(id=>fs.statSync(path.join(scenarios,id)).isDirectory()):[]
  if(fs.existsSync(scenarios)){
    const directory=validateScenarioDirectory(JSON.parse(fs.readFileSync(path.join(scenarios,'index.json'),'utf8')))
    if(directory.scenarios.length!==scenarioIds.length)problems.push('Scenario directory does not list every prepared bundle')
    for(const item of directory.scenarios){
      const file=path.join(scenarios,item.id,'scenario.json')
      if(!fs.existsSync(file)){problems.push(`Scenario directory references missing bundle ${item.id}`);continue}
      const raw=fs.readFileSync(file),manifest=JSON.parse(raw)
      if(manifest.id!==item.id||manifest.title!==item.title||manifest.simulation_data!==item.simulation_data||crypto.createHash('sha256').update(raw).digest('hex')!==item.manifest_sha256)problems.push(`Scenario directory metadata/hash mismatch: ${item.id}`)
    }
  }
  for(const id of scenarioIds){
    const manifest=JSON.parse(fs.readFileSync(path.join(scenarios,id,'scenario.json'),'utf8'))
    for(const [name,expected] of Object.entries(manifest.files||{})){
      const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(scenarios,id,name))).digest('hex')
      if(actual!==expected)problems.push(`mecoffe/scenarios/${id}/${name}: SHA-256 differs from scenario.json`)
    }
  }
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8')
  if(!index.includes(base+'assets/'))problems.push('Entrypoint does not use deployment base')
  const stats=artifactStats(root)
  if(stats.totalBytes>300_000_000)problems.push('Artifact exceeds 300 MB')
  if(problems.length)throw new Error(problems.join('\n'))
  return stats
}
