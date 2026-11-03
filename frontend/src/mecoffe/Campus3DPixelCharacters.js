// YuLan atlas artwork, using the same appearance recipe as the 2D campus.
// Sprites are camera-facing display objects; source positions/routes are read-only.
import * as THREE from 'three'
import { PIXEL_PERSON_HEIGHT, atlasFrameDraw, indexPixelAtlases, pixelFacingFlip, pixelFigureLayout, pixelFrameIndex } from './campus3dPixelModel.js'
import { CHARACTER_ROLE_COLORS } from './Campus3DCharacters.js'

function nearestTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  return texture
}

function drawAtlasFrame(context, image, frame, x = 0, y = 0) {
  const draw = atlasFrameDraw(frame, x, y)
  context.save()
  context.translate(...draw.translate)
  if (draw.rotation) context.rotate(draw.rotation)
  context.drawImage(image, ...draw.source, ...draw.destination)
  context.restore()
}

function composeFrames(layout, images) {
  // Source art is ~612 px high but occupies a few dozen screen pixels. Keep a
  // crisp 256 px output per frame instead of hundreds of large RGBA canvases.
  const factor = Math.min(1, 256 / layout.bounds.height)
  return layout.bodies.map(body => {
    const image = document.createElement('canvas')
    image.width = Math.ceil(layout.bounds.width * factor)
    image.height = Math.ceil(layout.bounds.height * factor)
    const context = image.getContext('2d')
    context.imageSmoothingEnabled = false
    context.scale(factor, factor)
    context.translate(-layout.bounds.x, -layout.bounds.y)
    drawAtlasFrame(context, images[body.sheet], body)
    for (const layer of layout.headLayers) drawAtlasFrame(context, images[layer.frame.sheet], layer.frame, layer.x, layer.y)
    return nearestTexture(image)
  })
}

function coffeeTexture() {
  const image = document.createElement('canvas')
  image.width = image.height = 24
  const context = image.getContext('2d')
  // A tiny original pixel icon; no font/emoji fallback or external asset.
  context.fillStyle = '#243d43'
  context.fillRect(3, 5, 17, 4)
  context.fillStyle = '#fff6de'
  context.fillRect(5, 9, 13, 11)
  context.fillStyle = '#be8753'
  context.fillRect(6, 12, 11, 5)
  context.fillStyle = '#f0c678'
  context.fillRect(7, 20, 9, 2)
  context.fillStyle = '#ffffff'
  context.fillRect(8, 1, 2, 3)
  context.fillRect(13, 0, 2, 3)
  return nearestTexture(image)
}

async function loadAtlases() {
  const base = `${import.meta.env.BASE_URL}assets/`
  const atlases = await Promise.all([0, 1, 2].map(async index => {
    const response = await fetch(`${base}bgrd-${index}.json`)
    if (!response.ok) throw new Error(`YuLan atlas JSON: HTTP ${response.status}`)
    return response.json()
  }))
  const images = await Promise.all(atlases.map(async atlas => {
    const response = await fetch(`${base}${atlas.meta.image}`)
    if (!response.ok) throw new Error(`YuLan atlas image: HTTP ${response.status}`)
    return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' })
  }))
  return { atlas: indexPixelAtlases(atlases), images }
}

export class PixelCharacterBatch {
  constructor({ scene, entries } = {}) {
    this.scene = scene
    this.entries = entries
    this.group = new THREE.Group()
    this.group.name = 'mecoffe-yulan-pixel-characters'
    this.actors = new Map()
    this.textures = new Set()
    this.materials = new Set()
    this.quality = 'high'
    this.disposed = false
    this.position = new THREE.Vector3()
    this.scale = new THREE.Vector3()
    this.cameraRight = new THREE.Vector3(1, 0, 0)
    this.cameraUp = new THREE.Vector3(0, 1, 0)
  }

