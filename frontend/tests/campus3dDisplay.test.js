import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { displayBounds, clipRing, clipPolyline, clipLandcovers, createDisplayCampus, pointInDisplay } from '../src/mecoffe/campus3dDisplay.js'
import { createRouting, routeBetweenMappings, HOME_KEYS, SHOP_KEYS } from '../src/mecoffe/campus3dRouting.js'

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const campus = read('../../scene/campus3d.json')
const mapping = read('../../scene/campus3d_mapping.json')
const features = read('../public/mecoffe/campus3d_landcover.json').features
const rectangle = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

test('built-campus display removes the empty parcel while keeping every mapped building and original route', () => {
  const before = JSON.stringify(campus)
  const mapBefore = JSON.stringify(mapping)
  const originalRoutes = createRouting(campus, mapping)
  const display = createDisplayCampus(campus, { mapping, landcovers: features })
  assert.equal(display.bounds.padding, 50)
  assert.equal(display.bounds.routeCount, 12)
  assert.ok(display.bounds.maxY < 100, 'unbuilt parcel reaches source north=501 m')
  assert.equal(pointInDisplay([0, 400], display.bounds), false)
  assert.equal(display.campus.boundary_polygons.length, 1)
  assert.ok(display.campus.boundary_polygons.every(polygon => polygon.outer.every(point => point[1] < 100)))
  assert.equal(display.campus.walk_graph, campus.walk_graph)
  assert.equal(display.campus.buildings, campus.buildings)
  for (const building of campus.buildings) assert.ok(building.polygon.every(point => pointInDisplay(point, display.bounds)))
  for (const value of Object.values(mapping.mappings)) {
    const building = campus.buildings.find(item => item.osm_id === value.osm_id)
    assert.ok(building.polygon.every(point => pointInDisplay(point, display.bounds)))
  }
  const displayedRoutes = createRouting(display.campus, mapping)
  for (const home of HOME_KEYS) for (const shop of SHOP_KEYS) {
    const route = routeBetweenMappings(originalRoutes, home, shop)
    assert.ok(route.points.every(point => pointInDisplay([point.x, point.y], display.bounds)))
    assert.deepEqual(routeBetweenMappings(displayedRoutes, home, shop), route)
  }
  assert.ok(display.campus.roads.every(road => road.points.every(point => pointInDisplay(point, display.bounds))))
  assert.ok(display.landcovers.every(feature => feature.polygon.every(point => pointInDisplay(point, display.bounds))))
  assert.equal(JSON.stringify(campus), before)
  assert.equal(JSON.stringify(mapping), mapBefore)
})

test('bounds ignore a remote non-route path, retain requested padding and support a minimal renderer fixture', () => {
  const source = { buildings: [{ osm_id: 'b', polygon: rectangle(0, 0, 10, 10) }], roads: [{ points: [[5, 5], [5, 999]] }] }
  const bounds = displayBounds(source, { padding: 40 })
  assert.deepEqual(bounds, { minX: -40, minY: -40, maxX: 50, maxY: 50, width: 90, height: 90, padding: 40, routeCount: 0 })
  const view = createDisplayCampus(source, { padding: 40 })
  assert.deepEqual(view.campus.roads[0].points, [[5, 5], [5, 50]])
  assert.equal(view.campus.boundary_polygons.length, 1)
  assert.ok(view.campus.boundary.every(point => pointInDisplay(point, bounds)))
  assert.throws(() => displayBounds(source, { padding: -1 }), /余量/)
  assert.throws(() => displayBounds({ buildings: [] }), /楼栋/)
})

test('polygon clipping creates exact intersections, closes rings, preserves holes and never changes inputs', () => {
  const source = rectangle(-5, -5, 15, 15)
  const original = JSON.stringify(source)
  const clipped = clipRing(source, box)
  assert.equal(clipped.length, 5)
  assert.deepEqual(clipped[0], clipped.at(-1))
  assert.deepEqual(new Set(clipped.map(point => point.join(','))), new Set(['0,0', '10,0', '10,10', '0,10']))
  assert.equal(JSON.stringify(source), original)
  assert.deepEqual(clipRing(rectangle(20, 20, 25, 25), box), [])
  assert.deepEqual(clipRing([[0, 0], [0, 10], [0, 0]], box), [])
  const geometry = {
    buildings: [{ osm_id: 'building', polygon: rectangle(1, 1, 9, 9) }],
    boundary_polygons: [{ outer: source, holes: [rectangle(3, 3, 4, 4), rectangle(20, 20, 21, 21)] }],
  }
  const view = createDisplayCampus(geometry, { padding: 1 })
  assert.equal(view.campus.boundary_polygons[0].holes.length, 1)
  assert.deepEqual(view.campus.boundary_polygons[0].holes[0], rectangle(3, 3, 4, 4))
  assert.deepEqual(geometry.boundary_polygons[0].holes[1], rectangle(20, 20, 21, 21))
})

test('polyline clipping keeps separate exits and re-entries, including crossing segments with no inside vertices', () => {
  const source = [[1, 1], [20, 1], [20, 9], [1, 9]]
  const before = JSON.stringify(source)
  assert.deepEqual(clipPolyline(source, box), [[[1, 1], [10, 1]], [[10, 9], [1, 9]]])
  assert.deepEqual(clipPolyline([[-5, 5], [15, 5]], box), [[[0, 5], [10, 5]]])
  assert.deepEqual(clipPolyline([[0, 0], [5, 0], [10, 0]], box), [[[0, 0], [5, 0], [10, 0]]])
  assert.deepEqual(clipPolyline([[-1, -1], [0, 0], [-1, 1]], box), [])
  assert.deepEqual(clipPolyline([[5, 5], [5, 5]], box), [])
  assert.equal(JSON.stringify(source), before)
})

test('landcover output uses clipped copies and drops fully outside source features', () => {
  const original = [{ osm_id: 'a', name: 'OSM name', polygon: rectangle(-5, -5, 5, 5) },
    { osm_id: 'b', polygon: rectangle(20, 20, 25, 25) }]
  const before = JSON.stringify(original)
  const clipped = clipLandcovers(original, box)
  assert.equal(clipped.length, 1)
  assert.equal(clipped[0].name, 'OSM name')
  assert.ok(clipped[0].polygon.every(point => pointInDisplay(point, box)))
  assert.equal(JSON.stringify(original), before)
})
