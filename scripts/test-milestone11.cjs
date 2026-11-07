// Synthetic-only browser acceptance. Never reads private fixtures or contacts the team server.
// Default: running Vite on 5180. --embed: strict /scene/ static build on 5188.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {deflateRawSync}=require('node:zlib');
const {servePages}=require('./serve-pages.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),embed=process.argv.includes('--embed'),tag=embed?'embed':'local';
const origin=embed?'http://127.0.0.1:5188':'http://127.0.0.1:5180',base=origin+(embed?'/scene':'');
const out=path.join(root,'logs/milestone11');fs.mkdirSync(out,{recursive:true});
const configDir=path.join(root,'frontend/tests/fixtures/config-preview'),replayDir=path.join(root,'frontend/tests/fixtures/generic-replay');
const json=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'));
const configSnapshot=json(configDir,'snapshot'),replaySnapshot=json(replayDir,'snapshot'),trajectory=json(replayDir,'trajectory');
const report={mode:tag,source:'synthetic-only',viewport:'1600x1000',checks:[],screenshots:[],errors:[],badResponses:[]};
let server,browser;
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1}return(crc^0xffffffff)>>>0}
function zip(entries){
  const localParts=[],directoryParts=[];let offset=0;
  for(const [name,value]of entries){
    const filename=Buffer.from(name),raw=Buffer.from(JSON.stringify(value)),body=deflateRawSync(raw),crc=crc32(raw);
    const local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    localParts.push(local,filename,body);directoryParts.push(central,filename);offset+=30+filename.length+body.length;
  }
  const directory=Buffer.concat(directoryParts),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...localParts,directory,end]);
}
async function shot(page,name){const target=path.join(out,`${tag}-${name}.png`);await page.screenshot({path:target,fullPage:true});report.screenshots.push(path.relative(root,target).replaceAll('\\','/'))}
async function open(url){
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)report.badResponses.push({url:response.url(),status:response.status()})});
  await page.goto(url,{waitUntil:'domcontentloaded'});return page;
}
async function ready(page,snapshot,{gis=false,replay=false}={}){
  await Promise.race([
    page.locator(gis?'.maplibregl-canvas':'.map-canvas canvas').waitFor({timeout:120000}),
    page.getByTestId('config-preview-error').waitFor({timeout:120000}).then(async()=>{throw new Error(await page.getByTestId('config-preview-error').innerText())}),
  ]);
  await page.locator(gis?'.gis-loading':'.map-loading').waitFor({state:'hidden',timeout:120000});
  if(!gis)await page.locator('.style-status').waitFor({state:'hidden',timeout:120000});
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="配置文件"]')?.disabled);
  assert.equal(await page.locator('[role=alert],vite-error-overlay').count(),0);
  const host=page.getByTestId('config-preview');assert.equal(await host.getAttribute('data-people'),String(snapshot.nodes.length));
  const accounting=JSON.parse(await page.locator(gis?'.gis-page':'.campus3d-page').getAttribute('data-person-accounting'));
  assert.equal(accounting.total,snapshot.nodes.length);assert.equal(accounting.visible+accounting.inside,snapshot.nodes.length);assert.equal(accounting.valid,true);
  if(!replay){assert.equal(accounting.visible,0);assert.equal(accounting.inside,snapshot.nodes.length);assert.equal(await host.getAttribute('data-edges'),String(snapshot.edges.length));assert.match(await page.locator('.preview-bar').innerText(),/尚未运行模拟.*事件 0.*订单 0/s)}
  return accounting;
}
async function selectPerson(page,id,gis=false){
  if(!gis)await page.getByRole('navigation',{name:'场景信息'}).getByRole('button',{name:'人物',exact:true}).click();
  await page.locator(`${gis?'.gis-roster':'.roster'} [data-person-id="${id}"]`).click();
  await page.locator(`${gis?'.gis-info':'.person-detail'} [aria-label="人物属性"]`).waitFor();
}
async function endReplay(page,gis=false){
  const slider=page.getByLabel(gis?'GIS 模拟时间进度':'回放时间进度',{exact:true});
  await slider.evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}))});
  if(gis){const value=await page.locator('.gis-metrics>div').filter({hasText:'回放订单'}).innerText();assert.match(value,/2\s*单/)}
  else assert.match(await page.getByTestId('order-count').innerText(),/^2\s*单/);
  assert.match(await page.getByTestId('replay-outcomes').innerText(),/被拒 1 条.*结果未知 1 条/);
}
(async()=>{
  assert.equal(replaySnapshot.nodes.length,7);assert.equal(trajectory.objects.orders.length,2);
  assert.equal(trajectory.actions.filter(a=>a.outcome==='declined').length,1);assert.equal(trajectory.actions.filter(a=>a.outcome==='unknown').length,1);
  if(embed)server=await servePages({root:path.join(root,'frontend/dist-embed'),prefix:'/scene/',port:5188});
  browser=await chromium.launch({channel:'chrome',headless:true});
  if(embed){
    const welcome=await open(base+'/');await welcome.getByTestId('embed-welcome').waitFor();
    assert.equal(await welcome.getByLabel('配置文件',{exact:true}).count(),0);await shot(welcome,'embed-welcome');
    await welcome.getByText('开发者调试',{exact:true}).click();await welcome.getByLabel('配置文件',{exact:true}).waitFor();await shot(welcome,'embed-developer-import');await welcome.close();
    report.checks.push('embed root explains session/config and session/run; import starts collapsed');
  }
  const page=await open(base+'/mecoffe3d?preview=local');
  const input=page.getByLabel('配置文件',{exact:true});await input.waitFor();assert.equal(await input.getAttribute('multiple'),'');
  assert.match(await page.locator('.config-import').innerText(),/开发调试用.*自动读取/s);await shot(page,'import-interface');
  await input.setInputFiles([path.join(configDir,'preparation.json'),path.join(configDir,'snapshot.json')]);await ready(page,configSnapshot);
  report.checks.push('one multiple-file selection recognizes snapshot and role fields');
  const compressed=zip([['资料/人物.json',configSnapshot],['资料/字段.json',json(configDir,'preparation')]]);
  await input.setInputFiles({name:'synthetic-config.zip',mimeType:'application/zip',buffer:compressed});await ready(page,configSnapshot);
  report.checks.push('real deflate ZIP accepted through the same file input');
  await page.locator('.config-import').evaluate((el,documents)=>{const data=new DataTransfer();for(const [name,content]of documents)data.items.add(new File([JSON.stringify(content)],name,{type:'application/json'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}))},[['snapshot.json',configSnapshot],['preparation.json',json(configDir,'preparation')]]);await ready(page,configSnapshot);
  report.checks.push('dragging multiple synthetic JSON files uses same adapter');
  await page.getByRole('button',{name:'加载合成样例',exact:true}).click();await ready(page,configSnapshot);await shot(page,'3d-config-overview');
  const male=configSnapshot.nodes.find(person=>person.static_attributes.gender==='male');await selectPerson(page,male.entity_id);
  const fields=page.locator('.person-detail [aria-label="人物属性"]');assert.match(await fields.innerText(),/性别\s*男/);assert(!/\bmale\b/.test(await fields.innerText()));
  await page.locator('.person-detail .raw-fields summary').click();assert.match(await page.locator('.person-detail [aria-label="原始人物属性"]').innerText(),/gender\s*"male"/);
  await page.locator('.side-content').evaluate(el=>{el.scrollTop=0});await shot(page,'chinese-profile');
  await page.locator('.person-detail .raw-fields summary').click();
  // This synthetic person's cross-role link spans two distant buildings,
  // making the far-view styling visible rather than photographing a short arc.
  const crossRole=configSnapshot.edges.findLast(edge=>configSnapshot.nodes.find(n=>n.entity_id===edge.source)?.role!==configSnapshot.nodes.find(n=>n.entity_id===edge.target)?.role&&edge.source!==male.entity_id);
  if(crossRole)await selectPerson(page,crossRole.source);
  await page.getByRole('button',{name:'全景',exact:true}).click();await page.waitForTimeout(700);
  assert(Number(await page.locator('.map-canvas').getAttribute('data-relationship-lines'))>0);await shot(page,'overview-relationships');
  report.checks.push('one-click config sample; Chinese male→男 while raw key/value remain; far-view relation lines');
  await page.locator('.preview-bar a').click();await ready(page,configSnapshot,{gis:true});await shot(page,'gis-config-preview');
  await selectPerson(page,male.entity_id,true);assert.match(await page.locator('.gis-info [aria-label="人物属性"]').innerText(),/性别\s*男/);
  await page.locator('.gis-info [aria-label="人物属性"]').scrollIntoViewIfNeeded();
  assert(await page.locator('svg [data-relationship-source]').count()>0);await shot(page,'gis-config-profile');
  report.checks.push('GIS retains same imported configuration, indoor counts and readable values');
  await page.locator('.preview-bar a').click();await ready(page,configSnapshot);
  await page.getByRole('button',{name:'加载合成回放样例',exact:true}).click();await ready(page,replaySnapshot,{replay:true});
  assert.equal(await page.getByTestId('config-preview').getAttribute('data-orders'),'2');await endReplay(page);
  const eventRows=page.locator('.event-list');assert.match(await eventRows.innerText(),/被拒/);assert.match(await eventRows.innerText(),/结果未知/);await shot(page,'3d-generic-replay');
  await page.locator('.event-row').filter({hasText:/被拒/}).first().scrollIntoViewIfNeeded();
  await page.locator('.side-content').screenshot({path:path.join(out,`${tag}-declined-event.png`)});report.screenshots.push(`logs/milestone11/${tag}-declined-event.png`);
  report.checks.push('3D generic replay: seven people, two executed orders, declined=1 and unknown=1, rejected action has no order');
  await page.locator('.preview-bar a').click();await ready(page,replaySnapshot,{gis:true,replay:true});await endReplay(page,true);await shot(page,'gis-generic-replay');
  report.checks.push('GIS generic replay uses same imported tuple and successful order/outcome totals');
  await page.locator('.preview-bar a').click();await ready(page,replaySnapshot,{replay:true});
  await input.setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.getByTestId('config-preview-error').waitFor();
  assert.equal(await page.locator('.map-canvas canvas,.maplibregl-canvas').count(),0);await shot(page,'invalid-import');
  report.checks.push('invalid replacement input clears prior scene instead of retaining stale results');
  await page.close();assert.deepEqual(report.errors,[]);assert.deepEqual(report.badResponses,[]);report.ok=true;
})().catch(async error=>{report.ok=false;report.failure=error.stack;process.exitCode=1;const page=browser?.contexts().flatMap(context=>context.pages()).at(-1);if(page){try{await shot(page,'failure');report.failureText=await page.locator('body').innerText()}catch{}}}).finally(async()=>{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,`${tag}-qa.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
