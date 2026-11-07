// Synthetic-only M11 fix acceptance. No private inputs or team server access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),embed=process.argv.includes('--embed'),tag=embed?'embed':'local';
const origin=embed?'http://127.0.0.1:5188':'http://127.0.0.1:5180',base=origin+(embed?'/scene':'');
const out=path.join(root,'logs/milestone11');fs.mkdirSync(out,{recursive:true});
const fixture=name=>JSON.parse(fs.readFileSync(path.join(root,'frontend/tests/fixtures/generic-replay',name+'.json'),'utf8'));
const snapshot=fixture('snapshot'),trajectory=fixture('trajectory');
const brands=['brand_alpha','brand_beta','brand_gamma'];
const report={mode:tag,source:'synthetic-only',viewport:'1600x1000',checks:[],screenshots:[],errors:[],badResponses:[],externalRequests:[]};
let server,browser;
async function shot(page,name,locator){
  const filename=`fixes-${tag}-${name}.png`,target=path.join(out,filename);
  if(locator)await locator.screenshot({path:target});else await page.screenshot({path:target,fullPage:true});
  report.screenshots.push(`logs/milestone11/${filename}`);
}
async function ready(page,gis=false){
  await Promise.race([
    page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000}),
    page.getByTestId('config-preview-error').waitFor({timeout:120000}).then(async()=>{throw new Error(await page.getByTestId('config-preview-error').innerText())}),
  ]);
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="配置文件"]')?.disabled);
  assert.equal(await page.locator('[role=alert],vite-error-overlay').count(),0);
  assert.equal(await page.getByTestId('config-preview').getAttribute('data-people'),'7');
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,7);assert.equal(accounting.visible+accounting.inside,7);assert.equal(accounting.valid,true);
}
async function shops(page,gis=false){
  const label=page.locator(gis?'.gis-indoor-roofs [data-shop-building]':'.map-canvas [data-shop-building]').first();
  await label.waitFor({state:'visible',timeout:30000});
  assert.equal(await label.getAttribute('data-shop-brands'),brands.join(','));
  assert.match(await label.innerText(),/学生食堂A区.*门店 A \/ B \/ C（示意）/);
  await shot(page,`${gis?'gis':'3d'}-multi-shop-label`);
  await label.click();await page.getByTestId('building-shops').waitFor();
  const panel=page.getByTestId('building-shops');
  assert.deepEqual(await panel.locator('[data-shop-brand]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.shopBrand,name:node.querySelector('b').textContent}))),brands.map((id,i)=>({id,name:`门店 ${'ABC'[i]}（示意）`})));
  await panel.scrollIntoViewIfNeeded();await shot(page,`${gis?'gis':'3d'}-building-shops`);
  return await label.getAttribute('data-shop-building');
}
async function person(page,id,gis=false){
  if(!gis)await page.getByRole('navigation',{name:'场景信息'}).getByRole('button',{name:'人物',exact:true}).click();
  await page.locator(`${gis?'.gis-roster':'.roster'} [data-person-id="${id}"]`).click();
  await page.locator(gis?'.gis-info .role-badge':'.person-detail .person-title small').waitFor();
}
async function roles(page,gis=false){
  const legend=page.locator(gis?'.gis-role-key':'.role-key');
  assert.match(await legend.innerText(),/样例访客/);assert.match(await legend.innerText(),/样例经营者/);assert.match(await legend.innerText(),/样例研究人员/);
  assert(!/visitor|operator|research/.test(await legend.innerText()));
  const visitor=snapshot.nodes.find(node=>node.role==='visitor');await person(page,visitor.entity_id,gis);
  const badge=page.locator(gis?'.gis-info .role-badge':'.person-detail .person-title small');
  assert.equal(await badge.innerText(),'样例访客');assert.equal(await badge.getAttribute('title'),visitor.role_description);
  const description=page.locator(gis?'.gis-info .role-description':'.person-detail .role-description');
  await description.locator('summary').click();assert.match(await description.innerText(),/样例访客/);
  await description.scrollIntoViewIfNeeded();await shot(page,`${gis?'gis':'3d'}-chinese-roles`);
}
async function endReplay(page,gis=false){
  await page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
  if(gis)assert.match(await page.locator('.gis-metrics>div').filter({hasText:'回放订单'}).innerText(),/2\s*单/);
  else assert.match(await page.getByTestId('order-count').innerText(),/^2\s*单/);
}
async function eventDetails(page,outcome,gis=false){
  const action=trajectory.actions.find(action=>action.outcome===outcome);
  if(gis)await person(page,action.actor.entity_id,true);
  else await page.getByRole('navigation',{name:'场景信息'}).getByRole('button',{name:'事件',exact:true}).click();
  const entry=page.locator(gis?'.activity-item':'.event-entry').filter({has:page.locator(`.event-result-details`)}).filter({hasText:outcome==='declined'?'被拒绝':'结果未知'}).first();
  await entry.waitFor();
  const prose=await (gis?entry:entry.locator('button.event-row')).innerText();
  assert.match(prose,outcome==='declined'?/购买被拒绝.*购买条件未满足/:/发帖结果未知.*未确认写入状态/);
  assert(!/[{}]|"accepted"|"reason"|"message"/.test(prose));
  await entry.scrollIntoViewIfNeeded();await shot(page,`${gis?'gis':'3d'}-${outcome}-readable`,entry);
  await entry.locator('.event-result-details summary').click();
  const raw=JSON.parse(await entry.locator('pre[aria-label="动作原始数据"]').innerText());
  assert.deepEqual(raw,{action:action.action,outcome,raw_result:action.result});
  await shot(page,`${gis?'gis':'3d'}-${outcome}-raw`,entry);
  await entry.locator('.event-result-details summary').click();
}
(async()=>{
  if(embed)server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5188});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)report.badResponses.push({url:response.url(),status:response.status()})});
  await page.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith(origin+'/')){report.externalRequests.push(url);return route.abort()}return route.continue()});
  await page.goto(base+'/mecoffe3d?preview=local',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'加载合成回放样例',exact:true}).click();await ready(page);
  const building3d=await shops(page);report.checks.push('3D shows all three same-building stores with stable A/B/C identities and matching building-card list');
  await roles(page);report.checks.push('3D role legend and person label use explicit Chinese descriptions, full role details retained');
  await endReplay(page);await eventDetails(page,'declined');await eventDetails(page,'unknown');
  const eventProse=await page.locator('.event-row').allInnerTexts();for(const letter of 'ABC')assert(eventProse.some(text=>text.includes(`门店 ${letter}（示意）`)),`successful events must use stable store ${letter}`);
  const totals=page.locator('.brand-totals [data-shop-brand]');
  assert.deepEqual(await totals.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.shopBrand,name:node.querySelector('.shop-name').textContent}))),brands.map((id,i)=>({id,name:`门店 ${'ABC'[i]}（示意）`})));
  report.checks.push('3D readable declined/unknown prose has no JSON; disclosures preserve exact source; only two successful orders');
  await page.locator('.preview-bar a').click();await ready(page,true);
  const buildingGis=await shops(page,true);assert.equal(buildingGis,building3d);await roles(page,true);
  report.checks.push('GIS uses same complete multi-store label and A/B/C brand list, Chinese role labels and full descriptions');
  await endReplay(page,true);await eventDetails(page,'declined',true);await eventDetails(page,'unknown',true);
  report.checks.push('GIS preserves two-order totals and readable outcomes with exact raw disclosures');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
})().catch(async error=>{report.ok=false;report.failure=error.stack;process.exitCode=1;const page=browser?.contexts().flatMap(context=>context.pages()).at(-1);if(page){try{await shot(page,'failure');report.failureText=await page.locator('body').innerText()}catch{}}}).finally(async()=>{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,`fixes-${tag}-qa.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
