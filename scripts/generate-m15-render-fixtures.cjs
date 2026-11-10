// Local fixtures only. Existing synthetic M14 pages keep the same evidence semantics.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
cp.execFileSync('python',['scripts/lib/m15-render-fixtures.py'],{cwd:root,stdio:'inherit',windowsHide:true});
const {liveFixture}=require('./lib/live-fixture.cjs'),f=liveFixture();
for(const name of ['input-a','input-b','input-none']){
  const target=path.join(root,'frontend/tests/fixtures/scene-render',name+'.json'),value=JSON.parse(fs.readFileSync(target,'utf8'));
  value.live={bootstrap:{...f.bootstrap,roles:{...f.roles,synthetic:true}},pages:[f.page('pending'),f.page('confirmed'),f.page('second')]};
  fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n');
}
