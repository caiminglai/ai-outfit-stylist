/**
 * 穿搭日记（`wardrobe_outfits`）四条路由的行为测试（2026-10-20 第八阶段·第一步 一c）
 *
 * 背景：这一轮之前日记只有 GET + POST，且 POST 的 INSERT 只写 6 列——`user_id`、`rating`
 * 两格压根没进列清单（schema.sql:386-394 里它们一直是有的，本轮**没有**补列），
 * 场合是自由文本、星级没人收、改和删两条口全仓没有 ⇒ 前端一次调用都没发出去过（现量见
 * docs/依据/16 §一·1.2）。日记是"隐性偏好"的唯一原料，这条路不通 ⇒ 协同过滤与偏好画像都没输入。
 *
 * 钉六件事（全是**行为**证据：起临时实例真发 HTTP，不是源码级钉桩）：
 *  ① POST 落 `user_id` + `rating`，场合只认规则库在用的那五组词（表外词 400，不许静默落 NULL）；
 *  ② GET 按「session 或 user」两条口径取并集（换设备/清 session 不弄丢自己前面记的）；
 *  ③ PUT 的字段级契约：`undefined＝不动／null＝清空`，与衣橱单品 PUT 同一把尺子；
 *  ④ PUT 收到畸形值 ⇒ 400 **且旧值原封不动**（10-13 现量过的"静默抹成 NULL + 前端弹已保存"不许在这里重演）；
 *  ⑤ 越权一律 404、不返回 403（403 等于把"这行存在"白送给脚本）；
 *  ⑥ DELETE 只删搭配这一行，**衣物一件不少**。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 test/uploadsAccess.test.js 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。实例用 `express()` 直接挂 `routes/wardrobe`，
 * 不过 server.js 的全局闸与 loginRequired（那条链的行为证据在宿主机真实例上另跑，
 * 见 docs/依据/10 本轮台账与《第八阶段进展报告》）。
 * 运行: node --test test/wardrobeDiaryRoutes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

// 场合词表 = 规则库在用的那五个词（路由是每次现从 rule_conditions 取的，这里造出同样的行）
for (const occ of ['上班通勤', '约会聚会', '婚礼宴会', '运动健身', '居家休闲']) {
  const gid = memDb
    .prepare(`INSERT INTO rule_groups (name, category, priority) VALUES (?, 'occasion', 1)`)
    .run(`日记词表测试-${occ}`).lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value)
       VALUES (?, 'occasion', 'eq', ?)`,
    )
    .run(gid, JSON.stringify(occ))
}

const express = require('express')
const wardrobeRoutes = require('../routes/wardrobe')
const app = express()
app.use(express.json())
app.use('/api/wardrobe', wardrobeRoutes)

const SESS_A = 'sess-diary-a'
const SESS_B = 'sess-diary-b'
const SESS_OTHER = 'sess-diary-other'

let server
let base = ''

/** 发一条请求，回 { status, body }（不分形状，断言按 status + data/error 自己挑） */
async function call(method, route, body, session = SESS_A) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session === null ? {} : { 'x-session-id': session }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

function addWardrobe(session, name) {
  return memDb
    .prepare(`INSERT INTO user_wardrobe (session_id, name, category) VALUES (?, ?, 'top')`)
    .run(session, name).lastInsertRowid
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
  base = `http://127.0.0.1:${server.address().port}/api/wardrobe`
})

test.after(() => {
  if (server) server.close()
})

let itemA = 0
let outfitId = 0