  async init({ assets } = {}) {
    const loaded = assets || await loadAtlases()
    try {
      if (this.disposed) return this
      this.cupMap = coffeeTexture()
      this.textures.add(this.cupMap)
      this.markerGeometry = new THREE.CircleGeometry(1.25, 16)
      for (const entry of this.entries.values()) {
        const layout = pixelFigureLayout(entry.person, loaded.atlas)
        const frames = composeFrames(layout, loaded.images)
        for (const texture of frames) this.textures.add(texture)
        const material = new THREE.SpriteMaterial({ map: frames[0], alphaTest: .06, transparent: true, depthWrite: false, toneMapped: false })
        const sprite = new THREE.Sprite(material)
        sprite.center.set(.5, 0)
        sprite.name = `pixel-person-${entry.person.id}`
        sprite.userData.person = entry.person
        const cupMaterial = new THREE.SpriteMaterial({ map: this.cupMap, alphaTest: .06, transparent: true, depthWrite: false, toneMapped: false })
        const cup = new THREE.Sprite(cupMaterial)
        cup.center.set(.5, 0)
        const markerMaterial = new THREE.MeshBasicMaterial({ color: CHARACTER_ROLE_COLORS[entry.person.role] || '#397fca', transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide })
        const marker = new THREE.Mesh(this.markerGeometry, markerMaterial)
        marker.rotation.x = -Math.PI / 2
        this.materials.add(material)
        this.materials.add(cupMaterial)
        this.materials.add(markerMaterial)
        this.group.add(sprite, cup, marker)
        this.actors.set(entry.person.id, { entry, layout, frames, material, sprite, cup, marker,
          frame: -1, flip: false, walking: false, startedAt: 0, lastSeconds: 0 })
      }
      this.scene.add(this.group)
      return this
    } finally {
      if (!assets) for (const image of loaded.images) image.close?.()
    }
  }

  update(seconds = 0, camera) {
    if (this.disposed || !this.group.visible) return
    camera?.updateMatrixWorld()
    if (camera) {
      this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
      this.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
    }
    for (const actor of this.actors.values()) {
      const { entry } = actor
      const visible = entry.presentationVisible !== false && entry.figure.visible !== false
      actor.sprite.visible = visible
      actor.marker.visible = visible
      actor.cup.visible = visible && Boolean(entry.hasCoffee || entry.walker?.phase === 'return')
      if (!visible) continue
      entry.figure.updateWorldMatrix(true, false)
      entry.figure.getWorldPosition(this.position)
      entry.figure.getWorldScale(this.scale)
      const height = PIXEL_PERSON_HEIGHT * Math.abs(this.scale.y)
      actor.sprite.position.copy(this.position)
      actor.sprite.scale.set(height * actor.layout.bounds.width / actor.layout.bounds.height, height, 1)
      actor.marker.position.copy(this.position)
      actor.marker.position.y += .09
      actor.marker.scale.setScalar(Math.abs(this.scale.x))
      actor.cup.position.copy(this.position)
      // Both are billboards, so place the badge along camera-up. World +Y
      // would put it over the face in a steep overview instead of above it.
      actor.cup.position.addScaledVector(this.cameraUp, height + .15 * Math.abs(this.scale.y))
      actor.cup.scale.setScalar(height * .23)
      const walking = Boolean(entry.walker && entry.walker.phase !== 'dwell')
      if (walking && (!actor.walking || seconds < actor.lastSeconds)) actor.startedAt = seconds
      const frame = pixelFrameIndex(seconds - actor.startedAt, walking, actor.frames.length)
      const direction = { x: Math.sin(entry.figure.rotation.y), z: Math.cos(entry.figure.rotation.y) }
      const flip = walking ? pixelFacingFlip(direction, this.cameraRight, actor.flip) : actor.flip
      if (frame !== actor.frame || flip !== actor.flip) {
        const map = actor.frames[frame]
        map.repeat.x = flip ? -1 : 1
        map.offset.x = flip ? 1 : 0
        map.updateMatrix()
        actor.material.map = map
        actor.frame = frame
        actor.flip = flip
      }
      actor.walking = walking
      actor.lastSeconds = seconds
    }
  }

  setVisible(visible) { this.group.visible = Boolean(visible) }
  setQuality(quality) { this.quality = quality === 'low' ? 'low' : 'high' }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.group.clear()
    this.markerGeometry?.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.materials.clear()
    this.textures.clear()
    this.actors.clear()
  }
}
