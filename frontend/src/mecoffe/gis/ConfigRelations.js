import {MercatorCoordinate} from 'maplibre-gl'
import {Vector4} from 'three'
import {featureCentre} from './model.js'

const NS='http://www.w3.org/2000/svg'
let nextId=0
// Relationship overlays are display-only and project to the same roofs as occupancy badges.
export class ConfigRelations {
  constructor(view,host){
    this.view=view
    this.markerId=`config-relation-${++nextId}`
    this.svg=document.createElementNS(NS,'svg')
    this.svg.setAttribute('aria-label','所选人物的关系线')
    Object.assign(this.svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',overflow:'hidden',pointerEvents:'none'})
    host.prepend(this.svg)
  }
  project(id,matrix,width,height){
    const record=this.view.replay.people.get(id)
    const feature=record&&this.view.layers.buildings.features.find(f=>f.id===record.homeBuilding)
    if(!feature)return null
    const coordinate=MercatorCoordinate.fromLngLat(featureCentre(feature),(feature.properties.height_m||0)+5)
    const clip=new Vector4(coordinate.x,coordinate.y,coordinate.z,1).applyMatrix4(matrix)
    if(clip.w<=0)return null
    return {x:(clip.x/clip.w+1)*width/2,y:(1-clip.y/clip.w)*height/2}
  }
  update(matrix,width,height){
    const {view}=this
    if(view.replay.scenario.manifest.preview_mode!=='config')return
    const selected=view.selected?.type==='person'?view.selected.id:null
    const key=[selected,width,height,view.visibility.people,...(matrix?.elements||[])].join('|')
    if(key===this.lastKey)return
    this.lastKey=key;this.svg.replaceChildren()
    if(!selected||!matrix||view.visibility.people===false)return
    this.svg.setAttribute('viewBox',`0 0 ${width} ${height}`)
    const defs=document.createElementNS(NS,'defs'),marker=document.createElementNS(NS,'marker'),arrow=document.createElementNS(NS,'path')
    marker.id=this.markerId;marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','5');marker.setAttribute('markerHeight','5');marker.setAttribute('orient','auto')
    arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#477f8c');marker.append(arrow);defs.append(marker);this.svg.append(defs)
    const edges=view.replay.index.scene.relationships.filter(e=>e.source===selected||e.target===selected)
    for(const [index,edge] of edges.entries()){
      const a=this.project(edge.source,matrix,width,height),b=this.project(edge.target,matrix,width,height)
      if(!a||!b)continue
      const line=document.createElementNS(NS,'path'),title=document.createElementNS(NS,'title')
      const outgoing=edge.source===selected,heightOffset=30+(index%4)*10
      const same=Math.hypot(a.x-b.x,a.y-b.y)<3
      const d=same?`M ${a.x-8} ${a.y} C ${a.x-55} ${a.y-heightOffset*2} ${a.x+55} ${a.y-heightOffset*2} ${a.x+8} ${a.y}`:`M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${(a.y+b.y)/2-heightOffset} ${b.x} ${b.y}`
      line.setAttribute('d',d);line.setAttribute('fill','none');line.setAttribute('stroke',outgoing?'#42899f':'#b28f43');line.setAttribute('stroke-width','3');line.setAttribute('opacity','.8');line.setAttribute('marker-end',`url(#${this.markerId})`)
      line.setAttribute('data-relationship-source',edge.source);line.setAttribute('data-relationship-target',edge.target)
      if(edge.relation!=='follow')line.setAttribute('stroke-dasharray','6 4')
      title.textContent=`${view.replay.index.people.get(edge.source)?.name} → ${view.replay.index.people.get(edge.target)?.name} · ${edge.relation}`
      line.append(title);this.svg.append(line)
    }
  }
}
