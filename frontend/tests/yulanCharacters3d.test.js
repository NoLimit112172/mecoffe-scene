import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { indexPixelAtlases, pixelFigureLayout } from '../src/mecoffe/campus3dPixelModel.js'
import { dominantOpaqueColour, opaqueBounds, sampledHairStyle, sampleYuLanAppearance, yuLanAppearanceKey,
  yuLanCharacterPose, YULAN_CHARACTER_HEIGHT, YULAN_CHARACTER_RADIUS } from '../src/mecoffe/yulanCharacterModel.js'
import { YuLanCharacterBatch } from '../src/mecoffe/Campus3DYuLanCharacters.js'

const atlas = indexPixelAtlases([0, 1, 2].map(index => JSON.parse(readFileSync(new URL(`../public/assets/bgrd-${index}.json`, import.meta.url), 'utf8'))))
const person = { id: 'undergraduate_consumer_003', role: 'undergraduate_consumer' }
const layout = pixelFigureLayout(person, atlas)
function raster(width, height, colour) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4)
  return { width, height, data }
}
function samples() {
  return {
    body: raster(20, 40, (x, y) => x < 2 || x > 17 ? [0, 0, 0, 0] : y < 22 ? [50, 90, 140, 255] : y < 36 ? [30, 50, 70, 255] : [52, 31, 25, 255]),
    face: raster(16, 16, () => [249, 183, 112, 255]),
    hair: raster(16, 16, (x, y) => y < 5 ? [112, 61, 35, 255] : [255, 0, 0, 0]),
    lowerHair: null,
  }
}
const fakeRasterize = () => ({ rasters: samples(), faceCanvas: { width: 32, height: 32 } })

test('YuLan palette sampling ignores transparent padding and samples original clothing, hair and skin regions', () => {
  const source = samples(), before = structuredClone(source)
  assert.deepEqual(opaqueBounds(source.body), { minX: 2, minY: 0, maxX: 17, maxY: 39, width: 16, height: 40, count: 640 })
  assert.deepEqual(dominantOpaqueColour(source.hair), [112, 61, 35])
  const appearance = sampleYuLanAppearance(layout, source)
  assert.equal(appearance.skin, '#f9b770')
  assert.equal(appearance.hair, '#703d23')
  assert.equal(appearance.shirt, '#325a8c')
  assert.equal(appearance.trousers, '#1e3246')
  assert.equal(appearance.shoes, '#341f19')
  assert.deepEqual(source, before)
  assert.equal(appearance.source.recipe, 'character/m/5_4')
  assert.equal(appearance.source.head.e, 'head/m/e/17.png')
  assert.equal(appearance.source.head.m, 'head/m/m/21.png')
  assert.equal(appearance.source.license, 'Apache-2.0')
})

test('YuLan colour extraction is deterministic, rejects broken images and does not invent colours for empty source art', () => {
  assert.deepEqual(sampleYuLanAppearance(layout, samples()), sampleYuLanAppearance(layout, samples()))
  assert.throws(() => dominantOpaqueColour({ width: 2, height: 2, data: [0] }), /complete RGBA/)
  const source = samples(); source.face = raster(16, 16, () => [90, 20, 10, 0])
  assert.equal(dominantOpaqueColour(source.face), null)
  assert.throws(() => sampleYuLanAppearance(layout, source), /no opaque skin/)
})

test('hair volumes use the source silhouette and lower-hair layer rather than a random role hairstyle', () => {
  const source = samples()
  assert.equal(sampledHairStyle(source.hair, source.face), 'cropped')
  const lower = raster(8, 16, () => [112, 61, 35, 255])
  assert.equal(sampledHairStyle(source.hair, source.face, lower), 'long')
  assert.equal(sampledHairStyle(raster(16, 16, () => [0, 0, 0, 0]), source.face), 'bald')
  assert.match(yuLanAppearanceKey(layout), /character\/m\/5_4\/1\.png\|head\/m\/f\/7\.png/)
})

