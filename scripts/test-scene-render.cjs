// DEV: verify source mismatch, then use an explicit published-catalog test response.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),fixtures=path.join(root,'frontend/tests/fixtures/scene-render'),out=path.join(root,'logs/milestone15-render');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:5206',report={checks:[],screenshots:[],errors:[],externalRequests:[],apiRequests:[]};
let browser,server;
const read=name=>JSON.parse(fs.readFileSync(path.join(fixtures,name+'.json'),'utf8'));
async function shot(page,name){const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push(path.relative(root,file));}
async function ready(page,gis=false){
  await Promise.race([page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:90000}),page.getByTestId('scene-result-error').waitFor({timeout:90000}).then(async()=>{throw Error(await page.getByTestId('scene-result-error').innerText())})]);
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:90000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(gis=>{const e=document.querySelector(gis?'.gis-page':'.campus3d-page');return e?.dataset.personAccounting&&JSON.parse(e.dataset.personAccounting).total===7},gis);
  const data=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(data.total,7);assert.equal(data.out_of_scene,2);assert.equal(data.valid,true);
  assert.equal(await page.locator('[role=alert],vite-error-overlay').count(),0);
}
async function assignments(page){return page.locator('[data-assignment-person]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.assignmentPerson,n.dataset.building,n.dataset.entrance,n.dataset.placementStatus]));}
async function open(context,input='a',gis=false){
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(origin+(gis?'/mecoffe-gis':'/mecoffe3d')+'?scene=local');
  await page.getByLabel('地图库根目录',{exact:true}).setInputFiles(path.join(fixtures,'maps'));
  await page.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(path.join(fixtures,'input-'+input+'.json'));
  return page;
}
(async()=>{
  const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
  server=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),server:{host:'127.0.0.1',port:5206,strictPort:true,open:false}});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});
  const sourceContext=await browser.newContext({viewport:{width:1600,height:1050}});
  await sourceContext.route('**/*',route=>{const u=new URL(route.request().url());if(/^https?:$/.test(u.protocol)&&u.origin!==origin){report.externalRequests.push(u.href);return route.abort()}if(u.pathname.startsWith('/api/')){report.apiRequests.push(u.pathname);return route.abort()}return route.continue()});
  const sourcePage=await open(sourceContext);await sourcePage.getByTestId('scene-result-error').filter({hasText:'当前为源码素材，与发布版不同'}).waitFor();assert.equal(await sourcePage.locator('canvas').count(),0);await shot(sourcePage,'dev-source-catalog-rejected');await sourceContext.close();
  report.checks.push('DEV actual source catalog is explicitly rejected; subsequent geometry tests provide the pinned published catalog as an explicit fixture response');
  const context=await browser.newContext({viewport:{width:1600,height:1050}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(/^https?:$/.test(u.protocol)&&u.origin!==origin){report.externalRequests.push(u.href);return route.abort()}if(u.pathname==='/mecoffe/assets3d/catalog.json')return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'adapter/scene_builder/resources/mecoffe-embed-v1/catalog.json'))});if(u.pathname.startsWith('/api/')){report.apiRequests.push(u.pathname);return route.fulfill({status:404,json:{detail:'no API in local scene test'}})}return route.continue()});
  const page=await open(context);await ready(page);assert.match(await page.locator('.page-header h1').textContent(),/合成校园甲/);
  const initial=await assignments(page),input=read('input-a');
  await page.locator('.scene-placement-details summary').click();
  for(const id of ['brand_alpha','brand_beta','brand_gamma'])assert.equal(await page.locator(`[data-service-brand="${id}"]`).count(),1);
  assert.match(await page.locator('[data-service-brand="brand_gamma"]').innerText(),/场景外/);assert.match(await page.getByTestId('scene-placement-details').innerText(),/建筑标签/);await shot(page,'a-three-config');await page.locator('.scene-placement-details summary').click();
  const draw=await page.evaluate(()=>[...window.__mecoffe3d.view.indoor.people.values()].map(p=>[p.id,p.homeBuilding]));
  assert.equal(draw.length,5);for(const [id,building]of draw)assert.equal(building,input.scene_result.assignments.find(a=>a.entity_id===id).building_id);
  await page.locator('.roster [data-person-id="synthetic_person_07"]').click();assert.match(await page.locator('.person-detail').innerText(),/场景外[\s\S]*安置理由/);
  assert.equal(await page.evaluate(()=>window.__mecoffe3d.view.selectedId),null);
  await page.locator('.scene-inputs').getByRole('link',{name:/^GIS 地图/}).click();await ready(page,true);assert.deepEqual(await assignments(page),initial);
  await page.locator('.gis-roster [data-person-id="synthetic_person_07"]').click();assert.match(await page.getByTestId('gis-query-card').innerText(),/场景外/);
  assert.match(await page.locator('.gis-header h1').textContent(),/合成校园甲/);await page.locator('.scene-placement-details summary').click();await shot(page,'a-gis-config');
  await page.locator('.scene-inputs').getByRole('link',{name:/^三维沙盘/}).click();await ready(page);
  await page.getByLabel('SceneResult 展示模式').selectOption('replay');await ready(page);assert.deepEqual(await assignments(page),initial);
  await page.getByRole('button',{name:'看人物行走',exact:true}).click();
  await page.waitForFunction(()=>window.__mecoffe3d?.view.indoor.people.get('synthetic_person_01')?.walker,{timeout:10000});
  const route=await page.evaluate(()=>{const p=window.__mecoffe3d.view.indoor.people.get('synthetic_person_01');return {home:p.homeBuilding,shop:p.walker.shopBuilding,door:p.walker.shopDoor.id}});
  const service=input.scene_result.service_points.find(p=>p.brand_id==='brand_alpha');assert.equal(route.shop,service.building_id);assert.equal(route.door,service.entrance_id);
  assert.notEqual(route.shop,await page.evaluate(()=>window.__mecoffe3d.view.indoor.people.get('synthetic_person_03').homeBuilding));await shot(page,'a-purchase-service-route');
  await page.getByLabel('SceneResult 展示模式').selectOption('live');await ready(page);assert.deepEqual(await assignments(page),initial);
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'应用下一批合成实时事件'}).click();
  await page.waitForFunction(()=>parseInt(document.querySelector('[data-testid=order-count]')?.textContent,10)===2);await shot(page,'a-live-confirmed');
  await page.locator('.scene-inputs').getByRole('link',{name:/^GIS 地图/}).click();await ready(page,true);assert.deepEqual(await assignments(page),initial);
  assert.match(await page.locator('.gis-metrics > div').nth(3).innerText(),/已核实订单\s*2\s*单/);
  await page.locator('.scene-inputs').getByRole('link',{name:/^三维沙盘/}).click();await ready(page);await page.waitForFunction(()=>parseInt(document.querySelector('[data-testid=order-count]')?.textContent,10)===2);
  report.checks.push('A: 3D/GIS exact assignments + 7=5 mapped+2 outside; all three service points; replay targets service entrance; M14 confirmed events retain placements');
  await page.getByLabel('SceneResult 展示模式').selectOption('config');await page.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(path.join(fixtures,'input-b.json'));await ready(page);
  assert.match(await page.locator('.page-header h1').textContent(),/中科大公开几何测试副本/);await shot(page,'b-three-config');const bplaces=await assignments(page);
  await page.locator('.scene-inputs').getByRole('link',{name:/^GIS 地图/}).click();await ready(page,true);assert.deepEqual(await assignments(page),bplaces);assert.match(await page.locator('.gis-header h1').textContent(),/中科大公开几何测试副本/);await shot(page,'b-gis-config');
  report.checks.push('B: same-tab second map_ref switches actual geometry/title; GIS positions match');
  await page.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(path.join(fixtures,'input-none.json'));await page.getByTestId('scene-none').waitFor();
  assert.equal(await page.locator('canvas').count(),0);assert.match(await page.getByTestId('scene-none').textContent(),/人物与关系/);await shot(page,'none-gis');
  await page.locator('.scene-inputs').getByRole('link',{name:/^三维沙盘/}).click();await page.getByTestId('scene-none').waitFor();assert.equal(await page.locator('canvas').count(),0);await shot(page,'none-three');
  assert.equal(await page.getByTestId('none-event').count(),0);
  await page.getByLabel('SceneResult 展示模式').selectOption('replay');await page.waitForFunction(count=>document.querySelectorAll('[data-testid=none-event]').length===count,read('input-none').trajectory.actions.length);
  await page.getByLabel('SceneResult 展示模式').selectOption('live');await page.waitForFunction(()=>document.querySelectorAll('[data-testid=none-event]').length===0&&document.querySelector('[data-testid=scene-result-entry]').dataset.mode==='live');
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'应用下一批合成实时事件'}).click();assert((await page.getByTestId('none-event').count())>0);assert.equal(await page.locator('canvas').count(),0);await shot(page,'none-live-events');
  report.checks.push('none: both views create no canvas and keep population/relations/events text');
  const {sceneDigest}=await import(pathToFileURL(path.join(root,'frontend/src/mecoffe/sceneResult.js')).href);
  const missing=read('input-a');missing.scene_result.map_ref.map_id='synthetic-missing';delete missing.scene_result.result_sha256;missing.scene_result.result_sha256=sceneDigest(missing.scene_result);
  const bad=path.join(out,'synthetic-missing-map.json');fs.writeFileSync(bad,JSON.stringify(missing));await page.getByLabel('SceneResult 展示模式').selectOption('config');await page.getByLabel('SceneResult 与模拟输入',{exact:true}).setInputFiles(bad);
  await page.getByTestId('scene-result-error').waitFor();assert.match(await page.getByTestId('scene-result-error').textContent(),/MAP_FILE_MISSING/);assert.equal(await page.locator('canvas').count(),0);await shot(page,'missing-map-no-fallback');
  report.checks.push('missing map: explicit error, no USTC fallback and no canvas');
  await page.close();assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.apiRequests,[]);report.ok=true;
})().catch(error=>{report.ok=false;report.failure=error.stack;process.exitCode=1}).finally(async()=>{await browser?.close();await server?.close();fs.writeFileSync(path.join(out,'qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))});
