// Render-only bounds and clipping. The authoritative OSM snapshot, walking
// graph and person mappings remain untouched; this module never writes data.
import { createRouting, HOME_KEYS, SHOP_KEYS, routeBetweenMappings, polygonCenter } from './campus3dRouting.js'

const EPSILON = 1e-8
const finitePoint = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON

function checkBounds(bounds) {
  if (!bounds || !['minX', 'maxX', 'minY', 'maxY'].every(key => Number.isFinite(bounds[key]))
    || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) throw new Error('展示范围必须为有效的米制矩形')
}

export function pointInDisplay(point, bounds, inset = 0) {
  return finitePoint(point) && point[0] >= bounds.minX + inset - EPSILON && point[0] <= bounds.maxX - inset + EPSILON
    && point[1] >= bounds.minY + inset - EPSILON && point[1] <= bounds.maxY - inset + EPSILON
}

/** Every building and every existing home-to-shop route fits before padding. */
export function displayBounds(campus, { mapping, padding = 50 } = {}) {
  if (!Number.isFinite(padding) || padding < 0) throw new Error('建成区展示余量必须为非负米数')
  const points = (campus.buildings || []).flatMap(building => building.polygon || []).filter(finitePoint)
  if (points.length < 3) throw new Error('建成区展示范围需要有效的楼栋轮廓')
  let routeCount = 0
  if (campus.walk_graph?.nodes?.length && mapping?.mappings) {
    const routing = createRouting(campus, mapping)
    for (const from of HOME_KEYS) for (const to of SHOP_KEYS) {
      const route = routeBetweenMappings(routing, from, to)
      if (!route) continue
      routeCount += 1
      for (const point of route.points) points.push([point.x, point.y])
    }
  }
  // Do not union every source road: the source contains a path through the
  // undeveloped northern parcel. Routes relevant to existing mapped places
  // are retained above; other roads are clipped to this built-area window.
  const minX = Math.min(...points.map(point => point[0])) - padding
  const maxX = Math.max(...points.map(point => point[0])) + padding
  const minY = Math.min(...points.map(point => point[1])) - padding
  const maxY = Math.max(...points.map(point => point[1])) + padding
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY, padding, routeCount }
  checkBounds(bounds)
  return bounds
}

/** Sutherland-Hodgman clipping against a convex rectangle; output is closed. */
export function clipRing(ring, bounds) {
  checkBounds(bounds)
  if (!ring?.length) return []
  if (ring.some(point => !finitePoint(point))) throw new Error('多边形包含无效的米制坐标')
  let output = ring.map(point => point.slice(0, 2))
  if (output.length > 1 && samePoint(output[0], output.at(-1))) output.pop()
  for (const [axis, edge, greater] of [[0, bounds.minX, true], [0, bounds.maxX, false], [1, bounds.minY, true], [1, bounds.maxY, false]]) {
    const input = output
    output = []
    if (!input.length) break
    const inside = point => greater ? point[axis] >= edge - EPSILON : point[axis] <= edge + EPSILON
    const intersection = (a, b) => {
      const t = (edge - a[axis]) / (b[axis] - a[axis])
      const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      point[axis] = edge
      return point
    }
    for (let i = 0; i < input.length; i += 1) {
      const a = input[(i + input.length - 1) % input.length]
      const b = input[i]
      if (inside(a) !== inside(b)) output.push(intersection(a, b))
      if (inside(b)) output.push(b.slice())
    }
  }
  output = output.filter((point, index) => index === 0 || !samePoint(point, output[index - 1]))
  if (output.length > 1 && samePoint(output[0], output.at(-1))) output.pop()
  if (output.length < 3) return []
  const area2 = output.reduce((sum, a, index) => {
    const b = output[(index + 1) % output.length]
    return sum + a[0] * b[1] - b[0] * a[1]
  }, 0)
  if (Math.abs(area2) < EPSILON) return []
  output.push(output[0].slice())
  return output
}

