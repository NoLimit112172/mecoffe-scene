// Configuration inputs are kept in memory. This adapter never creates activity.
import {presentRole,snapshotRoleDescriptions} from './rolePresentation.js'
import {buildScenePlacement} from './scenePlacement.js'
const ENTITY_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/
const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const STAGE_STATES = new Set(['pending', 'running', 'completed', 'failed'])
const MAP_FILES = new Set(['campus3d.json', 'asset_assignments.json', 'landcover.json', 'surroundings.json', 'entrances.json'])
const GEO_FILES = /^gis\/(buildings|roads|landcover|water|boundary|pois|entrances)\.geojson$/

export const STATIC_ATTRIBUTE_LABELS = Object.freeze({
  gender: '性别', age: '年龄', age_group: '年龄段', urban_context: '城乡背景',
  education_status: '教育状态', employment_category: '就业类别',
  household_income_band: '家庭收入范围', wechat_sharing: '微信分享频率',
  shopping_frequency_week: '每周购物频率', shortvideo_week: '短视频使用',
  stranger_trust_score: '陌生人信任', social_reputation_score: '社会声誉重视程度',
  mindset_orientation: '心态倾向', sleep_hours_band: '睡眠时长',
  exercise_frequency_code: '运动频率',
})

export class ConfigPreviewError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ConfigPreviewError'
    this.code = code
  }
}

function fail(code, message) {
  throw new ConfigPreviewError(code, message)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return structuredClone(value)
}

function contextId(value, label) {
  if (typeof value !== 'string' || !CONTEXT_ID.test(value)) fail('INVALID_CONTEXT', `${label}无效`)
  return value
}

function stagePayload(value, name) {
  if (!object(value)) fail('INVALID_STAGE', `${name === 'network' ? '关系' : '角色'}数据格式不正确`)
  if (Object.hasOwn(value, 'status') || Object.hasOwn(value, 'payload')) {
    if (value.name !== name || !STAGE_STATES.has(value.status)) fail('INVALID_STAGE', '配置阶段信息不正确')
    if (value.status === 'failed') fail('STAGE_FAILED', `${name === 'network' ? '关系' : '角色'}阶段生成失败，请先在配置页处理后重试`)
    if (value.status !== 'completed' || value.payload === null) fail('STAGE_PENDING', '配置尚未准备完成，请等待角色与关系阶段完成后重试')
    if (!object(value.payload)) fail('INVALID_STAGE', '已完成配置缺少有效的阶段产物')
    return value.payload
  }
  return value
}

function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schema_version !== '1.0') fail('INVALID_SNAPSHOT', '人物快照格式版本不受支持')
  if (typeof snapshot.snapshot_id !== 'string' || !snapshot.snapshot_id.trim() ||
      !Number.isInteger(snapshot.snapshot_revision) || snapshot.snapshot_revision < 1) {
    fail('INVALID_SNAPSHOT', '人物快照缺少编号或有效版本')
  }
  if (!Array.isArray(snapshot.nodes) || !snapshot.nodes.length || !Array.isArray(snapshot.edges)) {
    fail('INVALID_SNAPSHOT', '人物快照必须包含人物和关系列表')
  }
  const ids = new Set()
  for (const node of snapshot.nodes) {
    if (!object(node) || typeof node.entity_id !== 'string' || typeof node.role !== 'string' ||
        !ENTITY_ID.test(node.entity_id) || !ENTITY_ID.test(node.role)) fail('INVALID_PERSON', '人物编号或角色编号无效')
    if (ids.has(node.entity_id)) fail('DUPLICATE_PERSON', '人物快照中存在重复人物编号')
    if ((node.static_attributes != null && !object(node.static_attributes)) ||
        (node.dynamic_attributes != null && !object(node.dynamic_attributes))) fail('INVALID_ATTRIBUTES', '人物属性必须是对象')
    ids.add(node.entity_id)
  }
  const edges = new Set()
  for (const edge of snapshot.edges) {
    if (!object(edge) || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) {
      fail('INVALID_RELATIONSHIP', '关系指向不存在的人物或指向自己')
    }
    if (!['follow', 'competition'].includes(edge.relation)) fail('INVALID_RELATIONSHIP', '关系类型应为 follow 或 competition')
    const key = JSON.stringify([edge.source, edge.target, edge.relation])
    if (edges.has(key)) fail('DUPLICATE_RELATIONSHIP', '人物快照中存在重复关系')
    edges.add(key)
  }
}

