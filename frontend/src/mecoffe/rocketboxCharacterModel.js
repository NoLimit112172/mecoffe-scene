/** Display avatars only. A deterministic model choice is not a demographic
 * inference about the source agent. The original person ID/role stay intact. */
export const REAL_CHARACTER_HEIGHT = 8.5
export const REAL_CHARACTER_RADIUS = 3
export const ROCKETBOX_MODELS = Object.freeze(['Female_Adult_01', 'Female_Adult_03', 'Male_Adult_01', 'Male_Adult_14'])

export function rocketboxHash(value) {
  let hash = 2166136261
  for (const letter of String(value)) { hash ^= letter.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}

export function rocketboxModelForPerson(person, modelId) {
  if (modelId != null) {
    if (!ROCKETBOX_MODELS.includes(modelId)) throw new Error(`Unknown Rocketbox model: ${modelId}`)
    return modelId
  }
  if (person?.id == null) throw new Error('A source person ID is required')
  return ROCKETBOX_MODELS[rocketboxHash(person.id) % ROCKETBOX_MODELS.length]
}

export function rocketboxTextureUrl(url, model, base = '/mecoffe/assets3d/rocketbox/') {
  const name = decodeURIComponent(String(url)).split(/[\\/]/).at(-1).split(/[?#]/)[0].toLowerCase()
  const texture = (model.textures || []).find(item => item.source_name.toLowerCase() === name || item.path.split('/').at(-1).toLowerCase() === name)
  if (texture) return `${base.replace(/\/?$/, '/')}${texture.path}`
  // Normal/specular files were not redistributed. They never trigger remote or
  // TGA requests; the loader removes those material slots after parsing.
  if (/\.(?:tga|png|jpe?g|bmp|tiff?)$/i.test(name)) return null
  return url
}

/** Keep the lowest available LOD; standard Rocketbox FBXs currently contain a
 * single mesh. Non-LOD attachments (eyes/hair) remain part of the same model. */
export function rocketboxLodNames(names) {
  const level = name => { const match = /(?:^|[_ .-])lod[_ .-]?(\d+)(?:$|[_ .-])/i.exec(name); return match ? Number(match[1]) : null }
  const levels = names.map(level).filter(value => value !== null)
  if (!levels.length) return [...names]
  const lowest = Math.max(...levels)
  return names.filter(name => level(name) == null || level(name) === lowest)
}

export function normalizeRocketboxBounds(bounds) {
  const { min, max } = bounds
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3 || ![...min,...max].every(Number.isFinite) || max[1] <= min[1]) throw new Error('Invalid Rocketbox bounds')
  // Eight centimetres of presentation-space headroom cover breathing/head sway.
  const scale = (REAL_CHARACTER_HEIGHT - .08) / (max[1] - min[1])
  const centre = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
  const radius = Math.hypot((max[0] - min[0]) / 2, (max[2] - min[2]) / 2) * scale
  const horizontal = Math.min(1, (REAL_CHARACTER_RADIUS - .3) / Math.max(radius, 1e-8))
  return { scale: [scale * horizontal, scale, scale * horizontal], offset: centre.map(value => -value), height: REAL_CHARACTER_HEIGHT - .08 }
}

/** Absolute time: pausing the owning replay freezes idle and walking alike. */
export function rocketboxCharacterPose(seconds = 0, phaseOffset = 0, walking = false, coffee = false) {
  const time = Number.isFinite(seconds) ? seconds : 0
  const phase = time * Math.PI * 2 * 1.55 + phaseOffset
  const stride = walking ? Math.sin(phase) : 0
  const idle = Math.sin(time * .85 + phaseOffset)
  return {
    leftLeg: stride * .34, rightLeg: -stride * .34,
    leftKnee: walking ? Math.max(0, -stride) * .45 : .035,
    rightKnee: walking ? Math.max(0, stride) * .45 : .035,
    leftArm: walking ? -stride * .29 : -.025 + idle * .015,
    rightArm: coffee ? .27 : walking ? stride * .29 : -.025 - idle * .015,
    leftElbow: .10, rightElbow: coffee ? 1.05 : .10,
    headTilt: idle * .012, coffee: Boolean(coffee),
  }
}
