import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {deflateRawSync} from 'node:zlib'
import {importPreviewFiles,readPreviewZip,loadSyntheticPreview} from '../src/mecoffe/previewImport.js'
import {normalizeConfigPreview} from '../src/mecoffe/configPreview.js'

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`./fixtures/config-preview/${name}.json`,import.meta.url)))
const snapshot=fixture('snapshot'),preparation=fixture('preparation')
const file=(value,name='data.json')=>new File([JSON.stringify(value)],name)
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=value&1?(value>>>1)^0xedb88320:value>>>1}return (value^0xffffffff)>>>0}
function zip(entries,compressed=true){
  const locals=[],centrals=[];let offset=0
  for(const [name,value]of entries){
    const filename=Buffer.from(name),raw=Buffer.from(JSON.stringify(value)),body=compressed?deflateRawSync(raw):raw
    const local=Buffer.alloc(30),central=Buffer.alloc(46),crc=crc32(raw)
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(compressed?8:0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26)
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(compressed?8:0,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42)
    locals.push(local,filename,body);centrals.push(central,filename);offset+=local.length+filename.length+body.length
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...locals,directory,end])
}

test('one selection recognizes snapshot, role fields and placement by content regardless of names',async()=>{
  const rules={roles:{visitor:'way/123'}}
  const result=await importPreviewFiles([file(rules,'a.json'),file(preparation,'unknown.json'),file(snapshot,'b.json')])
  assert.equal(result.kind,'config');assert.deepEqual(result.input.placementRules,rules)
  assert.equal(result.input.populationRequest.visitor.generate.visit_goal.title,'参观目的')
  assert.deepEqual(result.input.snapshot,snapshot)
  const combined=await importPreviewFiles([file({snapshot,preparation})])
  assert.deepEqual(combined.input.populationRequest,preparation.population_request)
})

test('snapshot alone keeps raw dynamic keys while remote configuration still requires roles',async()=>{
  const result=await importPreviewFiles([file(snapshot)])
  assert.equal(result.input.populationRequest.visitor.description,'visitor')
  assert.deepEqual(result.input.populationRequest.visitor.generate,{})
  assert.throws(()=>normalizeConfigPreview({network:snapshot,session:'s',config:'c'}),/角色阶段/)
})

test('ordinary stored and deflated zip archives use the same content adapter',async()=>{
  for(const compression of [false,true]){
    const bytes=zip([['folder/snapshot.json',snapshot],['角色字段.json',preparation]],compression)
    const result=await importPreviewFiles([new File([bytes],'bundle.zip')])
    assert.equal(result.kind,'config');assert.equal(result.input.snapshot.nodes.length,6)
    assert.deepEqual(result.input.populationRequest,preparation.population_request)
  }
})

test('ambiguous batches, malformed JSON, traversal, corrupt zip and size limits fail explicitly',async()=>{
  await assert.rejects(importPreviewFiles([file(snapshot),file(snapshot)]),/多份同类/)
  await assert.rejects(importPreviewFiles([new File(['bad'],'bad.json')]),/有效的 UTF-8 JSON/)
  await assert.rejects(importPreviewFiles([file(preparation)]),/至少导入/)
  await assert.rejects(readPreviewZip(zip([['../snapshot.json',snapshot]])),/无效路径/)
  const corrupt=zip([['snapshot.json',snapshot]],false);corrupt[35]^=1
  await assert.rejects(readPreviewZip(corrupt),/不一致|校验失败/)
  const encrypted=zip([['snapshot.json',snapshot]]);encrypted.writeUInt16LE(1,6);const directory=encrypted.readUInt32LE(encrypted.length-6);encrypted.writeUInt16LE(1,directory+8)
  await assert.rejects(readPreviewZip(encrypted),/加密/)
  await assert.rejects(importPreviewFiles(Array.from({length:33},()=>file(snapshot))),/最多导入/)
  await assert.rejects(importPreviewFiles([{size:17*1024*1024,arrayBuffer(){throw Error('must reject before read')}}]),/过大/)
})

test('synthetic sample button uses explicit synthetic fixture data',async()=>{
  const result=await loadSyntheticPreview()
  assert.equal(result.kind,'config');assert.match(result.input.snapshot.dataset_version,/^synthetic/)
  assert(result.input.snapshot.nodes.every(person=>person.name.startsWith('样例人物')))
})

test('replay sample uses the same import boundary and matching synthetic artifacts',async()=>{
  const result=await loadSyntheticPreview('replay')
  assert.equal(result.kind,'replay')
  assert.match(result.snapshot.snapshot_id,/synthetic/)
  assert.equal(result.trajectory.metadata.snapshot_id,result.snapshot.snapshot_id)
  assert.equal(result.plan.population.snapshot_id,result.snapshot.snapshot_id)
  assert(result.trajectory.actions.length>0)
})
