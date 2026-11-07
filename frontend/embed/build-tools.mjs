import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {artifactStats, pagesFiles} from '../pages/build-tools.mjs'

export const EMBED_BASE = '/scene/'
export const EMBED_ROUTES = ['mecoffe3d', 'mecoffe-gis', 'mecoffe3d/assets', 'licenses']
export const CONFIG_MAP_PREFIX = 'mecoffe/config-map/'
export const CONFIG_MAP_FILES = [
  'campus3d.json', 'asset_assignments.json', 'landcover.json', 'surroundings.json', 'entrances.json',
  ...['buildings', 'roads', 'landcover', 'water', 'boundary', 'pois', 'entrances'].map(name => `gis/${name}.geojson`),
]

/** 通用素材可以分发，按旧画像生成的个人素材卡只留在原应用。 */
export function embedCatalog(catalog, base = EMBED_BASE) {
  return {...catalog, prototypes: catalog.prototypes.filter(item => item.source.type !== 'rocketbox' && !item.params.person_id)
    .map(item => ({...item, preview: base + item.preview.replace(/^\/+/, '')}))}
}

/** 从已有地图中分离几何，不携带旧运行的人物、事件或业务地点映射。 */
export function configMapContents(publicRoot) {
  const source = path.join(publicRoot, 'mecoffe/scenarios/ustc-history')
  const original = JSON.parse(fs.readFileSync(path.join(source, 'scenario.json'), 'utf8'))
  const files = new Map()
  for (const name of CONFIG_MAP_FILES) {
    let raw = fs.readFileSync(path.join(source, name))
    if (name === 'gis/buildings.geojson' || name === 'gis/pois.geojson') {
      const data = JSON.parse(raw)
      data.features = data.features.filter(feature => !feature.properties?.illustrative).map(feature => {
        const properties = {...feature.properties}
        delete properties.location_ids
        delete properties.location_id
        return {...feature, properties}
      })
      raw = Buffer.from(JSON.stringify(data) + '\n')
    }
    files.set(name, raw)
  }
  const manifest = {
    schema_version: 'mecoffe.scenario.v1', id: 'ustc-config-map', title: '中科大高新校区 · 配置预览地图',
    map: original.map, style: original.style, simulation_data: false,
    simulation_time: {start: '2026-01-01T00:00:00+08:00', timezone: 'Asia/Shanghai', step_unit: 'day', steps: 1,
      intervals: [{start: '2026-01-01T00:00:00+08:00', end: '2026-01-02T00:00:00+08:00'}]},
    files: Object.fromEntries([...files].map(([name, raw]) => [name, crypto.createHash('sha256').update(raw).digest('hex')])),
  }
  files.set('scenario.json', Buffer.from(JSON.stringify(manifest) + '\n'))
  return files
}

/** 嵌入包仅从允许列表复制素材，运行和配置数据留在私有 API。 */
export function embedFiles(publicRoot, catalog) {
  return pagesFiles(publicRoot, catalog).filter(name => name === 'favicon.svg' || name.startsWith('assets/') || name.startsWith('mecoffe/assets3d/'))
}

/** 检查可分发目录没有人口快照、运行记录或未授权数据文件。 */
export function assertEmbedArtifact(root) {
  const allowedMap = new Set([...CONFIG_MAP_FILES, 'scenario.json'])
  const problems = []
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const full = path.join(folder, entry.name)
      const name = path.relative(root, full).replaceAll('\\', '/')
      if (entry.isDirectory()) walk(full)
      else if (name.startsWith('mecoffe/') && !name.startsWith('mecoffe/assets3d/')) {
        if (!name.startsWith(CONFIG_MAP_PREFIX) || !allowedMap.has(name.slice(CONFIG_MAP_PREFIX.length))) problems.push(`嵌入包出现非地图数据文件 ${name}`)
      }
    }
  }
  walk(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, CONFIG_MAP_PREFIX, 'scenario.json'), 'utf8'))
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, CONFIG_MAP_PREFIX, name))).digest('hex')
    if (actual !== expected) problems.push(`地图文件哈希不一致 ${name}`)
  }
  for (const route of EMBED_ROUTES) if (!fs.existsSync(path.join(root, route, 'index.html'))) problems.push(`缺少嵌入入口 ${route}`)
  if (!fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes(EMBED_BASE + 'assets/')) problems.push('嵌入构建资源基址错误')
  if (problems.length) throw new Error(problems.join('\n'))
  return artifactStats(root)
}