test('the absolute pose clock freezes both idle and walking while the coffee arm remains lifted', () => {
  const pose = yuLanCharacterPose(.4, 1.2, true, true)
  assert.deepEqual(pose, yuLanCharacterPose(.4, 1.2, true, true))
  assert.equal(pose.leftLeg, -pose.rightLeg)
  assert.equal(pose.rightArm, -.72)
  assert.equal(pose.rightElbow, -.7)
  assert.notDeepEqual(yuLanCharacterPose(0, 0, false), yuLanCharacterPose(1, 0, false))
  assert.notDeepEqual(pose, yuLanCharacterPose(.6, 1.2, true, true))
})

test('full-volume YuLan bodies have closed head, torso, articulated arms, knees, shoes and rear hair geometry', async () => {
  const scene = new THREE.Scene(), figure = new THREE.Group(); scene.add(figure)
  const entry = { person, figure, presentationVisible: true, walker: { phase: 'outbound' } }
  const batch = await new YuLanCharacterBatch({ scene, entries: new Map([[person.id, entry]]) }).init({ assets: { atlas, images: [] }, rasterize: fakeRasterize })
  try {
    for (const name of ['head', 'hair-back', 'hair-long', 'torso', 'hips', 'left-upper-arm', 'right-forearm', 'left-thigh', 'right-shin', 'left-shoe', 'right-shoe']) {
      const mesh = batch.meshes.get(name)
      assert.ok(mesh?.isInstancedMesh, name)
      mesh.geometry.computeBoundingBox()
      const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3())
      assert.ok(size.x > .3 && size.y > .3 && size.z > .3, `${name} is a volume, not a plane or one-pixel extrusion`)
      // Six box sides (each tessellated for bevels), including back and sides.
      const normals = mesh.geometry.attributes.normal
      for (const axis of ['X', 'Y', 'Z']) {
        assert.ok(Array.from({ length: normals.count }, (_, i) => normals[`get${axis}`](i)).some(value => value > .9), `${name} positive ${axis}`)
        assert.ok(Array.from({ length: normals.count }, (_, i) => normals[`get${axis}`](i)).some(value => value < -.9), `${name} negative ${axis}`)
      }
    }
    assert.equal(batch.faces.length, 1, 'Only facial features use a decal; the body is full closed geometry')
    assert.equal(batch.faces[0].material.map.magFilter, THREE.NearestFilter)
    assert.equal(batch.faces[0].material.map.minFilter, THREE.NearestFilter)
    assert.equal(batch.faces[0].material.map.generateMipmaps, false)
  } finally { batch.dispose() }
})

test('per-person fallback filtering hides ready real actors and restores the same YuLan instance',async()=>{
  const scene=new THREE.Scene(),figure=new THREE.Group();scene.add(figure)
  const entry={person,figure,presentationVisible:true}
  const batch=await new YuLanCharacterBatch({scene,entries:new Map([[person.id,entry]])}).init({assets:{atlas,images:[]},rasterize:fakeRasterize})
  try{
    const matrix=new THREE.Matrix4();batch.setEntryFilter(()=>false);batch.update(0)
    batch.meshes.get('torso').getMatrixAt(0,matrix);assert.equal(matrix.determinant(),0);assert.equal(batch.faces[0].visible,false)
    batch.setEntryFilter(null);batch.update(0);batch.meshes.get('torso').getMatrixAt(0,matrix)
    assert.ok(matrix.determinant()>0);assert.equal(batch.faces[0].visible,true);assert.equal(batch.actors[0],entry)
  }finally{batch.dispose()}
})

