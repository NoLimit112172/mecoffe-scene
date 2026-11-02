// 人物位置与行走路线：纯函数，坐标单位为格（tile），便于测试。
// 每个人要么在某栋楼里（indoor），要么站在门店外（商家）。都是示意，OASIS 本身没有位置。

export function hashOf(value) {
  let hash = 2166136261
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function buildingIndex(campus) {
  const index = new Map()
  for (const location of campus.locations) {
    for (const building of location.buildings || []) index.set(building.building_id, { building, location })
  }
  return index
}

// 楼门：楼底边中点稍往外一点
export function doorOf(building) {
  return { x: building.x + building.w / 2, y: building.y + building.h + 0.25 }
}

// 房屋的层数（含底层）；别墅类门店只有一层
export function floorCount(building) {
  return building.style === 'house' ? Math.max(1, building.floors || 1) : 1
}

export function computeHomes(scene) {
  const buildings = buildingIndex(scene.campus)
  const locations = new Map(scene.campus.locations.map(l => [l.location_id, l]))
  const homes = new Map()
  const residents = new Map()
  const outdoor = new Map()

  for (const person of scene.people) {
    if (person.indoor) {
      if (!buildings.has(person.building_id)) throw new Error(`人物 ${person.id} 的楼栋 ${person.building_id} 不在校园配置中`)
      if (!residents.has(person.building_id)) residents.set(person.building_id, [])
      residents.get(person.building_id).push(person)
    } else {
      if (!outdoor.has(person.home_location_id)) outdoor.set(person.home_location_id, [])
      outdoor.get(person.home_location_id).push(person)
    }
  }

  const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })
  for (const [buildingId, list] of residents) {
    const { building, location } = buildings.get(buildingId)
    const floors = floorCount(building)
    const door = doorOf(building)
    list.sort(byId)
    const perFloor = Math.ceil(list.length / floors)
    list.forEach((person, k) => {
      const spread = (((hashOf(`door:${person.id}`) % 9) - 4) / 4) * Math.min(0.6, building.w * 0.15)
      homes.set(person.id, {
        kind: 'indoor', buildingId, locationId: location.location_id,
        x: door.x + spread, y: door.y,
        floor: k % floors, slot: Math.floor(k / floors), perFloor, floors,
      })
    })
  }

  for (const [locationId, list] of outdoor) {
    const location = locations.get(locationId)
    if (!location) throw new Error(`人物的默认地点 ${locationId} 不在校园配置中`)
    const area = location.crowd || location.block
    list.sort(byId)
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length * area.w / area.h)))
    const rows = Math.ceil(list.length / cols)
    const dx = area.w / cols
    const dy = area.h / rows
    list.forEach((person, k) => {
      homes.set(person.id, {
        kind: 'outdoor', locationId,
        x: area.x + ((k % cols) + 0.5) * dx,
        y: area.y + (Math.floor(k / cols) + 1) * dy,
        height: Math.min(1.05, dy * 0.95),
      })
    })
  }
  return homes
}

// 主路中线：horizontal_rows 两行道路的中间
export function mainRoadY(campus) {
  const rows = campus.grid.roads.horizontal_rows
  return (Math.min(...rows) + Math.max(...rows) + 1) / 2
}

export function buildingRects(campus) {
  const rects = []
  for (const { building, location } of buildingIndex(campus).values()) {
    rects.push({ x: building.x, y: building.y, w: building.w, h: building.h, buildingId: building.building_id, locationId: location.location_id })
  }
  return rects
}

// 每个人在路上用一条略有偏移的“车道”，避免多人重叠成一个
export function laneOffset(personId) {
  return ((hashOf(`lane:${personId}`) % 5) - 2) * 0.16
}

// 柜台前的排队位置：按编号固定散开，避免一群人叠在同一个点上
export function counterSpread(personId) {
  const h = hashOf(`counter:${personId}`)
  return { dx: ((h % 7) - 3) * 0.28, dy: (((h >>> 3) % 5) - 2) * 0.22 }
}

function homeToRoad(location, home, roadY, lane) {
  const access = location.access || { type: 'south' }
  if (access.type === 'south') return [{ x: home.x, y: home.y }, { x: home.x, y: roadY }]
  if (access.type === 'via_x') {
    return [{ x: home.x, y: home.y }, { x: access.x + lane, y: home.y }, { x: access.x + lane, y: roadY }]
  }
  throw new Error(`地点 ${location.location_id} 的 access 类型 ${access.type} 不能作为住所出口`)
}

// 从柜台到主路的折线（最后一点落在主路上）
function counterToRoad(shop, roadY, lane, spread) {
  if (!shop.counter || shop.access?.type !== 'points') {
    throw new Error(`门店 ${shop.location_id} 缺少 counter 或 points 类型的 access`)
  }
  const [cx, cy] = shop.counter
  const points = [{ x: cx + spread.dx, y: cy + spread.dy }]
  for (const [x, y] of shop.access.points) {
    // 与柜台同一水平线的拐点跟着排队位置上下移动，保持横平竖直
    points.push({ x: x + lane, y: y === cy ? cy + spread.dy : y })
  }
  points[points.length - 1].y = roadY
  return points
}

// 楼门 -> 主路 -> 门店柜台；返回去程折线，回程把它倒过来即可
export function routeToShop(campus, homeLocation, home, shop, lane = 0, spread = { dx: 0, dy: 0 }) {
  const roadY = mainRoadY(campus) + lane
  const out = homeToRoad(homeLocation, home, roadY, lane)
  const inbound = counterToRoad(shop, roadY, lane, spread).reverse()
  out.push(...inbound)
  return dedupe(out)
}

function dedupe(points) {
  return points.filter((p, k) => k === 0 || Math.hypot(p.x - points[k - 1].x, p.y - points[k - 1].y) > 1e-6)
}

export function routeLength(points) {
  let total = 0
  for (let k = 1; k < points.length; k += 1) total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
  return total
}

// 线段是否穿过矩形（略微收缩矩形，允许贴边经过）
export function segmentHitsRect(a, b, rect, margin = 0.1) {
  const left = rect.x + margin
  const right = rect.x + rect.w - margin
  const top = rect.y + margin
  const bottom = rect.y + rect.h - margin
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return maxX > left && minX < right && maxY > top && minY < bottom
}
