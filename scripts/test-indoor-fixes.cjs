// Browser plugin not available; existing Chrome headless for requested UI QA.
// Flow: USTC load -> locate every person -> inspect relations/doors/cafes ->
// replay a recorded event -> verify sharp annotations and population accounting.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'logs/milestone9/fixes'),pages=process.argv.includes('--pages');fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'frontend/public/mecoffe/scene.json')));
async function ready(p,gis){await p.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000});await p.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});if(!gis)await p.locator('.style-status').waitFor({state:'hidden',timeout:120000});await p.getByTestId('person-accounting').waitFor();assert.equal(await p.locator('[role=alert],vite-error-overlay').count(),0)}
async function seek(p,gis,n){await p.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate((el,n)=>{el.value=n;el.dispatchEvent(new Event('input',{bubbles:true}))},n);await p.waitForTimeout(250)}
(async()=>{
  const origin=pages?'http://127.0.0.1:5187':'http://127.0.0.1:5180',base=origin+(pages?'/mecoffe-scene':''),report={viewport:'1600x1000',mode:pages?'pages':'local',errors:[],badResponses:[],rootRequests:[],models:[]};let server;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    if(pages)server=await servePages({port:5187});const context=await browser.newContext({viewport:{width:1600,height:1000}});
    await context.route('**/*',r=>/^https?:/.test(r.request().url())&&!r.request().url().startsWith(origin+'/')?r.abort():r.continue());
    const open=async url=>{const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});p.on('response',r=>{if(r.status()>=400)report.badResponses.push([r.status(),r.url()])});p.on('request',r=>{const u=r.url();if(/\.(?:fbx|glb)(?:\?|$)/.test(u))report.models.push(u);if(pages&&u.startsWith(origin+'/')&&!u.startsWith(base+'/'))report.rootRequests.push(u)});await p.goto(base+url);return p};
    const p=await open('/mecoffe3d?scenario=ustc-history');await ready(p,false);assert.match(await p.title(),/中科大.*历史回放/);assert.equal(await p.locator('.map-canvas').getAttribute('data-entrance-count'),'31');
    assert.match(await p.locator('[data-campus-label="way/1435377506"]').innerText(),/学生食堂B区/);assert.match(await p.locator('[data-campus-label="way/1435377504"]').innerText(),/教工食堂/);
    await p.getByLabel('光照预览',{exact:true}).selectOption('12');await p.screenshot({path:path.join(out,'cafeterias.png')});
    await p.getByRole('button',{name:'人物',exact:true}).click();const roster=p.locator('.roster [data-person-id]'),ids=await roster.evaluateAll(els=>els.map(el=>el.dataset.personId));assert.equal(ids.length,100);
    for(const id of ids){await p.locator(`.roster [data-person-id="${id}"]`).evaluate(el=>el.click());assert.equal(await p.locator('.map-canvas').getAttribute('data-selected-person'),id);assert(await p.locator('.map-canvas').getAttribute('data-focused-building'));assert.match(await p.locator('.person-detail').innerText(),/内（示意）/)}
    report.all100RosterSelections='passed';
    const chosen=data.people.map(person=>({id:person.id,count:data.relationships.filter(e=>e.source===person.id||e.target===person.id).length})).sort((a,b)=>b.count-a.count)[0].id;
    await p.locator(`.roster [data-person-id="${chosen}"]`).evaluate(el=>el.click());assert(Number(await p.locator('.map-canvas').getAttribute('data-relationship-lines'))>0);await p.getByRole('button',{name:'全景',exact:true}).click();await p.waitForTimeout(250);await p.screenshot({path:path.join(out,'relations.png')});
    await seek(p,false,2.5);await p.getByRole('button',{name:'全景',exact:true}).click();await p.waitForTimeout(300);
    const accounting=JSON.parse(await p.locator('[data-person-accounting]').getAttribute('data-person-accounting'));assert(accounting.valid);assert.equal(accounting.visible+accounting.inside,100);assert.equal(await p.locator('[data-outside-person]:visible').count(),accounting.visible);report.sandboxAccounting=accounting;report.outsideMarkers=accounting.visible;await p.screenshot({path:path.join(out,'accounting.png')});
    await seek(p,false,0);await p.locator('.roster [data-person-id="merchant_001"]').evaluate(el=>el.click());await p.waitForTimeout(200);assert.equal(await p.locator('.map-canvas').getAttribute('data-focused-building'),'way/1435377506');assert(await p.locator('[data-door-building="way/1435377506"]:visible').count());await p.screenshot({path:path.join(out,'door-centre.png')});
    const {indexScene}=await import(pathToFileURL(path.join(root,'frontend/src/mecoffe/replay.js'))),{positionAtCursor}=await import(pathToFileURL(path.join(root,'frontend/src/mecoffe/campus3dPlayback.js'))),index=indexScene(data),i=data.events.findIndex(e=>e.type==='comment'),event=data.events[i];
    await p.locator(`.roster [data-person-id="${event.actor}"]`).evaluate(el=>el.click());await seek(p,false,positionAtCursor(index,i));await p.getByRole('button',{name:'下一事件',exact:true}).click();await p.waitForTimeout(180);if((await p.locator('.play-button').innerText()).trim()==='暂停')await p.locator('.play-button').click();await p.screenshot({path:path.join(out,'labels-closeup.png')});
    if(!pages){report.textures=await p.evaluate(()=>[...window.__mecoffe3d.view.eventEffects.textures.values()].map(v=>({width:v.texture.image.width,height:v.texture.image.height,ratio:v.ratio})));assert(report.textures.length&&report.textures.every(t=>t.ratio>=2))}
    await p.close();
    const gis=await open('/mecoffe-gis?scenario=ustc-history');await ready(gis,true);assert.equal(await gis.locator('.gis-map').getAttribute('data-entrance-count'),'31');
    for(const id of ids){await gis.locator(`.gis-roster [data-person-id="${id}"]`).evaluate(el=>el.click());assert.match(await gis.getByTestId('gis-query-card').innerText(),/在 .*内（示意）/)}report.gisAll100RosterSelections='passed';
    await seek(gis,true,2.5);await gis.getByRole('button',{name:'全景',exact:true}).click();await gis.waitForTimeout(800);report.gisAccounting=JSON.parse(await gis.locator('[data-person-accounting]').getAttribute('data-person-accounting'));assert.deepEqual(report.gisAccounting,accounting);assert.equal(await gis.locator('[data-outside-person]:visible').count(),accounting.visible);await gis.screenshot({path:path.join(out,'gis-accounting.png')});await gis.reload();await ready(gis,true);await gis.close();
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);assert.deepEqual(report.rootRequests,[]);assert(report.models.every(u=>!u.endsWith('.fbx')));report.passed=true;
  }catch(e){report.failure=String(e.stack||e);for(const ctx of browser.contexts())for(const page of ctx.pages()){report.visibleText=(await page.locator('body').innerText()).slice(0,2500);await page.screenshot({path:path.join(out,'failure.png')})}throw e}
  finally{fs.writeFileSync(path.join(out,(pages?'pages':'local')+'-qa.json'),JSON.stringify(report,null,2));await browser.close();if(server)await new Promise(r=>server.close(r))}
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
