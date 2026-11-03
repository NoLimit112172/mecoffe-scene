import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { previewParams, previewViewport, safeSourceUrl, describeMatch, paginateAssets } from '../src/mecoffe/assetPreviewModel.js'
import { AssetPreviewRenderer, createProceduralPreview, createAssetPreview, registerPreviewFactory, disposePreviewObject } from '../src/mecoffe/AssetPreviewRenderer.js'

test('preview viewport clips scissors without stretching a partially visible card',()=>{
  const actual=previewViewport({left:-20,top:900,width:320,height:190},{width:1600,height:1000})
  assert.deepEqual(actual.viewport,{x:-20,y:-90,width:320,height:190})
  assert.deepEqual(actual.scissor,{x:0,y:0,width:300,height:100})
  assert.equal(actual.aspect,320/190)
  assert.equal(previewViewport({left:1700,top:0,width:320,height:190},{width:1600,height:1000}),null)
})

test('variant preview parameters resolve defaults without editing the catalog',()=>{
  const prototype={params:{levels:{default:6,min:1},wall:'#abc'},variants:[{id:'wide',params:{levels:3,width:7}}]}
  const before=structuredClone(prototype)
  assert.deepEqual(previewParams(prototype,'wide'),{levels:3,wall:'#abc',width:7})
  assert.deepEqual(prototype,before)
  assert.equal(describeMatch({building:['dormitory','apartments']}),'building=dormitory|apartments')
  assert.equal(safeSourceUrl('javascript:alert(1)'),null)
})

test('procedural category previews contain finite real geometry and distinct variant proportions',()=>{
  for(const category of ['building','road','landcover','vegetation','street_furniture','effect']) {
    const prototype={id:`test.${category}`,category,subtype:category==='street_furniture'?'bench':category,params:{wall:'#bc7859'},variants:[]}
    const before=structuredClone(prototype)
    const object=createProceduralPreview(prototype)
    const bounds=new THREE.Box3().setFromObject(object)
    assert.ok(Number.isFinite(bounds.min.x)&&Number.isFinite(bounds.max.y),category)
    assert.ok(bounds.getSize(new THREE.Vector3()).length()>0,category)
    assert.deepEqual(prototype,before)
    disposePreviewObject(object)
  }
  const prototype={id:'building.test',category:'building',params:{},variants:[{id:'narrow',params:{preview_scale:.7}},{id:'wide',params:{preview_scale:1.3}}]}
  const narrow=createProceduralPreview(prototype,'narrow'),wide=createProceduralPreview(prototype,'wide')
  assert.ok(new THREE.Box3().setFromObject(wide).getSize(new THREE.Vector3()).x>new THREE.Box3().setFromObject(narrow).getSize(new THREE.Vector3()).x)
  disposePreviewObject(narrow);disposePreviewObject(wide)
})

test('registered atlas model factory replaces a placeholder and unregisters cleanly',async()=>{
  const prototype={id:'building.yulan.test',category:'building',params:{generator:'test-yulan'},source:{type:'yulan'}}
  const object=new THREE.Group()
  const unregister=registerPreviewFactory('test-yulan',async(item,variant)=>({object,caption:`actual ${item.id} ${variant}`}))
  const preview=await createAssetPreview(prototype,'a')
  assert.equal(preview.object,object)
  assert.equal(preview.caption,'actual building.yulan.test a')
  unregister()
  const fallback=await createAssetPreview(prototype,'a')
  assert.match(fallback.caption,/尚未接入/)
  fallback.dispose()
})

test('large libraries page without dropping models or mutating source order',()=>{
  const items=Array.from({length:115},(_,id)=>({id})),before=structuredClone(items)
  const seen=[]
  for(let page=1;page<=10;page++){const view=paginateAssets(items,page,12);assert.equal(view.page,page);assert.equal(view.pageCount,10);assert.ok(view.items.length<=12);seen.push(...view.items.map(item=>item.id))}
  assert.deepEqual(seen,items.map(item=>item.id));assert.deepEqual(items,before)
  assert.equal(paginateAssets(items,999).page,10);assert.equal(paginateAssets(items,-1).page,1)
  assert.equal(paginateAssets([],99).pageCount,1);assert.deepEqual(paginateAssets([],99).items,[])
  assert.equal(paginateAssets(items,NaN,Infinity).pageSize,12)
})

