import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { TRACK_DIMENSIONS, SPORTS_DIMENSIONS, sportsFrame, courtLayout, sportsLayouts, sportsExclusions } from '../src/mecoffe/campus3dSportsModel.js'
import { decorationPlacements, pointInRing } from '../src/mecoffe/campus3dEnvironmentModel.js'
import { createCourt, createTrack400, Campus3DSports } from '../src/mecoffe/Campus3DSports.js'
import { getPrototype } from '../src/mecoffe/assetCatalog.js'
import { createAssetPreview } from '../src/mecoffe/AssetPreviewRenderer.js'

test('standard-type track has eight real lanes, a roughly 400m measurement line and a three-dimensional football infield',()=>{
  const track=createTrack400(),box=new THREE.Box3().setFromObject(track.getObjectByName('八道实体跑道')),size=box.getSize(new THREE.Vector3())
  assert.equal(track.userData.lanes,8)
  assert(Math.abs(track.userData.nominal_measurement_lap-400)<.005)
  assert(Math.abs(size.x-92.52)<.01);assert(Math.abs(size.z-176.91)<.01)
  assert(new THREE.Box3().setFromObject(track).max.y>2.4)
  assert.equal(TRACK_DIMENSIONS.innerRadius,getPrototype('landcover.sports.track400').params.inner_radius_m)
})

test('basketball, tennis and badminton models have distinct markings and raised equipment',()=>{
  const heights={basketball:3.5,tennis:1.1,badminton:1.6}
  for(const sport of Object.keys(heights)){
    const court=createCourt(sport),box=new THREE.Box3().setFromObject(court)
    assert(box.max.y>heights[sport])
    assert.equal(court.userData.nominal_dimensions.width,SPORTS_DIMENSIONS[sport].width)
    assert(court.children.some(o=>o.isLineSegments||o.name.includes('backboard'))||sport==='basketball')
  }
})

test('real OSM fields choose reusable models with fitted tiled layouts without editing the source or inventing surveyed counts',()=>{
  const features=JSON.parse(readFileSync(new URL('../public/mecoffe/campus3d_landcover.json',import.meta.url),'utf8')).features,before=JSON.stringify(features)
  const layouts=sportsLayouts(features)
  assert.equal(layouts.filter(row=>row.track).length,1)
  assert(layouts.some(row=>row.sport==='basketball'));assert(layouts.some(row=>row.sport==='tennis'));assert(layouts.some(row=>row.sport==='badminton'))
  for(const row of layouts)if(row.layout){
    const d=SPORTS_DIMENSIONS[row.feature.sport]
    for(const instance of row.layout.instances){
      const width=instance.angle?d.length+2*d.runoff:d.width+2*d.runoff,length=instance.angle?d.width+2*d.runoff:d.length+2*d.runoff
      assert(Math.abs(instance.x)+width/2*instance.scale<=row.frame.width/2+.001)
      assert(Math.abs(instance.y)+length/2*instance.scale<=row.frame.length/2+.001)
    }
    assert.equal(row.layout.illustrative,true)
  }
  const scene=new THREE.Scene(),model=new Campus3DSports({scene,landcovers:features}).init()
  const campus=JSON.parse(readFileSync(new URL('../../scene/campus3d.json',import.meta.url),'utf8'))
  const exclusions=sportsExclusions(features),decorations=decorationPlacements(campus,{landcovers:[...features,...exclusions]})
  assert.equal(exclusions.length,1)
  for(const point of [...decorations.trees,...decorations.lamps,...decorations.benches])assert(!exclusions.some(f=>pointInRing(point,f.polygon)), 'decoration may not appear in the expanded running track')
  assert.equal(model.group.children.length,layouts.length);assert.equal(JSON.stringify(features),before)
  model.dispose();assert.equal(scene.children.length,0)
  assert.throws(()=>courtLayout({width:.1,length:.1},'tennis'))
  assert.throws(()=>sportsFrame([]))
})

test('all four sport prototypes have actual 3D previews and meaningful variants',async()=>{
  for(const sport of ['track400','basketball','tennis','badminton']){
    const prototype=getPrototype(`landcover.sports.${sport}`)
    for(const variant of prototype.variants){const preview=await createAssetPreview(prototype,variant.id);const box=new THREE.Box3().setFromObject(preview.object);assert(box.max.y>1);preview.dispose()}
  }
})
