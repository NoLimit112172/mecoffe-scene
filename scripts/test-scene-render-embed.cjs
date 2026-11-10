// Real dist-embed catalog + strict static hosting. All simulation inputs are synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),fixtures=path.join(root,'frontend/tests/fixtures/scene-render'),out=path.join(root,'logs/milestone15-batch3');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:5207',base=origin+'/scene',report={checks:[],screenshots:[],errors:[],externalRequests:[],apiRequests:[],heights:[]};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let server,browser;
async function shot(page,name){const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push(path.relative(root,file));}
async function importInput(frame,name){await frame.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(path.join(fixtures,'input-'+name+'.json'));}
async function ready(frame,gis=false){
  await frame.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:90000});
  await frame.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:90000});
  if(!gis)await frame.locator('.style-status').waitFor({state:'hidden',timeout:90000});
  const accounting=JSON.parse(await frame.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,7);assert.equal(accounting.out_of_scene,2);assert.equal(accounting.valid,true);
  assert.equal(await frame.locator('[role=alert]').count(),0);
}
async function panelHeight(frame,label,gis=false){
  const panel=frame.getByTestId('scene-placement-details'),map=frame.locator(gis?'.gis-map-wrap':'.map-panel');
  assert.equal(await panel.getAttribute('open'),null);assert((await panel.boundingBox()).height<=34.1);
  const closed=(await map.boundingBox()).height;
  // Reapply the exact batch-2 closed-panel box rules as a layout reference.
  const style=await frame.addStyleTag({content:'.scene-placement-details{height:auto!important;min-height:0!important;padding:8px 12px!important;max-height:35vh!important}.scene-placement-details summary{white-space:normal!important;line-height:1.6!important}'});
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const previous=(await map.boundingBox()).height;await style.evaluate(el=>el.remove());
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(closed>=previous-1,`${label}: map shrank from batch-2 panel rules`);
  await panel.locator('summary').click();assert(Math.abs((await map.boundingBox()).height-closed)<=1,'opened details must overlay, not shrink map');
  assert.match(await panel.innerText(),/建筑标签/);assert.match(await panel.innerText(),/人工补注/);assert.match(await panel.innerText(),/安置理由：.*[\u4e00-\u9fff]/);
  report.heights.push({label,batch2Reference:previous,closed,opened:(await map.boundingBox()).height});await panel.locator('summary').click();
}
(async()=>{
  const descriptor=read(path.join(root,'adapter/scene_builder/resources/mecoffe-embed-v1/asset-library.json'));
  const actual=fs.readFileSync(path.join(root,'frontend/dist-embed/mecoffe/assets3d/catalog.json'));
  assert.equal(sha(actual),descriptor.catalog_sha256);assert(actual.equals(fs.readFileSync(path.join(root,'adapter/scene_builder/resources/mecoffe-embed-v1/catalog.json'))));
  const {sceneDigest}=await import(pathToFileURL(path.join(root,'frontend/src/mecoffe/sceneResult.js')).href);
  const bad=read(path.join(fixtures,'input-a.json')),badRoot=path.join(out,'source-catalog-maps'),badId='synthetic-source-catalog';
  fs.mkdirSync(badRoot,{recursive:true});fs.cpSync(path.join(fixtures,'maps',bad.scene_result.map_ref.map_id),path.join(badRoot,badId),{recursive:true});
  const manifestFile=path.join(badRoot,badId,'1/manifest.json'),manifest=read(manifestFile);manifest.map_id=badId;
  manifest.catalog_sha256=sha(fs.readFileSync(path.join(root,'frontend/public/mecoffe/assets3d/catalog.json')));
  assert.notEqual(manifest.catalog_sha256,descriptor.catalog_sha256);fs.writeFileSync(manifestFile,JSON.stringify(manifest)+'\n');
  bad.scene_result.map_ref={map_id:badId,map_version:'1',manifest_sha256:sha(fs.readFileSync(manifestFile))};delete bad.scene_result.result_sha256;bad.scene_result.result_sha256=sceneDigest(bad.scene_result);
  const badInput=path.join(out,'source-catalog-input.json');fs.writeFileSync(badInput,JSON.stringify(bad));
  server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5207});
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1600,height:1050}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(/^https?:$/.test(u.protocol)&&u.origin!==origin){report.externalRequests.push(u.href);return route.abort()}if(u.pathname.startsWith('/api/')){report.apiRequests.push(u.pathname);return route.abort()}return route.continue()});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  assert.equal((await context.request.get(base+'/not-a-route')).status(),404);
  await page.goto(base+'/mecoffe3d/?scene=local');await page.getByLabel('地图库根目录',{exact:true}).setInputFiles(path.join(fixtures,'maps'));await importInput(page,'a');await ready(page);
  await panelHeight(page,'desktop 3D');await shot(page,'published-catalog-three');
  await page.locator('.scene-inputs').getByRole('link',{name:/^GIS 地图/}).click();await ready(page,true);await panelHeight(page,'desktop GIS',true);await shot(page,'published-catalog-gis');
  report.checks.push('actual dist-embed published catalog loads the same map in 3D/GIS; strict static missing route stays 404');
  await page.getByLabel('地图库根目录',{exact:true}).setInputFiles(badRoot);await page.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(badInput);
  await page.getByTestId('scene-result-error').filter({hasText:'ASSET_VERSION_MISMATCH'}).waitFor();assert.match(await page.getByTestId('scene-result-error').innerText(),/源码版 catalog/);assert.equal(await page.locator('canvas').count(),0);await shot(page,'source-catalog-map-rejected');
  report.checks.push('source-catalog map has valid file/result hashes but is rejected explicitly, with no canvas or legacy fallback');
  await importInput(page,'none');await page.getByTestId('scene-none').waitFor();const text=await page.getByTestId('scene-none').innerText();
  assert.match(text,/本实验未启用地图/);assert.match(text,/样例人物 01/);assert.match(text,/合成校园访客/);assert(!/synthetic_person|visitor|operator|research/.test(text));assert.equal(await page.locator('canvas').count(),0);await shot(page,'none-desktop');
  await page.getByLabel('SceneResult 展示模式').selectOption('live');await page.getByRole('button',{name:'应用下一批合成实时事件'}).click();
  await page.getByTestId('scene-none').getByText(/订单待核对/).first().waitFor();assert.equal(await page.locator('canvas').count(),0);
  await page.close();
  const framePage=await context.newPage();framePage.on('pageerror',e=>report.errors.push(e.message));
  await framePage.setContent(`<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="${base}/mecoffe3d/?scene=local"></iframe>`);
  const frame=await (await framePage.locator('iframe').elementHandle()).contentFrame();await frame.getByLabel('地图库根目录',{exact:true}).setInputFiles(path.join(fixtures,'maps'));await importInput(frame,'a');await ready(frame);await panelHeight(frame,'full-page iframe');await shot(framePage,'iframe-three');
  await framePage.setViewportSize({width:390,height:844});await panelHeight(frame,'narrow iframe');await shot(framePage,'narrow-iframe-three');
  await importInput(frame,'none');await frame.getByTestId('scene-none').waitFor();assert.equal(await frame.locator('canvas').count(),0);await shot(framePage,'none-narrow-iframe');
  report.checks.push('Chinese names/roles in none mode; closed one-line details, open overlay, full iframe and narrow map heights meet batch-2 reference');
  await context.close();assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.apiRequests,[]);report.ok=true;
})().catch(error=>{report.ok=false;report.failure=error.stack;process.exitCode=1}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'embed-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))});
