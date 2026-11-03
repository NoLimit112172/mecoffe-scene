// Local presentation-only replanning. OSM/A* routes, events and source positions
// are never edited; current people are conservative stationary circle obstacles.
import { clearDisplaySegment, outsideBuildings, CROWD_GAP } from './campus3dCrowd.js'

const EPS = 1e-6
const MAX_VISITED = 20000
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const copy = p => ({ x: p.x, y: p.y })
const finite = p => Number.isFinite(p?.x) && Number.isFinite(p?.y)

class MinHeap {
  constructor() { this.items = [] }
  push(item) {
    const list = this.items
    let i = list.length
    list.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (list[parent].score <= item.score) break
      list[i] = list[parent]; i = parent
    }
    list[i] = item
  }
  pop() {
    const list = this.items, first = list[0], last = list.pop()
    if (list.length) {
      let i = 0
      while (i * 2 + 1 < list.length) {
        let child = i * 2 + 1
        if (child + 1 < list.length && list[child + 1].score < list[child].score) child++
        if (list[child].score >= last.score) break
        list[i] = list[child]; i = child
      }
      list[i] = last
    }
    return first
  }
  get length() { return this.items.length }
}

/**
 * Deterministic bounded 8-neighbour grid A*. `people` excludes the requesting
 * actor; each item is {x,y,radius}. Returns a continuously safe polyline or null
 * when the target is occupied, no local corridor is found, or the cap is hit.
 * No "nearest free target" is substituted: a waiting shopper must keep its goal.
 */
export function displayCrowdDetour(start, goal, buildings = [], people = [], radius = 8, {maxVisited=MAX_VISITED}={}) {
  if (!finite(start) || !finite(goal) || !Number.isFinite(radius) || radius < 0) return null
  const circles = people.filter(finite).map(p => ({ x: p.x, y: p.y,
    radius: radius + Math.max(0, Number.isFinite(p.radius) ? p.radius : radius) + CROWD_GAP }))
  const pointClear = p => outsideBuildings(p, buildings, radius)
    && circles.every(c => Math.abs(p.x-c.x)>=c.radius || Math.abs(p.y-c.y)>=c.radius || distance(p, c) >= c.radius - EPS)
  if (!pointClear(start) || !pointClear(goal)) return null
  const edgeClear = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
    for (const c of circles) {
      if (Math.max(a.x, b.x) < c.x - c.radius || Math.min(a.x, b.x) > c.x + c.radius
        || Math.max(a.y, b.y) < c.y - c.radius || Math.min(a.y, b.y) > c.y + c.radius) continue
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (lengthSquared || 1)))
      if (Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) < c.radius - EPS) return false
    }
    return clearDisplaySegment(a, b, buildings, radius)
  }
  if (edgeClear(start, goal)) return [copy(start), copy(goal)]

  // The fine grid is independent of OSM nodes. Extra start connections sample
  // slopes such as 1:2 and 1:3 so close standing circles do not force a spurious
  // failure just because none of the eight first unit steps points into a gap.
  const step = Math.max(1, Math.min(3, radius * .3))
  // A campus block can be 100–200 m long. A small local window traps a
  // character at its end even when the opposite side has a clear corridor.
  const margin = Math.max(200, radius * 12)
  const bounds = { minX: Math.min(start.x, goal.x) - margin, maxX: Math.max(start.x, goal.x) + margin,
    minY: Math.min(start.y, goal.y) - margin, maxY: Math.max(start.y, goal.y) + margin }
  const position = (x, y) => ({ x: start.x + x * step, y: start.y + y * step })
  const key = (x, y) => `${x},${y}`
  const inside = p => p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY
  const heap = new MinHeap(), nodes = new Map(), closed = new Set(), clearPoints = new Map()
  nodes.set('0,0', { x: 0, y: 0, cost: 0, previous: null })
  heap.push({ key: '0,0', cost: 0, score: distance(start, goal) })
  const neighbors = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const firstSteps = []
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (x || y) firstSteps.push([x, y])
  let visited = 0
  while (heap.length && visited < Math.min(MAX_VISITED,Math.max(0,maxVisited))) {
    const next = heap.pop()
    if (closed.has(next.key)) continue
    const node = nodes.get(next.key)
    if (next.cost > node.cost + EPS) continue
    const p = position(node.x, node.y)
    closed.add(next.key); visited++
    if (edgeClear(p, goal)) {
      const path = [copy(goal)]
      let at = next.key
      while (at !== null) {
        const n = nodes.get(at)
        path.unshift(position(n.x, n.y)); at = n.previous
      }
      // Line-of-sight compression retains continuous circle/building checks.
      const simplified = [path[0]]
      for (let i = 0; i < path.length - 1;) {
        let j = path.length - 1
        while (j > i + 1 && !edgeClear(path[i], path[j])) j--
        simplified.push(path[j]); i = j
      }
      return simplified
    }
    for (const [dx, dy] of next.key === '0,0' ? firstSteps : neighbors) {
      const x = node.x + dx, y = node.y + dy, id = key(x, y)
      if (closed.has(id)) continue
      const q = position(x, y), cost = node.cost + distance(p, q)
      if (!inside(q) || cost >= (nodes.get(id)?.cost ?? Infinity) - EPS) continue
      if (!clearPoints.has(id)) clearPoints.set(id, pointClear(q))
      if (!clearPoints.get(id) || !edgeClear(p, q)) continue
      nodes.set(id, { x, y, cost, previous: next.key })
      heap.push({ key: id, cost, score: cost + distance(q, goal) })
    }
  }
  return null
}
