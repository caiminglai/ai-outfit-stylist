/**
 * 人 × 衣服 评分（`item_feedback`）的契约测试（2026-10-21 第九阶段·第一步）
 *
 * 这一轮要治的是那条 blocker 的**根**，不是它的量：`regress-rank-weights.js` 报
 * 「可用样本 0 条（三维不齐）」，现量证明三维全齐的候选**结构上造不出来**
 * （规则那一路不写 body_fit，衣橱那一路 group_id=null 且 `feedback_events` 的
 * `group_id NOT NULL`＋`UNIQUE(user_id, group_id)` 收不下它，前端 `item.group_id > 0`
 * 连评分控件都不渲染）。规范与四条证据逐字在 `docs/依据/17-协同过滤输入输出规范-20261021.md` §一~§二。
 *
 * 钉七件事（全是行为证据：内存库替身＋临时实例真发 HTTP）：
 *  ① 正常写一行：两把星、场合、身份、二维快照都落库；
 *  ② 一人一衣只留最新一行（覆盖，不叠加）；
 *  ③ 星级越界 ⇒ 400 说破（⛔ 不静默抹成"没打"）；
 *  ④ 场合表外词 ⇒ 400（词表只认规则库在用的那五个，采了表外词命不中规则＝白采）；
 *  ⑤ 不是你的衣服 ⇒ **404**（不是 403，403 等于承认这行存在）；
 *  ⑥ 没星又没表态 ⇒ 400（不许写空壳噪声行）；
 *  ⑦ 快照只认 color/body 两维：只带 rule 维的 rank ⇒ `rank_snapshot` 存 NULL，
 *     带 color+body 的 ⇒ 存下来且二维都有值（这条就是三维门改口的落点）；
 *  ⑧ `undefined＝不动／null＝清空` 继承衣橱 PUT 那把尺子（只补一颗星不许抹掉另一颗）；
 *  ⑬ 会话 id 形状不合规、补不出游客档 ⇒ 退 `'s'+session` 键（另一条身份路也走得通）。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 test/wardrobeDiaryRoutes.test.js 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/itemFeedback.test.js
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

// 场合词表：与规则库同源（路由每次现取，这里造出同样的五行）
for (const occ of ['上班通勤', '约会聚会', '婚礼宴会', '运动健身', '居家休闲']) {
  const gid = memDb
    .prepare(`INSERT INTO rule_groups (name, category, priority) VALUES (?, 'occasion', 1)`)
    .run(`衣物评分词表-${occ}`).lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value)
       VALUES (?, 'occasion', 'eq', ?)`,
    )
    .run(gid, JSON.stringify(occ))
}

const SESS_A = 'sess-item-a'
const SESS_B = 'sess-item-b'

/** 给会话 A 造两件衣服；B 一件（用来验越权） */
function seedWardrobe() {
  const ins = memDb.prepare(
    `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type, bust_cm, shoulder_cm)
     VALUES (?, ?, 'top', ?, ?, ?, ?)`,
  )
  const a1 = ins.run(SESS_A, '雾霾蓝衬衫', '雾霾蓝', '合身', 100, 42).lastInsertRowid
  const a2 = ins.run(SESS_A, '焦糖色针织衫', '焦糖色', '宽松', null, null).lastInsertRowid
  const b1 = ins.run(SESS_B, '别人的白衬衫', '白色', '合身', 96, 40).lastInsertRowid
  return { a1, a2, b1 }
}
const ITEMS = seedWardrobe()

const express = require('express')
const recommendRoutes = require('../routes/recommend')
const { actorKeyOf, itemFeedbackError, ownsWardrobeItem } = require('../services/itemFeedback')

const app = express()
app.use(express.json())
app.use('/api/recommend', recommendRoutes)

let server
let base = ''

