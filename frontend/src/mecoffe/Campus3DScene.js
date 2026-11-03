import {SpatialWorker} from './spatialWorker.js'
import {AdaptiveQuality,consolidateMaterialGroups,tripQueueEntries} from './renderPerformance.js'
// Three.js presentation layer. The OSM graph constrains the drawn trips only;
// neither the building assignments nor these animations are OASIS positions.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { prototypeParams, selectPrototype, getPrototype, campusBuildingPrototype } from './assetCatalog.js'
import {
  createRouting, polygonCenter, resolveHomeKey, reverseRoute, routeBetweenMappings,
} from './campus3dRouting.js'
import { campusBoundaryBounds, fitCampusView } from './campus3dView.js'
import { layoutLabels, personScaleForCamera } from './campus3dScreen.js'
import { CHARACTER_BASE_COLORS } from './characterDisplay.js'
import { Campus3DBase } from './Campus3DBase.js'
import { Campus3DSports } from './Campus3DSports.js'
import { sportsExclusions } from './campus3dSportsModel.js'
import { Campus3DWater } from './Campus3DWater.js'
import { Campus3DVegetation } from './Campus3DVegetation.js'
import { buildSpatialEnvironment, bridgeHeightAt } from './campus3dSpatial.js'
import { TERRAIN_LEVELS, terrainSurfaceHeight } from './campus3dTerrain.js'
import { DISPLAY_RADIUS, CROWD_GAP, standingSlots, stepSeparatedCrowd, displayRoutePoints, outsideBuildings, nearestClearPosition } from './campus3dCrowd.js'
import { displayCrowdDetour } from './campus3dDetour.js'
import { createDisplayCampus } from './campus3dDisplay.js'
import { Campus3DSurroundings } from './Campus3DSurroundings.js'
import { Campus3DEnvironment } from './Campus3DEnvironment.js'
import { EventEffects, SelectiveBloom } from './Campus3DEffects.js'
import { visualClock, idleRepresentatives, displayOccupancy } from './campus3dPresentation.js'

const BRAND_COLORS = prototypeParams('building.component.shop-sign').marker_colors.map(value=>parseInt(value.slice(1),16))
const ROLE_COLORS = Object.fromEntries(Object.entries(CHARACTER_BASE_COLORS).map(([key,value])=>[key,parseInt(value.slice(1),16)]))
const WALK_SPEED_M_S = 100 // Playback speed, deliberately not a real walking speed.
const SHOP_DWELL_S = 0.85

