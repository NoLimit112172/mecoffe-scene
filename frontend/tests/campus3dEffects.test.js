import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  EventEffects, arcPoints, eventConnections, formatPurchaseReceipt,
  visualEventStyle, withBloomIsolation, withShadowUpdatesFrozen,
} from '../src/mecoffe/Campus3DEffects.js'

test('effect connections retain only recorded, known participants without mutating events', () => {
  const known = new Set(['alice', 'bob', 'merchant_001'])
  const event = Object.freeze({ type: 'ad', actor: 'merchant_001', targeted: Object.freeze(['alice', 'alice', 'bob', 'missing']) })
  assert.deepEqual(eventConnections(event, known), [
    { source: 'merchant_001', target: 'alice', kind: 'ad' },
    { source: 'merchant_001', target: 'bob', kind: 'ad' },
  ])
  assert.deepEqual(eventConnections({ type: 'exposure', actor: 'alice', brand_ids: ['merchant_001'] }, known), [
    { source: 'merchant_001', target: 'alice', kind: 'ad' },
  ])
  assert.deepEqual(eventConnections({ type: 'comment', actor: 'alice', target: 'bob' }, known), [
    { source: 'alice', target: 'bob', kind: 'comment' },
  ])
  assert.deepEqual(eventConnections({ type: 'follow', actor: 'alice', target: 'alice' }, known), [])
  assert.deepEqual(eventConnections({ type: 'post', actor: 'alice', target: 'bob' }, known), [])
  assert.deepEqual(event.targeted, ['alice', 'alice', 'bob', 'missing'])
})

test('arrival labels use recorded quantities and cents and never invent missing money', () => {
  assert.equal(formatPurchaseReceipt({ quantity: 2, amount_fen: 1980 }), '+2 ☕  ¥19.80')
  assert.equal(formatPurchaseReceipt({ quantity: 1, amount_fen: 0 }), '+1 ☕  ¥0.00')
  assert.equal(formatPurchaseReceipt({}), '+1 ☕  金额未记录')
  const post = visualEventStyle('post')
  const comment = visualEventStyle('comment')
  assert.notEqual(post.color, comment.color)
  post.duration = 999
  assert.notEqual(visualEventStyle('post').duration, 999)
  assert.equal(visualEventStyle('unknown'), null)
})

test('arcs retain directional endpoints and lift above the straight connection', () => {
  const start = Object.freeze({ x: 0, y: 20, z: 10 })
  const end = Object.freeze({ x: 100, y: 40, z: -30 })
  const points = arcPoints(start, end, 20)
  assert.equal(points.length, 21)
  assert.deepEqual(points[0], start)
  assert.deepEqual(points.at(-1), end)
  assert.equal(points[10].x, 50)
  assert.equal(points[10].z, -10)
  assert.ok(points[10].y > 30)
  assert.ok(points.every(point => Object.values(point).every(Number.isFinite)))
  const reversed = arcPoints(end, start, 20)
  points.forEach((point, i) => {
    const other = reversed.at(-1 - i)
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(point[axis] - other[axis]) < 1e-10)
  })
})

function fixture() {
  const scene = new THREE.Scene()
  const index = { people: new Map([
    ['alice', { id: 'alice', role: 'undergraduate_consumer', building_id: 'home-a' }],
    ['bob', { id: 'bob', role: 'graduate_consumer', building_id: 'home-b' }],
    ['merchant_001', { id: 'merchant_001', role: 'merchant', home_location_id: 'shop_merchant_001' }],
  ]) }
  const routing = { anchors: new Map([
    ['home-a', { center: { x: 0, y: 0 }, building: { height_m: 20 } }],
    ['home-b', { center: { x: 100, y: 30 }, building: { height_m: 18 } }],
    ['shop_merchant_001', { center: { x: 30, y: -20 }, building: { height_m: 12 } }],
  ]) }
  const marker = new THREE.Group()
  marker.position.set(35, 0.4, 20)
  const labels = []
  const effects = new EventEffects({ scene, index, routing, shopMarkers: new Map([['merchant_001', marker]]),
    // Replace Canvas texture creation only; real effect objects, geometries,
    // event planning, animation, caps and resource lifetime remain unchanged.
    labelFactory: (text, color, height) => {
      labels.push({ text, color, height })
      return new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true }))
    } })
  return { scene, effects, labels }
}

