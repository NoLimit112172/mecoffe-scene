import { resolveHomeKey } from './campus3dRouting.js'

// This clock describes lighting only, never a timestamp in the OASIS records.
export function visualClock(position, { cycle = true, hour = 12 } = {}) {
  const phase = cycle ? ((Number.isFinite(position) ? position : 0) % 1 + 1) % 1
    : (((Number.isFinite(hour) ? hour : 12) - 6) / 24 % 1 + 1) % 1
  const clock = (phase * 24 + 6) % 24
  const minutes = Math.floor(clock * 60 + 1e-7)
  return { phase, hour: clock, label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
}

// Keep a few real roster representatives outside each building. All people
// retain their entry and route; walking/selected people are always revealed.
export function idleRepresentatives(people, limit = 4) {
  const result = new Set()
  const counts = new Map()
  for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = resolveHomeKey(person)
    const count = counts.get(key) || 0
    if (person.role === 'merchant' || count < limit) result.add(person.id)
    counts.set(key, count + 1)
  }
  return result
}

export function displayOccupancy(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const count = counts.get(entry.anchor.building.osm_id) || { total: 0, inside: 0 }
    count.total += 1
    if (!entry.walker) count.inside += 1
    counts.set(entry.anchor.building.osm_id, count)
  }
  return counts
}

// A camera-facing sprite has a fixed screen-space height regardless of the
// camera's downward tilt. Measure its own rectangle, not the old 3D rig's box.
export function billboardScaleForCamera(camera, position, { height, minPixels = 30, worldHeight = 8.5 } = {}) {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(worldHeight) || worldHeight <= 0
    || !Number.isFinite(minPixels) || minPixels <= 0) return 1
  const matrix = camera.matrixWorldInverse.elements
  const depth = -(matrix[2] * position.x + matrix[6] * position.y + matrix[10] * position.z + matrix[14])
  if (depth <= 0 || !Number.isFinite(depth)) return 1
  const projected = worldHeight * camera.projectionMatrix.elements[5] * height / (2 * depth)
  return Math.max(1, Math.min(128, minPixels / projected))
}
