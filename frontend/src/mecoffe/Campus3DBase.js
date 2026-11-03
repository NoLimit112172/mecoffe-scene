import * as THREE from 'three'
import { TERRAIN_LEVELS as L, campusRoadWidth, offsetTerrainRing, openRing, roadCorridors, subtractTerrainCuts, terrainBaseBounds } from './campus3dTerrain.js'

function shapeOf(outer,holes=[]) {
  const shape=new THREE.Shape(openRing(outer).map(([x,y])=>new THREE.Vector2(x,y)))
  for(const hole of holes)shape.holes.push(new THREE.Path(openRing(hole).map(([x,y])=>new THREE.Vector2(x,y))))
  return shape
}
function planarTriangles(outer,holes=[]) {
  const points=openRing(outer),voids=holes.map(openRing),all=[...points,...voids.flat()]
  return THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(...p)),voids.map(r=>r.map(p=>new THREE.Vector2(...p)))).map(face=>face.map(i=>all[i]))
}
function polygonGeometry(polygons,top,bottom=null) {
  const positions=[],uvs=[]
  const vertex=(p,h)=>{positions.push(p[0],h,-p[1]);uvs.push(p[0],p[1])}
  for(const polygon of polygons) {
    for(let i=1;i<polygon.length-1;i++){vertex(polygon[0],top);vertex(polygon[i],top);vertex(polygon[i+1],top)}
    if(bottom!==null)for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length]
      vertex(a,top);vertex(b,top);vertex(b,bottom);vertex(a,top);vertex(b,bottom);vertex(a,bottom)
    }
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2))
  geometry.computeVertexNormals();geometry.computeBoundingBox()
  return geometry
}

