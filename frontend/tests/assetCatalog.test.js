import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { ASSET_CATALOG,validateCatalog,getPrototype,queryPrototypes,selectPrototype,prototypeParams,catalogStats } from '../src/mecoffe/assetCatalog.js'

test('all catalogue entries have unique ids, actual thumbnails and provenance',()=>{
  assert.equal(validateCatalog(ASSET_CATALOG),ASSET_CATALOG)
  for(const item of ASSET_CATALOG.prototypes) {
    assert.ok(existsSync(new URL(`../public${item.preview}`,import.meta.url)),item.id)
    assert.ok(item.source.path && item.license.spdx)
    assert.ok(item.variants.length>=3)
  }
  assert.equal(catalogStats().total,ASSET_CATALOG.prototypes.length)
  const invalid=structuredClone(ASSET_CATALOG); invalid.prototypes.push(invalid.prototypes[0])
  assert.throws(()=>validateCatalog(invalid),/重复/)
  const missing=structuredClone(ASSET_CATALOG); delete missing.prototypes[0].license
  assert.throws(()=>validateCatalog(missing),/许可/)
})

test('exact matching prefers a dormitory over the generic building and retains immutable defaults',()=>{
  assert.equal(queryPrototypes({building:'dormitory'},{category:'building'})[0].id,'building.procedural.dormitory')
  assert.equal(queryPrototypes({highway:'primary'},{category:'road'})[0].id,'road.primary')
  assert.deepEqual(queryPrototypes({building:'no'},{category:'building'}),[])
  assert.equal(prototypeParams('building.procedural.dormitory').wall,'#bc7859')
  assert.equal(prototypeParams('character.pixel').fps,10.8)
  assert.throws(()=>getPrototype('missing'),/不存在/)
  assert.throws(()=>{getPrototype('road.primary').params.lanes=9},TypeError)
})

test('fixed feature ids choose stable variants without mutating tags or catalogue',()=>{
  const tags={building:'dormitory'},before=structuredClone(ASSET_CATALOG)
  const a=selectPrototype(tags,{seed:42,featureId:'way/123'})
  const b=selectPrototype(tags,{seed:42,featureId:'way/123'})
  assert.deepEqual(a,b)
  assert.deepEqual(tags,{building:'dormitory'})
  assert.deepEqual(ASSET_CATALOG,before)
  assert.ok(queryPrototypes(null,{text:'宿舍'}).length)
})
