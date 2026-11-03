import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { Campus3DScene } from '../src/mecoffe/Campus3DScene.js'
import { indexScene } from '../src/mecoffe/replay.js'
import { projectedPersonSize } from '../src/mecoffe/campus3dScreen.js'
import { fitCampusView } from '../src/mecoffe/campus3dView.js'

const purchase = (order, brand = 'merchant_001', step = 1) => ({
  key: `event-${order}`, type: 'purchase', order_id: order,
  actor: 'consumer', brand_id: brand, quantity: 1, amount_fen: 900, step,
})

const ring = (x, y) => [
  [x - 2, y - 2], [x + 2, y - 2], [x + 2, y + 2],
  [x - 2, y + 2], [x - 2, y - 2],
]

// Use real Three.js scene objects and the renderer's real placement / trip
// methods. Only WebGL / DOM initialization is omitted, so these tests run in
// Node without replacing routing, queue, geometry, or movement implementations.
function world({ disconnectedShop = false, events } = {}) {
  const campus = {
    buildings: [
      { osm_id: 'home', polygon: ring(0, 0) },
      { osm_id: 'shop-a', polygon: ring(30, 40) },
      { osm_id: 'shop-b', polygon: disconnectedShop ? ring(200, 200) : ring(80, 40) },
    ],
    walk_graph: {
      nodes: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0 },
        { id: 'c', x: 30, y: 40 }, { id: 'd', x: 80, y: 40 },
        { id: 'isolated', x: 200, y: 200 },
      ],
      edges: [
        { source: 'a', target: 'b', length_m: 30 },
        { source: 'b', target: 'c', length_m: 40 },
        { source: 'c', target: 'd', length_m: 50 },
      ],
    },
  }
  const mapping = { mappings: {
    ug_dorm_west: { osm_id: 'home', illustrative: true },
    shop_merchant_001: { osm_id: 'shop-a', illustrative: true },
    shop_merchant_002: { osm_id: 'shop-b', illustrative: true },
  } }
  const people = [{ id: 'consumer', name: '示例消费者', role: 'undergraduate_consumer', building_id: 'ug_dorm_west' }]
  const scene = {
    people, campus: { locations: [] }, relationships: [],
    brands: [{ brand_id: 'merchant_001' }, { brand_id: 'merchant_002' }],
    days: [{ step: 1, label: '第1天', complete: true }, { step: 2, label: '第2天', complete: true }],
    events: events || [purchase('first'), purchase('second', 'merchant_002'), purchase('third', 'merchant_001', 2)],
  }
  const stats = []
  const renderer = new Campus3DScene({ campus, mapping, index: indexScene(scene), onStats: value => stats.push(value) })
  renderer.scene = new THREE.Scene()
  renderer.routeLayer = new THREE.Group()
  renderer.effectLayer = new THREE.Group()
  renderer.relationLayer = new THREE.Group()
  renderer.scene.add(renderer.routeLayer, renderer.effectLayer, renderer.relationLayer)
  renderer.placePeople()
  return { renderer, entry: renderer.people.get('consumer'), stats }
}

function at(entry, x, y) {
  assert.ok(Math.abs(entry.figure.position.x - x) < 1e-8, `expected x=${x}, got ${entry.figure.position.x}`)
  assert.ok(Math.abs(-entry.figure.position.z - y) < 1e-8, `expected north=${y}, got ${-entry.figure.position.z}`)
  assert.equal(entry.figure.position.y, 0.35)
}

function finishTrip(renderer) {
  renderer.updateWalkers(2) // reach the shop, including both corners
  renderer.updateWalkers(1) // dwell, then begin the reverse route
  renderer.updateWalkers(2) // return home and start the next queued order
}

test('arrival hands over one cup and receipt, return retains it, seek clears it', () => {
  const { renderer, entry } = world()
  const receipts = []
  renderer.eventEffects = { effects: [], purchaseArrived: event => receipts.push(event.order_id), reset() {} }
  renderer.playEvent(purchase('coffee'))
  assert.equal(entry.hasCoffee, false)
  renderer.updateWalkers(.7)
  assert.equal(entry.walker.phase, 'dwell')
  assert.equal(entry.hasCoffee, true)
  renderer.updateWalkers(.9)
  assert.equal(entry.walker.phase, 'return')
  assert.equal(entry.hasCoffee, true)
  renderer.updateWalkers(.7)
  assert.deepEqual(receipts, ['coffee'])
  assert.equal(entry.hasCoffee, true)
  renderer.setCursor(0)
  assert.equal(entry.hasCoffee, false)
})

