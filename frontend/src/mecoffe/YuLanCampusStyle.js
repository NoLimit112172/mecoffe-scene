// Optional presentation only. Construction and init leave the accepted
// procedural campus visible; enabling this layer never writes to map data.
import * as THREE from 'three'
import { YuLanAssetFactory, disposeYuLanObject } from './YuLanAssetFactory.js'
import { ASSET_CATALOG } from './assetCatalog.js'
import { YULAN_DECORATION_SETS } from './yulanAssetModel.js'
import { TERRAIN_LEVELS } from './campus3dTerrain.js'
import { decorationVisibility } from './campus3dEnvironmentModel.js'

export class YuLanCampusStyle {
  constructor({ scene, campus, buildingMeshes, resolvePrototype, prototypes = [], environment = null,
    decorPlacements = null, resolveDecorationPrototype = null, sourceObjects = {} } = {}) {
    this.scene = scene
    this.campus = campus
    this.buildingMeshes = buildingMeshes
    this.resolvePrototype = resolvePrototype
    this.prototypes = prototypes.length ? prototypes : ASSET_CATALOG.prototypes
    this.environment = environment
    this.decorPlacements = decorPlacements || environment?.placements || {}
    this.resolveDecorationPrototype = resolveDecorationPrototype
    this.sourceObjects = { trees:environment?.trees, ...sourceObjects }
    this.quality = environment?.quality === 'low' ? 'low' : 'high'
    this.group = new THREE.Group()
    this.group.name = 'YuLan modular buildings (optional)'
    this.group.visible = false
    this.savedVisibility = new Map()
    this.savedDecorVisibility = new Map()
    this.decorationGroups = new Map()
    this.decorationBatches = []
    this.agentClearance = environment?.avoidance || {}
    this.enabled = false
    this.disposed = false
  }

  async init({ factory } = {}) {
    this.factory = factory || new YuLanAssetFactory()
    this.ownsFactory = !factory
    if (!factory) await this.factory.init()
    if (this.disposed) { if(this.ownsFactory)this.factory.dispose(); return this }
    for (const building of this.campus.buildings || []) {
      const mesh = this.buildingMeshes.get(building.osm_id)
      if (!mesh) continue
      const resolved = this.resolvePrototype?.(building) || this.prototypes.find(item => item.category === 'building' && item.style === 'yulan')
      const prototype = resolved?.prototype || resolved
      if (!prototype) throw new Error('A catalog YuLan building prototype is required')
      const params = {...prototype.params,...resolved.variant?.params}
      const type = Number(params.atlasType || params.type || prototype.id.match(/(?:house|villa)(\d+)/)?.[1])
      const model = Number(params.model || 1)
      const group = this.factory.createBuilding(building,{type,model,moduleWidth:Number(params.moduleWidth || 8)})
      group.position.y = mesh.position.y
      group.userData.requestedAssetPrototype = prototype.id
      group.userData.requestedAssetVariant = resolved.variant?.id || null
      const corrected=group.userData.facadeSelection
      group.userData.assetPrototype = corrected?.changed ? `building.yulan.${corrected.type<27?'house':'villa'}${corrected.type}` : prototype.id
      group.userData.assetVariant = corrected?.changed ? `model-${corrected.model}` : resolved.variant?.id || null
      group.userData.building = building
      this.group.add(group)
      this.savedVisibility.set(mesh,mesh.visible)
    }
    this.createDecorations()
    this.removeClearanceListener = this.environment?.onAgentClearance?.(value => this.setAgentClearance(value))
    this.setAgentClearance(this.agentClearance)
    this.scene.add(this.group)
    return this
  }

