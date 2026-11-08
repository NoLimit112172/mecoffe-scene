// 非 localhost 的真实 HTTP 安全上下文；所有业务接口均为合成 mock。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'logs/milestone13');fs.mkdirSync(out,{recursive:true});
const host='mecoffe-http.test',origin=`http://${host}:5191`,base=origin+'/scene';
const publicOrigin=`http://${host}:5192`,report={source:'synthetic APIs; real non-secure HTTP browser context',viewport:'1600x1000',checks:[],security:[],screenshots:[],errors:[],badResources:[],externalRequests:[]};
const fixture=(folder,name)=>JSON.parse(fs.readFileSync(path.join(root,'frontend/tests/fixtures',folder,name+'.json'),'utf8'));
let server,publicServer,browser;
async function evidence(page,name,description){
  // 图层数据在 load 后交给 MapLibre Worker，截图等其首轮绘制收敛。
  if(await page.locator('.maplibregl-canvas').count()){
    await page.waitForFunction(()=>Number(document.querySelector('.gis-page')?.dataset.renderFrames)>1,null,{timeout:30000});
    await page.waitForTimeout(750);
  }
  const security=await page.evaluate(()=>({origin:location.origin,isSecureContext:window.isSecureContext,subtle:typeof globalThis.crypto?.subtle}));
  assert.equal(security.isSecureContext,false);assert.equal(security.subtle,'undefined');report.security.push({case:name,...security});
  await page.evaluate(({security,description})=>{
    document.querySelector('[data-m13-evidence]')?.remove();
    const banner=document.createElement('div');banner.dataset.m13Evidence='true';
    banner.style.cssText='position:fixed;z-index:2147483647;top:0;left:50%;transform:translateX(-50%);padding:7px 14px;background:#102e3f;color:white;border-radius:0 0 8px 8px;font:12px/1.5 monospace;white-space:pre;text-align:center;pointer-events:none';
    banner.textContent=`本地合成接口 HTTP 验收 | ${security.origin}\nisSecureContext=${security.isSecureContext} | crypto.subtle=${security.subtle} | ${description}`;
    document.body.append(banner);
  },{security,description});
  const file=name+'.png';await page.screenshot({path:path.join(out,file),fullPage:true});report.screenshots.push('logs/milestone13/'+file);
}
async function mockCase(kind,mode){
  const preview=kind==='preview',folder=preview?'config-preview':'generic-replay';
  const snapshot=fixture(folder,'snapshot'),preparation=preview?fixture(folder,'preparation'):null;
  const configPlan=preview?null:fixture(folder,'plan'),trajectory=preview?null:fixture(folder,'trajectory');
  const revision=['frozen-v2','legacy-mismatch'].includes(mode)?2:1;
  const frozenPlan=configPlan?structuredClone(configPlan):null;
  if(frozenPlan){frozenPlan.plan_revision=revision;trajectory.metadata.plan_revision=revision;trajectory.run_id=`engine_synthetic_v${revision}`;}
  const session='synthetic-session',config=preview?'synthetic-config-preview':'frozen-synthetic-config',run=`synthetic-run-v${revision}`;
  const stages=`/api/sessions/${session}/configs/${config}/stages/`,prefix=`/api/sessions/${session}/runs/${run}`;
  const roles=preparation||{population_request:Object.fromEntries([...new Set(snapshot.nodes.map(p=>p.role))].map(role=>[role,{
    description:{visitor:'合成访客',operator:'合成经营者',research:'合成科研人员'}[role],count:snapshot.nodes.filter(p=>p.role===role).length,generate:{},
  }]))};
  const calls=[],context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(/^https?:$/.test(url.protocol)&&url.origin!==origin){report.externalRequests.push(request.url());return route.abort();}
    if(mode==='tampered-map'&&url.pathname==='/scene/mecoffe/config-map/landcover.json'){
      const raw=fs.readFileSync(path.join(root,'frontend/dist-embed/mecoffe/config-map/landcover.json'));
      return route.fulfill({contentType:'application/json',body:Buffer.concat([raw,Buffer.from(' ')])});
    }
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(request.method(),'GET');assert.equal(request.headers().authorization,undefined);calls.push(url.pathname);
    if(url.pathname===stages+'network')return route.fulfill({json:{name:'network',status:'completed',config_id:config,payload:{snapshot}}});
    if(url.pathname===stages+'roles')return route.fulfill({json:{name:'roles',status:'completed',config_id:config,payload:roles}});
    if(url.pathname===prefix)return route.fulfill({json:{id:run,config_id:config,status:'completed',engine_run_id:trajectory.run_id}});
    if(url.pathname===prefix+'/artifacts/trajectory')return route.fulfill({json:trajectory});
    if(url.pathname===prefix+'/artifacts/population-snapshot')return route.fulfill({json:snapshot});
    if(url.pathname===prefix+'/artifacts/plan'){
      if(mode.startsWith('legacy'))return route.fulfill({status:404,json:{detail:'合成旧后端无冻结计划接口'}});
      if(mode==='plan-401'||mode==='plan-409')return route.fulfill({status:mode==='plan-401'?401:409,json:{detail:'合成接口错误'}});
      return route.fulfill({json:frozenPlan});
    }
    if(url.pathname===stages+'plan')return route.fulfill({json:{name:'plan',status:'completed',config_id:config,payload:configPlan}});
    report.errors.push('Unexpected API route: '+url.pathname);return route.fulfill({status:404,json:{detail:'unexpected synthetic route'}});
  });
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!new URL(response.url()).pathname.startsWith('/api/'))report.badResources.push({url:response.url(),status:response.status()});});
  return {context,page,calls,snapshot,config,session,run,stages,prefix};
}
async function ready(page,gis,count,orders){
  await Promise.race([
    page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000}),
    page.getByTestId('config-preview-error').waitFor({timeout:120000}).then(async()=>{throw Error(await page.getByTestId('config-preview-error').innerText());}),
  ]);
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  const header=page.getByTestId('config-preview');assert.equal(await header.getAttribute('data-people'),String(count));assert.equal(await header.getAttribute('data-orders'),String(orders));
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,count);assert.equal(accounting.visible+accounting.inside,count);assert.equal(accounting.valid,true);
  assert.match(await page.getByRole('note').innerText(),/OASIS 没有位置数据/);
}
(async()=>{
  server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5191});
  publicServer=await servePages({root:path.join(root,'frontend/dist'),prefix:'/mecoffe-scene/',port:5192});
  browser=await chromium.launch({channel:'chrome',headless:true,args:[`--host-resolver-rules=MAP ${host} 127.0.0.1`,'--no-proxy-server']});
  for(const [kind,mode]of [['preview','normal'],['replay','frozen-v1'],['replay','frozen-v2'],['replay','legacy-match'],['replay','legacy-mismatch'],['preview','tampered-map'],['replay','plan-401'],['replay','plan-409']]){
    const input=await mockCase(kind,mode),{context,page,calls,session,config,run,stages}=input;
    for(const gis of [false,true]){
      const query=kind==='preview'?`session=${session}&config=${config}`:`session=${session}&run=${run}`;
      assert.equal((await page.goto(`${base}/${gis?'mecoffe-gis':'mecoffe3d'}/?${query}`,{waitUntil:'domcontentloaded'})).status(),200);
      const error=mode==='legacy-mismatch'?/团队后端需要提供该次运行冻结的计划接口/:mode==='tampered-map'?/地图版本不一致/:mode==='plan-401'?/登录已失效/:mode==='plan-409'?/尚未准备完成/:null;
      if(error){
        await page.getByTestId('config-preview-error').waitFor();assert.match(await page.getByTestId('config-preview-error').innerText(),error);
        assert.equal(await page.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);
        await evidence(page,`${gis?'gis':'3d'}-${mode}`,mode==='legacy-mismatch'?'测试输入：配置计划 v1 / 轨迹 v2，正确拒绝错误版本':mode);
      }else{
        await ready(page,gis,input.snapshot.nodes.length,kind==='preview'?0:2);
        if(kind==='replay'){
          await page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
          if(gis)assert.match(await page.locator('.gis-metrics > div').filter({hasText:'回放订单'}).innerText(),/2\s*单/);
          else await page.waitForFunction(()=>document.querySelector('[data-testid="order-count"]')?.textContent.trim().startsWith('2'));
          assert.match(await page.locator(gis?'.gis-role-key':'.role-key').innerText(),/合成访客/);
        }
        await evidence(page,`${gis?'gis':'3d'}-${kind}-${mode}`,mode==='frozen-v2'?'测试输入：配置计划 v1 / 冻结计划与轨迹 v2，回放成功':`${kind} / ${mode}`);
      }
    }
    if(mode.startsWith('frozen-')||mode==='plan-401'||mode==='plan-409')assert(!calls.includes(stages+'plan'));
    if(mode.startsWith('legacy'))assert(calls.includes(stages+'plan'));
    report.checks.push({kind,mode,views:['3d','GIS'],apiRequests:calls});await context.close();
  }
  // 公开场景使用另一个加载器 scenario.js，也必须在无 subtle 时完整验证。
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)report.badResources.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==publicOrigin){report.externalRequests.push(url.href);return route.abort();}return route.continue();});
  await page.goto(publicOrigin+'/mecoffe-scene/mecoffe-gis?scenario=nus-hourly',{waitUntil:'domcontentloaded'});
  await page.locator('.maplibregl-canvas').waitFor({timeout:120000});await page.locator('.gis-loading').waitFor({state:'hidden',timeout:120000});
  await evidence(page,'public-scenario-http','NUS 公开 GIS：无模拟人物，scenario.js 哈希校验通过');
  report.checks.push({kind:'public-scenario',mode:'HTTP fallback',scenario:'nus-hourly'});await page.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResources,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
})().catch(async error=>{
  report.ok=false;report.failure=error.stack;process.exitCode=1;
  const page=browser?.contexts().flatMap(context=>context.pages()).at(-1);if(page)try{await evidence(page,'failure','本地合成验收失败');report.failureText=await page.locator('body').innerText();}catch{}
}).finally(async()=>{
  await browser?.close();for(const owned of [server,publicServer])if(owned)await new Promise(resolve=>owned.close(resolve));
  fs.writeFileSync(path.join(out,'http-browser-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
