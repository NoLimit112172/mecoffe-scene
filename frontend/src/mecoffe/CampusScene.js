// 固定校园场景：复用 YuLan-OneSim 的图集素材（建筑、室内、家具、人物、气泡），
// 布局来自 scene/campus.json。人默认在各自楼栋里，鼠标悬停楼栋可看到每层室内；
// 购买时从楼门走到门店再回来。所有位置与行走都是示意，OASIS 运行本身没有位置。
import * as PIXI from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import { buildingIndex, computeHomes, counterSpread, floorCount, hashOf, laneOffset, routeToShop } from './layout'

export const BRAND_COLORS = ['#1f8a70', '#d9603b', '#5b6fb5', '#b08a2e']
const KIND_TINT = {
  teaching: 0x7fa7d6, library: 0xa995d1, dormitory: 0xe0b483, faculty: 0x86c2ad,
  coffee_shop: 0xe8d3b0, public_space: 0xb0d48f,
}
const FX = { post: 0x3d6fb6, comment: 0x8a5bd1, follow: 0x9aa3a0, interview: 0xe0a21b, failed: 0xd64545, exposure: 0x7d8783 }
const FONT = '"PingFang SC","Microsoft YaHei",sans-serif'
const MAX_FX = 220
const WALK_SPEED_PX = 1300   // 1× 播放速度下每秒走多少像素
const SHOP_DWELL_MS = 700    // 在柜台停留多久再往回走
const PERSON_HEIGHT = 62     // 室外人物高度（像素）

const toHex = (css) => Number.parseInt(css.replace('#', ''), 16)

let atlasPromise = null
export function loadAtlases() {
  if (!atlasPromise) {
    atlasPromise = (async () => {
      const textures = {}
      const animations = {}
      for (let i = 0; i < 3; i += 1) {
        const sheet = await PIXI.Assets.load(`/assets/bgrd-${i}.json`)
        Object.assign(textures, sheet.textures)
        Object.assign(animations, sheet.animations || {})
      }
      const headCounts = {}
      for (const key of Object.keys(textures)) {
        const match = key.match(/^head\/([fm])\/([efhm])\/(\d+)\.png$/)
        if (match) headCounts[`${match[1]}/${match[2]}`] = Math.max(headCounts[`${match[1]}/${match[2]}`] || 0, Number(match[3]))
      }
      return { textures, animations, headCounts }
    })()
  }
  return atlasPromise
}

function text(content, size, fill, weight = '600') {
  const label = new PIXI.Text({ text: content, style: { fontFamily: FONT, fontSize: size, fill, fontWeight: weight } })
  label.resolution = 2
  return label
}

function pill(content, { size = 16, fill = 0xffffff, color = '#ffffff', radius = 12, padX = 10, padY = 5, stroke = null } = {}) {
  const label = text(content, size, color, '700')
  label.anchor.set(0.5)
  const box = new PIXI.Graphics()
    .roundRect(-label.width / 2 - padX, -label.height / 2 - padY, label.width + padX * 2, label.height + padY * 2, radius)
    .fill({ color: fill })
  if (stroke) box.stroke({ width: 2, color: stroke })
  const node = new PIXI.Container()
  node.addChild(box, label)
  return node
}

export class CampusScene {
  constructor({ onSelect, onHoverBuilding } = {}) {
    this.onSelect = onSelect
    this.onHoverBuilding = onHoverBuilding
    this.people = new Map()     // id -> entry
    this.houses = new Map()     // buildingId -> house record
    this.shops = new Map()      // brandId -> { x, y }
    this.fx = []
    this.networkRelations = [] // 当前选中人物的真实有向关注边，与临时事件动画分开
    this.selectedId = null
    this.walkMode = true
    this.playbackPaused = false
    this.speed = 1
    this.walkers = new Set()
    this.hovered = null
    this.pinned = null
  }

