import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {publicUrl} from '../src/mecoffe/publicUrl.js'
import {publishedCatalog,pagesFiles,assertArtifact,ENTRY_ROUTES} from '../pages/build-tools.mjs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{servePages}=require('../../scripts/serve-pages.cjs'),{findings}=require('../../scripts/audit-public.cjs')
const root=path.resolve(import.meta.dirname,'..'),catalog=JSON.parse(readFileSync(path.join(root,'public/mecoffe/assets3d/catalog.json'),'utf8'))

test('deployment asset resolver is base-aware, idempotent and keeps external/blob URLs',()=>{
  for(const value of ['mecoffe/scene.json','/mecoffe/scene.json','/mecoffe-scene/mecoffe/scene.json'])assert.equal(publicUrl(value,'/mecoffe-scene/'),'/mecoffe-scene/mecoffe/scene.json')
  assert.equal(publicUrl('/assets/bgrd-0.json','/'),'/assets/bgrd-0.json')
  for(const value of ['https://example.org/a','blob:test','data:image/png;base64,abcd'])assert.equal(publicUrl(value,'/mecoffe-scene/'),value)
})
test('published catalog excludes all Rocketbox cards while local catalog stays complete',()=>{
  const published=publishedCatalog(catalog)
  assert.equal(catalog.prototypes.length,349);assert.equal(published.prototypes.length,233)
  assert(published.prototypes.every(p=>p.source.type!=='rocketbox'&&p.preview.startsWith('/mecoffe-scene/')))
  const files=pagesFiles(path.join(root,'public'),{...catalog,prototypes:catalog.prototypes.filter(p=>p.source.type!=='rocketbox')})
  assert(files.every(file=>!file.includes('/rocketbox/')&&!file.startsWith('img/')&&!file.startsWith('sounds/')))
  assert(files.includes('mecoffe/assets3d/valid/Asian_F_2_Casual.fbx'))
  assert(files.includes('mecoffe/scenarios/ustc-history/trajectory.json'))
  assert(files.every(file=>existsSync(path.join(root,'public',file))))
})
test('artifact audit rejects root requests and enforces base without touching local build',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'mecoffe-pages-test-'))
  try{
    writeFileSync(path.join(temp,'index.html'),'<script src="/mecoffe-scene/assets/app.js"></script>')
    for(const route of ENTRY_ROUTES){mkdirSync(path.join(temp,route),{recursive:true});writeFileSync(path.join(temp,route,'index.html'),'ENTRY')}
    writeFileSync(path.join(temp,'bad.js'),'fetch("/mecoffe/scene.json")')
    assert.throws(()=>assertArtifact(temp),/root asset URL/)
    writeFileSync(path.join(temp,'bad.js'),'fetch("/mecoffe-scene/mecoffe/scene.json")')
    assert(assertArtifact(temp).totalBytes>0)
  }finally{assert(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep));rmSync(temp,{recursive:true,force:true})}
})
test('strict static simulation serves real entry directories, preserves query, and returns missing files as 404',async()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'mecoffe-pages-server-'));let server
  try{mkdirSync(path.join(temp,'mecoffe3d'));writeFileSync(path.join(temp,'mecoffe3d/index.html'),'ENTRY');server=await servePages({root:temp,port:0});const origin='http://127.0.0.1:'+server.address().port
    const response=await fetch(origin+'/mecoffe-scene/mecoffe3d?scenario=nus-hourly');assert.equal(response.status,200);assert.equal(await response.text(),'ENTRY');assert(response.url.endsWith('/mecoffe3d/?scenario=nus-hourly'))
    assert.equal((await fetch(origin+'/mecoffe-scene/missing')).status,404)
  }finally{await new Promise(resolve=>server?server.close(resolve):resolve());assert(path.resolve(temp).startsWith(path.resolve(tmpdir())+path.sep));rmSync(temp,{recursive:true,force:true})}
})
test('public-content scanner flags sensitive locations without echoing secret values',()=>{
  const url='https://'+'example.feishu.cn'+'/docx/example',secret='ghp_'+'a'.repeat(30),home='C:'+String.fromCharCode(92)+'Users'+String.fromCharCode(92)+'Lenovo'
  const hits=findings([url,secret,home].join('\n'),'fixture');assert.deepEqual(hits.map(x=>x.kind).sort(),['credential','internal','localPath']);assert(!JSON.stringify(hits).includes(secret))
})
