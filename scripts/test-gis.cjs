// Browser plugin not available; user-requested headless Chrome validation.
// --pages: strict static subpath. --osm: ONE opt-in raster viewport, no pans.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const pages=process.argv.includes('--pages'),osm=process.argv.includes('--osm'),out=path.join(__dirname,'../logs/milestone8');fs.mkdirSync(out,{recursive:true});
async function ready(page){
  await page.locator('.gis-page h1').waitFor({timeout:90000});await page.locator('.gis-loading').waitFor({state:'hidden',timeout:90000});await page.locator('.maplibregl-canvas').waitFor();
  assert.equal(await page.locator('[role=alert]').count(),0);assert.equal(await page.locator('vite-error-overlay').count(),0);
  await page.waitForTimeout(600);
}
async function benchmark(page,seconds=10){
  const button=page.locator('.gis-play');if((await button.textContent()).includes('暂停'))await button.click();await button.click();await page.waitForTimeout(300);
  const cdp=await page.context().newCDPSession(page);const before=await cdp.send('Runtime.getHeapUsage');
  const frames=await page.evaluate(milliseconds=>new Promise(resolve=>{
    const intervals=[];let start,last;
    function frame(now){
      if(start===undefined)start=now;
      if(last!==undefined)intervals.push(now-last);
      last=now;
      if(now-start>=milliseconds)resolve({averageFps:intervals.length*1000/(now-start),worstFrameMs:Math.max(...intervals)});
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }),seconds*1000);
  const sample=await page.locator('.gis-page').evaluate(el=>({...el.dataset}));const memory=await cdp.send('Runtime.getHeapUsage');
  await button.click();await cdp.detach();
  return {windowSeconds:seconds,averageFps:Number(Number(sample.averageFps).toFixed(2)),worstFrameMs:Number(Number(sample.worstFrame).toFixed(2)),
    browserRafHz:Number(frames.averageFps.toFixed(2)),worstRafIntervalMs:Number(frames.worstFrameMs.toFixed(2)),
    jsHeapMiB:Number((memory.usedSize/1024/1024).toFixed(2)),heapChangeMiB:Number(((memory.usedSize-before.usedSize)/1024/1024).toFixed(2)),
    modelDrawCalls:Number(sample.modelDrawCalls),readyNearModels:Number(sample.readyModels),activeWalkers:Number(sample.activeWalkers),
    note:'FPS and worst frame use MapLibre render-event intervals during playback; browser RAF cadence is recorded separately and is not the map FPS; main-thread JS heap excludes workers/GPU/process RSS'};
}
(async()=>{
  let server;const browser=await chromium.launch({channel:'chrome',headless:true});
  const origin=pages?'http://127.0.0.1:5187':'http://127.0.0.1:5180',base=origin+(pages?'/mecoffe-scene':''),tag=pages?'pages':'local';
  const report={mode:tag,viewport:'1600x1000',engine:'MapLibre GL JS 6.16.0 + Three.js',browser:'Chrome headless',routes:[],performance:{},errors:[],badResponses:[],externalRequests:[],rootRequests:[]};
  const save=()=>fs.writeFileSync(path.join(out,tag+'-qa.json'),JSON.stringify(report,null,2));
  try{
    if(pages)server=await servePages({port:5187});
    const context=await browser.newContext({viewport:{width:1600,height:1000}});
    await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith(origin+'/')){report.externalRequests.push(url);return route.abort()}return route.continue()});
    for(const id of ['ustc-history','nus-hourly']){
      const page=await context.newPage(),modelRequests=[];
      page.on('pageerror',e=>report.errors.push({id,message:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({id,message:m.text()})});
      page.on('response',r=>{if(r.status()>=400)report.badResponses.push({id,url:r.url(),status:r.status()})});
      page.on('request',r=>{if(/\.fbx(?:\?|$)/.test(r.url()))modelRequests.push(r.url());if(pages&&r.url().startsWith(origin+'/')&&!r.url().startsWith(base+'/'))report.rootRequests.push(r.url())});
      const response=await page.goto(base+'/mecoffe-gis?scenario='+id,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);await ready(page);await page.reload({waitUntil:'domcontentloaded'});await ready(page);
      assert.match(await page.title(),/GIS 模式/);assert.match(await page.getByRole('note').textContent(),/OASIS 没有位置数据/);assert.equal(modelRequests.length,0,'overview must not fetch avatars');
      if(id==='ustc-history'){
        await page.screenshot({path:path.join(out,tag+'-ustc-overview.png')});
        await page.getByRole('button',{name:'看人物行走',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.gis-page').dataset.activeWalkers)>0);
        report.performance.ustc=await benchmark(page);assert(report.performance.ustc.activeWalkers>0);
        await page.getByLabel('建筑图层',{exact:true}).uncheck();await page.getByLabel('建筑图层',{exact:true}).check();
        await page.getByLabel('人物图层',{exact:true}).uncheck();await page.getByLabel('人物图层',{exact:true}).check();
        await page.getByLabel('搜索楼栋或地点',{exact:true}).fill('图书教育中心A区');await page.locator('.search-results button').first().click();await page.waitForTimeout(700);
        const box=await page.locator('.gis-map').boundingBox();await page.locator('.maplibregl-popup-close-button').click();
        // A tilted extrusion's roof is above its ground anchor. Exercise a real
        // canvas click, inspecting the result before trying the next height.
        for(const dy of [-20,-60,-100,20]){await page.mouse.click(box.x+box.width/2,box.y+box.height/2+dy);await page.waitForTimeout(100);if(await page.locator('.maplibregl-popup').count())break}
        await page.locator('.maplibregl-popup').waitFor();assert.match(await page.getByTestId('gis-query-card').textContent(),/高度来源.*素材原型.*OASIS 地点/s);
        await page.screenshot({path:path.join(out,tag+'-query-popup.png')});
        await page.getByRole('button',{name:'看人物行走',exact:true}).click();await page.waitForTimeout(700);await page.locator('.gis-play').click();
        await page.getByRole('button',{name:'人物特写',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.gis-page').dataset.readyModels)>0,null,{timeout:120000});
        await page.waitForTimeout(600);await page.screenshot({path:path.join(out,tag+'-character-closeup.png')});
        report.performance.ustcNear=await benchmark(page,6);assert(modelRequests.length>0,'near view should fetch existing FBX models');
        await page.getByLabel('人物图层',{exact:true}).uncheck();await page.waitForFunction(()=>Number(document.querySelector('.gis-page').dataset.readyModels)===0);await page.getByLabel('人物图层',{exact:true}).check();
      }else{
        assert.match(await page.getByTestId('gis-data-notice').textContent(),/尚无模拟数据/);assert.equal(await page.locator('.gis-page').getAttribute('data-ready-models'),'0');
        report.performance.nus=await benchmark(page);
        await page.getByLabel('GIS 模拟时间进度',{exact:true}).evaluate(el=>{el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}))});
        assert.match(await page.getByTestId('gis-time').textContent(),/12:00/);assert.equal(modelRequests.length,0);assert.equal(await page.locator('.gis-page').getAttribute('data-active-walkers'),'0');
        await page.screenshot({path:path.join(out,tag+'-nus-overview.png')});
      }
      assert.equal(await page.locator('[role=alert]').count(),0);
      report.routes.push({scenario:id,directAndRefresh:'passed',url:page.url(),modelFetches:modelRequests.length});save();await page.close();console.log('PASS',tag,id);
    }
    assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);assert.deepEqual(report.rootRequests,[]);
    const switching=await context.newPage();switching.on('pageerror',e=>report.errors.push({id:'fast-switch',message:e.message}));await switching.goto(base+'/mecoffe-gis?scenario=ustc-history');await ready(switching);
    await switching.getByLabel('GIS 场景',{exact:true}).selectOption('nus-hourly');await switching.waitForTimeout(30);await switching.getByLabel('GIS 场景',{exact:true}).selectOption('ustc-history');await ready(switching);
    assert.equal(await switching.locator('.maplibregl-canvas').count(),1);assert.match(await switching.title(),/历史回放/);report.fastScenarioSwitch='passed';await switching.close();
    const mobile=await context.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>report.errors.push({id:'mobile',message:e.message}));await mobile.goto(base+'/mecoffe-gis?scenario=nus-hourly');await ready(mobile);
    assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.screenshot({path:path.join(out,tag+'-mobile.png'),fullPage:true});await mobile.close();
    if(osm){
      // Separate context keeps normal browser HTTP caching and Referer intact.
      // No automated panning/zooming after selecting the online basemap.
      const online=await browser.newContext({viewport:{width:1600,height:1000}}),page=await online.newPage();const tileResponses=[];
      page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))tileResponses.push({status:r.status(),url:r.url()})});
      await page.goto(base+'/mecoffe-gis?scenario=ustc-history');await ready(page);await page.getByLabel('底图',{exact:true}).selectOption('osm');await page.waitForTimeout(5000);
      assert.equal(await page.getByLabel('底图',{exact:true}).inputValue(),'osm','online source must not silently fail');assert(tileResponses.some(r=>r.status===200));assert(tileResponses.length<70,'single viewport only');
      assert.match(await page.locator('.maplibregl-ctrl-attrib').textContent(),/OpenStreetMap contributors/);
      await page.screenshot({path:path.join(out,'osm-basemap.png')});report.osm={singleViewport:true,tiles:tileResponses.length,status:'passed'};await online.close();
    }
    assert.deepEqual(report.errors,[]);report.passed=true;save();console.log(JSON.stringify(report.performance,null,2));
  }catch(error){report.failure=String(error.stack||error);save();throw error}
  finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
