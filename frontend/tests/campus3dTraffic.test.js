import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { Campus3DScene } from '../src/mecoffe/Campus3DScene.js'
import { indexScene } from '../src/mecoffe/replay.js'
import { fitCampusView } from '../src/mecoffe/campus3dView.js'
import { routeBetweenMappings } from '../src/mecoffe/campus3dRouting.js'
import { outsideBuildings, CROWD_GAP } from '../src/mecoffe/campus3dCrowd.js'

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const homes = ['ug_dorm_west', 'ug_dorm_east', 'teaching_main', 'grad_apartment', 'library_main', 'faculty_main']
const brands = ['merchant_001', 'merchant_002']
const point = entry => ({ x: entry.figure.position.x, y: -entry.figure.position.z })

function overview(renderer) {
  // Actual canvas inside the 1600×1000 page, after its controls/sidebar.
  renderer.host = { clientWidth: 1208, clientHeight: 647 }
  const aspect = renderer.host.clientWidth / renderer.host.clientHeight
  const eastWest = renderer.display.bounds.width > renderer.display.bounds.height
  const direction = (aspect >= 1.25) === eastWest ? new THREE.Vector3(.22, .9, .85) : new THREE.Vector3(.85, .9, .22)
  const fit = fitCampusView(renderer.cameraCampus, { aspect, fov: 42, fill: .83, direction })
  renderer.camera = new THREE.PerspectiveCamera(42, aspect, .5, 15000)
  renderer.camera.position.copy(fit.position)
  renderer.camera.lookAt(fit.target)
  renderer.updateScreenVisuals()
}

function snapshot(renderer, frame, receipts) {
  return {
    frame, seconds: frame * .04, receipts, stats: renderer.getStats(),
    people: [...renderer.people.values()].map(entry => ({
      id: entry.person.id, key: entry.key, position: point(entry), radius: entry.collisionRadius,
      scale: entry.figure.scale.x, home: entry.home, queued: entry.queue.map(trip => trip.event.order_id),
      walker: entry.walker && {
        order: entry.walker.event.order_id, phase: entry.walker.phase,
        target: entry.walker.displayPoints[entry.walker.displayNextPoint],
        targetIndex: entry.walker.displayNextPoint, targetCount: entry.walker.displayPoints.length,
        displayPoints: entry.walker.displayPoints,
        travelled: entry.walker.travelled, waiting: entry.walker.waiting, dwell: entry.walker.dwell,
      },
    })),
  }
}

function assertFrame(renderer, before, frame) {
  const entries = [...renderer.people.values()]
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], p = point(entry), previous = before?.get(entry.person.id)
    assert.ok(entry.figure.scale.x*3<=entry.collisionRadius+1e-6, `frame ${frame}: model exceeds reserved footprint`)
    assert.ok(outsideBuildings(p, renderer.campus.buildings, entry.collisionRadius),
      `frame ${frame}: ${entry.person.id} overlaps a building at ${JSON.stringify(p)}`)
    if (previous) assert.ok(Math.hypot(p.x - previous.x, p.y - previous.y) <= 4 + 1e-6,
      `frame ${frame}: ${entry.person.id} exceeds 100 m/s: ${Math.hypot(p.x - previous.x, p.y - previous.y) / .04}`)
    for (let j = 0; j < i; j++) {
      const other = entries[j], q = point(other)
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= entry.collisionRadius + other.collisionRadius + CROWD_GAP - 1e-6,
        `frame ${frame}: ${entry.person.id} overlaps ${other.person.id}`)
    }
  }
}

