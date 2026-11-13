// Synthetic same-origin API acceptance only. No real server, login or team data.
// --embed serves dist-embed at /scene/ using strict static directory indexes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {legacySession}=require('./lib/legacy-session-fixture.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),embed=process.argv.includes('--embed'),tag=embed?'embed':'local';
const origin=embed?'http://127.0.0.1:5189':'http://127.0.0.1:5180',base=origin+(embed?'/scene':'');
const output=path.join(root,'logs/milestone11'),fixture=path.join(root,'frontend/tests/fixtures/generic-replay');
fs.mkdirSync(output,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(fixture,name+'.json'),'utf8'));
const sample=()=>({trajectory:read('trajectory'),snapshot:read('snapshot'),plan:read('plan')});
const session='synthetic-session',run='synthetic-run',config='synthetic-config';
const api=`/api/sessions/${session}/runs/${run}`;
const sessionApi=`/api/sessions/${session}`;
const artifacts=['trajectory','population-snapshot','plan'].map(name=>api+'/artifacts/'+name);
const stagePlan=`/api/sessions/${session}/configs/${config}/stages/plan`,stageRoles=`/api/sessions/${session}/configs/${config}/stages/roles`;
// M14 first polls run detail, then loadRunReplay independently verifies it again.
const expectedCounts=Object.fromEntries([[api,2],[sessionApi,1],...artifacts.map(url=>[url,1]),[stagePlan,1],[stageRoles,1]].sort(([a],[b])=>a.localeCompare(b)));
const report={mode:tag,source:'synthetic-only',viewport:'1600x1000',expected:{people:7,relationships:4,brands:3,orders:2,declined:1,unknown:1,failed:1},checks:[],requestChecks:[],apiRequests:[],apiResponses:[],errors:[],badResponses:[],externalRequests:[]};
let server,browser;
const entry=(view='mecoffe3d')=>`${base}/${view}/?session=${session}&run=${run}`;
async function shot(page,name){await page.screenshot({path:path.join(output,`remote-${tag}-${name}.png`)});}
async function mock(context,mode='completed'){
  const input=sample(),detail={id:run,config_id:config,status:'completed',engine_run_id:input.trajectory.run_id};
  if(mode==='failed-partial'){detail.status='failed';input.trajectory.status='failed';input.trajectory.partial=true;input.trajectory.metadata.completed_steps=1;}
  if(mode==='mismatch')input.snapshot.snapshot_revision++;
  if(mode==='engine-mismatch')detail.engine_run_id='synthetic-other-engine';
  if(mode==='pending')detail.status='running';
  const allowedPaths=mode===401||mode===404?[api]:mode==='pending'?[api,api+'/scene/bootstrap',sessionApi]:[api,sessionApi,...artifacts,stagePlan,stageRoles];
  const capture={calls:[],trace:[]};
  context.on('response',response=>{
    const url=new URL(response.url());if(url.origin!==origin||!url.pathname.startsWith('/api/'))return;
    const item={mode,path:url.pathname,status:response.status()};capture.trace.push({kind:'response',...item});report.apiResponses.push(item);
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(/^https?:/.test(url.protocol)&&url.origin!==origin){report.externalRequests.push(request.url());return route.abort();}
    if(url.pathname.startsWith('/api/')){
      const requestInfo={mode,path:url.pathname,method:request.method(),at:performance.now()};capture.calls.push(requestInfo);capture.trace.push({kind:'request',...requestInfo});report.apiRequests.push(requestInfo);
      assert.equal(request.method(),'GET');assert.equal(request.headers().authorization,undefined);
      assert(allowedPaths.includes(url.pathname),'unexpected API path for '+mode+': '+url.pathname);
      if(mode===401||mode===404)return route.fulfill({status:mode,json:{detail:'合成错误响应'}});
      if(url.pathname===sessionApi)return route.fulfill({json:legacySession({session,config,run,status:detail.status})});
      if(url.pathname===api)return route.fulfill({json:detail});
      if(mode==='pending'&&url.pathname===api+'/scene/bootstrap')return route.fulfill({status:404,json:{detail:'合成旧后端尚无实时接口'}});
      if(url.pathname===api+'/artifacts/trajectory')return route.fulfill({json:input.trajectory});
      if(url.pathname===api+'/artifacts/population-snapshot')return route.fulfill({json:input.snapshot});
      if(url.pathname===api+'/artifacts/plan')return route.fulfill({status:404,json:{detail:'合成旧后端，尚无冻结计划接口'}});
      if(url.pathname===`/api/sessions/${session}/configs/${config}/stages/plan`)return route.fulfill({json:{name:'plan',status:'completed',payload:input.plan}});
      if(url.pathname===`/api/sessions/${session}/configs/${config}/stages/roles`)return route.fulfill({status:404,json:{detail:'合成运行未附角色阶段'}});
      throw Error('Unexpected synthetic API route: '+url.pathname);
    }
    return route.continue();
  });
  return capture;
}
const checkpoint=capture=>({calls:capture.calls.length,trace:capture.trace.length});
function assertTerminalRequests(capture,from,label,fresh=true){
  // Compare every call in this phase; never truncate or merely check inclusion.
  const calls=capture.calls.slice(from.calls),trace=capture.trace.slice(from.trace),counts={};
  for(const call of calls){assert.equal(call.method,'GET');counts[call.path]=(counts[call.path]||0)+1;}
  const sorted=Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)));
  // View entry remounts re-check the exact configuration's raw requirement;
  // the M14 terminal bundle itself remains retained, so ONLY Session is read.
  assert.deepEqual(sorted,fresh?expectedCounts:{[sessionApi]:1},label);
  assert.equal(counts[api+'/scene/bootstrap']||0,0);assert.equal(counts[api+'/scene/events']||0,0);
  if(fresh){
    assert.equal(calls[0].path,api,'first call must read run detail');
    const request=path=>trace.findIndex(item=>item.kind==='request'&&item.path===path),firstRun=request(api);
    assert(firstRun>=0);
    for(const path of artifacts)assert(request(path)>firstRun,'artifact request must follow run detail: '+path);
    const plan404=trace.findIndex(item=>item.kind==='response'&&item.path===api+'/artifacts/plan'&&item.status===404);
    assert(plan404>request(api+'/artifacts/plan')&&request(stagePlan)>plan404,'legacy plan fallback must follow the frozen plan 404 response');
  }
  report.requestChecks.push({phase:label,counts:sorted});
}
async function assertNoFabrication(page){
  assert.equal(await page.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);
  assert.equal(await page.locator('.config-import').count(),0);assert.equal(await page.getByLabel('配置文件',{exact:true}).count(),0);
  const wrapper=page.getByTestId('config-preview');
  assert.equal(await wrapper.getAttribute('data-people'),'0');assert.equal(await wrapper.getAttribute('data-orders'),'0');
}
async function pageFor(context){
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!new URL(response.url()).pathname.startsWith('/api/'))report.badResponses.push({url:response.url(),status:response.status()});});
  return page;
}
async function ready(page,gis=false){
  await page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000});
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  await page.getByTestId('person-accounting').waitFor();
  assert.equal(await page.locator('[role=alert],vite-error-overlay').count(),0);
  assert.equal(await page.getByLabel('配置文件',{exact:true}).count(),0);
  assert.equal(await page.locator('.config-import').count(),0);
  const wrapper=page.getByTestId('config-preview');
  assert.equal(await wrapper.getAttribute('data-people'),'7');assert.equal(await wrapper.getAttribute('data-edges'),'4');assert.equal(await wrapper.getAttribute('data-orders'),'2');
  assert.match(await page.getByTestId('replay-outcomes').innerText(),/被拒 1 条.*结果未知 1 条/);
  assert.match(await page.getByRole('note').innerText(),/OASIS 没有位置数据/);
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,7);assert.equal(accounting.visible+accounting.inside,7);assert.equal(accounting.valid,true);
}
async function endReplay(page,gis=false){
  await page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate(input=>{input.value=input.max;input.dispatchEvent(new Event('input',{bubbles:true}));});
  if(gis)assert.match(await page.locator('.gis-metrics > div').nth(3).innerText(),/回放订单\s*2\s*单/);
  else{await page.waitForFunction(()=>document.querySelector('[data-testid="order-count"]')?.textContent.trim().startsWith('2'));assert.match(await page.locator('.event-list').innerText(),/被拒绝/);assert.match(await page.locator('.event-list').innerText(),/结果未知/);}
}
(async()=>{
  if(embed)server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5189});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),capture=await mock(context);
  const page=await pageFor(context),response=await page.goto(entry(),{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  await ready(page);assertTerminalRequests(capture,{calls:0,trace:0},'initial terminal 3D');let from=checkpoint(capture);
  await shot(page,'3d-overview');await endReplay(page);await shot(page,'3d-outcomes');
  await page.getByText('被拒绝',{exact:true}).scrollIntoViewIfNeeded();await shot(page,'declined-action');
  report.checks.push('remote terminal run: frozen-plan 404 probe then version-matched legacy plan, optional roles fallback, 7 people / 4 edges / 2 orders / 1 declined / 1 unknown, no import UI');
  await page.locator('.preview-bar a').click();await ready(page,true);
  assertTerminalRequests(capture,from,'GIS switch reuses M14 retained terminal bundle',false);from=checkpoint(capture);
  let url=new URL(page.url());assert.equal(url.searchParams.get('session'),session);assert.equal(url.searchParams.get('run'),run);assert.equal(url.searchParams.get('config'),null);
  assert.equal(await page.locator('.gis-roster [data-person-id]').count(),7);
  await endReplay(page,true);await shot(page,'gis-replay');
  assert.equal((await page.reload({waitUntil:'domcontentloaded'})).status(),200);await ready(page,true);await endReplay(page,true);
  assertTerminalRequests(capture,from,'GIS refresh reloads and verifies terminal bundle');from=checkpoint(capture);
  await shot(page,'gis-refresh');
  await page.locator('.preview-bar a').click();await ready(page);url=new URL(page.url());assert.equal(url.searchParams.get('run'),run);
  assertTerminalRequests(capture,from,'3D switch reuses refreshed terminal bundle',false);
  report.checks.push('run parameters preserved by GIS switch, direct strict-static refresh and switch back; both views count two completed orders');
  await context.close();
  for(const [mode,expected]of [[401,/登录已失效/],[404,/不存在或当前账号无权访问/],['mismatch',/轨迹与冻结快照的编号或版本不一致/],['engine-mismatch',/轨迹不属于所选引擎运行/]]){
    const errorContext=await browser.newContext({viewport:{width:1600,height:1000}});await mock(errorContext,mode);const errorPage=await pageFor(errorContext);
    // M14 retains recoverable errors in its panel; 401 still clears the page.
    const message=errorPage.getByTestId(mode===401?'config-preview-error':'live-progress-message');
    await errorPage.goto(entry(),{waitUntil:'domcontentloaded'});await message.filter({hasText:expected}).waitFor();
    assert.match(await message.innerText(),expected);await assertNoFabrication(errorPage);
    await shot(errorPage,String(mode));report.checks.push(`${mode}: explicit Chinese error and no empty/fabricated map`);await errorContext.close();
  }
  const pendingContext=await browser.newContext({viewport:{width:1600,height:1000}}),pending=await mock(pendingContext,'pending'),waiting=await pageFor(pendingContext);
  await waiting.goto(entry(),{waitUntil:'domcontentloaded'});
  await waiting.getByTestId('live-progress-message').filter({hasText:'团队后端尚未提供实时接口'}).waitFor();
  const started=performance.now();await waiting.waitForTimeout(5000);const elapsed=performance.now()-started;
  assert.match(await waiting.getByTestId('live-progress-message').innerText(),/团队后端尚未提供实时接口/);
  assert.equal(await waiting.getByTestId('config-preview-error').count(),0);assert.equal(await waiting.locator('[role=alert],.live-message.warning').count(),0);
  await assertNoFabrication(waiting);
  const polling=pending.calls.filter(call=>call.path===api),bootstrap=pending.calls.filter(call=>call.path===api+'/scene/bootstrap');
  assert.equal(pending.calls[0].path,api);assert.equal(bootstrap.length,1);
  assert(pending.calls.every(call=>call.method==='GET'&&[api,api+'/scene/bootstrap'].includes(call.path)),'pending must never request artifacts or scene/events');
  assert(polling.length>=2&&polling.length<=4,`unbounded or absent polling: ${polling.length} calls`);
  for(let i=1;i<polling.length;i++)assert(polling[i].at-polling[i-1].at>=1500,'run detail polling must not retry rapidly');
  assert(pending.trace.some(item=>item.kind==='response'&&item.path===api+'/scene/bootstrap'&&item.status===404));
  report.requestChecks.push({phase:'running with no live API',observationMs:elapsed,runDetails:polling.length,bootstrap:bootstrap.length});
  await shot(waiting,'pending-no-live-api');report.checks.push('running old backend: explicit non-error waiting, no fabricated people/orders/map, bootstrap 404 once, bounded detail polling for five seconds');await pendingContext.close();
  const partialContext=await browser.newContext({viewport:{width:1600,height:1000}}),partialCapture=await mock(partialContext,'failed-partial');const partial=await pageFor(partialContext);
  await partial.goto(entry(),{waitUntil:'domcontentloaded'});await ready(partial);assert.match(await partial.getByTestId('data-notice').innerText(),/部分记录.*1\/2 步/);await endReplay(partial);await shot(partial,'failed-partial');
  assertTerminalRequests(partialCapture,{calls:0,trace:0},'failed partial terminal bundle');
  report.checks.push('failed partial terminal run is readable with partial notice, preserved evidence and only two actual orders');await partialContext.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
})().catch(error=>{report.ok=false;report.failure=error.stack||String(error);process.exitCode=1;}).finally(async()=>{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(output,`remote-${tag}-qa.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
