import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {CROWD_GAP,DISPLAY_RADIUS,clearDisplaySegment,displayRoutePoints,nearestClearPosition,outsideBuildings,separateCrowd,standingSlots,stepSeparatedCrowd,sweptSeparation} from '../src/mecoffe/campus3dCrowd.js'
import {createRouting,HOME_KEYS,SHOP_KEYS,resolveHomeKey,routeBetweenMappings} from '../src/mecoffe/campus3dRouting.js'

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))
const campus=read('../../scene/campus3d.json'),mapping=read('../../scene/campus3d_mapping.json'),data=read('../public/mecoffe/latest-demo.json')
const routing=createRouting(campus,mapping)
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)
test('numerically identical waypoints count as reached without moving or blocking the queue',()=>{
  const people=[{id:'at-goal',x:3,y:4,radius:1,target:{x:3,y:4+1e-14}}]
  const result=stepSeparatedCrowd(people,[])
  assert.equal(result[0].fraction,1)
  assert.equal(result[0].waiting,false)
  assert.equal(distance(result[0],people[0]),0)
})
function assertSafe(people,buildings=[],previous=null) {
  for(let i=0;i<people.length;i++) {
    const p=people[i]
    assert.ok(outsideBuildings(p,buildings,p.radius),`${p.id}: body enters a building`)
    for(let j=i+1;j<people.length;j++) {
      const q=people[j],minimum=p.radius+q.radius+CROWD_GAP
      assert.ok(distance(p,q)>=minimum-2e-6,`${p.id}/${q.id}: separation ${distance(p,q)} < ${minimum}`)
      if(previous)assert.ok(sweptSeparation(previous[i],p,previous[j],q)>=minimum-2e-6,`${p.id}/${q.id}: bodies cross between frames`)
    }
  }
}

test('all 100 real roster door slots keep body clearance from every building and each other',()=>{
  const before=JSON.stringify({campus,mapping,data})
  const descriptors=data.people.map(person=>({id:person.id,origin:routing.anchors.get(resolveHomeKey(person)).node}))
  const slots=standingSlots(descriptors,campus.buildings,{roads:campus.roads})
  assert.equal(slots.length,100)
  assert.equal(new Set(slots.map(p=>p.id)).size,100)
  assertSafe(slots,campus.buildings)
  assert.deepEqual(slots,standingSlots([...descriptors].reverse(),campus.buildings,{roads:campus.roads}),'input ordering cannot change door assignment')
  assert.equal(JSON.stringify({campus,mapping,data}),before)
})

test('all twelve authoritative A* routes retain nodes and lengths while display detours clear building footprints',()=>{
  const before=JSON.stringify({campus,mapping})
  let rawInside=0,samples=0
  for(const home of HOME_KEYS)for(const shop of SHOP_KEYS) {
    const route=routeBetweenMappings(routing,home,shop),original=structuredClone(route)
    const display=displayRoutePoints(route.points,campus.buildings,{radius:DISPLAY_RADIUS,laneOffset:4})
    assert.ok(display.length>=2)
    for(let i=1;i<route.points.length;i++) {
      const a=route.points[i-1],b=route.points[i],steps=Math.ceil(distance(a,b))
      for(let n=0;n<=steps;n++)if(!outsideBuildings({x:a.x+(b.x-a.x)*n/steps,y:a.y+(b.y-a.y)*n/steps},campus.buildings))rawInside++
    }
    for(let i=1;i<display.length;i++) {
      const a=display[i-1],b=display[i],steps=Math.max(1,Math.ceil(distance(a,b)))
      assert.ok(clearDisplaySegment(a,b,campus.buildings,DISPLAY_RADIUS),`${home}->${shop}: unsafe whole segment`)
      for(let n=0;n<=steps;n++) {
        const p={x:a.x+(b.x-a.x)*n/steps,y:a.y+(b.y-a.y)*n/steps}
        assert.ok(outsideBuildings(p,campus.buildings,DISPLAY_RADIUS),`${home}->${shop}: unsafe metre sample`)
        samples++
      }
    }
    assert.deepEqual(route,original,'OSM route, IDs and recorded lengths remain intact')
  }
  assert.ok(rawInside>0,'fixture demonstrates why a render-only detour is necessary')
  assert.ok(samples>1000)
  assert.equal(JSON.stringify({campus,mapping}),before)
})