  async mount(element, index) {
    this.element = element
    this.index = index
    this.campus = index.scene.campus
    this.tile = this.campus.grid.tile_px
    this.buildings = buildingIndex(this.campus)
    this.brandColor = new Map(index.scene.brands.map((b, k) => [b.brand_id, BRAND_COLORS[k % BRAND_COLORS.length]]))

    this.app = new PIXI.Application()
    await this.app.init({
      width: element.clientWidth, height: element.clientHeight,
      background: 0xcfe0c3, antialias: true,
      resolution: window.devicePixelRatio || 1, autoDensity: true,
    })
    element.appendChild(this.app.canvas)
    this.assets = await loadAtlases()

    const worldWidth = this.campus.grid.width * this.tile
    const worldHeight = this.campus.grid.height * this.tile
    this.viewport = new Viewport({
      screenWidth: element.clientWidth, screenHeight: element.clientHeight,
      worldWidth, worldHeight, events: this.app.renderer.events,
    })
    this.viewport.drag().pinch().wheel({ smooth: 6 }).decelerate()
    this.viewport.clampZoom({ minScale: 0.15, maxScale: 2.5 })
    this.viewport.on('moved', () => this.emitHover())
    this.viewport.on('zoomed', () => this.emitHover())
    this.app.stage.addChild(this.viewport)

    this.groundLayer = new PIXI.Container()
    this.objectLayer = new PIXI.Container()
    this.objectLayer.sortableChildren = true
    this.networkLayer = new PIXI.Container()
    this.networkLayer.eventMode = 'none'
    this.fxLayer = new PIXI.Container()
    this.labelLayer = new PIXI.Container()
    this.viewport.addChild(this.groundLayer, this.objectLayer, this.networkLayer, this.fxLayer, this.labelLayer)

    this.homes = computeHomes(index.scene)
    this.drawGround(worldWidth, worldHeight)
    this.drawLocations()
    this.placePeople()
    this.refreshPopulation()
    this.fitAll()

    this.tick = (ticker) => this.advanceAnimations(ticker.deltaMS)
    this.app.ticker.add(this.tick)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(element)
  }

  // ---------- 地面与道路 ----------
  drawGround(worldWidth, worldHeight) {
    const t = this.assets.textures
    const grass = new PIXI.TilingSprite({ texture: t['bg/grass_1.png'], width: worldWidth, height: worldHeight })
    grass.tileScale.set(this.tile / 128)
    this.groundLayer.addChild(grass)

    const roads = this.campus.grid.roads
    const pairs = (list) => list.filter((value, k) => k % 2 === 0)
    for (const row of pairs(roads.horizontal_rows)) {
      const road = new PIXI.TilingSprite({ texture: t['bg/road_02.png'], width: worldWidth, height: this.tile * 2 })
      road.y = row * this.tile
      road.tileScale.set((this.tile * 2) / 128)
      this.groundLayer.addChild(road)
    }
    for (const col of pairs(roads.vertical_cols)) {
      const road = new PIXI.TilingSprite({ texture: t['bg/road_03.png'], width: this.tile * 2, height: worldHeight })
      road.x = col * this.tile
      road.tileScale.set((this.tile * 2) / 128)
      this.groundLayer.addChild(road)
      for (const row of pairs(roads.horizontal_rows)) {
        const cross = new PIXI.Sprite(t['bg/road_01.png'])
        cross.position.set(col * this.tile, row * this.tile)
        cross.setSize(this.tile * 2, this.tile * 2)
        this.groundLayer.addChild(cross)
      }
    }
  }

  // ---------- 地点、楼栋、室内 ----------
  drawLocations() {
    const t = this.assets.textures
    for (const location of this.campus.locations) {
      const { x, y, w, h } = location.block
      const brand = location.brand_id
      const tint = brand ? toHex(this.brandColor.get(brand)) : (KIND_TINT[location.kind] || 0xcccccc)
      const pad = this.tile * 0.3
      const area = new PIXI.Graphics()
        .roundRect(x * this.tile + pad, y * this.tile + pad, w * this.tile - pad * 2, h * this.tile - pad * 2, 22)
        .fill({ color: tint, alpha: brand ? 0.18 : 0.2 })
        .stroke({ width: 3, color: tint, alpha: 0.5 })
      this.groundLayer.addChild(area)

      for (const building of location.buildings || []) {
        if (building.style === 'villa') {
          const villa = this.makeVilla(building, t)
          if (villa) this.objectLayer.addChild(villa)
        } else {
          this.makeHouse(building, location, t)
        }
      }
      if (brand && location.counter) {
        this.shops.set(brand, { x: location.counter[0] * this.tile, y: (location.counter[1] - 0.6) * this.tile })
      }

      const sign = pill(location.name, { size: 24, fill: 0xffffff, color: brand ? this.brandColor.get(brand) : '#24332b', radius: 14, padX: 14, padY: 7, stroke: tint })
      sign.position.set(x * this.tile + pad + sign.width / 2 + 10, y * this.tile + pad + sign.height / 2 + 10)
      this.labelLayer.addChild(sign)
    }
    for (const group of this.campus.decorations || []) {
      for (const [dx, dy] of group.at) {
        const texture = t[group.texture]
        if (!texture) continue
        const tree = new PIXI.Sprite(texture)
        tree.anchor.set(0.5, 1)
        tree.scale.set((this.tile * 1.4) / texture.width)
        tree.position.set((dx + 0.5) * this.tile, (dy + 1) * this.tile)
        tree.zIndex = tree.y
        this.objectLayer.addChild(tree)
      }
    }
  }

