import test from 'node:test'
import assert from 'node:assert/strict'
import {relationLineStyle} from '../src/mecoffe/Campus3DAnnotations.js'

test('overview relationships gain bounded contrast and pixel width while near views retain their style',()=>{
  assert.deepEqual(relationLineStyle(0),{width:2.8,opacity:.55})
  assert.deepEqual(relationLineStyle(260),{width:2.8,opacity:.55})
  assert.deepEqual(relationLineStyle(NaN),relationLineStyle(0))
  let previous=relationLineStyle(0)
  for(const distance of [300,500,800,1200,10000]){
    const style=relationLineStyle(distance)
    assert(style.width>=previous.width&&style.width<=4.2)
    assert(style.opacity>=previous.opacity&&style.opacity<=.79)
    previous=style
  }
})

import {genericRoleColor,displayRoleColor} from '../src/mecoffe/characterDisplay.js'
test('arbitrary roles receive deterministic valid colours without a four-role requirement',()=>{
  for(const role of ['visitor','operator','research','constructor','new_custom_role']){
    assert.match(genericRoleColor(role),/^#[a-f0-9]{6}$/)
    assert.equal(genericRoleColor(role),genericRoleColor(role))
  }
  assert(new Set(['visitor','operator','research'].map(genericRoleColor)).size>1)
})

test('prototype-like custom roles cannot inherit a colour from Object.prototype',()=>{
  for(const role of ['constructor','__proto__','toString'])assert.equal(displayRoleColor(role,{visitor:'#123456'}),genericRoleColor(role))
  assert.equal(displayRoleColor('visitor',{visitor:'#123456'}),'#123456')
})
