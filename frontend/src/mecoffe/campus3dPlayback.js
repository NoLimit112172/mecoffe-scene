// Timeline helpers for the 3D page. Scene statistics still come from replay.js.
const FILES = { demo: 'latest-demo.json', network: 'latest-network.json', history: 'scene.json' }

export function dataFileForMode(mode) {
  if (!Object.hasOwn(FILES, mode)) throw new Error(`未知数据模式：${mode}`)
  return FILES[mode]
}

export function validateDataMode(scene, mode) {
  dataFileForMode(mode)
  if (mode === 'demo' && (scene.meta?.mode !== 'network_demo' || scene.meta?.illustrative !== true)) {
    throw new Error('新版演示必须是明确标注的规则演示数据')
  }
  if (mode === 'network' && (scene.meta?.mode !== 'network_snapshot' || scene.events?.length)) {
    throw new Error('关系网络必须是没有行为轨迹的输入快照')
  }
  if (mode === 'history' && (!scene.meta?.run_id || ['network_demo', 'network_snapshot'].includes(scene.meta?.mode))) {
    throw new Error('历史回放必须对应已有的 OASIS 运行')
  }
}

export function clampPosition(index, position) {
  return Math.max(0, Math.min(index.days.length, Number.isFinite(position) ? position : 0))
}

export function cursorAtPosition(index, position) {
  const pos = clampPosition(index, position)
  if (pos >= index.days.length) return index.scene.events.length
  const day = index.days[Math.floor(pos)]
  if (!day) return 0
  return Math.min(day.end, Math.floor(day.start + (pos - Math.floor(pos)) * (day.end - day.start) + 1e-9))
}

export function positionAtCursor(index, cursor) {
  const target = Math.max(0, Math.min(index.scene.events.length, Math.floor(cursor)))
  if (!target) return 0
  if (target >= index.scene.events.length) return index.days.length
  const k = index.days.findIndex(day => day.start <= target && target < day.end)
  const day = index.days[k]
  return k + (target - day.start + 0.001) / (day.end - day.start)
}

export function advancePosition(index, position, elapsedMs, speed = 1, secondsPerDay = 12) {
  const delta = Math.max(0, Math.min(250, elapsedMs)) / 1000
  return clampPosition(index, position + delta * Math.max(0, speed) / secondsPerDay)
}
