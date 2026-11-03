import * as THREE from 'three'
import { atlasFrameDraw, indexPixelAtlases } from './campus3dPixelModel.js'
import { buildingSuite, cropRectangle, wallModules, voxelizeRGBA, voxelSurface, YULAN_DECORATION_SETS } from './yulanAssetModel.js'
import { compatibleYuLanFacade, ROUND_FACADE_VARIANTS } from './yulanRoofModel.js'
import { createYuLanRoof } from './YuLanRoofGeometry.js'

/** Each returned image set has a clear owner; dispose it after adaptation. */
export async function loadYuLanAssets() {
  const base = `${import.meta.env.BASE_URL}assets/`
  const atlases = await Promise.all([0, 1, 2].map(async i => {
    const response = await fetch(`${base}bgrd-${i}.json`)
    if (!response.ok) throw new Error(`YuLan atlas ${i}: HTTP ${response.status}`)
    return response.json()
  }))
  const loaded = await Promise.allSettled(atlases.map(async atlas => {
    const response = await fetch(`${base}${atlas.meta.image}`)
    if (!response.ok) throw new Error(`YuLan image: HTTP ${response.status}`)
    return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' })
  }))
  const failure = loaded.find(result => result.status === 'rejected')
  if (failure) { for (const item of loaded) if (item.status === 'fulfilled') item.value.close?.(); throw failure.reason }
  return { atlas: indexPixelAtlases(atlases), images: loaded.map(item => item.value) }
}