async function call(method, route, body, session = SESS_A) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'X-Session-Id': session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json || {} }
}

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}/api/recommend`
})

test.after(() => {
  server.close()
  memDb.close()
})

const row = (itemId, key = actorKey(SESS_A)) =>
  memDb
    .prepare('SELECT * FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?')
    .get(key, itemId)

/**
 * 这一条评的分落在哪个键下——**不是**测试想当然，是照 `optionalUser` 的真实行为算的（10-21 现量）：
 * 路由用 `optionalUser`，它对本仓形状合法的会话 id 会 `INSERT OR IGNORE INTO users` 补一条游客档
 * （`middleware/auth.js:56 ensureGuestUser`），于是普通访客落的是 **`'u'+游客 user_id`**；
 * `'s'+session` 那一路只在会话 id 过不了 `/^[A-Za-z0-9_-]{8,64}$/`（太短／带怪字符）时才走到。
 * 两把键都能一人一衣只留一行，`⑬` 专门把第二路钉住，免得以后有人以为访客一定是 `s` 开头。
 */
function actorKey(session) {
  const u = memDb.prepare('SELECT id FROM users WHERE session_id = ?').get(session)
  return u ? `u${u.id}` : `s${session}`
}

const RANK_TWO_DIMS = {
  score: 61.2,
  coverage: 0.9,
  dims: [
    { key: 'rule', score: null },
    { key: 'color', score: 55 },
    { key: 'body', score: 70 },
  ],
}

test('① 正常写一行：访客身份落库、两把星与场合都进库、会话 id 一并留着', async () => {
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a1,
    occasion: '上班通勤',
    aesthetic_score: 4,
    fit_score: 5,
    rank: RANK_TWO_DIMS,
  })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const db = row(ITEMS.a1)
  assert.strictEqual(db.aesthetic_score, 4)
  assert.strictEqual(db.fit_score, 5)
  assert.strictEqual(db.occasion, '上班通勤')
  // 唯一键＝actor_key，归属口径＝session（`user_wardrobe` 十行里只有 1 行有 user_id，
  // 星必须能顺着会话认回来，否则游客打了分下次读不回填）。
  assert.match(db.actor_key, /^(u|s)\S+$/, `actor_key 形状不对: ${db.actor_key}`)
  assert.strictEqual(db.session_id, SESS_A)
  assert.strictEqual(JSON.parse(db.rank_snapshot).body, 70, '两维齐的快照要存下来')
})

test('② 一人一衣只留最新一行：改星是覆盖不是加一行', async () => {
  await call('POST', '/feedback/item', { wardrobe_item_id: ITEMS.a1, aesthetic_score: 2 })
  const n = memDb
    .prepare('SELECT COUNT(*) c FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?')
    .get(actorKey(SESS_A), ITEMS.a1).c
  assert.strictEqual(n, 1, '同一个人同一件衣服必须只有一行（好评率不能被重复点击灌大）')
  const db = row(ITEMS.a1)
  assert.strictEqual(db.aesthetic_score, 2, '新星要盖掉旧星')
  assert.strictEqual(db.fit_score, 5, '⑧ 这次没送 fit_score ⇒ 那一格必须不动（undefined＝不动）')
})

test('⑧b null＝明确清空：把合身星抹成没打要真的回 NULL（另一颗还在 ⇒ 不算空壳）', async () => {
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a1,
    aesthetic_score: 2,
    fit_score: null,
  })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.strictEqual(row(ITEMS.a1).fit_score, null)
  assert.strictEqual(row(ITEMS.a1).aesthetic_score, 2, '清空一颗不许顺手抹掉另一颗')
})

test('③ 星级越界 400 说破，且旧值一个字都没被改', async () => {
  const before = row(ITEMS.a1)
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a1,
    aesthetic_score: 6,
  })
  assert.strictEqual(r.status, 400)
  assert.match(
    String((r.body.error && r.body.error.message) || r.body.message || ''),
    /审美评分|1~5/,
    JSON.stringify(r.body),
  )
  assert.strictEqual(row(ITEMS.a1).aesthetic_score, before.aesthetic_score, '畸形请求不许动旧值')
})

test('④ 场合表外词 400（规则库没这个词 ⇒ 采了也命不中，白采）', async () => {
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a2,
    occasion: '去夜店',
    aesthetic_score: 3,
  })
  assert.strictEqual(r.status, 400, JSON.stringify(r.body))
  assert.strictEqual(row(ITEMS.a2), undefined, '被拒的请求一行都不该写')
})

test('⑤ 不是你的衣服 ⇒ 404（⛔ 不是 403，那等于承认这行存在）', async () => {
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.b1,
    aesthetic_score: 5,
  })
  assert.strictEqual(r.status, 404, JSON.stringify(r.body))
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) c FROM item_feedback WHERE wardrobe_item_id = ?').get(ITEMS.b1)
      .c,
    0,
  )
})

test('⑥ 没星又没表态 ⇒ 400，不许写空壳噪声行', async () => {
  const r = await call('POST', '/feedback/item', { wardrobe_item_id: ITEMS.a2 })
  assert.strictEqual(r.status, 400, JSON.stringify(r.body))
  assert.strictEqual(row(ITEMS.a2), undefined)
})

test('⑥b 只送两个 null（没星）⇒ 同样 400：null 的语义是清空已有，不是给了个值', async () => {
  const r = await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a2,
    aesthetic_score: null,
    fit_score: null,
  })
  assert.strictEqual(r.status, 400, JSON.stringify(r.body))
})

test('⑦ 快照只认 color/body：只带 rule 维的 rank ⇒ 存 NULL，两维齐的 ⇒ 两个数都在', async () => {
  await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a2,
    aesthetic_score: 3,
    rank: { score: 40, coverage: 0.1, dims: [{ key: 'rule', score: 40 }] },
  })
  assert.strictEqual(
    row(ITEMS.a2).rank_snapshot,
    null,
    '没有 color 也没有 body ⇒ 没有自变量，存 NULL',
  )

  await call('POST', '/feedback/item', {
    wardrobe_item_id: ITEMS.a2,
    aesthetic_score: 3,
    rank: RANK_TWO_DIMS,
  })
  const snap = JSON.parse(row(ITEMS.a2).rank_snapshot)
  assert.strictEqual(snap.color, 55)
  assert.strictEqual(snap.body, 70)
  assert.ok(!('rule' in snap), '这张表的快照不收 rule 维（衣橱候选结构上没有它）')
})

test('⑨ 缺 wardrobe_item_id / 非正整数 ⇒ 400（不拿 undefined 去建一行）', async () => {
  assert.strictEqual((await call('POST', '/feedback/item', { aesthetic_score: 3 })).status, 400)
  assert.strictEqual(
    (await call('POST', '/feedback/item', { wardrobe_item_id: '12abc', aesthetic_score: 3 }))
      .status,
    400,
  )
})

test('⑩ 没身份（不带 X-Session-Id 且认不出人）⇒ 401，不写匿名行', async () => {
  const r = await call(
    'POST',
    '/feedback/item',
    { wardrobe_item_id: ITEMS.a1, aesthetic_score: 3 },
    '',
  )
  assert.strictEqual(r.status, 401, JSON.stringify(r.body))
})

test('⑪ GET /feedback/items 只回自己的分，跨人的查不到', async () => {
  const r = await call('GET', `/feedback/items?ids=${ITEMS.a1},${ITEMS.b1}`)
  assert.strictEqual(r.status, 200)
  const items = r.body.data.items
  assert.strictEqual(items.length, 1, '只该回自己那件（另一件是会话 B 的）')
  assert.strictEqual(items[0].wardrobe_item_id, ITEMS.a1)
})

test('⑫ 服务层三个纯函数：actorKeyOf / ownsWardrobeItem / itemFeedbackError', () => {
  assert.strictEqual(actorKeyOf({ userId: 7, sessionId: SESS_A }), 'u7', '登录态优先用 user 键')
  assert.strictEqual(actorKeyOf({ sessionId: SESS_A }), `s${SESS_A}`)
  assert.strictEqual(actorKeyOf({}), null, '两样都没有 ⇒ null（写入口回 401）')
  assert.strictEqual(actorKeyOf({ userId: 0 }), null, '0 不是合法 user id')
  assert.strictEqual(ownsWardrobeItem({ sessionId: SESS_A }, ITEMS.a1), true)
  assert.strictEqual(ownsWardrobeItem({ sessionId: SESS_B }, ITEMS.a1), false)
  assert.strictEqual(ownsWardrobeItem({}, ITEMS.a1), false, '没身份就不该去查库')
  // signal 的白名单归这层管（路由不再另起一套）：给了星也不能放过表外词。
  assert.match(
    itemFeedbackError({ wardrobe_item_id: ITEMS.a1, aesthetic_score: 3, signal: 'nope' }),
    /signal 只能是/,
    '表外 signal 必须说破，哪怕这条已经带了星',
  )
  assert.match(
    itemFeedbackError({ wardrobe_item_id: ITEMS.a1, signal: 'nope' }),
    /signal 只能是/,
    '表外 signal 必须说破',
  )
  assert.strictEqual(
    itemFeedbackError({ wardrobe_item_id: ITEMS.a1, aesthetic_score: 3 }),
    null,
    '正整数星＋合法 id ⇒ 放行',
  )
})

test('⑬ 会话 id 形状不合规（太短，补不出游客档）⇒ 退 s+session 键，照样能打分', async () => {
  const SHORT = 'abc'
  memDb
    .prepare(
      `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type)
       VALUES (?, '短会话的白衬衫', 'top', '白色', '合身')`,
    )
    .run(SHORT)
  const itemId = memDb.prepare('SELECT id FROM user_wardrobe WHERE session_id = ?').get(SHORT).id
  const r = await call(
    'POST',
    '/feedback/item',
    { wardrobe_item_id: itemId, aesthetic_score: 4 },
    SHORT,
  )
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.strictEqual(row(itemId, `s${SHORT}`).aesthetic_score, 4, '这条走的是 s 键那一路')
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) c FROM users WHERE session_id = ?').get(SHORT).c,
    0,
  )
})