  makeHouse(b, location, t) {
    const key = (part) => t[`house/${b.type}/${b.type}_${b.model}_${part}.png`]
    const [roofTexture, floorTexture, baseTexture] = ['2', '1', '0'].map(key)
    if (!roofTexture || !floorTexture || !baseTexture) return
    const width = b.w * this.tile
    const floors = floorCount(b)
    const container = new PIXI.Container()
    const pieces = []           // 自下而上：底层、各标准层
    let bottom = 0
    for (let level = 0; level < floors; level += 1) {
      const texture = level === 0 ? baseTexture : floorTexture
      const piece = new PIXI.Sprite(texture)
      piece.scale.set(width / texture.width)
      piece.y = bottom - piece.height
      bottom = piece.y
      container.addChild(piece)
      pieces.push({ sprite: piece, top: piece.y, height: piece.height, level })
    }
    const roof = new PIXI.Sprite(roofTexture)
    roof.scale.set(width / roofTexture.width)
    roof.y = bottom - roof.height
    container.addChild(roof)

    container.position.set(b.x * this.tile, (b.y + b.h) * this.tile)
    container.zIndex = container.y
    container.eventMode = 'static'
    container.cursor = 'pointer'
    container.hitArea = new PIXI.Rectangle(0, roof.y, width, -roof.y)
    container.on('pointerenter', () => { this.hovered = b.building_id; this.updateInteriors(); this.emitHover() })
    container.on('pointerleave', () => { if (this.hovered === b.building_id) this.hovered = null; this.updateInteriors(); this.emitHover() })
    this.objectLayer.addChild(container)

    const badge = new PIXI.Container()
    badge.position.set(container.x + width / 2, container.y + roof.y - 18)
    this.labelLayer.addChild(badge)

    this.houses.set(b.building_id, {
      building: b, location, container, pieces, roofTop: roof.y, width, interior: null, badge,
      residents: [],
    })
  }

  makeVilla(b, t) {
    const texture = t[`villa/${b.type}/${b.type}_${b.model}.png`]
    if (!texture) return null
    const villa = new PIXI.Sprite(texture)
    villa.anchor.set(0.5, 1)
    villa.scale.set(Math.min((b.w * this.tile) / texture.width, (b.h * this.tile) / texture.height))
    villa.position.set((b.x + b.w / 2) * this.tile, (b.y + b.h) * this.tile)
    villa.zIndex = villa.y
    return villa
  }

  // 第一次悬停时才生成室内：每层一张剖面图 + 家具 + 楼里的人
  buildInterior(house) {
    const t = this.assets.textures
    const b = house.building
    const interior = new PIXI.Container()
    interior.visible = false
    const furnitureWidth = Math.max(2, Math.min(4, Math.round(b.w)))
    const rooms = house.pieces.map((piece) => {
      const texture = t[`house/${b.type}/${b.type}_${b.model}_${piece.level === 0 ? 4 : 3}.png`]
        || t[`house/${b.type}/${b.type}_1_${piece.level === 0 ? 4 : 3}.png`]
      const room = new PIXI.Container()
      let roomHeight = piece.height
      if (texture) {
        const floor = new PIXI.Sprite(texture)
        floor.width = house.width
        floor.height = house.width * (texture.height / texture.width)
        floor.y = piece.top + piece.height - floor.height
        roomHeight = floor.height
        room.addChild(floor)
      }
      const furnitureTexture = t[`furniture/${furnitureWidth}_${1 + (hashOf(`${b.building_id}:${piece.level}`) % 2)}.png`]
      if (furnitureTexture) {
        const furniture = new PIXI.Sprite(furnitureTexture)
        furniture.scale.set((house.width * 0.86) / furnitureTexture.width)
        furniture.position.set(house.width * 0.07, piece.top + piece.height - roomHeight * 0.78)
        furniture.alpha = 0.95
        room.addChild(furniture)
      }
      interior.addChild(room)
      return { room, top: piece.top + piece.height - roomHeight, bottom: piece.top + piece.height - roomHeight * 0.08 }
    })
    house.rooms = rooms
    house.figures = new Map()
    for (const id of house.residents) {
      const entry = this.people.get(id)
      const home = this.homes.get(id)
      const room = rooms[home.floor]
      const figureHeight = Math.min(PERSON_HEIGHT * 0.85, (room.bottom - room.top) * 0.62)
      const { container } = this.makeFigure(entry.person, figureHeight)
      const slots = home.perFloor
      container.position.set(house.width * (0.12 + 0.76 * (home.slot + 0.5) / slots), room.bottom)
      container.eventMode = 'static'
      container.cursor = 'pointer'
      container.on('pointertap', (e) => { e.stopPropagation(); this.onSelect?.(id) })
      const ring = new PIXI.Graphics().ellipse(0, 0, figureHeight * 0.36, figureHeight * 0.11).stroke({ width: 3, color: 0xffb400 })
      ring.visible = false
      container.addChildAt(ring, 0)
      const cups = new PIXI.Container()
      cups.position.set(0, -figureHeight - 8)
      cups.scale.set(0.8)
      container.addChild(cups)
      interior.addChild(container)
      house.figures.set(id, { container, ring, cups, cupsKey: '' })
    }
    house.container.addChild(interior)
    house.interior = interior
  }

