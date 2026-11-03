// Pure display helpers: scenery defaults do not describe measured facilities,
// weather, opening hours or agent state, and never modify OSM or walking data.
import { prototypeParams } from './assetCatalog.js'
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function visualSeed(value) {
  let seed = 2166136261
  for (const character of String(value)) seed = Math.imul(seed ^ character.codePointAt(0), 16777619)
  return seed >>> 0
}

export function seededRandom(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : visualSeed(seed)
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

const PALETTES = Object.fromEntries(['dormitory','education','library','office','dining','sports','other'].map(kind=>{
  const {wall,roof,accent,glass}=prototypeParams(`building.procedural.${kind}`)
  return [kind,{wall,roof,accent,glass}]
}))

export function buildingPalette(building = {}) {
  const name = building.name || ''
  let kind = building.kind
  if (!PALETTES[kind]) kind = /图书/.test(name) ? 'library' : /食堂/.test(name) ? 'dining'
    : /体育|活动|运动/.test(name) ? 'sports' : /学科|教学/.test(name) ? 'education'
      : /宿舍|公寓|[1-8]号楼/.test(name) ? 'dormitory' : 'other'
  return { kind, ...PALETTES[kind] }
}

function mixHex(a, b, amount) {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const channels = [16, 8, 0].map(shift => Math.round(((x >> shift) & 255) * (1 - amount) + ((y >> shift) & 255) * amount))
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

const LIGHT_KEYS = [
  { at: 0, sky: '#10182f', horizon: '#2c3b5a', fog: '#1c2d48', sun: '#91aff2', ground: '#405271', hemi: .78, strength: .12, night: 1, exposure: 1.16 },
  { at: .19, sky: '#263c64', horizon: '#b88c91', fog: '#7f8093', sun: '#ffba83', ground: '#6f6a67', hemi: .75, strength: .55, night: .6, exposure: 1.03 },
  { at: .28, sky: '#6aa6d8', horizon: '#ffe0aa', fog: '#c3d5d0', sun: '#ffdba6', ground: '#8c9272', hemi: 1.35, strength: 2, night: .05, exposure: 1.0 },
  { at: .5, sky: '#78b9e5', horizon: '#e5f4ee', fog: '#bed9d9', sun: '#fff3d8', ground: '#84916f', hemi: 1.65, strength: 2.35, night: 0, exposure: 1.02 },
  { at: .69, sky: '#648ebc', horizon: '#ffcf8e', fog: '#c7bca9', sun: '#ffc477', ground: '#9a8868', hemi: 1.15, strength: 2.15, night: .07, exposure: 1.02 },
  { at: .76, sky: '#455583', horizon: '#ecae87', fog: '#8c8d9e', sun: '#ffae69', ground: '#716b73', hemi: .74, strength: .8, night: .55, exposure: 1.04 },
  { at: .85, sky: '#151f3c', horizon: '#344766', fog: '#22334e', sun: '#9bb8ff', ground: '#405474', hemi: .8, strength: .14, night: 1, exposure: 1.16 },
  { at: 1, sky: '#10182f', horizon: '#2c3b5a', fog: '#1c2d48', sun: '#91aff2', ground: '#405271', hemi: .78, strength: .12, night: 1, exposure: 1.16 },
]

// Phase 0 is 06:00, .25 noon, .5 18:00 and .75 midnight. Freeze phase on pause.
export function dayLighting(fraction = .25) {
  const phase = Number.isFinite(fraction) ? ((fraction % 1) + 1) % 1 : .25
  const time = (phase + .25) % 1
  const endIndex = LIGHT_KEYS.findIndex(key => key.at > time)
  const from = LIGHT_KEYS[Math.max(0, endIndex - 1)]
  const to = LIGHT_KEYS[endIndex < 0 ? LIGHT_KEYS.length - 1 : endIndex]
  const amount = clamp((time - from.at) / (to.at - from.at || 1), 0, 1)
  const result = { fraction: phase, hour: time * 24 }
  for (const name of ['sky', 'horizon', 'fog', 'sun', 'ground']) result[name] = mixHex(from[name], to[name], amount)
  for (const name of ['hemi', 'strength', 'night', 'exposure']) result[name] = from[name] + (to[name] - from[name]) * amount
  // Presentation fill light stays brighter than the night sky, so the campus
  // silhouette and roads remain legible. This is a visual setting, not weather.
  result.ambientSky = mixHex(result.horizon, '#9abcf0', result.night)
  result.ambientGround = mixHex(result.ground, '#7e96b2', result.night)
  result.sunDirection = [Math.cos((time - .25) * Math.PI * 2), Math.max(.18, Math.sin((time - .25) * Math.PI * 2)), .42]
  result.fogDensity = .0001 + result.night * .000055
  return result
}

export function pointInRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function segmentDistance(point, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = clamp(((point.x - a[0]) * dx + (point.y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1)
  return Math.hypot(point.x - a[0] - t * dx, point.y - a[1] - t * dy)
}

function ringDistance(point, ring) {
  return Math.min(...ring.map((p, i) => segmentDistance(point, p, ring[(i + 1) % ring.length])))
}

export function decorationIsClear(point, campus, separation = 7, landcovers = []) {
  const polygons = campus.boundary_polygons?.length ? campus.boundary_polygons : [{ outer: campus.boundary || [], holes: [] }]
  if (!polygons.some(polygon => pointInRing(point, polygon.outer)
    && !polygon.holes?.some(hole => pointInRing(point, hole)) && ringDistance(point, polygon.outer) >= 4)) return false
  for (const building of campus.buildings || []) {
    if (pointInRing(point, building.polygon) || ringDistance(point, building.polygon) < separation) return false
  }
  for (const road of campus.roads || []) {
    const points = road.points || []
    for (let i = 1; i < points.length; i += 1) if (segmentDistance(point, points[i - 1], points[i]) < separation) return false
  }
  for (const feature of landcovers) {
    const polygon = feature.polygon || feature.geometry?.coordinates?.[0]
    if (polygon?.length && (pointInRing(point, polygon) || ringDistance(point, polygon) < 3)) return false
  }
  return true
}

export function decorationPlacements(campus, { seed = 'mecoffe-campus-decor-v1', trees = 130, lamps = 28, benches = 16, landcovers = [] } = {}) {
  const random = seededRandom(seed)
  const candidates = []
  for (const road of campus.roads || []) {
    const points = road.points || []
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]
      const b = points[i]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 12) continue
      for (let at = 10 + random() * 14; at < length; at += 22 + random() * 18) {
        const t = at / length
        const side = random() < .5 ? -1 : 1
        const offset = 10 + random() * 5
        const point = { x: a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) / length * offset * side,
          y: a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) / length * offset * side,
          angle: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), scale: .8 + random() * .5, variant: Math.floor(random() * 3) }
        if (decorationIsClear(point, campus, 7, landcovers)) candidates.push(point)
      }
    }
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const selected = []
  for (const point of candidates) if (!selected.some(previous => Math.hypot(previous.x - point.x, previous.y - point.y) < 8)) selected.push(point)
  return { trees: selected.slice(0, Math.max(0, trees)), lamps: selected.slice(Math.max(0, trees), Math.max(0, trees) + Math.max(0, lamps)),
    benches: selected.slice(Math.max(0, trees) + Math.max(0, lamps), Math.max(0, trees) + Math.max(0, lamps) + Math.max(0, benches)),
    illustrative: true, label: '装饰：程序生成树木、路灯与长椅，并非 OSM 设施记录' }
}

export function windowPattern(seed, columns = 8, rows = 4) {
  const random = seededRandom(seed)
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => random() < .62))
}
