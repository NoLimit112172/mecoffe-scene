const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const output=path.resolve(__dirname,'../logs/milestone7');fs.mkdirSync(output,{recursive:true});
const routes=[['root','/'],['2d','/mecoffe'],['3d','/mecoffe3d'],['assets','/mecoffe3d/assets'],['nus','/mecoffe3d?campus=nus'],['ustc-scenario','/mecoffe3d?scenario=ustc-history'],['nus-scenario','/mecoffe3d?scenario=nus-hourly'],['excluded-library','/mecoffe3d/assets?source=rocketbox'],['licenses','/licenses']];
async function ready(page,name){
  await page.locator('h1').first().waitFor({timeout:120000});assert(!await page.locator('vite-error-overlay').count());
  if(['root','3d','ustc-scenario'].includes(name)){
    await page.locator('.map-canvas canvas').waitFor({timeout:120000});await page.locator('.map-loading').waitFor({state:'hidden',timeout:120000});await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});await page.locator('.character-loading').waitFor({state:'hidden',timeout:120000});
    assert(await page.getByRole('button',{name:'播放回放',exact:true}).isEnabled());
  }else if(['assets','excluded-library'].includes(name)){
    await page.locator('.preview-status').first().filter({hasText:'校内实际'}).waitFor({timeout:120000});assert.match(await page.getByTestId('asset-count').textContent(),/233 \/ 233/);assert.equal(await page.locator('option[value="rocketbox"]').count(),0);
  }else if(name==='2d'){
    await page.locator('canvas').first().waitFor({timeout:120000});await page.waitForFunction(()=>document.querySelector('.mc-mode button')?.disabled===false,null,{timeout:120000});await page.locator('.mc-play').waitFor();
  }else if(name==='nus'||name==='nus-scenario'){
    await page.locator('.model-layout canvas').waitFor({timeout:120000});assert.match(await page.locator('aside').textContent(),/226/);
    if(name==='nus-scenario')assert.match(await page.getByTestId('simulation-time').textContent(),/尚无模拟数据/);
  }else assert.match(await page.locator('main').textContent(),/Tiffany Do.*MIT/s);
  assert.equal(await page.locator('[role=alert]').count(),0)
}
(async()=>{
  const server=await servePages({port:5187}),origin='http://127.0.0.1:5187',base=origin+'/mecoffe-scene',browser=await chromium.launch({channel:'chrome',headless:true});
  const report={environment:'Browser plugin not available; existing Playwright / Chrome headless',viewport:'1600x1000',server:'strict static files, no fallback',routes:[],errors:[],badResponses:[],rootRequests:[]};
  const save=()=>fs.writeFileSync(path.join(output,'pages-qa.json'),JSON.stringify(report,null,2));
  try{
    const context=await browser.newContext({viewport:{width:1600,height:1000}})
    for(const [name,route]of routes){
      const page=await context.newPage();page.on('pageerror',e=>report.errors.push({name,message:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({name,message:m.text()})});page.on('response',r=>{if(r.status()>=400)report.badResponses.push({name,url:r.url(),status:r.status()})});page.on('request',r=>{if(r.url().startsWith(origin+'/')&&!r.url().startsWith(base+'/'))report.rootRequests.push({name,url:r.url()})});
      await page.goto(base+route,{waitUntil:'domcontentloaded'});await ready(page,name);const firstUrl=page.url();await page.reload({waitUntil:'domcontentloaded'});await ready(page,name);assert(page.url().startsWith(base+'/'));
      if(name==='3d'){await page.getByRole('button',{name:'历史回放',exact:true}).click();await ready(page,name);await page.getByRole('button',{name:'看人物行走',exact:true}).click();await page.waitForTimeout(1000);assert.match(await page.getByTestId('active-walkers').textContent(),/[1-4] 人在途/)}
      if(name==='2d'){await page.locator('.mc-play').click();await page.waitForTimeout(300);assert.match(await page.locator('.mc-play').textContent(),/暂停/);await page.locator('.mc-play').click()}
      if(name==='assets'){await page.getByLabel('素材来源',{exact:true}).selectOption('valid');await page.locator('.preview-status').first().filter({hasText:'VALID'}).waitFor({timeout:120000});assert.equal(await page.locator('.preview-status.error').count(),0)}
      if(name==='nus-scenario'){await page.getByLabel('模拟时间进度').evaluate(el=>{el.value=6;el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForTimeout(300);assert.match(await page.getByTestId('simulation-time').textContent(),/12:00/)}
      if(name==='licenses'){for(const href of await page.locator('a').evaluateAll(links=>links.map(a=>a.href).filter(h=>h.startsWith(location.origin))))assert.equal((await context.request.get(href)).status(),200)}
      await page.screenshot({path:path.join(output,name+'.png')});report.routes.push({name,firstUrl,refreshedUrl:page.url(),title:await page.title(),status:'passed'});save();console.log('PASS',name);await page.close();
    }
    const missing=await context.request.get(base+'/does-not-exist');assert.equal(missing.status(),404);report.noServerFallbackVerified=true;
    // A fresh browser context, disabled HTTP cache and explicit slow 4G budget.
    const slow=await browser.newContext({viewport:{width:1600,height:1000}}),page=await slow.newPage(),cdp=await slow.newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8,connectionType:'cellular4g'});
    const started=Date.now();await page.goto(base+'/mecoffe3d',{waitUntil:'domcontentloaded'});await page.locator('.map-canvas canvas').waitFor({timeout:180000});await page.locator('.map-loading').waitFor({state:'hidden',timeout:180000});await page.getByRole('button',{name:'播放回放',exact:true}).waitFor();assert(await page.getByRole('button',{name:'播放回放',exact:true}).isEnabled());const interactiveMs=Date.now()-started;await page.getByRole('button',{name:'播放回放',exact:true}).click();await page.getByRole('button',{name:'暂停回放',exact:true}).waitFor({timeout:3000});
    report.slowNetwork={downloadMbps:1.6,uploadMbps:.75,latencyMs:150,coldCache:true,interactiveMs,definition:'map canvas + 100-person data/KPIs + enabled playback + verified click response; large avatars continue loading'};await page.screenshot({path:path.join(output,'slow-network-interactive.png')});console.log('SLOW',report.slowNetwork);await slow.close();
    // Keep the existing development server and all local-only assets intact.
    const local=await context.newPage();await local.goto('http://127.0.0.1:5180/mecoffe3d/assets?source=rocketbox');await local.getByTestId('asset-count').filter({hasText:'115 / 349'}).waitFor();assert.equal(await local.locator('option[value="rocketbox"]').count(),1);report.localRocketboxIntact=true;await local.close();
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);assert.deepEqual(report.rootRequests,[]);report.passed=true;save();
  }catch(error){report.failure=String(error.stack||error);save();throw error}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
