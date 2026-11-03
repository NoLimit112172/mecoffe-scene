// Move the existing display corridor algorithms off the UI thread. Source A*
// is still computed by campus3dRouting, with exactly the accepted graph.
import {displayRoutePoints} from './campus3dCrowd.js'
import {displayCrowdDetour} from './campus3dDetour.js'

export function spatialJob(job, obstacles) {
  if(job.kind==='route')return displayRoutePoints(job.points,obstacles,job.options)
  if(job.kind==='replan') {
    for(let i=0;i<job.goals.length;i++) {
      const path=displayCrowdDetour(job.start,job.goals[i],obstacles,job.people,job.radius,{maxVisited:600})
      if(path)return {points:[...path,...job.goals.slice(i+1)]}
    }
    // A distant unobstructed destination can require a larger grid search.
    // Spend that budget once per job, rather than on every intermediate
    // corner; this preserves a safe escape without serial multi-second stalls.
    if(job.goals.length){
      const points=displayCrowdDetour(job.start,job.goals.at(-1),obstacles,job.people,job.radius)
      if(points)return {points}
    }
    if(job.retreat) {
      const points=displayCrowdDetour(job.start,job.home,obstacles,job.people,job.radius,{maxVisited:600})
      if(points?.length>1)return {points,retreat:true}
    }
    return null
  }
  throw new Error('Unknown display geometry job')
}

if(typeof self!=='undefined' && typeof document==='undefined') {
  let obstacles=[]
  self.onmessage=({data})=>{
    if(data.kind==='init'){obstacles=data.obstacles;return}
    try{self.postMessage({id:data.id,result:spatialJob(data,obstacles)})}
    catch(error){self.postMessage({id:data.id,error:error.message})}
  }
}

export class SpatialWorker {
  constructor(obstacles) {
    this.jobs=new Map();this.serial=0
    this.worker=new Worker(new URL('./spatialWorker.js',import.meta.url),{type:'module'})
    this.worker.postMessage({kind:'init',obstacles})
    this.worker.onmessage=({data})=>{const job=this.jobs.get(data.id);if(!job)return;this.jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.result)}
    this.worker.onerror=()=>{for(const job of this.jobs.values())job.reject(new Error('路线准备失败，请重新加载场景。'));this.jobs.clear()}
  }
  run(job){return new Promise((resolve,reject)=>{const id=++this.serial;this.jobs.set(id,{resolve,reject});this.worker.postMessage({...job,id})})}
  dispose(){this.worker.terminate();for(const job of this.jobs.values())job.resolve(null);this.jobs.clear()}
}
