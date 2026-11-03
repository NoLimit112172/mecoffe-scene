import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { Campus3DSurroundings } from '../src/mecoffe/Campus3DSurroundings.js'
import { contextRoads, externalRoadParts, normaliseRoadBounds, roadLength, roadMidpoint, roadNameLabels, roadStyle } from '../src/mecoffe/campus3dRoadModel.js'

const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
const campus = json('../../scene/campus3d.json')
const data = json('../public/mecoffe/campus3d_surroundings.json')
const built = { minX: -422.118, maxX: 410.667, minY: -523.007, maxY: 70.154 }

test('road hierarchy has wider trunk roads, real lane counts and cautious underground styling', () => {
  assert.ok(roadStyle({ highway: 'primary' }).width > roadStyle({ highway: 'tertiary' }).width)
  assert.ok(roadStyle({ highway: 'secondary' }).width > roadStyle({ highway: 'residential' }).width)
  assert.ok(roadStyle({ highway: 'residential' }).width > roadStyle({ highway: 'service' }).width)
  const divided = roadStyle({ highway: 'primary', lanes: '3', oneway: 'yes' })
  assert.equal(divided.lanes, 3)
  assert.equal(divided.oneWay, true)
  assert.equal(roadStyle({ highway: 'primary', lanes: '2;3' }).lanes, 4)
  const tunnel = roadStyle({ highway: 'primary', tunnel: 'yes' })
  assert.equal(tunnel.tunnel, true)
  assert.equal(tunnel.sidewalk, 0)
  assert.equal(roadStyle({ highway: 'footway' }).visible, false)
})

test('context clips outer segments and removes campus interiors without bridging over them', () => {
  const miniature = { boundary: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] }
  const points = [[-5, 5], [15, 5]]
  const before = structuredClone(points)
  assert.deepEqual(externalRoadParts(points, { minX: -3, maxX: 13, minY: -3, maxY: 13 }, miniature),
    [[[-3, 5], [0, 5]], [[10, 5], [13, 5]]])
  assert.deepEqual(points, before)
  assert.deepEqual(normaliseRoadBounds({ min_x: 1, max_x: 2, min_y: 3, max_y: 4 }, 5), { minX: -4, maxX: 7, minY: -2, maxY: 9 })
  assert.throws(() => normaliseRoadBounds({ minX: 0, maxX: NaN, minY: 0, maxY: 2 }))
})

test('road labels use length-weighted visible midpoints, one exact source name each, and no unnamed labels', () => {
  assert.deepEqual(roadMidpoint([[0, 0], [10, 0], [10, 30]]), { x: 10, y: 10, angle: Math.PI / 2 })
  assert.equal(roadLength([[0, 0], [3, 4]]), 5)
  const roads = [
    { osm_id: 'a', name: '源路名', highway: 'primary', tunnel: 'yes', points: [[0, 0], [500, 0]] },
    { osm_id: 'b', name: '源路名', highway: 'primary', points: [[0, 20], [80, 20]] },
    { osm_id: 'c', name: '', highway: 'primary', points: [[0, 50], [800, 50]] },
  ]
  const before = structuredClone(roads)
  const labels = roadNameLabels(roads)
  assert.equal(labels.length, 1)
  assert.equal(labels[0].name, roads[0].name)
  assert.equal(labels[0].osm_id, 'b')
  assert.equal(labels[0].x, 40)
  assert.deepEqual(roads, before)
})

test('real downloaded context exposes actual four nearby road names without changing the walking graph', () => {
  const before = JSON.stringify(campus)
  const roads = contextRoads(data.roads, built, campus)
  const names = roadNameLabels(roads).map(label => label.name).sort()
  assert.deepEqual(names, ['习友路', '创新大道', '复兴路', '石莲南路'].sort())
  const bounds = normaliseRoadBounds(built, 115)
  assert.ok(roads.every(road => road.points.every(([x, y]) => x >= bounds.minX - 1e-6 && x <= bounds.maxX + 1e-6 && y >= bounds.minY - 1e-6 && y <= bounds.maxY + 1e-6)))
  assert.equal(new Set(names).size, names.length)
  assert.equal(JSON.stringify(campus), before)
  assert.equal(data.walk_graph, undefined)
})

test('road renderer batches display geometry and releases its own resources without editing campus data', () => {
  const scene = new THREE.Scene()
  const before = JSON.stringify(campus)
  const display = new Campus3DSurroundings({ scene, roads: data.roads, displayBounds: built, campus }).init()
  assert.ok(display.group.children.length >= 4)
  assert.ok(display.group.children.length <= 6)
  for (const object of display.group.children) {
    assert.equal(object.castShadow, false)
    assert.equal(object.material.depthWrite, ['sidewalk','curb','asphalt'].includes(object.userData.surroundingRoadLayer), 'solid road volumes write depth; paint and tunnel traces only overlay')
    assert.equal(object.material.depthTest, true, 'buildings and terrain must continue to occlude the road')
    assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite))
  }
  const layer = name => display.group.children.find(object => object.userData.surroundingRoadLayer === name)
  assert.equal(layer('white').material.polygonOffset,true,'distant lane paint must not fight asphalt depth')
  const top = name => {
    const geometry=layer(name).geometry;geometry.computeBoundingBox();return geometry.boundingBox.max.y
  }
  assert.ok(top('sidewalk')>top('asphalt'),'sidewalk surface is physically above the road')
  assert.ok(top('curb')>top('sidewalk'),'kerb tops are physically above sidewalks')
  assert.ok(top('asphalt')-layer('asphalt').geometry.boundingBox.min.y>.5,'asphalt is a volume, not a plane')
  assert.ok(layer('sidewalk').renderOrder < layer('curb').renderOrder)
  assert.ok(layer('curb').renderOrder < layer('asphalt').renderOrder)
  assert.ok(layer('asphalt').renderOrder < layer('white').renderOrder)
  assert.ok(display.labels.some(label => label.name === '习友路'))
  display.dispose()
  assert.equal(scene.children.length, 0)
  assert.equal(JSON.stringify(campus), before)
})