/** A finite physical display model. Grass slots are actual polygon subtraction. */
export class Campus3DBase {
  constructor({scene,campus,displayBounds}) {
    this.scene=scene;this.campus=campus;this.bounds=terrainBaseBounds(displayBounds)
    this.group=new THREE.Group();this.group.name='分层沙盘底座（展示层）'
    this.group.userData.illustrative=true
    this.resources=new Set();this.hidden=new Map();this.contactShadows=new THREE.Group();this.contactShadows.name='柔和接触阴影（展示层）'
    this.shadowPositions=[];this.shadowUV=[];this.shadowAlpha=[]
  }
  own(resource){this.resources.add(resource);return resource}
  material(color,extra={}){return this.own(new THREE.MeshStandardMaterial({color,roughness:.95,side:THREE.DoubleSide,...extra}))}
  mesh(geometry,material,name){const mesh=new THREE.Mesh(this.own(geometry),material);mesh.name=name;mesh.receiveShadow=true;this.group.add(mesh);return mesh}
  extrude(outer,holes,bottom,top,color,name) {
    const geometry=new THREE.ExtrudeGeometry(shapeOf(outer,holes),{depth:top-bottom,steps:1,bevelEnabled:false})
    const mesh=this.mesh(geometry,this.material(color),name);mesh.rotation.x=-Math.PI/2;mesh.position.y=bottom
    return mesh
  }
  init() {
    this.scene.traverse(object=>{if(['base','ground','roadEdge'].includes(object.userData.environmentKind)){this.hidden.set(object,object.visible);object.visible=false}})
    const b=this.bounds,ring=[[b.minX,b.minY],[b.maxX,b.minY],[b.maxX,b.maxY],[b.minX,b.maxY]]
    this.extrude(ring,[],L.baseBottom,L.stoneTop,'#4c6066','底座：深灰石材')
    this.extrude(ring,[],L.stoneTop,L.earthTop,'#ab9274','底座：土层')
    const outside=this.extrude(ring,[],L.earthTop,L.outsideTop,'#c1c0ae','底座：表层铺装')
    outside.userData.environmentKind='base'
    // Narrow edge courses separate the material strata and soften the silhouette.
    const inset=offsetTerrainRing(ring,-1.1)
    this.extrude(ring,[inset],L.stoneTop-.3,L.stoneTop+.45,'#d9c7a4','底座：层间收边')
    this.extrude(ring,[offsetTerrainRing(ring,-1.6)],L.outsideTop-.12,L.outsideTop+.18,'#d4d0bb','底座：顶边石材收口')
    const polygons=this.campus.boundary_polygons?.length?this.campus.boundary_polygons:[{outer:this.campus.boundary,holes:[]}]
    const corridors=roadCorridors(this.campus.roads||[]),outerCorridors=roadCorridors(this.campus.roads||[],.72)
    const triangles=polygons.flatMap(p=>planarTriangles(p.outer,p.holes||[]))
    const grassPieces=subtractTerrainCuts(triangles,outerCorridors)
    const grass=this.mesh(polygonGeometry(grassPieces,L.campusGrass,L.campusPlinth),this.material('#93af74'),'校园：道路切槽草坪')
    grass.userData.environmentKind='ground';grass.userData.roadSlots=true
    this.grassPieces=grassPieces
    // Concrete curb volumes are trimmed by every intersecting roadway. They
    // never form a raised barrier crossing an asphalt junction.
    const curbs=subtractTerrainCuts(outerCorridors,corridors)
    this.mesh(polygonGeometry(curbs,L.campusCurb,L.campusPlinth),this.material('#c6c8b6'),'校内道路：实体路缘')
    for(const p of polygons) {
      this.extrude(p.outer,p.holes||[],L.outsideTop,L.campusPlinth,'#b8b3a0','校园：抬高一级的石材台地')
      // A shallow boundary plinth, with cut road openings, makes the height
      // transition legible without drawing a wall over the mapped footpaths.
      const edgeTriangles=planarTriangles(p.outer,[offsetTerrainRing(p.outer,-.7)])
      const edgePieces=subtractTerrainCuts(edgeTriangles,outerCorridors)
      this.mesh(polygonGeometry(edgePieces,L.campusCurb,L.outsideTop),this.material('#d4d1bd'),'校园边界：路缘基座')
    }
    for(const building of this.campus.buildings||[]) {
      const outer=offsetTerrainRing(building.polygon,.75)
      const holes=(building.holes||[]).map(hole=>offsetTerrainRing(hole,-.75))
      const foundation=this.extrude(outer,holes,L.campusRoad,L.buildingBase,'#c6bba2',`建筑基座 ${building.osm_id}`)
      foundation.userData.illustrative=true
      this.contactShadow(building.polygon,L.campusGrass+.015,3.2,.19)
    }
    for(const road of this.campus.roads||[]) {
      const width=campusRoadWidth(road)/2+.75
      for(let i=1;i<(road.points||[]).length;i++) {
        const a=road.points[i-1],c=road.points[i],length=Math.hypot(c[0]-a[0],c[1]-a[1]);if(!length)continue
        const normal=[-(c[1]-a[1])/length,(c[0]-a[0])/length]
        for(const side of [-1,1])this.shadowStrip([a[0]+normal[0]*width*side,a[1]+normal[1]*width*side],[c[0]+normal[0]*width*side,c[1]+normal[1]*width*side],normal.map(v=>v*side),L.campusGrass+.02,1.4,.10)
      }
    }
    this.finishShadows();this.group.add(this.contactShadows);this.scene.add(this.group);return this
  }
  shadowStrip(a,b,normal,height,width,opacity) {
    const positions=[a[0],height,-a[1],b[0],height,-b[1],b[0]+normal[0]*width,height,-b[1]-normal[1]*width,a[0]+normal[0]*width,height,-a[1]-normal[1]*width]
    const uv=[[0,0],[1,0],[1,1],[0,1]]
    for(const i of [0,1,2,0,2,3]){this.shadowPositions.push(...positions.slice(i*3,i*3+3));this.shadowUV.push(...uv[i]);this.shadowAlpha.push(opacity)}
  }
  finishShadows() {
    const geometry=this.own(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.shadowPositions,3))
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(this.shadowUV,2));geometry.setAttribute('opacity',new THREE.Float32BufferAttribute(this.shadowAlpha,1))
    const material=this.own(new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:'attribute float opacity; varying float shadeAlpha; varying vec2 shadeUV; void main(){shadeAlpha=opacity;shadeUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying float shadeAlpha; varying vec2 shadeUV; void main(){float a=pow(1.0-shadeUV.y,2.0)*shadeAlpha;gl_FragColor=vec4(0.16,0.20,0.16,a);}' }))
    const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=7;mesh.userData.bloomOcclusion=false;mesh.userData.contactShadow=true;this.contactShadows.add(mesh)
  }
  contactShadow(ring,height,width,opacity) {
    const points=openRing(ring),area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1]},0),sign=area>=0?1:-1
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue
      this.shadowStrip(a,b,[sign*(b[1]-a[1])/length,-sign*(b[0]-a[0])/length],height,width,opacity)
    }
  }
  setQuality(value){this.contactShadows.visible=value!=='low'}
  dispose(){if(this.disposed)return;this.disposed=true;this.group.removeFromParent();for(const [mesh,visible]of this.hidden)mesh.visible=visible;for(const resource of this.resources)resource.dispose();this.resources.clear();this.hidden.clear()}
}
