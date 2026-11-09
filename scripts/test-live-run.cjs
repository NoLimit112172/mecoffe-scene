// Strict static /scene/ + synthetic same-origin APIs. Never accesses a server.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {liveFixture}=require('./lib/live-fixture.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'logs/milestone14');fs.mkdirSync(out,{recursive:true});
const origin='http://127.0.0.1:5194',base=origin+'/scene';
const report={source:'synthetic fixtures only; strict static embed + full-page iframe',checks:[],screenshots:[],characterLoading:[],errors:[],badResources:[],unexpectedApis:[],externalRequests:[]};
let server,browser;
const clone=value=>structuredClone(value);
async function mockCase(options={}){
  const f=liveFixture(),control={phase:'pending',failure:null,terminal:false,artifactsReady:true,...options};
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),requests=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(/^https?:$/.test(url.protocol)&&url.origin!==origin){report.externalRequests.push(request.url());return route.abort();}
    if(url.pathname==='/m14-harness'){
      const view=url.searchParams.get('view')||'mecoffe3d',src=`${base}/${view}/?session=${f.session}&run=${f.run}`;
      return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>M14 本地合成接口整页验收</title><style>html,body{height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column;font:12px Arial;background:#f1f5f0}header{height:32px;flex:none;padding:0 12px;display:flex;align-items:center;color:#28574b;box-sizing:border-box}main{flex:1;min-height:0;display:flex}iframe{display:block;width:100%;height:100%;border:0;min-height:0}</style><header>本地合成接口验收 · 完整父页面 iframe · 仅展示层示意</header><main><iframe title="合成实时场景" src="${src}"></iframe></main>`});
    }
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(request.method(),'GET');assert.equal(request.headers().authorization,undefined);
    requests.push({path:url.pathname,query:url.search,time:Date.now()});
    if(control.failure==='detail-401'&&url.pathname===f.prefix)return route.fulfill({status:401,json:{detail:'合成登录失效'}});
    if(url.pathname===f.prefix)return route.fulfill({json:f.detail(control.terminal?'completed':control.phase==='partial'?'running':'running')});
    if(url.pathname===f.stages+'roles')return route.fulfill({json:{name:'roles',status:'completed',config_id:f.config,payload:f.roles}});
    if(url.pathname===f.prefix+'/scene/bootstrap'){
      if(control.failure==='bootstrap-404')return route.fulfill({status:404,json:{detail:'合成后端没有实时接口'}});
      return route.fulfill({json:clone(f.bootstrap)});
    }
    if(url.pathname===f.prefix+'/scene/events'){
      if(control.failure==='network')return route.abort('failed');
      if(control.failure==='events-401')return route.fulfill({status:401,json:{detail:'合成登录失效'}});
      if(control.failure==='events-404'||control.failure==='events-409')return route.fulfill({status:control.failure==='events-404'?404:409,json:{detail:'合成接口暂不可用'}});
      const page=f.page(control.phase);
      if(control.terminal){page.status='completed';page.done=true;}
      return route.fulfill({json:page});
    }
    if(url.pathname.startsWith(f.prefix+'/artifacts/')){
      if(!control.artifactsReady)return route.fulfill({status:409,json:{detail:'合成终态产物登记中'}});
      const key=url.pathname.split('/').at(-1);
      const value={trajectory:f.trajectory,'population-snapshot':f.snapshot,plan:f.plan}[key];
      if(value)return route.fulfill({json:clone(value)});
    }
    report.unexpectedApis.push(url.pathname);return route.fulfill({status:404,json:{detail:'unexpected synthetic API'}});
  });
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!new URL(response.url()).pathname.startsWith('/api/'))report.badResources.push({url:response.url(),status:response.status()});});
  return {context,page,f,control,requests};
}
async function open(input,gis=false,viewport){
  if(viewport)await input.page.setViewportSize(viewport);
  const response=await input.page.goto(`${origin}/m14-harness?view=${gis?'mecoffe-gis':'mecoffe3d'}`,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  const handle=await input.page.locator('iframe').elementHandle(),frame=await handle.contentFrame();
  await frame.getByTestId('live-panel').waitFor({timeout:30000});return frame;
}
async function ready(frame,gis=false){
  await Promise.race([
    frame.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000}),
    frame.getByTestId('config-preview-error').waitFor({timeout:120000}).then(async()=>{throw Error(await frame.getByTestId('config-preview-error').innerText());}),
  ]);
  await frame.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await frame.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  const accounting=JSON.parse(await frame.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,7);assert.equal(accounting.visible+accounting.inside,7);assert.equal(accounting.valid,true);
  assert.match(await frame.getByRole('note').innerText(),/OASIS 没有位置数据/);
}
async function stat(frame,key,value){await frame.waitForFunction(({key,value})=>document.querySelector(`[data-testid="${key}"]`)?.textContent.trim()===String(value),{key,value},{timeout:30000});}
async function shot(page,name){
  const frame=page.frames().find(frame=>frame.url().startsWith(base));
  if(frame&&await frame.locator('.campus3d-page').count()){
    const before=await frame.locator('.character-loading').allTextContents();
    // Batch setup completes before lazy visible avatars finish loading. Wait
    // for v-if removal, not CSS hiding (short windows hide some notices).
    await frame.locator('.character-loading').waitFor({state:'detached',timeout:60000});
    report.characterLoading.push({screenshot:name,before,after:await frame.locator('.character-loading').allTextContents()});
  }
  const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push('logs/milestone14/'+name+'.png');
}
async function readableCards(frame){
  const cards=await frame.locator('.live-cards article[data-evidence="pending"],.live-cards article[data-evidence="verified"],.live-cards article[data-evidence="unverified"]').evaluateAll(elements=>elements.map(element=>({title:element.querySelector('b').textContent,body:element.querySelector('p')?.textContent||''})));
  assert(cards.length>0);
  for(const card of cards){assert.notEqual(card.body,card.title);assert.match(card.body,/样例商品|门店 [A-Z]+（示意）|数量|订单号/);}
}
async function fit(input,frame,label){
  const parent=await input.page.evaluate(()=>({h:innerHeight,w:innerWidth,scrollH:document.documentElement.scrollHeight,scrollW:document.documentElement.scrollWidth}));
  const child=await frame.evaluate(()=>({h:innerHeight,w:innerWidth,scrollH:document.documentElement.scrollHeight,scrollW:document.documentElement.scrollWidth,
    bodyH:document.body.scrollHeight,rootH:document.querySelector('[data-testid="config-preview"]')?.getBoundingClientRect().height,
    map:document.querySelector('.map-canvas,.gis-map')?.getBoundingClientRect().toJSON()}));
  assert(parent.scrollH<=parent.h+2&&parent.scrollW<=parent.w+2,`${label}: parent document must not scroll`);
  assert(child.scrollH<=child.h+2&&child.scrollW<=child.w+2,`${label}: iframe document must not have a second scrollbar: ${JSON.stringify(child)}`);
  assert(child.rootH<=child.h+2&&child.map.bottom<=child.h+2,`${label}: actual content must fit, not just be clipped by overflow:hidden: ${JSON.stringify(child)}`);
  assert(child.map.height>=100&&child.map.width>=250,`${label}: map must retain a usable area`);
  report.checks.push({layout:label,parent,iframe:child});
}
async function switchView(frame,gis){
  await frame.locator('.preview-bar a').click();await ready(frame,gis);return frame;
}
(async()=>{
  server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5194});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
  // Main case keeps a single Vue app and real iframe throughout live updates.
  const main=await mockCase(),frame=await open(main);await ready(frame);await stat(frame,'live-orders',0);
  await frame.locator('[data-evidence="pending"]').first().waitFor();
  assert.equal(await frame.getByTestId('live-day').innerText(),'第 1/2 天');
  assert.match(await frame.getByTestId('live-progress-message').innerText(),/第 1 天进行中，汇总尚未更新/);await readableCards(frame);
  await frame.evaluate(()=>{window.__m14Canvas=document.querySelector('.map-canvas canvas')});
  await fit(main,frame,'3D wide 1600x1000');await shot(main.page,'3d-live-pending-wide');
  const initialCount=await frame.locator('[data-live-event]').count();
  const before=main.requests.filter(r=>r.path.endsWith('/scene/events')).length;
  await main.page.waitForFunction(()=>true);await main.page.waitForTimeout(2600);
  assert(main.requests.filter(r=>r.path.endsWith('/scene/events')).length>before,'live endpoint is polled');
  assert.equal(await frame.locator('[data-live-event]').count(),initialCount,'duplicate pages do not duplicate feed');
  main.control.phase='confirmed';await stat(frame,'live-orders',1);await stat(frame,'live-quantity',1);
  await frame.waitForFunction(()=>document.querySelector('[data-testid="order-count"]')?.textContent.trim().startsWith('1'),null,{timeout:30000});
  await frame.locator('[data-evidence="verified"]').first().waitFor();await frame.locator('[data-evidence="unverified"]').first().waitFor();
  assert.equal(await frame.getByTestId('live-day').innerText(),'第 2/2 天');
  assert.match(await frame.getByTestId('live-panel').innerText(),/当前第 2 步/);
  assert.equal(await frame.getByTestId('live-progress-message').innerText(),'第 2 天进行中，汇总尚未更新');await readableCards(frame);
  assert.equal(await frame.evaluate(()=>window.__m14Canvas===document.querySelector('.map-canvas canvas')),true,'renderer canvas remains initialized once');
  assert.match(await frame.getByTestId('live-feed').innerText(),/被拒|拒绝/);assert.match(await frame.getByTestId('live-feed').innerText(),/未知/);
  await shot(main.page,'3d-day-summary-confirmed');
  await frame.getByRole('button',{name:'暂停观看',exact:true}).click();
  await switchView(frame,true);await stat(frame,'live-orders',1);await frame.getByRole('button',{name:'继续观看',exact:true}).waitFor();
  assert.equal(await frame.getByTestId('live-day').innerText(),'第 2/2 天');
  assert.equal(await frame.getByTestId('live-progress-message').innerText(),'第 2 天进行中，汇总尚未更新');await readableCards(frame);
  await fit(main,frame,'GIS wide 1600x1000');await shot(main.page,'gis-live-shared-paused');
  await frame.getByRole('button',{name:'跟随最新进度',exact:true}).click();
  await frame.getByRole('button',{name:'暂停观看',exact:true}).waitFor();
  await main.page.setViewportSize({width:820,height:650});await main.page.waitForTimeout(400);await fit(main,frame,'GIS narrow 820x650');
  const toggle=frame.getByRole('button',{name:'人物与地图详情',exact:true});await toggle.click();await frame.getByRole('button',{name:'收起详情',exact:true}).waitFor();await shot(main.page,'gis-narrow-details');
  await frame.getByRole('button',{name:'收起详情',exact:true}).click();
  await switchView(frame,false);await fit(main,frame,'3D narrow 820x650');
  await frame.getByRole('button',{name:'人物与场景详情',exact:true}).click();await frame.getByRole('button',{name:'收起详情',exact:true}).waitFor();await shot(main.page,'3d-narrow-details');
  await frame.getByRole('button',{name:'收起详情',exact:true}).click();await shot(main.page,'3d-narrow-full-page');
  await main.page.setViewportSize({width:1100,height:500});await main.page.waitForTimeout(400);await fit(main,frame,'3D short 1100x500');await shot(main.page,'3d-short-full-page');
  await switchView(frame,true);await fit(main,frame,'GIS short 1100x500');await shot(main.page,'gis-short-full-page');await switchView(frame,false);
  main.control.phase='second';await stat(frame,'live-orders',2);
  await main.page.setViewportSize({width:1600,height:1000});
  assert.equal(await frame.getByTestId('live-day').innerText(),'全部天数已计算');
  assert.equal(await frame.getByTestId('live-progress-message').innerText(),'全部天数已计算，等待运行收尾');
  await shot(main.page,'3d-all-days-waiting');
  await switchView(frame,true);assert.equal(await frame.getByTestId('live-progress-message').innerText(),'全部天数已计算，等待运行收尾');await shot(main.page,'gis-all-days-waiting');await switchView(frame,false);
  main.control.terminal=true;main.control.artifactsReady=false;
  await frame.getByTestId('live-panel').getByText(/正式回放产物暂未就绪|正在等待/).waitFor({timeout:30000});await shot(main.page,'terminal-artifacts-wait');
  main.control.artifactsReady=true;await frame.getByTestId('live-panel').locator('[data-mode="replay"]').waitFor({timeout:1000}).catch(()=>{});
  await frame.waitForFunction(()=>document.querySelector('[data-testid="live-panel"]')?.dataset.mode==='replay',{},{timeout:30000});
  await ready(frame);assert.equal(await frame.getByTestId('config-preview').getAttribute('data-orders'),'2');await shot(main.page,'terminal-strict-replay');
  report.checks.push('live batches, duplicate page, pending purchase, day=completed+1 in both views, all-days finalization wait, informative non-duplicate cards, lazy avatar notice removed, declined/unknown, same canvas, cross-view paused state, terminal 409 then strict replay');await main.context.close();

  const partial=await mockCase(),partialFrame=await open(partial,true);await ready(partialFrame,true);
  partial.control.phase='partial';partial.control.artifactsReady=false;await stat(partialFrame,'live-orders',2);
  await partialFrame.waitForFunction(()=>document.querySelector('[data-testid="live-panel"]')?.dataset.status==='failed',{},{timeout:30000});
  await shot(partial.page,'failed-partial-keeps-confirmed');assert.match(await partialFrame.getByTestId('live-panel').innerText(),/部分|失败/);await partial.context.close();

  const missing=await mockCase({failure:'bootstrap-404'}),missingFrame=await open(missing);
  await missingFrame.getByTestId('live-panel').getByText(/团队后端尚未提供实时接口/).waitFor();
  assert.equal(await missingFrame.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);await shot(missing.page,'missing-live-api-fallback');
  missing.control.terminal=true;await missingFrame.waitForFunction(()=>document.querySelector('[data-testid="live-panel"]')?.dataset.mode==='replay',{},{timeout:30000});await ready(missingFrame);await shot(missing.page,'missing-api-automatic-terminal');await missing.context.close();

  for(const failure of ['events-409','events-404','events-401','network']){
    const item=await mockCase({failure}),f=await open(item,true);
    const expected=failure==='events-401'?/登录已失效/:failure==='events-404'?/实时动作接口不存在/:failure==='events-409'?/实时数据正在准备/:/暂时无法连接/;
    await f.getByTestId('live-panel').getByText(expected).first().waitFor({timeout:30000});await shot(item.page,failure);
    if(failure==='events-401'){
      assert.equal(await f.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);
      item.control.failure=null;await f.getByTestId('live-panel').getByRole('button',{name:'重新读取',exact:true}).click();
      await f.getByTestId('config-preview-error').waitFor({state:'hidden'});await ready(f,true);
    }
    else{item.control.failure=null;await ready(f,true);await f.locator('[data-evidence="pending"]').first().waitFor({timeout:30000});}
    report.checks.push(failure+' handled'+(failure==='events-401'?' with private scene cleared':' and recovered'));await item.context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResources,[]);assert.deepEqual(report.unexpectedApis,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
})().catch(async error=>{
  report.ok=false;report.failure=error.stack;process.exitCode=1;
  const page=browser?.contexts().flatMap(c=>c.pages()).at(-1);if(page)try{await shot(page,'failure');report.failureText=await page.locator('body').innerText();const f=page.frames().find(f=>f.url().startsWith(base));if(f)report.iframeFailureText=await f.locator('body').innerText();}catch{}
}).finally(async()=>{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'browser-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
