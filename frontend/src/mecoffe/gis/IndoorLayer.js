import {MercatorCoordinate} from 'maplibre-gl'
import {Vector4} from 'three'
import {featureCentre} from './model.js'
import {layoutLabels} from '../campus3dScreen.js'

// Screen-pixel badges projected at the true extrusion roof height, no remote glyphs.
export class IndoorRoofLabels {
  constructor(view){this.view=view;this.elements=new Map();this.host=document.createElement('div');this.host.className='gis-indoor-roofs';Object.assign(this.host.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'1'});view.host.append(this.host);this.render=()=>this.update();view.map.on('render',this.render)}
  update(){
    const {view}=this,matrix=view.characters.mapProjection,width=view.host.clientWidth,height=view.host.clientHeight,counts=view.replay.occupancy.buildings,items=[]
    const center=view.map.getCenter(),key=[center.lng,center.lat,view.map.getZoom(),view.map.getPitch(),view.map.getBearing(),width,height,view.occupancyKey,view.visibility.buildings].join('|')
    if(matrix&&key===this.lastKey)return
    this.lastKey=matrix?key:null
    for(const feature of view.layers.buildings.features){
      const count=counts[feature.id]?.length||0;let el=this.elements.get(feature.id)
      if(!count||!matrix||view.map.getZoom()<15.3||view.visibility.buildings===false){if(el)el.style.display='none';continue}
      if(!el){el=document.createElement('div');el.setAttribute('data-indoor-building',feature.id);Object.assign(el.style,{position:'absolute',background:'#fffef4f2',border:'1px solid #a2b5a1',borderRadius:'6px',padding:'4px 8px',font:'600 12px/18px Microsoft YaHei,sans-serif',color:'#315c4d',whiteSpace:'nowrap',boxShadow:'0 2px 6px #28453420'});this.host.append(el);this.elements.set(feature.id,el)}
      if(el.dataset.count!==String(count)){el.textContent=`${feature.properties.name||'楼栋'} · ${count} 人`;el.title='在楼内（示意）';el.dataset.count=String(count)}
      const c=MercatorCoordinate.fromLngLat(featureCentre(feature),(feature.properties.height_m||0)+2),clip=new Vector4(c.x,c.y,c.z,1).applyMatrix4(matrix)
      const x=clip.x/clip.w,y=clip.y/clip.w,z=clip.z/clip.w,visible=clip.w>0&&z>-1&&z<1&&Math.abs(x)<1.1&&Math.abs(y)<1.1
      el.style.display=visible?'block':'none';if(visible)items.push({id:feature.id,x:(x+1)*width/2,y:(1-y)*height/2,width:el.offsetWidth,height:el.offsetHeight})
    }
    for(const item of layoutLabels(items,{width,height,padding:8,gap:5})){const el=this.elements.get(item.id);el.style.left=item.left+'px';el.style.top=item.top+'px'}
  }
  dispose(){this.view.map.off('render',this.render);this.host.remove();this.elements.clear()}
}