test('① POST：user_id 与 rating 真落库，场合认词表内的值', async () => {
  itemA = addWardrobe(SESS_A, '白衬衫')
  const other = addWardrobe(SESS_A, '黑裤子')
  const r = await call('POST', '/outfits', {
    name: '周一通勤',
    item_ids: [itemA, other],
    occasion: '上班通勤',
    season: '春',
    rating: 4,
    notes: '怕冷加了件外套',
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.item_ids.length, 2, 'item_ids 回的是解析后的数组，不是 JSON 串')
  const row = memDb.prepare('SELECT * FROM wardrobe_outfits WHERE id = ?').get(r.body.data.id)
  assert.ok(row.user_id, 'user_id 必须落进去（游客也有一行，日记才能按人学偏好）')
  assert.equal(row.rating, 4)
  assert.equal(row.occasion, '上班通勤')
  const guest = memDb.prepare('SELECT session_id FROM users WHERE id = ?').get(row.user_id)
  assert.equal(guest.session_id, SESS_A, 'user_id 指向的必须是本会话那行，不是别人的')
})

test('① POST 闸门：表外场合 400／星级越界 400／别人的衣物 400，一行都不落', async () => {
  const before = memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits').get().n
  const badOcc = await call('POST', '/outfits', {
    name: '乱填场合',
    item_ids: [itemA],
    occasion: '去夜市撸串',
  })
  assert.equal(badOcc.status, 400)
  assert.match(badOcc.body.error.message, /occasion 只能是/)
  const badRating = await call('POST', '/outfits', {
    name: '星级越界',
    item_ids: [itemA],
    rating: 6,
  })
  assert.equal(badRating.status, 400)
  assert.match(badRating.body.error.message, /评分只能是 1~5/)
  const foreignItem = addWardrobe(SESS_OTHER, '陌生人的外套')
  const badItems = await call('POST', '/outfits', { name: '挂别人衣服', item_ids: [foreignItem] })
  assert.equal(badItems.status, 400)
  assert.match(badItems.body.error.message, /不属于当前会话/)
  assert.equal(
    memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits').get().n,
    before,
    '三条畸形请求都不该落库',
  )
})

test('① POST 场合留空是合法的（缺测不编造），星级没填＝NULL', async () => {
  const r = await call('POST', '/outfits', { name: '只记了衣服', item_ids: [itemA] })
  assert.equal(r.status, 200)
  const row = memDb.prepare('SELECT * FROM wardrobe_outfits WHERE id = ?').get(r.body.data.id)
  assert.equal(row.occasion, null)
  assert.equal(row.rating, null)
})

test('② GET：换会话但同一个 user 也能看见自己前面记的（并集口径）', async () => {
  // 模拟"换设备/清了 session"：先给 SESS_B 造一行 users，再把一条老日记的 user_id 指过去
  memDb.prepare('INSERT INTO users (session_id) VALUES (?)').run(SESS_B)
  const uid = memDb.prepare('SELECT id FROM users WHERE session_id = ?').get(SESS_B).id
  memDb
    .prepare(
      `INSERT INTO wardrobe_outfits (session_id, user_id, name, item_ids)
       VALUES ('sess-diary-已作废的旧会话', ?, '换设备前记的', '[]')`,
    )
    .run(uid)
  const r = await call('GET', '/outfits', undefined, SESS_B)
  assert.equal(r.status, 200)
  const names = r.body.data.outfits.map((o) => o.name)
  assert.ok(names.includes('换设备前记的'), '按 user_id 也要取到（只按 session 取就会丢）')
  assert.ok(!names.includes('周一通勤'), 'A 会话的日记不该串进 B 会话')
  // ①-d 前端下拉的词表与后端闸门同源：GET 必须把当下收得了的词一起带出去（顺序是 .sort() 的结果）
  assert.deepEqual(r.body.data.occasions, [
    '上班通勤',
    '婚礼宴会',
    '居家休闲',
    '约会聚会',
    '运动健身',
  ])
})

test('③ PUT：只带 rating ⇒ 其余格子一律不动', async () => {
  const list = await call('GET', '/outfits')
  outfitId = list.body.data.outfits.find((o) => o.name === '周一通勤').id
  const r = await call('PUT', `/outfits/${outfitId}`, { rating: 5 })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.rating, 5)
  assert.equal(r.body.data.name, '周一通勤', 'name 没带 ⇒ 不该被动')
  assert.equal(r.body.data.occasion, '上班通勤')
  assert.equal(r.body.data.notes, '怕冷加了件外套')
  assert.equal(r.body.data.season, '春')
})

