// Procedural scenery only. None of these materials, decorations or light
// presets are written back to OSM, person placement, the graph or OASIS data.
import * as THREE from 'three'
import { buildingPalette, dayLighting, decorationPlacements, seededRandom, windowPattern } from './campus3dEnvironmentModel.js'
import { clipLandcovers, pointInDisplay } from './campus3dDisplay.js'

const PATH_TYPES = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway'])

function shape(ring, holes = []) {
  const result = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of holes) result.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  return result
}

function centroid(ring) {
  let area = 0
  let x = 0
  let y = 0
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1]
    const b = ring[i]
    const cross = a[0] * b[1] - b[0] * a[1]
    area += cross
    x += (a[0] + b[0]) * cross
    y += (a[1] + b[1]) * cross
  }
  if (Math.abs(area) > 1e-8) return { x: x / (area * 3), y: y / (area * 3) }
  return { x: ring.reduce((sum, p) => sum + p[0], 0) / ring.length, y: ring.reduce((sum, p) => sum + p[1], 0) / ring.length }
}

function canvas(width, height) {
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  return [image, image.getContext('2d')]
}

function roadRibbon(roads, elevation = .19) {
  const vertices = []
  for (const road of roads) {
    const points = road.points || []
    const radius = PATH_TYPES.has(road.highway) ? 1.4 : 3.1
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]
      const b = points[i]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (!length) continue
      const nx = -(b[1] - a[1]) / length * radius
      const ny = (b[0] - a[0]) / length * radius
      const p = [a[0] + nx, elevation, -(a[1] + ny)]
      const q = [b[0] + nx, elevation, -(b[1] + ny)]
      const r = [b[0] - nx, elevation, -(b[1] - ny)]
      const s = [a[0] - nx, elevation, -(a[1] - ny)]
      vertices.push(...p, ...q, ...r, ...p, ...r, ...s)
    }
  }
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  result.computeVertexNormals()
  return result
}

const SKY_VERTEX = `varying vec3 direction;
void main(){ direction=position; vec4 world=modelMatrix*vec4(position,1.0); gl_Position=projectionMatrix*viewMatrix*world; }`
const SKY_FRAGMENT = `uniform vec3 topColor; uniform vec3 horizonColor; uniform float night; varying vec3 direction;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
void main(){vec3 d=normalize(direction); float h=pow(max(d.y,0.0),0.65); vec3 color=mix(horizonColor,topColor,h);
float star=step(0.9987,hash(floor(d*550.0)))*smoothstep(0.05,0.5,d.y)*night;
gl_FragColor=vec4(color+vec3(star*0.6),1.0); }`

