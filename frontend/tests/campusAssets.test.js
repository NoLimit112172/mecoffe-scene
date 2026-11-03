import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {profileGender,campusAssignments,campusModelForPerson} from '../src/mecoffe/campusCharacterModel.js'
import {buildSpatialEnvironment,campusPointClear,campusSegmentClear} from '../src/mecoffe/campus3dSpatial.js'
import {createDisplayCampus} from '../src/mecoffe/campus3dDisplay.js'
import {ASSET_CATALOG,getPrototype} from '../src/mecoffe/assetCatalog.js'
import {vegetationParts} from '../src/mecoffe/Campus3DVegetation.js'
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js'
import {RealCharacterBatch,canonicalizeValidSkeleton} from '../src/mecoffe/Campus3DRealCharacters.js'
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'))
const people=json('../public/mecoffe/latest-network.json').people,valid=json('../public/mecoffe/assets3d/valid/manifest.json')

test('every actual campus person uses the recorded gender and only publisher-labelled Asian civilian student/faculty presets',()=>{
  const before=JSON.stringify(people),assigned=campusAssignments(people,valid.models)
  assert.deepEqual(assigned,campusAssignments([...people].reverse(),[...valid.models].reverse()))
  for(const p of people){const m=valid.models.find(m=>m.id===assigned.get(p.id));if(profileGender(p))assert.equal(m.gender,profileGender(p));assert.equal(m.ethnicity,'Asian');assert.equal(m.age_group,'adult');assert.equal(m.category,p.role==='teacher_consumer'?'business':'casual');assert.equal(getPrototype('character.campus.'+p.id).params.model_id,m.id)}
  assert.equal(JSON.stringify(people),before)
  assert.equal(profileGender({name:'任意姓名',role:'teacher_consumer'}),null)
  assert.throws(()=>campusModelForPerson({id:'female',gender:'f',role:'teacher_consumer'},valid.models.filter(m=>m.gender==='male')),/缺少匹配/)
})

test('the discarded empty parcel cannot host people, and concave campus edges block continuous shortcuts',()=>{
  const campus=json('../../scene/campus3d.json'),mapping=json('../../scene/campus3d_mapping.json'),source=JSON.stringify(campus),display=createDisplayCampus(campus,{mapping})
  const spatial=buildSpatialEnvironment(display.campus,[])
  assert(!campusPointClear({x:display.bounds.maxX+20,y:display.bounds.maxY+20},spatial.boundary,6))
  const boundary={areas:[{outer:[[0,0],[100,0],[100,30],[30,30],[30,100],[0,100],[0,0]],holes:[]}]}
  assert(campusPointClear({x:15,y:70},boundary,6));assert(!campusPointClear({x:3,y:50},boundary,6))
  assert(!campusSegmentClear({x:15,y:70},{x:70,y:15},boundary,6),'two inside endpoints may not cut through an outside recess')
  assert(campusSegmentClear({x:15,y:70},{x:15,y:15},boundary,6))
  assert.equal(JSON.stringify(campus),source)
})

test('every building, person, sports field, lake and cross-water surface has its own campus inventory card',()=>{
  const campus=json('../../scene/campus3d.json'),features=json('../public/mecoffe/campus3d_landcover.json').features
  const instances=ASSET_CATALOG.prototypes.filter(p=>p.scene_instance)
  assert.equal(instances.filter(p=>p.scene_instance.kind==='building').length,campus.buildings.length)
  assert.equal(instances.filter(p=>p.scene_instance.kind==='person').length,people.length)
  for(const b of campus.buildings)assert.deepEqual(getPrototype('building.campus.'+b.osm_id.replace('/','-')).params.building,b)
  for(const f of features.filter(f=>['water','pitch'].includes(f.kind)))assert.deepEqual(getPrototype('landcover.campus.'+f.osm_id.replace('/','-')).params.feature,f)
  const display=createDisplayCampus(campus,{landcovers:features}),s=buildSpatialEnvironment(display.campus,display.landcovers)
  assert.equal(instances.filter(p=>p.scene_instance.kind==='bridge').length,s.bridges.length)
})

test('imported vegetation has genuine volume, a pinned CC0 archive and exact per-file hashes',()=>{
  const m=json('../public/mecoffe/assets3d/kenney/manifest.json');assert.equal(m.license,'CC0-1.0');assert.equal(m.models.length,8)
  assert.match(readFileSync(new URL('../public/mecoffe/assets3d/kenney/License.txt',import.meta.url),'utf8'),/Creative Commons Zero/)
  for(const item of m.models){const b=readFileSync(new URL('../public/mecoffe/assets3d/kenney/'+item.file,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),item.sha256);assert.equal(b.toString('ascii',0,4),'glTF');const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());assert(gltf.meshes.length>0);assert(!gltf.images?.length,'original mesh assets, not tree image planes')}
  const group=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.3,.5,3,8),new THREE.MeshStandardMaterial());trunk.position.set(5,1.5,8);group.add(trunk)
  const parts=vegetationParts(group,10),box=parts[0].geometry.boundingBox||(parts[0].geometry.computeBoundingBox(),parts[0].geometry.boundingBox)
  assert(Math.abs(box.max.y-10)<1e-5);assert(box.max.z-box.min.z>1);assert(box.max.x-box.min.x>1)
})

test('campus avatar files match their upstream Git blobs and carry the publisher MIT notice',()=>{
  assert.equal(valid.license,'MIT');assert.equal(valid.models.length,9)
  assert.match(readFileSync(new URL('../public/mecoffe/assets3d/valid/LICENSE',import.meta.url),'utf8'),/Tiffany Do/)
  for(const m of valid.models){const b=readFileSync(new URL('../public/mecoffe/assets3d/valid/'+m.fbx,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),m.sha256);assert.equal(createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'),m.source_git_blob)}
})

test('real female and male VALID skeletons have one canonical joint chain, visible relaxed arms and moving walking limbs',async()=>{
  const previousWindow=globalThis.window;globalThis.window={URL}
  class Recorder extends THREE.Loader {load(){return new THREE.Texture()}}
  try{for(const id of valid.models.map(m=>m.id)){
    const manager=new THREE.LoadingManager();manager.addHandler(/.*/,new Recorder(manager))
    const b=readFileSync(new URL('../public/mecoffe/assets3d/valid/'+id+'.fbx',import.meta.url)),source=new FBXLoader(manager).parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')
    canonicalizeValidSkeleton(source)
    const person={id:'test-'+id,gender:id.includes('_F_')?'f':'m'},entry={person,figure:new THREE.Group(),presentationVisible:true}
    const scene=new THREE.Scene(),batch=new RealCharacterBatch({scene,entries:new Map([[person.id,entry]]),modelId:id})
    await batch.init({assets:{models:new Map([[id,source]])},manifest:valid})
    const a=batch.actors[0];assert([...a.rig.boneSets.values()].every(set=>set.length===1))
    const upper=a.rig.bones.get('Bip01_L_UpperArm'),hand=a.rig.bones.get('Bip01_L_Hand'),up=a.root.worldToLocal(upper.getWorldPosition(new THREE.Vector3())),hp=a.root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()))
    assert(hp.y<up.y-1,'hands are below shoulders');assert(Math.abs(hp.x)>Math.abs(up.x),'relaxed arms must point outwards instead of collapsing into the torso')
    const leg=a.rig.bones.get('Bip01_L_Thigh'),rest=leg.quaternion.clone();entry.walker={phase:'outbound',moving:true};entry.presentationWalking=true;batch.update(.18);assert(!leg.quaternion.equals(rest));batch.dispose()
  }}finally{globalThis.window=previousWindow}
})