  updateInteriors() {
    for (const [buildingId, house] of this.houses) {
      const show = buildingId === this.hovered || buildingId === this.pinned
      if (show && !house.interior) this.buildInterior(house)
      if (!house.interior) continue
      house.interior.visible = show
      house.container.zIndex = show ? 1e6 : house.container.y
      if (!show) continue
      for (const [id, figure] of house.figures) {
        const entry = this.people.get(id)
        figure.container.visible = !entry.trip
        figure.ring.visible = id === this.selectedId
        const key = JSON.stringify(entry.cups)
        if (key !== figure.cupsKey) {
          figure.cupsKey = key
          this.fillCupChips(figure.cups, entry.cups)
        }
      }
    }
  }

  fillCupChips(container, cups) {
    container.removeChildren().forEach(child => child.destroy({ children: true }))
    const brands = Object.entries(cups || {}).filter(([, n]) => n > 0)
    container.visible = brands.length > 0
    let offset = -(brands.length - 1) * 17
    for (const [brandId, count] of brands) {
      const chip = pill(`☕${count}`, { size: 14, fill: toHex(this.brandColor.get(brandId) || '#555555'), color: '#ffffff', radius: 10, padX: 6, padY: 2 })
      chip.x = offset
      offset += 34
      container.addChild(chip)
    }
  }

  emitHover() {
    if (!this.onHoverBuilding) return
    const buildingId = this.hovered || this.pinned
    const house = buildingId && this.houses.get(buildingId)
    if (!house) { this.onHoverBuilding(null); return }
    const topLeft = this.viewport.toScreen(house.container.x, house.container.y + house.roofTop)
    const bottomRight = this.viewport.toScreen(house.container.x + house.width, house.container.y)
    const away = house.residents.filter(id => this.people.get(id).trip)
    this.onHoverBuilding({
      buildingId, name: house.building.name, locationName: house.location.name,
      residents: house.residents, away, pinned: buildingId === this.pinned && buildingId !== this.hovered,
      left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y,
    })
  }

