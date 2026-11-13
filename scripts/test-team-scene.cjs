// 10th-batch acceptance: DEV Vite or --embed strict static /scene/ hosting,
// plus wholly synthetic same-origin Session/Stage/Run APIs.
// Never accesses a team server, model, geocoder or external tile service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:5211',out=path.join(root,'logs/milestone15-team-scene'),onlyV3=process.argv.includes('--v3-only'),onlyNone=process.argv.includes('--none-only'),embed=process.argv.includes('--embed');
fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,hosting:embed?'dist-embed strict static /scene/; actual published catalog bytes':'DEV Vite; explicit published-catalog fixture response',subset:onlyV3?'v3-only':onlyNone?'none-only':'all',checks:[],requests:[],errors:[],externalRequests:[],unexpectedApis:[],screenshots:[]};
let browser,server,helpers,activePage;
const SID='synthetic-team-session',RID='synthetic-team-run',PREFIX=`/api/sessions/${SID}`,RUN=`${PREFIX}/runs/${RID}`;
const clone=x=>structuredClone(x);
async function mock(options={}){
  const {version=2,mode='config',revision=1,failure=null}=options,flag=Object.hasOwn(options,'flag')?options.flag:true;
  const b=helpers.teamFixture(version),actualPlan=clone(b.plan);actualPlan.plan_revision=revision;
  let virtualFiles=null;
  if(version===3){
    // The frozen taxonomy unit fixture intentionally omits rendering-only
    // edge lengths. Derive a NEW in-memory map, never replace old version bytes.
    const old=b.scene_result.map_ref,manifest=JSON.parse(fs.readFileSync(new URL(`${old.map_id}/${old.map_version}/manifest.json`,b.mapRoot)));
    virtualFiles=new Map(Object.keys(manifest.files).map(name=>[name,fs.readFileSync(new URL(`${old.map_id}/${old.map_version}/${name}`,b.mapRoot))]));
    const campus=JSON.parse(virtualFiles.get('campus3d.json')),nodes=new Map(campus.walk_graph.nodes.map(node=>[node.id,node]));
    for(const edge of campus.walk_graph.edges){const a=nodes.get(edge.source),z=nodes.get(edge.target);edge.length_m=Math.hypot(a.x-z.x,a.y-z.y);}
    virtualFiles.set('campus3d.json',Buffer.from(JSON.stringify(campus)));
    manifest.map_id='synthetic-taxonomy-render';manifest.files['campus3d.json']=createHash('sha256').update(virtualFiles.get('campus3d.json')).digest('hex');
    const raw=Buffer.from(JSON.stringify(manifest));virtualFiles.set('manifest.json',raw);
    b.scene_result.map_ref={map_id:manifest.map_id,map_version:manifest.map_version,manifest_sha256:createHash('sha256').update(raw).digest('hex')};helpers.rehash(b.scene_result);
  }
  if(failure==='owner')actualPlan.economy.brands[0].owner_entity_id=b.snapshot.nodes[0].entity_id;
  if(failure==='plan-id')actualPlan.plan_id='synthetic-unrelated-plan';
  const detail=helpers.sessionFixture(b,{sid:SID,run:RID,map:flag});
  const wrapper=helpers.mapStage(b),stages=`${PREFIX}/configs/${b.config_id}/stages/`;
  if(failure==='stage-failed'){wrapper.status='failed';wrapper.payload=null;wrapper.error={code:'MAP_NOT_READY',message:'合成地图尚未准备好'};}
  if(failure==='result-hash')wrapper.payload.scene.result_sha256='0'.repeat(64);
  const routes=new Map([[PREFIX,detail],[stages+'map',wrapper],[stages+'plan',helpers.stage('plan',b.plan)],
    [stages+'network',helpers.stage('network',{snapshot:b.snapshot,provenance:{}})],[stages+'roles',helpers.stage('roles',b.roles)]]);
  const engineId=b.trajectory?.run_id||'synthetic-engine',terminal=mode==='replay';
  routes.set(RUN,{id:RID,config_id:b.config_id,status:terminal?'completed':'running',engine_run_id:engineId});
  if(b.trajectory){
    const trajectory=clone(b.trajectory);trajectory.metadata.plan_id=actualPlan.plan_id;trajectory.metadata.plan_revision=actualPlan.plan_revision;
    routes.set(RUN+'/artifacts/trajectory',trajectory);routes.set(RUN+'/artifacts/population-snapshot',b.snapshot);routes.set(RUN+'/artifacts/plan',actualPlan);
    routes.set(RUN+'/scene/bootstrap',{schema_version:'scene.live.v1',run_id:RID,engine_run_id:engineId,config_id:b.config_id,
      status:'running',phase:'steps',snapshot:b.snapshot,plan:actualPlan,synthetic:true,
      metadata:{snapshot_id:b.snapshot.snapshot_id,snapshot_revision:b.snapshot.snapshot_revision,plan_id:actualPlan.plan_id,plan_revision:actualPlan.plan_revision},step_unit:'day'});
    routes.set(RUN+'/scene/events',clone(b.live.pages.at(-1)));
  }
  const context=await browser.newContext({viewport:{width:1600,height:1050}}),calls=[];
  const mapRef=b.scene_result.map_ref,mapBase=`/api/scene-maps/${mapRef.map_id}/${mapRef.map_version}/`;
  const mapManifest=JSON.parse(virtualFiles?virtualFiles.get('manifest.json'):fs.readFileSync(new URL(`${mapRef.map_id}/${mapRef.map_version}/manifest.json`,b.mapRoot)));
  const mapPaths=[mapBase+'manifest.json',...Object.keys(mapManifest.files).map(name=>mapBase+name)];
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(/^https?:$/.test(u.protocol)&&u.origin!==origin){report.externalRequests.push(u.href);return route.abort();}
    // Only DEV swaps the known source catalog for an explicit test fixture.
    // --embed must read the bytes actually emitted into dist-embed unchanged.
    if(!embed&&u.pathname==='/mecoffe/assets3d/catalog.json')return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'adapter/scene_builder/resources/mecoffe-embed-v1/catalog.json'))});
    if(!u.pathname.startsWith('/api/'))return route.continue();
    assert.equal(req.method(),'GET');assert.equal(req.headers().authorization,undefined);
    calls.push({path:u.pathname,time:Date.now()});
    if(u.pathname===stages+'map'&&failure==='map-404')return route.fulfill({status:404,json:{detail:'合成 map 阶段缺失'}});
    if(routes.has(u.pathname))return route.fulfill({json:clone(routes.get(u.pathname))});
    if(mapPaths.includes(u.pathname)){
      if(failure==='map-401')return route.fulfill({status:401,json:{detail:'合成地图读取时登录失效'}});
      const relative=u.pathname.slice('/api/scene-maps/'.length),data=virtualFiles?virtualFiles.get(u.pathname.slice(mapBase.length)):fs.readFileSync(new URL(relative,b.mapRoot));
      return route.fulfill({contentType:u.pathname.endsWith('.geojson')?'application/geo+json':'application/json',body:failure==='manifest-hash'&&u.pathname.endsWith('/manifest.json')?Buffer.from('{}'):data});
    }
    report.unexpectedApis.push(u.pathname);return route.fulfill({status:404,json:{detail:'unexpected synthetic API'}});
  });
  const page=await context.newPage();activePage=page;page.on('pageerror',e=>report.errors.push(e.message));
  return {b,actualPlan,context,page,calls,stages,mapPaths,mode,flag,failure,url:view=>origin+(embed?'/scene':'')+`/${view==='gis'?'mecoffe-gis':'mecoffe3d'}/?session=${SID}&${mode==='config'?'config='+b.config_id:'run='+RID}`};
}
async function accounting(input,view='three'){
  const {page,b}=input;
  await Promise.race([
    page.locator(view==='gis'?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:90000}),
    page.getByTestId('team-scene-blocked').waitFor({timeout:90000}).then(async()=>{throw Error(await page.getByTestId('team-scene-blocked').innerText())}),
    page.getByTestId('config-preview-error').waitFor({timeout:90000}).then(async()=>{throw Error(await page.getByTestId('config-preview-error').innerText())}),
    page.locator('.error-panel').waitFor({timeout:90000}).then(async()=>{throw Error(await page.locator('.error-panel').innerText())}),
  ]);
  await page.locator(view==='gis'?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:90000});
  if(view!=='gis')await page.locator('.style-status').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(count=>{const e=document.querySelector('.campus3d-page,.gis-page');return e?.dataset.personAccounting&&JSON.parse(e.dataset.personAccounting).total===count},b.snapshot.nodes.length);
  const result=JSON.parse(await page.locator(view==='gis'?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(result.total,b.snapshot.nodes.length);assert.equal(result.valid,true);
  if(input.flag===true){
    assert.equal(result.out_of_scene,b.scene_result.assignments.filter(a=>a.status==='out_of_scene').length);
    assert.equal(await page.getByTestId('legacy-scene-note').count(),0);
  }
  return page.locator('[data-assignment-person]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.assignmentPerson,n.dataset.building,n.dataset.entrance,n.dataset.placementStatus]));
}
async function noMap(input,kind){
  await input.page.getByTestId('team-scene-'+kind).waitFor({timeout:30000});
  assert.equal(await input.page.locator('canvas').count(),0);
  assert.equal(await input.page.getByTestId('legacy-scene-note').count(),0);
}
function strictRequests(input,label,{mapFiles=true}={}){
  const expected=new Map([[PREFIX,1],[input.stages+'roles',1]]);
  if(input.mode==='config')expected.set(input.stages+'network',1);
  const validWrapper=input.flag===true&&!['stage-failed','map-404'].includes(input.failure);
  if(input.flag===true)expected.set(input.stages+'map',1);
  if(validWrapper){expected.set(input.stages+'plan',1);expected.set(input.stages+'network',(expected.get(input.stages+'network')||0)+1);}
  if(mapFiles)for(const file of input.mapPaths)expected.set(file,1);
  if(input.mode==='replay'){expected.set(RUN,2);for(const suffix of ['trajectory','population-snapshot','plan'])expected.set(RUN+'/artifacts/'+suffix,1);}
  if(input.mode==='live')expected.set(RUN+'/scene/bootstrap',1);
  const counts={};for(const call of input.calls)counts[call.path]=(counts[call.path]||0)+1;
  for(const [name,count]of expected)assert.equal(counts[name],count,`${label}: ${name}`);
  for(const [name,count]of Object.entries(counts)){
    if(input.mode==='live'&&[RUN,RUN+'/scene/events'].includes(name)){assert(count>=1&&count<=20,`${label}: polling bound ${name}=${count}`);continue;}
    assert(expected.has(name),`${label}: unexpected path ${name}`);
  }
  assert.equal(input.calls[0].path,input.mode==='config'?PREFIX:RUN);
  report.requests.push({label,counts});
}
async function shot(page,name){const file=path.join(out,(embed?'embed-':'')+name+'.png');await page.screenshot({path:file});report.screenshots.push(path.relative(root,file));}
(async()=>{
  helpers=await import(pathToFileURL(path.join(root,'frontend/tests/helpers/teamSceneFixtures.js')).href);
  if(embed){
    server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5211});
  }else{
    const {createServer}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
    server=await createServer({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),server:{host:'127.0.0.1',port:5211,strictPort:true,open:false}});await server.listen();
  }
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
  let frozenPlaces;
  for(const mode of onlyV3||onlyNone?[]:['config','replay','live'])for(const view of ['three','gis']){
    const input=await mock({mode,revision:mode==='config'?1:2});await input.page.goto(input.url(view));
    const places=await accounting(input,view);
    if(!frozenPlaces)frozenPlaces=places;else assert.deepEqual(places,frozenPlaces);
    if(mode!=='config')await input.page.getByTestId('team-scene-revision-note').filter({hasText:'2'}).waitFor();
    if(mode==='live')await input.page.waitForFunction(()=>document.querySelector('[data-testid="live-orders"]')?.textContent.trim()==='2');
    if(mode==='config'&&view==='three')await shot(input.page,'v2-config-three');
    if(mode==='live'&&view==='gis')await shot(input.page,'v2-live-gis');
    await input.page.close();strictRequests(input,`v2 ${mode} ${view}`);await input.context.close();
  }
  if(!onlyV3&&!onlyNone)report.checks.push('v2: Three/GIS config/live/replay all use identical frozen assignments, 7 total and 2 outside; runtime revision 2 keeps original scene revision 1');
  for(const view of onlyNone?[]:['three','gis']){const input=await mock({version:3});await input.page.goto(input.url(view));await accounting(input,view);await input.page.close();strictRequests(input,'v3 config '+view);await input.context.close();}
  if(!onlyNone)report.checks.push('v3: fixture-derived synthetic-taxonomy-render adds only required walk-edge lengths under a new map ID/hash, original fixture remains read-only; 26 people render in both views');
  if(onlyV3){assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.unexpectedApis,[]);report.ok=true;return;}
  for(const mode of ['config','replay','live'])for(const view of ['three','gis']){
    const input=await mock({mode,flag:false,revision:mode==='config'?1:2});await input.page.goto(input.url(view));await noMap(input,'none');
    if(mode!=='config'){
      await input.page.waitForFunction(()=>document.querySelectorAll('[data-team-order]').length>=2);
      assert.match(await input.page.getByTestId('team-scene-none').innerText(),/¥9\.90/);assert.match(await input.page.getByTestId('team-scene-none').innerText(),/¥12\.00/);
    }
    if(mode==='config'&&view==='three')await shot(input.page,'none-config-three');
    if(mode==='replay'&&view==='gis')await shot(input.page,'none-replay-gis-orders');
    await input.page.close();strictRequests(input,`none ${mode} ${view}`,{mapFiles:false});await input.context.close();
  }
  report.checks.push('none: config/live/replay in Three/GIS have zero canvas, retain people/relations and both verified orders with amounts');
  if(onlyNone){assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.unexpectedApis,[]);report.ok=true;return;}
  for(const [failure,mode] of [['stage-failed','config'],['map-404','config'],['result-hash','config'],['manifest-hash','config'],['owner','live'],['owner','replay'],['plan-id','live']]){
    const input=await mock({mode,failure});await input.page.goto(input.url('three'));await noMap(input,'blocked');
    if(failure==='owner')assert.match(await input.page.getByTestId('team-scene-blocked').innerText(),/经营者/);
    if(failure==='owner'&&mode==='replay')assert.equal(await input.page.locator('[data-team-order]').count(),0);
    if(failure==='plan-id')assert.match(await input.page.getByTestId('team-scene-blocked').innerText(),/plan_id/);
    await input.page.close();
    if(failure==='manifest-hash'){
      const requested=input.calls.filter(c=>c.path.startsWith('/api/scene-maps/'));assert.deepEqual(requested.map(c=>c.path),[input.mapPaths[0]]);
      const files=input.mapPaths;input.mapPaths=[files[0]];strictRequests(input,failure);input.mapPaths=files;
    }else strictRequests(input,failure+' '+mode,{mapFiles:false});
    await input.context.close();
  }
  report.checks.push('map-stage failure/404, result hash, manifest hash, owner and plan ID mismatch are explained, no canvas and no legacy fallback');
  const auth=await mock({mode:'live',failure:'map-401'});await auth.page.goto(auth.url('three'));
  await auth.page.getByTestId('config-preview-error').filter({hasText:'登录已失效'}).waitFor({timeout:30000});
  assert.equal(await auth.page.locator('canvas').count(),0);assert.equal(await auth.page.getByTestId('team-scene-blocked').count(),0);
  assert.equal(await auth.page.getByTestId('team-scene-none').count(),0);assert.equal(await auth.page.getByTestId('legacy-scene-note').count(),0);
  assert.equal(await auth.page.getByTestId('config-preview').getAttribute('data-people'),'0');
  assert.equal(await auth.page.getByTestId('config-preview').getAttribute('data-orders'),'0');
  const checkpoint=auth.calls.map(call=>call.path);await auth.page.waitForTimeout(2500);
  assert.deepEqual(auth.calls.map(call=>call.path),checkpoint,'map 401 must stop polling and must not revive retained people/events');
  assert.equal(await auth.page.getByTestId('config-preview').getAttribute('data-people'),'0');
  await auth.page.close();auth.mapPaths=[auth.mapPaths[0]];strictRequests(auth,'live map 401');await auth.context.close();
  report.checks.push('live map-file 401 after bootstrap clears people/orders, stops polling, stays login error and never becomes none/legacy/blocked recovery');
  const legacy=await mock({flag:undefined});await legacy.page.goto(legacy.url('three'));await accounting(legacy);await legacy.page.getByTestId('legacy-scene-note').filter({hasText:'旧版示意场景'}).waitFor();await legacy.page.close();strictRequests(legacy,'legacy',{mapFiles:false});await legacy.context.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.unexpectedApis,[]);report.ok=true;
})().catch(async error=>{report.ok=false;report.failure=error.stack;process.exitCode=1;if(activePage&&!activePage.isClosed()){report.lastBody=(await activePage.locator('body').innerText()).slice(0,6000);await shot(activePage,'failure')}}).finally(async()=>{
  await browser?.close();
  if(server){if(embed)await new Promise(resolve=>server.close(resolve));else await server.close();}
  const filename=`qa${embed?'-embed':''}${onlyV3?'-v3':onlyNone?'-none':''}.json`;
  fs.writeFileSync(path.join(out,filename),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
