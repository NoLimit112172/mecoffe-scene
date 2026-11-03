// Three.js presentation layer. The OSM graph constrains the drawn trips only;
// neither the building assignments nor these animations are OASIS positions.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  createRouting, polygonCenter, resolveHomeKey, reverseRoute, routeBetweenMappings,
} from './campus3dRouting.js'

const BRAND_COLORS = [0x168b7a, 0xe17943, 0x6976bb, 0xb08c3d]
const ROLE_COLORS = {
  undergraduate_consumer: 0x4888bf,
  graduate_consumer: 0x8b6ab0,
  teacher_consumer: 0x4b9a83,
  merchant: 0xdc8a3e,
}
const WALK_SPEED_M_S = 100 // Playback speed, deliberately not a real walking speed.
const SHOP_DWELL_S = 0.85

function hash(value) {
  let result = 2166136261
  for (const ch of String(value)) result = Math.imul(result ^ ch.codePointAt(0), 16777619)
  return result >>> 0
}

function shapeOf(ring, holes = []) {
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

// The source has no verified entrances. Pick a point on the building outline
// facing its road anchor and move just outside it for IDLE presentation only.
// This does not add a graph edge or pretend that the building-to-road gap is a
// mapped footpath. Purchase animation still begins at the original OSM node.
function illustrativeEntrance(anchor) {
  const polygon = anchor.building.polygon
  const road = anchor.node
  let signedArea = 0
  let inside = false
  let closest = null
  let best = Infinity
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % polygon.length]
    signedArea += ax * by - bx * ay
    if ((ay > road.y) !== (by > road.y)
      && road.x < (bx - ax) * (road.y - ay) / (by - ay) + ax) inside = !inside
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    if (!length2) continue
    const t = Math.max(0, Math.min(1, ((road.x - ax) * dx + (road.y - ay) * dy) / length2))
    const point = { x: ax + t * dx, y: ay + t * dy }
    const distance = Math.hypot(road.x - point.x, road.y - point.y)
    if (distance < best) {
      best = distance
      closest = { ...point, dx, dy, edgeLength: Math.sqrt(length2) }
    }
  }
  if (!closest) throw new Error(`楼栋 ${anchor.building.osm_id} 没有有效轮廓边`)
  const orientation = signedArea >= 0 ? 1 : -1
  const outward = !inside && best > 1e-8
    ? { x: (road.x - closest.x) / best, y: (road.y - closest.y) / best }
    : { x: orientation * closest.dy / closest.edgeLength, y: -orientation * closest.dx / closest.edgeLength }
  return {
    x: closest.x + outward.x * 5,
    y: closest.y + outward.y * 5,
    outline: { x: closest.x, y: closest.y },
    outward,
    tangent: { x: closest.dx / closest.edgeLength, y: closest.dy / closest.edgeLength },
    illustrative: true,
  }
}

function disposeObject(object) {
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material) continue
      materials.add(material)
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
}

function labelSprite(content, { color = '#334e59', background = '#ffffff', height = 12 } = {}) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const font = '600 32px "Microsoft YaHei",sans-serif'
  context.font = font
  canvas.width = Math.ceil(context.measureText(content).width + 36)
  canvas.height = 58
  context.font = font
  context.fillStyle = background
  context.globalAlpha = 0.94
  context.beginPath()
  context.roundRect(0, 0, canvas.width, canvas.height, 12)
  context.fill()
  context.globalAlpha = 1
  context.fillStyle = color
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(content, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.scale.set(height * canvas.width / canvas.height, height, 1)
  sprite.renderOrder = 5
  return sprite
}

