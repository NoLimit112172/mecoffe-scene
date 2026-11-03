import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { hashOf } from '../src/mecoffe/layout.js'
import { PixelCharacterBatch } from '../src/mecoffe/Campus3DPixelCharacters.js'
import { PIXEL_PERSON_HEIGHT, PIXEL_WALK_FPS, atlasFrameDraw, indexPixelAtlases,
  pixelAppearance, pixelFacingFlip, pixelFigureLayout, pixelFrameIndex } from '../src/mecoffe/campus3dPixelModel.js'

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const atlases = [0, 1, 2].map(i => json(`../public/assets/bgrd-${i}.json`))
const atlas = indexPixelAtlases(atlases)

test('YuLan appearance keeps the 2D hash and known outfit/head choices', () => {
  const appearance = pixelAppearance({ id: 'undergraduate_consumer_003', role: 'undergraduate_consumer' }, atlas.headCounts)
  assert.deepEqual(appearance, { hash: 3877125407, gender: 'm', typeId: '5', variant: 4,
    animation: 'character/m/5_4', head: { f: 7, e: 17, m: 21, h: 11 } })
  const teacher = pixelAppearance({ id: 'teacher_consumer_001', role: 'teacher_consumer' }, atlas.headCounts)
  assert.equal(teacher.animation, 'character/f/2_4')
  assert.deepEqual(teacher.head, { f: 14, e: 24, m: 28, h: 22 })
  assert.equal(pixelAppearance({ id: 'merchant_001', role: 'merchant' }, atlas.headCounts).animation, 'character/m/4_2')
  assert.equal(pixelAppearance({ id: 'x', gender: 'f' }, atlas.headCounts).gender, 'f')
})

test('every real roster uses the existing 2D hash, gender, role and body animation rule', () => {
  const before = JSON.stringify(atlases)
  for (const filename of ['latest-demo.json', 'latest-network.json', 'scene.json']) {
    const scene = json(`../public/mecoffe/${filename}`)
    for (const person of scene.people) {
      const h = hashOf(person.id)
      const gender = person.gender || (h % 2 ? 'm' : 'f')
      const typeId = { merchant: '4', teacher_consumer: '2' }[person.role] || '5'
      const variant = 1 + ((h >>> 3) % 4)
      const layout = pixelFigureLayout(person, atlas)
      assert.equal(layout.appearance.hash, h)
      assert.equal(layout.appearance.animation, `character/${gender}/${typeId}_${variant}`)
      assert.deepEqual(layout.bodies.map(frame => frame.key), atlas.animations[layout.appearance.animation] || atlas.animations['character/f/5_1'])
      assert.equal(layout.bodies.length, 3)
      assert.deepEqual(layout.bounds, { x: 0, y: -178, width: 306, height: 612 })
      for (const layer of layout.headLayers) assert.ok(atlas.frames.has(layer.frame.key))
    }
  }
  assert.equal(JSON.stringify(atlases), before)
})

test('head composition centres parts and puts the lower hair behind the face just like Pixi', () => {
  const layout = pixelFigureLayout({ id: 'teacher_consumer_001', role: 'teacher_consumer' }, atlas)
  assert.deepEqual(layout.headLayers.map(layer => layer.z), [3, 4, 5, 5, 6])
  assert.equal(layout.headLayers[0].frame.key, 'head/f/h/22_0.png')
  assert.equal(layout.headLayers[0].y, -65)
  assert.ok(layout.headLayers.slice(1).every(layer => layer.x === 0 && layer.y === -178))
  assert.deepEqual(atlasFrameDraw(atlas.frames.get('head/f/f/1.png'), 0, -178).translate, [85, -150])
})

test('walk frame timing follows 2D animationSpeed .18 at 60fps and idle always uses frame one', () => {
  assert.ok(Math.abs(PIXEL_WALK_FPS - 10.8) < 1e-12)
  assert.equal(pixelFrameIndex(0, true), 0)
  assert.equal(pixelFrameIndex(.1, true), 1)
  assert.equal(pixelFrameIndex(.2, true), 2)
  assert.equal(pixelFrameIndex(.3, true), 0)
  assert.equal(pixelFrameIndex(42, false), 0)
  assert.equal(pixelFrameIndex(NaN, true), 0)
  assert.equal(pixelFrameIndex(-1, true), 0)
  assert.equal(pixelFrameIndex(1, true, 0), 0)
  assert.equal(pixelFrameIndex(1, true, NaN), 0)
})

test('facing follows travel projected into camera-right and holds direction for zero horizontal motion', () => {
  assert.equal(pixelFacingFlip({ x: 1, z: 0 }), true)
  assert.equal(pixelFacingFlip({ x: -1, z: 0 }), false)
  assert.equal(pixelFacingFlip({ x: 1, z: 0 }, { x: -1, z: 0 }), false)
  assert.equal(pixelFacingFlip({ x: 0, z: 1 }, { x: 0, z: 1 }), true)
  assert.equal(pixelFacingFlip({ x: 0, z: 0 }, { x: 1, z: 0 }, true), true)
  assert.equal(pixelFacingFlip({ x: 0, z: 0 }, { x: 1, z: 0 }, false), false)
})