test('YuLan actors read root pose without modifying routes and freeze when paused, including idle', async () => {
  const scene = new THREE.Scene(), figure = new THREE.Group()
  figure.position.set(23, 1.2, -55); figure.rotation.y = 1.1; figure.scale.setScalar(2); scene.add(figure)
  const entry = { person, figure, walker: { phase: 'outbound', points: [{ x: 23, y: 55 }, { x: 26, y: 60 }] }, hasCoffee: false }
  const before = { position: figure.position.toArray(), quaternion: figure.quaternion.toArray(), scale: figure.scale.toArray(), walker: JSON.stringify(entry.walker) }
  const batch = await new YuLanCharacterBatch({ scene, entries: new Map([[person.id, entry]]) }).init({ assets: { atlas, images: [] }, rasterize: fakeRasterize })
  try {
    batch.update(.2)
    const matrices = () => [...batch.meshes.values()].map(mesh => Array.from(mesh.instanceMatrix.array))
    const first = matrices(); batch.update(.2); assert.deepEqual(matrices(), first)
    batch.update(.4); assert.notDeepEqual(matrices(), first)
    entry.walker.phase = 'dwell'; entry.hasCoffee = true; batch.update(.5)
    const cup = new THREE.Matrix4(); batch.meshes.get('cup').getMatrixAt(0, cup)
    assert.ok(Math.abs(cup.determinant()) > .1)
    const idle = matrices(); batch.update(.5); assert.deepEqual(matrices(), idle)
    assert.deepEqual(figure.position.toArray(), before.position); assert.deepEqual(figure.quaternion.toArray(), before.quaternion); assert.deepEqual(figure.scale.toArray(), before.scale)
    assert.deepEqual(entry.walker.points, JSON.parse(before.walker).points)
    entry.presentationVisible = false; batch.update(.6)
    assert.equal(batch.faces[0].visible, false)
    batch.meshes.get('head').getMatrixAt(0, cup); assert.equal(cup.determinant(), 0)
    batch.setQuality('low'); assert.ok([...batch.meshes.values()].every(mesh => !mesh.castShadow))
    batch.setVisible(false); assert.equal(batch.group.visible, false)
  } finally { batch.dispose() }
})

test('declared display collision radius and height contain animated body parts and a carried cup', async () => {
  const scene = new THREE.Scene(), figure = new THREE.Group(); scene.add(figure)
  const entry = { person, figure, walker: { phase: 'return' }, hasCoffee: true }
  const batch = await new YuLanCharacterBatch({ scene, entries: new Map([[person.id, entry]]) }).init({ assets: { atlas, images: [] }, rasterize: fakeRasterize })
  try {
    const matrix = new THREE.Matrix4()
    for (let tick = 0; tick <= 120; tick++) {
      batch.update(tick / 60)
      for (const [name, mesh] of batch.meshes) {
        mesh.geometry.computeBoundingBox(); mesh.getMatrixAt(0, matrix)
        if (matrix.determinant() === 0) continue
        const { min, max } = mesh.geometry.boundingBox
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(matrix)
          assert.ok(Math.hypot(point.x, point.z) <= YULAN_CHARACTER_RADIUS, `${name} exceeds radius: ${Math.hypot(point.x, point.z)}`)
          assert.ok(point.y <= YULAN_CHARACTER_HEIGHT, `${name} exceeds height: ${point.y}`)
          assert.ok(point.y >= -.03, `${name} penetrates ground: ${point.y}`)
        }
      }
    }
  } finally { batch.dispose() }
})

test('equal YuLan combinations share sampled textures and dispose shared resources only once', async () => {
  const scene = new THREE.Scene(), entries = new Map()
  for (const id of ['a', 'b']) entries.set(id, { person, figure: new THREE.Group() })
  let samples = 0
  const batch = await new YuLanCharacterBatch({ scene, entries }).init({ assets: { atlas, images: [] }, rasterize: () => { samples++; return fakeRasterize() } })
  assert.equal(samples, 1); assert.equal(batch.cache.size, 1)
  assert.equal(batch.faces[0].material, batch.faces[1].material)
  let geometries = 0, textures = 0
  for (const geometry of batch.geometryCache.values()) geometry.addEventListener('dispose', () => geometries++)
  for (const item of batch.cache.values()) item.texture.addEventListener('dispose', () => textures++)
  const expected = batch.geometryCache.size
  batch.dispose(); batch.dispose()
  assert.equal(geometries, expected); assert.equal(textures, 1)
  assert.equal(scene.children.includes(batch.group), false)
})
