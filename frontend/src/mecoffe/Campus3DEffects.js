// Procedural presentation effects only. No asset downloads, model calls or
// synthetic social events: every connection comes from an existing event.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { resolveHomeKey } from './campus3dRouting.js'
import { prototypeParams } from './assetCatalog.js'

const STYLES = Object.fromEntries(['post','comment','follow','ad','exposure','interview','purchase'].map(type=>{
  const {color,text,duration}=prototypeParams(`effect.${type}`)
  return [type,{color:parseInt(color.slice(1),16),text,duration}]
}))

export function visualEventStyle(type) {
  const style = STYLES[type]
  return style ? { ...style } : null
}

export function formatPurchaseReceipt(event) {
  const quantity = Number.isFinite(event.quantity) && event.quantity > 0 ? event.quantity : 1
  const amount = Number.isFinite(event.amount_fen) ? `¥${(event.amount_fen / 100).toFixed(2)}` : '金额未记录'
  return `+${quantity} ☕  ${amount}`
}

// Return only explicitly recorded participants. The map never invents an
// audience, a friendship, or a causal path from geographical proximity.
export function eventConnections(event, knownIds) {
  const has = id => typeof id === 'string' && (!knownIds || knownIds.has(id))
  const pairs = []
  const append = (source, target, kind) => {
    if (source !== target && has(source) && has(target)) pairs.push({ source, target, kind })
  }
  if (event.type === 'comment' || event.type === 'follow') append(event.actor, event.target, event.type)
  if (event.type === 'ad') {
    for (const target of event.targeted || []) append(event.actor, target, 'ad')
  }
  if (event.type === 'exposure') {
    for (const brand of event.brand_ids || []) append(brand, event.actor, 'ad')
  }
  return pairs.filter((pair, i) => pairs.findIndex(other => other.source === pair.source
    && other.target === pair.target && other.kind === pair.kind) === i)
}

export function arcPoints(start, end, segments = 28) {
  const count = Math.max(2, Math.floor(segments))
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
  const lift = Math.max(22, Math.min(110, length * 0.16))
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t + 4 * t * (1 - t) * lift,
      z: start.z + (end.z - start.z) * t,
    }
  })
}

function disposeVisual(object) {
  const geometries = new Set()
  const materials = new Set()
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material) materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  // Canvas textures belong to the manager's cache and survive transient FX.
}

