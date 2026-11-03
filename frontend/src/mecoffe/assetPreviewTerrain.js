import { createCourt, createTrack400, disposeSportsObject, Campus3DSports } from './Campus3DSports.js'
import * as THREE from 'three'
import { createWaterBasin, createBridge } from './Campus3DWater.js'
import { buildSpatialEnvironment } from './campus3dSpatial.js'
import { previewParams } from './assetPreviewModel.js'

export function terrainAssetPreview(prototype,variant) {
  const p=previewParams(prototype,variant)
  let object,caption
  if(p.generator==='campus-sports'){
    const model=new Campus3DSports({scene:new THREE.Scene(),landcovers:[p.feature]}).init();object=model.group;caption='校内 OSM 场地区域 · 与沙盘共用场地模型'
  }else if(p.generator==='campus-water'){
    object=createWaterBasin(buildSpatialEnvironment({roads:[],buildings:[]},[p.feature]).waters[0]);caption='校内永怀湖轮廓 · 起伏湖底与岸坡'
  }else if(p.generator==='campus-bridge'){
    object=createBridge(buildSpatialEnvironment({roads:[p.road],buildings:[]},[p.water]).bridges[0]);caption='校内跨水通行面 · 与沙盘共用桥梁模型'
  }else if(p.generator==='sports-track400'){object=createTrack400(p);caption='实体跑道 · 分道标线 · 足球场与球门'}
  else if(p.generator.startsWith('sports-')){object=createCourt(p.generator.slice(7),p);caption='实体球场 · 标线 · 篮架或球网'}
  else if(p.generator==='bridge'){
    const length=p.length_m||44
    object=createBridge({start:{x:0,y:-length/2},end:{x:0,y:length/2},width:p.width_m||10,approach:p.approach_m||10,deckHeight:p.deck_height_m||1.05,roadHeight:.14,illustrative:true})
    caption='有厚度桥面 · 两岸坡道 · 护栏与桥墩'
  } else {
    const feature={osm_id:'preview-water',name:'水深示意',kind:'water',polygon:[[-20,-35],[10,-35],[24,-8],[15,28],[-17,35],[-25,0],[-20,-35]]}
    const spatial=buildSpatialEnvironment({roads:[],buildings:[]},[feature],{maxDepth:p.max_depth_m||2.8,surface:p.surface_height_m??-.55})
    object=createWaterBasin(spatial.waters[0]);caption='下凹岸坡 · 起伏湖底 · 半透明水面（非实测深度）'
  }
  return {object,dispose:()=>disposeSportsObject(object),caption}
}