function shapeOf(ring, holes = []) {
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

// The source has no verified entrances. Pick a point on the building outline
// facing its road anchor and move just outside it for IDLE presentation only.
// This does not add a graph edge or pretend that the building-to-road gap is a
// mapped footpath. Purchase animation connects this display point to the
// unchanged OSM route using a separate collision-safe display corridor.
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

// Batch the road ribbons so hundreds of OSM segments do not each add a draw call.
function roadGeometry(roads, extraWidth = 0, elevation = 0.14) {
  const vertices = []
  const triangle = (a, b, c) => vertices.push(...a, ...b, ...c)
  for (const road of roads) {
    const points = road.points || []
    const path = ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(road.highway)
    const radius = prototypeParams(path?'road.footway':'road.campus').width_m / 2 + extraWidth
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
  constructor({ host, campus, mapping, index, landcovers = [], surroundings = [], onHover, onSelect, onStats, onVisualActivity, onCharacters, onError, onQuality, characterPool = 'campus' } = {}) {
    this.host = host
    this.campus = campus
    this.mapping = mapping
    this.index = index
    this.landcovers = landcovers
    this.surroundingRoads = surroundings
    this.display = createDisplayCampus(campus, { mapping, landcovers })
    this.spatial = buildSpatialEnvironment(this.display.campus,this.display.landcovers)
    this.navigationObstacles = this.spatial.obstacles
    const { minX, maxX, minY, maxY } = this.display.bounds
    // A small, independent framing margin exposes the four perimeter roads;
    // the newly downloaded 300 m context never becomes a giant grass parcel.
    const context = surroundings.length ? 135 : 0
    const frameRing = [[minX-context,minY-context], [maxX+context,minY-context],
      [maxX+context,maxY+context], [minX-context,maxY+context], [minX-context,minY-context]]
    this.cameraCampus = { ...this.display.campus, boundary: frameRing, boundary_polygons: [{outer:frameRing,holes:[]}] }
    this.onQuality=onQuality
    this.onHover = onHover
    this.onSelect = onSelect
    this.onStats = onStats
    this.onVisualActivity = onVisualActivity
    this.onCharacters = onCharacters
    this.onError = onError
    this.radiusLimits = new Map()
    this.characterPool = ['campus','all','adults','professions','children'].includes(characterPool)?characterPool:'campus'
    this.pendingVisualCount = 0
    this.routing = createRouting(campus, mapping)
    this.people = new Map()
    this.buildingMeshes = new Map()
    this.pickTargets = []
    this.walkers = new Set()
    this.effects = []
    this.labels = []
    this.screenWorld = new THREE.Matrix4()
    this.screenProjection = new THREE.Matrix4()
    this.screenSize = { width: 0, height: 0 }
    this.seenOrders = new Set()
    this.playing = false
    this.speed = 1
    this.unreachable = 0
    this.selectedId = null
    this.performancePolicy=new AdaptiveQuality()
    this.tripAdmission={total:12,perStore:2}
    this.disposed = false
    this.visualSeconds = 0
    this.quality = 'high'
    this.characterStyle = 'realistic'
    this.renderDirty = true
    this.relationsDirty = true
    this.personFrustum = new THREE.Frustum()
    this.frustumMatrix = new THREE.Matrix4()
    this.personSphere = new THREE.Sphere()
    this.buildingStyle = 'procedural'
    this.lighting = { cycle: true, position: 0, hour: 12 }
    this.representatives = idleRepresentatives(index.scene.people)
    this.brandColors = new Map(index.scene.brands.map((brand, k) => [brand.brand_id, BRAND_COLORS[k % BRAND_COLORS.length]]))
  }

  async init() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xeaf0ef)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
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
    this.onControlsStart = () => { this.overviewActive = false }
    this.controls.addEventListener('start', this.onControlsStart)
    this.onControlsChange = () => this.invalidate()
    this.controls.addEventListener('change', this.onControlsChange)
    this.routeLayer = new THREE.Group()
    this.effectLayer = new THREE.Group()
    this.relationLayer = new THREE.Group()
    this.scene.add(this.routeLayer, this.effectLayer, this.relationLayer)
    this.createLabelLayer()
    if(typeof Worker!=='undefined')this.spatialWorker=new SpatialWorker(this.navigationObstacles)
    this.drawCampus()
    this.placePeople()
    this.baseModel = new Campus3DBase({scene:this.scene,campus:this.display.campus,displayBounds:this.display.bounds,waters:this.spatial.waters}).init()
    this.waterModel = new Campus3DWater({scene:this.scene,spatial:this.spatial}).init()
    this.sportsModel = new Campus3DSports({scene:this.scene,landcovers:this.display.landcovers}).init()
    this.environment = new Campus3DEnvironment({ scene: this.scene, campus: this.campus,
      displayCampus: this.display.campus, displayBounds: this.display.bounds,
      mapping: this.mapping, buildingMeshes: this.buildingMeshes, renderer: this.renderer,
      center: this.center, landcovers: [...this.display.landcovers,...sportsExclusions(this.display.landcovers)], avoidance:this.decorationAvoidance() }).init()
    this.vegetation=await new Campus3DVegetation({scene:this.scene,environment:this.environment}).init()
    if(this.disposed){this.vegetation.dispose();return this}
    this.surroundings = new Campus3DSurroundings({ scene: this.scene, roads: this.surroundingRoads,
      displayBounds: this.display.bounds, campus: this.campus, host: this.host }).init()
    this.eventEffects = new EventEffects({ scene: this.scene, index: this.index,
      routing: this.routing, shopMarkers: this.shopMarkers })
    this.scene.traverse(object=>{if(object.isMesh&&Array.isArray(object.material))consolidateMaterialGroups(object.geometry)})
    this.bloom = new SelectiveBloom({ renderer: this.renderer, scene: this.scene, camera: this.camera,
      width: this.host.clientWidth, height: this.host.clientHeight })
    this.setQuality(this.quality)
    await this.initCharacters()
    if(this.disposed)return this
    this.resetCamera()
    this.resize()
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.handlers = {
      pointermove: event => { this.hoverEvent = {clientX:event.clientX,clientY:event.clientY} },
      pointerleave: () => { this.hoverEvent = null;this.clearHover() },
      pointerdown: event => { this.pointerDown = { x: event.clientX, y: event.clientY } },
      click: event => {
        if (!this.pointerDown || Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) < 6) this.pick(event, true)
      },
      webglcontextlost:event=>{
        if(this.disposed)return
        event.preventDefault()
        this.failFrame(new Error('显卡绘图上下文已中断'))
      },
    }
    for (const [type, handler] of Object.entries(this.handlers)) this.renderer.domElement.addEventListener(type, handler)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.host)
    this.lastTime = performance.now()
    const animate = now => {
      if (this.disposed) return
      this.renderFrameSafe(now)
      if(this.disposed||this.failed)return
      this.frame = requestAnimationFrame(animate)
    }
    this.frame = requestAnimationFrame(animate)
    this.emitStats()
    return this
  }

  invalidate() { this.renderDirty = true }

  renderFrameSafe(now) {
    if(this.failed||this.disposed)return false
    try { return this.renderFrame(now) }
    catch(error) {
      this.failFrame(error)
      return false
    }
  }

  failFrame(error) {
    if(this.failed||this.disposed)return
    this.failed=true
    this.playing=false
    this.onError?.(error)
  }

  renderFrame(now) {
    if(this.disposed)return false
    if(this.performancePolicy.sample(now,this.playing,this.quality)){this.setQuality('low');this.onQuality?.('low')}
    const delta=Math.min(Math.max(0,(now-this.lastTime)/1000),.12)
    this.lastTime=now
    if(this.playing) {
      this.visualSeconds+=delta*this.speed
      this.updateWalkers(delta*this.speed)
      this.updateEffects(delta*this.speed)
      this.eventEffects?.update(delta*this.speed)
      this.emitVisualActivity()
      this.invalidate()
      this.relationsDirty=true
    }
    if(this.controls.update())this.invalidate()
    if(this.hoverEvent){const event=this.hoverEvent;this.hoverEvent=null;this.pick(event,false)}
    // Keep OrbitControls damping and input responsive, but do no GPU work or
    // bone/label/layout updates for an unchanged paused scene.
    if(!this.renderDirty)return false
    this.renderDirty=false
    this.updateScreenVisuals()
    if(this.relationsDirty){this.updateRelations();this.relationsDirty=false}
    this.realCharacterBatch?.update(this.visualSeconds,this.camera,this.host?.clientHeight||800)
    this.emitCharacterStatus()
    this.surroundings?.update(this.camera,this.host)
    this.environment?.update(visualClock(this.lighting.position,this.lighting).phase,this.camera)
    this.bloom ? this.bloom.render() : this.renderer.render(this.scene,this.camera)
    return true
  }

  drawCampus() {
    const displayCampus = this.display.campus
    const polygons = displayCampus.boundary_polygons
    this.bounds = campusBoundaryBounds(this.cameraCampus, 0)
    const b = this.display.bounds
    const groundBounds = { width:b.width, height:b.height, center:new THREE.Vector3((b.minX+b.maxX)/2,0,-(b.minY+b.maxY)/2) }
    const { width, height } = this.bounds
    this.span = Math.max(width, height, 100)
    this.center = this.bounds.center.clone()
    this.controls.maxDistance = this.span * 5
    const base = new THREE.Mesh(new THREE.PlaneGeometry(groundBounds.width, groundBounds.height),
      new THREE.MeshStandardMaterial({ color: 0xe7e9dd, roughness: 1 }))
    base.rotation.x = -Math.PI / 2
    base.position.copy(this.center)
    base.position.y = -0.15
    base.userData.environmentKind = 'base'
    this.scene.add(base)
    for (const polygon of polygons) {
      if (!polygon.outer?.length) continue
      const ground = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(polygon.outer, polygon.holes)),
        new THREE.MeshStandardMaterial({ color: 0xcbdcbe, side: THREE.DoubleSide, roughness: 1 }))
      ground.rotation.x = -Math.PI / 2
      ground.position.y = 0
      ground.userData.environmentKind = 'ground'
      this.scene.add(ground)
      const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(polygon.outer.map(([x, y]) => new THREE.Vector3(x, 0.28, -y))),
        new THREE.LineDashedMaterial({ color: 0x6c917d, dashSize: 7, gapSize: 4, transparent: true, opacity: 0.8 }))
      border.computeLineDistances()
      this.scene.add(border)
    }
    const roadEdge = new THREE.Mesh(roadGeometry(displayCampus.roads, 0.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xb9bcaf, roughness: 1, side: THREE.DoubleSide }))
    roadEdge.userData.environmentKind = 'roadEdge'
    this.scene.add(roadEdge)
    for (const kind of ['road', 'path']) {
      const isPath = road => ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(road.highway)
      const roads = displayCampus.roads.filter(road => kind === 'path' ? isPath(road) : !isPath(road))
      const mesh = new THREE.Mesh(roadGeometry(roads), new THREE.MeshStandardMaterial({ color: kind === 'path' ? 0xdbcbaa : 0x6c7675, roughness: 1, side: THREE.DoubleSide }))
      mesh.userData.environmentKind = kind
      this.scene.add(mesh)
    }
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
      mesh.position.y = TERRAIN_LEVELS.buildingBase
      mesh.userData.building = building
      this.scene.add(mesh)
      this.pickTargets.push(mesh)
      this.buildingMeshes.set(building.osm_id, mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30),
        new THREE.LineBasicMaterial({ color: 0x5e7781, transparent: true, opacity: 0.35 }))
      mesh.add(edges)
      // Only the eight mapped places receive persistent labels. Every other
      // building remains in pickTargets and exposes its name on hover.
      if (keys.length) {
        const center = polygonCenter(building.polygon)
        const shopKey = keys.find(key => key.startsWith('shop_'))
        const shopIndex = shopKey ? [...this.brandColors.keys()].indexOf(shopKey.slice(5)) : -1
        const prefix = shopIndex >= 0 ? `门店 ${String.fromCharCode(65 + shopIndex)}（示意）· ` : ''
        this.addCampusLabel(building.osm_id, `${prefix}${name}`,
          new THREE.Vector3(center.x, building.height_m + TERRAIN_LEVELS.buildingBase + 5, -center.y),
          shopIndex >= 0 ? `#${BRAND_COLORS[shopIndex % BRAND_COLORS.length].toString(16).padStart(6, '0')}` : '#294e48')
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
      this.scene.add(marker)
      this.shopMarkers.set(brandId, marker)
    }
  }

  createLabelLayer() {
    this.labelLayer = document.createElement('div')
    this.labelLayer.className = 'campus3d-screen-labels'
    Object.assign(this.labelLayer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '1' })
    this.labelLeaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.labelLeaders.setAttribute('width', '100%')
    this.labelLeaders.setAttribute('height', '100%')
    this.labelLeaders.setAttribute('aria-hidden', 'true')
    Object.assign(this.labelLeaders.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    this.labelLayer.appendChild(this.labelLeaders)
    this.host.appendChild(this.labelLayer)
    this.personNameLabel = document.createElement('div')
    this.personNameLabel.setAttribute('data-person-name', '')
    Object.assign(this.personNameLabel.style, { position: 'absolute', display: 'none', padding: '5px 9px',
      background: '#123f3a', color: '#fff9d8', border: '1px solid #f4d187', borderRadius: '6px',
      font: '600 12px/18px "Microsoft YaHei",sans-serif', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '2' })
    this.labelLayer.appendChild(this.personNameLabel)
  }

  addCampusLabel(id, text, position, color) {
    const element = document.createElement('div')
    element.textContent = text
    const badge = document.createElement('span')
    const total = [...this.people.values()].filter(entry => entry.anchor.building.osm_id === id).length
    badge.textContent = `示意 ${total}人`
    Object.assign(badge.style, { display:'inline-block', minWidth:'48px', marginLeft:'5px', padding:'0 3px', borderRadius:'4px', fontSize:'9px', textAlign:'center', color:'#47705c', background:'#e5eddd' })
    element.appendChild(badge)
    element.title = text
    element.setAttribute('data-campus-label', id)
    Object.assign(element.style, {
      position: 'absolute', font: '600 12px/18px "Microsoft YaHei",sans-serif',
      padding: '3px 7px', color, background: 'rgba(255,255,255,.96)',
      border: '1px solid rgba(70,104,92,.28)', borderRadius: '5px',
      boxShadow: '0 1px 4px rgba(29,61,50,.12)', whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
      boxSizing: 'border-box', width: 'max-content',
    })
    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    leader.setAttribute('stroke', color)
    leader.setAttribute('stroke-width', '1')
    leader.setAttribute('opacity', '.55')
    this.labelLayer.appendChild(element)
    this.labelLeaders.appendChild(leader)
    // Integer offsetWidth can round the natural text width down at fractional
    // device scales; two spare CSS pixels prevent unwanted final-character … .
    this.labels.push({ id, position, element, leader, badge,
      width: Math.ceil(element.getBoundingClientRect().width) + 2, height: Math.ceil(element.getBoundingClientRect().height) })
  }

  updateScreenVisuals() {
    if (!this.camera || !this.host) return
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.camera.updateMatrixWorld()
    const cameraChanged = width !== this.screenSize.width || height !== this.screenSize.height
      || !this.screenWorld.equals(this.camera.matrixWorld) || !this.screenProjection.equals(this.camera.projectionMatrix)
    this.screenWorld.copy(this.camera.matrixWorld)
    this.screenProjection.copy(this.camera.projectionMatrix)
    this.screenSize = { width, height }
    // Reserve the largest walking footprint across the display on camera
    // changes. Per-frame pixel scaling stays inside this stable reservation;
    // moving farther from a fixed camera must never teleport its neighbours.
    if (cameraChanged || !this.cameraCrowdRadius) {
      const b=this.display.bounds, samples=[]
      for(const x of [b.minX-120,b.maxX+120])for(const y of [b.minY-120,b.maxY+120])samples.push(new THREE.Vector3(x,.025,-y))
      samples.push(...[...this.people.values()].map(entry=>entry.figure.position))
      const radius=Math.max(DISPLAY_RADIUS,...samples.map(position=>3*personScaleForCamera(this.camera,position,{width,height,minPixels:12})))+.2
      // Upward quantization preserves clearance without rebuilding every
      // corridor for floating-point jitter during OrbitControls damping.
      this.cameraCrowdRadius=this.fitCrowdRadius(Math.ceil(radius*4)/4)
    }
    if([...this.people.values()].some(entry=>entry.collisionRadius !== this.cameraCrowdRadius))this.reflowPeople()
    this.frustumMatrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse)
    this.personFrustum.setFromProjectionMatrix(this.frustumMatrix)
    // CSS pixels; device pixel ratio must not affect the minimum size.
    for (const entry of this.people.values()) {
      const prominent = Boolean(entry.walker) || entry.person.id === this.selectedId
      entry.presentationVisible = prominent || this.representatives.has(entry.person.id)
      entry.figure.visible = entry.presentationVisible
      entry.base.visible = entry.presentationVisible
      const minPixels = 12
      if (cameraChanged || entry.screenMinPixels !== minPixels || !entry.screenPosition?.equals(entry.figure.position)) {
        const scale = Math.min(personScaleForCamera(this.camera, entry.figure.position, { width, height, minPixels }),this.cameraCrowdRadius/3)
        entry.figure.scale.setScalar(scale)
        entry.screenPosition = entry.figure.position.clone()
        entry.screenMinPixels = minPixels
      }
      this.personSphere.center.copy(entry.figure.position).y+=4.25*entry.figure.scale.x
      this.personSphere.radius=5.3*entry.figure.scale.x
      entry.inView=this.personFrustum.intersectsSphere(this.personSphere)
      entry.figure.visible=entry.presentationVisible&&entry.inView
      entry.walkHalo.visible = Boolean(entry.walker)
    }
    this.updateSelection()
    if (this.personNameLabel) {
      const selected = this.people.get(this.selectedId)
      const point = selected?.figure.position.clone().add(new THREE.Vector3(0, 9 * selected.figure.scale.x, 0)).project(this.camera)
      const visible = point && point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1
      this.personNameLabel.style.display = visible ? 'block' : 'none'
      if (visible) {
        this.personNameLabel.textContent = `${selected.person.name} · ${selected.person.role_label}`
        this.personNameLabel.style.left = `${Math.max(5, Math.min(width - 190, (point.x + 1) * width / 2 - 65))}px`
        this.personNameLabel.style.top = `${Math.max(5, (1 - point.y) * height / 2 - 24)}px`
      }
    }
    const occupancy = displayOccupancy(this.people.values())
    for (const label of this.labels) label.badge.textContent = `示意 ${occupancy.get(label.id)?.inside || 0}人`
    if (!this.labelLayer || !cameraChanged) return
    const items = []
    for (const label of this.labels) {
      const projected = label.position.clone().project(this.camera)
      const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.12 && Math.abs(projected.y) < 1.12
      label.element.style.display = visible ? 'block' : 'none'
      label.leader.style.display = visible ? '' : 'none'
      if (!visible) continue
      items.push({ id: label.id, x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2,
        width: label.width, height: label.height })
    }
    const placed = new Map(layoutLabels(items, { width, height, padding: 10, gap: 5 }).map(item => [item.id, item]))
    for (const label of this.labels) {
      const item = placed.get(label.id)
      if (!item) continue
      Object.assign(label.element.style, { left: `${item.left}px`, top: `${item.top}px`, width: `${item.width}px` })
      label.leader.setAttribute('x1', item.anchorX)
      label.leader.setAttribute('y1', item.anchorY)
      label.leader.setAttribute('x2', Math.max(item.left, Math.min(item.left + item.width, item.anchorX)))
      label.leader.setAttribute('y2', Math.max(item.top, Math.min(item.top + item.height, item.anchorY)))
    }
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
        // Only hit proxies and role markers live here; Rocketbox owns bodies.
        const body = new THREE.Object3D()
        body.position.y = 3.2
        const base = new THREE.Mesh(new THREE.CircleGeometry(2.6, 12),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }))
        base.rotation.x = -Math.PI / 2
        base.position.y = 0.05
        const walkHalo = new THREE.Mesh(new THREE.RingGeometry(2.8, 3.8, 20),
          new THREE.MeshBasicMaterial({ color: 0xfff7d6, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false }))
        walkHalo.rotation.x = -Math.PI / 2
        walkHalo.position.y = 0.12
        walkHalo.renderOrder = 5
        walkHalo.visible = false
        const hit = new THREE.Mesh(new THREE.SphereGeometry(4, 6, 4),
          new THREE.MeshBasicMaterial({ visible: false }))
        hit.position.y = 4.5
        hit.userData.person = person
        figure.add(base, walkHalo, body, hit)
        figure.position.set(home.x, 0.35, -home.y)
        this.scene.add(figure)
        this.pickTargets.push(hit)
        this.people.set(person.id, { person, key, anchor, entrance, home, figure, body, base, walkHalo, color, queue: [], walker: null, hasCoffee: false })
      })
    }
    this.selection = new THREE.Mesh(new THREE.RingGeometry(4.1, 5.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffbd49, side: THREE.DoubleSide, depthTest: false }))
    this.selection.rotation.x = -Math.PI / 2
    this.selection.visible = false
    this.selection.renderOrder = 4
    this.scene.add(this.selection)
    const slots = new Map(standingSlots([...this.people].map(([id,entry])=>({id,origin:entry.entrance})),this.navigationObstacles,
      {radius:DISPLAY_RADIUS,roads:this.campus.roads || []}).map(point=>[point.id,point]))
    for(const [id,entry] of this.people) {
      const point=slots.get(id)
      entry.home={x:point.x,y:point.y}
      entry.figure.position.set(point.x,this.personElevation(point),-point.y)
      entry.figure.rotation.y=Math.atan2(entry.anchor.node.x-point.x,-entry.anchor.node.y+point.y)
      entry.collisionRadius=3
    }
  }

  personElevation(point) {
    for(const bridge of this.spatial.bridges){const height=bridgeHeightAt(point,bridge);if(height!==null)return height+.025}
    return terrainSurfaceHeight(point,this.display.campus)+.025
  }

  fitCrowdRadius(requested) {
    if(this.radiusLimits.has(requested))return this.radiusLimits.get(requested)
    let applied=requested
    try {this.standingClearanceRoutes(requested)}
    catch(error) {
      // A narrow canvas can require a 15m visual footprint to reach 12px.
      // Real building gaps cannot support it. Keep a previously valid radius
      // and cap only the drawn scale; never alter the OSM graph or stop replay.
      applied=this.lastCrowdLayoutRadius||DISPLAY_RADIUS
      this.standingClearanceRoutes(applied)
      this.presentationLimit={requested,applied,reason:error.message}
    }
    this.radiusLimits.set(requested,applied)
    return applied
  }

  reflowPeople() {
    const people=[...this.people].map(([id,entry])=>({id,x:entry.figure.position.x,y:-entry.figure.position.z,
      radius:this.cameraCrowdRadius || Math.max(DISPLAY_RADIUS,entry.figure.scale.x*3),moving:Boolean(entry.walker)}))
    const invalid=people.some((p,i)=>!outsideBuildings(p,this.navigationObstacles,p.radius)
      || people.slice(0,i).some(q=>Math.hypot(p.x-q.x,p.y-q.y)<p.radius+q.radius+CROWD_GAP-1e-6))
    // Standing groups leave an additional walking-width corridor between
    // neighbours. Tight disc packing is collision-free but traps departures.
    let positions=people
    const reroutes=new Map()
    try {
    if(invalid || this.lastCrowdLayoutRadius!==this.cameraCrowdRadius) {
      positions=[]
      const radius=this.cameraCrowdRadius || DISPLAY_RADIUS,roads=this.standingClearanceRoutes(radius)
      for(const person of [...people].sort((a,b)=>Number(b.moving)-Number(a.moving)||a.id.localeCompare(b.id))) {
        // Idle bays need room for another full figure to pass between them and
        // a wall. Otherwise a harmless standing person can seal a cul-de-sac.
        positions.push({...person,...nearestClearPosition(person,this.navigationObstacles,{radius:person.radius,
          obstacleRadius:person.moving?person.radius:person.radius*2+CROWD_GAP+4,occupied:positions,
          gap:2*radius+2*CROWD_GAP+6,roads:person.moving?[]:roads,roadClearance:radius+2})})
      }
    }
      for(const p of positions) {
        const walker=this.people.get(p.id).walker
        if(walker&&p.radius>walker.displayRadius)reroutes.set(p.id,displayRoutePoints(walker.displayPoints.slice(walker.displayNextPoint),this.navigationObstacles,
          {radius:p.radius,laneOffset:0,start:p}))
      }
    } catch(error) {
      const safe=this.lastCrowdLayoutRadius||Math.ceil((DISPLAY_RADIUS+.2)*4)/4
      if(this.cameraCrowdRadius>safe) {
        this.presentationLimit={requested:this.cameraCrowdRadius,applied:safe,reason:error.message}
        this.radiusLimits.set(this.cameraCrowdRadius,safe)
        this.cameraCrowdRadius=safe
        return this.reflowPeople()
      }
      throw error
    }
    this.lastCrowdLayoutRadius=this.cameraCrowdRadius
    this.relationsDirty=true
    for(const p of positions) {
      const entry=this.people.get(p.id)
      entry.figure.position.set(p.x,this.personElevation(p),-p.y)
      entry.collisionRadius=p.radius
      if(!entry.walker)entry.home={x:p.x,y:p.y}
      else if(reroutes.has(p.id)) {
        entry.walker.displayPoints=reroutes.get(p.id)
        entry.walker.displayNextPoint=1
        entry.walker.displayRadius=p.radius
        this.updateWalkerLine(entry.walker)
      }
    }
    this.refreshDecorationClearance()
  }

  refreshDecorationClearance() {
    if(!this.environment?.setAgentClearance)return
    this.environment.setAgentClearance({points:[...this.people.values()].map(entry=>({x:entry.figure.position.x,y:-entry.figure.position.z,radius:entry.collisionRadius})),
      routes:[...this.people.values()].filter(entry=>entry.walker).map(entry=>entry.walker.displayPoints),clearance:this.cameraCrowdRadius || DISPLAY_RADIUS})
  }

  updateWalkerLine(walker) {
    if(!walker.line)return
    walker.line.geometry.dispose()
    walker.line.geometry=new THREE.BufferGeometry().setFromPoints(walker.displayPoints.map(point=>new THREE.Vector3(point.x,this.personElevation(point)+.3,-point.y)))
  }

  standingClearanceRoutes(radius) {
    if(this.standingRouteRadius===radius)return this.standingRoutes
    const routes=[]
    for(const key of this.routing.anchors.keys())if(!key.startsWith('shop_'))for(const shop of this.routing.anchors.keys())if(shop.startsWith('shop_')) {
      const route=routeBetweenMappings(this.routing,key,shop)
      if(route) {
        routes.push(route.points)
        routes.push(displayRoutePoints(route.points,this.navigationObstacles,{radius,laneOffset:4}))
        routes.push(displayRoutePoints(reverseRoute(route).points,this.navigationObstacles,{radius,laneOffset:4}))
      }
    }
    this.standingRouteRadius=radius;this.standingRoutes=routes
    return routes
  }

  decorationAvoidance() {
    const routes=[]
    for(const key of this.routing.anchors.keys())if(!key.startsWith('shop_'))for(const shop of this.routing.anchors.keys())if(shop.startsWith('shop_')) {
      const route=routeBetweenMappings(this.routing,key,shop)
      if(route) {
        routes.push(route.points)
        routes.push(displayRoutePoints(route.points,this.navigationObstacles,{radius:DISPLAY_RADIUS,laneOffset:4}))
        routes.push(displayRoutePoints(reverseRoute(route).points,this.navigationObstacles,{radius:DISPLAY_RADIUS,laneOffset:4}))
      }
    }
    return {points:[...this.people.values()].map(entry=>({...entry.home,radius:DISPLAY_RADIUS})),routes,clearance:14}
  }

  setCursor(cursor) {
    this.invalidate()
    this.relationsDirty=true
    this.seenOrders.clear()
    for (const event of this.index.scene.events.slice(0, Math.max(0, cursor))) {
      if (event.type === 'purchase') this.seenOrders.add(event.order_id || event.key)
    }
    this.walkers.clear()
    this.unreachable = 0
    for (const entry of this.people.values()) {
      entry.queue.length = 0
      entry.walker = null
      entry.hasCoffee = false
      entry.figure.position.set(entry.home.x, this.personElevation(entry.home), -entry.home.y)
      entry.body.position.y = 3.2
    }
    this.clearLayer(this.routeLayer)
    this.clearLayer(this.effectLayer)
    this.effects = []
    this.visualSeconds = 0
    this.eventEffects?.reset()
    this.reflowPeople()
    this.emitVisualActivity()
    this.updateSelection()
    this.emitStats()
  }

  playEvent(event) {
    this.invalidate()
    const entry = this.people.get(event.actor)
    if (!entry) return
    if (this.eventEffects && event.type !== 'purchase') {
      this.eventEffects.playEvent(event)
      this.emitVisualActivity()
      return
    }
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
      this.drainTripQueue()
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
      this.emitVisualActivity()
    }
  }

  drainTripQueue() {
    for(const entry of tripQueueEntries(this.people.values(),this.walkers.size,this.tripAdmission.total,this.tripAdmission.perStore))this.startNextTrip(entry)
  }

  startNextTrip(entry) {
    if(this.walkers.size>=this.tripAdmission.total || entry.walker)return
    const next = entry.queue.shift()
    if (!next) return
    entry.hasCoffee = false
    const displayRadius=Math.max(DISPLAY_RADIUS,entry.collisionRadius)
    const occupied=[...this.people.values()].filter(other=>other!==entry).flatMap(other=>[
      {x:other.figure.position.x,y:-other.figure.position.z,radius:other.collisionRadius},
      ...(other.walker?.servicePoint ? [{...other.walker.servicePoint,radius:other.collisionRadius}] : [])])
    const servicePoint=nearestClearPosition(next.route.points.at(-1),this.navigationObstacles,{radius:displayRadius,occupied})
    const options={radius:displayRadius,laneOffset:4,start:{x:entry.figure.position.x,y:-entry.figure.position.z},end:servicePoint}
    if(this.spatialWorker){
      const placeholder={...next,phase:'planning',displayPoints:[],displayNextPoint:1,displayRadius,servicePoint,travelled:0,stalled:0}
      entry.walker=placeholder;this.walkers.add(entry.person.id)
      this.spatialWorker.run({kind:'route',points:next.route.points,options}).then(points=>{
        if(this.disposed||entry.walker!==placeholder||!points)return
        this.completeTrip(entry,next,displayRadius,servicePoint,points);this.invalidate();this.emitStats()
      }).catch(e=>{if(!this.disposed&&entry.walker===placeholder)this.failFrame(e)})
      return
    }
    const displayPoints=displayRoutePoints(next.route.points,this.navigationObstacles,options)
    this.completeTrip(entry,next,displayRadius,servicePoint,displayPoints)
  }

  completeTrip(entry,next,displayRadius,servicePoint,displayPoints) {
    const material = new THREE.LineBasicMaterial({ color: this.brandColors.get(next.event.brand_id) || 0xe17943, transparent: true, opacity: 0.75 })
    const routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(displayPoints.map(point => new THREE.Vector3(point.x, this.personElevation(point)+.3, -point.y))), material)
    this.routeLayer.add(routeLine)
    entry.walker = { ...next, phase: 'outbound', points: next.route.points, nextPoint: 1, dwell: 0, line: routeLine,
      displayPoints,displayNextPoint:1,displayRadius,servicePoint,travelled:0,stalled:0 }
    this.walkers.add(entry.person.id)
    this.refreshDecorationClearance()
  }

  updateWalkers(delta) {
    let changed = false
    // Small, swept steps keep both the frame endpoints and the interval safe.
    // Only display travel is delayed by a queue; replay events/stats are intact.
    const slices=Math.max(1,Math.ceil(delta/.04)),step=delta/slices
    for(let slice=0;slice<slices;slice++) {
      const proposals=[]
      for(const [id,entry] of this.people) {
        const p={id,x:entry.figure.position.x,y:-entry.figure.position.z,radius:entry.collisionRadius || 3,progress:entry.walker?.travelled || 0}
        const walker=entry.walker
        if(walker) {
          walker.holdRemaining=Math.max(0,(walker.holdRemaining || 0)-step)
          walker.yieldCooldown=Math.max(0,(walker.yieldCooldown || 0)-step)
        }
        if(walker?.phase==='dwell') {
          walker.dwell+=step
          if(walker.dwell>=SHOP_DWELL_S) {
            walker.phase='return'
            walker.points=reverseRoute(walker.route).points
            walker.nextPoint=1
            if(this.spatialWorker){this.planWalkerRoute(entry,walker,walker.points,{radius:walker.displayRadius,laneOffset:4,start:p,end:entry.home},'return');proposals.push(p);continue}
            walker.displayPoints=displayRoutePoints(walker.points,this.navigationObstacles,{radius:walker.displayRadius,laneOffset:4,start:p,end:entry.home})
            walker.displayNextPoint=1
            this.updateWalkerLine(walker)
            this.refreshDecorationClearance()
          }
        }
        if(walker?.phase==='planning'){proposals.push(p);continue}
        if(walker && walker.phase!=='dwell' && !walker.holdRemaining) {
          const goal=walker.displayPoints[walker.displayNextPoint]
          if(goal) {
            const d=Math.hypot(goal.x-p.x,goal.y-p.y),fraction=d<=1e-6?1:Math.min(1,WALK_SPEED_M_S*step/d)
            p.target={x:p.x+(goal.x-p.x)*fraction,y:p.y+(goal.y-p.y)*fraction}
            p.reachesGoal=fraction===1
          }
        }
        proposals.push(p)
      }
      const result=stepSeparatedCrowd(proposals,this.navigationObstacles)
      for(const p of result) {
        const entry=this.people.get(p.id),walker=entry.walker
        const goal=walker?.displayPoints[walker.displayNextPoint]
        const beforeGoal=goal?Math.hypot(entry.figure.position.x-goal.x,-entry.figure.position.z-goal.y):0
        const dx=p.x-entry.figure.position.x,dz=-p.y-entry.figure.position.z,moved=Math.hypot(dx,dz)
        if(moved>0)entry.figure.position.set(p.x,this.personElevation(p),-p.y)
        entry.presentationWalking=moved>.001
        if(!walker || walker.phase==='planning')continue
        if(moved>.001)entry.figure.rotation.y=Math.atan2(dx,dz)
        walker.travelled+=moved
        walker.waiting=p.waiting
        walker.moving=moved>.001
        const improvement=goal?beforeGoal-Math.hypot(p.x-goal.x,p.y-goal.y):0
        walker.stalled=(walker.stalled || 0)+step
        if(walker.stalled>.4 && (p.waiting || improvement<moved*.8+.001) && walker.phase!=='dwell' && !walker.holdRemaining) {
          const obstacles=[...this.people.values()].filter(other=>other!==entry).map(other=>({x:other.figure.position.x,y:-other.figure.position.z,radius:other.collisionRadius}))
          if(this.spatialWorker){this.replanWalker(entry,walker,p,obstacles);continue}
          // Intermediate display corners may be occupied by an idle figure.
          // Rejoin a later free corner rather than waiting forever at it.
          let replanned=false
          for(let i=walker.displayNextPoint;i<walker.displayPoints.length;i++) {
            const path=displayCrowdDetour(p,walker.displayPoints[i],this.navigationObstacles,obstacles,entry.collisionRadius)
            if(path) {
              walker.displayPoints=[...path,...walker.displayPoints.slice(i+1)]
              walker.displayNextPoint=1
              this.updateWalkerLine(walker)
              replanned=true
              break
            }
          }
          // A single-width corridor may have no route around an oncoming
          // body. The later ID retreats to its reserved home bay, then waits
          // while the earlier ID passes; never teleport through its neighbour.
          if(!replanned && !walker.retreating && !walker.yieldCooldown
            && [...this.people.values()].some(other=>other.walker && other.person.id<entry.person.id
              && Math.hypot(p.x-other.figure.position.x,p.y+other.figure.position.z)<entry.collisionRadius*6)) {
            const retreat=displayCrowdDetour(p,entry.home,this.navigationObstacles,obstacles,entry.collisionRadius)
            if(retreat && retreat.length>1) {
              walker.resumeDisplayPoints=walker.displayPoints.slice(walker.displayNextPoint)
              walker.displayPoints=retreat;walker.displayNextPoint=1;walker.retreating=true
              this.updateWalkerLine(walker)
            }
          }
          this.refreshDecorationClearance()
          walker.stalled=0
        }
        if(p.reachesGoal && p.fraction>.9999)walker.displayNextPoint++
        if(walker.phase!=='dwell' && walker.displayNextPoint>=walker.displayPoints.length) {
          if(walker.retreating) {
            if(this.spatialWorker){this.planWalkerRoute(entry,walker,walker.resumeDisplayPoints,{radius:walker.displayRadius,laneOffset:0,start:p},'return');walker.retreating=false;walker.holdRemaining=2;walker.yieldCooldown=8;continue}
            walker.displayPoints=displayRoutePoints(walker.resumeDisplayPoints,this.navigationObstacles,{radius:walker.displayRadius,laneOffset:0,start:p})
            walker.displayNextPoint=1;walker.retreating=false;walker.holdRemaining=2;walker.yieldCooldown=8
            this.updateWalkerLine(walker)
            this.refreshDecorationClearance()
            continue
          }
          if(walker.phase==='outbound') {
            walker.phase='dwell';walker.dwell=0;entry.hasCoffee=true
            this.eventEffects?.purchaseArrived(walker.event)
            this.emitVisualActivity()
          } else {
            this.routeLayer.remove(walker.line);disposeObject(walker.line)
            entry.walker=null;this.walkers.delete(p.id)
            entry.home={x:p.x,y:p.y}
            entry.body.position.y=3.2
            this.drainTripQueue();changed=true
          }
        }
      }
    }
    this.updateSelection()
    if (changed) this.emitStats()
  }

  planWalkerRoute(entry,walker,points,options,phase) {
    walker.phase='planning'
    this.spatialWorker.run({kind:'route',points,options}).then(path=>{
      if(this.disposed||entry.walker!==walker||!path)return
      walker.displayPoints=path;walker.displayNextPoint=1;walker.phase=phase
      this.updateWalkerLine(walker);this.refreshDecorationClearance();this.invalidate()
    }).catch(e=>{if(!this.disposed&&entry.walker===walker)this.failFrame(e)})
  }

  replanWalker(entry,walker,start,people) {
    const phase=walker.phase,goals=walker.displayPoints.slice(walker.displayNextPoint)
    const retreat=!walker.retreating&&!walker.yieldCooldown&&[...this.people.values()].some(other=>other.walker&&other.person.id<entry.person.id&&Math.hypot(start.x-other.figure.position.x,start.y+other.figure.position.z)<entry.collisionRadius*6)
    walker.phase='planning'
    this.spatialWorker.run({kind:'replan',start,goals,people,radius:entry.collisionRadius,retreat,home:entry.home}).then(result=>{
      if(this.disposed||entry.walker!==walker)return
      walker.phase=phase;walker.stalled=0
      if(!result)walker.holdRemaining=4
      if(result){if(result.retreat){walker.resumeDisplayPoints=goals;walker.retreating=true}walker.displayPoints=result.points;walker.displayNextPoint=1;this.updateWalkerLine(walker)}
      this.refreshDecorationClearance();this.invalidate()
    }).catch(e=>{if(!this.disposed&&entry.walker===walker)this.failFrame(e)})
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
    const next=this.people.has(id)?id:null
    if(next===this.selectedId)return
    this.selectedId=next
    this.invalidate()
    this.relationsDirty=true
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
    if (selected) {
      this.selection.position.set(selected.figure.position.x, selected.figure.position.y+.12, selected.figure.position.z)
      this.selection.scale.setScalar(selected.figure.scale.x)
    }
  }

  pick(event, select) {
    if (this.disposed || !this.raycaster) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickTargets, false).find(item =>
      !item.object.userData.person || this.people.get(item.object.userData.person.id)?.presentationVisible !== false)
    const buildingHit=hit?.object.userData.building?hit.object:null
    if(this.hoveredBuilding!==buildingHit)this.clearHoveredBuilding()
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
      if(this.hoveredBuilding!==hit.object) {
        this.hoveredBuilding = hit.object
        this.hoveredEmissives = [hit.object.material].flat().filter(material=>material?.emissive).map(material => ({ material, color: material.emissive.clone() }))
        for (const { material } of this.hoveredEmissives) material.emissive.add(new THREE.Color(0x112b28))
        this.invalidate()
      }
      this.onHover?.({ type: 'building', name: building.name || `OSM ${building.osm_id}`, building, x: event.clientX, y: event.clientY })
    }
  }

  clearHoveredBuilding() {
    if (this.hoveredBuilding) {
      for (const { material, color } of this.hoveredEmissives || []) material.emissive.copy(color)
      this.hoveredEmissives = null
      this.hoveredBuilding = null
      this.invalidate()
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
  emitVisualActivity() {
    const count = this.effects.length + (this.eventEffects?.effects.length || 0)
    if (count === this.pendingVisualCount) return
    this.pendingVisualCount = count
    this.onVisualActivity?.(count)
  }
  isWalking(id) { return this.walkers.has(id) }
  setPlaying(playing) { this.playing = Boolean(playing);this.invalidate() }
  setSpeed(speed) { this.speed = Number.isFinite(Number(speed)) ? Math.max(0.1, Math.min(20, Number(speed))) : 1 }

  setLighting({ position = 0, cycle = true, hour = 12 } = {}) {
    this.lighting = { position, cycle, hour }
    this.invalidate()
  }

  setQuality(value) {
    this.quality = value === 'low' ? 'low' : 'high'
    this.invalidate()
    this.environment?.setQuality(this.quality)
    this.baseModel?.setQuality(this.quality)
    this.yulanStyle?.setQuality(this.quality)
    this.realCharacterBatch?.setQuality(this.quality)
    this.eventEffects?.setQuality(this.quality)
    this.bloom?.setQuality(this.quality)
    if (this.renderer) {
      this.renderer.setPixelRatio(this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5))
      this.resize()
    }
  }

  initCharacters() {
    this.updateScreenVisuals()
    if (!this.realCharacterBatch && this.host) {
      if(!this.realPromise)this.realPromise=import('./Campus3DRealCharacters.js').then(async({RealCharacterBatch})=>{
        if(this.disposed)return
        this.realCharacterBatch=new RealCharacterBatch({scene:this.scene,entries:this.people,pool:this.characterPool,
          onReady:()=>{this.invalidate();this.emitCharacterStatus()}})
        await this.realCharacterBatch.init()
        if(this.disposed){this.realCharacterBatch.dispose();return}
        this.realCharacterBatch.setQuality(this.quality)
        this.realCharacterBatch.setVisible(true)
        this.realCharacterBatch.update(this.visualSeconds)
        this.updateScreenVisuals()
        this.emitCharacterStatus()
        this.invalidate()
      }).catch(error=>{this.realCharacterBatch?.dispose();this.realCharacterBatch=null;this.realPromise=null;throw error})
      return this.realPromise
    }
    return Promise.resolve()
  }

  emitCharacterStatus() {
    const status=this.realCharacterBatch?.getStats?.()
    if(!status)return
    const key=JSON.stringify(status)
    if(key!==this.lastCharacterStatus){this.lastCharacterStatus=key;this.onCharacters?.(status)}
  }

  async setCharacterPool(value) {
    this.characterPool=['all','adults','professions','children','campus'].includes(value)?value:'campus'
    if(this.realCharacterBatch)await this.realCharacterBatch.setPool(this.characterPool)
    this.emitCharacterStatus()
    this.invalidate()
  }

  retryCharacters() { this.realCharacterBatch?.retryFailed?.();this.emitCharacterStatus() }

  setBuildingStyle(value) {
    this.invalidate()
    if(this.environment)this.environment.shadowDirty=true
    this.buildingStyle=value==='yulan'?'yulan':'procedural'
    if(this.yulanStyle){this.yulanStyle.setEnabled(this.buildingStyle==='yulan');return Promise.resolve()}
    if(this.buildingStyle!=='yulan')return Promise.resolve()
    if(!this.yulanPromise)this.yulanPromise=import('./YuLanCampusStyle.js').then(async({YuLanCampusStyle})=>{
      if(this.disposed)return
      const resolvePrototype=campusBuildingPrototype
      this.yulanStyle=new YuLanCampusStyle({scene:this.scene,campus:this.display.campus,buildingMeshes:this.buildingMeshes,
        environment:this.environment,resolvePrototype,sourceObjects:{trees:null}})
      await this.yulanStyle.init()
      if(this.disposed){this.yulanStyle.dispose();return}
      this.yulanStyle.setQuality?.(this.quality)
      this.yulanStyle.setEnabled(this.buildingStyle==='yulan')
    }).catch(error=>{this.yulanStyle?.dispose();this.yulanStyle=null;this.yulanPromise=null;throw error})
    return this.yulanPromise
  }

  focusPerson(id) {
    const entry = this.people.get(id) || this.people.get([...this.walkers][0]) || [...this.people.values()].find(item => item.person.role !== 'merchant')
    if (!entry || !this.camera) return null
    this.selectPerson(entry.person.id)
    this.overviewActive = false
    const target = entry.figure.position.clone().add(new THREE.Vector3(0, 4.3, 0))
    const angle = entry.figure.rotation.y
    // Choose an unobstructed front/side view rather than putting a decorative
    // tree between the lens and the person. This changes only the camera.
    const occluders = [...this.buildingMeshes.values()]
    if (this.environment?.trees?.visible) occluders.push(this.environment.trees)
    this.scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    const views = [.55, -.55, 1.1, -1.1, 0, 1.8, -1.8, Math.PI].map(offset => {
      const position = target.clone().add(new THREE.Vector3(Math.sin(angle + offset) * 38, 18, Math.cos(angle + offset) * 38))
      let obstruction = 0
      for (const height of [1.5, 4.3, 7]) {
        const point = entry.figure.position.clone().add(new THREE.Vector3(0, height, 0))
        const direction = point.clone().sub(position)
        ray.set(position, direction.clone().normalize())
        ray.far = direction.length() - 2
        obstruction += ray.intersectObjects(occluders, true).length
      }
      return { position, obstruction }
    })
    views.sort((a, b) => a.obstruction - b.obstruction)
    this.controls.target.copy(target)
    this.camera.position.copy(views[0].position)
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = damping
    this.updateScreenVisuals()
    this.invalidate()
    return entry.person.id
  }

  resetCamera() {
    if (!this.camera) return
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight)
    this.camera.aspect = Math.max(aspect, 0.05)
    this.camera.zoom = 1
    this.camera.updateProjectionMatrix()
    const landscape = this.camera.aspect >= 1.25
    const eastWest = this.display.bounds.width > this.display.bounds.height
    const direction = landscape === eastWest ? new THREE.Vector3(.22,.9,.85) : new THREE.Vector3(.85,.9,.22)
    const fit = fitCampusView(this.cameraCampus, { aspect: this.camera.aspect, fov: this.camera.fov, fill: 0.83, direction })
    // Consume any residual drag damping before assigning an exact overview.
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.maxDistance = Math.max(this.span * 5, fit.distance * 2)
    this.controls.target.copy(fit.target)
    this.camera.position.copy(fit.position)
    this.controls.update()
    this.controls.enableDamping = damping
    this.overviewActive = true
    this.updateScreenVisuals()
    this.invalidate()
  }

  resize() {
    if (!this.renderer || this.disposed) return
    const width = Math.max(this.host.clientWidth, 1)
    const height = Math.max(this.host.clientHeight, 1)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.invalidate()
    this.renderer.setSize(width, height, false)
    this.bloom?.resize(width, height)
    if (this.overviewActive) this.resetCamera()
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
    this.spatialWorker?.dispose()
    if (this.frame) cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.controls?.removeEventListener('start', this.onControlsStart)
    this.controls?.removeEventListener('change', this.onControlsChange)
    this.controls?.dispose()
    this.labelLayer?.remove()
    this.labels.length = 0
    this.clearHover()
    this.eventEffects?.dispose()
    this.bloom?.dispose()
    this.yulanStyle?.dispose()
    this.environment?.dispose()
    this.baseModel?.dispose()
    this.waterModel?.dispose()
    this.vegetation?.dispose()
    this.sportsModel?.dispose()
    this.surroundings?.dispose()
    this.realCharacterBatch?.dispose()
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
