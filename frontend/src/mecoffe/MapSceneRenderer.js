import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fitCampusView } from './campus3dView.js'
import { prototypeParams, getPrototype } from './assetCatalog.js'

export function isOpenStreetMapSource(source) {
  if(source?.source_type==='caller_geojson')return false
  try {const url=new URL(source?.source_url);return url.protocol==='https:' && url.hostname==='api.openstreetmap.org' && url.pathname==='/api/0.6/map'}
  catch{return false}
}

export function previewMapSummary(campus, assignments) {
  if (campus?.schema_version!=='mecoffe.campus3d.v1' || !Array.isArray(campus.buildings) || !Array.isArray(campus.roads)) throw new Error('地图场景格式无效')
  if (assignments?.schema_version!=='mecoffe.asset-assignments.v1' || assignments.campus_id!==campus.campus_id || !Array.isArray(assignments.assignments)) throw new Error('地图与素材分配不对应')
  if (!campus.source?.sha256 || assignments.geometry_source?.sha256!==campus.source.sha256) throw new Error('地图与素材分配的源 SHA-256 不对应')
  return {buildings:campus.buildings.length,roads:campus.roads.length,assignments:assignments.assignments.length,simulation_data:false}
}

function polygon(ring,holes=[]) {
  const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(...p)))
  for(const hole of holes) shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(...p))))
  return shape
}

export class MapSceneRenderer {
  constructor({host,campus,assignments,onSelect}) {
    this.host=host;this.campus=campus;this.assignments=assignments;this.onSelect=onSelect
    this.summary=previewMapSummary(campus,assignments)
    this.byId=new Map(assignments.assignments.map(a=>[a.feature_id,a]));this.meshes=[]
  }
  init() {
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#eaf0ed')
    this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5))
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping
    this.renderer.domElement.setAttribute('aria-label','通用流水线生成的地图模型，可旋转、缩放和选择楼栋')
    this.host.appendChild(this.renderer.domElement)
    this.camera=new THREE.PerspectiveCamera(42,1,.5,20000)
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.minDistance=12
    this.scene.add(new THREE.HemisphereLight('#e5f1fa','#9b9b7b',2.2))
    const sun=new THREE.DirectionalLight('#fff3df',2.4);sun.position.set(300,700,400);this.scene.add(sun)
    const groundMaterial=new THREE.MeshStandardMaterial({color:'#bfd0b1',roughness:1,side:THREE.DoubleSide})
    for(const part of this.campus.boundary_polygons||[{outer:this.campus.boundary,holes:[]}]) {
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(polygon(part.outer,part.holes)),groundMaterial);mesh.rotation.x=-Math.PI/2;this.scene.add(mesh)
    }
    const roadVertices=[]
    for(const road of this.campus.roads) {
      const params=this.byId.get(road.feature_id||road.osm_id)?.params||{}
      const width=params.width_m||(params.lane_width_m||2.5)*(params.lanes||1)
      for(let i=1;i<road.points.length;i++) {
        const a=road.points[i-1],b=road.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue
        const x=-(b[1]-a[1])/length*width/2,y=(b[0]-a[0])/length*width/2
        const p=[a[0]+x,.15,-a[1]-y],q=[b[0]+x,.15,-b[1]-y],r=[b[0]-x,.15,-b[1]+y],s=[a[0]-x,.15,-a[1]+y]
        roadVertices.push(...p,...q,...r,...p,...r,...s)
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(roadVertices,3));geometry.computeVertexNormals()
    this.scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#818b88',side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1})))
    for(const building of this.campus.buildings) {
      const assignment=this.byId.get(building.osm_id),params=assignment?.params||prototypeParams('building.procedural.other')
      const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(polygon(building.polygon,building.holes),{depth:building.height_m,bevelEnabled:false}),[
        new THREE.MeshStandardMaterial({color:params.roof||'#d8e4e2',roughness:.9}),new THREE.MeshStandardMaterial({color:params.wall||'#7c9cab',roughness:.85}),
      ])
      mesh.rotation.x=-Math.PI/2;mesh.position.y=.2;mesh.userData={building,assignment}
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,30),new THREE.LineBasicMaterial({color:params.accent||'#376578',transparent:true,opacity:.45}));mesh.add(edges)
      this.scene.add(mesh);this.meshes.push(mesh)
    }
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2()
    this.click=event=>{const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hit=this.ray.intersectObjects(this.meshes,false)[0];this.onSelect?.(hit?.object.userData||null)}
    this.renderer.domElement.addEventListener('click',this.click)
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.host);this.resize();this.resetCamera()
    const frame=()=>{if(this.disposed)return;this.controls.update();this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(frame)};frame()
    this.assetReady=this.loadAssignedModels()
    return this
  }
  async loadAssignedModels(){
    const selected=this.meshes.filter(mesh=>mesh.userData.assignment && getPrototype(mesh.userData.assignment.prototype_id).params.generator==='yulan-building')
    if(!selected.length)return
    const {YuLanAssetFactory,disposeYuLanObject}=await import('./YuLanAssetFactory.js')
    if(this.disposed)return
    this.disposeAssigned=disposeYuLanObject;this.assetFactory=new YuLanAssetFactory()
    await this.assetFactory.init()
    if(this.disposed){this.assetFactory.dispose();return}
    this.assignedGroup=new THREE.Group();this.assignedGroup.name='catalog-assigned-map-buildings'
    for(const original of selected){
      const {building,assignment}=original.userData,p={...getPrototype(assignment.prototype_id).params,...assignment.params}
      const object=this.assetFactory.createBuilding(building,{type:p.atlasType,model:p.model,moduleWidth:p.moduleWidth})
      object.position.y=original.position.y;object.userData={building,assignment};this.assignedGroup.add(object);original.visible=false
    }
    this.scene.add(this.assignedGroup)
  }
  resize(){if(this.disposed)return;const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix()}
  resetCamera(){const fit=fitCampusView(this.campus,{aspect:this.camera.aspect,fill:.82});this.controls.target.copy(fit.target);this.camera.position.copy(fit.position);this.controls.update()}
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.frame);this.observer?.disconnect();this.controls?.dispose();if(this.assignedGroup){this.disposeAssigned(this.assignedGroup);this.assignedGroup.removeFromParent()}this.assetFactory?.dispose();const geometries=new Set(),materials=new Set();this.scene?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m)});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.renderer?.domElement.removeEventListener('click',this.click);this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer?.domElement.remove()}
}