test('visual activity drains standalone events without changing movement statistics', () => {
  const { renderer } = world()
  const counts = []
  renderer.onVisualActivity = count => counts.push(count)
  renderer.eventEffects = {
    effects: [],
    playEvent() { this.effects.push({ life: 0 }) },
    reset() { this.effects = [] },
  }
  renderer.playEvent({ actor: 'consumer', type: 'post' })
  assert.deepEqual(counts, [1])
  assert.deepEqual(renderer.getStats(), { active: 0, queued: 0, unreachable: 0 })
  renderer.eventEffects.effects = []
  renderer.emitVisualActivity()
  assert.deepEqual(counts, [1, 0])
  renderer.playEvent({ actor: 'consumer', type: 'ad' })
  renderer.setCursor(0)
  assert.deepEqual(counts, [1, 0, 1, 0])
})

test('hover restores the original night window colour instead of switching it off', () => {
  const { renderer } = world()
  const wall = new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity: 2 })
  const roof = new THREE.MeshStandardMaterial({ emissive: '#231e12' })
  const building = new THREE.Mesh(new THREE.BoxGeometry(), [roof, wall])
  building.userData.building = { osm_id: 'home', name: '宿舍' }
  renderer.raycaster = { setFromCamera() {}, intersectObjects: () => [{ object: building }] }
  renderer.pointer = new THREE.Vector2()
  renderer.renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), style: {} } }
  const original = [roof.emissive.clone(), wall.emissive.clone()]
  renderer.pick({ clientX: 50, clientY: 50 }, false)
  renderer.clearHoveredBuilding()
  assert.deepEqual([roof.emissive, wall.emissive], original)
  assert.equal(wall.emissiveIntensity, 2)
  building.geometry.dispose()
  roof.dispose()
  wall.dispose()
})

test('portrait camera avoids a foreground obstruction without moving the actor or its route', () => {
  const { renderer, entry } = world()
  renderer.camera = new THREE.PerspectiveCamera(42, 1.8, .1, 10000)
  renderer.host = { clientWidth: 1208, clientHeight: 647 }
  renderer.controls = { target: new THREE.Vector3(), enableDamping: true, update() {
    renderer.camera.lookAt(this.target)
    renderer.camera.updateMatrixWorld()
  } }
  renderer.playEvent(purchase('portrait'))
  const before = entry.figure.position.clone()
  const route = JSON.stringify(entry.walker.points)
  const obstruction = new THREE.Mesh(new THREE.BoxGeometry(7, 15, 7), new THREE.MeshBasicMaterial())
  obstruction.position.set(before.x + Math.sin(.55) * 18, 7, before.z + Math.cos(.55) * 18)
  renderer.scene.add(obstruction)
  renderer.environment = { trees: obstruction }
  renderer.focusPerson('consumer')
  assert.ok(Math.abs(renderer.camera.position.x - before.x - Math.sin(.55) * 38) > 1)
  assert.deepEqual(entry.figure.position, before)
  assert.equal(JSON.stringify(entry.walker.points), route)
  assert.equal(renderer.selectedId, 'consumer')
  obstruction.geometry.dispose()
  obstruction.material.dispose()
})

test('switching pixel and solid characters preserves ongoing trips, queued orders and pause state', () => {
  const { renderer, entry } = world()
  renderer.playEvent(purchase('first-style'))
  renderer.playEvent(purchase('second-style', 'merchant_002'))
  renderer.updateWalkers(.1)
  renderer.setPlaying(false)
  const position = entry.figure.position.clone()
  const walker = entry.walker
  const queue = [...entry.queue]
  const statistics = renderer.getStats()
  const visible = []
  renderer.pixelBatch = { setVisible: value => visible.push(value) }
  for (const style of ['pixel', 'solid', 'pixel']) {
    renderer.setCharacterStyle(style)
    assert.deepEqual(entry.figure.position, position)
    assert.equal(entry.walker, walker)
    assert.deepEqual(entry.queue, queue)
    assert.deepEqual(renderer.getStats(), statistics)
    assert.equal(renderer.playing, false)
    assert.equal(renderer.characterBatch.group.visible, style === 'solid')
  }
  assert.deepEqual(visible, [true, false, true])
})

test('surrounding roads and cropped display never extend or replace the original walking graph', () => {
  const json = relative => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'))
  const campus = json('../../scene/campus3d.json')
  const mapping = json('../../scene/campus3d_mapping.json')
  const scene = json('../public/mecoffe/latest-demo.json')
  const roads = json('../public/mecoffe/campus3d_surroundings.json').roads
  const source = structuredClone(campus)
  const renderer = new Campus3DScene({ campus, mapping, index:indexScene(scene), surroundings:roads })
  assert.equal(renderer.campus, campus)
  assert.equal(renderer.display.campus.walk_graph, campus.walk_graph)
  assert.equal(renderer.routing.nodes.size, campus.walk_graph.nodes.length)
  assert.deepEqual(campus, source)
  assert.equal(renderer.display.bounds.routeCount, 12)
  assert.ok(renderer.display.bounds.maxY < 100)
  assert.ok(campus.bounds_m.max_y > 450)
  const graphIds = new Set(campus.walk_graph.nodes.map(node => node.id))
  assert.ok([...renderer.routing.nodes.keys()].every(id => graphIds.has(id)))
})