// Batch the road ribbons so hundreds of OSM segments do not each add a draw call.
function roadGeometry(roads, extraWidth = 0, elevation = 0.14) {
  const vertices = []
  const triangle = (a, b, c) => vertices.push(...a, ...b, ...c)
  for (const road of roads) {
    const points = road.points || []
    const path = ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(road.highway)
    const radius = (path ? 2.5 : 6) / 2 + extraWidth
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      const length = Math.hypot(bx - ax, by - ay)
      if (!length) continue
      const nx = -(by - ay) / length * radius
      const ny = (bx - ax) / length * radius
      const a = [ax + nx, elevation, -(ay + ny)]
      const b = [bx + nx, elevation, -(by + ny)]
      const c = [bx - nx, elevation, -(by - ny)]
      const d = [ax - nx, elevation, -(ay - ny)]
      triangle(a, b, c)
      triangle(a, c, d)
    }
    for (const [x, y] of points) {
      for (let i = 0; i < 8; i += 1) {
        const a = i / 8 * Math.PI * 2
        const b = (i + 1) / 8 * Math.PI * 2
        triangle([x, elevation, -y], [x + Math.cos(a) * radius, elevation, -y + Math.sin(a) * radius],
          [x + Math.cos(b) * radius, elevation, -y + Math.sin(b) * radius])
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

export class Campus3DScene {
  constructor({ host, campus, mapping, index, onHover, onSelect, onStats } = {}) {
    this.host = host
    this.campus = campus
    this.mapping = mapping
    this.index = index
    this.onHover = onHover
    this.onSelect = onSelect
    this.onStats = onStats
    this.routing = createRouting(campus, mapping)
    this.people = new Map()
    this.buildingMeshes = new Map()
    this.pickTargets = []
    this.walkers = new Set()
    this.effects = []
    this.seenOrders = new Set()
    this.playing = false
    this.speed = 1
    this.unreachable = 0
    this.selectedId = null
    this.disposed = false
    this.brandColors = new Map(index.scene.brands.map((brand, k) => [brand.brand_id, BRAND_COLORS[k % BRAND_COLORS.length]]))
  }

  async init() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xeaf0ef)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.renderer.domElement.setAttribute('aria-label', '中科大高新校区三维体块场景，可拖动旋转、滚轮缩放，点击人物查看记录')
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.host.appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 15000)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.minDistance = 18
    this.scene.add(new THREE.HemisphereLight(0xf6fcff, 0xa4b398, 1.65))
    const sun = new THREE.DirectionalLight(0xfff5e5, 1.5)
    sun.position.set(-350, 800, 250)
    this.scene.add(sun)
    this.routeLayer = new THREE.Group()
    this.effectLayer = new THREE.Group()
    this.relationLayer = new THREE.Group()
    this.scene.add(this.routeLayer, this.effectLayer, this.relationLayer)
    this.drawCampus()
    this.placePeople()
    this.resetCamera()
    this.resize()
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.handlers = {
      pointermove: event => this.pick(event, false),
      pointerleave: () => this.clearHover(),
      pointerdown: event => { this.pointerDown = { x: event.clientX, y: event.clientY } },
      click: event => {
        if (!this.pointerDown || Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) < 6) this.pick(event, true)
      },
    }
    for (const [type, handler] of Object.entries(this.handlers)) this.renderer.domElement.addEventListener(type, handler)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.host)
    this.lastTime = performance.now()
    const animate = now => {
      if (this.disposed) return
      const delta = Math.min((now - this.lastTime) / 1000, 0.12)
      this.lastTime = now
      if (this.playing) {
        this.updateWalkers(delta * this.speed)
        this.updateEffects(delta * this.speed)
      }
      this.controls.update()
      this.updateRelations()
      this.renderer.render(this.scene, this.camera)
      this.frame = requestAnimationFrame(animate)
    }
    this.frame = requestAnimationFrame(animate)
    this.emitStats()
    return this
  }

  drawCampus() {
    const polygons = this.campus.boundary_polygons?.length
      ? this.campus.boundary_polygons : [{ outer: this.campus.boundary, holes: [] }]
    const coordinates = [
      ...polygons.flatMap(polygon => polygon.outer),
      ...this.campus.buildings.flatMap(building => building.polygon),
      ...this.campus.roads.flatMap(road => road.points),
    ]
    const xs = coordinates.map(point => point[0])
    const ys = coordinates.map(point => point[1])
    this.bounds = {
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    }
    const { minX, maxX, minY, maxY } = this.bounds
    const width = maxX - minX
    const height = maxY - minY
    this.span = Math.max(width, height, 100)
    this.center = new THREE.Vector3((minX + maxX) / 2, 0, -(minY + maxY) / 2)
    this.controls.maxDistance = this.span * 5
    const base = new THREE.Mesh(new THREE.PlaneGeometry(width + 120, height + 120),
      new THREE.MeshStandardMaterial({ color: 0xe7e9dd, roughness: 1 }))
    base.rotation.x = -Math.PI / 2
    base.position.copy(this.center)
    base.position.y = -0.15
    this.scene.add(base)
    for (const polygon of polygons) {
      if (!polygon.outer?.length) continue
      const ground = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(polygon.outer, polygon.holes)),
        new THREE.MeshStandardMaterial({ color: 0xcbdcbe, side: THREE.DoubleSide, roughness: 1 }))
      ground.rotation.x = -Math.PI / 2
      ground.position.y = 0
      this.scene.add(ground)
      const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(polygon.outer.map(([x, y]) => new THREE.Vector3(x, 0.28, -y))),
        new THREE.LineDashedMaterial({ color: 0x6c917d, dashSize: 7, gapSize: 4, transparent: true, opacity: 0.8 }))
      border.computeLineDistances()
      this.scene.add(border)
    }
    this.scene.add(new THREE.Mesh(roadGeometry(this.campus.roads, 0.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x87998b, roughness: 1, side: THREE.DoubleSide })))
    this.scene.add(new THREE.Mesh(roadGeometry(this.campus.roads),
      new THREE.MeshStandardMaterial({ color: 0xe7d9b9, roughness: 1, side: THREE.DoubleSide })))
    const mapped = new Map()
    for (const [key, entry] of Object.entries(this.mapping.mappings)) {
      if (!mapped.has(entry.osm_id)) mapped.set(entry.osm_id, [])
      mapped.get(entry.osm_id).push(key)
    }
    for (const building of this.campus.buildings) {
      const keys = mapped.get(building.osm_id) || []
      const name = building.name || `OSM 楼栋 ${building.osm_id}`
      let color = 0xa6b8bf
      if (/宿舍|[1-8]号楼/.test(name) || keys.some(key => /dorm|apartment/.test(key))) color = 0xd1b691
      if (/学科|教学/.test(name) || keys.includes('teaching_main')) color = 0x8daec6
      if (/图书/.test(name) || keys.includes('library_main')) color = 0xafa3c2
      if (/体育|运动/.test(name)) color = 0x96b8b0
      if (keys.includes('faculty_main')) color = 0x8fb6a7
      const roof = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25)
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(building.polygon), {
        depth: building.height_m, bevelEnabled: false, steps: 1,
      }), [new THREE.MeshStandardMaterial({ color: roof, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color, roughness: 0.95 })])
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.18
      mesh.userData.building = building
      this.scene.add(mesh)
      this.pickTargets.push(mesh)
      this.buildingMeshes.set(building.osm_id, mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30),
        new THREE.LineBasicMaterial({ color: 0x5e7781, transparent: true, opacity: 0.35 }))
      mesh.add(edges)
      if (building.name) {
        const center = polygonCenter(building.polygon)
        const label = labelSprite(building.name, { height: 11 })
        label.position.set(center.x, building.height_m + 7, -center.y)
        this.scene.add(label)
      }
    }
    this.shopMarkers = new Map()
    for (const [brandId, color] of this.brandColors) {
      const anchor = this.routing.anchors.get(`shop_${brandId}`)
      if (!anchor) continue
      const marker = new THREE.Group()
      const ring = new THREE.Mesh(new THREE.RingGeometry(6, 8, 32),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }))
      ring.rotation.x = -Math.PI / 2
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 13, 8), new THREE.MeshStandardMaterial({ color }))
      pin.position.y = 6.5
      const ball = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8), new THREE.MeshStandardMaterial({ color }))
      ball.position.y = 14
      marker.add(ring, pin, ball)
      marker.position.set(anchor.node.x, 0.4, -anchor.node.y)
      const shopIndex = [...this.brandColors.keys()].indexOf(brandId)
      const letter = String.fromCharCode(65 + shopIndex)
      const label = labelSprite(`门店 ${letter} · 接路点`, {
        color: `#${color.toString(16).padStart(6, '0')}`, height: 13,
      })
      label.position.y = 27
      marker.add(label)
      this.scene.add(marker)
      this.shopMarkers.set(brandId, marker)
      const buildingLabel = labelSprite(`门店 ${letter} · 示意楼栋`, {
        color: `#${color.toString(16).padStart(6, '0')}`, height: 12,
      })
      buildingLabel.position.set(anchor.center.x, anchor.building.height_m + 23, -anchor.center.y)
      this.scene.add(buildingLabel)
    }
    const north = labelSprite('N ↑', { color: '#3a685a', height: 20, background: '#e7efe8' })
    north.position.set(maxX + 28, 8, -maxY + 35)
    this.scene.add(north)
  }

  placePeople() {
    const groups = new Map()
    const sorted = [...this.index.people.values()].sort((a, b) => a.id.localeCompare(b.id))
    for (const person of sorted) {
      const key = resolveHomeKey(person)
      if (!this.routing.anchors.has(key)) throw new Error(`人物 ${person.id} 的地点 ${key} 缺少真实楼栋映射`)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(person)
    }
    for (const [key, people] of groups) {
      const anchor = this.routing.anchors.get(key)
      const entrance = illustrativeEntrance(anchor)
      const columns = Math.min(8, Math.ceil(Math.sqrt(people.length * 1.4)))
      people.forEach((person, k) => {
        const row = Math.floor(k / columns)
        const rowCount = Math.min(columns, people.length - row * columns)
        const across = (k % columns - (rowCount - 1) / 2) * 3.8
        const out = row * 3.8
        const home = {
          x: entrance.x + entrance.tangent.x * across + entrance.outward.x * out,
          y: entrance.y + entrance.tangent.y * across + entrance.outward.y * out,
        }
        const color = person.role === 'merchant'
          ? this.brandColors.get(person.id) || ROLE_COLORS.merchant
          : ROLE_COLORS[person.role] || 0x6587a7
        const figure = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.45, 3.3, 3, 7),
          new THREE.MeshStandardMaterial({ color, roughness: 0.85 }))
        body.position.y = 3.2
        const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0xf0d4b9, roughness: 0.9 }))
        head.position.y = 7.2
        const base = new THREE.Mesh(new THREE.CircleGeometry(2.6, 12),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }))
        base.rotation.x = -Math.PI / 2
        base.position.y = 0.05
        const hit = new THREE.Mesh(new THREE.SphereGeometry(4, 6, 4),
          new THREE.MeshBasicMaterial({ visible: false }))
        hit.position.y = 4.5
        for (const child of [body, head, hit]) child.userData.person = person
        figure.add(base, body, head, hit)
        figure.position.set(home.x, 0.35, -home.y)
        this.scene.add(figure)
        this.pickTargets.push(hit)
        this.people.set(person.id, { person, key, anchor, entrance, home, figure, body, color, queue: [], walker: null })
      })
    }
    this.selection = new THREE.Mesh(new THREE.RingGeometry(4.1, 5.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffbd49, side: THREE.DoubleSide, depthTest: false }))
    this.selection.rotation.x = -Math.PI / 2
    this.selection.visible = false
    this.selection.renderOrder = 4
    this.scene.add(this.selection)
  }

  setCursor(cursor) {
    this.seenOrders.clear()
    for (const event of this.index.scene.events.slice(0, Math.max(0, cursor))) {
      if (event.type === 'purchase') this.seenOrders.add(event.order_id || event.key)
    }
    this.walkers.clear()
    this.unreachable = 0
    for (const entry of this.people.values()) {
      entry.queue.length = 0
      entry.walker = null
      entry.figure.position.set(entry.home.x, 0.35, -entry.home.y)
      entry.body.position.y = 3.2
    }
    this.clearLayer(this.routeLayer)
    this.clearLayer(this.effectLayer)
    this.effects = []
    this.updateSelection()
    this.emitStats()
  }

  playEvent(event) {
    const entry = this.people.get(event.actor)
    if (!entry) return
    if (event.type === 'purchase') {
      const order = event.order_id || event.key
      if (this.seenOrders.has(order)) return
      this.seenOrders.add(order)
      const route = routeBetweenMappings(this.routing, entry.key, `shop_${event.brand_id}`)
      if (!route) {
        this.unreachable += 1
        this.emitStats()
        return
      }
      entry.queue.push({ event, route })
      if (!entry.walker) this.startNextTrip(entry)
      this.emitStats()
    } else if (['ad', 'post', 'comment', 'follow', 'exposure', 'interview'].includes(event.type)) {
      const color = event.type === 'ad' ? 0xe6a545 : event.type === 'comment' ? 0x9b73ba : 0x72a9c9
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.1, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
      ring.rotation.x = -Math.PI / 2
      ring.position.copy(entry.figure.position)
      ring.position.y = 0.7
      this.effectLayer.add(ring)
      this.effects.push({ ring, life: 0, duration: 1.2 })
    }
  }

  startNextTrip(entry) {
    const next = entry.queue.shift()
    if (!next) return
    const material = new THREE.LineBasicMaterial({ color: this.brandColors.get(next.event.brand_id) || 0xe17943, transparent: true, opacity: 0.75 })
    const routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(next.route.points.map(point => new THREE.Vector3(point.x, 0.65, -point.y))), material)
    this.routeLayer.add(routeLine)
    entry.walker = { ...next, phase: 'outbound', points: next.route.points, nextPoint: 1, dwell: 0, line: routeLine }
    const start = next.route.points[0]
    entry.figure.position.set(start.x, 0.35, -start.y)
    this.walkers.add(entry.person.id)
  }

  updateWalkers(delta) {
    let changed = false
    for (const id of [...this.walkers]) {
      const entry = this.people.get(id)
      const walker = entry.walker
      if (!walker) continue
      if (walker.phase === 'dwell') {
        walker.dwell += delta
        if (walker.dwell >= SHOP_DWELL_S) {
          walker.phase = 'return'
          walker.points = reverseRoute(walker.route).points
          walker.nextPoint = 1
        }
        continue
      }
      let movement = WALK_SPEED_M_S * delta
      while (walker.nextPoint < walker.points.length && movement > 0) {
        const point = walker.points[walker.nextPoint]
        const dx = point.x - entry.figure.position.x
        const dz = -point.y - entry.figure.position.z
        const distance = Math.hypot(dx, dz)
        if (distance <= movement) {
          entry.figure.position.x = point.x
          entry.figure.position.z = -point.y
          movement -= distance
          walker.nextPoint += 1
        } else {
          entry.figure.position.x += dx / distance * movement
          entry.figure.position.z += dz / distance * movement
          movement = 0
        }
        if (distance > 0) entry.figure.rotation.y = Math.atan2(dx, dz)
      }
      entry.body.position.y = 3.2 + Math.sin(performance.now() / 80 + hash(id)) * 0.22
      if (walker.nextPoint >= walker.points.length) {
        if (walker.phase === 'outbound') {
          walker.phase = 'dwell'
          walker.dwell = 0
        } else {
          this.routeLayer.remove(walker.line)
          disposeObject(walker.line)
          entry.walker = null
          this.walkers.delete(id)
          entry.figure.position.set(entry.home.x, 0.35, -entry.home.y)
          entry.body.position.y = 3.2
          this.startNextTrip(entry)
          changed = true
        }
      }
    }
    this.updateSelection()
    if (changed) this.emitStats()
  }

  updateEffects(delta) {
    this.effects = this.effects.filter(effect => {
      effect.life += delta
      const progress = effect.life / effect.duration
      if (progress >= 1) {
        this.effectLayer.remove(effect.ring)
        disposeObject(effect.ring)
        return false
      }
      effect.ring.scale.setScalar(1 + progress * 3)
      effect.ring.material.opacity = (1 - progress) * 0.8
      return true
    })
  }

  selectPerson(id) {
    this.selectedId = this.people.has(id) ? id : null
    this.updateSelection()
    this.clearLayer(this.relationLayer)
    const selected = this.people.get(this.selectedId)
    if (!selected) return
    for (const relation of this.index.scene.relationships || []) {
      if (relation.source !== id && relation.target !== id) continue
      const otherId = relation.source === id ? relation.target : relation.source
      if (!this.people.has(otherId)) continue
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()])
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: relation.source === id ? 0x4c8ba6 : 0xb49b61, transparent: true, opacity: 0.55,
      }))
      line.userData.people = [id, otherId]
      this.relationLayer.add(line)
    }
  }

  updateRelations() {
    for (const line of this.relationLayer.children) {
      const [a, b] = line.userData.people.map(id => this.people.get(id)?.figure.position)
      if (!a || !b) continue
      const positions = line.geometry.attributes.position
      positions.setXYZ(0, a.x, 8, a.z)
      positions.setXYZ(1, (a.x + b.x) / 2, 20 + Math.min(a.distanceTo(b) * 0.1, 50), (a.z + b.z) / 2)
      positions.setXYZ(2, b.x, 8, b.z)
      positions.needsUpdate = true
      line.geometry.computeBoundingSphere()
    }
  }

  updateSelection() {
    if (!this.selection) return
    const selected = this.people.get(this.selectedId)
    this.selection.visible = Boolean(selected)
    if (selected) this.selection.position.set(selected.figure.position.x, 0.9, selected.figure.position.z)
  }

  pick(event, select) {
    if (this.disposed || !this.raycaster) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0]
    this.clearHoveredBuilding()
    if (!hit) {
      this.renderer.domElement.style.cursor = 'grab'
      this.onHover?.(null)
      return
    }
    const { person, building } = hit.object.userData
    this.renderer.domElement.style.cursor = person ? 'pointer' : 'grab'
    if (person) {
      const entry = this.people.get(person.id)
      this.onHover?.({ type: 'person', name: person.name, person,
        placement: { illustrative: true, building_name: entry.anchor.building.name, entrance: entry.entrance,
          road_node_id: entry.anchor.node.id }, x: event.clientX, y: event.clientY })
      if (select) {
        this.selectPerson(person.id)
        this.onSelect?.(person.id)
      }
    } else if (building) {
      this.hoveredBuilding = hit.object
      for (const material of hit.object.material) material.emissive.setHex(0x112b28)
      this.onHover?.({ type: 'building', name: building.name || `OSM ${building.osm_id}`, building, x: event.clientX, y: event.clientY })
    }
  }

  clearHoveredBuilding() {
    if (this.hoveredBuilding) {
      for (const material of this.hoveredBuilding.material) material.emissive.setHex(0)
      this.hoveredBuilding = null
    }
  }

  clearHover() {
    this.clearHoveredBuilding()
    this.onHover?.(null)
  }

  getStats() {
    return { active: this.walkers.size, queued: [...this.people.values()].reduce((sum, entry) => sum + entry.queue.length, 0), unreachable: this.unreachable }
  }

  emitStats() { this.onStats?.(this.getStats()) }
  isWalking(id) { return this.walkers.has(id) }
  setPlaying(playing) { this.playing = Boolean(playing) }
  setSpeed(speed) { this.speed = Number.isFinite(Number(speed)) ? Math.max(0.1, Math.min(20, Number(speed))) : 1 }

  resetCamera() {
    if (!this.camera) return
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight)
    this.camera.aspect = Math.max(aspect, 0.05)
    this.camera.zoom = 1
    this.camera.updateProjectionMatrix()
    const maxHeight = Math.max(...this.campus.buildings.map(building => building.height_m), 1) + 40
    const target = this.center.clone()
    target.y = maxHeight * 0.25
    const direction = new THREE.Vector3(0.22, 0.9, 0.85).normalize()
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize()
    const up = new THREE.Vector3().crossVectors(direction, right).normalize()
    const tanVertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const tanHorizontal = tanVertical * this.camera.aspect
    let distance = 20
    // Fit the eight corners in camera space. A span multiplier misses the front
    // (southern) edge at low camera angles and on narrow screens.
    for (const x of [this.bounds.minX - 35, this.bounds.maxX + 35]) {
      for (const z of [-this.bounds.maxY - 35, -this.bounds.minY + 35]) {
        for (const y of [0, maxHeight]) {
          const offset = new THREE.Vector3(x, y, z).sub(target)
          distance = Math.max(distance, offset.dot(direction)
            + Math.max(Math.abs(offset.dot(right)) / tanHorizontal, Math.abs(offset.dot(up)) / tanVertical))
        }
      }
    }
    distance *= 1.1
    this.controls.maxDistance = Math.max(this.span * 5, distance * 2)
    this.controls.target.copy(target)
    this.camera.position.copy(target).addScaledVector(direction, distance)
    this.controls.update()
  }

  resize() {
    if (!this.renderer || this.disposed) return
    const width = Math.max(this.host.clientWidth, 1)
    const height = Math.max(this.host.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  clearLayer(layer) {
    if (!layer) return
    for (const child of [...layer.children]) {
      layer.remove(child)
      disposeObject(child)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.frame) cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.controls?.dispose()
    this.clearHover()
    if (this.scene) {
      disposeObject(this.scene)
      this.scene.clear()
    }
    if (this.renderer) {
      for (const [type, handler] of Object.entries(this.handlers || {})) this.renderer.domElement.removeEventListener(type, handler)
      this.renderer.renderLists.dispose()
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      this.renderer.domElement.remove()
    }
    this.people.clear()
    this.walkers.clear()
    this.buildingMeshes.clear()
    this.pickTargets.length = 0
    this.effects.length = 0
  }
}
