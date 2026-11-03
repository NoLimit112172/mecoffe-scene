import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HOME_KEYS, SHOP_KEYS, createRouting, findPath, nearestNode, polygonCenter,
  resolveHomeKey, reverseRoute, routeBetweenMappings,
} from '../src/mecoffe/campus3dRouting.js'

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const campus = readJson('../../scene/campus3d.json')
const mapping = readJson('../../scene/campus3d_mapping.json')

test('all six mapped residences reach both shops using only OSM walking edges', () => {
  const context = createRouting(campus, mapping)
  let checked = 0
  for (const homeKey of HOME_KEYS) {
    for (const shopKey of SHOP_KEYS) {
      const route = routeBetweenMappings(context, homeKey, shopKey)
      assert.ok(route, `${homeKey} → ${shopKey} 不连通`)
      assert.ok(route.node_ids.length > 1, `${homeKey} 与 ${shopKey} 应有可展示的步行路程`)
      assert.equal(route.node_ids[0], context.anchors.get(homeKey).node.id)
      assert.equal(route.node_ids.at(-1), context.anchors.get(shopKey).node.id)
      let length = 0
      for (let i = 0; i < route.node_ids.length; i += 1) {
        const node = context.nodes.get(route.node_ids[i])
        assert.deepEqual(route.points[i], { x: node.x, y: node.y })
        if (i === 0) continue
        const a = route.node_ids[i - 1]
        const b = route.node_ids[i]
        const edges = campus.walk_graph.edges.filter(edge =>
          (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a))
        assert.ok(edges.length, `${homeKey} → ${shopKey} 出现图外捷径 ${a} → ${b}`)
        const edgeLength = Math.min(...edges.map(edge => edge.length_m))
        assert.ok(edgeLength > 0)
        const from = context.nodes.get(a)
        assert.ok(Math.abs(edgeLength - Math.hypot(node.x - from.x, node.y - from.y)) < 0.02)
        length += edgeLength
      }
      assert.ok(Math.abs(length - route.length_m) < 1e-6)
      const back = reverseRoute(route)
      assert.deepEqual(back.node_ids, [...route.node_ids].reverse())
      assert.deepEqual(back.points, [...route.points].reverse())
      assert.equal(back.length_m, route.length_m)
      assert.deepEqual(reverseRoute(back), route)
      checked += 1
    }
  }
  assert.equal(checked, 12)
})

test('all three rosters keep their existing occupancy assignments and resolve to OSM buildings', () => {
  const context = createRouting(campus, mapping)
  for (const file of ['scene.json', 'latest-network.json', 'latest-demo.json']) {
    const scene = readJson(`../public/mecoffe/${file}`)
    for (const person of scene.people) {
      const key = resolveHomeKey(person)
      assert.ok(context.anchors.has(key), `${file}: ${person.id} 的示意地点 ${key} 没有映射`)
      assert.equal(key, person.role === 'merchant' ? person.home_location_id : person.building_id)
    }
  }
})

const fixture = () => createRouting({
  buildings: [],
  walk_graph: {
    nodes: [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 4, y: 3 },
      { id: 'c', x: 4, y: -3 }, { id: 'd', x: 8, y: 0 },
      { id: 'isolated', x: 30, y: 0 },
    ],
    edges: [
      { source: 'a', target: 'd', length_m: 15 },
      { source: 'a', target: 'b', length_m: 5 },
      { source: 'b', target: 'd', length_m: 5 },
      { source: 'a', target: 'c', length_m: 7 },
      { source: 'c', target: 'd', length_m: 7 },
    ],
  },
}, { mappings: {} })

test('A* chooses the shortest graph route and walking edges work in both directions', () => {
  const context = fixture()
  assert.deepEqual(findPath(context, 'a', 'd'), {
    node_ids: ['a', 'b', 'd'],
    points: [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 8, y: 0 }],
    length_m: 10,
  })
  assert.deepEqual(findPath(context, 'd', 'a'), reverseRoute(findPath(context, 'a', 'd')))
})

test('disconnected or unknown endpoints do not get a fabricated shortcut', () => {
  const context = fixture()
  assert.equal(findPath(context, 'a', 'isolated'), null)
  assert.equal(findPath(context, 'missing', 'a'), null)
  assert.equal(routeBetweenMappings(context, 'missing', 'also-missing'), null)
  assert.deepEqual(findPath(context, 'a', 'a'), {
    node_ids: ['a'], points: [{ x: 0, y: 0 }], length_m: 0,
  })
  assert.equal(reverseRoute(null), null)
})

test('nearest node uses metre distance and polygon centre ignores extra outline vertices', () => {
  const context = fixture()
  assert.equal(nearestNode(context, { x: 7, y: 0 }).id, 'd')
  assert.equal(nearestNode(context, { x: 4.1, y: 3.1 }).id, 'b')
  const outline = [[0, 0], [1, 0], [2, 0], [8, 0], [8, 4], [0, 4], [0, 0]]
  assert.deepEqual(polygonCenter(outline), { x: 4, y: 2 })
  assert.deepEqual(polygonCenter([...outline].reverse()), { x: 4, y: 2 })
})