function validatePopulationRequest(request, snapshot) {
  if (!object(request) || !Object.keys(request).length) fail('INVALID_ROLES', '角色阶段缺少人物生成说明')
  const counts = new Map()
  for (const node of snapshot.nodes) counts.set(node.role, (counts.get(node.role) || 0) + 1)
  if (Object.keys(request).length !== counts.size) fail('ROLE_MISMATCH', '角色说明与人物快照不一致，请确认来自同一份配置')
  for (const [role, spec] of Object.entries(request)) {
    if (!ENTITY_ID.test(role) || !object(spec) || typeof spec.description !== 'string' || !spec.description.trim() ||
        !Number.isInteger(spec.count) || spec.count < 1 || spec.count !== counts.get(role)) {
      fail('ROLE_MISMATCH', '角色说明或人数与人物快照不一致，请确认来自同一份配置')
    }
    if (!object(spec.generate || {})) fail('INVALID_FIELDS', '角色的生成字段说明必须是对象')
    for (const field of Object.values(spec.generate || {})) {
      if (!object(field) || typeof field.title !== 'string' || !field.title.trim()) fail('INVALID_FIELDS', '生成字段缺少中文标题')
    }
  }
}

function fallbackPopulationRequest(snapshot) {
  const counts = new Map()
  for (const node of snapshot.nodes) counts.set(node.role, (counts.get(node.role) || 0) + 1)
  const descriptions=snapshotRoleDescriptions(snapshot)
  return Object.fromEntries([...counts].map(([role, count]) => [role, {description: descriptions.get(role)||role, count, generate: {}}]))
}

/** 统一校验本地原始文件与服务端阶段响应，保留所有画像原值。 */
export function normalizeConfigPreview({network, roles, session, config, seed} = {}) {
  const networkPayload = stagePayload(network, 'network')
  const snapshot = object(networkPayload.snapshot) ? networkPayload.snapshot : networkPayload
  validateSnapshot(snapshot)
  if (roles === undefined && (session !== undefined || config !== undefined)) fail('INVALID_ROLES', '远程配置必须提供同一份配置的角色阶段产物')
  const populationRequest = roles === undefined ? fallbackPopulationRequest(snapshot) : stagePayload(roles, 'roles').population_request
  validatePopulationRequest(populationRequest, snapshot)
  const selectedSeed = seed ?? snapshot.seed ?? 0
  if (!Number.isSafeInteger(selectedSeed)) fail('INVALID_SEED', '配置种子必须是安全整数')
  const context = {seed: selectedSeed, snapshot_id: snapshot.snapshot_id, snapshot_revision: snapshot.snapshot_revision, source: 'local'}
  if (session !== undefined) context.session_id = contextId(session, '会话编号')
  if (config !== undefined) context.config_id = contextId(config, '配置编号')
  for (const stage of [network, roles]) {
    if (stage?.config_id !== undefined && context.config_id !== undefined && stage.config_id !== context.config_id) {
      fail('CONFIG_MISMATCH', '角色与关系数据不属于所选配置')
    }
  }
  return {snapshot: clone(snapshot), populationRequest: clone(populationRequest), context}
}

