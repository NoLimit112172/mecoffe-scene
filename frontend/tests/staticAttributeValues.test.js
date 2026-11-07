import test from 'node:test'
import assert from 'node:assert/strict'
import {displayStaticAttributeValue} from '../src/mecoffe/staticAttributeValues.js'

test('known CFPS values are Chinese with their units and interval meanings',()=>{
  assert.equal(displayStaticAttributeValue('gender','male'),'男')
  assert.equal(displayStaticAttributeValue('gender','female'),'女')
  assert.equal(displayStaticAttributeValue('age_group','18_24'),'18—24 岁')
  assert.equal(displayStaticAttributeValue('education_status','student_bachelor'),'在读本科')
  assert.match(displayStaticAttributeValue('household_income_band','10k_30k'),/家庭人均年收入.*不足 3 万元/)
  assert.equal(displayStaticAttributeValue('stranger_trust_score','5'),'5 分（0—10 分）')
})

test('unknown values and prototype-like codes preserve their original value and type',()=>{
  const raw={unfamiliar:true}
  assert.equal(displayStaticAttributeValue('unknown',raw),raw)
  assert.equal(displayStaticAttributeValue('gender','constructor'),'constructor')
  assert.equal(displayStaticAttributeValue('constructor','male'),'male')
  assert.equal(displayStaticAttributeValue('age',23),23)
  const input=['male','other'];assert.deepEqual(displayStaticAttributeValue('gender',input),['男','other']);assert.deepEqual(input,['male','other'])
})