test('one person completes purchase trips in FIFO order without losing queued purchases', () => {
  const { renderer, entry } = world()
  for (const event of renderer.index.scene.events) renderer.playEvent(event)
  assert.equal(entry.walker.event.order_id, 'first')
  assert.deepEqual(entry.queue.map(trip => trip.event.order_id), ['second', 'third'])
  assert.deepEqual(renderer.getStats(), { active: 1, queued: 2, unreachable: 0 })
  assert.equal(renderer.routeLayer.children.length, 1)

  finishTrip(renderer)
  assert.equal(entry.walker.event.order_id, 'second')
  assert.deepEqual(entry.queue.map(trip => trip.event.order_id), ['third'])
  assert.equal(renderer.routeLayer.children.length, 1)
  finishTrip(renderer)
  assert.equal(entry.walker.event.order_id, 'third')
  assert.deepEqual(entry.queue, [])
  finishTrip(renderer)
  assert.equal(entry.walker, null)
  assert.deepEqual(renderer.getStats(), { active: 0, queued: 0, unreachable: 0 })
  assert.equal(renderer.routeLayer.children.length, 0)
  at(entry, entry.home.x, entry.home.y)
})

test('screen scaling and walking halos preserve world positions, route speed and selection', () => {
  const { renderer, entry } = world()
  renderer.host = { clientWidth: 1230, clientHeight: 650 }
  renderer.camera = new THREE.PerspectiveCamera(42, 1230 / 650, 0.1, 10000)
  renderer.camera.position.set(1200, 900, 500)
  renderer.camera.lookAt(0, 0, 0)
  const home = entry.figure.position.clone()
  renderer.selectPerson('consumer')
  renderer.updateScreenVisuals()
  assert.ok(projectedPersonSize(renderer.camera, entry.figure.position, entry.figure.scale.x, { width: 1230, height: 650 }).height >= 12)
  assert.deepEqual(entry.figure.position, home)
  assert.equal(entry.walkHalo.visible, false)
  assert.equal(renderer.selection.scale.x, entry.figure.scale.x)
  renderer.playEvent(purchase('visual-walk'))
  renderer.updateScreenVisuals()
  assert.equal(entry.walkHalo.visible, true)
  renderer.updateWalkers(0.1)
  renderer.updateScreenVisuals()
  at(entry, 10, 0) // 100 metres/second remains unchanged by screen scale.
  renderer.setCursor(0)
  renderer.updateScreenVisuals()
  assert.deepEqual(entry.figure.position, home)
  assert.equal(entry.walkHalo.visible, false)
  renderer.camera.position.multiplyScalar(2)
  renderer.camera.updateMatrixWorld()
  renderer.updateScreenVisuals()
  assert.ok(projectedPersonSize(renderer.camera, entry.figure.position, entry.figure.scale.x, { width: 1230, height: 650 }).height >= 12)
})

test('all 100 real roster figures meet the minimum at the 1600×1000 page overview', () => {
  const json = relative => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'))
  const campus = json('../../scene/campus3d.json')
  const mapping = json('../../scene/campus3d_mapping.json')
  const scene = json('../public/mecoffe/latest-demo.json')
  const renderer = new Campus3DScene({ campus, mapping, index: indexScene(scene) })
  renderer.scene = new THREE.Scene()
  renderer.placePeople()
  renderer.host = { clientWidth: 1208, clientHeight: 647 }
  const fit = fitCampusView(campus, { aspect: 1208 / 647 })
  renderer.camera = new THREE.PerspectiveCamera(42, 1208 / 647, 0.5, 15000)
  renderer.camera.position.copy(fit.position)
  renderer.camera.lookAt(fit.target)
  renderer.updateScreenVisuals()
  assert.equal(renderer.people.size, 100)
  for (const entry of renderer.people.values()) {
    const pixels = projectedPersonSize(renderer.camera, entry.figure.position, entry.figure.scale.x, { width: 1208, height: 647 })
    assert.ok(pixels.height >= 12, `${entry.person.id}: ${pixels.height}px`)
    at(entry, entry.home.x, entry.home.y)
  }
  renderer.dispose()
})

