import rawCatalog from '../../public/mecoffe/assets3d/catalog.json' with { type: 'json' }

const CATEGORIES = new Set(['building','road','landcover','vegetation','street_furniture','character','effect'])
const SOURCES = new Set(['procedural','yulan','osm','rocketbox'])

export function validateCatalog(catalog) {
  if (catalog?.schema_version !== 'mecoffe.asset-catalog.v1' || !Array.isArray(catalog.prototypes)) throw new Error('素材目录 schema_version 或 prototypes 无效')
  const ids = new Set()
  for (const item of catalog.prototypes) {
    if (!item.id || ids.has(item.id)) throw new Error(`重复或缺失的素材 id: ${item.id}`)
    ids.add(item.id)
    if (!CATEGORIES.has(item.category) || !item.subtype || !['parametric','mesh'].includes(item.kind)) throw new Error(`素材类别无效: ${item.id}`)
    if (!item.params || typeof item.params !== 'object' || !item.match || typeof item.match !== 'object') throw new Error(`素材参数或匹配规则缺失: ${item.id}`)
    if (!SOURCES.has(item.source?.type) || !item.source.path || !item.license?.spdx || !(item.license.path || item.license.url)) throw new Error(`素材来源或许可缺失: ${item.id}`)
    if (!item.preview || !Array.isArray(item.variants) || !item.variants.length) throw new Error(`素材预览或变体缺失: ${item.id}`)
    const variants = new Set()
    for (const variant of item.variants) {
      if (!variant.id || variants.has(variant.id) || !variant.params || typeof variant.params !== 'object') throw new Error(`素材变体无效: ${item.id}`)
      variants.add(variant.id)
    }
    for (const value of Object.values(item.match)) if (typeof value !== 'string' && !(Array.isArray(value) && value.every(v=>typeof v==='string'))) throw new Error(`匹配规则必须是字符串或列表: ${item.id}`)
  }
  return catalog
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

export const ASSET_CATALOG = freeze(validateCatalog(rawCatalog))
export default ASSET_CATALOG

export function getPrototype(id, catalog = ASSET_CATALOG) {
  const item = catalog.prototypes.find(item => item.id === id)
  if (!item) throw new Error(`素材原型不存在: ${id}`)
  return item
}

// AND across tag keys, OR within an array; '*' means a real, non-'no' tag.
export function matchScore(prototype, tags = {}) {
  let score = 0
  const rules = Object.entries(prototype.match)
  if (!rules.length) return -1
  for (const [key, expected] of rules) {
    const actual = tags[key]
    if (expected === '*') {
      if (actual == null || actual === '' || actual === 'no') return -1
      score += 1
    } else if ((Array.isArray(expected) ? expected : [expected]).includes(String(actual))) score += 4
    else return -1
  }
  return score
}

export function queryPrototypes(tags = null, { category, style, text = '', catalog = ASSET_CATALOG } = {}) {
  const needle = text.trim().toLowerCase()
  return catalog.prototypes.filter(item => (!category || item.category === category) && (!style || item.style === style)
    && (!needle || `${item.id} ${item.title} ${item.subtype}`.toLowerCase().includes(needle)) && (tags == null || matchScore(item,tags)>=0))
    .sort((a,b) => (tags == null ? 0 : matchScore(b,tags)-matchScore(a,tags)) || a.id.localeCompare(b.id,'en'))
}

export function variantHash(value) {
  let hash = 2166136261
  // UTF-8, shared with Python scene_builder; not JS UTF-16 code units.
  for (const byte of new TextEncoder().encode(String(value))) hash = Math.imul(hash ^ byte, 16777619)
  return hash >>> 0
}

export function selectPrototype(tags, { category = 'building', style = 'procedural', seed = 0, featureId = '', catalog = ASSET_CATALOG } = {}) {
  const candidates = queryPrototypes(tags,{category,style,catalog}).filter(item=>item.target!=='component')
  const prototype = candidates[0] || (category === 'building' ? getPrototype('building.procedural.other',catalog) : null)
  if (!prototype) throw new Error(`没有匹配的 ${category} 原型`)
  const variant = prototype.variants[variantHash(`${seed}|${featureId}|${prototype.id}`)%prototype.variants.length]
  return { prototype, variant, reason:candidates.length ? `OSM tags ${JSON.stringify(prototype.match)}` : 'explicit generic building fallback' }
}

export function prototypeParams(id, variantId = 'default', catalog = ASSET_CATALOG) {
  const prototype = getPrototype(id,catalog)
  const variant = prototype.variants.find(item=>item.id===variantId) || prototype.variants[0]
  return {...prototype.params,...variant.params}
}

export function catalogStats(catalog = ASSET_CATALOG) {
  const categories = {}, sources = {}
  for (const item of catalog.prototypes) { categories[item.category]=(categories[item.category]||0)+1; sources[item.source.type]=(sources[item.source.type]||0)+1 }
  return { total:catalog.prototypes.length, categories, sources }
}
