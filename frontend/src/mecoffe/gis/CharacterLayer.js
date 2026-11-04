import * as THREE from 'three'
import {MercatorCoordinate} from 'maplibre-gl'
import {chooseModels} from './model.js'
import {Campus3DEntrances} from '../Campus3DEntrances.js'

/** MapLibre's shared WebGL context; all figure positions originate in WGS84.
 * Models/rigs/appearance are the existing RealCharacterBatch, never new assets.
 */
export class GisCharacterLayer {
  constructor({replay,onStatus,onError}){
    this.id='gis-characters';this.type='custom';this.renderingMode='3d';this.replay=replay;this.onStatus=onStatus;this.onError=onError;this.visible=true;this.readyIds=new Set();this.selectedId=null;this.disposed=false
  }
  onAdd(map,gl){
    this.map=map;this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.entries=new Map()
    const p=this.replay.campus.projection
    this.origin=MercatorCoordinate.fromLngLat([p.origin_lon,p.origin_lat],0);this.units=this.origin.meterInMercatorCoordinateUnits()
    const u=this.units,o=this.origin
    this.localMatrix=new THREE.Matrix4().set(u,0,0,o.x,0,0,u,o.y,0,u,0,0,0,0,0,1)
    this.renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true})
    this.renderer.autoClear=false;this.renderer.outputColorSpace=THREE.SRGBColorSpace
    this.scene.add(new THREE.HemisphereLight(0xfffaf0,0x849080,2.2))
    const light=new THREE.DirectionalLight(0xfff4dd,2.3);light.position.set(50,100,30);this.scene.add(light)
    if(this.replay.index)this.doors=new Campus3DEntrances({scene:this.scene,campus:this.replay.campus,entrances:this.replay.entrances})
    for(const record of this.replay.people.values()){
      const figure=new THREE.Group();this.scene.add(figure)
      this.entries.set(record.id,{person:record.person,figure,record,inView:false,presentationVisible:false,hasCoffee:false})
    }
  }
  async initializeModels(){
    if(this.promise||this.disposed||!this.entries.size)return this.promise
    this.promise=import('../Campus3DRealCharacters.js').then(async({RealCharacterBatch})=>{
      if(this.disposed)return
      this.batch=new RealCharacterBatch({scene:this.scene,entries:this.entries,pool:'campus',prepareActor:root=>this.renderer.compileAsync(root,this.camera,this.scene),onReady:()=>{if(!this.disposed){this.map.triggerRepaint();this.emitStatus()}}})
      await this.batch.init();if(this.disposed){this.batch.dispose();return}
      this.batch.setVisible(this.visible)
      this.map.triggerRepaint()
    }).catch(error=>{if(!this.disposed)this.onError?.(error)})
    return this.promise
  }
  emitStatus(){
    if(!this.batch)return
    const s=this.batch.getStats(),key=`${s.visibleReady}/${s.visibleTotal}/${s.loading}/${s.failed}`
    if(key!==this.lastStatus){this.lastStatus=key;this.onStatus?.(s)}
  }
  setVisible(value){
    this.visible=Boolean(value)
    if(!this.visible){for(const entry of this.entries?.values()||[])entry.presentationVisible=false;this.readyIds.clear()}
    this.batch?.setVisible(this.visible);this.emitStatus()
  }
  render(gl,options){
    this.mapProjection=new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix)
    if(this.disposed||!this.visible||!this.entries.size)return
    const map=this.map,canvas=map.getCanvas(),people=this.replay.personData()
    const visible=chooseModels(people,{zoom:map.getZoom(),project:p=>map.project(p),width:canvas.clientWidth,height:canvas.clientHeight,selectedId:this.selectedId})
    if(visible.size)this.initializeModels()
    this.readyIds.clear()
    for(const entry of this.entries.values()){entry.presentationVisible=false;entry.inView=false;entry.figure.visible=false}
    for(const person of people){
      const entry=this.entries.get(person.id),coordinate=MercatorCoordinate.fromLngLat(person.lngLat,0)
      entry.figure.position.set((coordinate.x-this.origin.x)/this.units,.1,(coordinate.y-this.origin.y)/this.units)
      entry.figure.rotation.y=person.heading;entry.figure.updateMatrixWorld(true)
      entry.presentationVisible=visible.has(person.id);entry.inView=entry.presentationVisible
      entry.figure.visible=entry.presentationVisible;entry.figure.scale.setScalar(Math.max(.02,person.transitionScale));entry.figure.updateMatrixWorld(true)
      entry.walker=person.walker;entry.hasCoffee=person.hasCoffee
      if(entry.presentationVisible&&this.batch?.isReady(person.id))this.readyIds.add(person.id)
    }
    this.batch?.setVisible(visible.size>0)
    this.batch?.update(this.replay.seconds)
    this.camera.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.localMatrix)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.renderer.resetState();this.renderer.render(this.scene,this.camera);this.renderer.resetState()
    this.emitStatus()
  }
  pick(point){
    if(!this.visible||!this.batch||!this.camera)return null
    const canvas=this.map.getCanvas(),x=point.x/canvas.clientWidth*2-1,y=1-point.y/canvas.clientHeight*2
    const a=new THREE.Vector3(x,y,-1).unproject(this.camera),b=new THREE.Vector3(x,y,1).unproject(this.camera)
    const ray=new THREE.Raycaster(a,b.sub(a).normalize())
    return ray.intersectObjects(this.batch.group.children,true).find(hit=>this.readyIds.has(hit.object.userData.person?.id))?.object.userData.person.id||null
  }
  onRemove(){
    this.disposed=true;this.doors?.dispose();this.batch?.dispose();this.renderer?.dispose();this.scene?.clear();this.entries?.clear();this.readyIds.clear()
    // Never forceContextLoss: this context belongs to the map, not this layer.
  }
}