/** 仅从同源配置接口读取，不接受远程 URL、Cookie 或令牌参数。 */
export async function loadConfigPreview({session, config, signal, fetcher = fetch} = {}) {
  contextId(session, '会话编号')
  contextId(config, '配置编号')
  const prefix = `/api/sessions/${encodeURIComponent(session)}/configs/${encodeURIComponent(config)}/stages/`
  async function read(name) {
    let response
    try {
      response = await fetcher(prefix + name, {signal, cache: 'no-store', credentials: 'same-origin'})
    } catch (error) {
      if (error.name === 'AbortError') throw error
      fail('NETWORK_ERROR', '配置服务暂时无法连接，请确认网站服务可用后重试')
    }
    if (response.status === 401) fail('LOGIN_REQUIRED', '登录已失效，请返回团队网站重新登录后重试')
    if (response.status === 404) fail('CONFIG_NOT_FOUND', '配置不存在或当前账号无权访问，请核对会话和配置编号')
    if (!response.ok) fail('HTTP_ERROR', `配置服务暂不可用（${response.status}），请稍后重试`)
    try { return await response.json() } catch { fail('INVALID_RESPONSE', '配置服务返回的内容不是有效 JSON') }
  }
  const [network, roles] = await Promise.all([read('network'), read('roles')])
  const result = normalizeConfigPreview({network, roles, session, config})
  result.context.source = 'remote'
  return result
}

function hash(text) {
  let result = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) result = Math.imul(result ^ byte, 0x01000193) >>> 0
  return result
}

function placementRulesFor(rules, roles, ids, buildings) {
  if (!object(rules)) fail('INVALID_PLACEMENT', '楼栋安置规则必须是对象')
  const roleRules = Object.hasOwn(rules, 'roles') || Object.hasOwn(rules, 'entities') ? rules.roles || {} : rules
  const entityRules = rules.entities || {}
  if (!object(roleRules) || !object(entityRules)) fail('INVALID_PLACEMENT', '楼栋安置规则格式不正确')
  for (const [role, id] of Object.entries(roleRules)) {
    if (!roles.has(role) || !buildings.has(id)) fail('INVALID_PLACEMENT', '角色安置规则引用了不存在的角色或楼栋')
  }
  for (const [entity, id] of Object.entries(entityRules)) {
    if (!ids.has(entity) || !buildings.has(id)) fail('INVALID_PLACEMENT', '人物安置规则引用了不存在的人物或楼栋')
  }
  return {roleRules, entityRules}
}

function profileFields(node, request) {
  const statics = Object.entries(node.static_attributes || {}).map(([key, value]) => ({key, label: Object.hasOwn(STATIC_ATTRIBUTE_LABELS, key) ? STATIC_ATTRIBUTE_LABELS[key] : key, value: clone(value), source: 'static'}))
  const dynamic = Object.entries(node.dynamic_attributes || {}).map(([key, value]) => ({key, label: request.generate?.[key]?.title || key, value: clone(value), source: 'dynamic'}))
  return [...statics, ...dynamic]
}