export class Campus3DEnvironment {
  constructor({ scene, campus, displayCampus = null, displayBounds = null, mapping, buildingMeshes, renderer, center, landcovers = [] }) {
    this.scene = scene
    this.campus = displayCampus || campus
    this.displayBounds = displayBounds || displayCampus?.display_bounds || null
    this.mapping = mapping
    this.buildingMeshes = buildingMeshes
    this.renderer = renderer
    this.center = center?.clone() || new THREE.Vector3()
    this.landcovers = this.displayBounds ? clipLandcovers(landcovers, this.displayBounds) : landcovers
    this.group = new THREE.Group()
    this.group.name = 'Procedural decoration (illustrative)'
    this.group.userData.illustrative = true
    this.group.userData.label = '装饰'
    this.resources = new Set()
    this.replaced = new Map()
    this.windowMaterials = []
    this.lightMaterials = []
    this.quality = 'high'
    this.phase = .25
    this.disposed = false
    this.previousFog = scene.fog
    this.previousBackground = scene.background
    this.previousShadow = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, autoUpdate: renderer.shadowMap.autoUpdate }
  }

  own(resource) { this.resources.add(resource); return resource }

  replaceMaterial(mesh, material) {
    if (!this.replaced.has(mesh)) this.replaced.set(mesh, { material: mesh.material, bloomMaterial: mesh.userData.bloomMaterial, renderOrder: mesh.renderOrder })
    mesh.material = material
  }

  texture(image, repeat = null) {
    const texture = this.own(new THREE.CanvasTexture(image))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
    if (repeat) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(repeat[0], repeat[1])
    }
    return texture
  }

  init() {
    this.scene.add(this.group)
    // r187 removed PCFSoftShadowMap. PCFShadowMap with a wider sampling radius
    // is the supported soft-edge equivalent, without a per-init warning.
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.enabled = true
    // A selective-bloom frame renders the scene more than once. Refresh the
    // shadow map once before those passes, then reuse it for the final colour.
    this.renderer.shadowMap.autoUpdate = false
    this.scene.fog = new THREE.FogExp2(0xbed9d9, .0001)
    this.hemisphere = new THREE.HemisphereLight(0xdff2ff, 0x84916f, 1.65)
    this.sun = new THREE.DirectionalLight(0xfff3d8, 2.35)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -.0002
    this.sun.shadow.normalBias = .45
    this.sun.shadow.radius = 2.8
    const bounds = this.campus.bounds_m
    const span = bounds ? Math.max(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y) : 1100
    this.span = Math.max(span, 100)
    Object.assign(this.sun.shadow.camera, { left: -this.span * .7, right: this.span * .7, top: this.span * .7, bottom: -this.span * .7, near: 1, far: this.span * 5 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.sun.target.position.copy(this.center)
    this.group.add(this.hemisphere, this.sun, this.sun.target)
    this.skyMaterial = this.own(new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
      uniforms: { topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, night: { value: 0 } },
      side: THREE.BackSide, depthWrite: false, fog: false }))
    this.sky = new THREE.Mesh(this.own(new THREE.SphereGeometry(9000, 24, 12)), this.skyMaterial)
    this.sky.frustumCulled = false
    this.sky.userData.bloomOcclusion = false
    this.sky.renderOrder = -10
    this.group.add(this.sky)
    this.decorateSurfaces()
    this.decorateBuildings()
    this.drawLandcovers()
    this.drawVegetation()
    this.drawFurniture()
    this.drawShops()
    this.update(.25)
    return this
  }

  noiseTexture(kind) {
    const [image, context] = canvas(256, 256)
    const random = seededRandom(`texture-${kind}-1`)
    const data = context.createImageData(256, 256)
    for (let i = 0; i < data.data.length; i += 4) {
      const noise = Math.floor(random() * (kind === 'grass' ? 23 : 16))
      const colours = kind === 'grass' ? [113 + noise, 145 + noise, 90 + noise] : [68 + noise, 80 + noise, 86 + noise]
      data.data[i] = colours[0]
      data.data[i + 1] = colours[1]
      data.data[i + 2] = colours[2]
      data.data[i + 3] = 255
    }
    context.putImageData(data, 0, 0)
    if (kind === 'grass') {
      for (let i = 0; i < 70; i += 1) {
        context.fillStyle = `rgba(214,218,136,${.08 + random() * .08})`
        context.beginPath()
        context.ellipse(random() * 256, random() * 256, 6 + random() * 17, 5 + random() * 12, random() * Math.PI, 0, Math.PI * 2)
        context.fill()
      }
    }
    return this.texture(image, kind === 'grass' ? [1 / 85, 1 / 85] : [1 / 22, 1 / 22])
  }

  decorateSurfaces() {
    const grass = this.own(new THREE.MeshStandardMaterial({ map: this.noiseTexture('grass'), roughness: 1, side: THREE.DoubleSide }))
    const asphalt = this.own(new THREE.MeshStandardMaterial({ map: this.noiseTexture('asphalt'), roughness: .96, side: THREE.DoubleSide }))
    const walkway = this.own(new THREE.MeshStandardMaterial({ color: 0xd1c5a8, roughness: 1, side: THREE.DoubleSide }))
    const roadEdge = this.own(new THREE.MeshStandardMaterial({ color: 0xb3b8a6, roughness: 1, side: THREE.DoubleSide }))
    // The backdrop is only 0.15 m below the campus. At a kilometre-wide overview
    // those depths can quantise to the same value in an offscreen render target,
    // producing stripes through otherwise flat grass. Draw it first without
    // writing depth; the real campus surfaces then always cover the backdrop.
    const outside = this.own(new THREE.MeshStandardMaterial({ color: 0x697867, roughness: 1, side: THREE.DoubleSide, depthWrite: false }))
    this.scene.traverse(mesh => {
      const kind = mesh.userData.environmentKind || mesh.userData.kind
      if (!mesh.isMesh || !kind) return
      const material = ({ base: outside, ground: grass, road: asphalt, path: walkway, roadEdge })[kind]
      if (material) {
        this.replaceMaterial(mesh, material)
        mesh.receiveShadow = true
        if (kind === 'base') mesh.renderOrder = -5
      }
    })
    // Also colour existing mixed-source footpaths without changing a single
    // point or edge in the walking graph. This is a shallow rendering ribbon.
    const footpaths = (this.campus.roads || []).filter(road => PATH_TYPES.has(road.highway))
    if (footpaths.length) this.group.add(new THREE.Mesh(this.own(roadRibbon(footpaths, .205)), walkway))
  }

  windowTextures(building, palette) {
    const [albedo, paint] = canvas(256, 256)
    const [emissive, light] = canvas(256, 256)
    paint.fillStyle = palette.wall
    paint.fillRect(0, 0, 256, 256)
    light.fillStyle = '#000000'
    light.fillRect(0, 0, 256, 256)
    const mask = windowPattern(building.osm_id)
    for (let row = 0; row < 4; row += 1) {
      paint.fillStyle = 'rgba(255,255,255,.13)'
      paint.fillRect(0, row * 64 + 59, 256, 4)
      for (let column = 0; column < 8; column += 1) {
        const x = column * 32 + 8
        const y = row * 64 + 13
        paint.fillStyle = '#e5e1ce'
        paint.fillRect(x - 2, y - 2, 21, 35)
        paint.fillStyle = palette.glass
        paint.fillRect(x, y, 17, 31)
        paint.fillStyle = 'rgba(171,214,227,.5)'
        paint.fillRect(x + 2, y + 2, 13, 6)
        paint.fillStyle = 'rgba(26,58,69,.45)'
        paint.fillRect(x + 8, y, 1, 31)
        if (mask[row][column]) {
          light.fillStyle = (row + column) % 3 === 0 ? '#ffc77b' : '#ffe2a4'
          light.fillRect(x, y, 17, 31)
          light.fillStyle = '#84765f'
          light.fillRect(x + 8, y, 1, 31)
        }
      }
    }
    // ExtrudeGeometry side UVs are in source metres. A tile is 8 windows wide
    // and 4 storeys high, using the same presentation storey height as the data.
    return { map: this.texture(albedo, [1 / 48, 1 / (4 * 3.2)]), emissive: this.texture(emissive, [1 / 48, 1 / (4 * 3.2)]) }
  }

  decorateBuildings() {
    const parapets = []
    const black = this.own(new THREE.MeshBasicMaterial({ color: 0x000000 }))
    for (const building of this.campus.buildings) {
      const mesh = this.buildingMeshes.get(building.osm_id)
      if (!mesh) continue
      const palette = buildingPalette(building)
      const textures = this.windowTextures(building, palette)
      const roof = this.own(new THREE.MeshStandardMaterial({ color: palette.roof, roughness: .87, metalness: .03 }))
      const wall = this.own(new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.map, emissive: 0xffffff,
        emissiveMap: textures.emissive, emissiveIntensity: 0, roughness: palette.kind === 'education' ? .45 : .84, metalness: .06 }))
      const glow = this.own(new THREE.MeshBasicMaterial({ color: 0x000000, map: textures.emissive, toneMapped: false }))
      this.replaceMaterial(mesh, [roof, wall])
      mesh.userData.bloomMaterial = [black, glow]
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.windowMaterials.push({ wall, glow })
      for (const child of mesh.children) if (child.isLineSegments) {
        // Keep original edge resources owned by the main renderer; do not mutate
        // their material. A temporary stronger outline is restored on dispose.
        this.replaceMaterial(child, this.own(new THREE.LineBasicMaterial({ color: palette.accent, transparent: true, opacity: .72 })))
      }
      for (let i = 1; i < building.polygon.length; i += 1) {
        const a = building.polygon[i - 1]
        const b = building.polygon[i]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length > .5) parapets.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, height: building.height_m + .55,
          length, angle: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), color: palette.accent })
      }
    }
    const rim = new THREE.InstancedMesh(this.own(new THREE.BoxGeometry(1, 1, 1)),
      this.own(new THREE.MeshStandardMaterial({ roughness: .85 })), parapets.length)
    const matrix = new THREE.Matrix4()
    const rotation = new THREE.Quaternion()
    const colour = new THREE.Color()
    for (const [i, edge] of parapets.entries()) {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -edge.angle)
      matrix.compose(new THREE.Vector3(edge.x, edge.height, -edge.y), rotation, new THREE.Vector3(edge.length, .65, .6))
      rim.setMatrixAt(i, matrix)
      rim.setColorAt(i, colour.set(edge.color))
    }
    rim.instanceMatrix.needsUpdate = true
    if (rim.instanceColor) rim.instanceColor.needsUpdate = true
    this.group.add(rim)
  }

  drawLandcovers() {
    this.landcoverGroup = new THREE.Group()
    this.landcoverGroup.name = 'OSM landcover'
    this.group.add(this.landcoverGroup)
    for (const feature of this.landcovers) {
      const ring = feature.polygon || feature.geometry?.coordinates?.[0]
      if (!ring?.length) continue
      const properties = feature.properties || feature
      const water = properties.kind === 'water' || properties.natural === 'water'
      const sport = properties.sport
      const colour = water ? 0x5b9faf : sport === 'basketball' ? 0xba816c : sport === 'tennis' ? 0x6b9daa : 0x77a686
      const material = this.own(new THREE.MeshStandardMaterial({ color: colour, roughness: water ? .35 : .95,
        metalness: water ? .18 : 0, side: THREE.DoubleSide }))
      const mesh = new THREE.Mesh(this.own(new THREE.ShapeGeometry(shape(ring))), material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = water ? .22 : .24
      mesh.userData.osm_id = feature.osm_id
      mesh.userData.landcover = true
      mesh.receiveShadow = true
      this.landcoverGroup.add(mesh)
      const line = new THREE.Line(this.own(new THREE.BufferGeometry().setFromPoints(ring.map(([x, y]) => new THREE.Vector3(x, .29, -y)))),
        this.own(new THREE.LineBasicMaterial({ color: water ? 0x9ad3cc : 0xe5e9d4, transparent: true, opacity: .72 })))
      this.landcoverGroup.add(line)
      if (!water && ring.length === 5) {
        const a = new THREE.Vector3((ring[0][0] + ring[1][0]) / 2, .3, -(ring[0][1] + ring[1][1]) / 2)
        const b = new THREE.Vector3((ring[2][0] + ring[3][0]) / 2, .3, -(ring[2][1] + ring[3][1]) / 2)
        const net = new THREE.Line(this.own(new THREE.BufferGeometry().setFromPoints([a, b])),
          this.own(new THREE.LineBasicMaterial({ color: 0xeff0dc, transparent: true, opacity: .65 })))
        this.landcoverGroup.add(net)
      }
    }
  }

  drawVegetation() {
    // The smaller parcel has fewer safe candidates. Reserve slots for each
    // furniture type instead of filling the complete pool with trees first.
    this.placements = decorationPlacements(this.campus, { landcovers: this.landcovers,
      ...(this.displayBounds ? { trees: 100, lamps: 20, benches: 12 } : {}) })
    if (this.displayBounds) {
      for (const [kind, inset] of [['trees', 7], ['lamps', 10], ['benches', 3]]) {
        this.placements[kind] = this.placements[kind].filter(point => pointInDisplay([point.x, point.y], this.displayBounds, inset))
      }
    }
    this.trees = new THREE.Group()
    this.trees.userData.illustrative = true
    this.trees.name = '装饰树木'
    const points = this.placements.trees
    const trunk = new THREE.InstancedMesh(this.own(new THREE.CylinderGeometry(.55, .8, 5.5, 5)),
      this.own(new THREE.MeshStandardMaterial({ color: 0x77594a, roughness: 1 })), points.length)
    const crown = new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(4.7, 0)),
      this.own(new THREE.MeshStandardMaterial({ roughness: 1 })), points.length)
    const top = new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(3.8, 0)),
      this.own(new THREE.MeshStandardMaterial({ roughness: 1 })), points.length)
    const dummy = new THREE.Object3D()
    const colour = new THREE.Color()
    for (const [i, point] of points.entries()) {
      dummy.rotation.set(0, point.angle, 0)
      dummy.scale.setScalar(point.scale)
      dummy.position.set(point.x, 2.7 * point.scale, -point.y)
      dummy.updateMatrix()
      trunk.setMatrixAt(i, dummy.matrix)
      dummy.position.y = 7.3 * point.scale
      dummy.scale.set(point.scale, point.scale * .9, point.scale)
      dummy.updateMatrix()
      crown.setMatrixAt(i, dummy.matrix)
      crown.setColorAt(i, colour.set([0x458765, 0x568d5e, 0x6d9c62][point.variant]))
      dummy.position.y = 10 * point.scale
      dummy.scale.set(point.scale * .9, point.scale, point.scale * .9)
      dummy.updateMatrix()
      top.setMatrixAt(i, dummy.matrix)
      top.setColorAt(i, colour.set([0x71a36b, 0x80aa74, 0x95b77b][point.variant]))
    }
    for (const object of [trunk, crown, top]) {
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
      object.castShadow = false
      this.trees.add(object)
    }
    this.group.add(this.trees)
  }

  drawFurniture() {
    const lamps = this.placements.lamps
    const stem = new THREE.InstancedMesh(this.own(new THREE.CylinderGeometry(.22, .3, 8, 5)),
      this.own(new THREE.MeshStandardMaterial({ color: 0x39494d, roughness: .78 })), lamps.length)
    const lightMaterial = this.own(new THREE.MeshBasicMaterial({ color: 0x1d180d, toneMapped: false }))
    const light = new THREE.InstancedMesh(this.own(new THREE.SphereGeometry(.9, 6, 4)), lightMaterial, lamps.length)
    light.userData.bloom = true
    const [image, context] = canvas(64, 64)
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,223,141,.55)')
    gradient.addColorStop(.35, 'rgba(255,216,123,.2)')
    gradient.addColorStop(1, 'rgba(255,211,118,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
    const poolMaterial = this.own(new THREE.MeshBasicMaterial({ map: this.texture(image), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
    const pools = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(18, 18)), poolMaterial, lamps.length)
    pools.userData.bloom = true
    const dummy = new THREE.Object3D()
    for (const [i, point] of lamps.entries()) {
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.position.set(point.x, 4, -point.y)
      dummy.updateMatrix()
      stem.setMatrixAt(i, dummy.matrix)
      dummy.position.y = 8.3
      dummy.updateMatrix()
      light.setMatrixAt(i, dummy.matrix)
      dummy.rotation.x = -Math.PI / 2
      dummy.position.y = .31
      dummy.updateMatrix()
      pools.setMatrixAt(i, dummy.matrix)
    }
    for (const item of [stem, light, pools]) item.instanceMatrix.needsUpdate = true
    this.lightMaterials.push({ material: lightMaterial, colour: new THREE.Color('#ffe0a0'), multiplier: 2.2 }, { material: poolMaterial, opacity: .7 })
    this.group.add(stem, light, pools)
    const seats = this.placements.benches
    const wood = this.own(new THREE.MeshStandardMaterial({ color: 0xb78a5e, roughness: .95 }))
    const metal = this.own(new THREE.MeshStandardMaterial({ color: 0x45504c, roughness: .8 }))
    for (const [size, offset, material] of [
      [[4.6, .35, 1.3], [0, 1.0, 0], wood], [[4.6, 1.35, .25], [0, 1.7, .65], wood],
      [[.25, 1, 1.2], [-1.7, .5, 0], metal], [[.25, 1, 1.2], [1.7, .5, 0], metal],
    ]) {
      const instanced = new THREE.InstancedMesh(this.own(new THREE.BoxGeometry(...size)), material, seats.length)
      for (const [i, point] of seats.entries()) {
        dummy.rotation.set(0, -point.angle, 0)
        dummy.position.set(point.x, 0, -point.y)
        dummy.updateMatrix()
        const local = new THREE.Matrix4().makeTranslation(...offset)
        instanced.setMatrixAt(i, dummy.matrix.clone().multiply(local))
      }
      instanced.instanceMatrix.needsUpdate = true
      this.group.add(instanced)
    }
  }

  shopFacade(building) {
    const center = centroid(building.polygon)
    const road = (this.campus.walk_graph?.nodes || []).reduce((best, node) => !best || Math.hypot(node.x - center.x, node.y - center.y) < Math.hypot(best.x - center.x, best.y - center.y) ? node : best, null)
    let best = null
    let distance = Infinity
    for (let i = 1; i < building.polygon.length; i += 1) {
      const a = building.polygon[i - 1]
      const b = building.polygon[i]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 7) continue
      const x = (a[0] + b[0]) / 2
      const y = (a[1] + b[1]) / 2
      const score = Math.hypot(x - (road?.x ?? center.x), y - (road?.y ?? center.y))
      if (score < distance) {
        distance = score
        let angle = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
        // Local +z is the shop front. Face it toward the road anchor rather
        // than placing signs and awnings inside the footprint by winding luck.
        if (road && (road.x - x) * (b[1] - a[1]) - (road.y - y) * (b[0] - a[0]) < 0) angle += Math.PI
        best = { x, y, length, angle }
      }
    }
    return best || { x: center.x, y: center.y, length: 14, angle: 0 }
  }

  drawShops() {
    const entries = Object.entries(this.mapping.mappings).filter(([key]) => key.startsWith('shop_'))
    const colours = ['#168b7a', '#db784c']
    for (const [index, [, mapping]] of entries.entries()) {
      const building = this.campus.buildings.find(item => item.osm_id === mapping.osm_id)
      if (!building) continue
      const facade = this.shopFacade(building)
      const group = new THREE.Group()
      group.position.set(facade.x, 0, -facade.y)
      group.rotation.y = -facade.angle
      const width = Math.min(18, facade.length * .75)
      const [image, context] = canvas(512, 128)
      context.fillStyle = colours[index % colours.length]
      context.fillRect(0, 0, 512, 128)
      context.fillStyle = '#fff7dc'
      context.font = '700 52px "Microsoft YaHei",sans-serif'
      context.textAlign = 'center'
      context.fillText(`MECOFFE ${String.fromCharCode(65 + index)}`, 256, 57)
      context.font = '28px "Microsoft YaHei",sans-serif'
      context.fillText('示意门店 · COFFEE', 256, 104)
      const signMap = this.texture(image)
      const signMaterial = this.own(new THREE.MeshBasicMaterial({ map: signMap, side: THREE.DoubleSide, toneMapped: false, color: 0xffffff }))
      const sign = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, width / 4)), signMaterial)
      sign.position.set(0, 5.8, .45)
      sign.userData.bloom = true
      group.add(sign)
      const [awningImage, paint] = canvas(256, 64)
      for (let stripe = 0; stripe < 16; stripe += 1) {
        paint.fillStyle = stripe % 2 ? '#fff2d3' : colours[index % colours.length]
        paint.fillRect(stripe * 16, 0, 16, 64)
      }
      const canopy = new THREE.Mesh(this.own(new THREE.BoxGeometry(width + 1, .35, 3.2)),
        this.own(new THREE.MeshStandardMaterial({ map: this.texture(awningImage), roughness: .8 })))
      canopy.position.set(0, 3.6, 1.1)
      group.add(canopy)
      const glowMaterial = this.own(new THREE.MeshBasicMaterial({ color: colours[index % colours.length], transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
      const circle = new THREE.Mesh(this.own(new THREE.RingGeometry(8, 9, 36)), glowMaterial)
      circle.rotation.x = -Math.PI / 2
      circle.position.set(0, .33, 4)
      circle.userData.bloom = true
      group.add(circle)
      this.lightMaterials.push({ material: glowMaterial, opacity: .6, minimum: .22 })
      this.group.add(group)
    }
  }

  update(phase = this.phase, camera = null) {
    if (this.disposed) return
    this.phase = phase
    this.renderer.shadowMap.needsUpdate = this.quality === 'high'
    const light = dayLighting(phase)
    this.hemisphere.color.set(light.ambientSky)
    this.hemisphere.groundColor.set(light.ambientGround)
    this.hemisphere.intensity = light.hemi
    this.sun.color.set(light.sun)
    this.sun.intensity = light.strength
    this.sun.position.copy(this.center).add(new THREE.Vector3(...light.sunDirection).multiplyScalar(this.span * 1.3))
    this.skyMaterial.uniforms.topColor.value.set(light.sky)
    this.skyMaterial.uniforms.horizonColor.value.set(light.horizon)
    this.skyMaterial.uniforms.night.value = light.night
    if (camera) this.sky.position.copy(camera.position)
    this.scene.fog.color.set(light.fog)
    this.scene.fog.density = light.fogDensity
    this.scene.background = new THREE.Color(light.horizon)
    this.renderer.toneMappingExposure = light.exposure
    for (const { wall, glow } of this.windowMaterials) {
      wall.emissiveIntensity = light.night * 2.0
      glow.color.setScalar(light.night * 2.2)
    }
    for (const item of this.lightMaterials) {
      if (item.colour) item.material.color.copy(item.colour).multiplyScalar(.09 + light.night * item.multiplier)
      if (item.opacity !== undefined) item.material.opacity = (item.minimum || 0) + light.night * item.opacity
    }
    return light
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'high'
    if (this.trees) this.trees.visible = this.quality === 'high'
    this.renderer.shadowMap.enabled = this.quality === 'high'
    this.sun.castShadow = this.quality === 'high'
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.group)
    this.scene.fog = this.previousFog
    this.scene.background = this.previousBackground
    for (const [mesh, previous] of this.replaced) {
      mesh.material = previous.material
      mesh.renderOrder = previous.renderOrder
      if (previous.bloomMaterial === undefined) delete mesh.userData.bloomMaterial
      else mesh.userData.bloomMaterial = previous.bloomMaterial
    }
    this.replaced.clear()
    this.sun?.shadow.map?.dispose()
    this.sun?.shadow.mapPass?.dispose()
    for (const resource of this.resources) resource.dispose()
    this.resources.clear()
    this.group.clear()
    this.renderer.shadowMap.enabled = this.previousShadow.enabled
    this.renderer.shadowMap.type = this.previousShadow.type
    this.renderer.shadowMap.autoUpdate = this.previousShadow.autoUpdate
  }
}
