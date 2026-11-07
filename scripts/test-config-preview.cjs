// Browser acceptance uses synthetic uploads by default. Private input is opt-in and produces no screenshots.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),embed=args.includes('--embed');
const privateAt=args.indexOf('--private-fixtures'),privateInput=privateAt>=0;
const fixtures=privateInput?path.resolve(args[privateAt+1]):path.join(root,'frontend/tests/fixtures/config-preview');
const output=path.join(root,'logs',privateInput?'milestone10-private':'milestone10');fs.mkdirSync(output,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync(path.join(fixtures,'snapshot.json'),'utf8'));
const preparation=JSON.parse(fs.readFileSync(path.join(fixtures,'preparation.json'),'utf8'));
const report={mode:embed?'embed':'local',source:privateInput?'private-local-only':'synthetic',people:snapshot.nodes.length,edges:snapshot.edges.length,errors:[],checks:[]};
const base=embed?'http://127.0.0.1:5188/scene':'http://127.0.0.1:5180';
let server,browser;
async function ready(page,gis=false){
  await page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:90000});
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:90000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:90000});
  await page.getByTestId('person-accounting').waitFor();
  assert.equal(await page.locator('[role=alert],vite-error-overlay').count(),0);
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,snapshot.nodes.length);assert.equal(accounting.inside,snapshot.nodes.length);assert.equal(accounting.visible,0);assert.equal(accounting.valid,true);
  assert.equal(await page.getByTestId('config-preview').getAttribute('data-edges'),String(snapshot.edges.length));
  assert.match(await page.locator('.preview-bar').innerText(),/事件 0.*订单 0/);
}
async function shot(page,name){if(!privateInput)await page.screenshot({path:path.join(output,name+'.png')});}
async function open(url){const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url,{waitUntil:'domcontentloaded'});return page;}
function stage(name,payload,status='completed'){return {name,status,reused:false,error:null,payload};}
async function mock(page,status){await page.route('**/api/sessions/**',route=>{const network=new URL(route.request().url()).pathname.endsWith('/network');if(typeof status==='number')return route.fulfill({status,json:{detail:'测试响应'}});return route.fulfill({json:stage(network?'network':'roles',network?(status==='pending'?null:{snapshot,provenance:{}}):preparation,network&&status==='pending'?'running':'completed')});});}
(async()=>{
  if(embed){const dist=path.join(root,'frontend/dist-embed');server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!pathname.startsWith('/scene/')){res.writeHead(404).end();return;}let file=path.resolve(dist,'.'+pathname.slice('/scene'.length));if(file!==dist&&!file.startsWith(dist+path.sep)){res.writeHead(404).end();return;}if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.writeHead(404).end();return;}const type={'.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.html':'text/html','.png':'image/png','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);fs.createReadStream(file).pipe(res);});await new Promise(resolve=>server.listen(5188,'127.0.0.1',resolve));}
  browser=await chromium.launch({channel:'chrome',headless:true});
  if(embed){
    const landing=await open(base+'/');
    await landing.getByTestId('embed-welcome').waitFor();
    assert.equal(await landing.getByLabel('配置文件',{exact:true}).count(),0);
    assert.match(await landing.getByTestId('embed-welcome').innerText(),/session.*config/s);
    await landing.getByText('开发者调试',{exact:true}).click();
    await landing.getByLabel('配置文件',{exact:true}).waitFor();
    await landing.close();
    report.checks.push('embed root explains entry parameters; local import is collapsed in developer tools');
  }
  const page=await open(base+'/mecoffe3d?preview=local');
  await page.getByLabel('配置文件',{exact:true}).setInputFiles([path.join(fixtures,'snapshot.json'),path.join(fixtures,'preparation.json')]);
  await ready(page);await shot(page,'3d-overview');
  const selected=snapshot.nodes.find(n=>snapshot.edges.some(e=>e.source===n.entity_id));
  await page.locator(`.roster [data-person-id="${selected.entity_id}"]`).click();
  await page.locator('.person-detail [aria-label="人物属性"]').waitFor();await shot(page,'profile');
  await page.getByRole('button',{name:'全景',exact:true}).click();await page.waitForTimeout(350);
  assert(Number(await page.locator('.map-canvas').getAttribute('data-relationship-lines'))>0);await shot(page,'relationships');
  report.checks.push('local 3D population, zero activity, profile and relations');
  await page.locator('.preview-bar a').click();await ready(page,true);
  await page.locator(`.gis-roster [data-person-id="${selected.entity_id}"]`).click();await page.waitForTimeout(700);
  assert(await page.locator('svg [data-relationship-source]').count()>0);await shot(page,'gis-preview');
  report.checks.push('same local configuration survives GIS switch with indoor counts and relations');
  await page.locator('.preview-bar a').click();await ready(page);report.checks.push('GIS switch back preserves configuration');
  await page.close();
  if(!privateInput){
    const remote=await browser.newPage({viewport:{width:1600,height:1000}});remote.on('pageerror',e=>report.errors.push(e.message));await mock(remote);
    await remote.goto(base+'/mecoffe3d?session=synthetic-session&config=synthetic-config');await ready(remote);assert.equal(await remote.getByLabel('配置文件',{exact:true}).count(),0);await remote.locator('.preview-bar a').click();await ready(remote,true);await remote.reload();await ready(remote,true);await remote.close();report.checks.push('same-origin remote StageDetail data, no import UI, view switch and GIS refresh');
    for(const [status,text,name]of [['pending',/尚未准备完成/,'stage-pending'],[401,/登录已失效/,'login-expired'],[404,/配置不存在/,'config-not-found']]){
      const errorPage=await browser.newPage({viewport:{width:1600,height:1000}});await mock(errorPage,status);await errorPage.goto(base+'/mecoffe3d?session=synthetic-session&config=synthetic-config');await errorPage.getByTestId('config-preview-error').waitFor();assert.match(await errorPage.getByTestId('config-preview-error').innerText(),text);assert.equal(await errorPage.locator('.map-canvas canvas').count(),0);await shot(errorPage,name);await errorPage.close();report.checks.push(name);
    }
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
})().catch(error=>{report.ok=false;report.failure=privateInput?'Private local verification failed; inspect locally':error.stack;process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,(embed?'embed':'local')+'-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