test('building clearance handles courtyards, concave outlines, negative coordinates and empty inputs',()=>{
  const courtyard=[{osm_id:'court',polygon:[[-20,-20],[20,-20],[20,20],[-20,20]],holes:[[[-10,-10],[-10,10],[10,10],[10,-10]]]}]
  assert.ok(outsideBuildings({x:0,y:0},courtyard,2))
  assert.equal(outsideBuildings({x:9,y:0},courtyard,2),false,'body touches inner courtyard wall')
  assert.equal(outsideBuildings({x:15,y:0},courtyard,0),false)
  assert.ok(clearDisplaySegment({x:-5,y:0},{x:5,y:0},courtyard,2))
  assert.equal(clearDisplaySegment({x:-30,y:0},{x:30,y:0},courtyard,2),false,'cannot tunnel through both outside walls')
  const concave=[{osm_id:'L',polygon:[[-20,-20],[10,-20],[10,-10],[-10,-10],[-10,10],[-20,10]]}]
  assert.ok(outsideBuildings({x:0,y:0},concave,2))
  assert.equal(clearDisplaySegment({x:-25,y:0},{x:0,y:-25},concave,2),false)
  const detour=displayRoutePoints([{x:-30,y:0},{x:0,y:-30}],concave,{radius:2,laneOffset:0})
  assert.ok(detour.slice(1).every((p,i)=>clearDisplaySegment(detour[i],p,concave,2)))
  assert.deepEqual(displayRoutePoints([],concave),[])
  assert.deepEqual(standingSlots([],concave),[])
  assert.deepEqual(stepSeparatedCrowd([],concave),[])
  assert.deepEqual(nearestClearPosition({x:-40,y:-40},[],{radius:2}),{x:-40,y:-40,radius:2})
})

test('continuous collision detection blocks head-on and crossing teleports rather than only checking endpoints',()=>{
  assert.equal(sweptSeparation({x:-10,y:0},{x:10,y:0},{x:10,y:0},{x:-10,y:0}),0)
  assert.equal(sweptSeparation({x:-10,y:0},{x:10,y:0},{x:0,y:-10},{x:0,y:10}),0)
  const people=[{id:'a',x:-10,y:0,radius:1,target:{x:10,y:0}},{id:'b',x:10,y:0,radius:1,target:{x:-10,y:0}}]
  const before=structuredClone(people),result=stepSeparatedCrowd(people,[])
  assertSafe(result,[],people)
  assert.ok(result.some(p=>p.waiting))
  assert.deepEqual(people,before)
})

test('mixed lanes and junction proposals preserve minimum separation and clear all three queues within 600 frames',()=>{
  let people=[]
  for(let i=0;i<6;i++) {
    people.push({id:`east-${i}`,x:-90-i*7,y:-3,radius:1.1,dx:1,dy:0})
    people.push({id:`west-${i}`,x:90+i*7,y:3,radius:1.1,dx:-1,dy:0})
    people.push({id:`north-${i}`,x:0,y:-90-i*7,radius:1.1,dx:0,dy:1})
  }
  let waiting=0
  for(let frame=0;frame<600;frame++) {
    const previous=people.map(p=>({...p})),proposals=people.map(p=>({...p,progress:frame,target:{x:p.x+p.dx*(frame%13===0?15:1.5),y:p.y+p.dy*(frame%13===0?15:1.5)}}))
    people=stepSeparatedCrowd(proposals,[])
    assertSafe(people,[],previous)
    waiting+=people.filter(p=>p.waiting).length
  }
  assert.ok(waiting>0,'junction traffic must sometimes yield')
  for(const p of people)assert.ok(p.dx*p.x+p.dy*p.y>30,`${p.id}: traffic must advance beyond the junction in bounded time`)
})

test('scale-change reflow and movement near a wall cannot push stationary people into the building',()=>{
  const buildings=[{osm_id:'wall',polygon:[[-5,-20],[5,-20],[5,20],[-5,20]]}]
  const crowded=[{id:'a',x:-5,y:0,radius:3,moving:true},{id:'b',x:-5,y:0,radius:3},{id:'c',x:-6,y:1,radius:4}]
  const reflow=separateCrowd(crowded,buildings)
  assertSafe(reflow,buildings)
  const output=stepSeparatedCrowd(reflow.map(p=>({...p,target:{x:20,y:p.y}})),buildings)
  assertSafe(output,buildings,reflow)
  assert.ok(output.every(p=>clearDisplaySegment(reflow.find(q=>q.id===p.id),p,buildings,p.radius)))
})
