/**
 * 2026-10-13 深夜轮（全项目重审·第二批 40 条发现）修复批次的行为测试
 * ============================================================
 * 这一批改的是"接口回什么、库里落什么"，所以断言全部落在真代码路径上：
 * 走 db/init 的内存库替身（与 db/schema.sql 同源），直接调路由 stack 里最后一个业务 handler，
 * 不碰 backend/db/styleai.db、不起真端口。限流与鉴权中间件因此被绕过——
 * 本文件验的是入参收敛与写库/出参结果，闸门本身另有 routeLimiterCoverage / guardHelpers 覆盖。
 * 匿名下载口的尾斜杠那两条（routes/models.js 与 server.js 静态口）要真发 HTTP 才看得出来，
 * 单独放在 test/modelFileTrailingSlash.test.js。
 *
 * 运行: node --test test/auditFixes20261013.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const { maskQuery } = require('../middleware/logger')
const { asFilters, stripIdentityFields } = require('../utils/common')
const { healthBand, gbBand } = require('../services/bmi')
const { colorFit } = require('../services/colorMetrics')
const { buildFullLook } = require('../services/fullLookAdvisor')
const { pollTryonResult } = require('../services/dashscopeService')
const { computeProportionLevels, enrichProfile } = require('../services/profileEnricher')

const wardrobeRouter = require('../routes/wardrobe')
const cosmeticRouter = require('../routes/cosmetic')
const accessoryRouter = require('../routes/accessory')
const crossCabinetRouter = require('../routes/crossCabinet')
const customerRouter = require('../routes/customer')
const analysisRouter = require('../routes/analysis')
const historyRouter = require('../routes/history')
const rulesRouter = require('../routes/rules')
const inventoryRouter = require('../routes/inventory')
const paymentRouter = require('../routes/payment')
const creatorRouter = require('../routes/creator')
const authRouter = require('../routes/auth')

/** 按 method+path 找路由 */
function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    const p = r.path
    const hit = Array.isArray(p) ? p.includes(routePath) : p === routePath
    if (hit) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

/** 只调最后一个 handler（业务本体），返回 {statusCode, body} */
function call(route, opt = {}) {
  const { params = {}, query = {}, body = {}, headers = {}, user = null } = opt
  const handler = route.stack[route.stack.length - 1].handle
  const res = {
    statusCode: 200,
    body: null,
    status(c) {
      res.statusCode = c
      return res
    },
    json(b) {
      res.body = b
      return res
    },
  }
  handler({ params, query, body, headers, ip: '1.1.1.1', socket: {}, user }, res, () => {})
  return res
}

const sid = (name) => `sid-${name}-20261013`
const day = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString()

/**
 * 建一个会员用户行。
 * 注意 schema：users 表只有 session_id 是 NOT NULL，password_hash 在 user_accounts 表上，
 * 往 users 写 password_hash 会直接 SQLITE_ERROR（10-13 现量）。
 */
function mkUser(nickname, tag) {
  return memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run(nickname, sid(tag))
}