/** 将已校验快照安置到地图，全部人物在楼内且不生成模拟行为。 */
export function buildConfigPreviewScenario(input, mapScenario, placementRules = {}, sceneResult = null) {
  if(sceneResult)return buildScenePlacement(input,mapScenario,sceneResult)
  const checked = normalizeConfigPreview({network: input?.snapshot, roles: {population_request: input?.populationRequest},
    session: input?.context?.session_id, config: input?.context?.config_id, seed: input?.context?.seed})
  const context = {...checked.context, source: input.context.source || checked.context.source}
  const campus = mapScenario?.files?.['campus3d.json']
  if (!object(campus) || !Array.isArray(campus.buildings) || !campus.buildings.length) fail('INVALID_MAP', '配置预览缺少可用校园楼栋')
  const buildings = [...campus.buildings].sort((a, b) => String(a.osm_id) < String(b.osm_id) ? -1 : String(a.osm_id) > String(b.osm_id) ? 1 : 0)
  const buildingById = new Map(buildings.map(building => [building.osm_id, building]))
  if (buildingById.size !== buildings.length || buildings.some(building => typeof building.osm_id !== 'string' || !building.osm_id)) fail('INVALID_MAP', '地图楼栋编号无效或重复')
  const mappings = Object.fromEntries(buildings.map((building, i) => [`config_building_${i + 1}`, {
    osm_id: building.osm_id, osm_name: building.name || '未命名楼栋', illustrative: true,
    note: '按显式规则或配置种子的确定性规则安排，属于展示示意。',
  }]))
  const keyByBuilding = new Map(Object.entries(mappings).map(([key, entry]) => [entry.osm_id, key]))
  const snapshot = checked.snapshot
  const rules = placementRulesFor(placementRules, new Set(snapshot.nodes.map(node => node.role)), new Set(snapshot.nodes.map(node => node.entity_id)), buildingById)
  const people = snapshot.nodes.map(node => {
    const request = checked.populationRequest[node.role]
    const fallback = buildings[hash(`${context.seed}|${node.role}`) % buildings.length].osm_id
    const explicit = Object.hasOwn(rules.entityRules, node.entity_id) ? rules.entityRules[node.entity_id]
      : Object.hasOwn(rules.roleRules, node.role) ? rules.roleRules[node.role] : null
    const osmId = explicit || fallback
    const locationKey = keyByBuilding.get(osmId)
    const identity=presentRole(node.role,request.description)
    return {...clone(node), id: node.entity_id, name: node.name || node.entity_id, role_label: identity.label, role_description: identity.description,
      bio: node.bio || node.description || '', gender: {male: 'm', female: 'f'}[node.static_attributes?.gender],
      age: node.static_attributes?.age, profile: clone(node.dynamic_attributes || {}),
      profile_fields: profileFields(node, request), location_key: locationKey,
      building_id: locationKey, home_location_id: locationKey, indoor: true,
      placement_source: explicit ? 'explicit' : 'seed_role',
    }
  })
  const locations = buildings.map(building => ({location_id: keyByBuilding.get(building.osm_id), name: building.name || '未命名楼栋',
    kind: building.kind || building.building_type || 'other', illustrative: true,
    buildings: [{building_id: keyByBuilding.get(building.osm_id), name: building.name || '未命名楼栋'}], default_for_roles: []}))
  const scene = {schema: 'mecoffe.scene.v1', meta: {mode: 'network_snapshot', config_preview: true, status: 'not_run',
    run_id: null, partial: false, ...context, completed_steps: 0, total_steps: 0,
    placement_rule: '角色与楼栋按编号稳定排序，未配置的角色使用 FNV-1a(seed|role) 对楼栋数量取模；同角色同楼栋。',
    limitations: ['配置预览 · 尚未运行模拟。人物所在楼栋与路线为展示层示意，OASIS 没有位置数据。']},
    people, relationships: clone(snapshot.edges), brands: [], events: [], posts: {},
    campus: {schema_version: 'mecoffe.campus.v2', campus_id: campus.campus_id, title: campus.title, locations},
    summary: {people: people.length, relationships: snapshot.edges.length, events: 0, orders: 0, revenue_fen: 0, noop: 0, by_type: {}},
    days: [{step: 0, label: '配置预览', complete: true, counts: {}, noop: 0}]}
  const files = Object.fromEntries(Object.entries(mapScenario.files).filter(([name]) => MAP_FILES.has(name) || GEO_FILES.test(name)).map(([name, value]) => [name, clone(value)]))
  files['trajectory.json'] = scene
  files['location_mapping.json'] = {schema_version: 'mecoffe.campus3d_mapping.v1', campus_id: campus.campus_id, illustrative: true,
    note: '配置预览的楼栋安置属于展示示意。', mappings}
  for (const feature of files['gis/buildings.geojson']?.features || []) {
    feature.properties.location_ids = [keyByBuilding.get(feature.id)].filter(Boolean)
  }
  if (files['gis/pois.geojson']) files['gis/pois.geojson'].features = files['gis/pois.geojson'].features.filter(feature => !feature.properties?.illustrative)
  const manifest = {...clone(mapScenario.manifest), id: 'config-preview', title: '中科大高新校区 · 配置预览',
    preview_mode: 'config', simulation_data: false, generated_in_memory: true, files: {}, context}
  return {manifest, files}
}
