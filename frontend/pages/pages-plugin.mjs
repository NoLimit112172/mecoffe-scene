import fs from 'node:fs'
import path from 'node:path'
import {publishedCatalog,pagesFiles,rewriteAssetMetadata,assertArtifact,ENTRY_ROUTES} from './build-tools.mjs'

export function pagesPreparation(root,base){
  const publicRoot=path.join(root,'public'),cache=path.join(root,'node_modules/.cache/mecoffe-pages')
  fs.mkdirSync(cache,{recursive:true})
  const sourceCatalog=JSON.parse(fs.readFileSync(path.join(publicRoot,'mecoffe/assets3d/catalog.json'),'utf8'))
  const filtered={...sourceCatalog,prototypes:sourceCatalog.prototypes.filter(p=>p.source.type!=='rocketbox')}
  const aliases=[]
  for(const relative of ['mecoffe/assets3d/catalog.json','mecoffe/assets3d/kenney/manifest.json']){
    const original=path.join(publicRoot,relative),target=path.join(cache,path.basename(relative))
    const data=relative.endsWith('catalog.json')?publishedCatalog(sourceCatalog,base):rewriteAssetMetadata(JSON.parse(fs.readFileSync(original,'utf8')),base)
    fs.writeFileSync(target,JSON.stringify(data))
    aliases.push({find:'../../public/'+relative,replacement:target.replaceAll('\\','/')})
    aliases.push({find:original.replaceAll('\\','/'),replacement:target.replaceAll('\\','/')})
  }
  return {aliases,plugin:{
    name:'mecoffe-pages-artifact',
    transformIndexHtml:{order:'pre',handler:html=>html.replace('/src/main.js','/src/pages-main.js')},
    closeBundle(){
      const out=path.join(root,'dist')
      for(const relative of pagesFiles(publicRoot,filtered)){
        const source=path.join(publicRoot,relative),dest=path.join(out,relative);fs.mkdirSync(path.dirname(dest),{recursive:true})
        if(relative==='mecoffe/assets3d/catalog.json')fs.writeFileSync(dest,JSON.stringify(publishedCatalog(sourceCatalog,base)))
        else if(relative.endsWith('/manifest.json')&&/assets3d/.test(relative))fs.writeFileSync(dest,JSON.stringify(rewriteAssetMetadata(JSON.parse(fs.readFileSync(source,'utf8')),base)))
        else fs.copyFileSync(source,dest)
      }
      const licenses={
        'YuLan-Apache-2.0.txt':path.join(root,'../YULAN_LICENSE'),
        'NOTICE.md':path.join(root,'../NOTICE.md'),
        'Three-MIT.txt':path.join(root,'node_modules/three/LICENSE'),
        'Vue-MIT.txt':path.join(root,'node_modules/vue/LICENSE'),
        'VueRouter-MIT.txt':path.join(root,'node_modules/vue-router/LICENSE'),
        'PixiJS-MIT.txt':path.join(root,'node_modules/pixi.js/LICENSE'),
        'PixiViewport-MIT.txt':path.join(root,'node_modules/pixi-viewport/LICENSE'),
        'ECharts-Apache-2.0.txt':path.join(root,'node_modules/echarts/LICENSE'),
        'ECharts-NOTICE.txt':path.join(root,'node_modules/echarts/NOTICE'),
        'FontAwesome-LICENSE.txt':path.join(root,'node_modules/@fortawesome/fontawesome-free/LICENSE.txt'),
      }
      fs.mkdirSync(path.join(out,'licenses'),{recursive:true})
      for(const [name,source]of Object.entries(licenses))fs.copyFileSync(source,path.join(out,'licenses',name))
      const index=fs.readFileSync(path.join(out,'index.html'),'utf8')
      for(const route of ENTRY_ROUTES){fs.mkdirSync(path.join(out,route),{recursive:true});fs.writeFileSync(path.join(out,route,'index.html'),index)}
      // Known routes have real static entry files (200, no server fallback).
      // Unknown paths use Pages' 404 document and a base-scoped round trip.
      const recovery=`<script>if(sessionStorage.getItem('mecoffe-pages-restore')){var p=sessionStorage.getItem('mecoffe-pages-restore');sessionStorage.removeItem('mecoffe-pages-restore');if(p.startsWith(${JSON.stringify(base)}))history.replaceState(null,'',p)}</script>`
      for(const file of ['index.html',...ENTRY_ROUTES.map(route=>route+'/index.html')])fs.writeFileSync(path.join(out,file),index.replace('<head>','<head>'+recovery))
      fs.writeFileSync(path.join(out,'404.html'),`<!doctype html><meta charset="UTF-8"><title>MeCoffe</title><p>正在打开页面…</p><script>sessionStorage.setItem('mecoffe-pages-restore',location.pathname+location.search+location.hash);location.replace(${JSON.stringify(base)})</script>`)
      fs.writeFileSync(path.join(out,'.nojekyll'),'')
      const report=path.join(out,'site-size.json')
      // Include the report itself in the published byte/file count.
      fs.writeFileSync(report,'{}')
      for(let pass=0;pass<3;pass++)fs.writeFileSync(report,JSON.stringify(assertArtifact(out,base),null,2))
      const stats=assertArtifact(out,base)
      console.log(`\nPages artifact: ${(stats.totalBytes/1e6).toFixed(2)} MB; ${stats.files} files`)
      console.table(stats.largest.map(item=>({file:item.file,MB:(item.bytes/1e6).toFixed(2)})))
    }
  }}
}
