import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {describeSceneIssue,sceneIssueMessages} from '../src/mecoffe/sceneIssues.js'

test('shared messages exactly cover Python scene modules and frontend map/result/placement codes',()=>{
  const codes=new Set()
  const python=new URL('../../adapter/scene_service/',import.meta.url)
  const files=fs.readdirSync(python).filter(name=>name.endsWith('.py')).map(name=>new URL(name,python))
  for(const name of ['sceneMap.js','sceneResult.js','scenePlacement.js'])files.push(new URL('../src/mecoffe/'+name,import.meta.url))
  for(const file of files)for(const match of fs.readFileSync(file,'utf8').matchAll(/['"]([A-Z][A-Z0-9_]+)['"]/g))codes.add(match[1])
  assert.deepEqual(Object.keys(sceneIssueMessages).sort(),[...codes].sort())
  for(const [code,message] of Object.entries(sceneIssueMessages)){
    assert(['error','warning'].includes(message.severity),code)
    assert.match(message.user_message,/[\u4e00-\u9fff]/)
    assert.match(message.admin_message,/[\u4e00-\u9fff]/)
    assert(message.actions.length&&message.actions.every(value=>typeof value==='string'&&value.trim()),code)
    assert.match(message.rerun_scope,/[\u4e00-\u9fff]/)
  }
})

test('Chinese explanations retain diagnostics and cannot mutate the shared table',()=>{
  const issue=describeSceneIssue({code:'MAP_FILE_MISSING',message:'original diagnostic'})
  assert.equal(issue.code,'MAP_FILE_MISSING')
  assert.equal(issue.details,'original diagnostic')
  assert.equal(issue.user_message,sceneIssueMessages.MAP_FILE_MISSING.user_message)
  issue.actions.length=0
  assert(describeSceneIssue({code:'MAP_FILE_MISSING'}).actions.length)
  assert.equal(describeSceneIssue(new SyntaxError('bad JSON')).code,'INVALID_INPUT')
  assert.equal(describeSceneIssue({code:'OTHER_ENGINE_ERROR'}).code,'OTHER_ENGINE_ERROR')
  assert.equal(describeSceneIssue({code:'OTHER_ENGINE_ERROR'}).user_message,sceneIssueMessages.INVALID_INPUT.user_message)
})
