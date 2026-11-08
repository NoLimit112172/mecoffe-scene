import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,webcrypto} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {sha256Hex,sha256HexJs} from '../src/mecoffe/sha256.js'
import {loadConfigMap} from '../src/mecoffe/configMap.js'
import {loadScenario} from '../src/mecoffe/scenario.js'
import {configMapContents} from '../embed/build-tools.mjs'

const bytes=text=>new TextEncoder().encode(text)
const expected=value=>createHash('sha256').update(value).digest('hex')
async function withCrypto(value,action){
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto')
  Object.defineProperty(globalThis,'crypto',{configurable:true,value})
  try{return await action()}finally{if(original)Object.defineProperty(globalThis,'crypto',original);else delete globalThis.crypto}
}
const vectors=[
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['a'.repeat(1000000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
]
test('pure JS SHA-256 matches standard empty, abc, multi-block and million-byte vectors',()=>{
  for(const [text,hash]of vectors){const input=bytes(text),before=input.slice();assert.equal(sha256HexJs(input),hash);assert.deepEqual(input,before)}
})
test('pure SHA-256 covers padding boundaries, binary data and offset byte views',()=>{
  for(const length of [0,1,55,56,57,63,64,65,119,120,127,128,129,255,256,1025]){
    const input=Uint8Array.from({length},(_,i)=>(i*137+29)%256)
    assert.equal(sha256HexJs(input),expected(input))
  }
  const binary=Uint8Array.from({length:256},(_,i)=>i),storage=new Uint8Array(280).fill(97)
  storage.set(binary,12)
  assert.equal(sha256HexJs(storage.subarray(12,268)),expected(binary))
  assert.equal(sha256HexJs(new DataView(storage.buffer,12,256)),expected(binary))
  assert.equal(sha256HexJs(binary.buffer),expected(binary))
  assert.throws(()=>sha256HexJs('abc'),TypeError)
})
test('native and fallback wrappers hash exactly the same bytes without assuming a secure context',async()=>{
  let calls=0
  for(const [text,hash]of vectors){
    assert.equal(await withCrypto({subtle:{digest(...args){calls++;return webcrypto.subtle.digest(...args)}}},()=>sha256Hex(bytes(text))),hash)
    assert.equal(await withCrypto({},()=>sha256Hex(bytes(text))),hash)
    assert.equal(await withCrypto(undefined,()=>sha256Hex(bytes(text))),hash)
  }
  const binary=Uint8Array.from({length:4096},(_,i)=>i%256)
  assert.equal(await withCrypto(webcrypto,()=>sha256Hex(binary)),sha256HexJs(binary))
  assert.equal(calls,vectors.length)
  const failure=new Error('synthetic native failure')
  await assert.rejects(()=>withCrypto({subtle:{digest(){throw failure}}},()=>sha256Hex(binary)),e=>e===failure)
})

const publicRoot=path.resolve(import.meta.dirname,'../public')
function response(buffer){return {ok:true,json:async()=>JSON.parse(buffer.toString('utf8')),text:async()=>buffer.toString('utf8'),
  arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)}}
test('both complete map-loading paths verify every declared file without subtle and reject changed bytes',async()=>{
  await withCrypto({},async()=>{
    const prepared=configMapContents(publicRoot),calls=[]
    let tamper=false
    const fetcher=async url=>{
      const name=url.split('/config-map/')[1];calls.push(name)
      const raw=prepared.get(name);assert(raw)
      return response(tamper&&name==='landcover.json'?Buffer.concat([raw,Buffer.from(' ')]):raw)
    }
    const config=await loadConfigMap({fetcher,base:'/scene/'})
    assert.equal(Object.keys(config.files).length,Object.keys(config.manifest.files).length)
    assert.deepEqual(new Set(calls),new Set(prepared.keys()))
    tamper=true;await assert.rejects(()=>loadConfigMap({fetcher,base:'/scene/'}),/版本不一致/)
    const root=path.join(publicRoot,'mecoffe/scenarios/nus-hourly')
    tamper=false
    const scenarioFetcher=async url=>{
      const name=url.split('/nus-hourly/')[1],raw=fs.readFileSync(path.join(root,name))
      return response(tamper&&name==='landcover.json'?Buffer.concat([raw,Buffer.from(' ')]):raw)
    }
    const scenario=await loadScenario('nus-hourly',{fetcher:scenarioFetcher,includeGis:true})
    assert.equal(Object.keys(scenario.files).length,Object.keys(scenario.manifest.files).length)
    tamper=true;await assert.rejects(()=>loadScenario('nus-hourly',{fetcher:scenarioFetcher,includeGis:true}),/已改变/)
  })
})
