// A single WebGL context renders all visible gallery cards using scissors.
// Each card owns a real mesh/scene and can rotate independently.
import * as THREE from 'three'
import { CharacterBatch } from './Campus3DCharacters.js'
import { PixelCharacterBatch } from './Campus3DPixelCharacters.js'
import { previewParams, previewViewport } from './assetPreviewModel.js'
import { createYuLanRoof } from './YuLanRoofGeometry.js'
import { TERRAIN_LEVELS as TERRAIN } from './campus3dTerrain.js'

const factories = new Map()

/** A generator can register real M3 models without replacing the gallery UI. */
export function registerPreviewFactory(key, factory) {
  if (typeof key !== 'string' || !key || typeof factory !== 'function') throw new Error('预览生成器需要有效名称与函数')
  factories.set(key, factory)
  return () => { if (factories.get(key) === factory) factories.delete(key) }
}

export function disposePreviewObject(object) {
  const geometry = new Set(), materials = new Set(), textures = new Set()
  object?.traverse(child => {
    if (child.geometry) geometry.add(child.geometry)
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material) continue
      materials.add(material)
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
    }
  })
  for (const value of geometry) value.dispose()
  for (const value of textures) value.dispose()
  for (const value of materials) value.dispose()
}

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra })
function box(group, x, y, z, color, px = 0, py = y / 2, pz = 0) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), material(color))
  object.position.set(px, py, pz)
  group.add(object)
  return object
}
function cylinder(group, top, bottom, height, color, y, segments = 8) {
  const object = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material(color))
  object.position.y = y
  group.add(object)
  return object
}
function shapeMesh(group, points, color, height = .02) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const object = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(color, { side: THREE.DoubleSide }))
  object.rotation.x = -Math.PI / 2
  object.position.y = height
  group.add(object)
  return object
}
function windowTexture(p) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  context.fillStyle = p.wall || p.color || '#7c9cab'
  context.fillRect(0, 0, 128, 128)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    context.fillStyle = '#eee6d1'; context.fillRect(col * 32 + 7, row * 32 + 6, 20, 20)
    context.fillStyle = p.glass || '#345f76'; context.fillRect(col * 32 + 9, row * 32 + 8, 16, 16)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function buildingPreview(prototype, p) {
  const group = new THREE.Group()
  const subtype = `${prototype.id} ${prototype.subtype}`
  if (p.generator === 'foundation') {
    const width=Number(p.width_m)||14,depth=Number(p.depth_m)||10,outset=Number(p.outset_m)||.75
    const footing=box(group,width+outset*2,TERRAIN.buildingBase-TERRAIN.campusRoad,depth+outset*2,p.color||'#c6bba2',0,(TERRAIN.buildingBase+TERRAIN.campusRoad)/2)
    footing.name='foundation-solid'
    const context=box(group,width,3.2,depth,'#a8b8bc',0,TERRAIN.buildingBase+1.6)
    context.name='foundation-building-context';context.userData.illustrative=true
    box(group,width+5,.24,depth+5,'#90aa78',0,TERRAIN.campusRoad-.12).name='foundation-ground-context'
  } else if (p.generator === 'roof-flat' || p.generator === 'roof-pitched') {
    const pitched=p.generator === 'roof-pitched'
    const width=Number(p.width_m)||(pitched?20:40),depth=Number(p.depth_m)||(pitched?12:28)
    const footprint=p.polygon || [[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2],[-width/2,-depth/2]]
    const roof=createYuLanRoof({osm_id:`${prototype.id}:${p.seed ?? 2026}`,polygon:footprint,height_m:.15},
      {type:pitched?27:22,model:Number(p.model)||1,seed:p.seed ?? 2026})
    if(p.tile_color)roof.getObjectByName('pitched-roof-solid')?.material.color.set(p.tile_color)
    group.add(roof)
  } else if (/component.windows/.test(subtype)) {
    const panel=box(group,5.4,3.2,.22,p.wall || '#7c9cab')
    const columns=Math.max(1,Math.min(8,Number(p.columns)||8)),rows=Math.max(1,Math.min(4,Number(p.rows)||4))
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      const x=(col-(columns-1)/2)*4.8/columns,y=.35+row*2.6/rows
      box(group,.43,.46,.04,'#e4dfca',x,y,.14)
      box(group,.34,.37,.04,(row+col)%3===0?'#eac98a':'#345f76',x,y,.17)
    }
    panel.userData.component='window-panel'
  } else if (/component.roof/.test(subtype)) {
    box(group,5,.18,3.5,p.color || '#e4d3bb',0,.1)
    for(const z of [-1.7,1.7])box(group,5,.45,.14,p.color || '#c3b897',0,.4,z)
    for(const x of [-2.43,2.43])box(group,.14,.45,3.5,p.color || '#c3b897',x,.4)
  } else if (/component.edges/.test(subtype)) {
    const solid=box(group,4,2.8,2.6,'#bfcfca')
    solid.material.transparent=true;solid.material.opacity=.3
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(solid.geometry),new THREE.LineBasicMaterial({color:p.color || '#934f40'})))
    group.children.at(-1).position.copy(solid.position)
  } else if (/sign|awning|shopfront/.test(subtype)) {
    box(group, 5, 4, 1.5, p.wall || '#e3bd71')
    box(group, 3.8, .75, .22, p.color || p.colors?.[0] || p.accent || '#168b7a', 0, 3.1, .87)
    const canopy = box(group, 4.4, .25, 1.7, p.accent || p.colors?.[0] || '#e17943', 0, 2.45, 1.35)
    canopy.rotation.x = .15
    for(let x=-1.8;x<2;x+=.55) {const stripe=box(group,.16,.015,1.68,p.stripe_color || '#fff2d3',x,2.59,1.35);stripe.rotation.x=.15}
    box(group, 1.1, 1.8, .05, '#2e5265', 0, .9, .8)
  } else {
    const levels = Math.max(1, Math.min(8, Number(p.levels || p.default_levels) || 4))
    const height = levels * .85
    const polygon = [[-2.6,-1.65],[2.6,-1.65],[2.6,.3],[.7,.3],[.7,1.65],[-2.6,1.65]]
    const texture = windowTexture(p)
    const shape = new THREE.Shape(polygon.map(point => new THREE.Vector2(...point)))
    const facade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {depth:height,bevelEnabled:false}),
      [material(p.roof || '#e4d3bb'), material(texture ? '#ffffff' : p.wall || p.color || '#7c9cab', {map:texture})])
    facade.rotation.x = -Math.PI / 2
    facade.position.y = .1
    group.add(facade)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(facade.geometry), new THREE.LineBasicMaterial({color:p.accent || '#567277'}))
    facade.add(edges)
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i], b=polygon[(i+1)%polygon.length]
      const length=Math.hypot(b[0]-a[0],b[1]-a[1])
      const rim=box(group,length,.16,.12,p.accent || '#617a75',(a[0]+b[0])/2,height+.17,-(a[1]+b[1])/2)
      rim.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0])
    }
  }
  return group
}

