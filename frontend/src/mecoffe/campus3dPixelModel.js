// Appearance rules are intentionally the same rules used by CampusScene.
// Import the original 2D hash rather than maintaining a second implementation.
import { hashOf } from './layout.js'

export const PIXEL_PERSON_HEIGHT = 8.5
export const PIXEL_WALK_FPS = .18 * 60

export function pixelAppearance(person = {}, headCounts = {}) {
  const hash = hashOf(person.id)
  const gender = person.gender || (hash % 2 ? 'm' : 'f')
  const typeId = { merchant: '4', teacher_consumer: '2' }[person.role] || '5'
  const variant = 1 + ((hash >>> 3) % 4)
  const pick = (part, salt) => {
    const count = headCounts[`${gender}/${part}`]
    return count ? 1 + (Math.imul(hash ^ salt, 2654435761) >>> 0) % count : null
  }
  return { hash, gender, typeId, variant, animation: `character/${gender}/${typeId}_${variant}`,
    head: { f: pick('f', 11), e: pick('e', 23), m: pick('m', 37), h: pick('h', 53) } }
}

export function indexPixelAtlases(atlases) {
  const frames = new Map()
  const animations = {}
  const headCounts = {}
  atlases.forEach((atlas, sheet) => {
    for (const [key, frame] of Object.entries(atlas.frames || {})) {
      frames.set(key, { ...frame, sheet, key })
      const match = key.match(/^head\/([fm])\/([efhm])\/(\d+)\.png$/)
      if (match) headCounts[`${match[1]}/${match[2]}`] = Math.max(headCounts[`${match[1]}/${match[2]}`] || 0, Number(match[3]))
    }
    Object.assign(animations, atlas.animations || {})
  })
  return { frames, animations, headCounts }
}

export function pixelFrameIndex(seconds = 0, walking = false, count = 3) {
  if (!walking || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(count) || count < 1) return 0
  return Math.floor(seconds * PIXEL_WALK_FPS) % Math.floor(count)
}

// The YuLan side-facing artwork looks left by default, as in the 2D figure.
// Resolve world travel into camera-right instead of flipping by world X alone.
export function pixelFacingFlip(direction, cameraRight = { x: 1, z: 0 }, previous = false) {
  const horizontal = (Number(direction?.x) || 0) * (Number(cameraRight?.x) || 0)
    + (Number(direction?.z) || 0) * (Number(cameraRight?.z) || 0)
  return Math.abs(horizontal) < 1e-5 ? Boolean(previous) : horizontal > 0
}

/** Unpack TexturePacker rotation and trim into the original sprite rectangle. */
export function atlasFrameDraw(frame, x = 0, y = 0) {
  const crop = frame.frame
  const trim = frame.spriteSourceSize || { x: 0, y: 0,
    w: frame.rotated ? crop.h : crop.w, h: frame.rotated ? crop.w : crop.h }
  return {
    source: [crop.x, crop.y, crop.w, crop.h],
    translate: frame.rotated ? [x + trim.x, y + trim.y + trim.h] : [x + trim.x, y + trim.y],
    rotation: frame.rotated ? -Math.PI / 2 : 0,
    destination: frame.rotated ? [0, 0, trim.h, trim.w] : [0, 0, trim.w, trim.h],
  }
}

/**
 * Match makeFigure/makeHead's untrimmed Pixi sprite bounds and layer order.
 * Face/eyes/mouth are vertically centred; upper hair starts at zero, and the
 * lower hair sits behind the face at the upper hair's original height.
 */
export function pixelFigureLayout(person, atlas) {
  const appearance = pixelAppearance(person, atlas.headCounts)
  const keys = atlas.animations[appearance.animation] || atlas.animations['character/f/5_1']
  const bodyKeys = keys?.length ? keys : [atlas.frames.has(`${appearance.animation}/1.png`)
    ? `${appearance.animation}/1.png` : 'character/f/5_1/1.png']
  const bodies = bodyKeys.map(key => atlas.frames.get(key)).filter(Boolean)
  if (!bodies.length) throw new Error(`YuLan atlas has no body frames for ${person.id}`)
  const parts = []
  let headWidth = 0, headHeight = 0
  for (const [part, z] of [['f', 4], ['e', 5], ['m', 5], ['h', 6]]) {
    const key = `head/${appearance.gender}/${part}/${appearance.head[part]}.png`
    const frame = appearance.head[part] && atlas.frames.get(key)
    if (!frame) continue
    headWidth = Math.max(headWidth, frame.sourceSize.w)
    headHeight = Math.max(headHeight, frame.sourceSize.h)
    parts.push({ part, z, frame })
  }
  const hair = parts.find(item => item.part === 'h')
  const lower = hair && atlas.frames.get(`head/${appearance.gender}/h/${appearance.head.h}_0.png`)
  const headLayers = parts.map(item => ({ ...item,
    x: headWidth / 2 - item.frame.sourceSize.w / 2,
    y: item.part === 'h' ? 0 : headHeight / 2 - item.frame.sourceSize.h / 2,
  }))
  if (lower) headLayers.push({ part: 'lower-hair', z: 3, frame: lower,
    x: headWidth / 2 - lower.sourceSize.w / 2, y: hair.frame.sourceSize.h })
  // Pixi Container bounds also include the lower-hair child (not just max part).
  const headBounds = headLayers.length ? {
    minX: Math.min(...headLayers.map(item => item.x)),
    maxX: Math.max(...headLayers.map(item => item.x + item.frame.sourceSize.w)),
    minY: Math.min(...headLayers.map(item => item.y)),
    maxY: Math.max(...headLayers.map(item => item.y + item.frame.sourceSize.h)),
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const width = headBounds.maxX - headBounds.minX
  const height = headBounds.maxY - headBounds.minY
  const offsetX = bodies[0].sourceSize.w / 2 - width / 2
  const offsetY = -height
  const layers = headLayers.map(item => ({ ...item, x: item.x + offsetX, y: item.y + offsetY }))
    .sort((a, b) => a.z - b.z)
  const minX = Math.min(0, ...layers.map(item => item.x))
  const minY = Math.min(0, ...layers.map(item => item.y))
  const maxX = Math.max(...bodies.map(frame => frame.sourceSize.w), ...layers.map(item => item.x + item.frame.sourceSize.w))
  const maxY = Math.max(...bodies.map(frame => frame.sourceSize.h), ...layers.map(item => item.y + item.frame.sourceSize.h))
  return { appearance, bodies, headLayers: layers, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } }
}
