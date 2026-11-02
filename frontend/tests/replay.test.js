import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { indexScene, stateAt, dailySeries, dayIndexAt, personHistory, personPurchases } from '../src/mecoffe/replay.js'

const campus = { locations: [{ location_id: 'shop_a' }, { location_id: 'dorm' }] }

function tinyScene() {
  return {
    campus,
    brands: [{ brand_id: 'a', location_id: 'shop_a' }, { brand_id: 'b', location_id: 'shop_a' }],
    people: [{ id: 'a' }, { id: 'b' }, { id: 'u1' }, { id: 'u2' }],
    days: [{ step: 0, label: '初始化' }, { step: 1, label: '第 1 天' }, { step: 2, label: '第 2 天' }],
    events: [
      { key: 'f', step: 0, type: 'follow', actor: 'u1', target: 'u2' },
      { key: 'x1', step: 1, type: 'exposure', actor: 'u1', brand_ids: ['a'] },
      { key: 'x2', step: 1, type: 'exposure', actor: 'u1', brand_ids: ['a'] },
      { key: 'p1', step: 1, type: 'purchase', actor: 'u1', target: 'a', brand_id: 'a', order_id: 'o1', amount_fen: 990, quantity: 1 },
      { key: 'p1dup', step: 1, type: 'purchase', actor: 'u1', target: 'a', brand_id: 'a', order_id: 'o1', amount_fen: 990, quantity: 1 },
      { key: 'p2', step: 2, type: 'purchase', actor: 'u2', target: 'b', brand_id: 'b', order_id: 'o2', amount_fen: 1200, quantity: 1 },
      { key: 'fail', step: 2, type: 'failed', actor: 'u2', action: 'create_comment' },
    ],
  }
}

test('day boundaries cover every event once', () => {
  const index = indexScene(tinyScene())
  assert.deepEqual(index.days.map(d => [d.start, d.end]), [[0, 1], [1, 5], [5, 7]])
})

test('state only counts events before the cursor', () => {
  const index = indexScene(tinyScene())
  assert.equal(stateAt(index, 3).orders, 0)
  assert.equal(stateAt(index, 4).orders, 1)
  assert.equal(stateAt(index, 4).revenueFen.a, 990)
})

test('the same order id is never counted twice', () => {
  const index = indexScene(tinyScene())
  assert.equal(stateAt(index, 5).cups.a, 1)
  assert.equal(stateAt(index, 7).orders, 2)
})

test('repeated exposure of one person counts as one person reached', () => {
  const index = indexScene(tinyScene())
  const state = stateAt(index, 3)
  assert.equal(state.exposures, 2)
  assert.equal(state.reached.a, 1)
  assert.equal(state.reachedAny, 1)
})

test('a person who saw both brands counts once in the total reach', () => {
  const scene = tinyScene()
  scene.events.splice(1, 0, { key: 'x0', step: 1, type: 'exposure', actor: 'u2', brand_ids: ['a', 'b'] })
  const index = indexScene(scene)
  const state = stateAt(index, 4)
  assert.equal(state.reached.a, 2)
  assert.equal(state.reached.b, 1)
  assert.equal(state.reachedAny, 2)
})

test('failed actions do not become comments', () => {
  const index = indexScene(tinyScene())
  assert.equal(stateAt(index, 7).comments, 0)
  assert.equal(stateAt(index, 7).failed, 1)
})

test('daily series stops at the cursor and leaves future days empty', () => {
  const index = indexScene(tinyScene())
  const rows = dailySeries(index, 4)
  assert.equal(dayIndexAt(index, 4), 1)
  assert.equal(rows[1].a, 1)
  assert.equal(rows[2].a, null)
  assert.equal(rows[2].played, false)
})

test('rewinding gives back the earlier state exactly', () => {
  const index = indexScene(tinyScene())
  const before = JSON.stringify(stateAt(index, 2))
  stateAt(index, 7)
  assert.equal(JSON.stringify(stateAt(index, 2)), before)
})

test('person history and purchases respect the cursor', () => {
  const index = indexScene(tinyScene())
  assert.deepEqual(personHistory(index, 'u2', 1).map(e => e.key), ['f'])
  assert.deepEqual(personPurchases(index, 'u1', 7), { a: 1 })
  assert.deepEqual(personPurchases(index, 'u2', 5), {})
})

test('unknown people are rejected', () => {
  const scene = tinyScene()
  scene.events.push({ key: 'z', step: 2, type: 'post', actor: 'ghost' })
  assert.throws(() => indexScene(scene))
})

const realPath = new URL('../public/mecoffe/scene.json', import.meta.url)
test('real run: totals at the end match the adapter summary', { skip: !existsSync(realPath) }, () => {
  const scene = JSON.parse(readFileSync(realPath, 'utf8'))
  const index = indexScene(scene)
  const end = stateAt(index, scene.events.length)
  const cups = Object.values(end.cups).reduce((a, b) => a + b, 0)
  const revenue = Object.values(end.revenueFen).reduce((a, b) => a + b, 0)
  assert.equal(end.orders, scene.summary.orders)
  assert.equal(cups, scene.summary.orders)
  assert.equal(revenue, scene.summary.revenue_fen)
  assert.equal(end.comments, scene.summary.by_type.comment)
  const daily = dailySeries(index, scene.events.length)
  const dailyCups = daily.reduce((sum, row) => sum + scene.brands.reduce((s, b) => s + (row[b.brand_id] || 0), 0), 0)
  assert.equal(dailyCups, scene.summary.orders)
})
