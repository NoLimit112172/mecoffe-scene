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
function privateData(value){
  if(!value||typeof value!=='object')return false;
  if(value.meta?.config_preview===true&&Array.isArray(value.people)&&value.people.length>0)return true;
  const nodes=Array.isArray(value.nodes)&&value.nodes.some(node=>node?.entity_id&&node?.role&&('static_attributes'in node||'dynamic_attributes'in node));
  if(nodes){
    const digest=crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
    if(approvedSnapshots.has(digest))return false;
    const synthetic=/^synthetic(?:-|_|$)/i.test(value.dataset_version||'');
    const names=value.nodes.filter(node=>node.name).every(node=>/^(?:样例人物|合成人物|synthetic\b|sample\b|test\b)/i.test(node.name));
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
