import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { layoutLabels, personScaleForCamera, projectedPersonSize } from '../src/mecoffe/campus3dScreen.js'

function cameraFor(viewport, position, target = new Vector3()) {
  const camera = new PerspectiveCamera(42, viewport.width / viewport.height, 0.5, 30000)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

test('people reach the CSS-pixel minimum at oblique, distant, top-down and narrow views', () => {
  const cases = [
    { viewport: { width: 1230, height: 650 }, eye: new Vector3(350, 1100, 1200) },
    { viewport: { width: 1230, height: 650 }, eye: new Vector3(1500, 5000, 6000) },
    { viewport: { width: 390, height: 700 }, eye: new Vector3(300, 1600, 1200) },
    { viewport: { width: 1230, height: 650 }, eye: new Vector3(0, 1600, 0) },
  ]
  for (const { viewport, eye } of cases) {
    const camera = cameraFor(viewport, eye)
    const beforeCamera = camera.position.clone()
    for (const position of [new Vector3(), new Vector3(-150, 0.35, -200), new Vector3(150, 0.35, 200)]) {
      const before = position.clone()
      const scale = personScaleForCamera(camera, position, viewport)
      assert.ok(Number.isFinite(scale) && scale >= 1 && scale <= 64)
      const size = projectedPersonSize(camera, position, scale, viewport)
      assert.ok(size.height >= 12 - 1e-6, `height ${size.height} at ${eye.toArray()}`)
      if (scale > 1.01) assert.ok(projectedPersonSize(camera, position, scale * 0.99, viewport).height < 12)
      assert.deepEqual(position, before)
    }
    assert.deepEqual(camera.position, beforeCamera)
  }
})

test('close people keep their real scale and CSS sizing is independent of drawing-buffer DPR', () => {
  const viewport = { width: 1230, height: 650 }
  const person = new Vector3(0, 0.35, 0)
  const close = cameraFor(viewport, new Vector3(15, 25, 30))
  assert.equal(personScaleForCamera(close, person, viewport), 1)
  const far = cameraFor(viewport, new Vector3(600, 1600, 1800))
  const atDpr1 = personScaleForCamera(far, person, { ...viewport, devicePixelRatio: 1 })
  const atDpr2 = personScaleForCamera(far, person, { ...viewport, devicePixelRatio: 2 })
  assert.equal(atDpr1, atDpr2)
  assert.deepEqual(projectedPersonSize(far, person, atDpr1, viewport), projectedPersonSize(far, person, atDpr2, viewport))
  assert.equal(personScaleForCamera(far, person, { ...viewport, maxScale: 1 }), 1)
})

test('resize recomputes a finite scale and objects behind the camera do not inflate', () => {
  const person = new Vector3(0, 0.35, 0)
  const camera = cameraFor({ width: 1230, height: 650 }, new Vector3(0, 1500, 1500))
  for (const viewport of [{ width: 1230, height: 650 }, { width: 390, height: 700 }, { width: 1800, height: 500 }]) {
    camera.aspect = viewport.width / viewport.height
    camera.updateProjectionMatrix()
    const scale = personScaleForCamera(camera, person, viewport)
    assert.ok(Number.isFinite(scale))
    assert.ok(projectedPersonSize(camera, person, scale, viewport).height >= 12 - 1e-6)
  }
  const behind = camera.position.clone().multiplyScalar(2)
  assert.equal(personScaleForCamera(camera, behind, { width: 1230, height: 650 }), 1)
  assert.equal(projectedPersonSize(camera, behind, 1, { width: 1230, height: 650 }).visible, false)
})

function assertInsideAndSeparate(labels, width, height, padding = 10, gap = 5) {
  for (const label of labels) {
    assert.ok(label.left >= padding - 1e-7)
    assert.ok(label.top >= padding - 1e-7)
    assert.ok(label.left + label.width <= width - padding + 1e-7)
    assert.ok(label.top + label.height <= height - padding + 1e-7)
  }
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i]
      const b = labels[j]
      assert.ok(a.left + a.width + gap <= b.left + 1e-7
        || b.left + b.width + gap <= a.left + 1e-7
        || a.top + a.height + gap <= b.top + 1e-7
        || b.top + b.height + gap <= a.top + 1e-7, `overlap: ${a.id}, ${b.id}`)
    }
  }
}

test('eight labels sharing one anchor stay visible, nonoverlapping and preserve their inputs', () => {
  for (const [width, height] of [[1230, 650], [390, 700], [220, 230]]) {
    const items = Array.from({ length: 8 }, (_, k) => ({ id: `place-${k}`, x: width / 2, y: height / 2, width: 130 + k * 3, height: 28 }))
    const original = structuredClone(items)
    const labels = layoutLabels(items, { width, height })
    assert.equal(labels.length, 8)
    assert.deepEqual(labels.map(label => label.id), items.map(label => label.id))
    assertInsideAndSeparate(labels, width, height)
    assert.deepEqual(items, original)
    for (const label of labels) {
      assert.equal(label.anchorX, width / 2)
      assert.equal(label.anchorY, height / 2)
    }
  }
})

test('offscreen anchors are clamped without losing labels and narrow canvases use compact columns', () => {
  const items = Array.from({ length: 8 }, (_, k) => ({ id: k, x: k < 4 ? -150 : 900, y: k % 2 ? -50 : 600, width: 160, height: 28 }))
  const labels = layoutLabels(items, { width: 200, height: 180 })
  assert.equal(labels.length, 8)
  assertInsideAndSeparate(labels, 200, 180)
  assert.ok(labels.every(label => label.height === 28))
  assert.ok(labels.some(label => label.compact && label.width < 160))
  assert.deepEqual(layoutLabels([], { width: 200, height: 180 }), [])
})
