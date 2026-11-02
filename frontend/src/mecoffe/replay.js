// MeCoffe 回放的纯函数部分：不依赖 Vue / Pixi，便于单独测试。
// 游标 cursor 表示“已经发生的事件条数”，即 events[0 .. cursor-1] 已发生。

export const EVENT_LABELS = {
  post: '发帖',
  comment: '评论',
  purchase: '购买',
  ad: '投放广告',
  exposure: '信息流返回广告',
  follow: '关注',
  interview: '访谈',
  price: '调价',
  failed: '动作失败',
  other: '其他动作',
}

export const STAGE_LABELS = {
  initialization: '初始化',
  before_actions: '脚本事件',
  merchant_operations: '商家经营',
  consumer_purchase: '消费阶段',
  social_exchange: '社交交流',
  feed: '信息流',
  unknown: '未标注阶段',
}

export function indexScene(scene) {
  const people = new Map(scene.people.map(p => [p.id, p]))
  const locations = new Map(scene.campus.locations.map(l => [l.location_id, l]))
  const brands = new Map(scene.brands.map(b => [b.brand_id, b]))
  for (const event of scene.events) {
    if (!people.has(event.actor)) throw new Error(`事件 ${event.key} 的人物 ${event.actor} 不在名册中`)
  }
  // dayStart[k] = 第 k 个日子的第一条事件下标；dayEnd 为开区间
  const days = scene.days.map(day => ({ ...day, start: 0, end: 0 }))
  const position = new Map(days.map((day, k) => [day.step, k]))
  let cursor = 0
  for (const day of days) {
    day.start = cursor
    while (cursor < scene.events.length && scene.events[cursor].step === day.step) cursor += 1
    day.end = cursor
  }
  if (cursor !== scene.events.length) throw new Error('事件没有按天排好序，或含有时间轴之外的日子')
  return { scene, people, locations, brands, days, position, prefix: buildPrefix(scene) }
}

// prefix[i] 是前 i 条事件发生后的累计状态；每项都是小对象，100~2000 条事件下内存可以忽略
function buildPrefix(scene) {
  const brandIds = scene.brands.map(b => b.brand_id)
  const empty = () => Object.fromEntries(brandIds.map(id => [id, 0]))
  const seenOrders = new Set()
  const reached = Object.fromEntries(brandIds.map(id => [id, new Set()]))
  const reachedAnyBrand = new Set()
  let state = {
    cups: empty(), revenueFen: empty(), orders: 0,
    posts: 0, comments: 0, follows: 0, failed: 0, interviews: 0,
    exposures: 0, reached: empty(), reachedAny: 0,
  }
  const prefix = [state]
  for (const event of scene.events) {
    const next = { ...state, cups: { ...state.cups }, revenueFen: { ...state.revenueFen }, reached: { ...state.reached } }
    switch (event.type) {
      case 'purchase':
        if (!seenOrders.has(event.order_id) && event.brand_id in next.cups) {
          seenOrders.add(event.order_id)
          next.cups[event.brand_id] += event.quantity || 1
          next.revenueFen[event.brand_id] += event.amount_fen || 0
          next.orders += 1
        }
        break
      case 'post': next.posts += 1; break
      case 'ad': next.posts += 1; break
      case 'comment': next.comments += 1; break
      case 'follow': next.follows += 1; break
      case 'failed': next.failed += 1; break
      case 'interview': next.interviews += 1; break
      case 'exposure':
        next.exposures += 1
        reachedAnyBrand.add(event.actor)
        next.reachedAny = reachedAnyBrand.size
        for (const brand of event.brand_ids || []) {
          if (reached[brand] && !reached[brand].has(event.actor)) {
            reached[brand].add(event.actor)
            next.reached[brand] = reached[brand].size
          }
        }
        break
      default: break
    }
    prefix.push(next)
    state = next
  }
  return prefix
}

export function clampCursor(index, cursor) {
  return Math.max(0, Math.min(index.scene.events.length, Math.floor(cursor)))
}

