import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { pointInRing, segmentDistance } from './campus3dEnvironmentModel.js'

const MAX_PEOPLE = 128

function personGeometry() {
  const parts = [
    new THREE.SphereGeometry(.22, 8, 5).translate(0, 1.56, 0),
    new THREE.CylinderGeometry(.31, .23, .66, 7).translate(0, 1.03, 0),
    new THREE.BoxGeometry(.17, .67, .22).translate(-.14, .36, 0),
    new THREE.BoxGeometry(.17, .67, .22).translate(.14, .36, 0),
  ]
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return geometry
}

function placePeople(building, count) {
  if (!count) return { points: [], scale: 1 }
  const outline = building.polygon
  const holes = building.holes || []
  const rings = [outline, ...holes]
  const x = outline.map(point => point[0])
  const y = outline.map(point => point[1])
  const minX = Math.min(...x), minY = Math.min(...y)
  const width = Math.max(...x) - minX, depth = Math.max(...y) - minY
  if (width <= 0 || depth <= 0) return { points: [], scale: 1 }
  let candidates = []
  let scale = 1
  for (const density of [2, 4, 8]) {
    const columns = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(count * density * width / depth))))
    const rows = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(count * density * depth / width))))
    const dx = width / columns, dy = depth / rows
    scale = Math.min(2.4, Math.min(dx, dy), building.height_m / 2.6)
    const margin = scale * .34
    candidates = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const point = { x: minX + (column + .5) * dx, y: minY + (row + .5) * dy }
        if (!pointInRing(point, outline) || holes.some(ring => pointInRing(point, ring))) continue
        const nearWall = rings.some(ring => ring.some((p, index) =>
          segmentDistance(point, p, ring[(index + 1) % ring.length]) < margin))
        if (!nearWall) candidates.push(point)
      }
    }
    if (candidates.length >= count) break
  }
  const length = Math.min(count, candidates.length)
  const points = Array.from({ length }, (_, i) => candidates[Math.floor((i + .5) * candidates.length / length)])
  return { points, scale }
}

/** Presentation-only indoor silhouettes. Source people and routing stay separate. */
export class Campus3DInteriorPreview {
  constructor(view, inspectableIds) {
    this.view = view
    this.inspectableIds = new Set(inspectableIds)
    this.buildingId = null
    this.group = new THREE.Group()
    this.group.name = 'indoor-cutaway-preview'
    this.group.visible = false
    this.shellMaterial = new THREE.MeshBasicMaterial({
      color: 0x75aeb4, transparent: true, opacity: .17, depthWrite: false,
    })
    this.figures = new THREE.InstancedMesh(personGeometry(), new THREE.MeshBasicMaterial(), MAX_PEOPLE)
    this.figures.count = 0
    this.figures.frustumCulled = false
    this.figures.userData.bloomOcclusion = false
    this.group.add(this.figures)
    view.scene.add(this.group)
  }

  show(mesh) {
    const building = mesh.userData.building
    const id = building?.osm_id
    if (!this.view.indoor || !this.inspectableIds.has(id)) return false
    if (this.buildingId === id) return true

    this.clear()
    this.buildingId = id
    this.mesh = mesh
    this.originalVisibility = this.view.yulanStyle?.savedVisibility?.get(mesh) ?? mesh.visible
    this.shell = new THREE.Mesh(mesh.geometry, this.shellMaterial)
    this.shell.position.copy(mesh.position)
    this.shell.quaternion.copy(mesh.quaternion)
    this.shell.scale.copy(mesh.scale)
    this.shell.userData.bloomOcclusion = false
    this.group.add(this.shell)
    this.group.visible = true
    this.view.yulanStyle?.setBuildingCutaway?.(id)
    this.view.environment?.setBuildingCutaway?.(id)
    mesh.visible = false
    const glow = this.view.indoorGlows?.get(id)
    if (glow) {
      this.glowWasVisible = glow.visible
      glow.visible = false
    }
    if (this.view.environment) this.view.environment.shadowDirty = true
    this.update()
    return true
  }

  update() {
    if (!this.mesh) return
    const ids = (this.view.indoor.snapshot.buildings[this.buildingId] || []).slice(0, MAX_PEOPLE)
    const key = ids.join('|')
    if (key === this.peopleKey) return
    this.peopleKey = key
    const { points, scale } = placePeople(this.mesh.userData.building, ids.length)
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    for (const [i, point] of points.entries()) {
      transform.position.set(point.x, this.mesh.position.y + .12, -point.y)
      transform.scale.setScalar(scale)
      transform.updateMatrix()
      this.figures.setMatrixAt(i, transform.matrix)
      this.figures.setColorAt(i, color.set(this.view.people.get(ids[i])?.color ?? 0x3888aa))
    }
    this.figures.count = points.length
    this.figures.instanceMatrix.needsUpdate = true
    if (this.figures.instanceColor) this.figures.instanceColor.needsUpdate = true
    this.view.invalidate()
  }

  clear() {
    if (!this.mesh) return
    this.view.yulanStyle?.setBuildingCutaway?.(null)
    this.view.environment?.setBuildingCutaway?.(null)
    this.mesh.visible = this.view.yulanStyle?.enabled ? false : this.originalVisibility
    const glow = this.view.indoorGlows?.get(this.buildingId)
    if (glow) glow.visible = Boolean(this.glowWasVisible)
    this.shell.removeFromParent()
    this.mesh = null
    this.shell = null
    this.buildingId = null
    this.glowWasVisible = false
    this.peopleKey = null
    this.figures.count = 0
    this.group.visible = false
    if (this.view.environment) this.view.environment.shadowDirty = true
    this.view.invalidate()
  }

  dispose() {
    this.clear()
    this.group.removeFromParent()
    this.figures.dispose()
    this.figures.geometry.dispose()
    this.figures.material.dispose()
    this.shellMaterial.dispose()
  }
}
