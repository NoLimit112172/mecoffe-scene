import * as THREE from 'three'
import {Line2} from 'three/addons/lines/Line2.js'
import {LineGeometry} from 'three/addons/lines/LineGeometry.js'
import {LineMaterial} from 'three/addons/lines/LineMaterial.js'

export const RELATION_LINE_WIDTH=2.8
export function screenLine(points,{color=0x4c8ba6,opacity=.58,width=RELATION_LINE_WIDTH}={}){
  const geometry=new LineGeometry().setPositions(points.flatMap(p=>[p.x,p.y,p.z]))
  const material=new LineMaterial({color,linewidth:width,worldUnits:false,transparent:true,opacity,depthTest:false,depthWrite:false})
  const line=new Line2(geometry,material)
  line.userData.bloomOcclusion=false;line.renderOrder=7;line.frustumCulled=false
  return line
}
export function updateScreenLine(line,points){
  const data=line.geometry.attributes.instanceStart.data
  if(data.array.length!==(points.length-1)*6){line.geometry.setPositions(points.flatMap(p=>[p.x,p.y,p.z]));return}
  for(let i=0;i<points.length-1;i++)data.array.set([points[i].x,points[i].y,points[i].z,points[i+1].x,points[i+1].y,points[i+1].z],i*6)
  data.needsUpdate=true;line.geometry.computeBoundingBox();line.geometry.computeBoundingSphere()
}

export function textTextureMetrics(width,dpr=globalThis.devicePixelRatio||1){
  const ratio=Math.max(2,Math.min(3,Number(dpr)||1)),logicalWidth=Math.ceil(width+84),logicalHeight=76
  return {ratio,logicalWidth,logicalHeight,width:Math.ceil(logicalWidth*ratio),height:Math.ceil(logicalHeight*ratio)}
}

// Canvas vector paths, not copied sprites or platform-dependent emoji glyphs.
function icon(ctx,type){
  ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#ffffff'
  ctx.beginPath()
  if(type==='purchase'){
    ctx.moveTo(5,7);ctx.lineTo(25,7);ctx.lineTo(22,28);ctx.lineTo(8,28);ctx.closePath();ctx.stroke()
    ctx.beginPath();ctx.moveTo(3,4);ctx.lineTo(27,4);ctx.moveTo(10,12);ctx.lineTo(21,12)
  }else if(type==='ad'||type==='exposure'){
    ctx.moveTo(4,12);ctx.lineTo(12,12);ctx.lineTo(25,4);ctx.lineTo(25,27);ctx.lineTo(12,20);ctx.lineTo(4,20);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.moveTo(12,21);ctx.lineTo(15,29)
  }else if(type==='follow'){
    ctx.arc(11,9,5,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(11,25,8,Math.PI,0);ctx.moveTo(24,14);ctx.lineTo(24,24);ctx.moveTo(19,19);ctx.lineTo(29,19)
  }else if(type==='post'){
    ctx.roundRect(5,3,22,27,3);ctx.moveTo(10,10);ctx.lineTo(22,10);ctx.moveTo(10,16);ctx.lineTo(22,16);ctx.moveTo(10,22);ctx.lineTo(18,22)
  }else{
    ctx.roundRect(3,4,26,20,5);ctx.moveTo(9,24);ctx.lineTo(8,30);ctx.lineTo(17,24);ctx.moveTo(9,12);ctx.lineTo(23,12);ctx.moveTo(9,17);ctx.lineTo(19,17)
  }
  ctx.stroke()
}

export function makeSharpTextTexture(text,color,type='comment'){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),font='700 28px "Microsoft YaHei",sans-serif'
  const plain=text.replace(/☕|[•＋]/g,'').trim();ctx.font=font
  const size=textTextureMetrics(ctx.measureText(plain).width)
  canvas.width=size.width;canvas.height=size.height;ctx.scale(size.ratio,size.ratio)
  const w=size.logicalWidth;ctx.font=font;ctx.fillStyle='rgba(17,45,48,.96)'
  ctx.beginPath();ctx.roundRect(2,2,w-4,60,14);ctx.fill();ctx.strokeStyle=`#${color.toString(16).padStart(6,'0')}`;ctx.lineWidth=2;ctx.stroke()
  ctx.beginPath();ctx.moveTo(w/2-8,61);ctx.lineTo(w/2,74);ctx.lineTo(w/2+8,61);ctx.fill()
  ctx.save();ctx.translate(14,16);icon(ctx,type);ctx.restore()
  ctx.fillStyle='#ffffff';ctx.textBaseline='middle';ctx.fillText(plain,58,33)
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true
  return {texture,aspect:w/size.logicalHeight,ratio:size.ratio}
}
