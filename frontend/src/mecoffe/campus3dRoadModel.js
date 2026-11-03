// Display-only road styling and clipping. Never import these into A* routing.
import { prototypeParams } from './assetCatalog.js'
const VEHICLE_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service'])
const EPSILON = 1e-7

export function roadStyle(road = {}) {
  const highway = (road.highway || '').replace(/_link$/, '')
  const params=prototypeParams(VEHICLE_TYPES.has(highway)?`road.${highway}`:'road.other')
  const rawLanes = String(road.lanes ?? '')
  const recordedLanes = /^\d+$/.test(rawLanes) ? Number(rawLanes) : null
  const lanes = Math.max(1, Math.min(8, recordedLanes || params.lanes || 1))
  const oneWay = ['yes', 'true', '1', '-1'].includes(String(road.oneway).toLowerCase())
  const tunnel = !['', 'no', 'false', '0', 'undefined', 'null'].includes(String(road.tunnel ?? '').toLowerCase())
  const width = lanes * params.lane_width_m
  return { highway, visible: VEHICLE_TYPES.has(highway), width, lanes, oneWay, tunnel,
    sidewalk: tunnel ? 0 : params.sidewalk_m,
    centerColor: oneWay ? '#ebede5' : prototypeParams('road.markings').yellow, asphalt: params.asphalt,
    sourceOfWidth: recordedLanes ? 'OSM lanes + illustrative lane width' : 'illustrative highway-class default' }
}

export function normaliseRoadBounds(bounds, padding = 0) {
  const b = { minX: bounds.minX ?? bounds.min_x, maxX: bounds.maxX ?? bounds.max_x,
    minY: bounds.minY ?? bounds.min_y, maxY: bounds.maxY ?? bounds.max_y }
  if (!Object.values(b).every(Number.isFinite) || b.minX >= b.maxX || b.minY >= b.maxY || !Number.isFinite(padding) || padding < 0) throw new Error('道路展示范围无效')
  return { minX: b.minX - padding, maxX: b.maxX + padding, minY: b.minY - padding, maxY: b.maxY + padding }
}

export function roadPointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function campusContains(point, campus) {
  const polygons = campus?.boundary_polygons?.length ? campus.boundary_polygons : [{ outer: campus?.boundary || [], holes: [] }]
  return polygons.some(polygon => roadPointInRing(point, polygon.outer) && !(polygon.holes || []).some(hole => roadPointInRing(point, hole)))
}

function segmentIntersectionT(a, b, c, d) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = d[0] - c[0], wy = d[1] - c[1]
  const determinant = vx * wy - vy * wx
  if (Math.abs(determinant) < EPSILON) return null
  const dx = c[0] - a[0], dy = c[1] - a[1]
  const t = (dx * wy - dy * wx) / determinant, u = (dx * vy - dy * vx) / determinant
  return t > EPSILON && t < 1 - EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? t : null
}

function rectangleCuts(a, b, bounds) {
  let lo = 0, hi = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - bounds.minX], [dx, bounds.maxX - a[0]], [-dy, a[1] - bounds.minY], [dy, bounds.maxY - a[1]]]) {
    if (Math.abs(p) < EPSILON) { if (q < 0) return null }
    else if (p < 0) lo = Math.max(lo, q / p)
    else hi = Math.min(hi, q / p)
  }
  return lo <= hi ? [lo, hi] : null
}

/** Clip to a small context rectangle and remove actual campus interior spans. */
export function externalRoadParts(points, bounds, campus = null) {
  const b = normaliseRoadBounds(bounds)
  const polygons = campus?.boundary_polygons?.length ? campus.boundary_polygons : [{ outer: campus?.boundary || [], holes: [] }]
  const rings = polygons.flatMap(polygon => [polygon.outer, ...(polygon.holes || [])])
  const parts = []
  let current = []
  const flush = () => { if (current.length >= 2) parts.push(current); current = [] }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], c = points[i]
    const clipped = rectangleCuts(a, c, b)
    if (!clipped) { flush(); continue }
    const cuts = [...clipped]
    for (const ring of rings) for (let j = 0; j < ring.length; j += 1) {
      const t = segmentIntersectionT(a, c, ring[j], ring[(j + 1) % ring.length])
      if (t !== null && t > clipped[0] && t < clipped[1]) cuts.push(t)
    }
    cuts.sort((x, y) => x - y)
    const values = cuts.filter((value, j) => !j || value - cuts[j - 1] > EPSILON)
    for (let j = 1; j < values.length; j += 1) {
      const start = [a[0] + (c[0] - a[0]) * values[j - 1], a[1] + (c[1] - a[1]) * values[j - 1]]
      const end = [a[0] + (c[0] - a[0]) * values[j], a[1] + (c[1] - a[1]) * values[j]]
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < EPSILON) continue
      if (campus && campusContains([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], campus)) { flush(); continue }
      if (current.length && Math.hypot(current.at(-1)[0] - start[0], current.at(-1)[1] - start[1]) < EPSILON) current.push(end)
      else { flush(); current = [start, end] }
    }
  }
  flush()
  return parts
}

export function contextRoads(roads, displayBounds, campus, padding = 115) {
  const bounds = normaliseRoadBounds(displayBounds, padding)
  return roads.flatMap(road => !roadStyle(road).visible ? [] : externalRoadParts(road.points || [], bounds, campus)
    .map((points, part) => ({ ...road, part, points })))
}

export function roadLength(points) {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0)
}

export function roadMidpoint(points) {
  let distance = roadLength(points) / 2
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (distance <= length && length) return { x: a[0] + (b[0] - a[0]) * distance / length,
      y: a[1] + (b[1] - a[1]) * distance / length, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }
    distance -= length
  }
  return points.length ? { x: points[0][0], y: points[0][1], angle: 0 } : null
}

/** One label per exact OSM name; prefer a visible above-ground long section. */
export function roadNameLabels(roads, { maxLabels = 8 } = {}) {
  const groups = new Map()
  for (const road of roads) {
    if (typeof road.name !== 'string' || !road.name.trim() || roadLength(road.points || []) < 20) continue
    const candidates = groups.get(road.name) || []
    candidates.push(road)
    groups.set(road.name, candidates)
  }
  return [...groups].map(([name, candidates]) => {
    candidates.sort((a, b) => Number(roadStyle(a).tunnel) - Number(roadStyle(b).tunnel) || roadLength(b.points) - roadLength(a.points) || a.osm_id.localeCompare(b.osm_id))
    const road = candidates[0]
    return { name, osm_id: road.osm_id, ...roadMidpoint(road.points), tunnel: roadStyle(road).tunnel,
      priority: ['primary', 'secondary', 'tertiary'].indexOf(roadStyle(road).highway) }
  }).sort((a, b) => (a.priority < 0 ? 9 : a.priority) - (b.priority < 0 ? 9 : b.priority) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, maxLabels))
}
