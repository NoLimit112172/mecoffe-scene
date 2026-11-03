// Read-only audit. Reports locations/categories, never potential secret values.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const patterns={
  internal:/https?:\/\/[^\s<>\)\]"']*(?:feishu\.cn|larksuite\.com|larkoffice\.com)[^\s<>\)\]"']*/ig,
  localPath:/[a-z]:[\\/]+Users[\\/]+Lenovo[^\s<>"'`]*/ig,
  credential:/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g,
};
function findings(text,file){const hits=[];for(const [kind,expression]of Object.entries(patterns)){expression.lastIndex=0;for(const match of text.matchAll(expression))hits.push({file,kind,line:text.slice(0,match.index).split('\n').length})}return hits}
function auditCurrent(){
  const names=cp.execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),hits=[];
  for(const name of new Set(names)){const full=path.join(root,name);if(!fs.statSync(full).isFile())continue;hits.push(...findings(fs.readFileSync(full).toString('utf8'),name))}
  return hits;
}
function auditHistory(){
  const hits=[],revisions=cp.execFileSync('git',['rev-list','--all'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  const query='Users.*Lenovo|feishu[.]cn|larksuite[.]com|larkoffice[.]com|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY';
  for(const revision of revisions){const result=cp.spawnSync('git',['grep','-I','-n','-E',query,revision,'--'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});if(result.status>1)throw new Error('History audit failed');for(const line of result.stdout.trim().split('\n').filter(Boolean)){const location=/^[a-f\d]+:(.*?):(\d+):/.exec(line);if(location&&findings(line,'').length)hits.push({revision:revision.slice(0,12),file:location[1],line:Number(location[2]),kinds:findings(line,'').map(x=>x.kind)})}}
  return hits;
}
if(require.main===module){const hits=auditCurrent(),report={scope:'current tracked and non-ignored files, including binary byte strings',findings:hits};if(process.argv.includes('--history'))report.history=auditHistory();console.log(JSON.stringify(report,null,2));if(hits.length)process.exitCode=1}
module.exports={findings,auditCurrent};
