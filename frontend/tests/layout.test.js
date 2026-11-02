import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  computeHomes, routeToShop, buildingRects, buildingIndex, segmentHitsRect, mainRoadY,
  laneOffset, routeLength, counterSpread, doorOf, floorCount,
} from '../src/mecoffe/layout.js'

const campus = JSON.parse(readFileSync(new URL('../../scene/campus.json', import.meta.url), 'utf8'))
const locations = new Map(campus.locations.map(l => [l.location_id, l]))

test('a dormitory resident leaves by the door, takes the main road, then goes round to the counter', () => {
  const { building } = buildingIndex(campus).get('ug_dorm_west')
  const door = doorOf(building)
  const route = routeToShop(campus, locations.get('undergraduate_dormitory'), door, locations.get('shop_merchant_001'))
  assert.deepEqual(route[0], door)
  assert.deepEqual(route.at(-1), { x: 7.8, y: 22.1 })
  assert.ok(route.some(p => p.y === mainRoadY(campus)))
  for (let k = 1; k < route.length; k += 1) {
    assert.ok(route[k].x === route[k - 1].x || route[k].y === route[k - 1].y, `第 ${k} 段不是横平竖直的`)
  }
})

test('a shop without counter information is rejected', () => {
  const broken = { ...locations.get('shop_merchant_001'), counter: undefined }
  assert.throws(() => routeToShop(campus, locations.get('graduate_apartment'), { x: 35, y: 11.25 }, broken))
})

test('lane offsets stay inside the two-row road', () => {
  for (const id of ['a', 'b', 'undergraduate_consumer_001', 'teacher_consumer_008']) {
    assert.ok(Math.abs(laneOffset(id)) < 0.5)
  }
})

test('every house fits inside the map once its floors are stacked', () => {
  // 64px 格子下，楼高按贴图比例估算：底层 + (层数-1) 个标准层 + 屋顶，粗略按每层 1.6 格计
  for (const { building } of buildingIndex(campus).values()) {
    if (building.style !== 'house') continue
    const roughTop = building.y + building.h - (floorCount(building) + 1) * 1.6
    assert.ok(roughTop > -0.5, `${building.building_id} 可能顶出地图上边`)
  }
})

const scenePath = new URL('../public/mecoffe/scene.json', import.meta.url)
const hasScene = existsSync(scenePath)

test('real roster: every consumer can reach both shops without walking through a building', { skip: !hasScene }, () => {
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'))
  const homes = computeHomes(scene)
  const sceneLocations = new Map(scene.campus.locations.map(l => [l.location_id, l]))
  const rects = buildingRects(scene.campus)
  const shops = scene.brands.map(b => sceneLocations.get(b.location_id))
  let checked = 0
  for (const person of scene.people) {
    if (person.role === 'merchant') continue
    const home = homes.get(person.id)
    assert.equal(home.kind, 'indoor')
    for (const shop of shops) {
      const route = routeToShop(scene.campus, sceneLocations.get(home.locationId), home, shop, laneOffset(person.id), counterSpread(person.id))
      assert.ok(routeLength(route) > 0)
      for (let k = 1; k < route.length; k += 1) {
        const axisAligned = Math.abs(route[k].x - route[k - 1].x) < 1e-9 || Math.abs(route[k].y - route[k - 1].y) < 1e-9
        assert.ok(axisAligned, `${person.id} 去 ${shop.location_id} 的第 ${k} 段不是横平竖直的`)
        for (const rect of rects) {
          assert.ok(!segmentHitsRect(route[k - 1], route[k], rect), `${person.id} 去 ${shop.location_id} 的第 ${k} 段穿过了 ${rect.buildingId}`)
        }
      }
      checked += 1
    }
  }
  assert.equal(checked, 98 * 2)
})

test('real roster: residents fill floors evenly and never share a spot', { skip: !hasScene }, () => {
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'))
  const homes = computeHomes(scene)
  assert.equal(homes.size, scene.people.length)
  const perBuilding = new Map()
  for (const home of homes.values()) {
    if (home.kind !== 'indoor') continue
    const spots = perBuilding.get(home.buildingId) || new Set()
    const key = `${home.floor}:${home.slot}`
    assert.ok(!spots.has(key), `${home.buildingId} 的 ${key} 被重复分配`)
    spots.add(key)
    perBuilding.set(home.buildingId, spots)
    assert.ok(home.floor < home.floors)
    assert.ok(home.slot < home.perFloor)
  }
  assert.equal(perBuilding.size, 6)
})