function previewHarness() {
  const renderer=Object.create(AssetPreviewRenderer.prototype)
  const errors=[],captions=[]
  Object.assign(renderer,{items:[],views:new Map(),pending:new Map(),failed:new Set(),disposed:false,
    onError:(id,message)=>errors.push({id,message}),onCaption:(id,caption)=>captions.push({id,caption})})
  return {renderer,errors,captions}
}
const previewItem=(id,variant='default')=>({prototype:{id,category:'building',params:{generator:'pending-test'}},variant,
  element:{isConnected:true,addEventListener(){},removeEventListener(){}}})
const previewModel=caption=>({object:new THREE.Group(),bounds:new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)),caption,dispose(){}})

test('preview factories receive cancellation and pre-aborted requests never start',async()=>{
  const controller=new AbortController();let seen,calls=0
  const unregister=registerPreviewFactory('signal-test',async(_item,_variant,{signal})=>{calls++;seen=signal;return previewModel('ready')})
  try {
    const prototype={id:'test.signal',params:{generator:'signal-test'}}
    const model=await createAssetPreview(prototype,'a',{signal:controller.signal})
    assert.equal(seen,controller.signal);assert.equal(calls,1);model.dispose()
    controller.abort()
    await assert.rejects(createAssetPreview(prototype,'b',{signal:controller.signal}),{name:'AbortError'})
    assert.equal(calls,1)
  } finally {unregister()}
})

test('replaced variant cancels pending work and its late failure cannot overwrite the new caption',async()=>{
  const {renderer,errors,captions}=previewHarness(),waiting=[]
  const unregister=registerPreviewFactory('pending-test',(_item,variant,{signal})=>new Promise((resolve,reject)=>waiting.push({variant,signal,resolve,reject})))
  try {
    const oldItem=previewItem('shared.prototype','old'),newItem=previewItem('shared.prototype','new')
    renderer.setItems([oldItem]);const old=renderer.prepare(oldItem)
    renderer.setItems([newItem]);assert(waiting[0].signal.aborted)
    const current=renderer.prepare(newItem)
    waiting[1].resolve(previewModel('new variant ready'));await current
    waiting[0].reject(new Error('late old-page network error'));await old
    assert.deepEqual(errors,[]);assert.equal(renderer.failed.size,0)
    assert.deepEqual(captions,[{id:'shared.prototype',caption:'new variant ready'}])
    assert.equal(renderer.views.size,1);assert(renderer.views.has(renderer.key(newItem)))
  } finally {renderer.setItems([]);unregister()}
})

test('leaving and returning to the same card keeps the new pending token when the old one settles',async()=>{
  const {renderer,errors}=previewHarness(),waiting=[]
  const unregister=registerPreviewFactory('pending-test',(_item,_variant,{signal})=>new Promise((resolve,reject)=>waiting.push({signal,resolve,reject})))
  try {
    const item=previewItem('same.card')
    renderer.setItems([item]);const old=renderer.prepare(item)
    renderer.setItems([]);assert(waiting[0].signal.aborted);assert.equal(renderer.pending.size,0)
    renderer.setItems([item]);const current=renderer.prepare(item),token=renderer.pending.get(renderer.key(item))
    waiting[0].reject(new Error('old request failed'));await old
    assert.equal(renderer.pending.get(renderer.key(item)),token);assert.deepEqual(errors,[])
    waiting[1].resolve(previewModel('current'));await current
    assert.equal(renderer.pending.size,0);assert.equal(renderer.views.size,1)
  } finally {renderer.setItems([]);unregister()}
})

test('disposing the preview renderer aborts outstanding factories and suppresses late errors',async()=>{
  const {renderer,errors}=previewHarness();let waiting
  const unregister=registerPreviewFactory('pending-test',(_item,_variant,{signal})=>new Promise((resolve,reject)=>{waiting={signal,resolve,reject}}))
  const previous=globalThis.cancelAnimationFrame
  globalThis.cancelAnimationFrame=()=>{}
  renderer.renderer={dispose(){},forceContextLoss(){},domElement:{remove(){}}}
  try {
    const item=previewItem('disposed.card');renderer.setItems([item]);const pending=renderer.prepare(item)
    renderer.dispose();assert(waiting.signal.aborted);assert.equal(renderer.pending.size,0)
    waiting.reject(new Error('disposed load error'));await pending
    assert.deepEqual(errors,[]);assert.equal(renderer.failed.size,0);assert.equal(renderer.views.size,0)
  } finally {
    if(previous===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=previous
    unregister()
  }
})