export function stateAt(index, cursor) {
  return index.prefix[clampCursor(index, cursor)]
}

// 游标所在的日子：最后一个 start <= cursor 的日子；正好处在两天交界时算作前一天已结束
export function dayIndexAt(index, cursor) {
  const c = clampCursor(index, cursor)
  let found = 0
  index.days.forEach((day, k) => { if (day.start <= c) found = k })
  return found
}

// 逐日成交：只统计游标之前的订单；尚未播放到的日子不画（null），而不是画 0
export function dailySeries(index, cursor) {
  const c = clampCursor(index, cursor)
  const current = dayIndexAt(index, c)
  const brandIds = index.scene.brands.map(b => b.brand_id)
  return index.days.map((day, k) => {
    const row = { step: day.step, label: day.label, complete: day.complete, played: k <= current }
    for (const brand of brandIds) {
      if (k > current) { row[brand] = null; continue }
      const end = Math.min(day.end, c)
      row[brand] = index.prefix[end].cups[brand] - index.prefix[Math.min(day.start, end)].cups[brand]
    }
    return row
  })
}

export function involves(event, personId) {
  return event.actor === personId || event.target === personId
}

// 某人到游标为止的记录，倒序（最新在前）
export function personHistory(index, personId, cursor, limit = 60) {
  const c = clampCursor(index, cursor)
  const out = []
  for (let i = c - 1; i >= 0 && out.length < limit; i -= 1) {
    if (involves(index.scene.events[i], personId)) out.push(index.scene.events[i])
  }
  return out
}

// 某人截至游标的购买统计（按品牌）
export function personPurchases(index, personId, cursor) {
  const c = clampCursor(index, cursor)
  const result = {}
  const seenOrders = new Set()
  for (let i = 0; i < c; i += 1) {
    const event = index.scene.events[i]
    if (event.type === 'purchase' && event.actor === personId && !seenOrders.has(event.order_id)) {
      seenOrders.add(event.order_id)
      result[event.brand_id] = (result[event.brand_id] || 0) + (event.quantity || 1)
    }
  }
  return result
}

// 所有人截至游标的购买杯数：Map<personId, {brandId: cups}>，用于拖动进度后重画地图上的杯子标记
export function cupsByPersonAt(index, cursor) {
  const c = clampCursor(index, cursor)
  const result = new Map()
  const seenOrders = new Set()
  for (let i = 0; i < c; i += 1) {
    const event = index.scene.events[i]
    if (event.type !== 'purchase' || seenOrders.has(event.order_id)) continue
    seenOrders.add(event.order_id)
    const cups = result.get(event.actor) || {}
    cups[event.brand_id] = (cups[event.brand_id] || 0) + (event.quantity || 1)
    result.set(event.actor, cups)
  }
  return result
}

export function describeEvent(index, event) {
  const name = id => index.people.get(id)?.name || id
  const actor = name(event.actor)
  switch (event.type) {
    case 'post': return `${actor} 发帖：${event.text || ''}`
    case 'comment': return `${actor} 评论了 ${name(event.target)} 的帖子：${event.text || ''}`
    case 'purchase': return `${actor} 购买 ${event.product_name || event.brand_id} ×${event.quantity || 1}，¥${((event.amount_fen || 0) / 100).toFixed(2)}`
    case 'ad': return `${actor} 投放广告（定向 ${event.targeted?.length || 0} 人）：${event.text || ''}`
    case 'exposure': return `${actor} 的信息流返回了 ${(event.brand_ids || []).join('、') || '广告'} 的广告帖`
    case 'follow': return `${actor} 关注了 ${name(event.target)}`
    case 'interview': return `${actor} 接受${event.round === 'pre' ? '基线' : event.round === 'post' ? '后测' : ''}访谈：${event.text || ''}`
    case 'price': return `${actor} 调整价格`
    case 'failed': return `${actor} 的 ${event.action} 动作执行失败`
    default: return `${actor} 执行 ${event.action || event.type}`
  }
}
