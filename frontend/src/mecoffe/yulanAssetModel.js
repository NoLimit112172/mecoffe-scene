// Pure, source-verifiable adaptation recipes for the existing YuLan atlas.
// No original atlas or simulation coordinates are changed by these helpers.
export const YULAN_BUILDING_TYPES = Object.freeze([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
export const YULAN_DECORATION_SETS = Object.freeze({
  bush: ['decoration/40/40_1.png', 'decoration/40/40_2.png', 'decoration/40/40_16.png'],
  planter: ['decoration/40/40_3.png', 'decoration/40/40_4.png', 'decoration/40/40_5.png'],
  tree_group: ['decoration/41/41_1.png', 'decoration/43/43_1.png', 'decoration/45/45_1.png'],
  bench: ['decoration/40/40_6.png', 'decoration/40/40_14.png'],
  lamp: ['decoration/40/40_7.png'],
  garden: ['decoration/42/42_4.png', 'decoration/44/44_6.png', 'decoration/45/45_2.png'],
  fountain: ['decoration/42/42_5.png', 'decoration/44/44_3.png', 'decoration/44/44_12.png'],
})

export function buildingSuite(type = 21, model = 1) {
  type = Number(type)
  model = Number(model)
  if (!YULAN_BUILDING_TYPES.includes(type) || !Number.isInteger(model) || model < 1 || model > (type < 27 ? 10 : 20)) throw new Error('Unknown YuLan building type or model')
  if (type < 27) return {
    type, model, source: 'native-modules',
    base: { key: `house/${type}/${type}_${model}_0.png` },
    floor: { key: `house/${type}/${type}_${model}_1.png` },
    roof: { key: `house/${type}/${type}_${model}_2.png`, crop: [0.04, 0.02, .92, .52] },
    note: 'house atlas parts 0 / 1 / 2 are the original ground / repeat floor / roof pieces; roof uses a documented upper-band crop for top projection',
  }
  // villa has complete landscape/façade images, not original modular parts.
  // Record these derived bands explicitly rather than claiming native parts.
  const key = `villa/${type}/${type}_${model}.png`
  const bands = { 27: [.23, .46, .7], 28: [.14, .38, .68], 29: [.06, .40, .72], 30: [.32, .58, .82] }[type]
  return { type, model, source: 'derived-villa-bands',
    base: { key, crop: [.12, bands[2], .76, 1 - bands[2]] },
    floor: { key, crop: [.12, bands[1], .76, bands[2] - bands[1]] },
    roof: { key, crop: [.12, bands[0], .76, bands[1] - bands[0]] },
    note: 'villa has one complete source image; these normalized roof / storey / entrance bands are an explicit stylistic adaptation, not surveyed architectural parts',
  }
}

export function cropRectangle(width, height, crop = [0, 0, 1, 1]) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0) || crop.length !== 4
    || crop.some(value => !Number.isFinite(value)) || crop[0] < 0 || crop[1] < 0 || crop[2] <= 0 || crop[3] <= 0
    || crop[0] + crop[2] > 1.000001 || crop[1] + crop[3] > 1.000001) throw new Error('Invalid normalized atlas crop')
  return { x: Math.floor(width * crop[0]), y: Math.floor(height * crop[1]),
    width: Math.max(1, Math.min(width - Math.floor(width * crop[0]), Math.round(width * crop[2]))),
    height: Math.max(1, Math.min(height - Math.floor(height * crop[1]), Math.round(height * crop[3]))) }
}

/** Close a footprint without moving its vertices or adding synthetic edges. */
export function normalizedFootprint(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('A finite polygon is required')
  const points = polygon.map(p => p.slice(0, 2)).filter((p, i) => !i || Math.hypot(p[0] - polygon[i - 1][0], p[1] - polygon[i - 1][1]) > 1e-9)
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-9) points.pop()
  if (points.length < 3) throw new Error('A footprint needs three distinct vertices')
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1] }, 0) / 2
  if (Math.abs(area) < 1e-8) throw new Error('A footprint must have nonzero area')
  return { points: [...points, points[0].slice()], area }
}

