import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { indexScene, stateAt } from '../src/mecoffe/replay.js'
import { advancePosition, cursorAtPosition, dataFileForMode, positionAtCursor, validateDataMode } from '../src/mecoffe/campus3dPlayback.js'

const read = file => JSON.parse(readFileSync(new URL(`../public/mecoffe/${file}`, import.meta.url), 'utf8'))

test('3D modes retain their original provenance and reject mislabeled data', () => {
  const demo = read(dataFileForMode('demo'))
  const network = read(dataFileForMode('network'))
  const history = read(dataFileForMode('history'))
  for (const [data, mode] of [[demo, 'demo'], [network, 'network'], [history, 'history']]) {
    assert.doesNotThrow(() => validateDataMode(data, mode))
  }
  assert.throws(() => validateDataMode(history, 'demo'))
  assert.throws(() => validateDataMode(demo, 'history'))
  assert.throws(() => validateDataMode({ ...network, events: [{}] }, 'network'))
  assert.throws(() => dataFileForMode('__proto__'))
  assert.equal(history.meta.completed_steps, 23)
  assert.equal(demo.meta.execution_status, 'not_run')
  assert.equal(network.events.length, 0)
})

test('single-event stepping roundtrips every cursor in both playback datasets', () => {
  for (const mode of ['demo', 'history']) {
    const index = indexScene(read(dataFileForMode(mode)))
    for (let cursor = 0; cursor <= index.scene.events.length; cursor += 1) {
      assert.equal(cursorAtPosition(index, positionAtCursor(index, cursor)), cursor, `${mode} cursor ${cursor}`)
    }
    assert.equal(cursorAtPosition(index, -10), 0)
    assert.equal(cursorAtPosition(index, NaN), 0)
    assert.equal(cursorAtPosition(index, Infinity), 0)
    assert.equal(cursorAtPosition(index, index.days.length + 1), index.scene.events.length)
  }
})

test('day jumps use original event prefixes and preserve historical partial-day flags', () => {
  for (const mode of ['demo', 'history', 'network']) {
    const index = indexScene(read(dataFileForMode(mode)))
    for (const [k, day] of index.days.entries()) {
      const cursor = cursorAtPosition(index, k)
      assert.equal(cursor, day.start)
      assert.deepEqual(stateAt(index, cursor), index.prefix[day.start])
    }
    assert.deepEqual(stateAt(index, cursorAtPosition(index, index.days.length)), index.prefix.at(-1))
  }
  const historical = indexScene(read(dataFileForMode('history')))
  assert.equal(historical.days.at(-1).step, 24)
  assert.equal(historical.days.at(-1).complete, false)
})

test('playback advances through empty days, caps inactive-tab time and stops at the end', () => {
  const index = { days: [{ start: 0, end: 0 }, { start: 0, end: 2 }, { start: 2, end: 2 }], scene: { events: [{}, {}] } }
  assert.equal(cursorAtPosition(index, 0.5), 0)
  assert.equal(cursorAtPosition(index, 1.5), 1)
  assert.equal(cursorAtPosition(index, 2.5), 2)
  assert.equal(advancePosition(index, 1, 100000, 4, 1), 2)
  assert.equal(advancePosition(index, 2.99, 250, 4, 1), 3)
  assert.equal(advancePosition(index, 1, -100, 1, 1), 1)
})