/** 往三柜塞一条最简单记录 */
function addWardrobe(sessionId, extra = {}) {
  const cols = { session_id: sessionId, name: '测试上衣', category: '上衣', ...extra }
  const keys = Object.keys(cols)
  memDb
    .prepare(
      `INSERT INTO user_wardrobe (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    )
    .run(...keys.map((k) => cols[k]))
  return memDb.prepare('SELECT * FROM user_wardrobe ORDER BY id DESC LIMIT 1').get()
}

function addCosmetic(sessionId, extra = {}) {
  const cols = { session_id: sessionId, name: '测试口红', category: '口红', ...extra }
  const keys = Object.keys(cols)
  memDb
    .prepare(
      `INSERT INTO user_cosmetics (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    )
    .run(...keys.map((k) => cols[k]))
  return memDb.prepare('SELECT * FROM user_cosmetics ORDER BY id DESC LIMIT 1').get()
}

function addAccessory(sessionId, extra = {}) {
  const cols = { session_id: sessionId, name: '测试项链', category: '项链', ...extra }
  const keys = Object.keys(cols)
  memDb
    .prepare(
      `INSERT INTO user_accessories (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    )
    .run(...keys.map((k) => cols[k]))
  return memDb.prepare('SELECT * FROM user_accessories ORDER BY id DESC LIMIT 1').get()
}

// ============================================================
// 一、utils/common.js 两个新出口（纯函数）
// ============================================================

test('asFilters：数组/对象当"没这个筛选"，字符串照旧留着', () => {
  const out = asFilters(
    { category: ['上衣', '裤子'], condition: ' 良好 ', name: { a: 1 }, num: 7 },
    ['category', 'condition', 'name', 'num', 'missing'],
  )
  assert.strictEqual(out.category, '', '数组必须归成空串，否则绑进 SQLite 当场 RangeError')
  assert.strictEqual(out.name, '', '对象同理')
  assert.strictEqual(out.condition, '良好')
  assert.strictEqual(out.num, '7', '数字过 asText 成文本，绑参合法')
  assert.strictEqual(out.missing, '', '没带的键也是空串，调用方可以统一 `|| 默认值`')
  assert.deepStrictEqual(asFilters(undefined, ['x']), { x: '' }, 'query 整个缺失不能抛')
})

test('stripIdentityFields：嵌套与数组里的身份字段一起剥，__proto__ 只当普通键', () => {
  const src = {
    nickname: '小明',
    gender: '女',
    contact: { phone: '13800001111', email: 'a@b.c', note: '留着' },
    items: [{ real_name: '张三', wechat: 'wx_1', color: '白' }],
    __proto__: { polluted: true },
  }
  const out = stripIdentityFields(src)
  assert.ok(!('nickname' in out))
  assert.ok(!('phone' in out.contact), '嵌套位置的手机号是最主要的那条漏口')
  assert.ok(!('email' in out.contact))
  assert.ok(!('real_name' in out.items[0]) && !('wechat' in out.items[0]))
  assert.strictEqual(out.contact.note, '留着')
  assert.strictEqual(out.items[0].color, '白')
  assert.strictEqual(out.polluted, undefined, '__proto__ 不能被当原型写进去')
  assert.strictEqual(Object.getPrototypeOf(out), Object.prototype, '结果必须是普通对象')
})

test('stripIdentityFields：深度封顶，别拿请求体把递归跑满', () => {
  const deep = {}
  let cursor = deep
  for (let i = 0; i < 20; i++) {
    cursor.next = {}
    cursor = cursor.next
  }
  const out = stripIdentityFields(deep)
  let n = out
  let depth = 0
  while (n && typeof n === 'object' && n.next) {
    n = n.next
    depth++
  }
  assert.ok(depth <= 8, `超过 8 层就返回 null，实测剥到 ${depth} 层`)
})

// ============================================================
// 二、数组型查询串把列表页打成 500（asFilters 落地面）
// ============================================================

test('衣橱 /items ?category[]=… 回 200，不是 500', () => {
  const s = sid('ward-list')
  addWardrobe(s, { category: '上衣' })
  const res = call(findRoute(wardrobeRouter, 'get', '/items'), {
    headers: { 'x-session-id': s },
    query: { category: ['上衣', '裤子'] },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.ok(Array.isArray(res.body.data.items), '/items 的数组挂在 data.items 下')
  assert.strictEqual(res.body.data.items.length, 1, '数组筛选当"没这个筛选"⇒ 该条还得看得见')
})

test('衣橱 /wishlist ?status[]=… 回 200', () => {
  const s = sid('wish-list')
  const res = call(findRoute(wardrobeRouter, 'get', '/wishlist'), {
    headers: { 'x-session-id': s },
    query: { status: ['pending'] },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
})

test('化妆柜 /items 与配饰柜 /items 的数组筛选同样不抛', () => {
  const s = sid('cab-list')
  addCosmetic(s)
  addAccessory(s)
  const a = call(findRoute(cosmeticRouter, 'get', '/items'), {
    headers: { 'x-session-id': s },
    query: { category: ['口红'], condition: ['在用', '闲置'] },
  })
  const b = call(findRoute(accessoryRouter, 'get', '/items'), {
    headers: { 'x-session-id': s },
    query: { category: ['项链'], condition: ['良好'] },
  })
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body))
  assert.strictEqual(b.statusCode, 200, JSON.stringify(b.body))
})

test('配饰柜 /gaps 与 /suggest：档案四格过 asFilters，数组当"没填"回落默认值', () => {
  const s = sid('acc-gap')
  const res = call(findRoute(accessoryRouter, 'get', '/gaps'), {
    headers: { 'x-session-id': s },
    query: { face_shape: ['鹅蛋脸', '圆脸'], skin_tone: ['白皮'] },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  // 数组当没填 ⇒ profile.face_shape 落回 '鹅蛋脸'，不会因为数组 includes 永不命中而多报一条脸型缺口
  const faceGap = res.body.data.gaps.find((g) => g.type === 'face_shape_mismatch')
  assert.strictEqual(faceGap, undefined, '空柜不该报脸型不匹配')
})

test('库存 /products ?category_id[]=1 回 200 而不是整页 500', () => {
  const res = call(findRoute(inventoryRouter, 'get', '/products'), {
    query: { category_id: ['1', '2'] },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
})

test('规则 /groups 与 /browse：数组筛选当"没这个筛选"', () => {
  const g = call(findRoute(rulesRouter, 'get', '/groups'), {
    query: { tag: ['通勤', '约会'], category: ['上衣'] },
  })
  const b = call(findRoute(rulesRouter, 'get', '/browse'), {
    query: { mode: ['personal'], gender: ['女'] },
  })
  assert.strictEqual(g.statusCode, 200, JSON.stringify(g.body))
  assert.strictEqual(b.statusCode, 200, JSON.stringify(b.body))
})

// ============================================================
// 三、请求体畸形该 400 不该 500
// ============================================================

test('规则组 conditions:[null] 与 actions:["x"] 各回 400，说清第几条不是对象', () => {
  const r1 = call(findRoute(rulesRouter, 'post', '/groups'), {
    body: { name: 'g1', category: '上衣', mode: 'store', conditions: [null], actions: [] },
  })
  assert.strictEqual(r1.statusCode, 400, JSON.stringify(r1.body))
  assert.match(r1.body.error.message, /第 1 条条件不是对象/)

  const r2 = call(findRoute(rulesRouter, 'post', '/groups'), {
    body: { name: 'g2', category: '上衣', mode: 'store', conditions: [], actions: ['x'] },
  })
  assert.strictEqual(r2.statusCode, 400, JSON.stringify(r2.body))
  assert.match(r2.body.error.message, /第 1 条动作不是对象/)
})

test('衣橱 fit_style 填了不认得的值 ⇒ 400 说破，不再静默抹成 NULL', () => {
  const s = sid('ward-enum')
  const res = call(findRoute(wardrobeRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '衬衫', category: '上衣', fit_style: '紧身' },
  })
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body))
  assert.match(res.body.error.message, /fit_style 只能是 合体\/宽松/)
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) AS n FROM user_wardrobe WHERE session_id = ?').get(s).n,
    0,
    '拦在门外，库里一条都不该落',
  )
})

test('衣橱 fit_type（10-19 第三阶段·模块一）：四档落库、认不到的值 400、PUT 传 null 清空', () => {
  const s = sid('ward-fit-type')
  const ok = call(findRoute(wardrobeRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '廓形衬衫', category: '上衣', fit_type: '廓形' },
  })
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body))
  assert.strictEqual(ok.body.data.fit_type, '廓形', 'POST 回来的那一行要带版型')
  assert.strictEqual(
    memDb.prepare('SELECT fit_type FROM user_wardrobe WHERE id = ?').get(ok.body.data.id).fit_type,
    '廓形',
    '真的落进那一列',
  )

  const bad = call(findRoute(wardrobeRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '衬衫', category: '上衣', fit_type: '紧身' },
  })
  assert.strictEqual(bad.statusCode, 400, JSON.stringify(bad.body))
  assert.match(bad.body.error.message, /fit_type 只能是 修身\/合身\/宽松\/廓形/)

  // 没填版型 ⇒ 这一列 NULL（后端不强制必填，"必选"那条闸门在前端表单）
  const blank = call(findRoute(wardrobeRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '衬衫', category: '上衣' },
  })
  assert.strictEqual(blank.statusCode, 200, JSON.stringify(blank.body))
  assert.strictEqual(blank.body.data.fit_type, null)

  const cleared = call(findRoute(wardrobeRouter, 'put', '/items/:itemId'), {
    params: { itemId: String(ok.body.data.id) },
    headers: { 'x-session-id': s },
    body: { fit_type: null },
  })
  assert.strictEqual(cleared.statusCode, 200, JSON.stringify(cleared.body))
  assert.strictEqual(
    memDb.prepare('SELECT fit_type FROM user_wardrobe WHERE id = ?').get(ok.body.data.id).fit_type,
    null,
    'PUT 传 null＝明确清空这一档（清空后不再估松量）',
  )
})

test('衣橱 PUT 认不出的厚薄同样 400，且原有的好值不动', () => {
  const s = sid('ward-enum-put')
  const row = addWardrobe(s, { fit_style: '合体', fabric_weight: '中' })
  const res = call(findRoute(wardrobeRouter, 'put', '/items/:itemId'), {
    params: { itemId: String(row.id) },
    headers: { 'x-session-id': s },
    body: { fabric_weight: '超厚' },
  })
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body))
  const after = memDb
    .prepare('SELECT fit_style, fabric_weight FROM user_wardrobe WHERE id = ?')
    .get(row.id)
  assert.strictEqual(after.fit_style, '合体')
  assert.strictEqual(after.fabric_weight, '中', '400 之后原来那两个好值必须一个字没动')
})

// ============================================================
// 四、PUT 契约：undefined=不动这一格，null=清空
// ============================================================

test('衣橱 PUT：null 清空、缺键不动、0 元不被当没填', () => {
  const s = sid('ward-put')
  const row = addWardrobe(s, { sub_category: '衬衫', color: '白', price: 300, condition: '良好' })

  // 只动 sub_category（填新值），color 传 null 清空，price 传 0，其余不带
  const r1 = call(findRoute(wardrobeRouter, 'put', '/items/:itemId'), {
    params: { itemId: String(row.id) },
    headers: { 'x-session-id': s },
    body: { sub_category: 'T恤', color: null, price: 0 },
  })
  assert.strictEqual(r1.statusCode, 200, JSON.stringify(r1.body))
  const a = memDb
    .prepare('SELECT sub_category, color, price, condition FROM user_wardrobe WHERE id = ?')
    .get(row.id)
  assert.strictEqual(a.sub_category, 'T恤')
  assert.strictEqual(a.color, null, 'null 必须真的写成 NULL：前端清空了输入框，库里不能留着旧值')
  assert.strictEqual(a.price, 0, '0 元是真实价格（赠品/自制），不能被当成"没填"")')
  assert.strictEqual(a.condition, '良好', '没带的键不能被抹掉')

  // 标签列清空后存 NULL，不存字符串 'null'
  const r2 = call(findRoute(wardrobeRouter, 'put', '/items/:itemId'), {
    params: { itemId: String(row.id) },
    headers: { 'x-session-id': s },
    body: { style_tags: null },
  })
  assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body))
  assert.strictEqual(
    memDb.prepare('SELECT style_tags FROM user_wardrobe WHERE id = ?').get(row.id).style_tags,
    null,
  )
})

test('三柜 POST 的 price 同一把尺：0 保住、脏串归 NULL', () => {
  const s = sid('price-zero')
  const p0 = call(findRoute(wardrobeRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '赠品上衣', category: '上衣', price: 0 },
  })
  assert.strictEqual(p0.statusCode, 200, JSON.stringify(p0.body))
  assert.strictEqual(
    memDb.prepare('SELECT price FROM user_wardrobe ORDER BY id DESC LIMIT 1').get().price,
    0,
  )

  const p1 = call(findRoute(cosmeticRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '口红', category: '口红', price: '1,200' },
  })
  assert.strictEqual(p1.statusCode, 200, JSON.stringify(p1.body))
  assert.strictEqual(
    memDb.prepare('SELECT price FROM user_cosmetics ORDER BY id DESC LIMIT 1').get().price,
    null,
    '字符串脏值不能躺在 REAL 列里，跨柜价格区间一算就废',
  )

  const p2 = call(findRoute(accessoryRouter, 'post', '/items'), {
    headers: { 'x-session-id': s },
    body: { name: '项链', category: '项链', price: 0 },
  })
  assert.strictEqual(p2.statusCode, 200, JSON.stringify(p2.body))
  assert.strictEqual(
    memDb.prepare('SELECT price FROM user_accessories ORDER BY id DESC LIMIT 1').get().price,
    0,
  )
})

// ============================================================
// 五、状态列空值必须算"在柜内"
// ============================================================

test('配饰柜 /gaps：condition 为 NULL 的那件算在柜内', () => {
  const s = sid('acc-null-cond')
  addAccessory(s, { category: '项链', condition: null })
  addAccessory(s, { category: '项链', condition: '已淘汰' })
  const res = call(findRoute(accessoryRouter, 'get', '/gaps'), {
    headers: { 'x-session-id': s },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const stats = res.body.data.stats
  assert.strictEqual(stats.total, 1, '空状态的那件在柜内，已淘汰的那件不在')
  assert.strictEqual(
    stats.by_category['项链'],
    1,
    '改前这里是 0：NULL != 已淘汰 在 SQLite 里回 NULL，整行被筛掉',
  )
})

test('化妆柜 /gaps：condition 为空同样进计数', () => {
  const s = sid('cos-null-cond')
  addCosmetic(s, { category: '口红', condition: '' })
  const res = call(findRoute(cosmeticRouter, 'get', '/gaps'), { headers: { 'x-session-id': s } })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const lip = res.body.data.gaps.find((g) => g.type === 'category_lip')
  assert.ok(lip, '唇妆缺口应在')
  assert.match(lip.message, /仅1件/, '空状态的那件必须被数进来')
})

test('优先级排序用 ??：high 排最前，不再被 `0 || 3` 打成最后', () => {
  const s = sid('acc-order')
  // 项链/耳饰各 1 件 ⇒ medium（min 2）；戒指/手链/胸针一件没有 ⇒ high（count 0）
  // 两件配饰都只标"适合鹅蛋脸"，而档案是圆脸 ⇒ 追加一条 face_shape_mismatch（low）
  addAccessory(s, { category: '项链', face_shape_fit: '["鹅蛋脸"]' })
  addAccessory(s, { category: '耳钉', face_shape_fit: '["鹅蛋脸"]' })
  const res = call(findRoute(accessoryRouter, 'get', '/suggest'), {
    headers: { 'x-session-id': s },
    query: { face_shape: '圆脸' },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const list = res.body.data
  const rank = { high: 0, medium: 1, low: 2 }
  const seen = list.map((x) => x.priority)
  assert.ok(
    seen.includes('high') && seen.includes('low'),
    `样本要同时含 high 与 low 才验得到排序，实测 ${seen}`,
  )
  assert.strictEqual(list[0].priority, 'high', '最要紧的缺口必须排第一')
  for (let i = 1; i < list.length; i++) {
    assert.ok(
      rank[list[i - 1].priority] <= rank[list[i].priority],
      `第 ${i} 条 ${list[i].priority} 排在 ${list[i - 1].priority} 前面`,
    )
  }
})

// ============================================================
// 六、化妆品日期算不出来不再永久漏报
// ============================================================

test('/expiry：脏日期的条出现在预警里，不再"看着 0 件要处理"其实是算不出来', () => {
  const s = sid('cos-expiry')
  addCosmetic(s, { name: '脏日期', opened_date: '乱写', expiry_months: 12 })
  addCosmetic(s, { name: '已过期', opened_date: '2000-01-01', expiry_months: 6 })
  addCosmetic(s, { name: '没填日期', opened_date: null, expiry_months: null })
  const res = call(findRoute(cosmeticRouter, 'get', '/expiry'), { headers: { 'x-session-id': s } })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const list = res.body.data
  const dirty = list.filter((i) => i.name === '脏日期')
  assert.strictEqual(dirty.length, 1, '标了"日期无法解析"的条必须出现在预警列表里')
  assert.strictEqual(dirty[0].status, '日期无法解析')
  assert.strictEqual(dirty[0].days_left, null)
  assert.ok(list.some((i) => i.name === '已过期' && i.status === '已过期'))
  assert.ok(!list.some((i) => i.name === '没填日期'), '没填开封日期的是"按在用处理"，不算预警')
})

// ============================================================
// 七、跨柜：候选池与"柜里有几件"分开数
// ============================================================

test('/recommend 的 summary 是真柜数，不再被候选池的 LIMIT 20 冒充', () => {
  const s = sid('cross-count')
  for (let i = 0; i < 25; i++) addWardrobe(s, { name: `上衣${i}`, category: '上衣' })
  addCosmetic(s, { category: '口红', condition: null })
  addAccessory(s, { category: '项链', condition: null })
  const res = call(findRoute(crossCabinetRouter, 'get', '/recommend'), {
    headers: { 'x-session-id': s },
    query: { occasion: '上班通勤' },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(res.body.data.summary.wardrobe_count, 25)
  assert.strictEqual(res.body.data.summary.cosmetic_count, 1, '空状态的那件也算在柜内')
  assert.strictEqual(res.body.data.summary.accessory_count, 1)
})

test('/seasonal：没打季节标签的单品按"四季都能穿"计', () => {
  const s = sid('cross-season')
  for (let i = 0; i < 6; i++) addWardrobe(s, { name: `无标签${i}`, season_tags: '[]' })
  const res = call(findRoute(crossCabinetRouter, 'get', '/seasonal'), {
    headers: { 'x-session-id': s },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const d = res.body.data
  assert.strictEqual(d.wardrobe.total, 6)
  assert.strictEqual(d.wardrobe.season_items, 6, '没打季节标签＝四季都能穿，改前这里是 0')
  assert.strictEqual(d.wardrobe.need_attention, false, '当季 6 件不该再报"建议补充当季单品"')
})

test('/brands：件数是真柜数，品牌榜单仍只取前 10', () => {
  const s = sid('cross-brand')
  for (let i = 0; i < 12; i++) addCosmetic(s, { name: `b${i}`, brand: `品牌${i}` })
  const res = call(findRoute(crossCabinetRouter, 'get', '/brands'), {
    headers: { 'x-session-id': s },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(res.body.data.summary.cosmetic_count, 12, '原来这里是"前 10 个品牌的件数"')
  assert.strictEqual(res.body.data.cosmetic_brands.length, 10)
})

test('/brands：只填了季节标签的单品也能进风格偏好', () => {
  const s = sid('cross-style')
  addWardrobe(s, { style_tags: '[]', season_tags: '["夏"]' })
  const res = call(findRoute(crossCabinetRouter, 'get', '/brands'), {
    headers: { 'x-session-id': s },
  })
  assert.ok(
    res.body.data.style_preferences.includes('夏'),
    'parseJsonField 恒回数组 ⇒ 老的 `||` 兜底是死码',
  )
})

test('/health：已淘汰的上衣不再证明"品类齐"', () => {
  const s = sid('cross-health')
  for (let i = 0; i < 3; i++)
    addWardrobe(s, { name: `淘汰${i}`, category: '上衣', condition: '已淘汰' })
  const res = call(findRoute(crossCabinetRouter, 'get', '/health'), {
    headers: { 'x-session-id': s },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const ward = res.body.data.wardrobe_health
  assert.strictEqual(ward.total, 3, '总数仍按柜内实际条数给')
  assert.deepStrictEqual(ward.categories, [], '全标已淘汰后不该再算出任何品类')
  assert.ok(
    ward.missing_essentials.includes('上衣'),
    `已淘汰的上衣不能证明"品类齐"，实测 ${JSON.stringify(ward.missing_essentials)}`,
  )
})

// ============================================================
// 八、匿名/详情接口的字段面
// ============================================================

test('创作者公开详情不再下发 admin_note 与 user_id', () => {
  const u = mkUser('作者甲', 'author-note')
  memDb
    .prepare(
      `INSERT INTO creator_works (user_id, share_code, type, title, payload, status, admin_note)
       VALUES (?, 'sc-note-1', 'outfit', '标题', '{}', 'approved', '违规原因：内部话术')`,
    )
    .run(u.lastInsertRowid)
  const id = memDb.prepare('SELECT id FROM creator_works ORDER BY id DESC LIMIT 1').get().id
  const res = call(findRoute(creatorRouter, 'get', '/works/:id'), { params: { id: String(id) } })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.ok(!('admin_note' in res.body.data), '后台审核备注不能出现在匿名详情里')
  assert.ok(!('user_id' in res.body.data))
  assert.strictEqual(
    res.body.data.author_name,
    '作者甲',
    '对外只给改名后的 author_name，前端按这个键显示作者',
  )
  assert.ok(!('nickname' in res.body.data), 'users.nickname 这个原始列名不该再发出去')
})

test('历史详情与列表同一份列名：回 result_json/scenario，不回原始列', () => {
  const u = mkUser('甲', 'hist-detail')
  memDb
    .prepare(
      `INSERT INTO recommendation_logs (session_id, mode, result, user_id)
       VALUES ('sid-hist', 'personal', '{"a":1}', ?)`,
    )
    .run(u.lastInsertRowid)
  const logId = memDb
    .prepare('SELECT id FROM recommendation_logs ORDER BY id DESC LIMIT 1')
    .get().id
  const res = call(findRoute(historyRouter, 'get', '/:id'), {
    params: { id: String(logId) },
    user: { id: u.lastInsertRowid },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const d = res.body.data.record
  assert.ok(d && 'result_json' in d, '前端按 result_json 读，详情必须给同一个键名')
  assert.strictEqual(d.scenario, 'personal')
  assert.ok(!('mode' in d) && !('result' in d), '原始列名不该再发出去')
  assert.ok(!('session_id' in d) && !('input_snapshot' in d), '游客 sid 与画像快照不该随详情下发')

  // 列表与详情必须同一份列名：这两个接口给同一个 id 回不同键名，前端必踩 undefined
  const list = call(findRoute(historyRouter, 'get', '/'), { user: { id: u.lastInsertRowid } })
  assert.strictEqual(list.statusCode, 200, JSON.stringify(list.body))
  const row = list.body.data.history[0]
  assert.deepStrictEqual(
    Object.keys(row).sort(),
    Object.keys(d).sort(),
    `详情与列表列名不一致：${JSON.stringify(Object.keys(row))} vs ${JSON.stringify(Object.keys(d))}`,
  )
})

// ============================================================
// 九、被 LIMIT 截过的列表要报真总数
// ============================================================

test('凭证 /admin/list：total 是真 COUNT，list 仍被 200 截', () => {
  const u = mkUser('甲', 'deposit-admin')
  const uid = u.lastInsertRowid
  const ins = memDb.prepare(
    "INSERT INTO deposits (user_id, amount, status, created_at) VALUES (?, 1, 'pending', ?)",
  )
  for (let i = 0; i < 201; i++) ins.run(uid, day(-i))
  const real = memDb.prepare('SELECT COUNT(*) AS n FROM deposits').get().n
  const res = call(findRoute(paymentRouter, 'get', '/admin/list'), { query: {} })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(res.body.data.total, real, 'total 必须是库里的真 COUNT，不是被 200 截过的条数')
  assert.ok(real > 200, `本用例的前提是条数超过 LIMIT，实测 ${real}`)
  assert.strictEqual(res.body.data.list.length, 200)
  assert.strictEqual(res.body.data.limit, 200)
})

test('作品 /admin/list 与 /my：总数与汇总都走聚合，不受 LIMIT 影响', () => {
  const u = mkUser('作者乙', 'author-agg')
  const uid = u.lastInsertRowid
  const ins = memDb.prepare(
    `INSERT INTO creator_works (user_id, share_code, type, title, payload, status, heat, share_views)
     VALUES (?, ?, 'outfit', 't', '{}', 'approved', 3, 2)`,
  )
  for (let i = 0; i < 105; i++) ins.run(uid, `sc-my-${i}`)

  const mine = call(findRoute(creatorRouter, 'get', '/my'), { user: { id: uid } })
  assert.strictEqual(mine.statusCode, 200, JSON.stringify(mine.body))
  assert.strictEqual(mine.body.data.total, 105, '「N 提交」不能只数到 100')
  assert.strictEqual(mine.body.data.items.length, 100)
  assert.strictEqual(mine.body.data.limit, 100)
  assert.strictEqual(mine.body.data.totals.approved, 105)
  assert.strictEqual(mine.body.data.totals.heat, 315, '总浏览必须按全部作品聚合，不是最近 100 条')
  assert.strictEqual(mine.body.data.totals.share_views, 210)

  const admin = call(findRoute(creatorRouter, 'get', '/admin/list'), { query: {} })
  const allWorks = memDb.prepare('SELECT COUNT(*) AS n FROM creator_works').get().n
  assert.strictEqual(admin.body.data.total, allWorks, '后台 total 要走 COUNT，不受 200 截断')
  assert.strictEqual(admin.body.data.limit, 200)
})

test('会员账号 /admin/accounts：total 走 COUNT(*)，并把 limit 一起带回', () => {
  const res = call(findRoute(authRouter, 'get', '/admin/accounts'), { query: {} })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const real = memDb.prepare('SELECT COUNT(*) AS n FROM user_accounts').get().n
  assert.strictEqual(res.body.data.total, real)
  assert.strictEqual(res.body.data.limit, 500)
})

// ============================================================
// 十、顾客会话过期：只删"还没同步"的那一份
// ============================================================

function seedSession(name, { expiresAt, synced = 0, withLog = true }) {
  const sessionId = sid(name)
  memDb
    .prepare(
      `INSERT INTO customer_sessions (session_id, profile_data, synced, expires_at, created_at)
       VALUES (?, '{}', ?, ?, ?)`,
    )
    .run(sessionId, synced, expiresAt, day(-1))
  if (withLog) {
    memDb
      .prepare(
        `INSERT INTO recommendation_logs (session_id, mode, result)
         VALUES (?, 'store', '{}')`,
      )
      .run(sessionId)
  }
  return sessionId
}

test('过期 GET：未同步的会话连同样本一起清掉', () => {
  const sessionId = seedSession('exp-get', { expiresAt: day(-1) })
  const res = call(findRoute(customerRouter, 'get', '/session/:sessionId'), {
    params: { sessionId },
  })
  assert.strictEqual(res.statusCode, 404)
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) AS n FROM customer_sessions WHERE session_id = ?').get(sessionId)
      .n,
    0,
  )
  assert.strictEqual(
    memDb
      .prepare('SELECT COUNT(*) AS n FROM recommendation_logs WHERE session_id = ?')
      .get(sessionId).n,
    0,
    '会话行删了样本必须跟着删，否则 input_snapshot 变成无主数据长期留在库里',
  )
})

test('过期 GET：已同步的会话行必须留着（门店要靠它对账）', () => {
  const sessionId = seedSession('exp-synced', { expiresAt: day(-1), synced: 1 })
  const res = call(findRoute(customerRouter, 'get', '/session/:sessionId'), {
    params: { sessionId },
  })
  assert.strictEqual(res.statusCode, 404)
  assert.strictEqual(
    memDb.prepare('SELECT synced FROM customer_sessions WHERE session_id = ?').get(sessionId)
      .synced,
    1,
    '刷一次页面就把门店那条记录删掉，是收付款/对账的事故面',
  )
})

test('过期后再 DELETE：会话行早没了，无主样本仍然被清', () => {
  const sessionId = seedSession('exp-del', { expiresAt: day(-1) })
  call(findRoute(customerRouter, 'get', '/session/:sessionId'), { params: { sessionId } })
  // 上面那次 GET 已经把会话+样本删干净，这里换一个只剩样本的会话来验
  const orphan = sid('orphan-logs')
  memDb
    .prepare(`INSERT INTO recommendation_logs (session_id, mode, result) VALUES (?, 'store', '{}')`)
    .run(orphan)
  const res = call(findRoute(customerRouter, 'delete', '/session/:sessionId'), {
    params: { sessionId: orphan },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) AS n FROM recommendation_logs WHERE session_id = ?').get(orphan)
      .n,
    0,
  )
})

// ============================================================
// 十一、「删除我的全部数据」要把只挂 session_id 的柜表也删掉
// ============================================================

test('analysis DELETE /archive：登录后只按 session_id 存的柜表同样被删', () => {
  const sessionId = sid('archive-me')
  const u = memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run('删除我', sessionId)
  const uid = u.lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO customer_sessions (session_id, profile_data, expires_at, created_at)
       VALUES (?, '{}', ?, ?)`,
    )
    .run(sessionId, day(1), day(0))
  // 三柜的 POST 只写 session_id，user_id 一直是 NULL（10-13 现量）
  addWardrobe(sessionId, { user_id: null })
  addCosmetic(sessionId, { user_id: null })
  addAccessory(sessionId, { user_id: null })
  memDb
    .prepare(`INSERT INTO shopping_wishlist (session_id, item_name, user_id) VALUES (?, 'x', NULL)`)
    .run(sessionId)

  const res = call(findRoute(analysisRouter, 'delete', '/archive'), {
    user: { id: uid, session_id: sessionId },
    headers: { 'x-session-id': sessionId },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const left = memDb
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_wardrobe WHERE session_id = ?) AS w,
         (SELECT COUNT(*) FROM user_cosmetics WHERE session_id = ?) AS c,
         (SELECT COUNT(*) FROM user_accessories WHERE session_id = ?) AS a,
         (SELECT COUNT(*) FROM shopping_wishlist WHERE session_id = ?) AS p`,
    )
    .get(sessionId, sessionId, sessionId, sessionId)
  assert.deepStrictEqual(
    left,
    { w: 0, c: 0, a: 0, p: 0 },
    '接口回 200 却一条都没删，是最难被发现的那种假承诺',
  )
})

// ============================================================
// 十二、日志脱敏：编码过的键名也要认
// ============================================================

test('maskQuery：%74oken／token[0]／Token 变体一律抹掉，session_id 数组写法只留前 8 位', () => {
  // maskQuery 的入参是「切掉 ? 之后的 query 串」；带 ? 的写法也要拦得住（见函数里那段注释）
  assert.match(maskQuery('?%74oken=abc123'), /%74oken=\*\*\*/, '解码后是 token 就得拦')
  assert.match(maskQuery('%74oken=abc123'), /^%74oken=\*\*\*$/)
  assert.match(maskQuery('token%5B0%5D=abc123'), /^token%5B0%5D=\*\*\*$/, '数组写法照样抹')
  assert.match(maskQuery('ToKeN=abc123'), /^ToKeN=\*\*\*$/, '大小写变体照样抹')
  assert.strictEqual(
    maskQuery('session_id%5B0%5D=abcdefghijklmnop'),
    'session_id%5B0%5D=abcdefgh…',
    '游客 sid 只留前 8 位，够认出是谁、不够拿去用',
  )
  assert.ok(
    !maskQuery('session_id%5B%5D=abcdefghijklmnop1234').includes('ijklmnop1234'),
    '整串落盘就是凭据外泄',
  )
  assert.strictEqual(maskQuery('color=%E7%99%BD'), 'color=%E7%99%BD', '非敏感参数原样留着')
  assert.strictEqual(maskQuery(''), '', '空串不该抛')
  assert.strictEqual(maskQuery(undefined), '', 'query 整个缺失也不该抛')
})

// ============================================================
// 十三、纯函数：档位取整、色度补 C、词表补齐、原型链取值
// ============================================================

test('BMI 先取整再切档：印出来的 18.5 落在「正常」', () => {
  const b = healthBand(18.47)
  assert.strictEqual(b.bmi, 18.5)
  assert.strictEqual(b.bmi_level, '正常', '显示值与档位必须同源，否则顾客自己一查就是另一档')
  assert.strictEqual(gbBand(18.47).cn, '正常')
  assert.strictEqual(healthBand(18.44).bmi_level, '偏瘦')
})

test('colorFit：肤色缺 a/b 时不给 NaN，且不改调用方传进来的对象', () => {
  assert.strictEqual(colorFit({ L: 60 }, '#FFCC00'), null, '缺 a/b 算不出 C ⇒ 整条不给分')
  const shared = { L: 60, a: 12, b: 20 }
  const out = colorFit(shared, '#FFCC00')
  assert.ok(Number.isFinite(out.score))
  assert.ok(!('C' in shared), '共享常量对象被写脏会污染之后每一次取色')
})

test('fullLook：羽绒服认得是外套，一条裙子不会同时占上装和下装', () => {
  const look = buildFullLook({
    outfit: [
      { name: '白羽绒', category: '羽绒服' },
      { name: '针织吊带裙', category: '连衣裙' },
    ],
  })
  const slots = look.pieces.map((p) => p.slot)
  assert.ok(slots.includes('一件成套') || slots.includes('下装'))
  assert.strictEqual(
    look.pieces.filter((p) => p.name === '针织吊带裙').length,
    1,
    '同一件衣服被列两格会让"凑没凑齐一套"的判定跟着错',
  )

  const look2 = buildFullLook({
    outfit: [
      { name: '针织开衫', category: '针织衫' },
      { name: '长款羽绒', category: '羽绒服' },
      { name: '牛仔裤', category: '裤子' },
    ],
  })
  assert.ok(
    look2.pieces.some((p) => p.slot === '外搭'),
    `羽绒服必须能当外搭，实测 ${JSON.stringify(look2.pieces)}`,
  )
  // 词表串档的正例：'针织裙' 同时含 TOP_WORDS 的 '针织' 与 BOTTOM_WORDS 的 '裙'，
  // 但不在 DRESS_WORDS 里 ⇒ 走上下装那条分支，改前同一件会被列成"上装+下装"两格
  const look3 = buildFullLook({
    outfit: [{ name: '针织裙', category: '针织裙' }],
  })
  assert.strictEqual(
    look3.pieces.filter((p) => p.name === '针织裙').length,
    1,
    `只有一件衣服时不该占上装+下装两格，实测 ${JSON.stringify(look3.pieces)}`,
  )
  assert.ok(
    look3.missing_parts.includes('下装'),
    `下装没被占到就得报缺口，实测 ${JSON.stringify(look3.missing_parts)}`,
  )
})

test('computeProportionLevels：constructor/__proto__ 这类键名不再取到原型上的东西', () => {
  for (const key of ['constructor', '__proto__', 'toString']) {
    const out = computeProportionLevels({ leg_status: key, shoulder_status: key, wh_status: key })
    assert.ok(!('leg_proportion' in out), `${key} 不该被当成档位名`)
    assert.ok(!('shoulder_frame' in out))
    assert.ok(!('waist_definition' in out))
    assert.strictEqual(JSON.stringify(out), '{}')
  }
  // 正常档位码要照常换算（PROPORTION_LEVEL_LABELS 的键是引擎内部英文状态码）
  assert.deepStrictEqual(computeProportionLevels({ leg_status: 'short' }), {
    leg_proportion: '偏短',
  })
  assert.deepStrictEqual(computeProportionLevels({ shoulder_status: 'wide' }), {
    shoulder_frame: '偏宽',
  })
  assert.deepStrictEqual(computeProportionLevels({ wh_status: 'good' }), {
    waist_definition: '明显',
  })
  // 肩宽缺失时用肩型兜底
  assert.deepStrictEqual(computeProportionLevels({ shoulder_type: '窄肩' }), {
    shoulder_frame: '偏窄',
  })
})

test('enrichProfile 把英文/数字性别归一成 男/女 并写回，认不出来的原样留着', () => {
  assert.strictEqual(enrichProfile({ gender: 'male' }).gender, '男')
  assert.strictEqual(enrichProfile({ gender: 'F' }).gender, '女')
  assert.strictEqual(enrichProfile({ gender: '1' }).gender, '男')
  assert.strictEqual(enrichProfile({ gender: '不写男的女的' }).gender, '不写男的女的')
})

// ============================================================
// 十四、DashScope 轮询：确定性拒绝要立刻失败
// ============================================================

test('pollTryonResult 遇 401 立刻抛「查询被拒」，不再白等 60 秒报超时', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"code":"InvalidApiKey","message":"Invalid API-key provided."}',
  })
  try {
    const t0 = Date.now()
    await assert.rejects(
      pollTryonResult('bad-key', 'task-1', 30, 50),
      /查询被拒\(HTTP 401 InvalidApiKey\)/,
    )
    assert.ok(Date.now() - t0 < 1000, '一次就退出，不该按 interval×maxRetries 空转')
  } finally {
    globalThis.fetch = real
  }
})

test('pollTryonResult 遇 5xx 与网络异常仍按抖动重试，最后报超时', async () => {
  const real = globalThis.fetch
  let n = 0
  globalThis.fetch = async () => {
    n++
    if (n === 1) return { ok: false, status: 503, text: async () => '' }
    throw new Error('网络断了')
  }
  try {
    await assert.rejects(pollTryonResult('k', 't', 3, 1), /虚拟试穿任务超时/)
    assert.strictEqual(n, 3, '5xx/异常都该继续下一次轮询')
  } finally {
    globalThis.fetch = real
  }
})

// ============================================================
// 十五、seed 全删重建不再丢掉 source_key
// ============================================================

test('seedAll 的 INSERT 按"实际列 ∩ JSON 键"生成：新列不再被写死的 13 列丢掉', () => {
  // 为什么用合成 JSON 而不是真种子：10-13 现量 db/seed/rules.json 的 264 组里
  // source_key 有 0 条（source_key 是运行库里的列，真种子只带 13 个老列），
  // 拿真 JSON 跑一遍再 diff 库，两条腿都是空的，证不出这条修复。
  const synthetic = {
    rule_groups: [
      {
        name: '合成组',
        category: '穿搭',
        mode: 'store',
        source_key: 'sk-synthetic-1',
        evidence_level: 'A',
        feedback_up: 7,
        feedback_down: 2,
        last_hit_at: '2026-10-13 08:00:00',
      },
    ],
    rule_conditions: [{ group_id: 1, field: 'gender', operator: 'eq', value: '女', weight: 1 }],
    rule_actions: [{ group_id: 1, action_type: 'tip', content: '合成动作', sort_order: 0 }],
    inventory_categories: [],
  }

  const fresh = new Database(':memory:')
  fresh.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))

  const realRead = fs.readFileSync
  const realWrite = process.stdout.write
  fs.readFileSync = function (p, ...rest) {
    const s = String(p)
    if (s.endsWith('seed' + path.sep + 'rules.json') || s.endsWith('seed/rules.json'))
      return JSON.stringify(synthetic)
    if (s.endsWith('seed' + path.sep + 'inventory.json') || s.endsWith('seed/inventory.json'))
      return JSON.stringify({ inventory_categories: [] })
    return realRead.call(fs, p, ...rest)
  }
  // seedAll 收尾会 console.log 一行导入统计；那是给命令行看的，留在测试输出里是噪音
  process.stdout.write = () => true
  let err = null
  try {
    require('../db/seed').seedAll(fresh)
  } catch (e) {
    err = e
  } finally {
    fs.readFileSync = realRead
    process.stdout.write = realWrite
  }
  assert.strictEqual(err, null, `seedAll 不该抛：${err && err.message}`)

  const row = fresh
    .prepare(
      'SELECT source_key, evidence_level, feedback_up, feedback_down, last_hit_at FROM rule_groups',
    )
    .get()
  assert.strictEqual(
    row.source_key,
    'sk-synthetic-1',
    '丢 source_key ⇒ applyRuleSeeds 会把整批种子当缺失重插',
  )
  assert.strictEqual(row.evidence_level, 'A')
  assert.strictEqual(row.feedback_up, 7, '反馈累计计数不能在全删重建时归零')
  assert.strictEqual(row.feedback_down, 2)
  assert.strictEqual(row.last_hit_at, '2026-10-13 08:00:00')
  assert.strictEqual(fresh.prepare('SELECT COUNT(*) AS n FROM rule_conditions').get().n, 1)
  assert.strictEqual(fresh.prepare('SELECT COUNT(*) AS n FROM rule_actions').get().n, 1)
  fresh.close()
})

test('export-rules 用只读句柄，不再 require 会动库的 db/init', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'export-rules.js'), 'utf-8')
  // 注释里合法地写着"原先 require('./init')"这类解释，剥掉注释再判，否则这条断言
  // 会被自己的说明文字打红（10-13 现量：改后文件仍含 1 处 ./init，在注释里）。
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    !/require\(['"]\.\/init['"]\)/.test(src),
    'init.js 加载就跑 initAll()：导出会顺带写活库',
  )
  assert.match(src, /new Database\([^)]*readonly:\s*true/, '必须自己开只读句柄')
  // fs.writeFileSync 是正当的（它就是把规则导出成 seed JSON 文件），这里只拦库侧写入
  assert.ok(
    !/\bINSERT\b|\bUPDATE\b|\bDELETE FROM|\.exec\(|\.run\(/.test(src),
    '导出脚本不该有任何库写入',
  )
})