test('③ PUT：显式 null＝清空，空串也清空；is_favorite 走布尔', async () => {
  const r = await call('PUT', `/outfits/${outfitId}`, {
    occasion: null,
    notes: '',
    is_favorite: true,
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.occasion, null, '传 null 就是要抹掉这一格')
  assert.equal(r.body.data.notes, null)
  assert.equal(r.body.data.is_favorite, true)
  assert.equal(
    memDb.prepare('SELECT is_favorite FROM wardrobe_outfits WHERE id = ?').get(outfitId)
      .is_favorite,
    1,
  )
})

test('④ PUT 畸形值：400 且旧值一个字都没被抹（静默归 NULL 那一课不许重演）', async () => {
  await call('PUT', `/outfits/${outfitId}`, { occasion: '上班通勤', rating: 3 })
  const bad = await call('PUT', `/outfits/${outfitId}`, { occasion: '去夜市撸串' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error.message, /occasion 只能是/)
  const after = memDb
    .prepare('SELECT occasion, rating FROM wardrobe_outfits WHERE id = ?')
    .get(outfitId)
  assert.equal(after.occasion, '上班通勤', '被拒的请求绝不能改到这一格')
  assert.equal(after.rating, 3)
  const badRating = await call('PUT', `/outfits/${outfitId}`, { rating: '三颗星' })
  assert.equal(badRating.status, 400)
  assert.match(badRating.body.error.message, /评分只能是 1~5/)
})

test('④ PUT 必填两列不接受清空；空调用与畸形 ID 各自说破', async () => {
  const noName = await call('PUT', `/outfits/${outfitId}`, { name: '   ' })
  assert.equal(noName.status, 400)
  assert.match(noName.body.error.message, /name 不能为空/)
  const noItems = await call('PUT', `/outfits/${outfitId}`, { item_ids: null })
  assert.equal(noItems.status, 400)
  assert.match(noItems.body.error.message, /item_ids 不能为空/)
  const empty = await call('PUT', `/outfits/${outfitId}`, {})
  assert.equal(empty.status, 400)
  assert.match(empty.body.error.message, /没有需要更新的字段/)
  const badId = await call('PUT', '/outfits/abc', { rating: 2 })
  assert.equal(badId.status, 400)
  assert.match(badId.body.error.message, /正整数/)
})

test('⑤ 越权：PUT/DELETE 别人的行一律 404（不回 403）', async () => {
  const mine = memDb.prepare('SELECT * FROM wardrobe_outfits WHERE id = ?').get(outfitId)
  assert.ok(mine.session_id === SESS_A)
  const r = await call('PUT', `/outfits/${outfitId}`, { rating: 1 }, SESS_OTHER)
  assert.equal(r.status, 404)
  assert.match(r.body.error.message, /搭配不存在/)
  const d = await call('DELETE', `/outfits/${outfitId}`, undefined, SESS_OTHER)
  assert.equal(d.status, 404)
  assert.ok(
    memDb.prepare('SELECT id FROM wardrobe_outfits WHERE id = ?').get(outfitId),
    '越权删除不能真删掉',
  )
  const gone = await call('PUT', '/outfits/999999', { rating: 2 })
  assert.equal(gone.status, 404)
})

test('⑥ DELETE 本人的行：搭配没了，衣物一件不少', async () => {
  const itemsBefore = memDb.prepare('SELECT COUNT(*) AS n FROM user_wardrobe').get().n
  const r = await call('POST', '/outfits', { name: '要删掉的那套', item_ids: [itemA], rating: 2 })
  assert.equal(r.status, 200)
  const del = await call('DELETE', `/outfits/${r.body.data.id}`)
  assert.equal(del.status, 200)
  assert.equal(del.body.data.deleted, true)
  assert.equal(
    memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits WHERE id = ?').get(r.body.data.id).n,
    0,
  )
  assert.equal(memDb.prepare('SELECT COUNT(*) AS n FROM user_wardrobe').get().n, itemsBefore)
})

test('⑦ 词表取不到时只许留空（宁缺不猜，不收自由文本）', async () => {
  memDb.prepare("DELETE FROM rule_conditions WHERE field = 'occasion'").run()
  const list = await call('GET', '/outfits')
  assert.deepEqual(
    list.body.data.occasions,
    [],
    'GET 带出去的词表要跟着闸门一起空，前端才知道要禁用下拉',
  )
  const blocked = await call('POST', '/outfits', {
    name: '词表空了还填场合',
    item_ids: [itemA],
    occasion: '上班通勤',
  })
  assert.equal(blocked.status, 400)
  assert.match(blocked.body.error.message, /场合词表还没建好/)
  const ok = await call('POST', '/outfits', { name: '词表空了老实留空', item_ids: [itemA] })
  assert.equal(ok.status, 200)
})