/** Exact edge subdivision; the last panel ends at the source vertex. */
export function wallModules(polygon, { levels = 3, height = 9.6, moduleWidth = 8, holes = [] } = {}) {
  if (![levels, height, moduleWidth].every(value => Number.isFinite(value) && value > 0)) throw new Error('Positive building dimensions are required')
  if (!Array.isArray(holes)) throw new Error('Footprint holes must be an array of rings')
  const { points, area } = normalizedFootprint(polygon)
  const floors = Math.max(1, Math.ceil(levels)), floorHeight = height / floors
  const modules = []
  for (let edge = 0; edge < points.length - 1; edge++) {
    const a = points[edge], b = points[edge + 1], dx = b[0] - a[0], dy = b[1] - a[1]
    const length = Math.hypot(dx, dy), count = Math.max(1, Math.ceil(length / moduleWidth))
    for (let level = 0; level < floors; level++) for (let panel = 0; panel < count; panel++) {
      const start = [a[0] + dx * panel / count, a[1] + dy * panel / count]
      const end = panel === count - 1 ? b.slice() : [a[0] + dx * (panel + 1) / count, a[1] + dy * (panel + 1) / count]
      modules.push({ edge, level, panel, start, end, width: length / count, height: floorHeight,
        x: (start[0] + end[0]) / 2, north: (start[1] + end[1]) / 2, y: (level + .5) * floorHeight,
        rotationY: Math.atan2(dy, dx) + (area < 0 ? Math.PI : 0),
        part: level === 0 && edge === 0 && panel === 0 ? 'base' : 'floor' })
    }
  }
  const result = { modules, points, floors, height, floorHeight }
  if (holes.length) {
    result.holes = holes.map((ring, hole) => {
      const inner = wallModules(ring,{levels,height,moduleWidth})
      // An interior ring faces into its empty courtyard, the opposite of the
      // outward-facing shell of an independent building. Keep all source
      // vertices and repeat the same storey modules along the courtyard.
      for (const panel of inner.modules) modules.push({...panel,hole,
        rotationY:panel.rotationY + Math.PI,part:'floor'})
      return inner.points
    })
  }
  return result
}

/** One occupied source sample becomes exactly `depth` voxels. */
export function voxelizeRGBA(data, width, height, { pixelSize = 1, depth = 2, alphaThreshold = 1, step = 1 } = {}) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || data?.length !== width * height * 4
    || !Number.isInteger(depth) || depth < 1 || depth > 32 || !Number.isInteger(step) || step < 1
    || !Number.isFinite(pixelSize) || pixelSize <= 0 || !Number.isFinite(alphaThreshold) || alphaThreshold < 1 || alphaThreshold > 255) throw new Error('Invalid RGBA voxel input')
  const gridWidth = Math.ceil(width / step), gridHeight = Math.ceil(height / step)
  const voxels = []
  let opaquePixels = 0, sourceOpaquePixels = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] >= alphaThreshold) sourceOpaquePixels++
  for (let gy = 0; gy < gridHeight; gy++) for (let gx = 0; gx < gridWidth; gx++) {
    const sx = Math.min(width - 1, gx * step + Math.floor(step / 2)), sy = Math.min(height - 1, gy * step + Math.floor(step / 2))
    const index = (sy * width + sx) * 4
    if (data[index + 3] < alphaThreshold) continue
    opaquePixels++
    for (let z = 0; z < depth; z++) voxels.push({ x: gx, y: gridHeight - 1 - gy, z,
      r: data[index], g: data[index + 1], b: data[index + 2] })
  }
  return { voxels, width: gridWidth, height: gridHeight, depth, pixelSize, opaquePixels, sourceOpaquePixels }
}

const FACES = [
  { n: [1, 0, 0], corners: [[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]] },
  { n: [-1, 0, 0], corners: [[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]] },
  { n: [0, 1, 0], corners: [[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]] },
  { n: [0, -1, 0], corners: [[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]] },
  { n: [0, 0, 1], corners: [[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5]] },
  { n: [0, 0, -1], corners: [[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]] },
]
const linear = value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4 }

/** Cull shared internal faces and merge all surviving quads into one geometry. */
export function voxelSurface(model) {
  const occupied = new Set(model.voxels.map(v => `${v.x},${v.y},${v.z}`))
  const positions = [], normals = [], colors = [], indices = []
  const centerX = (model.width - 1) / 2, centerZ = (model.depth - 1) / 2, size = model.pixelSize
  for (const voxel of model.voxels) for (const face of FACES) {
    if (occupied.has(`${voxel.x + face.n[0]},${voxel.y + face.n[1]},${voxel.z + face.n[2]}`)) continue
    const first = positions.length / 3
    for (const p of face.corners) {
      positions.push((voxel.x - centerX + p[0]) * size, (voxel.y + p[1] + .5) * size, (voxel.z - centerZ + p[2]) * size)
      normals.push(...face.n)
      colors.push(linear(voxel.r), linear(voxel.g), linear(voxel.b))
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
  }
  return { positions, normals, colors, indices, faceCount: indices.length / 6, voxelCount: model.voxels.length }
}
