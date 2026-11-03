// Pure palette/shape rules for full-volume characters derived from the SAME
// original YuLan body and head recipe used in the 2D scene. No role-colour swap.
export const YULAN_CHARACTER_HEIGHT = 8.5
// Includes swinging limbs and a held cup. Multiply by the displayed scale when
// testing presentation collisions; these deliberately enlarged figures are not
// real measured human dimensions.
export const YULAN_CHARACTER_RADIUS = 3.0

const clamp = (number, low, high) => Math.max(low, Math.min(high, number))
const hex = rgb => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]))

function validRaster(raster) {
  if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height)
    || raster.width < 1 || raster.height < 1 || !raster.data || raster.data.length !== raster.width * raster.height * 4) {
    throw new Error('YuLan colour sampling requires a complete RGBA raster')
  }
  return raster
}

export function opaqueBounds(raster, alpha = 192) {
  const { data, width, height } = validRaster(raster)
  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < alpha) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++
  }
  return count ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count } : null
}

/** Most common quantized opaque colour, averaged within its winning bucket.
 * Regions refer to the opaque silhouette, not padded atlas dimensions.
 * Outline filtering is optional: shoes/hair must retain genuinely dark colours.
 */
export function dominantOpaqueColour(raster, { region = [0, 0, 1, 1], excludeOutline = false, exclude = [] } = {}) {
  const bounds = opaqueBounds(raster)
  if (!bounds) return null
  const [left, top, right, bottom] = region.map(value => clamp(value, 0, 1))
  const bins = new Map()
  for (let y = Math.floor(bounds.minY + top * bounds.height); y <= Math.min(bounds.maxY, Math.ceil(bounds.minY + bottom * bounds.height) - 1); y++) {
    for (let x = Math.floor(bounds.minX + left * bounds.width); x <= Math.min(bounds.maxX, Math.ceil(bounds.minX + right * bounds.width) - 1); x++) {
      const index = (y * raster.width + x) * 4
      if (raster.data[index + 3] < 192) continue
      const rgb = Array.from(raster.data.slice(index, index + 3))
      if (excludeOutline && Math.max(...rgb) < 45) continue
      if (exclude.some(colour => distance(rgb, colour) < 42)) continue
      const key = rgb.map(value => Math.floor(value / 16)).join(',')
      const bin = bins.get(key) || { count: 0, sum: [0, 0, 0], key }
      bin.count++
      rgb.forEach((value, channel) => { bin.sum[channel] += value })
      bins.set(key, bin)
    }
  }
  const winner = [...bins.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0]
  return winner ? winner.sum.map(value => Math.round(value / winner.count)) : null
}

/** Hair volume class follows the sampled silhouette and presence of lower hair.
 * No assertion is made about an unseen real person's actual hairstyle.
 */
export function sampledHairStyle(hair, face, lowerHair = null) {
  const h = hair && opaqueBounds(hair), f = opaqueBounds(face)
  if (!h) return 'bald'
  if (lowerHair && opaqueBounds(lowerHair)?.count) return 'long'
  const faceHeight = f.height / face.height
  const hairHeight = h.height / hair.height
  let bottom = 0, left = 0, right = 0, total = 0
  for (let y = h.minY; y <= h.maxY; y++) for (let x = h.minX; x <= h.maxX; x++) {
    if (hair.data[(y * hair.width + x) * 4 + 3] < 192) continue
    total++
    if (y > h.minY + h.height * .65) bottom++
    if (x < h.minX + h.width / 2) left++; else right++
  }
  if (hairHeight > faceHeight * .88 && bottom / total > .18) return 'bob'
  if (Math.abs(left - right) / total > .09) return left > right ? 'sweep-left' : 'sweep-right'
  return hairHeight < faceHeight * .55 ? 'cropped' : 'short'
}

export function sampleYuLanAppearance(layout, rasters) {
  if (!layout?.appearance || !layout.bodies?.length) throw new Error('A YuLan 2D appearance layout is required')
  const { body, face, hair, lowerHair } = rasters
  const skin = dominantOpaqueColour(face, { excludeOutline: true })
  if (!skin) throw new Error('YuLan face contains no opaque skin samples')
  const wholeBody = dominantOpaqueColour(body, { excludeOutline: true })
  if (!wholeBody) throw new Error('YuLan body contains no opaque colour samples')
  const shirt = dominantOpaqueColour(body, { region: [.2, .12, .8, .48], excludeOutline: true, exclude: [skin] }) || wholeBody
  const trousers = dominantOpaqueColour(body, { region: [.15, .62, .85, .85], excludeOutline: true }) || wholeBody
  const shoes = dominantOpaqueColour(body, { region: [0, .92, 1, 1] }) || trousers
  const hairColour = hair && dominantOpaqueColour(hair, { excludeOutline: true }) || skin
  const accent = dominantOpaqueColour(body, { region: [0, .05, .22, .55], excludeOutline: true, exclude: [shirt, skin] }) || shirt
  const parts = Object.fromEntries(layout.headLayers.filter(layer => ['f', 'e', 'm', 'h'].includes(layer.part)).map(layer => [layer.part, layer.frame.key]))
  return {
    skin: hex(skin), hair: hex(hairColour), shirt: hex(shirt), trousers: hex(trousers), shoes: hex(shoes), accent: hex(accent),
    hairStyle: sampledHairStyle(hair, face, lowerHair), bareLegs: distance(trousers, skin) < 42,
    source: { body: layout.bodies[0].key, head: parts, recipe: layout.appearance.animation,
      method: 'opaque-silhouette regional RGBA sampling; 16-level colour buckets', license: 'Apache-2.0' },
    phaseOffset: (layout.appearance.hash % 1024) / 1024 * Math.PI * 2,
  }
}

export function yuLanAppearanceKey(layout) {
  return [layout.bodies[0].key, ...layout.headLayers.map(layer => layer.frame.key)].join('|')
}

/** The caller owns the simulation/display clock; unchanged seconds freezes idle
 * and walking joints exactly. Coffee is held upright by a separate hand prop.
 */
export function yuLanCharacterPose(seconds = 0, phaseOffset = 0, walking = false, coffee = false) {
  const time = Number.isFinite(seconds) ? seconds : 0
  const phase = time * Math.PI * 2 * 1.65 + phaseOffset
  const stride = walking ? Math.sin(phase) : 0
  const idle = Math.sin(time * .85 + phaseOffset)
  return {
    leftLeg: stride * .58, rightLeg: -stride * .58,
    leftKnee: walking ? Math.max(0, -stride) * .32 : .01,
    rightKnee: walking ? Math.max(0, stride) * .32 : .01,
    leftArm: walking ? -stride * .45 : -.035 + idle * .02,
    rightArm: coffee ? -.72 : walking ? stride * .45 : -.035 - idle * .02,
    leftElbow: -.08, rightElbow: coffee ? -.7 : -.08,
    bob: walking ? Math.abs(Math.sin(phase * 2)) * .10 : idle * .025,
    headTilt: Math.sin(time * .65 + phaseOffset) * .018,
    coffee: Boolean(coffee),
  }
}
