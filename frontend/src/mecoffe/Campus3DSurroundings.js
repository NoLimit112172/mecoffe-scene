import * as THREE from 'three'
import { contextRoads, roadNameLabels, roadStyle } from './campus3dRoadModel.js'
import { TERRAIN_LEVELS as L } from './campus3dTerrain.js'

function ribbon(vertices, points, width, height) {
  const radius = width / 2
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!length) continue
    const nx = -(b[1] - a[1]) / length * radius, ny = (b[0] - a[0]) / length * radius
    const p = [a[0] + nx, height, -(a[1] + ny)], q = [b[0] + nx, height, -(b[1] + ny)]
    const r = [b[0] - nx, height, -(b[1] - ny)], s = [a[0] - nx, height, -(a[1] - ny)]
    vertices.push(...p, ...q, ...r, ...p, ...r, ...s)
  }
  for (const [x, y] of points) for (let i = 0; i < 10; i += 1) {
    const a = i / 10 * Math.PI * 2, b = (i + 1) / 10 * Math.PI * 2
    vertices.push(x, height, -y, x + Math.cos(a) * radius, height, -(y + Math.sin(a) * radius),
      x + Math.cos(b) * radius, height, -(y + Math.sin(b) * radius))
  }
}

function solidRibbon(vertices,points,width,bottom,top,offset=0) {
  const triangle=(a,b,c)=>vertices.push(...a,...b,...c)
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue
    const nx=-(b[1]-a[1])/length,ny=(b[0]-a[0])/length
    const ring=[[a[0]+nx*(offset-width/2),a[1]+ny*(offset-width/2)],[b[0]+nx*(offset-width/2),b[1]+ny*(offset-width/2)],
      [b[0]+nx*(offset+width/2),b[1]+ny*(offset+width/2)],[a[0]+nx*(offset+width/2),a[1]+ny*(offset+width/2)]]
    const hi=ring.map(([x,y])=>[x,top,-y]),lo=ring.map(([x,y])=>[x,bottom,-y])
    triangle(hi[0],hi[1],hi[2]);triangle(hi[0],hi[2],hi[3])
    for(let j=0;j<4;j++){const k=(j+1)%4;triangle(hi[j],lo[j],lo[k]);triangle(hi[j],lo[k],hi[k])}
  }
  if(offset===0)ribbon(vertices,points,width,top)
}

function marks(vertices, points, offset, { dashed = false, height = L.externalRoad+.025, width = .24 } = {}) {
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!length) continue
    const dx = (b[0] - a[0]) / length, dy = (b[1] - a[1]) / length
    const point = t => [a[0] + dx * t - dy * offset, a[1] + dy * t + dx * offset]
    if (dashed) {
      for (let at = -walked % 12; at < length; at += 12) {
        const start = Math.max(0, at), end = Math.min(length, at + 6)
        if (end > start) ribbon(vertices, [point(start), point(end)], width, height)
      }
    } else ribbon(vertices, [point(0), point(length)], width, height)
    walked += length
  }
}

function mesh(vertices, material) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  const object = new THREE.Mesh(geometry, material)
  object.receiveShadow = true
  return object
}

export class Campus3DSurroundings {
  constructor({ scene, roads = [], displayBounds, campus, host }) {
    this.scene = scene
    this.host = host
    this.roads = contextRoads(roads, displayBounds, campus, 115)
    this.labels = roadNameLabels(this.roads)
    this.group = new THREE.Group()
    this.group.name = 'OSM surrounding roads (display only, excluded from A*)'
    this.geometry = []
    this.materials = []
    this.lastMatrix = new THREE.Matrix4()
    this.lastProjection = new THREE.Matrix4()
    this.size = {}
  }

