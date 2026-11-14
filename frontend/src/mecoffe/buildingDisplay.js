// Presentation only: never replaces a building identifier or frozen map data.
export function hasBuildingName(building) {
  const name = typeof building?.name === 'string' ? building.name.trim() : ''
  if (!name || building?.name_source === 'display_fallback') return false
  return !building.osm_id || name !== `未命名建筑（${building.osm_id}）`
}

export function buildingName(building) {
  return hasBuildingName(building) ? building.name.trim() : '未命名楼栋'
}
