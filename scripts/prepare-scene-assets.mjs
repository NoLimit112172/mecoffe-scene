// Offline release metadata. Reuse the current publisher without changing it.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {embedCatalog} from '../frontend/embed/build-tools.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const version='mecoffe-embed-v1',directory=path.join(root,'adapter/scene_builder/resources',version)
const source=JSON.parse(fs.readFileSync(path.join(root,'frontend/public/mecoffe/assets3d/catalog.json'),'utf8'))
const catalog=Buffer.from(JSON.stringify(embedCatalog(source))) // exact publisher bytes, no trailing newline
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const descriptor={schema_version:'scene.asset-library.v1',version,catalog_file:'catalog.json',catalog_sha256:sha(catalog)}
const files={'catalog.json':catalog,'asset-library.json':Buffer.from(JSON.stringify(descriptor,null,2)+'\n')}
for(const [name,bytes] of Object.entries(files)){
  const target=path.join(directory,name)
  if(fs.existsSync(target)){
    if(!fs.readFileSync(target).equals(bytes))throw Error(`已登记版本不可覆盖：${name}；发布内容变化需要新版本目录并更新调用方`)
  }else{
    if(!process.argv.includes('--write'))throw Error(`缺少发布资源 ${name}；首次登记使用 --write`)
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(target,bytes)
  }
}
if(process.argv.includes('--dist')){
  const published=fs.readFileSync(path.join(root,'frontend/dist-embed/mecoffe/assets3d/catalog.json'))
  if(!published.equals(catalog))throw Error('dist-embed 的 catalog 与登记版本字节不一致')
}
console.log(JSON.stringify(descriptor))
