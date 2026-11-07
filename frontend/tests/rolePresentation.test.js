import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {presentRole,snapshotRoleDescriptions,ROLE_LABEL_LIMIT} from '../src/mecoffe/rolePresentation.js'
import {normalizeConfigPreview,buildConfigPreviewScenario} from '../src/mecoffe/configPreview.js'
import {buildGenericReplayScenario} from '../src/mecoffe/genericReplay.js'
const read=name=>JSON.parse(fs.readFileSync(new URL(`./fixtures/generic-replay/${name}.json`,import.meta.url)))
const sample=()=>({trajectory:read('trajectory'),snapshot:read('snapshot'),plan:read('plan')})
const map={manifest:{id:'synthetic-map',simulation_time:{start:'2026-01-01T00:00:00+08:00',timezone:'Asia/Shanghai'}},files:{'campus3d.json':{campus_id:'synthetic-map',buildings:[{osm_id:'test/a',name:'合成楼栋',kind:'education',polygon:[[0,0],[20,0],[20,20],[0,20],[0,0]]}]}}}
const scene=bundle=>buildGenericReplayScenario(bundle,map).files['trajectory.json']

test('role descriptions produce a bounded Unicode-safe label and preserve the full source text',()=>{
  assert.deepEqual(presentRole('visitor',null),{label:'visitor',description:''})
  assert.deepEqual(presentRole('visitor','  '),{label:'visitor',description:''})
  const full='  完全合成的校园临时到访交流学习人员并附有更多说明\n用于检验长标签  '
  const result=presentRole('visitor',full)
  assert.equal(result.description,full)
  assert.equal(Array.from(result.label).length,ROLE_LABEL_LIMIT+1)
  assert(result.label.endsWith('…'))
  assert.equal(presentRole('role','🚶🚶🚶🚶',2).label,'🚶🚶…')
  assert.equal(presentRole('visitor','样例访客').label,'样例访客')
})

test('only explicit snapshot role metadata is used and selection is order independent',()=>{
  const snapshot={nodes:[{role:'r',role_description:'English description'},{role:'r',role_description:'中文角色说明'},{role:'r',role_description:'另一个明确说明'},
    {role:'unknown',name:'老师',bio:'这个人是老师'},{role:'constructor',role_description:'合成特殊角色'}]}
  const before=JSON.stringify(snapshot),first=snapshotRoleDescriptions(snapshot)
  assert(first.get('r').match(/[\p{Script=Han}]/u))
  snapshot.nodes.reverse()
  assert.deepEqual([...snapshotRoleDescriptions(snapshot)].sort(),[...first].sort())
  assert(!first.has('unknown'))
  assert.equal(first.get('constructor'),'合成特殊角色')
  snapshot.nodes.reverse();assert.equal(JSON.stringify(snapshot),before)
})

test('configuration descriptions take priority over snapshot metadata while retaining raw role keys',()=>{
  const bundle=sample(),request=Object.fromEntries(['visitor','operator','research'].map(role=>[role,{description:`配置期${role}中文身份`,count:bundle.snapshot.nodes.filter(n=>n.role===role).length,generate:{}}]))
  const input=normalizeConfigPreview({network:bundle.snapshot,roles:{population_request:request}})
  const result=buildConfigPreviewScenario(input,map).files['trajectory.json']
  for(const person of result.people){assert.equal(person.role_description,request[person.role].description);assert.equal(person.role_label,presentRole(person.role,request[person.role].description).label)}
  assert.equal(result.people[0].role,'visitor')
})

test('replay uses frozen snapshot Chinese titles, explicit role-stage descriptions win, absent metadata stays raw',()=>{
  const bundle=sample(),before=JSON.stringify(bundle),result=scene(bundle)
  assert.deepEqual([...new Set(result.people.map(p=>p.role_label))].sort(),['样例经营者','样例研究人员','样例访客'].sort())
  assert.equal(result.people[0].role_description,'样例访客')
  assert.equal(JSON.stringify(bundle),before)
  const missing=sample();for(const node of missing.snapshot.nodes)delete node.role_description
  assert.equal(scene(missing).people[0].role_label,'visitor')
  const long='完全合成的具有很长身份描述的校园参观交流人员，全文应保留供查看'
  bundle.roles={population_request:Object.fromEntries(['visitor','operator','research'].map(role=>[role,{description:role==='visitor'?long:'明确指定的角色说明',count:bundle.snapshot.nodes.filter(n=>n.role===role).length,generate:{}}]))}
  const withRoles=scene(bundle).people[0]
  assert.equal(withRoles.role_description,long);assert.equal(withRoles.role_label,presentRole('visitor',long).label)
  const order=Object.fromEntries(scene(bundle).people.map(p=>[p.id,p.role_label]));bundle.snapshot.nodes.reverse();bundle.trajectory.agents.reverse()
  assert.deepEqual(Object.fromEntries(scene(bundle).people.map(p=>[p.id,p.role_label])),order)
})