/** Restore TexturePacker trim/rotation, then apply an explicitly recorded crop. */
export function yuLanFrameCanvas(assets, key, { crop, maxSize = Infinity } = {}) {
  const frame = assets.atlas.frames.get(key)
  if (!frame) throw new Error(`Missing YuLan atlas frame: ${key}`)
  const source = document.createElement('canvas')
  source.width = frame.sourceSize.w
  source.height = frame.sourceSize.h
  const context = source.getContext('2d')
  context.imageSmoothingEnabled = false
  const draw = atlasFrameDraw(frame)
  context.translate(...draw.translate)
  if (draw.rotation) context.rotate(draw.rotation)
  context.drawImage(assets.images[frame.sheet], ...draw.source, ...draw.destination)
  const rect = cropRectangle(source.width, source.height, crop)
  const factor = Math.min(1, maxSize / Math.max(rect.width, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * factor))
  canvas.height = Math.max(1, Math.round(rect.height * factor))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function buildVoxelGeometry(model) {
  const surface = voxelSurface(model)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(surface.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(surface.colors, 3))
  geometry.setIndex(surface.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData = { voxelCount:surface.voxelCount, faceCount:surface.faceCount,
    opaquePixels:model.opaquePixels, sourceOpaquePixels:model.sourceOpaquePixels }
  return geometry
}

export function disposeYuLanObject(object) {
  const geometries = new Set(), materials = new Set()
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material && !material.userData.yulanFactoryOwned) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  object.removeFromParent()
}

export class YuLanAssetFactory {
  constructor() { this.textures = new Map(); this.materials = new Map(); this.disposed = false }

  async init({ assets } = {}) {
    if (this.assets) return this
    if (!this.loading) this.loading = (async () => {
      const loaded = assets || await loadYuLanAssets()
      this.ownsImages = !assets
      if (this.disposed) { if(this.ownsImages)for(const image of loaded.images)image.close?.(); return this }
      this.assets = loaded
      return this
    })()
    return this.loading
  }

  material(part) {
    const id = `${part.key}|${JSON.stringify(part.crop || [])}`
    if (this.materials.has(id)) return this.materials.get(id)
    const canvas = yuLanFrameCanvas(this.assets, part.key, { crop:part.crop })
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    this.textures.set(id, texture)
    const material = new THREE.MeshStandardMaterial({ map:texture, side:THREE.DoubleSide, alphaTest:.08,
      roughness:.9, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 })
    material.userData.yulanFactoryOwned = true
    material.userData.atlasKey = part.key
    material.userData.crop = part.crop || null
    this.materials.set(id, material)
    return material
  }

  createBuilding(building, { type = 21, model = 1, moduleWidth = 8 } = {}) {
    if (!this.assets || this.disposed) throw new Error('YuLan factory must be initialized')
    const facadeSelection = compatibleYuLanFacade(building,{type,model})
    const suite = buildingSuite(facadeSelection.type, facadeSelection.model)
    const height = Number(building.height_m ?? building.height ?? 9.6)
    const layout = wallModules(building.polygon, { levels:Number(building.levels || 3), height, moduleWidth, holes:building.holes || [] })
    const group = new THREE.Group()
    group.name = `yulan-modular-${suite.type}-${suite.model}`
    const polygon = new THREE.Shape(layout.points.map(([x,y]) => new THREE.Vector2(x,y)))
    for(const ring of layout.holes || [])polygon.holes.push(new THREE.Path(ring.map(([x,y])=>new THREE.Vector2(x,y))))
    const coreGeometry = new THREE.ExtrudeGeometry(polygon, { depth:Math.max(.01,height-.02), steps:1, bevelEnabled:false })
    const coreMaterial = new THREE.MeshStandardMaterial({ color:0x646d71, roughness:.92, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 })
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.rotation.x = -Math.PI / 2
    core.castShadow = core.receiveShadow = true
    group.add(core)
    // Merge all standard panels and all entrance panels separately: arbitrary
    // footprints retain their exact corners without one draw call per window.
    for (const part of ['base','floor']) {
      const positions = [], normals = [], uvs = [], indices = []
      for (const panel of layout.modules.filter(module => module.part === part)) {
        const angle = panel.rotationY, cosine = Math.cos(angle), sine = Math.sin(angle)
        const first = positions.length / 3
        for (const [x,y,u,v] of [[-1,-1,0,0],[1,-1,1,0],[1,1,1,1],[-1,1,0,1]]) {
          const localX = x * panel.width / 2
          positions.push(panel.x + localX * cosine, panel.y + y * panel.height / 2, -panel.north - localX * sine)
          normals.push(sine,0,cosine)
          uvs.push(u,v)
        }
        indices.push(first,first+1,first+2,first,first+2,first+3)
      }
      if (!positions.length) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
      geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3))
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
      geometry.setIndex(indices)
      const mesh = new THREE.Mesh(geometry,this.material(suite[part]))
      mesh.name = `yulan-${part}-modules`
      mesh.castShadow = mesh.receiveShadow = true
      group.add(mesh)
    }
    const roof = createYuLanRoof(building,{type:suite.type,model:suite.model})
    group.add(roof)
    group.userData = { yulanAdaptation:true, suite, moduleCount:layout.modules.length,
      originalFootprint:building.polygon, originalHeight:height, source:'YuLan-OneSim atlas', license:'Apache-2.0',
      facadeSelection,roofType:roof.userData.roofPlan.kind,roofSource:'procedural geometry',roofTextureApplied:false }
    if(layout.holes?.length)group.userData.originalHoles=building.holes
    return group
  }

  createDecoration(key, { height = 7, depth = 3, resolution = 36 } = {}) {
    if (!this.assets || this.disposed) throw new Error('YuLan factory must be initialized')
    const canvas = yuLanFrameCanvas(this.assets,key,{maxSize:Math.max(8,Math.min(64,resolution))})
    const rgba = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)
    const model = voxelizeRGBA(rgba.data,canvas.width,canvas.height,{pixelSize:height/canvas.height,depth,alphaThreshold:64})
    const geometry = buildVoxelGeometry(model)
    const mesh = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93}))
    mesh.castShadow = mesh.receiveShadow = true
    const group = new THREE.Group()
    group.add(mesh)
    group.name = `yulan-voxel-${key}`
    group.userData = { yulanAdaptation:true, atlasKey:key, voxelCount:model.voxels.length,
      sampledResolution:[canvas.width,canvas.height], method:'RGBA samples extruded with interior faces removed',
      source:'YuLan-OneSim atlas',license:'Apache-2.0' }
    return group
  }

  async create(prototype, options = {}) {
    if (!this.assets) await this.init()
    const params = { ...prototype.params, ...options }
    const variant = typeof params.variant === 'object' ? params.variant : prototype.variants?.find(item => item.id === params.variant)
    Object.assign(params,variant?.params || {})
    if (prototype.category === 'building') {
      const type = Number(params.atlasType || params.type || prototype.id.match(/(?:house|villa)(\d+)/)?.[1] || 21)
      const model=Number(params.model || 1)
      const previewFootprint=ROUND_FACADE_VARIANTS.includes(`${type}:${model}`)
        ? Array.from({length:25},(_,i)=>[10*Math.cos(i/24*Math.PI*2),10*Math.sin(i/24*Math.PI*2)])
        : [[-12,-8],[12,-8],[12,8],[-12,8],[-12,-8]]
      return this.createBuilding({ polygon:params.polygon || params.footprint || previewFootprint,
        ...(params.holes ? {holes:params.holes} : {}),
        levels:params.levels || 3, height_m:params.height_m || params.height || (params.levels || 3)*(params.storeyHeight || 3.2) },
      {type,model,moduleWidth:Number(params.moduleWidth || 8)})
    }
    const subtype = params.decorationSet || prototype.subtype
    const keys = params.atlasKeys || YULAN_DECORATION_SETS[subtype] || YULAN_DECORATION_SETS.planter
    const key = params.atlasKey || keys[Number(params.model || 1)-1] || keys[0]
    return this.createDecoration(key,params)
  }

  dispose() {
    if(this.disposed)return
    this.disposed=true
    for(const texture of this.textures.values())texture.dispose()
    for(const material of this.materials.values())material.dispose()
    if(this.ownsImages)for(const image of this.assets?.images || [])image.close?.()
    this.textures.clear();this.materials.clear()
  }
}
