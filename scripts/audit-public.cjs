// Read-only audit. Reports locations/categories, never potential secret values.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const patterns={
  internal:/https?:\/\/[^\s<>\)\]"']*(?:feishu\.cn|larksuite\.com|larkoffice\.com)[^\s<>\)\]"']*/ig,
  localPath:/[a-z]:[\\/]+Users[\\/]+Lenovo[^\s<>"'`]*/ig,
  credential:/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g,
};
// 仅保留已经获准公开的两份旧快照；新导入的团队配置必须留在私有目录。
const approvedSnapshots=new Set([
  'f495f8773aca681982d1119d65857c262f38ffddbe6b3b9ce99ebf083a352e16',
  'de3eb74f6041c4a198aa9c4a9bc5b4931240e21837e261af9604ed8eca3d8cc7',
]);
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
// 既有获准公开的运行使用内容摘要白名单，不因改名或复制而失效。
const approvedTrajectories=new Set([
  'b5a810f6a79943ac3348da93c1fc9479e3149571717662263007523a2a6afe04',
]);
// 当前没有需保留的真实执行计划；以后须经明确授权才能登记摘要。
const approvedPlans=new Set();
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}
const syntheticName=/^(?:样例人物|合成人物|synthetic\b|sample\b|test\b)/i;
function syntheticTrajectory(value){
  if(value.metadata?.synthetic!==true||!Array.isArray(value.agents)||!value.agents.length)return false;
  const subjects=[...value.agents,...(Array.isArray(value.actions)?value.actions.map(action=>action?.actor).filter(Boolean):[])];
  return subjects.every(person=>{
    const names=['name','display_name','user_name'].filter(key=>person?.[key]!=null).map(key=>person[key]);
    return names.length>0&&names.every(name=>typeof name==='string'&&syntheticName.test(name));
  });
}
function syntheticPlan(value){
  return value.synthetic===true||value.metadata?.synthetic===true||
    [value.scenario?.title,value.scenario?.goal].some(text=>typeof text==='string'&&/(?:完全合成|合成(?:测试|样例)|synthetic)/i.test(text));
}
function privateData(value){
  if(!value||typeof value!=='object')return false;
  if((value.meta?.config_preview===true||value.meta?.generic_replay===true||value.meta?.mode==='generic_replay')&&
      Array.isArray(value.people)&&value.people.length>0)return true;
  if(value.kind==='oasis.interaction_trajectory'){
    if(approvedTrajectories.has(digest(value)))return false;
    if(!syntheticTrajectory(value))return true;
  }
  if(typeof value.plan_id==='string'&&value.population&&typeof value.population==='object'){
    if(approvedPlans.has(digest(value)))return false;
    if(!syntheticPlan(value))return true;
  }
  const nodes=Array.isArray(value.nodes)&&value.nodes.some(node=>node?.entity_id&&node?.role&&('static_attributes'in node||'dynamic_attributes'in node));
  if(nodes){
    if(approvedSnapshots.has(digest(value)))return false;
    const synthetic=/^synthetic(?:-|_|$)/i.test(value.dataset_version||'');
    const names=value.nodes.filter(node=>node.name).every(node=>syntheticName.test(node.name));
    if(!synthetic||!names)return true;
  }
  if(value.population_request&&typeof value.population_request==='object'){
    const declared=value.synthetic===true||(value.role_design?.assumptions||[]).some(item=>typeof item==='string'&&/完全合成|synthetic/i.test(item));
    if(!declared)return true;
  }
  return Object.values(value).some(item=>Array.isArray(item)?item.some(privateData):privateData(item));
}
function findings(text,file){
  const hits=[];
  if(/(?:^|\/)(?:data\/private|fixtures\/mecoffe8)(?:\/|$)/i.test(file.replaceAll('\\','/')))hits.push({file,kind:'privatePath',line:1});
  for(const [kind,expression]of Object.entries(patterns)){expression.lastIndex=0;for(const match of text.matchAll(expression))hits.push({file,kind,line:text.slice(0,match.index).split('\n').length})}
  try{if(privateData(JSON.parse(text)))hits.push({file,kind:'privateConfiguration',line:1})}catch{}
  return hits;
}
function auditCurrent(){
  const names=cp.execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),hits=[];
  for(const name of new Set(names)){const full=path.join(root,name);if(!fs.existsSync(full)||!fs.statSync(full).isFile())continue;hits.push(...findings(fs.readFileSync(full).toString('utf8'),name))}
  return hits;
}
function auditArtifact(directory){
  const hits=[];
  if(!fs.existsSync(directory))return hits;
  function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,item.name);if(item.isDirectory())walk(full);else hits.push(...findings(fs.readFileSync(full).toString('utf8'),path.relative(root,full).replaceAll('\\','/')))}}
  walk(directory);return hits;
}
function auditHistory(){
  const hits=[],revisions=cp.execFileSync('git',['rev-list','--all'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  const query='Users.*Lenovo|feishu[.]cn|larksuite[.]com|larkoffice[.]com|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY';
  for(const revision of revisions){const result=cp.spawnSync('git',['grep','-I','-n','-E',query,revision,'--'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});if(result.status>1)throw new Error('History audit failed');for(const line of result.stdout.trim().split('\n').filter(Boolean)){const location=/^[a-f\d]+:(.*?):(\d+):/.exec(line);if(location&&findings(line,'').length)hits.push({revision:revision.slice(0,12),file:location[1],line:Number(location[2]),kinds:findings(line,'').map(x=>x.kind)})}}
  return hits;
}
if(require.main===module){const hits=[...auditCurrent(),...auditArtifact(path.join(root,'frontend/dist')),...auditArtifact(path.join(root,'frontend/dist-embed'))],report={scope:'tracked/non-ignored files and existing public/embed artifacts, including private configuration checks',findings:hits};if(process.argv.includes('--history'))report.history=auditHistory();console.log(JSON.stringify(report,null,2));if(hits.length)process.exitCode=1}
module.exports={findings,auditCurrent,auditArtifact};
