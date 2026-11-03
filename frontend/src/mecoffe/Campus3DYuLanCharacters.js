import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { atlasFrameDraw, pixelFigureLayout } from './campus3dPixelModel.js'
import { loadYuLanAssets, yuLanFrameCanvas } from './YuLanAssetFactory.js'
import { sampleYuLanAppearance, yuLanAppearanceKey, yuLanCharacterPose,
  YULAN_CHARACTER_HEIGHT, YULAN_CHARACTER_RADIUS } from './yulanCharacterModel.js'

export { YULAN_CHARACTER_HEIGHT, YULAN_CHARACTER_RADIUS } from './yulanCharacterModel.js'

function rasterOf(canvas, maximum = 96) {
  const scale = Math.min(1, maximum / Math.max(canvas.width, canvas.height))
  const reduced = document.createElement('canvas')
  reduced.width = Math.max(1, Math.round(canvas.width * scale))
  reduced.height = Math.max(1, Math.round(canvas.height * scale))
  const context = reduced.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingEnabled = false
  context.drawImage(canvas, 0, 0, reduced.width, reduced.height)
  return { width: reduced.width, height: reduced.height, data: context.getImageData(0, 0, reduced.width, reduced.height).data }
}

/** Original face features are decals on a CLOSED procedural head; the sides and
 * back are full geometry. Do not extrude the original 2D silhouette as a slab.
 */
export function rasterizeYuLanCharacter(layout, assets) {
  const frame = part => layout.headLayers.find(layer => layer.part === part)
  const faceLayer = frame('f')
  if (!faceLayer) throw new Error('The YuLan appearance has no face frame')
  const canvasFor = part => { const layer = frame(part); return layer ? yuLanFrameCanvas(assets, layer.frame.key) : null }
  const face = canvasFor('f'), hair = canvasFor('h'), lower = canvasFor('lower-hair')
  const rasters = {
    body: rasterOf(yuLanFrameCanvas(assets, layout.bodies[0].key)), face: rasterOf(face),
    hair: hair ? rasterOf(hair) : null, lowerHair: lower ? rasterOf(lower) : null,
  }
  const trim = faceLayer.frame.spriteSourceSize || { x: 0, y: 0, w: face.width, h: face.height }
  const faceCanvas = document.createElement('canvas')
  const scale = Math.min(1, 160 / Math.max(trim.w, trim.h))
  faceCanvas.width = Math.max(1, Math.round(trim.w * scale)); faceCanvas.height = Math.max(1, Math.round(trim.h * scale))
  const context = faceCanvas.getContext('2d')
  context.imageSmoothingEnabled = false
  context.scale(faceCanvas.width / trim.w, faceCanvas.height / trim.h)
  context.translate(-faceLayer.x - trim.x, -faceLayer.y - trim.y)
  for (const layer of layout.headLayers.filter(layer => ['e', 'm'].includes(layer.part))) {
    const draw = atlasFrameDraw(layer.frame, layer.x, layer.y)
    context.save(); context.translate(...draw.translate)
    if (draw.rotation) context.rotate(draw.rotation)
    context.drawImage(assets.images[layer.frame.sheet], ...draw.source, ...draw.destination)
    context.restore()
  }
  return { rasters, faceCanvas }
}

