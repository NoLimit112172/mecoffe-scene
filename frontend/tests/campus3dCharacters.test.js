import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CHARACTER_ROLE_COLORS, CharacterBatch, characterAppearance, facingAngle, walkingPose } from '../src/mecoffe/Campus3DCharacters.js'

const matrixOf = (batch, part, id = 'student') => {
  const matrix = new THREE.Matrix4()
  batch.meshes.get(part).getMatrixAt(batch.indices.get(id), matrix)
  return matrix
}
const positionOf = matrix => new THREE.Vector3().setFromMatrixPosition(matrix)
function example() {
  const scene = new THREE.Scene()
  const figure = new THREE.Group()
  figure.position.set(40, 0.35, -90)
  figure.rotation.y = Math.PI / 2
  figure.scale.setScalar(2)
  scene.add(figure)
  const entry = { person: { id: 'student', role: 'undergraduate_consumer' }, figure, walker: null }
  const entries = new Map([['student', entry]])
  const batch = new CharacterBatch({ scene, entries })
  return { scene, figure, entry, batch }
}

test('appearance is deterministic and role clothing and accessories remain distinct', () => {
  const roles = Object.keys(CHARACTER_ROLE_COLORS)
  assert.equal(new Set(roles.map(role => characterAppearance({ id: 'same', role }).shirt)).size, roles.length)
  const person = { id: 'student-002', role: 'graduate_consumer' }
  const original = { ...person }
  assert.deepEqual(characterAppearance(person), characterAppearance({ ...person }))
  assert.deepEqual(person, original)
  assert.equal(characterAppearance(person).backpack, true)
  assert.equal(characterAppearance({ id: 'teacher', role: 'teacher_consumer' }).collar, true)
  assert.equal(characterAppearance({ id: 'merchant', role: 'merchant' }).apron, true)
})

test('walking alternates opposite legs and arms while holding coffee keeps the right arm steady', () => {
  const moving = walkingPose(0.21, 'person', true, false)
  assert.ok(Math.abs(moving.leftLeg) > 0.01)
  assert.equal(moving.leftLeg, -moving.rightLeg)
  assert.equal(moving.leftArm, -moving.rightArm)
  assert.notEqual(walkingPose(0.31, 'person', true).leftLeg, moving.leftLeg)
  assert.equal(walkingPose(0.21, 'person', false).leftLeg, 0)
  const coffee = walkingPose(0.21, 'person', true, true)
  assert.equal(coffee.rightArm, -0.95)
  assert.equal(coffee.rightForearm, -0.35)
  assert.equal(coffee.coffee, true)
  assert.deepEqual(walkingPose(7.1, 'person', true, true), walkingPose(7.1, 'person', true, true))
  assert.deepEqual(walkingPose(NaN, 'person'), walkingPose(0, 'person'))
})

test('forward yaw follows +Z and preserves the last orientation for a zero direction', () => {
  assert.equal(facingAngle(0, 5), 0)
  assert.equal(facingAngle(5, 0), Math.PI / 2)
  assert.equal(facingAngle(-5, 0), -Math.PI / 2)
  assert.equal(facingAngle(0, -5), Math.PI)
  assert.equal(facingAngle(0, 0, 1.2), 1.2)
  assert.equal(facingAngle(NaN, 1, 0.4), 0.4)
})

test('instanced rig follows root position, rotation and display scale without changing the route transform', () => {
  const { batch, figure, entry } = example()
  const originalPosition = figure.position.clone()
  const originalRotation = figure.quaternion.clone()
  const originalScale = figure.scale.clone()
  const first = matrixOf(batch, 'torso')
  assert.ok(batch.meshes.size > 10)
  assert.ok([...batch.meshes.values()].every(mesh => mesh.isInstancedMesh && mesh.count === 1))
  const torso = positionOf(first)
  assert.ok(Math.abs(torso.x - 40) < 0.001)
  assert.ok(Math.abs(torso.z + 90) < 0.001)
  assert.ok(torso.y > 9 && torso.y < 11)
  entry.walker = { phase: 'outbound' }
  batch.update(0.2)
  assert.notDeepEqual(matrixOf(batch, 'left-leg').elements, matrixOf(batch, 'right-leg').elements)
  assert.deepEqual(figure.position, originalPosition)
  assert.deepEqual(figure.quaternion.toArray(), originalRotation.toArray())
  assert.deepEqual(figure.scale, originalScale)
  const frozen = matrixOf(batch, 'right-sleeve').elements.slice()
  batch.update(0.2)
  assert.deepEqual(matrixOf(batch, 'right-sleeve').elements, frozen)
  batch.dispose()
})

test('coffee appears on return and visibility/quality controls do not remove actor entries', () => {
  const { batch, entry, scene } = example()
  assert.equal(matrixOf(batch, 'cup').determinant(), 0)
  entry.walker = { phase: 'return' }
  batch.update(1)
  assert.ok(matrixOf(batch, 'cup').determinant() > 0)
  entry.walker = null
  entry.hasCoffee = true
  batch.update(2)
  assert.ok(matrixOf(batch, 'cup').determinant() > 0)
  entry.presentationVisible = false
  batch.update(2)
  assert.ok([...batch.meshes.keys()].every(part => matrixOf(batch, part).determinant() === 0))
  assert.equal(batch.actors.length, 1)
  batch.setQuality('low')
  assert.ok([...batch.meshes.values()].every(mesh => !mesh.castShadow))
  batch.setQuality('high')
  assert.equal(batch.meshes.get('torso').castShadow, true)
  batch.dispose()
  assert.equal(scene.children.includes(batch.group), false)
  assert.equal(batch.meshes.size, 0)
  assert.doesNotThrow(() => batch.dispose())
})
