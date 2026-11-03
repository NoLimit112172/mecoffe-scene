import {publicUrl} from './publicUrl.js'
/** Display avatars only. A deterministic model choice is not a demographic
 * inference about the source agent. The original person ID/role stay intact. */
export const REAL_CHARACTER_HEIGHT = 8.5
export const REAL_CHARACTER_RADIUS = 3
// Legacy fixtures for callers that inject their own model sources. The live
// library and scene always use manifest.models (all 115 human models).
export const ROCKETBOX_MODELS = Object.freeze(['Female_Adult_01', 'Female_Adult_03', 'Male_Adult_01', 'Male_Adult_14'])

export function rocketboxHash(value) {
  let hash = 2166136261
  for (const letter of String(value)) { hash ^= letter.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}

export function rocketboxModelForPerson(person, modelId, availableIds = ROCKETBOX_MODELS) {
  const ids = [...new Set(availableIds)].sort()
  if (!ids.length) throw new Error('No human Rocketbox models are available')
  if (modelId != null) {
    if (!ids.includes(modelId)) throw new Error(`Unknown Rocketbox model: ${modelId}`)
    return modelId
  }
  if (person?.id == null) throw new Error('A source person ID is required')
  return ids[rocketboxHash(person.id) % ids.length]
}

export function rocketboxHumanModels(manifest) {
  return (manifest?.models || []).filter(model => model?.id && model.human !== false && model.category !== 'animals'
    && model.category !== 'animal' && !/^(?:animals?[_/]|dog[_/]|cat[_/]|horse[_/])/i.test(model.id))
}

/** Stable full-population assignment with no repeated appearance until every
 * human model has been used. Input ordering and roles never alter the result. */
export function rocketboxAssignments(people, availableIds = ROCKETBOX_MODELS, explicitModelId) {
  const ids = [...new Set(availableIds)].sort(), result = new Map(), used = new Set()
  if (!ids.length) throw new Error('No human Rocketbox models are available')
  const sorted = [...people].sort((a,b) => rocketboxHash(a.id) - rocketboxHash(b.id) || String(a.id).localeCompare(String(b.id)))
  for (const person of sorted) {
    const first = rocketboxModelForPerson(person,explicitModelId,ids)
    if (explicitModelId) { result.set(String(person.id),first); continue }
    if (used.size === ids.length) used.clear()
    let index = ids.indexOf(first)
    while (used.has(ids[index])) index = (index + 1) % ids.length
    used.add(ids[index]); result.set(String(person.id),ids[index])
  }
  return result
}

export function rocketboxTextureUrl(url, model, base = publicUrl('mecoffe/assets3d/rocketbox/')) {
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