/** Actual procedural geometry. Atlas-derived M3 prototypes use registered factories. */
export function createProceduralPreview(prototype, variant) {
  const p = previewParams(prototype,variant)
  const group = new THREE.Group()
  group.name = `asset-preview-${prototype.id}`
  const subtype=`${prototype.id} ${prototype.subtype}`
  switch(prototype.category) {
    case 'building': group.add(buildingPreview(prototype,p)); break
    case 'road': {
      const width = Math.max(1.5,Math.min(5,Number(p.width || p.width_m || p.lanes * 1.2) || (/primary|secondary|trunk/.test(subtype)?4.2:2.6)))
      box(group,width+1,.10,7,'#c9cdbf')
      box(group,width+.15,.14,7,'#e0e2d5')
      box(group,width,.17,7,p.asphalt || '#444c52')
      for(const side of [-1,1]) box(group,.04,.025,7,'#edf0e5',side*(width/2-.15),.19)
      const lanes=Math.max(1,Math.min(4,Number(p.lanes)||2))
      for(let lane=1;lane<lanes;lane++) for(let z=-3;z<3;z+=1.2) box(group,.055,.025,.6,lane===Math.floor(lanes/2)?'#e9c45a':'#ebede5',-width/2+width*lane/lanes,.20,z)
      break
    }
    case 'landcover': {
      if(p.generator==='layered-base') {
        // A local section uses the actual campus elevation constants. It is a
        // genuine stacked mesh, not a flattened texture or a 135 m mini-campus.
        const layer=(name,bottom,top,color,x=0,width=40,depth=28)=>{
          const mesh=box(group,width,top-bottom,depth,color,x,(bottom+top)/2)
          mesh.name=name;mesh.userData.terrainHeights={bottom,top};return mesh
        }
        layer('base-stone',TERRAIN.baseBottom,TERRAIN.stoneTop,'#4c6066')
        layer('base-earth',TERRAIN.stoneTop,TERRAIN.earthTop,'#ab9274')
        layer('base-surface',TERRAIN.earthTop,TERRAIN.outsideTop,'#c1c0ae')
        layer('campus-platform',TERRAIN.outsideTop,TERRAIN.campusPlinth,'#b8b3a0',-10,20)
        for(const x of [-16.8,-3.2])layer(`campus-turf-${x}`,TERRAIN.campusPlinth,TERRAIN.campusGrass,p.color||'#93af74',x,6.4)
        layer('campus-road',TERRAIN.campusPlinth,TERRAIN.campusRoad,'#65716e',-10,5.76)
        for(const x of [-13.24,-6.76])layer(`campus-curb-${x}`,TERRAIN.campusPlinth,TERRAIN.campusCurb,'#c6c8b6',x,.72)
        layer('external-road',TERRAIN.externalRoadBottom,TERRAIN.externalRoad,'#444c52',9,7)
        for(const x of [4.3,13.7])layer(`external-sidewalk-${x}`,TERRAIN.externalRoadBottom,TERRAIN.externalSidewalk,'#b9c0b9',x,2)
        for(const x of [5.325,12.675])layer(`external-curb-${x}`,TERRAIN.externalRoadBottom,TERRAIN.externalCurb,'#e0e2d5',x,.35)
        for(let z=-12;z<13;z+=4)box(group,.18,.025,2,'#edcf70',9,TERRAIN.externalRoad+.025,z)
        group.userData.illustrative=true
        break
      }
      const water=/water|lake/.test(subtype), pitch=/pitch|sport/.test(subtype), parking=/parking/.test(subtype)
      shapeMesh(group,[[-3,-2],[2.7,-2],[3,1],[.8,2],[-2.6,1.8]],p.color || (water?'#5b9faf':parking?'#777d79':'#77a686'))
      if(water) for(let z=-1.4;z<1.5;z+=.5) box(group,2.3,.01,.035,'#a1d5d0',Math.sin(z)*.3,.04,z)
      if(pitch||parking) for(const x of [-2.1,0,2.1]) box(group,.035,.02,3.3,'#ecefdb',x,.05)
      if(pitch) for(const z of [-1.65,1.65]) box(group,4.25,.02,.035,'#ecefdb',0,.05,z)
      break
    }
    case 'vegetation': {
      cylinder(group,.18,.3,2.1,p.trunk || '#77594a',1.05,5)
      for(const [radius,y,color] of [[1.6,2.7,p.crown || p.color || '#458765'],[1.3,3.8,p.top || '#80aa74']]) {
        const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(radius,0),material(color,{flatShading:true}))
        crown.position.y=y;group.add(crown)
      }
      break
    }
    case 'street_furniture': {
      if(/bench/.test(subtype)) {
        for(const x of [-1.4,1.4]) {box(group,.18,1.1,.18,'#455155',x,.55,-.5);box(group,.18,1.1,.18,'#455155',x,.55,.5)}
        for(const z of [-.45,-.15,.15,.45]) box(group,3.4,.12,.23,p.color || '#a57b50',0,1.05,z)
        for(const y of [1.5,1.85]) box(group,3.4,.22,.12,p.color || '#a57b50',0,y,-.52)
      } else if(/flower|planter/.test(subtype)) {
        cylinder(group,1.5,1.25,.7,p.color || '#a57b50',.35)
        for(let i=0;i<9;i++) { const flower=new THREE.Mesh(new THREE.IcosahedronGeometry(.33,0),material(['#e4bd67','#d590a0','#93ad73'][i%3]));flower.position.set(Math.sin(i*2.4),.9,Math.cos(i*2.4));group.add(flower) }
      } else {
        cylinder(group,.07,.11,4,'#39494d',2,6)
        const bulb=new THREE.Mesh(new THREE.SphereGeometry(.35,8,6),new THREE.MeshBasicMaterial({color:p.color || '#ffe0a0'}))
        bulb.position.y=4.2;group.add(bulb)
        box(group,1.1,.12,.6,'#455155',.3,4.55)
      }
      break
    }
    case 'effect': {
      const color=p.color || '#54b5ed'
      const points=Array.from({length:25},(_,i)=>{const t=i/24;return new THREE.Vector3(-2.5+t*5,Math.sin(t*Math.PI)*2.2+.4,0)})
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color})))
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.25,.07,5,32),new THREE.MeshBasicMaterial({color}))
      ring.rotation.x=-Math.PI/2;ring.position.y=.1;group.add(ring)
      const bubble=box(group,1.6,.9,.2,color,0,3)
      for(let x=-.45;x<.6;x+=.45) {const dot=new THREE.Mesh(new THREE.SphereGeometry(.1,6,4),material('#fff7df'));dot.position.set(x,3,.15);group.add(dot)}
      bubble.userData.effectPreview=true
      break
    }
    default: box(group,2,2,2,'#7c9cab')
  }
  group.scale.x *= Number(p.preview_scale) || 1
  return group
}

