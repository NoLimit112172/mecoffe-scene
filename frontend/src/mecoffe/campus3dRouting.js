// OSM projected coordinates: x east / y north, in metres. These routes only
// describe presentation-layer movement; OASIS contains no location data.

export const HOME_KEYS = [
  'ug_dorm_west', 'ug_dorm_east', 'teaching_main',
  'grad_apartment', 'library_main', 'faculty_main',
]
export const SHOP_KEYS = ['shop_merchant_001', 'shop_merchant_002']

// The existing adapters have already applied campus.json's occupancy shares.
// Preserve that assignment instead of inventing another allocation in 3D.
export function resolveHomeKey(person) {
  return person.location_key || (person.role === 'merchant' ? person.home_location_id : person.building_id)
}

// Explicit run data binds each brand to its owner's mapped building. Legacy files keep their own IDs.
export function brandLocationKey(index, brandId) {
  if(index.brands?.get(brandId)?.out_of_scene)return null
  return index.brands?.get(brandId)?.location_id || `shop_${brandId}`
}
export function brandLocationKeys(index) {
  return new Set(index.scene.brands.map(brand => brandLocationKey(index, brand.brand_id)).filter(Boolean))
}

export function polygonCenter(polygon) {
  if (!polygon?.length) throw new Error('楼栋缺少多边形')
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % polygon.length]
    const cross = ax * by - bx * ay
    area2 += cross
    cx += (ax + bx) * cross
    cy += (ay + by) * cross
  }
  if (Math.abs(area2) > 1e-9) return { x: cx / (3 * area2), y: cy / (3 * area2) }
  const ring = polygon.length > 1 && polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1]
    ? polygon.slice(0, -1) : polygon
  return {
    x: ring.reduce((sum, p) => sum + p[0], 0) / ring.length,
    y: ring.reduce((sum, p) => sum + p[1], 0) / ring.length,
  }
}

export function nearestNode(context, point) {
  let nearest = null
  let best = Infinity
  const nodes = context.nodes instanceof Map ? context.nodes.values() : context.nodes
  for (const node of nodes) {
    const distance = Math.hypot(node.x - point.x, node.y - point.y)
    if (distance < best || (distance === best && String(node.id) < String(nearest?.id))) {
      best = distance
      nearest = node
    }
  }
  return nearest
}

export function createRouting(campus, mapping) {
  const graph = campus.walk_graph
  if (!graph?.nodes?.length) throw new Error('OSM 步行图没有节点')
  const nodes = new Map()
  const adjacency = new Map()
  for (const node of graph.nodes) {
    if (nodes.has(node.id) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error(`无效或重复的步行节点 ${node.id}`)
    }
    nodes.set(node.id, node)
    adjacency.set(node.id, [])
  }
  // Round-tripped metre lengths may be a fraction below geometric distance.
  // Scaling the A* heuristic keeps it admissible even with that rounding.
  let heuristicScale = 1
  for (const edge of graph.edges) {
    const a = nodes.get(edge.source)
    const b = nodes.get(edge.target)
    if (!a || !b || !Number.isFinite(edge.length_m) || edge.length_m < 0) {
      throw new Error(`无效的步行边 ${edge.source} → ${edge.target}`)
    }
    adjacency.get(edge.source).push({ target: edge.target, length_m: edge.length_m, edge })
    adjacency.get(edge.target).push({ target: edge.source, length_m: edge.length_m, edge })
    const straight = Math.hypot(a.x - b.x, a.y - b.y)
    if (straight > 0) heuristicScale = Math.min(heuristicScale, edge.length_m / straight)
  }
  const buildings = new Map(campus.buildings.map(building => [building.osm_id, building]))
  const mappings = mapping.mappings
  const context = { nodes, adjacency, buildings, mappings, anchors: new Map(), heuristicScale }
  for (const [key, entry] of Object.entries(mappings)) {
    const building = buildings.get(entry.osm_id)
    if (!building) throw new Error(`示意地点 ${key} 对应的 OSM 楼栋不存在：${entry.osm_id}`)
    const center = polygonCenter(building.polygon)
    context.anchors.set(key, { building, center, node: nearestNode(context, center) })
  }
  return context
}

// A*: undirected walking graph, retaining ONLY the OSM edges supplied by the
// adapter. Disconnected components stay disconnected; never draw a shortcut.
export function findPath(context, startId, endId) {
  if (!context.nodes.has(startId) || !context.nodes.has(endId)) return null
  const goal = context.nodes.get(endId)
  const heuristic = id => {
    const p = context.nodes.get(id)
    return Math.hypot(p.x - goal.x, p.y - goal.y) * context.heuristicScale
  }
  const open = new Set([startId])
  const previous = new Map()
  const distance = new Map([[startId, 0]])
  const priority = new Map([[startId, heuristic(startId)]])
  while (open.size) {
    let current = null
    let best = Infinity
    for (const id of open) {
      if (priority.get(id) < best) {
        current = id
        best = priority.get(id)
      }
    }
    if (current === endId) {
      const node_ids = [current]
      while (previous.has(node_ids[0])) node_ids.unshift(previous.get(node_ids[0]))
      return {
        node_ids,
        points: node_ids.map(id => {
          const node = context.nodes.get(id)
          return { x: node.x, y: node.y }
        }),
        length_m: distance.get(endId),
      }
    }
    open.delete(current)
    for (const next of context.adjacency.get(current)) {
      const candidate = distance.get(current) + next.length_m
      if (candidate < (distance.get(next.target) ?? Infinity)) {
        previous.set(next.target, current)
        distance.set(next.target, candidate)
        priority.set(next.target, candidate + heuristic(next.target))
        open.add(next.target)
      }
    }
  }
  return null
}

export function routeBetweenMappings(context, fromKey, toKey) {
  const start = context.anchors.get(fromKey)?.node
  const end = context.anchors.get(toKey)?.node
  return start && end ? findPath(context, start.id, end.id) : null
}

export function reverseRoute(route) {
  if (!route) return null
  return {
    node_ids: [...route.node_ids].reverse(),
    points: [...route.points].reverse().map(point => ({ ...point })),
    length_m: route.length_m,
  }
}
