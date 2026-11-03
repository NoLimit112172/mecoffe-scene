// Pure gallery helpers. Preview parameters never change a scene instance.
export const ASSET_CATEGORY_LABELS = Object.freeze({
  building: '建筑与立面', road: '道路', landcover: '地表', vegetation: '植被',
  street_furniture: '街道设施', character: '人物', effect: '事件特效',
})

export function previewParams(prototype, variant) {
  const defaults = Object.fromEntries(Object.entries(prototype.params || {}).map(([key, value]) =>
    [key, value && typeof value === 'object' && !Array.isArray(value) && 'default' in value ? value.default : value]))
  const selected = typeof variant === 'string'
    ? (prototype.variants || []).find(item => (typeof item === 'string' ? item : item.id) === variant) : variant
  return { ...defaults, ...(selected && typeof selected === 'object' ? selected.params || {} : {}) }
}

// WebGL viewport keeps the full card aspect; only the scissor is clipped. This
// avoids stretching previews while the top or bottom of a card is scrolling.
export function previewViewport(rect, viewport) {
  const values = [rect.left, rect.top, rect.width, rect.height, viewport.width, viewport.height]
  if (!values.every(Number.isFinite) || values.slice(2).some(value => value <= 0)) return null
  const right = rect.left + rect.width, bottom = rect.top + rect.height
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top)
  const clipRight = Math.min(viewport.width, right), clipBottom = Math.min(viewport.height, bottom)
  if (clipRight <= left || clipBottom <= top) return null
  return {
    viewport: { x: rect.left, y: viewport.height - bottom, width: rect.width, height: rect.height },
    scissor: { x: left, y: viewport.height - clipBottom, width: clipRight - left, height: clipBottom - top },
    aspect: rect.width / rect.height,
  }
}

export function safeSourceUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : null
}

export function describeMatch(match) {
  if (Array.isArray(match)) return match.map(describeMatch).join(' 或 ')
  if (!match || !Object.keys(match).length) return '手动选取 / 默认原型'
  return Object.entries(match).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : value}`).join(' · ')
}
