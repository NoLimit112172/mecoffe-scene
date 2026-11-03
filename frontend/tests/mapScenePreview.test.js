import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {previewMapSummary,isOpenStreetMapSource} from '../src/mecoffe/MapSceneRenderer.js'
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
test('caller GeoJSON never inherits OSM attribution merely because it uses ODbL',()=>{
 assert.equal(isOpenStreetMapSource({source_type:'caller_geojson',license:'ODbL-1.0'}),false)
 assert.equal(isOpenStreetMapSource({source_url:'https://api.openstreetmap.org/api/0.6/map?bbox=1,2,3,4'}),true)
 assert.equal(isOpenStreetMapSource({source_url:'https://api.openstreetmap.org.example/api/0.6/map'}),false)
})