test('purchases do not create arrival effects before the existing walker arrives', () => {
  const { scene, effects, labels } = fixture()
  const purchase = { type: 'purchase', actor: 'alice', brand_id: 'merchant_001', quantity: 1, amount_fen: 990 }
  effects.playEvent(purchase)
  assert.equal(effects.effects.length, 0)
  effects.purchaseArrived(purchase)
  assert.equal(effects.effects.length, 2)
  assert.equal(labels[0].text, '+1 ☕  ¥9.90')
  const circle = effects.effects.find(effect => effect.kind === 'arrival')
  assert.equal(circle.circle.userData.bloom, true)
  effects.update(0.5)
  assert.ok(circle.circle.scale.x > 1)
  assert.ok(effects.effects[0].object.position.y > effects.effects[0].origin.y)
  const y = effects.effects[0].object.position.y
  effects.update(0)
  assert.equal(effects.effects[0].object.position.y, y)
  effects.update(10)
  assert.equal(effects.effects.length, 0)
  assert.equal(effects.group.children.length, 0)
  effects.dispose()
  assert.equal(scene.children.length, 0)
})

test('burst events are bounded, lower quality hides particles, and reset removes every effect', () => {
  const { effects } = fixture()
  const ad = { type: 'ad', actor: 'merchant_001', targeted: ['alice', 'bob'] }
  for (let i = 0; i < 100; i += 1) effects.playEvent(ad)
  assert.ok(effects.effects.length <= 72)
  assert.equal(effects.effects.length, effects.group.children.length)
  effects.setQuality('low')
  assert.ok(effects.effects.length <= 28)
  assert.ok(effects.effects.flatMap(effect => effect.particles || []).every(particle => !particle.visible))
  effects.reset()
  assert.equal(effects.group.children.length, 0)
  effects.playEvent({ type: 'comment', actor: 'alice', target: 'bob' })
  assert.equal(effects.effects.length, 2)
  effects.dispose()
  effects.dispose()
  assert.equal(effects.group.children.length, 0)
})

test('selective bloom restores materials, visibility, fog and background even if rendering throws', () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xabc123)
  scene.fog = new THREE.Fog(0x112233, 10, 100)
  const background = scene.background
  const fog = scene.fog
  const ordinaryMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const cap = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const windows = new THREE.MeshBasicMaterial({ color: 0xffcc88 })
  const ordinary = new THREE.Mesh(new THREE.BoxGeometry(), ordinaryMaterial)
  const building = new THREE.Mesh(new THREE.BoxGeometry(), [ordinaryMaterial, ordinaryMaterial])
  const originalBuildingMaterials = building.material
  building.userData.bloomMaterial = [cap, windows]
  const glow = new THREE.Mesh(new THREE.SphereGeometry(), windows)
  glow.userData.bloom = true
  const sky = new THREE.Mesh(new THREE.SphereGeometry(), ordinaryMaterial)
  sky.userData.bloomOcclusion = false
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial())
  sprite.visible = false
  const pickProxy = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial({ visible: false }))
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000 })
  scene.add(ordinary, building, glow, sky, line, sprite, pickProxy)
  assert.throws(() => withBloomIsolation(scene, dark, () => {
    assert.equal(ordinary.material, dark)
    assert.equal(building.material, building.userData.bloomMaterial)
    assert.equal(glow.material, windows)
    assert.equal(sky.visible, false)
    assert.equal(line.visible, false)
    assert.equal(sprite.visible, false)
    assert.equal(pickProxy.visible, false)
    assert.equal(scene.fog, null)
    assert.equal(scene.background.getHex(), 0)
    throw new Error('intentional render failure')
  }), /intentional render failure/)
  assert.equal(ordinary.material, ordinaryMaterial)
  assert.equal(building.material, originalBuildingMaterials)
  assert.equal(glow.material, windows)
  assert.equal(sky.visible, true)
  assert.equal(line.visible, true)
  assert.equal(sprite.visible, false)
  assert.equal(pickProxy.visible, true)
  assert.equal(pickProxy.material.visible, false)
  assert.equal(scene.background, background)
  assert.equal(scene.fog, fog)
})

test('bloom cannot consume pending shadow refreshes and restores both flags after success or failure', () => {
  for (const autoUpdate of [false, true]) {
    for (const needsUpdate of [false, true]) {
      const shadowMap = { autoUpdate, needsUpdate }
      const render = () => {
        assert.equal(shadowMap.autoUpdate, false)
        assert.equal(shadowMap.needsUpdate, false)
        // Simulate an accidental mutation inside the isolated pass too.
        shadowMap.autoUpdate = true
        shadowMap.needsUpdate = true
        return 'rendered'
      }
      assert.equal(withShadowUpdatesFrozen(shadowMap, render), 'rendered')
      assert.deepEqual(shadowMap, { autoUpdate, needsUpdate })
      assert.throws(() => withShadowUpdatesFrozen(shadowMap, () => {
        render()
        throw new Error('intentional shadow failure')
      }), /intentional shadow failure/)
      assert.deepEqual(shadowMap, { autoUpdate, needsUpdate })
    }
  }
})
