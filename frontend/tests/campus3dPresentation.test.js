import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { visualClock, idleRepresentatives, displayOccupancy, billboardScaleForCamera } from '../src/mecoffe/campus3dPresentation.js'

test('light clock follows each playback day or a manually selected artistic time', () => {
  assert.equal(visualClock(0).label,'06:00')
  assert.equal(visualClock(.25).label,'12:00')
  assert.equal(visualClock(2.5).label,'18:00')
  assert.equal(visualClock(.75).label,'00:00')
  assert.equal(visualClock(10,{cycle:false,hour:23}).label,'23:00')
  assert.deepEqual(visualClock(.25),visualClock(4.25))
  assert.equal(visualClock(NaN).label,'06:00')
})

test('idle representation is stable without removing anyone or hiding merchants', () => {
  const people = Array.from({length:12},(_,i)=>({id:`p${String(i).padStart(2,'0')}`,role:'undergraduate_consumer',building_id:'a'}))
  people.push({id:'merchant',role:'merchant',home_location_id:'shop'})
  const before=structuredClone(people)
  const selected=idleRepresentatives(people,4)
  assert.deepEqual([...selected].sort(),['merchant','p00','p01','p02','p03'])
  assert.deepEqual([...idleRepresentatives([...people].reverse())].sort(),[...selected].sort())
  assert.deepEqual(people,before)
})

test('occupancy badges count the existing presentation entries and ongoing trips only', () => {
  const entries=[{anchor:{building:{osm_id:'a'}},walker:null},{anchor:{building:{osm_id:'a'}},walker:{phase:'return'}},{anchor:{building:{osm_id:'b'}},walker:null}]
  assert.deepEqual([...displayOccupancy(entries)], [['a',{total:2,inside:1}],['b',{total:1,inside:1}]])
})

test('pixel billboards meet their CSS height at near, far, oblique and top-down views', () => {
  const camera = new THREE.PerspectiveCamera(42, 1208 / 647, .5, 15000)
  const point = new THREE.Vector3(5, .35, -15)
  for (const eye of [[1200, 900, 500], [0, 1800, 0], [35, 18, 43], [2400, 1800, 1000]]) {
    camera.position.set(...eye)
    camera.lookAt(point)
    camera.updateMatrixWorld()
    for (const minPixels of [30, 40]) {
      const scale = billboardScaleForCamera(camera, point, { height: 647, minPixels })
      const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z
      assert.ok(8.5 * scale * camera.projectionMatrix.elements[5] * 647 / (2 * depth) >= minPixels - 1e-8)
    }
  }
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  assert.equal(billboardScaleForCamera(camera, new THREE.Vector3(0, 0, 20), {height:647}), 1)
  assert.equal(billboardScaleForCamera(camera, point, {height:0}), 1)
})