function clipSegment(a, b, bounds) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  let start = 0, end = 1
  for (const [p, q] of [[-dx, a[0] - bounds.minX], [dx, bounds.maxX - a[0]], [-dy, a[1] - bounds.minY], [dy, bounds.maxY - a[1]]]) {
    if (Math.abs(p) < EPSILON) { if (q < 0) return null; continue }
    const ratio = q / p
    if (p < 0) start = Math.max(start, ratio)
    else end = Math.min(end, ratio)
    if (start > end) return null
  }
  if (end - start < EPSILON) return null
  return [[a[0] + dx * start, a[1] + dy * start], [a[0] + dx * end, a[1] + dy * end]]
}

/** Clip without joining disjoint re-entry pieces across the discarded area. */
export function clipPolyline(points, bounds) {
  checkBounds(bounds)
  if (!points?.length) return []
  if (points.some(point => !finitePoint(point))) throw new Error('道路包含无效的米制坐标')
  const pieces = []
  let current = null
  for (let i = 1; i < points.length; i += 1) {
    const segment = clipSegment(points[i - 1], points[i], bounds)
    if (!segment) { current = null; continue }
    if (current && samePoint(current.at(-1), segment[0])) current.push(segment[1])
    else { current = segment.map(point => point.slice()); pieces.push(current) }
    if (!pointInDisplay(points[i], bounds)) current = null
  }
  return pieces.map(piece => piece.filter((point, index) => !index || !samePoint(point, piece[index - 1])))
    .filter(piece => piece.length >= 2)
}

function insideRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function clipLandcovers(features = [], bounds) {
  return features.flatMap(feature => {
    const ring = feature.polygon || feature.geometry?.coordinates?.[0]
    const clipped = clipRing(ring, bounds)
    if (!clipped.length) return []
    return [{ ...feature, polygon: clipped,
      ...(feature.geometry ? { geometry: { ...feature.geometry, coordinates: [clipped] } } : {}) }]
  })
}

export function createDisplayCampus(campus, { mapping, padding = 50, landcovers = [] } = {}) {
  const bounds = displayBounds(campus, { mapping, padding })
  const rectangle = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY], [bounds.minX, bounds.minY]]
  const polygons = campus.boundary_polygons?.length ? campus.boundary_polygons
    : campus.boundary?.length ? [{ outer: campus.boundary, holes: [] }] : [{ outer: rectangle, holes: [] }]
  // The separate, unbuilt parcel has no buildings. Omitting that whole parcel
  // avoids a thin grass strip at the cutoff; the main parcel retains its holes.
  const centers = (campus.buildings || []).map(building => polygonCenter(building.polygon)).map(p => [p.x, p.y])
  const boundaryPolygons = polygons.flatMap(polygon => {
    if (!centers.some(point => insideRing(point, polygon.outer))) return []
    const outer = clipRing(polygon.outer, bounds)
    if (!outer.length) return []
    const holes = (polygon.holes || []).map(hole => clipRing(hole, bounds)).filter(hole => hole.length)
    return [{ ...polygon, outer, holes }]
  })
  if (!boundaryPolygons.length) boundaryPolygons.push({ outer: rectangle, holes: [] })
  const roads = (campus.roads || []).flatMap(road => clipPolyline(road.points, bounds)
    .map((points, index) => ({ ...road, points, display_part: index })))
  return {
    bounds,
    landcovers: clipLandcovers(landcovers, bounds),
    campus: { ...campus,
      boundary_polygons: boundaryPolygons,
      boundary: boundaryPolygons[0].outer,
      roads,
      bounds_m: { min_x: bounds.minX, max_x: bounds.maxX, min_y: bounds.minY, max_y: bounds.maxY },
      display_bounds: bounds,
      display_note: '建成区展示裁剪，东侧未建设用地不在展示范围内；源 OSM 边界与步行图未修改',
    },
  }
}
