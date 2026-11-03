// Presentation helpers use CSS pixels, not WebGL drawing-buffer pixels.
// Call camera.updateMatrixWorld() after OrbitControls before querying them.
import { Matrix4 } from 'three'

const MODEL_BOUNDS = { minX: -2.6, maxX: 2.6, minY: 0, maxY: 8.5, minZ: -2.6, maxZ: 2.6 }
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function personProjector(camera, position, viewport) {
  const width = positive(viewport?.width, 1)
  const height = positive(viewport?.height, 1)
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements
  const px = position.x
  const py = position.y
  const pz = position.z
  return scale => {
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const x of [MODEL_BOUNDS.minX, MODEL_BOUNDS.maxX]) {
      for (const y of [MODEL_BOUNDS.minY, MODEL_BOUNDS.maxY]) {
        for (const z of [MODEL_BOUNDS.minZ, MODEL_BOUNDS.maxZ]) {
          const wx = px + x * scale
          const wy = py + y * scale
          const wz = pz + z * scale
          const w = matrix[3] * wx + matrix[7] * wy + matrix[11] * wz + matrix[15]
          // Objects fully behind the camera must not grow to the scale cap.
          // Near-plane intersections are already large on screen; retain only
          // finite, forward projections for a bounded presentation estimate.
          if (w <= 1e-6) continue
          const sx = ((matrix[0] * wx + matrix[4] * wy + matrix[8] * wz + matrix[12]) / w + 1) * width / 2
          const sy = (1 - (matrix[1] * wx + matrix[5] * wy + matrix[9] * wz + matrix[13]) / w) * height / 2
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
          left = Math.min(left, sx)
          right = Math.max(right, sx)
          top = Math.min(top, sy)
          bottom = Math.max(bottom, sy)
        }
      }
    }
    if (!Number.isFinite(left)) return { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, visible: false }
    return { width: right - left, height: bottom - top, left, right, top, bottom, visible: true }
  }
}

export function projectedPersonSize(camera, position, scale = 1, viewport = {}) {
  return personProjector(camera, position, viewport)(positive(scale, 1))
}

// Find the smallest uniform display scale that makes the entire unscaled
// person bounding box at least minPixels high. The full box also works for a
// top-down camera, where projecting only feet/head produces a zero-height ray.
// World positions, path lengths and simulation time are deliberately untouched.
export function personScaleForCamera(camera, position, { width, height, minPixels = 12, maxScale = 64 } = {}) {
  const minimum = positive(minPixels, 12)
  const cap = Math.max(1, positive(maxScale, 64))
  const measure = personProjector(camera, position, { width, height })
  const original = measure(1)
  if (!original.visible || original.height >= minimum || cap === 1) return 1
  let low = 1
  let high = Math.min(cap, Math.max(1.01, minimum / Math.max(original.height, 1e-8) * 1.08))
  while (measure(high).height < minimum && high < cap) high = Math.min(cap, high * 1.5)
  if (measure(high).height < minimum) return cap
  // Keep the upper bound so rounding never puts a visible person below the
  // requested CSS-pixel threshold. Matrices are constructed only once here.
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const middle = (low + high) / 2
    if (measure(middle).height >= minimum) high = middle
    else low = middle
  }
  return high
}

function overlaps(a, b, gap) {
  const epsilon = 1e-7
  return a.left < b.left + b.width + gap - epsilon
    && a.left + a.width + gap > b.left + epsilon
    && a.top < b.top + b.height + gap - epsilon
    && a.top + a.height + gap > b.top + epsilon
}

function compactGrid(items, { width, height, padding, gap }) {
  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  let best = null
  // If full text cannot fit, reduce label widths and let the DOM ellipsize it;
  // keep all labels and their font size instead of hiding or shrinking text.
  for (let columns = 1; columns <= items.length; columns += 1) {
    const rows = Math.ceil(items.length / columns)
    const cellWidth = (availableWidth - gap * (columns - 1)) / columns
    const cellHeight = (availableHeight - gap * (rows - 1)) / rows
    if (cellWidth <= 0 || cellHeight <= 0) continue
    const heightFits = items.every(item => item.height <= cellHeight)
    const compression = Math.min(...items.map(item => Math.min(1, cellWidth / item.width)))
    const score = (heightFits ? 10 : 0) + compression + Math.min(1, cellHeight / Math.max(...items.map(item => item.height)))
    if (!best || score > best.score) best = { columns, rows, cellWidth, cellHeight, score }
  }
  // Only degenerate canvases reach this fallback. Preserve a finite, bounded
  // layout while the host is waiting for its first nonzero ResizeObserver size.
  if (!best) best = { columns: 1, rows: items.length, cellWidth: availableWidth, cellHeight: availableHeight / items.length }
  const gapX = Math.max(0, Math.min(gap, (availableWidth - best.cellWidth * best.columns) / Math.max(1, best.columns - 1)))
  const gapY = Math.max(0, Math.min(gap, (availableHeight - best.cellHeight * best.rows) / Math.max(1, best.rows - 1)))
  return items.map((item, index) => ({
    ...item,
    left: padding + index % best.columns * (best.cellWidth + gapX),
    top: padding + Math.floor(index / best.columns) * (best.cellHeight + gapY),
    width: Math.min(item.width, best.cellWidth),
    height: Math.min(item.height, best.cellHeight),
    anchorX: item.x,
    anchorY: item.y,
    compact: true,
  }))
}

export function layoutLabels(items, { width, height, padding = 10, gap = 5 } = {}) {
  if (!items.length) return []
  const viewportWidth = positive(width, 1)
  const viewportHeight = positive(height, 1)
  const inset = clamp(Number.isFinite(padding) ? padding : 10, 0, Math.min(viewportWidth, viewportHeight) / 4)
  const spacing = Math.max(0, Number.isFinite(gap) ? gap : 5)
  const availableWidth = viewportWidth - inset * 2
  const availableHeight = viewportHeight - inset * 2
  const normalized = items.map(item => ({
    ...item,
    x: Number.isFinite(item.x) ? item.x : viewportWidth / 2,
    y: Number.isFinite(item.y) ? item.y : viewportHeight / 2,
    width: Math.min(positive(item.width, 1), availableWidth),
    height: Math.min(positive(item.height, 1), availableHeight),
  }))
  const placed = []
  for (const item of normalized) {
    const preferredLeft = item.x - item.width / 2
    const preferredTop = item.y - item.height - 8
    const xs = [preferredLeft, inset, viewportWidth - inset - item.width]
    const ys = [preferredTop, item.y + 8, inset, viewportHeight - inset - item.height]
    for (const other of placed) {
      xs.push(other.left - item.width - spacing, other.left + other.width + spacing, other.left)
      ys.push(other.top - item.height - spacing, other.top + other.height + spacing, other.top)
    }
    const candidatesX = [...new Set(xs.map(x => clamp(x, inset, viewportWidth - inset - item.width)))]
    const candidatesY = [...new Set(ys.map(y => clamp(y, inset, viewportHeight - inset - item.height)))]
    let best = null
    for (const left of candidatesX) {
      for (const top of candidatesY) {
        const candidate = { ...item, left, top, anchorX: item.x, anchorY: item.y, compact: false }
        if (placed.some(other => overlaps(candidate, other, spacing))) continue
        const score = (left - preferredLeft) ** 2 + (top - preferredTop) ** 2
        if (!best || score < best.score) best = { ...candidate, score }
      }
    }
    if (!best) return compactGrid(normalized, { width: viewportWidth, height: viewportHeight, padding: inset, gap: spacing })
    const { score, ...placement } = best
    placed.push(placement)
  }
  return placed
}