  // ---------- 人物 ----------
  makeFigure(person, height) {
    const { textures: t, animations } = this.assets
    const h = hashOf(person.id)
    const gender = person.gender || (h % 2 ? 'm' : 'f')
    const typeId = { merchant: '4', teacher_consumer: '2' }[person.role] || '5'
    const variant = 1 + ((h >>> 3) % 4)
    const frames = animations[`character/${gender}/${typeId}_${variant}`] || animations['character/f/5_1']
    const body = frames?.length
      ? new PIXI.AnimatedSprite(frames.map(frame => (typeof frame === 'string' ? t[frame] : frame)))
      : new PIXI.Sprite(t[`character/${gender}/${typeId}_${variant}/1.png`] || t['character/f/5_1/1.png'])
    if (body instanceof PIXI.AnimatedSprite) {
      body.animationSpeed = 0.18
      body.gotoAndStop(0)
    }
    const figure = new PIXI.Container()
    figure.addChild(body)
    const head = this.makeHead(gender, h)
    if (head) {
      head.position.set(body.width / 2 - head.width / 2, -head.height)
      figure.addChild(head)
    }
    const bounds = figure.getLocalBounds()
    figure.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height)
    figure.scale.set(height / bounds.height)
    const container = new PIXI.Container()
    const shadow = new PIXI.Graphics().ellipse(0, 0, height * 0.22, height * 0.07).fill({ color: 0x000000, alpha: 0.18 })
    container.addChild(shadow, figure)
    return { container, figure, body }
  }

  makeHead(gender, h) {
    const { textures: t, headCounts } = this.assets
    const pick = (part, salt) => {
      const count = headCounts[`${gender}/${part}`]
      return count ? 1 + (Math.imul(h ^ salt, 2654435761) >>> 0) % count : null
    }
    const config = { f: pick('f', 11), e: pick('e', 23), m: pick('m', 37), h: pick('h', 53) }
    const head = new PIXI.Container()
    head.sortableChildren = true
    let width = 0
    let height = 0
    const parts = []
    for (const [part, z] of [['f', 4], ['e', 5], ['m', 5], ['h', 6]]) {
      const texture = config[part] && t[`head/${gender}/${part}/${config[part]}.png`]
      if (!texture) continue
      const sprite = new PIXI.Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.zIndex = z
      width = Math.max(width, texture.width)
      height = Math.max(height, texture.height)
      parts.push([part, sprite, texture])
      head.addChild(sprite)
    }
    if (!parts.length) return null
    for (const [part, sprite, texture] of parts) sprite.position.set(width / 2, part === 'h' ? texture.height / 2 : height / 2)
    const hair = parts.find(([part]) => part === 'h')
    const lower = hair && t[`head/${gender}/h/${config.h}_0.png`]
    if (lower) {
      const sprite = new PIXI.Sprite(lower)
      sprite.anchor.set(0.5, 0)
      sprite.zIndex = 3
      sprite.position.set(width / 2, hair[2].height)
      head.addChild(sprite)
    }
    return head
  }

  placePeople() {
    for (const person of this.index.scene.people) {
      const home = this.homes.get(person.id)
      const height = home.kind === 'outdoor' ? Math.min(PERSON_HEIGHT * 1.05, home.height * this.tile) : PERSON_HEIGHT
      const { container, figure, body } = this.makeFigure(person, height)
      const ring = new PIXI.Graphics().ellipse(0, 0, height * 0.34, height * 0.12).stroke({ width: 4, color: 0xffb400 })
      ring.visible = false
      container.addChildAt(ring, 0)
      const cupBadge = new PIXI.Container()
      cupBadge.position.set(0, -height - 12)
      container.addChild(cupBadge)
      const nameTag = pill(person.name, { size: 15, fill: 0x24332b, color: '#ffffff', radius: 9, padX: 7, padY: 3 })
      nameTag.position.set(0, 16)
      nameTag.visible = false
      container.addChild(nameTag)

      const x = home.x * this.tile
      const y = home.y * this.tile
      container.position.set(x, y)
      container.zIndex = y
      container.eventMode = 'static'
      container.cursor = 'pointer'
      container.hitArea = new PIXI.Rectangle(-height * 0.3, -height, height * 0.6, height)
      container.on('pointertap', () => this.onSelect?.(person.id))
      container.visible = home.kind === 'outdoor'
      this.objectLayer.addChild(container)

      const entry = {
        id: person.id, person, home, node: container, figure, body, ring, cupBadge, nameTag,
        homeX: x, homeY: y, x, y, height, trip: null, queue: [], cups: {},
      }
      this.people.set(person.id, entry)
      if (home.kind === 'indoor') this.houses.get(home.buildingId)?.residents.push(person.id)
    }
  }

  // 楼顶人数牌：楼内 / 外出人数 + 这栋楼的人累计买了几杯（分品牌）
  refreshPopulation() {
    for (const house of this.houses.values()) {
      const inside = house.residents.filter(id => !this.people.get(id).trip).length
      const away = house.residents.length - inside
      const key = `${inside}|${away}|${house.residents.map(id => JSON.stringify(this.people.get(id).cups)).join()}`
      if (key === house.badgeKey) continue
      house.badgeKey = key
      house.badge.removeChildren().forEach(child => child.destroy({ children: true }))
      const row = new PIXI.Container()
      const people = pill(away ? `👥 ${inside} · 外出 ${away}` : `👥 ${inside}`, {
        size: 17, fill: away ? 0xfff1cf : 0xffffff, color: '#24332b', radius: 12, padX: 10, padY: 4, stroke: 0xd9cfb8,
      })
      row.addChild(people)
      let x = people.width / 2 + 6
      const totals = {}
      for (const id of house.residents) {
        for (const [brand, n] of Object.entries(this.people.get(id).cups)) totals[brand] = (totals[brand] || 0) + n
      }
      for (const [brand, n] of Object.entries(totals)) {
        if (!n) continue
        const chip = pill(`☕${n}`, { size: 15, fill: toHex(this.brandColor.get(brand) || '#555555'), color: '#ffffff', radius: 11, padX: 7, padY: 3 })
        chip.x = x + chip.width / 2
        x += chip.width + 4
        row.addChild(chip)
      }
      row.x = -(x - people.width / 2 - 6) / 2
      house.badge.addChild(row)
    }
  }

  // 事件的锚点：在楼里的人取所在楼层窗口的位置，外出或站在室外的人取头顶
  anchorOf(personId) {
    const entry = this.people.get(personId)
    if (!entry) return null
    if (entry.home.kind === 'indoor' && !entry.trip) {
      const house = this.houses.get(entry.home.buildingId)
      if (house) {
        const piece = house.pieces[entry.home.floor] || house.pieces[0]
        return {
          x: house.container.x + house.width * (0.12 + 0.76 * (entry.home.slot + 0.5) / entry.home.perFloor),
          y: house.container.y + piece.top + piece.height * 0.4,
        }
      }
    }
    return { x: entry.x, y: entry.y - entry.height * 0.95 }
  }

  // 新版网络只显示所选人物的相邻关系；方向直接使用快照 source → target，
  // 不从发帖、历史关注动作或人物之间的距离推断。连线随 viewport 一起缩放、移动。
  showNetworkRelations(personId) {
    this.clearNetworkRelations()
    if (!this.networkLayer || !this.people.has(personId)) return
    for (const edge of this.index.scene.relationships || []) {
      if (edge.relation !== 'follow' || (edge.source !== personId && edge.target !== personId)) continue
      const outgoing = edge.source === personId
      const node = new PIXI.Graphics()
      const item = { source: edge.source, target: edge.target, relation: edge.relation, outgoing, node }
      this.networkLayer.addChild(node)
      this.networkRelations.push(item)
      this.drawNetworkRelation(item)
    }
  }

  // 只刷新所选人物的相邻边，复用 Graphics；外出人物的箭头跟随头顶，不重建全网。
  refreshNetworkRelations() {
    for (const item of this.networkRelations) this.drawNetworkRelation(item)
  }

  drawNetworkRelation(item) {
    const from = this.anchorOf(item.source)
    const to = this.anchorOf(item.target)
    if (!from || !to) { item.node.visible = false; return }
    const coordinates = [from.x, from.y, to.x, to.y]
    if (item.coordinates?.every((value, k) => value === coordinates[k])) return
    item.coordinates = coordinates
    const node = item.node.clear()
    const color = item.outgoing ? 0x2f6fb3 : 0xd99a1b
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    node.visible = distance >= 1
    if (!node.visible) return
    const nx = -(to.y - from.y) / distance
    const ny = (to.x - from.x) / distance
    // 同时存在两条反向关系时，各自沿行进方向偏弯，避免箭头重合。
    const bend = Math.min(180, Math.max(35, distance * 0.14))
    const control = {
      x: Math.max(12, Math.min(this.campus.grid.width * this.tile - 12, (from.x + to.x) / 2 + nx * bend)),
      y: Math.max(12, Math.min(this.campus.grid.height * this.tile - 12, (from.y + to.y) / 2 + ny * bend)),
    }
    const tangent = Math.atan2(to.y - control.y, to.x - control.x)
    const arrowSize = 15
    node
      .moveTo(from.x, from.y)
      .quadraticCurveTo(control.x, control.y, to.x, to.y)
      .stroke({ width: 4, color, alpha: 0.82, cap: 'round' })
      .moveTo(to.x, to.y)
      .lineTo(to.x - Math.cos(tangent - 0.45) * arrowSize, to.y - Math.sin(tangent - 0.45) * arrowSize)
      .lineTo(to.x - Math.cos(tangent + 0.45) * arrowSize, to.y - Math.sin(tangent + 0.45) * arrowSize)
      .closePath()
      .fill({ color, alpha: 1 })
    node.circle(from.x, from.y, 5).fill({ color, alpha: 0.9 })
  }

  clearNetworkRelations() {
    this.networkLayer?.removeChildren().forEach(node => node.destroy())
    this.networkRelations = []
  }

  // ---------- 杯数、选择与镜头 ----------
  setCups(cupsByPerson) {
    for (const [id, entry] of this.people) this.drawCups(entry, cupsByPerson.get(id))
    this.refreshPopulation()
    this.updateInteriors()
  }

  addCup(personId, brandId) {
    const entry = this.people.get(personId)
    if (!entry) return
    const cups = { ...entry.cups }
    cups[brandId] = (cups[brandId] || 0) + 1
    this.drawCups(entry, cups)
    this.refreshPopulation()
    if (this.hovered || this.pinned) this.updateInteriors()
  }

  drawCups(entry, cups) {
    entry.cups = cups ? { ...cups } : {}
    this.fillCupChips(entry.cupBadge, entry.cups)
  }

  select(personId) {
    const previous = this.people.get(this.selectedId)
    if (previous) { previous.ring.visible = false; previous.nameTag.visible = false }
    this.selectedId = personId
    const current = this.people.get(personId)
    this.pinned = current && current.home.kind === 'indoor' ? current.home.buildingId : null
    if (current) { current.ring.visible = true; current.nameTag.visible = true }
    this.updateInteriors()
    this.emitHover()
  }

  unpin() {
    this.pinned = null
    this.updateInteriors()
    this.emitHover()
  }

  focus(personId) {
    const point = this.anchorOf(personId)
    if (!point) return
    this.viewport.animate({ position: new PIXI.Point(point.x, point.y + 60), scale: 0.95, time: 650, ease: 'easeInOutSine', callbackOnComplete: () => this.emitHover() })
  }

  fitAll() {
    const worldWidth = this.campus.grid.width * this.tile
    const worldHeight = this.campus.grid.height * this.tile
    this.viewport.fit(true, worldWidth * 1.02, worldHeight * 1.04)
    this.viewport.moveCenter(worldWidth / 2, worldHeight / 2)
    this.emitHover()
  }

  resize() {
    if (!this.app || !this.element) return
    const { clientWidth, clientHeight } = this.element
    if (!clientWidth || !clientHeight) return
    this.app.renderer.resize(clientWidth, clientHeight)
    this.viewport.resize(clientWidth, clientHeight)
    this.emitHover()
  }

  // ---------- 事件动画 ----------
  playEvent(event) {
    const actor = this.anchorOf(event.actor)
    if (!actor) return
    switch (event.type) {
      case 'post':
        this.bubble(actor, 'bubble/3.png')
        break
      case 'comment': {
        const target = this.anchorOf(event.target)
        if (target) this.link(actor, target, FX.comment, 1100, 0.75, 3)
        this.bubble(actor, 'bubble/2.png')
        break
      }
      case 'follow': {
        const target = this.anchorOf(event.target)
        if (target) this.link(actor, target, FX.follow, 700, 0.35, 2)
        break
      }
      case 'purchase': {
        if (this.walkMode && this.startTrip(event)) break
        const shop = this.shops.get(event.brand_id)
        const color = toHex(this.brandColor.get(event.brand_id) || '#555555')
        if (shop) { this.link(actor, shop, color, 1500, 0.9, 4); this.pulse(shop, color, 70) }
        this.tag(actor, `¥${((event.amount_fen || 0) / 100).toFixed(1)}`, color)
        this.addCup(event.actor, event.brand_id)
        break
      }
      case 'ad': {
        const shop = this.shops.get(event.brand_id)
        const color = toHex(this.brandColor.get(event.brand_id) || '#555555')
        if (shop) { this.pulse(shop, color, 460, 2400); this.tag({ x: shop.x, y: shop.y - 120 }, '📣 投放广告', color, 2000) }
        break
      }
      case 'exposure':
        for (const brand of event.brand_ids || []) {
          const shop = this.shops.get(brand)
          const color = toHex(this.brandColor.get(brand) || '#555555')
          if (shop) this.link(shop, actor, color, 900, 0.3, 2)
        }
        break
      case 'interview':
        this.bubble(actor, 'bubble/4.png')
        break
      case 'failed':
        this.tag(actor, '× 失败', FX.failed)
        break
      default:
        break
    }
  }

  pushFx(item) {
    this.fxLayer.addChild(item.node)
    this.fx.push(item)
    while (this.fx.length > MAX_FX) {
      const old = this.fx.shift()
      old.node.destroy({ children: true })
    }
  }

  bubble(at, textureKey, life = 1400) {
    const texture = this.assets.textures[textureKey]
    if (!texture) return
    const sprite = new PIXI.Sprite(texture)
    sprite.anchor.set(0.5, 1)
    sprite.scale.set(0.9)
    const node = new PIXI.Container()
    node.addChild(sprite)
    node.position.set(at.x, at.y)
    this.pushFx({ node, age: 0, life, rise: 30, pop: true })
  }

  tag(at, content, color, life = 1400) {
    const node = pill(content, { size: 17, fill: color, color: '#ffffff', radius: 12, padX: 10, padY: 5 })
    node.position.set(at.x, at.y)
    this.pushFx({ node, age: 0, life, rise: 30, pop: true })
  }

  link(from, to, color, life = 1000, alpha = 0.7, width = 3) {
    if (!from || !to) return
    const midX = (from.x + to.x) / 2
    const midY = Math.min(from.y, to.y) - Math.min(260, Math.hypot(to.x - from.x, to.y - from.y) * 0.25)
    const node = new PIXI.Graphics()
      .moveTo(from.x, from.y)
      .quadraticCurveTo(midX, midY, to.x, to.y)
      .stroke({ width, color, alpha, cap: 'round' })
    node.circle(to.x, to.y, width * 1.8).fill({ color, alpha })
    this.pushFx({ node, age: 0, life })
  }

  pulse(at, color, radius = 120, life = 1200) {
    const node = new PIXI.Graphics().circle(0, 0, 40).stroke({ width: 6, color, alpha: 0.9 })
    node.position.set(at.x, at.y)
    this.pushFx({ node, age: 0, life, grow: radius / 40 })
  }

  clearFx() {
    for (const item of this.fx) item.node.destroy({ children: true })
    this.fx = []
  }

  updateFx(deltaMS) {
    const alive = []
    for (const item of this.fx) {
      item.age += deltaMS
      const k = item.age / item.life
      if (k >= 1) { item.node.destroy({ children: true }); continue }
      item.node.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
      if (item.rise) item.node.pivot.y = item.rise * k
      if (item.pop) item.node.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.45 : k < 0.2 ? 1.05 - ((k - 0.12) / 0.08) * 0.05 : 1)
      if (item.grow) item.node.scale.set(1 + (item.grow - 1) * k)
      alive.push(item)
    }
    this.fx = alive
  }

  // ---------- 购买时走到门店（展示动画，不代表模拟中的真实行踪） ----------
  setSpeed(speed) { this.speed = speed }

  setPlaybackPaused(paused) {
    this.playbackPaused = Boolean(paused)
    for (const entry of this.walkers) {
      if (this.playbackPaused) entry.body.stop?.()
      else if (entry.trip?.wait <= 0) entry.body.play?.()
    }
  }

  // 暂停只冻结事件演出；PIXI 仍渲染，viewport 的拖动和缩放不受影响。
  advanceAnimations(deltaMS) {
    if (this.playbackPaused) return
    this.updateFx(deltaMS)
    this.updateWalkers(deltaMS)
    this.refreshNetworkRelations()
  }

  setWalkMode(enabled) {
    this.walkMode = enabled
    if (!enabled) this.resetWalkers(true)
  }

  isWalking(personId) {
    return Boolean(this.people.get(personId)?.trip)
  }

  // 返回 true 表示这次购买交给行走动画处理（到店时再显示金额和杯数）
  startTrip(event) {
    const entry = this.people.get(event.actor)
    const brand = this.index.brands.get(event.brand_id)
    const shop = brand && this.index.locations.get(brand.location_id)
    if (!entry || !shop?.counter) return false
    if (entry.trip) {
      entry.queue.push(event)   // 还在路上：排队，回来后再出发
      return true
    }
    const homeLocation = this.index.locations.get(entry.home.locationId)
    const tiles = routeToShop(this.campus, homeLocation, entry.home, shop, laneOffset(entry.id), counterSpread(entry.id))
    const outbound = tiles.map(p => ({ x: p.x * this.tile, y: p.y * this.tile }))
    outbound[0] = { x: entry.homeX, y: entry.homeY }
    entry.trip = { event, points: outbound, index: 1, phase: 'out', wait: 0 }
    entry.node.visible = true
    this.walkers.add(entry)
    if (!this.playbackPaused) entry.body.play?.()
    else entry.body.stop?.()
    this.onWalkersChanged()
    return true
  }

  onWalkersChanged() {
    this.refreshPopulation()
    this.updateInteriors()
    this.refreshNetworkRelations()
    if (this.hovered || this.pinned) this.emitHover()
  }

  arriveAtShop(entry) {
    const event = entry.trip.event
    const color = toHex(this.brandColor.get(event.brand_id) || '#555555')
    const shop = this.shops.get(event.brand_id)
    if (shop) this.pulse(shop, color, 70, 900)
    this.tag({ x: entry.x, y: entry.y - entry.height - 8 }, `¥${((event.amount_fen || 0) / 100).toFixed(1)}`, color)
    this.addCup(entry.id, event.brand_id)
  }

  updateWalkers(deltaMS) {
    let changed = false
    for (const entry of this.walkers) {
      const trip = entry.trip
      if (trip.wait > 0) { trip.wait -= deltaMS * this.speed; continue }
      if (entry.body.play && !entry.body.playing) entry.body.play()
      let budget = (WALK_SPEED_PX * this.speed * deltaMS) / 1000
      while (budget > 0 && trip.index < trip.points.length) {
        const target = trip.points[trip.index]
        const dx = target.x - entry.x
        const dy = target.y - entry.y
        const distance = Math.hypot(dx, dy)
        if (Math.abs(dx) > 0.5) entry.figure.scale.x = Math.abs(entry.figure.scale.x) * (dx > 0 ? -1 : 1)
        if (distance <= budget) {
          entry.x = target.x
          entry.y = target.y
          budget -= distance
          trip.index += 1
        } else {
          entry.x += (dx / distance) * budget
          entry.y += (dy / distance) * budget
          budget = 0
        }
      }
      entry.node.position.set(entry.x, entry.y)
      entry.node.zIndex = entry.y
      if (trip.index < trip.points.length) continue

      if (trip.phase === 'out') {
        this.arriveAtShop(entry)
        trip.phase = 'back'
        trip.points = [...trip.points].reverse()
        trip.index = 1
        trip.wait = SHOP_DWELL_MS
        if (entry.body.stop) entry.body.gotoAndStop(0)
        continue
      }
      this.finishTrip(entry)
      changed = true
      const next = entry.queue.shift()
      if (next) this.startTrip(next)
    }
    if (changed) this.onWalkersChanged()
  }

  finishTrip(entry) {
    entry.trip = null
    this.walkers.delete(entry)
    entry.x = entry.homeX
    entry.y = entry.homeY
    entry.node.position.set(entry.x, entry.y)
    entry.node.zIndex = entry.y
    entry.node.visible = entry.home.kind === 'outdoor'
    entry.figure.scale.x = Math.abs(entry.figure.scale.x)
    if (entry.body.stop) entry.body.gotoAndStop(0)
  }

  // 拖动进度时：所有人立即回到楼里。settle=true 时把未到店的购买直接记上杯数（用于关闭行走模式）
  resetWalkers(settle = false) {
    for (const entry of [...this.walkers]) {
      if (settle) {
        if (entry.trip.phase === 'out') this.addCup(entry.id, entry.trip.event.brand_id)
        for (const queued of entry.queue) this.addCup(entry.id, queued.brand_id)
      }
      entry.queue = []
      this.finishTrip(entry)
    }
    this.onWalkersChanged()
  }

  destroy() {
    this.resizeObserver?.disconnect()
    this.clearNetworkRelations()
    if (this.app) {
      this.app.ticker.remove(this.tick)
      this.app.destroy(true, { children: true })
    }
    this.app = null
  }
}