function makeTextTexture(text, color) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const font = '700 30px "Microsoft YaHei",sans-serif'
  context.font = font
  canvas.width = Math.ceil(context.measureText(text).width + 38)
  canvas.height = 76
  context.font = font
  context.fillStyle = 'rgba(13,29,39,.93)'
  context.beginPath()
  context.roundRect(2, 2, canvas.width - 4, 60, 17)
  context.fill()
  context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`
  context.lineWidth = 3
  context.stroke()
  context.beginPath()
  context.moveTo(canvas.width / 2 - 8, 61)
  context.lineTo(canvas.width / 2, 74)
  context.lineTo(canvas.width / 2 + 8, 61)
  context.fill()
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, canvas.width / 2, 33)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: canvas.width / canvas.height }
}

export class EventEffects {
  constructor({ scene, index, routing, shopMarkers, labelFactory } = {}) {
    this.scene = scene
    this.index = index
    this.routing = routing
    this.shopMarkers = shopMarkers || new Map()
    this.labelFactory = labelFactory
    this.group = new THREE.Group()
    this.group.name = 'recorded-event-effects'
    this.scene.add(this.group)
    this.effects = []
    this.textures = new Map()
    this.quality = 'high'
    this.disposed = false
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'high'
    const limit = this.quality === 'low' ? 28 : 72
    while (this.effects.length > limit) this.remove(this.effects.shift())
    for (const effect of this.effects) {
      for (const particle of effect.particles || []) particle.visible = this.quality === 'high'
    }
  }

  roofFor(id) {
    const person = this.index.people.get(id)
    const key = person ? resolveHomeKey(person) : `shop_${id}`
    const anchor = this.routing.anchors.get(key)
    return anchor ? new THREE.Vector3(anchor.center.x, (anchor.building.height_m || 12) + 12, -anchor.center.y) : null
  }

  label(text, color, height = 26) {
    if (this.labelFactory) return this.labelFactory(text, color, height)
    const key = `${color}:${text}`
    if (!this.textures.has(key)) this.textures.set(key, makeTextTexture(text, color))
    const { texture, aspect } = this.textures.get(key)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }))
    sprite.scale.set(height * aspect, height, 1)
    sprite.renderOrder = 9
    return sprite
  }

  add(effect) {
    const limit = this.quality === 'low' ? 28 : 72
    while (this.effects.length >= limit) this.remove(this.effects.shift())
    this.group.add(effect.object)
    this.effects.push({ ...effect, life: 0 })
  }

  bubble(position, text, style) {
    const sprite = this.label(text, style.color)
    sprite.position.copy(position)
    this.add({ object: sprite, origin: position.clone(), duration: style.duration, kind: 'bubble' })
  }

  connection(start, end, kind) {
    if (start.distanceTo(end) < 0.1) return
    const style = STYLES[kind] || STYLES.follow
    const points = arcPoints(start, end).map(point => new THREE.Vector3(point.x, point.y, point.z))
    const curve = new THREE.CatmullRomCurve3(points)
    const object = new THREE.Group()
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: new THREE.Color(style.color).multiplyScalar(kind === 'ad' ? 1.8 : 1),
        transparent: true, opacity: 0.8, depthWrite: false }))
    beam.userData.bloom = kind === 'ad'
    object.add(beam)
    const particles = []
    if (kind === 'ad') {
      for (let i = 0; i < 3; i += 1) {
        const particle = new THREE.Mesh(new THREE.SphereGeometry(2.4, 6, 4),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(style.color).multiplyScalar(2),
            transparent: true, opacity: 0.95, depthWrite: false }))
        particle.userData.bloom = true
        particle.visible = this.quality === 'high'
        object.add(particle)
        particles.push(particle)
      }
    }
    this.add({ object, duration: style.duration, kind: 'connection', curve, beam, particles })
  }

  playEvent(event) {
    if (this.disposed || event.type === 'purchase') return
    const style = visualEventStyle(event.type)
    const roof = this.roofFor(event.actor)
    if (!style || !roof) return
    this.bubble(roof, style.text, style)
    const connections = eventConnections(event, this.index.people)
    const drawn = new Set()
    for (const pair of connections) {
      const start = this.roofFor(pair.source)
      const end = this.roofFor(pair.target)
      if (!start || !end) continue
      // One beam per pair of buildings is enough when several recorded
      // recipients share a residence; the original event data stays intact.
      const key = `${start.x}:${start.z}:${end.x}:${end.z}:${pair.kind}`
      if (drawn.has(key)) continue
      drawn.add(key)
      this.connection(start, end, pair.kind)
    }
  }

  purchaseArrived(event) {
    if (this.disposed) return
    const style = STYLES.purchase
    const roof = this.roofFor(event.brand_id)
    const marker = this.shopMarkers.get(event.brand_id)
    if (!roof || !marker) return
    this.bubble(roof, formatPurchaseReceipt(event), style)
    const object = new THREE.Group()
    const circle = new THREE.Mesh(new THREE.RingGeometry(6, 8, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(style.color).multiplyScalar(1.8),
        transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
    circle.rotation.x = -Math.PI / 2
    circle.userData.bloom = true
    object.add(circle)
    const flash = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 14, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(style.color).multiplyScalar(1.5),
        transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }))
    flash.position.y = 7
    flash.userData.bloom = true
    object.add(flash)
    object.position.copy(marker.position)
    object.position.y = 0.9
    this.add({ object, circle, flash, duration: 1.9, kind: 'arrival' })
  }

  update(delta) {
    if (this.disposed) return
    const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0
    const active = []
    for (const effect of this.effects) {
      effect.life += elapsed
      const t = Math.min(1, effect.life / effect.duration)
      if (t >= 1) { this.remove(effect); continue }
      const opacity = Math.min(1, t * 6) * (1 - t)
      if (effect.kind === 'bubble') {
        effect.object.position.y = effect.origin.y + t * 26
        effect.object.material.opacity = Math.min(1, t * 8) * (1 - t * t)
      } else if (effect.kind === 'connection') {
        effect.beam.material.opacity = opacity * 0.85
        effect.particles.forEach((particle, i) => {
          particle.position.copy(effect.curve.getPointAt((t * 1.7 + i / 3) % 1))
          particle.material.opacity = opacity
        })
      } else if (effect.kind === 'arrival') {
        effect.circle.scale.setScalar(1 + t * 3.6)
        effect.circle.material.opacity = opacity
        effect.flash.scale.setScalar(1 + t * 0.55)
        effect.flash.material.opacity = opacity * 0.38
      }
      active.push(effect)
    }
    this.effects = active
  }

  remove(effect) {
    this.group.remove(effect.object)
    disposeVisual(effect.object)
  }

  reset() {
    for (const effect of this.effects) this.remove(effect)
    this.effects = []
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.reset()
    this.group.removeFromParent()
    for (const { texture } of this.textures.values()) texture.dispose()
    this.textures.clear()
  }
}

/** Isolate emissive objects, then restore every scene property even on error. */
export function withBloomIsolation(scene, blackMaterial, callback) {
  const saved = []
  const background = scene.background
  const fog = scene.fog
  scene.background = new THREE.Color(0x000000)
  scene.fog = null
  try {
    scene.traverse(object => {
      if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return
      const originalMaterials = Array.isArray(object.material) ? object.material : [object.material]
      if (originalMaterials.length && originalMaterials.every(material => material?.visible === false)) {
        // Invisible raycast proxies must not turn into black bloom occluders.
        saved.push({ object, visible: object.visible })
        object.visible = false
        return
      }
      if (object.userData.bloomMaterial) {
        saved.push({ object, material: object.material })
        object.material = object.userData.bloomMaterial
      } else if (object.userData.bloom === true) {
        // Keep only explicitly marked lights, windows or event glows.
      } else if (object.isMesh && object.userData.bloomOcclusion !== false) {
        saved.push({ object, material: object.material })
        object.material = blackMaterial
      } else {
        saved.push({ object, visible: object.visible })
        object.visible = false
      }
    })
    return callback()
  } finally {
    for (const state of saved) {
      if ('material' in state) state.object.material = state.material
      if ('visible' in state) state.object.visible = state.visible
    }
    scene.background = background
    scene.fog = fog
  }
}

// The emissive-only pass swaps caster materials, so it must never consume a
// pending shadow refresh. The normal render refreshes with the real materials.
export function withShadowUpdatesFrozen(shadowMap, callback) {
  const autoUpdate = shadowMap.autoUpdate
  const needsUpdate = shadowMap.needsUpdate
  try {
    shadowMap.autoUpdate = false
    shadowMap.needsUpdate = false
    return callback()
  } finally {
    shadowMap.autoUpdate = autoUpdate
    shadowMap.needsUpdate = needsUpdate
  }
}

export class SelectiveBloom {
  constructor({ renderer, scene, camera, width = 1, height = 1 } = {}) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.quality = 'high'
    this.disposed = false
    this.blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
    this.bloomComposer = new EffectComposer(renderer)
    this.bloomComposer.renderToScreen = false
    this.bloomComposer.setPixelRatio(1)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.42, 0.38, 0.65)
    this.bloomComposer.addPass(new RenderPass(scene, camera))
    this.bloomComposer.addPass(this.bloomPass)
    this.composer = new EffectComposer(renderer)
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5))
    // WebGLRenderer's canvas antialiasing does not apply to offscreen targets.
    // Sample polygon edges here so narrow road markings remain legible; atlas
    // texture sampling still uses NearestFilter and retains its pixel pattern.
    const samples = Math.min(4, renderer.capabilities.maxSamples || 0)
    this.composer.renderTarget1.samples = samples
    this.composer.renderTarget2.samples = samples
    this.composer.addPass(new RenderPass(scene, camera))
    this.mixPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform sampler2D tBloom; varying vec2 vUv; void main(){vec4 base=texture2D(tDiffuse,vUv);vec3 glow=texture2D(tBloom,vUv).rgb;gl_FragColor=vec4(base.rgb+glow,base.a);}',
    })
    this.composer.addPass(this.mixPass)
    // ACES and display color conversion happen once, at the end.
    this.composer.addPass(new OutputPass())
    this.resize(width, height)
  }

  setQuality(quality) { this.quality = quality === 'low' ? 'low' : 'high' }

  resize(width, height) {
    if (this.disposed) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    this.bloomComposer.setSize(Math.max(1, Math.round(w * 0.65)), Math.max(1, Math.round(h * 0.65)))
    this.composer.setSize(w, h)
  }

  render() {
    if (this.disposed) return
    if (this.quality === 'low') { this.renderer.render(this.scene, this.camera); return }
    const renderTarget = this.renderer.getRenderTarget()
    const autoClear = this.renderer.autoClear
    const clearColor = this.renderer.getClearColor(new THREE.Color()).clone()
    const clearAlpha = this.renderer.getClearAlpha()
    try {
      this.renderer.setClearColor(0x000000, 1)
      withShadowUpdatesFrozen(this.renderer.shadowMap, () =>
        withBloomIsolation(this.scene, this.blackMaterial, () => this.bloomComposer.render()))
    } finally {
      this.renderer.autoClear = autoClear
      this.renderer.setClearColor(clearColor, clearAlpha)
      this.renderer.setRenderTarget(renderTarget)
    }
    this.mixPass.uniforms.tBloom.value = this.bloomComposer.readBuffer.texture
    this.composer.render()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const pass of this.bloomComposer.passes) pass.dispose?.()
    for (const pass of this.composer.passes) pass.dispose?.()
    this.bloomComposer.dispose()
    this.composer.dispose()
    this.blackMaterial.dispose()
  }
}