export class YuLanCharacterBatch {
  constructor({ scene, entries } = {}) {
    if (!scene || !entries) throw new Error('YuLanCharacterBatch requires the existing scene and entries')
    this.scene = scene; this.entries = entries
    this.actors = [...entries.values()].sort((a, b) => String(a.person.id).localeCompare(String(b.person.id)))
    this.group = new THREE.Group(); this.group.name = 'mecoffe-yulan-full-volume-characters'
    this.meshes = new Map(); this.faces = []; this.cache = new Map(); this.geometryCache = new Map()
    this.appearances = []; this.quality = 'high'; this.disposed = false; this.initialized = false
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .86 })
    this.inverse = new THREE.Matrix4(); this.root = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4(); this.result = new THREE.Matrix4()
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(1, 1, 1); this.euler = new THREE.Euler(); this.quaternion = new THREE.Quaternion()
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  }

  async init({ assets, rasterize = rasterizeYuLanCharacter } = {}) {
    if (this.disposed || this.initialized) return this
    const loaded = assets || await loadYuLanAssets()
    try {
      if (this.disposed) return this
      for (const [index, entry] of this.actors.entries()) {
        const layout = pixelFigureLayout(entry.person, loaded.atlas), key = yuLanAppearanceKey(layout)
        if (!this.cache.has(key)) {
          const { rasters, faceCanvas } = rasterize(layout, loaded)
          const appearance = sampleYuLanAppearance(layout, rasters)
          const texture = new THREE.CanvasTexture(faceCanvas)
          texture.colorSpace = THREE.SRGBColorSpace
          texture.magFilter = texture.minFilter = THREE.NearestFilter
          texture.generateMipmaps = false
          const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: .05, depthWrite: false, roughness: .9 })
          this.cache.set(key, { appearance, material, texture })
        }
        const cached = this.cache.get(key)
        this.appearances.push(cached.appearance)
        const face = new THREE.Mesh(this.geometry('face', () => new THREE.PlaneGeometry(2.08, 2.12)), cached.material)
        face.matrixAutoUpdate = false; face.frustumCulled = false
        face.name = `yulan3d-face-${entry.person.id}`
        face.userData = { person: entry.person, originalFeatures: cached.appearance.source.head, license: 'Apache-2.0' }
        this.faces.push(face); this.group.add(face)
        if (index % 12 === 11 && typeof window !== 'undefined') await new Promise(resolve => setTimeout(resolve, 0))
        if (this.disposed) return this
      }
      this.makeParts()
      this.scene.add(this.group); this.initialized = true; this.update(0)
      return this
    } catch (error) { this.dispose(); throw error }
    finally { if (!assets) for (const image of loaded.images) image.close?.() }
  }

  geometry(key, create) {
    if (!this.geometryCache.has(key)) this.geometryCache.set(key, create())
    return this.geometryCache.get(key)
  }

  part(name, dimensions, colour, bevel = .06) {
    const key = `box:${dimensions.join(',')}:${bevel}`
    const geometry = this.geometry(key, () => new RoundedBoxGeometry(...dimensions, 1, bevel))
    const mesh = new THREE.InstancedMesh(geometry, this.material, this.actors.length)
    mesh.name = `yulan3d-${name}`; mesh.userData.characterPart = name
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false; mesh.castShadow = this.quality === 'high'; mesh.receiveShadow = false
    for (let index = 0; index < this.actors.length; index++) {
      mesh.setColorAt(index, new THREE.Color(typeof colour === 'function' ? colour(this.appearances[index]) : colour))
      mesh.setMatrixAt(index, this.hidden)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.meshes.set(name, mesh); this.group.add(mesh)
  }

  makeParts() {
    const skin = appearance => appearance.skin, shirt = appearance => appearance.shirt
    const trousers = appearance => appearance.trousers, hair = appearance => appearance.hair
    this.part('head', [2.24, 2.3, 2.08], skin, .13)
    this.part('neck', [.64, .55, .65], skin)
    this.part('hair-crown', [2.4, .60, 2.24], hair, .12)
    this.part('hair-back', [2.31, 1.23, .47], hair, .08)
    this.part('hair-long', [2.30, 2.12, .65], hair, .1)
    this.part('hair-fringe', [1.6, .44, .45], hair)
    this.part('torso', [2.05, 2.32, 1.28], shirt, .08)
    this.part('hips', [1.74, .55, 1.05], trousers)
    this.part('collar', [.75, .25, .13], appearance => appearance.skin)
    for (const side of ['left', 'right']) {
      this.part(`${side}-ear`, [.33, .55, .43], skin)
      this.part(`${side}-hair`, [.35, 1.05, 1.2], hair)
      this.part(`${side}-upper-arm`, [.65, 1.23, .72], shirt)
      this.part(`${side}-forearm`, [.49, 1.02, .58], skin)
      this.part(`${side}-hand`, [.55, .44, .64], skin)
      this.part(`${side}-thigh`, [.73, 1.25, .85], trousers)
      this.part(`${side}-shin`, [.67, 1.27, .78], trousers)
      this.part(`${side}-shoe`, [.86, .55, 1.40], appearance => appearance.shoes)
    }
    this.part('backpack', [1.4, 1.6, .55], appearance => appearance.accent, .1)
    this.part('cup', [.59, .77, .59], '#fff3db')
    this.part('cup-lid', [.66, .12, .66], '#514538', .03)
    this.part('cup-band', [.61, .25, .61], appearance => appearance.shirt, .03)
  }

  local(x, y, z, rx = 0, ry = 0, rz = 0) {
    this.position.set(x, y, z); this.euler.set(rx, ry, rz); this.quaternion.setFromEuler(this.euler)
    return this.localMatrix.compose(this.position, this.quaternion, this.scale)
  }

  put(name, index, matrix, visible = true) {
    this.meshes.get(name).setMatrixAt(index, visible ? this.result.multiplyMatrices(this.root, matrix) : this.hidden)
  }

  update(seconds = 0) {
    if (this.disposed || !this.initialized || !this.group.visible) return
    this.group.updateWorldMatrix(true, false); this.inverse.copy(this.group.matrixWorld).invert()
    for (const [index, entry] of this.actors.entries()) {
      const face = this.faces[index]
      if (entry.presentationVisible === false || entry.figure.visible === false) {
        for (const mesh of this.meshes.values()) mesh.setMatrixAt(index, this.hidden)
        face.visible = false; continue
      }
      face.visible = true
      entry.figure.updateWorldMatrix(true, false)
      this.root.multiplyMatrices(this.inverse, entry.figure.matrixWorld)
      const appearance = this.appearances[index]
      const walking = Boolean(entry.walker && entry.walker.phase !== 'dwell' && entry.walker.moving !== false)
      const carrying = Boolean(entry.hasCoffee || entry.walker?.phase === 'return')
      const pose = yuLanCharacterPose(seconds, appearance.phaseOffset, walking, carrying), bob = pose.bob
      this.put('torso', index, this.local(0, 4.62 + bob, 0))
      this.put('hips', index, this.local(0, 3.24 + bob * .4, 0))
      this.put('neck', index, this.local(0, 5.98 + bob, 0))
      const head = new THREE.Matrix4().makeTranslation(0, 6.99 + bob, 0).multiply(new THREE.Matrix4().makeRotationZ(pose.headTilt))
      this.put('head', index, head)
      face.matrix.multiplyMatrices(this.root, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 1.048)))
      face.matrixWorldNeedsUpdate = true
      const hair = appearance.hairStyle !== 'bald', long = ['long', 'bob'].includes(appearance.hairStyle)
      this.put('hair-crown', index, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.06, -.05)), hair)
      this.put('hair-back', index, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, .40, -.96)), hair)
      this.put('hair-long', index, head.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.42, -1.04)), long)
      const sweep = appearance.hairStyle === 'sweep-left' ? -1 : 1
      this.put('hair-fringe', index, head.clone().multiply(new THREE.Matrix4().makeTranslation(sweep * .28, .93, 1.02))
        .multiply(new THREE.Matrix4().makeRotationZ(sweep * -.10)), hair && appearance.hairStyle !== 'cropped')
      this.put('collar', index, this.local(0, 5.7 + bob, .66))
      this.put('backpack', index, this.local(0, 4.65 + bob, -.87), ['undergraduate_consumer', 'graduate_consumer'].includes(entry.person.role))
      for (const [side, sign] of [['left', -1], ['right', 1]]) {
        this.put(`${side}-ear`, index, head.clone().multiply(new THREE.Matrix4().makeTranslation(sign * 1.18, -.13, 0)))
        this.put(`${side}-hair`, index, head.clone().multiply(new THREE.Matrix4().makeTranslation(sign * 1.07, .45, -.22)), hair)
        const hip = new THREE.Matrix4().makeTranslation(sign * .48, 3.15 + bob * .4, 0).multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Leg`]))
        this.put(`${side}-thigh`, index, hip.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.625, 0)))
        const knee = hip.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.25, 0)).multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Knee`]))
        this.put(`${side}-shin`, index, knee.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.635, 0)))
        // Keep the shoe sole horizontal and above the presentation road. A
        // rigid shoe rotating with the shin would dip its toe through ground.
        const shoe = new THREE.Vector3(0, -1.605, .24).applyMatrix4(knee)
        this.put(`${side}-shoe`, index, this.local(shoe.x, Math.max(.275, shoe.y), shoe.z))
        const shoulder = new THREE.Matrix4().makeTranslation(sign * 1.30, 5.60 + bob, 0).multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Arm`]))
        this.put(`${side}-upper-arm`, index, shoulder.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.615, 0)))
        const elbow = shoulder.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.23, 0)).multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Elbow`]))
        this.put(`${side}-forearm`, index, elbow.clone().multiply(new THREE.Matrix4().makeTranslation(0, -.51, 0)))
        const hand = elbow.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.1, 0))
        this.put(`${side}-hand`, index, hand)
        if (side === 'right') {
          const position = new THREE.Vector3(0, -.08, .34).applyMatrix4(hand)
          this.put('cup', index, this.local(position.x, position.y + .26, position.z), carrying)
          this.put('cup-lid', index, this.local(position.x, position.y + .70, position.z), carrying)
          this.put('cup-band', index, this.local(position.x, position.y + .26, position.z), carrying)
        }
      }
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true
  }

  setVisible(visible) { this.group.visible = Boolean(visible) }
  setQuality(quality) { this.quality = quality === 'low' ? 'low' : 'high'; for (const mesh of this.meshes.values()) mesh.castShadow = this.quality === 'high' }
  dispose() {
    if (this.disposed) return
    this.disposed = true; this.group.removeFromParent()
    for (const mesh of this.meshes.values()) mesh.dispose()
    for (const geometry of this.geometryCache.values()) geometry.dispose()
    for (const cached of this.cache.values()) { cached.texture.dispose(); cached.material.dispose() }
    this.material.dispose(); this.group.clear(); this.meshes.clear(); this.faces.length = 0; this.cache.clear(); this.geometryCache.clear()
  }
}