test('100 real campus figures safely drain 12 simultaneous two-shop purchases at overview scale within 120s', t => {
  const campus = json('../../scene/campus3d.json'), mapping = json('../../scene/campus3d_mapping.json')
  const data = json('../public/mecoffe/latest-demo.json')
  const surroundings = json('../public/mecoffe/campus3d_surroundings.json').roads
  const source = JSON.stringify({ campus, mapping, data, surroundings })
  const renderer = new Campus3DScene({ campus, mapping, index: indexScene(data), surroundings })
  renderer.scene = new THREE.Scene()
  for (const name of ['routeLayer', 'effectLayer', 'relationLayer']) {
    renderer[name] = new THREE.Group()
    renderer.scene.add(renderer[name])
  }
  renderer.placePeople()
  overview(renderer)
  assert.equal(renderer.people.size, 100)
  assert.equal(renderer.characterStyle, 'realistic')
  assertFrame(renderer, null, 0)

  const receipts = [], events = [], routes = new Map()
  renderer.eventEffects = { effects: [], purchaseArrived: event => receipts.push(event.order_id), reset() {}, dispose() {} }
  for (const home of homes) {
    const consumers = [...renderer.people.values()].filter(entry => entry.key === home && entry.person.role !== 'merchant')
    assert.ok(consumers.length >= 2, `${home} must have two distinct real consumers`)
    for (let i = 0; i < 2; i++) {
      const actor = consumers[i].person.id, brand = brands[i], order = `traffic-${home}-${brand}`
      const event = { key: order, order_id: order, type: 'purchase', actor, brand_id: brand, quantity: 1, amount_fen: 900, step: 1 }
      events.push(event)
      const route = routeBetweenMappings(renderer.routing, home, `shop_${brand}`)
      assert.ok(route, `${home} → ${brand} must have an authoritative A* route`)
      routes.set(order, structuredClone(route))
      renderer.playEvent(event)
      renderer.playEvent({ ...event }) // Duplicate delivery must not add a trip or receipt.
    }
  }
  assert.equal(new Set(events.map(event => event.actor)).size, 12)
  assert.deepEqual(renderer.getStats(), { active: 12, queued: 0, unreachable: 0 })
  // Entering walking mode changes the minimum to 18 px. Apply this initial
  // scale/layout change before measuring steady-camera frame displacement.
  renderer.updateScreenVisuals()
  let frame = 0, frameStages = null
  try {
    assertFrame(renderer, null, frame)
    for (; frame < 3000 && renderer.walkers.size; frame++) {
      const before = new Map([...renderer.people].map(([id, entry]) => [id, point(entry)]))
      renderer.updateWalkers(.04)
      const afterWalk = new Map([...renderer.people].map(([id, entry]) => [id, point(entry)]))
      renderer.updateScreenVisuals()
      frameStages = [...renderer.people].map(([id, entry]) => ({
        id, before: before.get(id), afterWalk: afterWalk.get(id), afterScreen: point(entry),
      })).filter(row => Math.hypot(row.afterScreen.x - row.before.x, row.afterScreen.y - row.before.y) > 4 + 1e-6)
      assertFrame(renderer, before, frame + 1)
      assert.equal(new Set(receipts).size, receipts.length, `frame ${frame + 1}: duplicate receipt`)
      for (const entry of renderer.people.values()) if (entry.walker) {
        assert.deepEqual(entry.walker.route, routes.get(entry.walker.event.order_id), 'movement must not rewrite the authoritative A* route')
      }
    }
    assert.equal(renderer.walkers.size, 0, `traffic has not drained within 120s: ${JSON.stringify(snapshot(renderer, frame, receipts).people.filter(p => p.walker))}`)
    assert.deepEqual(renderer.getStats(), { active: 0, queued: 0, unreachable: 0 })
    assert.equal(renderer.routeLayer.children.length, 0)
    assert.deepEqual([...receipts].sort(), events.map(event => event.order_id).sort())
    for (const event of events) {
      const entry = renderer.people.get(event.actor)
      assert.equal(entry.hasCoffee, true)
      assert.ok(Math.hypot(point(entry).x - entry.home.x, point(entry).y - entry.home.y) < 1e-6)
      assert.deepEqual(routeBetweenMappings(renderer.routing, entry.key, `shop_${event.brand_id}`), routes.get(event.order_id))
      renderer.playEvent({ ...event })
    }
    assert.equal(renderer.walkers.size, 0)
    assert.equal(receipts.length, 12)
    t.diagnostic(`12 purchases completed in ${frame} frames (${(frame*.04).toFixed(2)} display seconds); all 100 footprints checked every frame`)
    assert.equal(JSON.stringify({ campus, mapping, data, surroundings }), source, 'source OSM graph, mapping, replay JSON and context roads remain immutable')
  } catch (error) {
    const folder = new URL('../../logs/asset-library/', import.meta.url)
    mkdirSync(folder, { recursive: true })
    writeFileSync(new URL('m5-traffic-debug.json', folder), JSON.stringify({ error: error.message, frameStages, ...snapshot(renderer, frame, receipts) }, null, 2))
    throw error
  } finally {
    renderer.dispose()
  }
})
