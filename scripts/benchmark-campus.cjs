// Reproducible before/after probe; no application code is changed by this tool.
const fs=require('node:fs'),path=require('node:path');
fs.mkdirSync(path.join(__dirname,'../logs/milestone6'),{recursive:true});
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const label=process.argv[2]||'before',duration=Number(process.env.SAMPLE_MS||12000),base='http://127.0.0.1:5180';
function probe(){
 const state={contexts:[],samples:[],recording:false,current:{calls:0,triangles:0},last:0};window.__perfProbe=state;
 const known=new WeakSet(),get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(...args){const gl=get.apply(this,args);if(!gl||!String(args[0]).startsWith('webgl')||known.has(gl))return gl;known.add(gl);
  const record={textures:new Set(),geometries:new Set(),renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)};state.contexts.push(record);
  for(const [create,remove,collection]of [['createTexture','deleteTexture','textures'],['createBuffer','deleteBuffer','geometries']]){const a=gl[create],b=gl[remove];gl[create]=function(...x){const value=a.apply(this,x);if(value)record[collection].add(value);return value};gl[remove]=function(value){record[collection].delete(value);return b.call(this,value)}}
  for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const original=gl[name];if(!original)continue;gl[name]=function(...a){state.current.calls++;const count=name.includes('Elements')?a[1]:a[2],instances=name==='drawElementsInstanced'?a[4]:name==='drawArraysInstanced'?a[3]:1;state.current.triangles+=(a[0]===gl.TRIANGLES?count/3:[gl.TRIANGLE_STRIP,gl.TRIANGLE_FAN].includes(a[0])?Math.max(0,count-2):0)*instances;return original.apply(this,a)}}
  return gl;
 };
 function frame(now){if(state.recording&&state.last)state.samples.push({ms:now-state.last,...state.current});state.current={calls:0,triangles:0};state.last=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);
}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-precise-memory-info']});try{
 const results=[];
 for(const name of ['procedural','yulan','assets']){
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(probe);
  await page.goto(base+(name==='assets'?'/mecoffe3d/assets':'/mecoffe3d'),{waitUntil:'networkidle'});
  if(name==='assets'){
   if(await page.getByRole('combobox',{name:'素材范围',exact:true}).count())await page.getByRole('combobox',{name:'素材范围',exact:true}).selectOption('');
   await page.locator('.preview-status').first().filter({hasText:'校内实际'}).waitFor({timeout:90000});
  }else{
   await page.waitForFunction(()=>window.__mecoffe3d?.view?.realCharacterBatch?.initialized,null,{timeout:90000});await page.locator('.map-loading').waitFor({state:'hidden'});
   await page.getByRole('button',{name:'历史回放',exact:true}).click();await page.waitForFunction(()=>window.__mecoffe3d?.view?.realCharacterBatch?.initialized,null,{timeout:90000});await page.locator('.map-loading').waitFor({state:'hidden'});
   await page.evaluate(async style=>{const v=window.__mecoffe3d.view;await v.setBuildingStyle(style);v.performancePolicy?.chooseManually();v.setQuality('high');v.invalidate();await v.realCharacterBatch.whenIdle()},name);
   await page.locator('.playback-controls select').selectOption('4');await page.getByRole('button',{name:'播放回放',exact:true}).click();
  }
  await page.waitForTimeout(4000);
  await page.evaluate(()=>{window.__perfProbe.samples=[];window.__perfProbe.recording=true});await page.waitForTimeout(duration);
  const cdp=await page.context().newCDPSession(page),heap=await cdp.send('Runtime.getHeapUsage');
  const result=await page.evaluate(()=>{const s=window.__perfProbe;s.recording=false;const frames=s.samples,active=frames.filter(f=>f.calls>0),sum=key=>frames.reduce((n,f)=>n+f[key],0),ms=frames.map(f=>f.ms).sort((a,b)=>a-b);const v=window.__mecoffe3d?.view;return {frames:frames.length,activeFrames:active.length,fps:1000*frames.length/sum('ms'),worstFrameMs:ms.at(-1),p95FrameMs:ms[Math.floor(ms.length*.95)],drawCalls:sum('calls')/frames.length,triangles:sum('triangles')/frames.length,liveTextures:s.contexts.reduce((n,c)=>n+c.textures.size,0),liveBuffers:s.contexts.reduce((n,c)=>n+c.geometries.size,0),threeTextures:v?.renderer?.info.memory.textures,geometryCount:v?.renderer?.info.memory.geometries,gpu:s.contexts[0]?.renderer,day:document.querySelector('[data-testid=current-day]')?.textContent,quality:v?.quality}});
  Object.assign(result,{name,heapMB:heap.usedSize/1048576,errors});results.push(result);console.log(label,JSON.stringify(result));await page.close();
 }
 fs.writeFileSync(path.join(__dirname,'../logs/milestone6',`perf-${label}.json`),JSON.stringify({label,viewport:'1600x1000',deviceScaleFactor:1,durationMs:duration,Browser:'Browser plugin not available; existing Playwright / Chrome headless',measure:'rAF frame gaps; actual GL draw calls/triangles including passes/shadows; live WebGL textures; CDP heap',results},null,2));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