test('atlas crop handles both unrotated trim and clockwise-packed rotated frames', () => {
  const frame = { frame: { x: 10, y: 20, w: 12, h: 7 }, rotated: true,
    spriteSourceSize: { x: 3, y: 4, w: 7, h: 12 }, sourceSize: { w: 20, h: 30 } }
  const before = JSON.stringify(frame)
  assert.deepEqual(atlasFrameDraw(frame, 100, 200), { source: [10, 20, 12, 7],
    translate: [103, 216], rotation: -Math.PI / 2, destination: [0, 0, 12, 7] })
  assert.equal(JSON.stringify(frame), before)
  const body = atlas.frames.get('character/f/5_1/1.png')
  assert.deepEqual(atlasFrameDraw(body), { source: [2938, 1164, 172, 434],
    translate: [65, 0], rotation: 0, destination: [0, 0, 172, 434] })
})

test('pixel batch freezes frames, billboards, cups and visibility without changing route roots', async () => {
  const oldDocument = globalThis.document
  globalThis.document = { createElement() {
    return { width: 0, height: 0, getContext: () => ({ save() {}, restore() {}, translate() {},
      rotate() {}, drawImage() {}, scale() {}, fillRect() {} }) }
  } }
  try {
    const person = { id: 'undergraduate_consumer_003', role: 'undergraduate_consumer' }
    const figure = new THREE.Group()
    figure.position.set(23, .35, -56)
    figure.rotation.y = Math.PI / 2
    figure.scale.setScalar(2)
    const entry = { person, figure, walker: { phase: 'outbound', points: [{ x: 23, y: 56 }] }, hasCoffee: false }
    const scene = new THREE.Scene()
    scene.add(figure)
    const camera = new THREE.PerspectiveCamera(42, 1.6, .1, 10000)
    camera.position.set(0, 20, 30)
    camera.lookAt(0, 0, 0)
    const batch = await new PixelCharacterBatch({ scene, entries: new Map([[person.id, entry]]) })
      .init({ assets: { atlas, images: [{}, {}, {}] } })
    const originalPosition = figure.position.clone(), originalRotation = figure.quaternion.clone(), originalScale = figure.scale.clone()
    const originalRoute = JSON.stringify(entry.walker.points)
    batch.update(0, camera)
    batch.update(.1, camera)
    const actor = batch.actors.get(person.id)
    assert.equal(actor.frame, 1)
    assert.equal(actor.sprite.isSprite, true)
    assert.deepEqual(actor.sprite.center.toArray(), [.5, 0])
    assert.equal(actor.sprite.scale.y, PIXEL_PERSON_HEIGHT * 2)
    assert.equal(actor.material.map.magFilter, THREE.NearestFilter)
    assert.equal(actor.material.map.minFilter, THREE.NearestFilter)
    assert.equal(actor.material.map.repeat.x, -1)
    const matrix = actor.material.map.matrix.clone()
    batch.update(.1, camera)
    assert.equal(actor.frame, 1)
    assert.deepEqual(actor.material.map.matrix, matrix)
    entry.walker.phase = 'dwell'
    entry.hasCoffee = true
    batch.update(.2, camera)
    assert.equal(actor.frame, 0)
    assert.equal(actor.cup.visible, true)
    const screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    assert.ok(actor.cup.position.clone().sub(actor.sprite.position).dot(screenUp) > actor.sprite.scale.y)
    entry.presentationVisible = false
    batch.update(.2, camera)
    assert.equal(actor.sprite.visible, false)
    assert.equal(actor.cup.visible, false)
    assert.equal(actor.marker.visible, false)
    batch.setVisible(false)
    assert.equal(batch.group.visible, false)
    batch.setVisible(true)
    batch.setQuality('low')
    assert.equal(batch.quality, 'low')
    assert.deepEqual(figure.position, originalPosition)
    assert.deepEqual(figure.quaternion.toArray(), originalRotation.toArray())
    assert.deepEqual(figure.scale, originalScale)
    assert.equal(JSON.stringify(entry.walker.points), originalRoute)
    let disposedTextures = 0
    for (const texture of batch.textures) texture.addEventListener('dispose', () => disposedTextures += 1)
    const count = batch.textures.size
    batch.dispose()
    batch.dispose()
    assert.equal(disposedTextures, count)
    assert.equal(batch.actors.size, 0)
    assert.equal(scene.children.includes(batch.group), false)
  } finally {
    if (oldDocument === undefined) delete globalThis.document
    else globalThis.document = oldDocument
  }
})
