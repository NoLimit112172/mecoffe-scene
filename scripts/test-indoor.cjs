// Browser plugin not available; user-requested Chrome headless visual/interaction QA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'logs/milestone9'),pages=process.argv.includes('--pages');fs.mkdirSync(out,{recursive:true});
function probe(){
  const s=window.__indoorPerf={samples:[],recording:false,calls:0,last:0},known=new WeakSet(),original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){const gl=original.apply(this,args);if(!gl||!String(args[0]).startsWith('webgl')||known.has(gl))return gl;known.add(gl);for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const draw=gl[name];if(draw)gl[name]=function(...a){s.calls++;return draw.apply(this,a)}}return gl};
  function frame(now){if(s.recording&&s.last)s.samples.push({ms:now-s.last,calls:s.calls});s.calls=0;s.last=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);
}
async function ready(page,gis){await page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000});await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});await page.locator('[data-inside]').waitFor();assert.equal(await page.locator('[role=alert]').count(),0);assert.equal(await page.locator('vite-error-overlay').count(),0);await page.waitForTimeout(300)}
async function seek(page,gis,position){await page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}))},position);await page.waitForTimeout(300)}
async function performanceSample(page,gis){
  if(!gis){await page.getByLabel('光照预览',{exact:true}).selectOption('auto');await page.getByRole('button',{name:'高画质',exact:true}).click();await page.locator('.playback-controls select').selectOption('4')}
  await seek(page,gis,1.4);await page.locator(gis?'.gis-play':'.play-button').click();await page.waitForTimeout(4000);
  await page.evaluate(()=>{window.__indoorPerf.samples=[];window.__indoorPerf.recording=true});await page.waitForTimeout(12000);
  const cdp=await page.context().newCDPSession(page),heap=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
  const sample=await page.evaluate(()=>{const s=window.__indoorPerf;s.recording=false;const duration=s.samples.reduce((n,f)=>n+f.ms,0);return {browserRafFps:s.samples.length*1000/duration,renderedFps:s.samples.filter(f=>f.calls>0).length*1000/duration,worstFrameMs:Math.max(...s.samples.map(f=>f.ms)),drawCallsPerRenderedFrame:s.samples.reduce((n,f)=>n+f.calls,0)/s.samples.filter(f=>f.calls>0).length}});
  for(const k of Object.keys(sample))sample[k]=Number(sample[k].toFixed(2));sample.jsHeapMiB=Number((heap.usedSize/1048576).toFixed(2));sample.speed=gis?1:4;sample.windowSeconds=12;sample.note='Same rAF + actual GL draw-call probe as milestone6; heap excludes workers/GPU/RSS';if(gis)sample.mapRenderFps=Number(await page.locator('.gis-page').getAttribute('data-average-fps'));
  await page.locator(gis?'.gis-play':'.play-button').click();return sample;
}
(async()=>{
  const folder=path.join(root,'frontend/public/mecoffe/scenarios/ustc-history'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'scenario.json'))),scenario={manifest,files:Object.fromEntries(Object.keys(manifest.files).map(name=>[name,JSON.parse(fs.readFileSync(path.join(folder,name)))]))};
  const {GisReplay}=await import(pathToFileURL(path.join(root,'frontend/src/mecoffe/gis/replay.js'))),replay=new GisReplay(scenario),first=scenario.files['trajectory.json'].events.find(e=>e.type==='purchase');let enterPosition;
  for(let pos=replay.previewPosition();pos<replay.previewPosition()+4;pos+=.001){replay.motion.sync(pos);const p=replay.people.get(first.actor);if(p.walker?.phase==='enter-shop'&&p.transitionScale>.4&&p.transitionScale<.7){enterPosition=pos;break}}assert(enterPosition);
  const origin=pages?'http://127.0.0.1:5187':'http://127.0.0.1:5180',base=origin+(pages?'/mecoffe-scene':''),report={viewport:'1600x1000',mode:pages?'pages':'local',errors:[],badResponses:[],performance:{},enterPosition};let server;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info']});
  try{
    if(pages)server=await servePages({port:5187});const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(probe);
    await context.route('**/*',route=>{const url=route.request().url();return /^https?:/.test(url)&&!url.startsWith(origin+'/')?route.abort():route.continue()});
    const open=async route=>{const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});p.on('response',r=>{if(r.status()>=400)report.badResponses.push({url:r.url(),status:r.status()})});await p.goto(base+route);await ready(p,route.includes('gis'));return p};
    const gis=await open('/mecoffe-gis?scenario=ustc-history');assert.equal(await gis.locator('[data-inside]').getAttribute('data-inside'),'100');assert(await gis.locator('[data-indoor-building]').count()>0);
    await gis.getByLabel('搜索楼栋或地点',{exact:true}).fill('6号楼');await gis.locator('.search-results button').first().click();assert.match(await gis.getByTestId('gis-query-card').innerText(),/楼内.*人/);assert.match(await gis.getByTestId('gis-query-card').innerText(),/推断入口/);await gis.screenshot({path:path.join(out,'building-residents.png')});
    await gis.locator('.indoor-residents button').first().click();assert.match(await gis.getByTestId('gis-query-card').innerText(),/在.*6号楼.*内（示意）/);
    await seek(gis,true,2.5);await gis.getByRole('button',{name:'全景',exact:true}).click();await gis.waitForTimeout(700);const same=JSON.parse(await gis.locator('[data-indoor-occupancy]').getAttribute('data-indoor-occupancy'));await gis.screenshot({path:path.join(out,'gis-overview.png')});
    await seek(gis,true,enterPosition);await gis.locator(`.gis-roster [data-person-id="${first.actor}"]`).click();await gis.waitForFunction(()=>Number(document.querySelector('.gis-page').dataset.readyModels)>0,null,{timeout:120000});await gis.waitForTimeout(500);assert.match(await gis.getByTestId('gis-query-card').innerText(),/正在进入/);await gis.screenshot({path:path.join(out,'entering-building.png')});
    await gis.getByRole('button',{name:'全景',exact:true}).click();await gis.waitForTimeout(700);report.performance.gis=await performanceSample(gis,true);await gis.close();
    const sandbox=await open('/mecoffe3d?scenario=ustc-history');assert.equal(await sandbox.locator('[data-inside]').getAttribute('data-inside'),'100');await seek(sandbox,false,2.5);assert.deepEqual(JSON.parse(await sandbox.locator('[data-indoor-occupancy]').getAttribute('data-indoor-occupancy')),same);report.sharedOccupancyAtPosition2_5='passed';await sandbox.getByLabel('光照预览',{exact:true}).selectOption('12');await sandbox.waitForTimeout(500);await sandbox.screenshot({path:path.join(out,'sandbox-same-position.png')});report.performance.sandbox=await performanceSample(sandbox,false);await sandbox.close();
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);report.passed=true;fs.writeFileSync(path.join(out,(pages?'pages':'local')+'-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(e){report.failure=String(e.stack||e);fs.writeFileSync(path.join(out,(pages?'pages':'local')+'-qa.json'),JSON.stringify(report,null,2));throw e}
  finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
