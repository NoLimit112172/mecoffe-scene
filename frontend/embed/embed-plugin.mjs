import fs from 'node:fs'
import path from 'node:path'
import {rewriteAssetMetadata} from '../pages/build-tools.mjs'
import {mapDependencyNotices} from '../pages/dependency-notices.mjs'
import {CONFIG_MAP_PREFIX, configMapContents, EMBED_BASE, EMBED_ROUTES, embedCatalog, embedFiles, assertEmbedArtifact} from './build-tools.mjs'

/** 开发服务器仅提供可公开的固定地图，配置数据由浏览器文件或同源 API 提供。 */
export function configMapPlugin(root) {
  return {name: 'mecoffe-config-preview-map', generateBundle() {
    for (const [name, raw] of configMapContents(path.join(root, 'public'))) {
      this.emitFile({type: 'asset', fileName: CONFIG_MAP_PREFIX + name, source: raw})
    }
  }, configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (!pathname.startsWith('/' + CONFIG_MAP_PREFIX)) return next()
      const name = pathname.slice(CONFIG_MAP_PREFIX.length + 1)
      if (request.method !== 'GET' && request.method !== 'HEAD') {response.statusCode = 405; response.end(); return}
      const files = configMapContents(path.join(root, 'public'))
      const raw = files.get(name)
      if (!raw) {response.statusCode = 404; response.end(); return}
      response.setHeader('Content-Type', name.endsWith('.geojson') ? 'application/geo+json; charset=utf-8' : 'application/json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end(request.method === 'HEAD' ? undefined : raw)
    })
  }}
}

/** 生成可挂载在 /scene/ 的独立静态子应用，明确排除运行与配置文件。 */
export function embedPreparation(root) {
  const publicRoot = path.join(root, 'public')
  const cache = path.join(root, 'node_modules/.cache/mecoffe-embed')
  fs.mkdirSync(cache, {recursive: true})
  const sourceCatalog = JSON.parse(fs.readFileSync(path.join(publicRoot, 'mecoffe/assets3d/catalog.json'), 'utf8'))
  const published = embedCatalog(sourceCatalog)
  const filtered = {...sourceCatalog, prototypes: sourceCatalog.prototypes.filter(item => item.source.type !== 'rocketbox' && !item.params.person_id)}
  const aliases = []
  for (const relative of ['mecoffe/assets3d/catalog.json', 'mecoffe/assets3d/kenney/manifest.json']) {
    const original = path.join(publicRoot, relative)
    const target = path.join(cache, path.basename(relative))
    const data = relative.endsWith('catalog.json') ? published : rewriteAssetMetadata(JSON.parse(fs.readFileSync(original, 'utf8')), EMBED_BASE)
    fs.writeFileSync(target, JSON.stringify(data))
    aliases.push({find: '../../public/' + relative, replacement: target.replaceAll('\\', '/')})
    aliases.push({find: original.replaceAll('\\', '/'), replacement: target.replaceAll('\\', '/')})
  }
  return {aliases, plugin: {
    name: 'mecoffe-private-embed-artifact',
    transformIndexHtml: {order: 'pre', handler: html => html.replace('/src/main.js', '/src/embed-main.js')},
    closeBundle() {
      const out = path.join(root, 'dist-embed')
      for (const relative of embedFiles(publicRoot, filtered)) {
        const source = path.join(publicRoot, relative), destination = path.join(out, relative)
        fs.mkdirSync(path.dirname(destination), {recursive: true})
        if (relative === 'mecoffe/assets3d/catalog.json') fs.writeFileSync(destination, JSON.stringify(published))
        else if (relative.endsWith('/manifest.json') && relative.includes('assets3d')) fs.writeFileSync(destination, JSON.stringify(rewriteAssetMetadata(JSON.parse(fs.readFileSync(source, 'utf8')), EMBED_BASE)))
        else fs.copyFileSync(source, destination)
      }
      for (const [name, raw] of configMapContents(publicRoot)) {
        const destination = path.join(out, CONFIG_MAP_PREFIX, name)
        fs.mkdirSync(path.dirname(destination), {recursive: true})
        fs.writeFileSync(destination, raw)
      }
      const licenses = {
        'YuLan-Apache-2.0.txt': path.join(root, '../YULAN_LICENSE'), 'NOTICE.md': path.join(root, '../NOTICE.md'),
        'Three-MIT.txt': path.join(root, 'node_modules/three/LICENSE'), 'MapLibre-BSD-3-Clause.txt': path.join(root, 'node_modules/maplibre-gl/LICENSE.txt'),
      }
      fs.mkdirSync(path.join(out, 'licenses'), {recursive: true})
      for (const [name, source] of Object.entries(licenses)) fs.copyFileSync(source, path.join(out, 'licenses', name))
      fs.writeFileSync(path.join(out, 'licenses/MapLibre-Dependencies.txt'), mapDependencyNotices(root))
      const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
      for (const route of EMBED_ROUTES) {
        fs.mkdirSync(path.join(out, route), {recursive: true})
        fs.writeFileSync(path.join(out, route, 'index.html'), index)
      }
      // 常见入口有真实目录，反向代理仍应仅为 /scene/ 子应用配置 HTML 回退。
      fs.writeFileSync(path.join(out, '404.html'), index)
      const stats = assertEmbedArtifact(out)
      console.log(`\nEmbed artifact: ${(stats.totalBytes / 1e6).toFixed(2)} MB; ${stats.files} files; synthetic samples only; no private configuration or run records`)
    },
  }}
}
