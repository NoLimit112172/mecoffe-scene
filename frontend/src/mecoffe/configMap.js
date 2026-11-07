// The map is static and population-free. Verify its files before applying private input.
export async function loadConfigMap({signal, fetcher=fetch, base=import.meta.env?.BASE_URL || '/'}={}) {
  const directory = `${base}mecoffe/config-map/`
  const response = await fetcher(directory+'scenario.json', {signal,cache:'no-store'})
  if (!response.ok) throw new Error('配置预览地图暂不可用，请重试')
  const manifest = await response.json()
  if (manifest.schema_version !== 'mecoffe.scenario.v1' || manifest.simulation_data !== false || !manifest.files) throw new Error('配置预览地图清单无效')
  const files = {}
  const allowed = /^(?:campus3d|asset_assignments|landcover|surroundings|entrances)\.json$|^gis\/(?:buildings|roads|landcover|water|boundary|pois|entrances)\.geojson$/
  await Promise.all(Object.entries(manifest.files).map(async ([name, expected]) => {
    if (!allowed.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('配置预览地图包含无效文件')
    const file = await fetcher(directory+name, {signal,cache:'no-store'})
    if (!file.ok) throw new Error('配置预览地图文件缺失')
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), v=>v.toString(16).padStart(2,'0')).join('')
    if (hash !== expected) throw new Error('配置预览地图版本不一致，请重新加载')
    files[name] = JSON.parse(new TextDecoder().decode(bytes))
  }))
  if (!files['campus3d.json'] || !files['entrances.json'] || !files['landcover.json']) throw new Error('配置预览地图不完整')
  return {manifest,files}
}