test('duplicate order IDs and repeated fallback event keys never create extra trips', () => {
  const { renderer, entry } = world()
  const event = purchase('shared-order')
  renderer.playEvent(event)
  renderer.playEvent({ ...event, key: 'another-key-for-the-same-order' })
  assert.equal(entry.queue.length, 0)
  const fallback = { ...purchase('fallback'), order_id: undefined }
  renderer.playEvent(fallback)
  renderer.playEvent({ ...fallback })
  assert.equal(entry.queue.length, 1)
  assert.equal(renderer.seenOrders.size, 2)
  finishTrip(renderer)
  assert.equal(entry.walker.event.key, fallback.key)
  finishTrip(renderer)
  renderer.playEvent(event)
  renderer.playEvent(fallback)
  assert.equal(entry.walker, null)
  assert.equal(renderer.routeLayer.children.length, 0)
})

test('movement follows graph corners at metre distances and returns on the exact reverse path', () => {
  const { renderer, entry } = world()
  renderer.playEvent(purchase('route'))
  assert.deepEqual(entry.walker.route.node_ids, ['a', 'b', 'c'])
  const outbound = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }]
  assert.deepEqual(entry.walker.points, outbound)
  const positions = entry.walker.line.geometry.attributes.position
  assert.deepEqual([...positions.array], [0, 0.65, 0, 30, 0.65, 0, 30, 0.65, -40].map(Math.fround))

  at(entry, 0, 0)
  renderer.updateWalkers(0.1)
  at(entry, 10, 0)
  renderer.updateWalkers(0.2)
  at(entry, 30, 0)
  renderer.updateWalkers(0.1)
  at(entry, 30, 10)
  renderer.updateWalkers(0.3)
  at(entry, 30, 40)
  assert.equal(entry.walker.phase, 'dwell')

  renderer.updateWalkers(0.9)
  assert.equal(entry.walker.phase, 'return')
  assert.deepEqual(entry.walker.points, [...outbound].reverse())
  renderer.updateWalkers(0.1)
  at(entry, 30, 30)
  renderer.updateWalkers(0.3)
  at(entry, 30, 0)
  renderer.updateWalkers(0.2)
  at(entry, 10, 0)
  renderer.updateWalkers(0.1)
  assert.equal(entry.walker, null)
  at(entry, entry.home.x, entry.home.y)
})

test('seeking restores home positions, clears pending animation and rebuilds order deduplication', () => {
  const { renderer, entry } = world()
  const [first, second] = renderer.index.scene.events
  renderer.playEvent(first)
  renderer.playEvent(second)
  renderer.playEvent({ type: 'post', actor: 'consumer', key: 'post-event' })
  renderer.updateWalkers(0.1)
  assert.equal(entry.queue.length, 1)
  assert.equal(renderer.effectLayer.children.length, 1)
  assert.notEqual(entry.figure.position.x, entry.home.x)

  renderer.setCursor(1)
  assert.equal(entry.walker, null)
  assert.deepEqual(entry.queue, [])
  assert.equal(renderer.routeLayer.children.length, 0)
  assert.equal(renderer.effectLayer.children.length, 0)
  assert.deepEqual(renderer.effects, [])
  assert.deepEqual([...renderer.seenOrders], [first.order_id])
  assert.deepEqual(renderer.getStats(), { active: 0, queued: 0, unreachable: 0 })
  at(entry, entry.home.x, entry.home.y)
  assert.equal(entry.body.position.y, 3.2)
  renderer.playEvent(first)
  assert.equal(entry.walker, null)
  renderer.playEvent(second)
  assert.equal(entry.walker.event.order_id, second.order_id)

  renderer.setCursor(0)
  assert.equal(renderer.seenOrders.size, 0)
  renderer.playEvent(first)
  assert.equal(entry.walker.event.order_id, first.order_id)
  renderer.setCursor(renderer.index.scene.events.length)
  for (const event of renderer.index.scene.events) renderer.playEvent(event)
  assert.equal(entry.walker, null)
})

test('an unreachable purchase is reported once without fabricating a road or blocking valid trips', () => {
  const { renderer, entry, stats } = world({ disconnectedShop: true })
  const blocked = purchase('blocked', 'merchant_002')
  renderer.playEvent(blocked)
  renderer.playEvent(blocked)
  assert.deepEqual(renderer.getStats(), { active: 0, queued: 0, unreachable: 1 })
  assert.deepEqual(stats.at(-1), renderer.getStats())
  assert.equal(renderer.routeLayer.children.length, 0)
  assert.equal(entry.walker, null)
  at(entry, entry.home.x, entry.home.y)

  renderer.playEvent(purchase('reachable'))
  assert.deepEqual(entry.walker.route.node_ids, ['a', 'b', 'c'])
  finishTrip(renderer)
  assert.equal(entry.walker, null)
  assert.equal(renderer.unreachable, 1)
  renderer.setCursor(0)
  assert.equal(renderer.unreachable, 0)
  renderer.playEvent(blocked)
  assert.equal(renderer.unreachable, 1)
  assert.equal(renderer.routeLayer.children.length, 0)
})
