import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { campusBoundaryBounds, fitCampusView } from '../src/mecoffe/campus3dView.js'

const campus = JSON.parse(readFileSync(new URL('../../scene/campus3d.json', import.meta.url), 'utf8'))

function projectedBounds(points, camera) {
  camera.updateMatrixWorld(true)
  const projected = points.map(point => point.clone().project(camera))
  return {
    minX: Math.min(...projected.map(point => point.x)),
    maxX: Math.max(...projected.map(point => point.x)),
    minY: Math.min(...projected.map(point => point.y)),
    maxY: Math.max(...projected.map(point => point.y)),
    minZ: Math.min(...projected.map(point => point.z)),
    maxZ: Math.max(...projected.map(point => point.z)),
  }
}

test('actual campus overview fills 80% of the limiting screen axis at desktop and narrow sizes', () => {
  for (const [width, height] of [[1230, 650], [1200, 700], [614, 370], [390, 700], [1800, 500]]) {
    const aspect = width / height
    const fit = fitCampusView(campus, { aspect })
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 15000)
    camera.position.copy(fit.position)
    camera.lookAt(fit.target)
    const projected = projectedBounds(fit.points, camera)
    const fraction = Math.max(projected.maxX - projected.minX, projected.maxY - projected.minY) / 2
    assert.ok(fraction >= 0.799 && fraction <= 0.801, `${width}x${height}: ${fraction}`)
    assert.ok(Math.abs(projected.maxX + projected.minX) < 1e-8, 'horizontal framing is centered')
    assert.ok(Math.abs(projected.maxY + projected.minY) < 1e-8, 'vertical framing is centered')
    assert.ok(projected.minX >= -0.801 && projected.maxX <= 0.801)
    assert.ok(projected.minY >= -0.801 && projected.maxY <= 0.801)
    assert.ok(projected.minZ > -1 && projected.maxZ < 1, 'campus remains within clipping planes')
  }
})

test('unrelated road extents do not enlarge the overview or the ground plane', () => {
  const exaggerated = { ...campus, roads: [{ points: [[-100000, -100000], [100000, 100000]] }] }
  const original = fitCampusView(campus, { aspect: 1230 / 650 })
  const changed = fitCampusView(exaggerated, { aspect: 1230 / 650 })
  assert.deepEqual(changed.position, original.position)
  assert.deepEqual(changed.target, original.target)
  assert.deepEqual(changed.bounds, original.bounds)
  const outer = campus.boundary_polygons.flatMap(polygon => polygon.outer)
  const bounds = campusBoundaryBounds(campus, 12)
  assert.equal(bounds.minX, Math.min(...outer.map(point => point[0])) - 12)
  assert.equal(bounds.maxX, Math.max(...outer.map(point => point[0])) + 12)
  assert.equal(bounds.minY, Math.min(...outer.map(point => point[1])) - 12)
  assert.equal(bounds.maxY, Math.max(...outer.map(point => point[1])) + 12)
})

test('landscape overview turns the long campus axis across the screen', () => {
  const aspect = 1230 / 650
  const fit = fitCampusView(campus, { aspect })
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 15000)
  camera.position.copy(fit.position)
  camera.lookAt(fit.target)
  const projected = projectedBounds(fit.points, camera)
  const widthFraction = (projected.maxX - projected.minX) / 2
  const heightFraction = (projected.maxY - projected.minY) / 2
  assert.ok(widthFraction > 0.69 && widthFraction < 0.72, `width: ${widthFraction}`)
  assert.ok(heightFraction > 0.799 && heightFraction < 0.801, `height: ${heightFraction}`)
  const direction = fit.position.clone().sub(fit.target).normalize()
  assert.ok(direction.x > direction.z, 'wide screens look from the east')
  const portrait = fitCampusView(campus, { aspect: 390 / 700 })
  const portraitDirection = portrait.position.clone().sub(portrait.target).normalize()
  assert.ok(portraitDirection.z > portraitDirection.x, 'portrait keeps the southern overview')
})

test('both campus parcels and actual building roofs participate in the fit', () => {
  const fit = fitCampusView(campus, { aspect: 1.8 })
  for (const polygon of campus.boundary_polygons) {
    assert.ok(polygon.outer.every(([x, y]) => fit.points.some(point => point.x === x && point.y === 0 && point.z === -y)))
  }
  for (const building of campus.buildings) {
    assert.ok(building.polygon.every(([x, y]) => fit.points.some(point => point.x === x
      && Math.abs(point.y - building.height_m - 0.2) < 1e-9 && point.z === -y)))
  }
  assert.ok(fit.distance > 0)
})

test('boundary-only framing is translation invariant and supports a legacy single outer', () => {
  const rectangle = { boundary: [[0, 0], [30, 0], [30, 60], [0, 60], [0, 0]], buildings: [] }
  const moved = { boundary: rectangle.boundary.map(([x, y]) => [x + 3000, y - 7000]) }
  const first = fitCampusView(rectangle, { aspect: 1.5 })
  const second = fitCampusView(moved, { aspect: 1.5 })
  assert.ok(Math.abs(first.distance - second.distance) < 1e-8)
  assert.ok(Math.abs(second.target.x - first.target.x - 3000) < 1e-8)
  assert.ok(Math.abs(second.target.z - first.target.z - 7000) < 1e-8)
  assert.ok(Math.abs(second.target.y - first.target.y) < 1e-8)
})

test('invalid framing inputs fail explicitly', () => {
  assert.throws(() => fitCampusView(campus, { aspect: 0 }))
  assert.throws(() => fitCampusView(campus, { aspect: 2, fill: 1 }))
  assert.throws(() => fitCampusView(campus, { aspect: 2, fov: NaN }))
  assert.throws(() => fitCampusView(campus, { aspect: 2, direction: new THREE.Vector3() }))
  assert.throws(() => campusBoundaryBounds({ boundary: [] }))
  assert.throws(() => campusBoundaryBounds(campus, -1))
})