  createDecorations() {
    const sets = { trees:'tree_group', lamps:'lamp', benches:'bench' }
    for (const [kind,set] of Object.entries(sets)) {
      const sources = Array.isArray(this.sourceObjects[kind]) ? this.sourceObjects[kind] : [this.sourceObjects[kind]].filter(Boolean)
      const points = this.decorPlacements[kind] || []
      // Furniture is only replaced when its caller supplies an explicit source
      // container. Never hide the whole environment (sky, lights, surfaces).
      if (!sources.length || !points.length) continue
      const resolved = this.resolveDecorationPrototype?.(kind) || this.prototypes.find(item => item.style === 'yulan'
        && (item.params?.decorationSet === set || item.subtype === set))
      const prototype = resolved?.prototype || resolved
      if (!prototype) continue // Accepted procedural objects remain unchanged.
      const group = new THREE.Group()
      group.name = kind === 'trees' ? 'YuLan 体素景观砖（装饰）' : `YuLan voxel ${kind} (decorative)`
      group.userData.assetPrototype = prototype.id
      group.userData.source = prototype.source
      group.userData.license = prototype.license
      group.userData.illustrative = true
      group.userData.adaptation = 'Pixel landscape relief, not reconstructed hidden tree geometry'
      for(let variant=0;variant<3;variant++) {
        const selected = points.filter((point,index) => index%3 === variant)
        if(!selected.length)continue
        const params={...prototype.params,...prototype.variants?.[variant]?.params,...resolved.variant?.params}
        const keys=params.atlasKeys || YULAN_DECORATION_SETS[set]
        const key=params.atlasKey || keys[variant%keys.length]
        const template=this.factory.createDecoration(key,{height:Number(params.height || (kind==='trees'?7:kind==='lamps'?8:2.8)),
          depth:Number(params.depth || 3),resolution:Number(params.resolution || 32)})
        const source=template.children.find(child=>child.isMesh)
        if(!source) { disposeYuLanObject(template); throw new Error('YuLan decoration factory did not produce a mesh') }
        const batch=new THREE.InstancedMesh(source.geometry,source.material,selected.length)
        batch.name=`yulan-${kind}-variant-${variant+1}`
        batch.userData.atlasKey=key
        batch.userData.assetPrototype=prototype.id
        batch.castShadow=false
        batch.receiveShadow=true
        const dummy=new THREE.Object3D()
        for(const [index,point]of selected.entries()) {
          dummy.position.set(point.x,TERRAIN_LEVELS.campusGrass,-point.y)
          dummy.rotation.set(0,point.angle || 0,0)
          dummy.scale.setScalar(Number.isFinite(point.scale)?point.scale:1)
          dummy.updateMatrix()
          batch.setMatrixAt(index,dummy.matrix)
        }
        batch.instanceMatrix.needsUpdate=true
        batch.computeBoundingBox()
        batch.computeBoundingSphere()
        source.geometry.computeBoundingBox()
        const box = source.geometry.boundingBox
        const radius = Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z)))
        const matrices = selected.map((_, index) => { const matrix = new THREE.Matrix4(); batch.getMatrixAt(index, matrix); return matrix })
        this.decorationBatches.push({ mesh: batch, points: selected, matrices,
          radii: selected.map(point => radius * (point.scale || 1)), visible: null })
        group.add(batch)
      }
      this.group.add(group)
      this.decorationGroups.set(kind,group)
      for(const source of sources)this.savedDecorVisibility.set(source,{visible:source.visible,kind,
        qualityManaged:kind==='trees' && source===this.environment?.trees,qualityAtSave:this.quality})
    }
  }

  setVisible(enabled) {
    this.enabled = Boolean(enabled)
    this.group.visible = this.enabled
    for(const [mesh,visible] of this.savedVisibility)mesh.visible = this.enabled ? false : visible
    this.applyDecorationVisibility()
  }

  setAgentClearance(avoidance = {}) {
    this.agentClearance = avoidance
    const zero = new THREE.Vector3(0, 0, 0)
    for (const batch of this.decorationBatches) {
      const visible = decorationVisibility(batch.points, avoidance, batch.radii)
      let changed = false
      for (let i = 0; i < visible.length; i++) if (visible[i] !== batch.visible?.[i]) {
        batch.mesh.setMatrixAt(i, visible[i] ? batch.matrices[i] : batch.matrices[i].clone().scale(zero))
        changed = true
      }
      batch.visible = visible
      batch.mesh.userData.decorationVisibility = [...visible]
      if (changed) batch.mesh.instanceMatrix.needsUpdate = true
    }
  }

  applyDecorationVisibility() {
    for(const [kind,group]of this.decorationGroups)group.visible = kind!=='trees' || this.quality==='high'
    for(const [object,saved]of this.savedDecorVisibility) {
      const visibleWhenHigh=saved.visible || (saved.qualityManaged && saved.qualityAtSave==='low')
      object.visible = this.enabled ? false : visibleWhenHigh && (saved.kind!=='trees' || this.quality==='high')
    }
  }

  setQuality(quality) {
    this.quality=quality==='low'?'low':'high'
    this.applyDecorationVisibility()
  }

  setEnabled(enabled) { this.setVisible(enabled) }

  dispose() {
    if(this.disposed)return
    this.disposed=true
    this.setVisible(false)
    disposeYuLanObject(this.group)
    this.group.clear()
    this.savedVisibility.clear()
    this.savedDecorVisibility.clear()
    this.decorationGroups.clear()
    this.decorationBatches.length = 0
    this.removeClearanceListener?.()
    if(this.ownsFactory)this.factory?.dispose()
  }
}