export async function createAssetPreview(prototype, variant, {signal} = {}) {
  if(signal?.aborted)throw Object.assign(new Error('Preview request cancelled'),{name:'AbortError'})
  const factory=factories.get(prototype.params?.generator)||factories.get(prototype.generator)||factories.get(prototype.id)
  if(factory) return factory(prototype,variant,{signal})
  if(prototype.category==='character') {
    const p=previewParams(prototype,variant)
    const previewScene=new THREE.Scene()
    const entry={person:{id:p.person_id || `preview-${typeof variant==='string'?variant:variant?.id || 'default'}`,role:p.role || 'undergraduate_consumer',gender:p.gender || 'm'},figure:new THREE.Group(),presentationVisible:true,walker:{phase:'outbound'},hasCoffee:false}
    const entries=new Map([[entry.person.id,entry]])
    const pixel=/pixel|billboard/.test(`${prototype.id} ${prototype.subtype}`)
    const batch=pixel?new PixelCharacterBatch({scene:previewScene,entries}):new CharacterBatch({scene:previewScene,entries})
    if(pixel) await batch.init()
    const object=new THREE.Group();object.add(entry.figure,batch.group)
    batch.update(0)
    return {object,bounds:new THREE.Box3(new THREE.Vector3(-2.3,0,-1.3),new THREE.Vector3(2.3,8.5,1.3)),
      setPreviewTransform:({scale,center})=>{entry.figure.scale.setScalar(scale);entry.figure.position.copy(center).multiplyScalar(-scale)},
      update:(seconds,camera)=>batch.update(seconds,camera),dispose:()=>batch.dispose(),caption:pixel?'YuLan 原图集 · 三帧行走':'现有立体角色生成器'}
  }
  const object=createProceduralPreview(prototype,variant)
  const roof=String(prototype.params?.generator).startsWith('roof-')
  const terrainCaption=prototype.params?.generator==='layered-base'?'程序分层底座 · 实体侧面与道路高差':prototype.params?.generator==='foundation'?'程序建筑基座 · 实体基座与示例楼体':null
  return {object,dispose:()=>disposePreviewObject(object),caption:terrainCaption||(roof?'程序三维屋顶 · 实体屋面与构件':prototype.source?.type==='yulan'?'原型体块预览；图集三维生成器尚未接入':'参数化三维预览 · 示例轮廓')}
}

