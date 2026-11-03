import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildingPalette, dayLighting, decorationIsClear, decorationPlacements, seededRandom, windowPattern } from '../src/mecoffe/campus3dEnvironmentModel.js'

const campus = JSON.parse(readFileSync(new URL('../../scene/campus3d.json', import.meta.url), 'utf8'))

test('display lighting is continuous, periodic and much darker at night', () => {
  assert.deepEqual(dayLighting(0), dayLighting(1))
  assert.deepEqual(dayLighting(.25), dayLighting(2.25))
  assert.deepEqual(dayLighting(NaN), dayLighting(.25))
  assert.ok(dayLighting(.25).strength > dayLighting(.75).strength * 8)
  assert.equal(dayLighting(.25).night, 0)
  assert.equal(dayLighting(.75).night, 1)
  // A dark blue sky must not force all non-emissive scenery to black. The
  // ambient fill remains cool and readable while direct light stays much lower.
  const brightness = hex => hex.slice(1).match(/../g).reduce((sum, value) => sum + parseInt(value, 16), 0) / (3 * 255)
  const midnight = dayLighting(.75)
  assert.ok(brightness(midnight.sky) < .2)
  assert.ok(brightness(midnight.ambientSky) > .6)
  assert.ok(brightness(midnight.ambientGround) > .5)
  assert.ok(midnight.hemi >= .7 && midnight.hemi < dayLighting(.25).hemi)
  assert.equal(dayLighting(.25).ambientSky, dayLighting(.25).horizon)
  assert.equal(dayLighting(0).hour, 6)
  assert.equal(dayLighting(.5).hour, 18)
  for (let step = 0; step <= 1000; step += 1) {
    const value = dayLighting(step / 1000)
    assert.ok(value.night >= 0 && value.night <= 1)
    assert.ok(value.sunDirection.every(Number.isFinite))
    for (const key of ['sky', 'horizon', 'fog', 'sun']) assert.match(value[key], /^#[a-f0-9]{6}$/)
    assert.ok(Math.abs(value.night - dayLighting((step + 1) / 1000).night) < .02)
  }
})

test('building palettes distinguish major campus uses without changing buildings', () => {
  const before = structuredClone(campus.buildings)
  assert.notEqual(buildingPalette({ kind: 'dormitory' }).wall, buildingPalette({ kind: 'education' }).wall)
  assert.notEqual(buildingPalette({ name: '图书教育中心A区' }).accent, buildingPalette({ name: '教工食堂' }).accent)
  for (const building of campus.buildings) assert.match(buildingPalette(building).wall, /^#[a-f0-9]{6}$/)
  assert.deepEqual(campus.buildings, before)
})

test('fixed random seeds reproduce window masks and decoration candidates', () => {
  assert.deepEqual(windowPattern('same-building'), windowPattern('same-building'))
  assert.notDeepEqual(windowPattern('building-A'), windowPattern('building-B'))
  const a = seededRandom('same')
  const b = seededRandom('same')
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b))
  const before = JSON.stringify(campus)
  assert.deepEqual(decorationPlacements(campus), decorationPlacements(campus))
  assert.equal(JSON.stringify(campus), before)
})

test('decoration stays outside buildings, roads and campus holes and never modifies routes', () => {
  const before = structuredClone(campus.walk_graph)
  const decor = decorationPlacements(campus)
  assert.equal(decor.illustrative, true)
  assert.match(decor.label, /装饰/)
  assert.ok(decor.trees.length > 20)
  const all = [...decor.trees, ...decor.lamps, ...decor.benches]
  assert.ok(all.every(point => decorationIsClear(point, campus)))
  for (let i = 0; i < all.length; i += 1) {
    assert.ok(all.slice(i + 1).every(other => Math.hypot(all[i].x - other.x, all[i].y - other.y) >= 8))
  }
  assert.deepEqual(campus.walk_graph, before)
})

test('OSM sports and water areas remain free of decorative furniture', () => {
  const features = JSON.parse(readFileSync(new URL('../public/mecoffe/campus3d_landcover.json', import.meta.url), 'utf8')).features
  const decor = decorationPlacements(campus, { landcovers: features })
  const all = [...decor.trees, ...decor.lamps, ...decor.benches]
  assert.ok(all.length > 20)
  assert.ok(all.every(point => decorationIsClear(point, campus, 7, features)))
})
