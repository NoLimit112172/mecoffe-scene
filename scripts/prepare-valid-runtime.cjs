// Offline conversion of the already licensed VALID FBX files. No downloads.
// Browser plugin not available; use the existing Playwright/Chrome installation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),folder=path.join(root,'frontend/public/mecoffe/assets3d/valid'),file=path.join(folder,'manifest.json');
(async()=>{
  const manifest=JSON.parse(fs.readFileSync(file)),browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const model of manifest.models){
      const page=await browser.newPage();await page.goto('http://127.0.0.1:5180/');
      const encoded=await page.evaluate(async record=>{
        const {loadCharacterSource}=await import('/src/mecoffe/Campus3DRealCharacters.js');
        const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
        const source=await loadCharacterSource({...record,glb:undefined,runtime_base:'/mecoffe/assets3d/valid/'});
        // This replay animates limbs only. Neutral face geometry is unchanged;
        // unused facial blendshapes otherwise add ~18MB to every GLB.
        source.traverse(o=>{if(o.isMesh){o.geometry.morphAttributes={};o.morphTargetInfluences=undefined;o.morphTargetDictionary=undefined}});
        const buffer=await new GLTFExporter().parseAsync(source,{binary:true,onlyVisible:false,maxTextureSize:1024});
        const bytes=new Uint8Array(buffer);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
      },model);
      const bytes=Buffer.from(encoded,'base64'),name=model.id+'.glb';fs.writeFileSync(path.join(folder,name),bytes);
      Object.assign(model,{glb:name,glb_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),glb_bytes:bytes.length});
      console.log(model.id,bytes.length);await page.close();
    }
    manifest.runtime_note='GLB derivatives of archived MIT-licensed FBX presets; outdoor body/eyes and canonical skeleton, max 1024px textures, unused facial blendshapes removed (neutral face retained). Original FBX and provenance retained.';
    fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
