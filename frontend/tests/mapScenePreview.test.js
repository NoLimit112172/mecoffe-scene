import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {previewMapSummary} from '../src/mecoffe/MapSceneRenderer.js'
test('NUS preview only accepts a matching generated bundle and reports actual data counts without simulation',()=>{
 const read=name=>JSON.parse(readFileSync(new URL(`../public/mecoffe/campuses/nus/${name}.json`,import.meta.url),'utf8'))
 const campus=read('campus3d'),assignments=read('asset_assignments'),before=structuredClone(campus)
 const summary=previewMapSummary(campus,assignments)
 assert.equal(summary.buildings,campus.buildings.length);assert.equal(summary.roads,campus.roads.length);assert.equal(summary.simulation_data,false)
 assert.deepEqual(campus,before)
 assert.throws(()=>previewMapSummary(campus,{...assignments,campus_id:'wrong'}),/不对应/)
 assert.throws(()=>previewMapSummary(campus,{...assignments,geometry_source:{sha256:'wrong'}}),/SHA-256/)
 assert.throws(()=>previewMapSummary(campus,{...assignments,assignments:null}),/不对应/)
})