export class AssetPreviewRenderer {
  constructor({host,onCaption,onError}={}) {
    this.host=host;this.onCaption=onCaption;this.onError=onError;this.items=[];this.views=new Map();this.pending=new Map();this.failed=new Set();this.disposed=false
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true})
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5))
    this.renderer.outputColorSpace=THREE.SRGBColorSpace
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping
    this.renderer.setClearColor(0,0)
    this.renderer.autoClear=false
    const canvas=this.renderer.domElement
    canvas.setAttribute('aria-hidden','true')
    Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'1',display:'block'})
    host.appendChild(canvas)
    this.started=performance.now()
    this.animate=this.animate.bind(this)
    this.frame=requestAnimationFrame(this.animate)
  }

  setItems(items) {
    this.items=items
    const keys=new Set(items.map(item=>this.key(item)))
    for(const [key,controller] of this.pending) if(!keys.has(key)) {controller.abort();this.pending.delete(key)}
    for(const [key,view] of this.views) if(!keys.has(key)) {this.remove(view);this.views.delete(key)}
  }

  key(item) {return `${item.prototype.id}::${typeof item.variant==='string'?item.variant:item.variant?.id || 'default'}`}

  async prepare(item) {
    const key=this.key(item)
    if(this.disposed||this.pending.has(key)||this.views.has(key)||this.failed.has(key)) return
    const controller=new AbortController()
    this.pending.set(key,controller)
    try {
      const model=await createAssetPreview(item.prototype,item.variant,{signal:controller.signal})
      const current=this.items.find(candidate=>this.key(candidate)===key)
      if(this.disposed||controller.signal.aborted||this.pending.get(key)!==controller||!current?.element?.isConnected) {model.dispose?.();return}
      item=current
      const scene=new THREE.Scene()
      const normalized=new THREE.Group();normalized.add(model.object)
      model.object.updateWorldMatrix(true,true)
      const bounds=model.bounds || new THREE.Box3().setFromObject(model.object)
      const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3())
      const scale=3.5/Math.max(size.x,size.y,size.z,.1)
      if(model.setPreviewTransform) model.setPreviewTransform({scale,center})
      else {normalized.scale.setScalar(scale);normalized.position.copy(center).multiplyScalar(-scale)}
      scene.add(normalized,new THREE.HemisphereLight('#e7f4ff','#b2b99e',2.5))
      const sun=new THREE.DirectionalLight('#fff0d3',3.1);sun.position.set(-3,6,5);scene.add(sun)
      const floor=new THREE.Mesh(new THREE.CircleGeometry(2.7,40),material('#e2e7dc',{side:THREE.DoubleSide}))
      floor.rotation.x=-Math.PI/2;floor.position.y=-1.8;scene.add(floor)
      const camera=new THREE.PerspectiveCamera(36,1,.01,100)
      const view={item,key,model,scene,normalized,floor,camera,yaw:.65,pitch:.38,drag:null,handlers:{}}
      view.handlers.pointerdown=event=>{view.drag={x:event.clientX,y:event.clientY,yaw:view.yaw,pitch:view.pitch};item.element.setPointerCapture?.(event.pointerId)}
      view.handlers.pointermove=event=>{if(!view.drag)return;view.yaw=view.drag.yaw+(event.clientX-view.drag.x)*.012;view.pitch=Math.max(-.1,Math.min(1.15,view.drag.pitch+(event.clientY-view.drag.y)*.008))}
      view.handlers.pointerup=()=>{view.drag=null}
      view.handlers.pointercancel=view.handlers.pointerup
      for(const [type,handler] of Object.entries(view.handlers)) item.element.addEventListener(type,handler)
      this.views.set(key,view)
      this.onCaption?.(item.prototype.id,model.caption || '三维原型 · 拖动旋转')
    } catch(error) {
      // A replaced page/variant must not overwrite the current card's caption,
      // poison its retry state, or delete a newer request for the same key.
      if(!this.disposed&&!controller.signal.aborted&&this.pending.get(key)===controller) {
        this.failed.add(key);this.onError?.(item.prototype.id,error.message || String(error))
      }
    }
    finally {if(this.pending.get(key)===controller)this.pending.delete(key)}
  }

  animate(now) {
    if(this.disposed)return
    const width=window.innerWidth,height=window.innerHeight
    if(this.width!==width||this.height!==height) {this.renderer.setSize(width,height,false);this.width=width;this.height=height}
    this.renderer.setScissorTest(false);this.renderer.clear(true,true,true);this.renderer.setScissorTest(true)
    for(const item of this.items) {
      if(!item.element?.isConnected)continue
      const viewport=previewViewport(item.element.getBoundingClientRect(),{width,height})
      if(!viewport)continue
      const key=this.key(item),view=this.views.get(key)
      if(!view){void this.prepare(item);continue}
      const camera=view.camera
      camera.aspect=viewport.aspect;camera.updateProjectionMatrix()
      camera.position.set(Math.sin(view.yaw)*Math.cos(view.pitch)*8.1,Math.sin(view.pitch)*8.1,Math.cos(view.yaw)*Math.cos(view.pitch)*8.1)
      camera.lookAt(0,0,0);camera.updateMatrixWorld()
      view.model.update?.((now-this.started)/1000,camera)
      const v=viewport.viewport,s=viewport.scissor
      this.renderer.setViewport(v.x,v.y,v.width,v.height)
      this.renderer.setScissor(s.x,s.y,s.width,s.height)
      this.renderer.clear(true,true,true)
      this.renderer.render(view.scene,camera)
    }
    this.frame=requestAnimationFrame(this.animate)
  }

  remove(view) {
    for(const [type,handler] of Object.entries(view.handlers)) view.item.element.removeEventListener(type,handler)
    view.model.dispose?.()
    view.floor.geometry.dispose();view.floor.material.dispose();view.scene.clear()
  }

  dispose() {
    if(this.disposed)return
    this.disposed=true;cancelAnimationFrame(this.frame)
    for(const controller of this.pending.values())controller.abort()
    this.pending.clear()
    for(const view of this.views.values())this.remove(view)
    this.views.clear();this.items=[]
    this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove()
  }
}
