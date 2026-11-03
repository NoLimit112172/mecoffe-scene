import test from 'node:test'
import assert from 'node:assert/strict'
import { displayCrowdDetour } from '../src/mecoffe/campus3dDetour.js'
import { clearDisplaySegment, outsideBuildings, CROWD_GAP } from '../src/mecoffe/campus3dCrowd.js'
import { segmentDistance } from '../src/mecoffe/campus3dEnvironmentModel.js'

const square = (x0, y0, x1, y1) => ({ osm_id: `${x0}:${y0}`, polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]] })
function safe(path, start, goal, buildings, people, radius) {
  assert.ok(path && path.length >= 2, 'expected a finite safe detour')
  assert.deepEqual(path[0], start)
  assert.deepEqual(path.at(-1), goal)
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i]
    assert.ok(clearDisplaySegment(a, b, buildings, radius), 'whole edge clears buildings')
    for (const person of people) assert.ok(segmentDistance(person, [a.x,a.y], [b.x,b.y]) >= radius + person.radius + CROWD_GAP - 1e-6,
      'whole edge clears expanded person circle')
    for (let t = 0; t <= 1; t += .05) assert.ok(outsideBuildings({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},buildings,radius))
  }
}

test('continuous detour bypasses a stationary queue and a building without editing any input', () => {
  const start={x:-45,y:0},goal={x:45,y:0},buildings=[square(-9,8,9,26)]
  const people=[{x:0,y:0,radius:4},{x:0,y:-12,radius:4},{x:17,y:0,radius:4}]
  const before=JSON.stringify({start,goal,buildings,people}),radius=4
  const path=displayCrowdDetour(start,goal,buildings,people,radius)
  safe(path,start,goal,buildings,people,radius)
  assert.ok(path.length>2)
  assert.equal(JSON.stringify({start,goal,buildings,people}),before)
  assert.deepEqual(displayCrowdDetour(start,goal,buildings,people,radius),path)
})

test('a near-touching start can escape around standing people rather than being quantized into them', () => {
  const radius=3,start={x:-12,y:-7},goal={x:25,y:15},buildings=[]
  const people=[{x:-5.1,y:-7,radius:3},{x:-13,y:-15,radius:3},{x:6,y:7,radius:3}]
  const path=displayCrowdDetour(start,goal,buildings,people,radius)
  safe(path,start,goal,buildings,people,radius)
})

test('negative-coordinate corridor keeps every diagonal clear of walls and waiting people', () => {
  const start={x:-55,y:-14},goal={x:-5,y:-14},radius=2
  const buildings=[square(-60,-40,0,-22),square(-60,-6,0,20)]
  const people=[{x:-30,y:-17,radius:2}]
  safe(displayCrowdDetour(start,goal,buildings,people,radius),start,goal,buildings,people,radius)
})

test('occupied target waits with null instead of substituting a destination or penetrating a circle', () => {
  const start={x:0,y:0},goal={x:20,y:0}
  assert.equal(displayCrowdDetour(start,goal,[],[{...goal,radius:3}],3),null)
  assert.equal(displayCrowdDetour(start,goal,[square(18,-2,22,2)],[],3),null)
  assert.equal(displayCrowdDetour(start,goal,[],[{...start,radius:3}],3),null)
  assert.deepEqual(displayCrowdDetour(start,goal,[],[],3),[start,goal])
  assert.equal(displayCrowdDetour({x:NaN,y:0},goal),null)
})

test('a sealed courtyard returns null in bounded time and never tunnels through walls', () => {
  const building={...square(-25,-25,25,25),holes:[square(-12,-12,12,12).polygon]}
  assert.equal(displayCrowdDetour({x:0,y:0},{x:50,y:0},[building],[],2),null)
})