  init() {
    const layers = { sidewalk: [], curb: [], asphalt: [], white: [], yellow: [], tunnel: [] }
    for (const road of this.roads) {
      const style = roadStyle(road)
      if (style.tunnel) {
        // Underground OSM ways are shown as a faint centre trace, with no
        // fabricated surface pavement, kerbs or pedestrian facilities.
        marks(layers.tunnel, road.points, 0, { dashed: true, width: .6, height: L.outsideTop+.035 })
        continue
      }
      // Sidewalks/kerbs are separate side volumes; no full-width raised plane
      // can cover the lower carriageway. All thicknesses are display defaults.
      for(const side of [-1,1]) {
        if(style.sidewalk)solidRibbon(layers.sidewalk,road.points,style.sidewalk,L.externalRoadBottom,L.externalSidewalk,side*(style.width/2+.35+style.sidewalk/2))
        solidRibbon(layers.curb,road.points,.35,L.externalRoadBottom,L.externalCurb,side*(style.width/2+.175))
      }
      solidRibbon(layers.asphalt,road.points,style.width,L.externalRoadBottom,L.externalRoad)
      for (const side of [-1, 1]) marks(layers.white, road.points, side * (style.width / 2 - .28), { width: .2 })
      for (let lane = 1; lane < style.lanes; lane += 1) {
        const centre = !style.oneWay && lane === Math.ceil(style.lanes / 2)
        marks(centre ? layers.yellow : layers.white, road.points, -style.width / 2 + style.width * lane / style.lanes,
          { dashed: !centre, width: centre ? .32 : .22 })
      }
    }
    for (const [name, vertices] of Object.entries(layers)) {
      if (!vertices.length) continue
      const color = { sidewalk: '#b9c0b9', curb: '#e0e2d5', asphalt: '#444c52', white: '#e5e8df', yellow: '#e9c45a', tunnel: '#a8b0b5' }[name]
      const material = name === 'tunnel'
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color, roughness: .96, depthWrite: !['white','yellow'].includes(name), side: THREE.DoubleSide,
          ...(['white','yellow'].includes(name)?{polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}:{}) })
      const object = mesh(vertices, material)
      // Side volumes now have meaningful height separation and write depth.
      // Markings remain above their road surface and retain depth tests.
      object.renderOrder = { sidewalk: 2, curb: 3, asphalt: 4, white: 5, yellow: 5, tunnel: 6 }[name]
      object.name = `surrounding-${name}`
      object.userData.surroundingRoadLayer = name
      this.materials.push(material)
      this.geometry.push(object.geometry)
      this.group.add(object)
    }
    this.scene.add(this.group)
    if (this.host && typeof document !== 'undefined') {
      this.labelLayer = document.createElement('div')
      this.labelLayer.className = 'campus3d-road-labels'
      Object.assign(this.labelLayer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '3' })
      this.host.appendChild(this.labelLayer)
      for (const label of this.labels) {
        const element = document.createElement('div')
        element.textContent = label.name
        element.setAttribute('data-road-name', label.name)
        element.setAttribute('data-road-osm-id', label.osm_id)
        element.title = `OpenStreetMap name: ${label.name}`
        Object.assign(element.style, { position: 'absolute', display: 'none', padding: '4px 9px',
          background: '#204f60ed', color: '#fffef0', border: '1px solid #f5f4e1', borderRadius: '4px',
          boxShadow: '0 1px 4px #102c3a44', font: '600 12px/17px "Microsoft YaHei",sans-serif', whiteSpace: 'nowrap', pointerEvents: 'none' })
        this.labelLayer.appendChild(element)
        label.element = element
      }
    }
    return this
  }

  update(camera, host = this.host) {
    if (this.disposed || !host || !this.labelLayer) return
    camera.updateMatrixWorld()
    const width = host.clientWidth, height = host.clientHeight
    if (this.size.width === width && this.size.height === height && this.lastMatrix.equals(camera.matrixWorld) && this.lastProjection.equals(camera.projectionMatrix)) return
    this.lastMatrix.copy(camera.matrixWorld)
    this.lastProjection.copy(camera.projectionMatrix)
    this.size = { width, height }
    const rect = host.getBoundingClientRect()
    const occupied = [...host.querySelectorAll('[data-campus-label],[data-person-name]')].filter(element => element.style.display !== 'none')
      .map(element => { const r = element.getBoundingClientRect(); return { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height } })
    for (const label of this.labels) {
      const point = new THREE.Vector3(label.x, L.externalRoad+3, -label.y).project(camera)
      const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1
      label.element.style.display = visible ? 'block' : 'none'
      if (!visible) continue
      const w = label.name.length * 12 + 20, h = 27
      const x = (point.x + 1) * width / 2 - w / 2, y = (1 - point.y) * height / 2 - h / 2
      let placement
      for (const [dx, dy] of [[0, 0], [0, -30], [0, 30], [-25, -52], [25, 52]]) {
        const candidate = { x: Math.min(width - w - 8, Math.max(8, x + dx)), y: Math.min(height - h - 8, Math.max(8, y + dy)), w, h }
        placement = candidate
        if (!occupied.some(r => candidate.x < r.x + r.w + 5 && candidate.x + w + 5 > r.x && candidate.y < r.y + r.h + 4 && candidate.y + h + 4 > r.y)) break
      }
      occupied.push(placement)
      label.element.style.left = `${placement.x}px`
      label.element.style.top = `${placement.y}px`
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.labelLayer?.remove()
    this.group.removeFromParent()
    for (const geometry of this.geometry) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.labels.length = 0
  }
}
