// 仅使用仓库合成样例和浏览器 mock，不访问团队服务器或私有数据。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),embed=process.argv.includes('--embed'),tag=embed?'embed':'local';
const origin=embed?'http://127.0.0.1:5190':'http://127.0.0.1:5180',base=origin+(embed?'/scene':'');
const out=path.join(root,'logs/milestone12');fs.mkdirSync(out,{recursive:true});
const fixture=name=>JSON.parse(fs.readFileSync(path.join(root,'frontend/tests/fixtures/generic-replay',name+'.json'),'utf8'));
const session='synthetic-session',run='synthetic-run',config='frozen-synthetic-config';
const api=`/api/sessions/${session}/runs/${run}`,stages=`/api/sessions/${session}/configs/${config}/stages/`;
const labels={visitor:'合成校园访客',operator:'合成门店经营者',research:'合成科研人员'};
const report={mode:tag,source:'synthetic-only',viewport:'1600x1000',checks:[],screenshots:[],apiRequests:[],errors:[],badResources:[],externalRequests:[]};
let server,browser;
async function shot(page,name){const file=`${tag}-${name}.png`;await page.screenshot({path:path.join(out,file),fullPage:true});report.screenshots.push(`logs/milestone12/${file}`);}
async function mocked(mode){
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),snapshot=fixture('snapshot'),trajectory=fixture('trajectory'),plan=fixture('plan'),calls=[];
  // 去除快照显式说明，证明中文来自角色接口，降级时确实显示原始 ID。
  snapshot.nodes.forEach(person=>delete person.role_description);
  const roles={name:'roles',status:'completed',config_id:config,payload:{population_request:Object.fromEntries(Object.entries(labels).map(([role,description])=>
    [role,{description,count:snapshot.nodes.filter(p=>p.role===role).length,generate:{}}]))}};
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(/^https?:$/.test(url.protocol)&&url.origin!==origin){report.externalRequests.push(request.url());return route.abort();}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    calls.push(url.pathname);report.apiRequests.push({mode,path:url.pathname});
    assert.equal(request.method(),'GET');assert.equal(request.headers().authorization,undefined);
    if(url.pathname===api)return route.fulfill({json:{id:run,config_id:config,status:'completed',engine_run_id:trajectory.run_id}});
    if(url.pathname===api+'/artifacts/trajectory')return route.fulfill({json:trajectory});
    if(url.pathname===api+'/artifacts/population-snapshot')return route.fulfill({json:snapshot});
    if(url.pathname===api+'/artifacts/plan')return route.fulfill({status:404,json:{detail:'合成旧后端，尚无冻结计划接口'}});
    if(url.pathname===stages+'plan')return route.fulfill({json:{name:'plan',status:'completed',config_id:config,payload:plan}});
    if(url.pathname===stages+'roles'){
      if(mode==='missing')return route.fulfill({status:404,json:{detail:'合成的角色阶段缺失'}});
      if(mode==='login-expired')return route.fulfill({status:401,json:{detail:'合成的登录失效'}});
      if(mode==='pending')return route.fulfill({json:{...roles,status:'pending',payload:null}});
      if(mode==='malformed')return route.fulfill({json:{...roles,payload:{population_request:[]}}});
      if(mode==='invalid-json')return route.fulfill({contentType:'application/json',body:'{invalid synthetic JSON'});
      if(mode==='wrong-config')return route.fulfill({json:{...roles,config_id:'different-config'}});
      return route.fulfill({json:roles});
    }
    throw Error('Unexpected API route: '+url.pathname);
  });
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&!new URL(response.url()).pathname.startsWith('/api/'))report.badResources.push({url:response.url(),status:response.status()});});
  return {context,page,calls,snapshot};
}
async function ready(page,gis){
  await Promise.race([
    page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000}),
    page.getByTestId('config-preview-error').waitFor({timeout:120000}).then(async()=>{throw Error(await page.getByTestId('config-preview-error').innerText());}),
  ]);
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  const wrapper=page.getByTestId('config-preview');
  for(const [name,value]of Object.entries({people:7,edges:4,orders:2}))assert.equal(await wrapper.getAttribute('data-'+name),String(value));
  assert.match(await page.getByTestId('replay-outcomes').innerText(),/被拒 1 条.*结果未知 1 条/);
  assert.match(await page.getByRole('note').innerText(),/OASIS 没有位置数据/);
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,7);assert.equal(accounting.inside+accounting.visible,7);assert.equal(accounting.valid,true);
}
async function people(page,gis,translated){
  if(!gis)await page.getByRole('navigation',{name:'场景信息'}).getByRole('button',{name:'人物',exact:true}).click();
  const roster=page.locator(gis?'.gis-roster':'.roster');assert.equal(await roster.locator('[data-person-id]').count(),7);
  const legend=await page.locator(gis?'.gis-role-key':'.role-key').innerText();
  for(const [role,label]of Object.entries(labels))assert(legend.includes(translated?label:role));
  await roster.locator('[data-person-id="synthetic_person_01"]').click();
  const card=page.locator(gis?'.gis-info':'.person-detail');
  assert.equal(await card.locator(gis?'.role-badge':'.person-title small').innerText(),translated?labels.visitor:'visitor');
  assert((await roster.innerText()).includes(translated?labels.visitor:'visitor'));
  await card.locator('.raw-fields summary').click();
  assert.match(await card.getByLabel('原始人物属性').innerText(),/role\s*"visitor"/);
  await card.locator('.raw-fields summary').click();
}
async function orders(page,gis){
  await page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true}).evaluate(input=>{input.value=input.max;input.dispatchEvent(new Event('input',{bubbles:true}));});
  if(gis)assert.match(await page.locator('.gis-metrics > div').filter({hasText:'回放订单'}).innerText(),/2\s*单/);
  else await page.waitForFunction(()=>document.querySelector('[data-testid="order-count"]')?.textContent.trim().startsWith('2'));
}
(async()=>{
  if(embed)server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5190});
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const mode of ['chinese','missing','pending','malformed','invalid-json','wrong-config','login-expired']){
    const {context,page,calls}=await mocked(mode);
    for(const gis of [false,true]){
      const response=await page.goto(`${base}/${gis?'mecoffe-gis':'mecoffe3d'}/?session=${session}&run=${run}`,{waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200);
      if(mode==='login-expired'){
        await page.getByTestId('config-preview-error').waitFor();assert.match(await page.getByTestId('config-preview-error').innerText(),/登录已失效/);
        assert.equal(await page.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);
        await shot(page,`${gis?'gis':'3d'}-${mode}`);continue;
      }
      await ready(page,gis);await people(page,gis,mode==='chinese');await orders(page,gis);
      if(['chinese','missing'].includes(mode)){
        await page.locator(gis?'.gis-panel':'.side-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
        await shot(page,`${gis?'gis':'3d'}-${mode}-roles`);
        if(mode==='chinese'){
          await page.locator(gis?'.gis-info h3':'.person-detail .person-title').scrollIntoViewIfNeeded();
          await shot(page,`${gis?'gis':'3d'}-chinese-person-card`);
        }
      }
      if(mode==='chinese'){
        await page.reload({waitUntil:'domcontentloaded'});await ready(page,gis);await people(page,gis,true);
        await page.locator('.preview-bar a').click();await ready(page,!gis);await people(page,!gis,true);
        const url=new URL(page.url());assert.equal(url.searchParams.get('session'),session);assert.equal(url.searchParams.get('run'),run);assert.equal(url.searchParams.get('config'),null);
      }
    }
    assert(calls.includes(stages+'roles'));assert(!calls.some(url=>url.includes('different-config')));
    report.checks.push(`${mode}: both views ${mode==='login-expired'?'show login expiry':'preserve 7 people, 4 edges, 2 orders and expected labels, raw role retained'}`);
    await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResources,[]);assert.deepEqual(report.externalRequests,[]);report.ok=true;
})().catch(async error=>{
  report.ok=false;report.failure=error.stack;process.exitCode=1;
  const page=browser?.contexts().flatMap(context=>context.pages()).at(-1);if(page)try{await shot(page,'failure');report.failureText=await page.locator('body').innerText();}catch{}
}).finally(async()=>{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,`${tag}-browser-qa.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
