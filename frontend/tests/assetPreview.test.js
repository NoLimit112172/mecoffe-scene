import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { previewParams, previewViewport, safeSourceUrl, describeMatch } from '../src/mecoffe/assetPreviewModel.js'
import { createProceduralPreview, createAssetPreview, registerPreviewFactory, disposePreviewObject } from '../src/mecoffe/AssetPreviewRenderer.js'

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
