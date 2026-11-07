import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {findings,auditArtifact}=require('../../scripts/audit-public.cjs')
const root=path.resolve(import.meta.dirname,'../..')
const fixture=name=>JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'fixtures/generic-replay',name),'utf8'))
const blocked=value=>findings(JSON.stringify(value),'tests/renamed.json').some(item=>item.kind==='privateConfiguration')

// 所有变体都来自明确的合成样例，不读取团队私有文件。
test('trajectory audit requires explicit synthetic declaration and synthetic agent and actor names',()=>{
  const trajectory=fixture('trajectory.json')
  assert.equal(blocked(trajectory),false)
  const unmarked=structuredClone(trajectory);delete unmarked.metadata.synthetic
  assert.equal(blocked(unmarked),true)
  const renamed=structuredClone(trajectory);renamed.agents[0].name='未获公开许可的测试姓名'
  assert.equal(blocked(renamed),true)
  const actor=structuredClone(trajectory);actor.actions[0].actor.name='未获公开许可的测试姓名'
  assert.equal(blocked({payload:actor}),true)
  const missing=structuredClone(trajectory);delete missing.agents[0].name
  assert.equal(blocked(missing),true)
})

test('existing approved historical trajectory is allowed by exact stable content only',()=>{
  const historical=JSON.parse(fs.readFileSync(path.join(root,'data/source/trajectory.json'),'utf8'))
  assert.equal(blocked(historical),false)
  const reordered=Object.fromEntries(Object.entries(historical).reverse())
  assert.equal(blocked(reordered),false)
  const altered=structuredClone(historical);altered.metadata.audit_test_marker='not approved'
  assert.equal(blocked(altered),true)
})

test('normalized generic replay remains private even when raw fixture was synthetic',()=>{
  const people=[{id:'synthetic_person_01',name:'样例人物 01',static_attributes:{gender:'male'}}]
  for(const meta of [{generic_replay:true},{mode:'generic_replay'}]){
    assert.equal(blocked({schema:'mecoffe.scene.v1',meta,people,events:[]}),true)
    assert.equal(blocked({files:{'trajectory.json':{meta,people}}}),true)
  }
})

test('plan audit permits declared synthetic plans and rejects unapproved frozen run plans',()=>{
  const plan=fixture('plan.json')
  assert.equal(blocked(plan),false)
  const unmarked=structuredClone(plan)
  unmarked.scenario.title='测试执行计划';unmarked.scenario.goal='普通执行说明'
  assert.equal(blocked(unmarked),true)
  assert.equal(blocked({payload:unmarked}),true)
  unmarked.synthetic=true
  assert.equal(blocked(unmarked),false)
})

test('artifact audit rejects private-style run exports without echoing their contents',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mecoffe-run-audit-'))
  try{
    const trajectory=fixture('trajectory.json');delete trajectory.metadata.synthetic
    const secretTestText='private-audit-content-must-not-be-returned'
    trajectory.actions[0].args.content=secretTestText
    fs.writeFileSync(path.join(temp,'run.json'),JSON.stringify(trajectory))
    const report=auditArtifact(temp)
    assert(report.some(item=>item.kind==='privateConfiguration'))
    assert(!JSON.stringify(report).includes(secretTestText))
  }finally{
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))
    fs.rmSync(temp,{recursive:true,force:true})
  }
})
