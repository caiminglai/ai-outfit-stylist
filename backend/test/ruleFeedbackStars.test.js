/**
 * 规则反馈升级测试（2026-10-19 第三阶段·模块三：两把星级 + 打分快照）
 *
 * 与 test/auditFixes20261013.test.js 同一套跑法：把 db/init 换成内存库替身（与 db/schema.sql 同源），
 * 直接调路由 stack 里最后一个业务 handler，**全程不打开、不修改 backend/db/styleai.db**，不起真端口。
 * 限流与鉴权中间件因此被绕过；本文件验的是入参收敛、写库结果与"哪些键不该被动"。
 *
 * 运行: node --test test/ruleFeedbackStars.test.js
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

const { recordFeedback, scoreError, snapshotValue, SIGNALS } = require('../services/ruleFeedback')
const recommendRouter = require('../routes/recommend')

function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    if (r.path === routePath) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

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

const mkRule = (name) =>
  memDb
    .prepare('INSERT INTO rule_groups (name, category, mode, priority) VALUES (?, ?, ?, ?)')
    .run(name, '上衣', 'personal', 20).lastInsertRowid
const mkUser = (tag) =>
  memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run(`u-${tag}`, `sid-${tag}`).lastInsertRowid

// ============================================================
// 1. service 层：星级与快照的写入语义
// ============================================================

test('recordFeedback：两把星能落库，回包里带回来', () => {
  const u = mkUser('stars-1')
  const g = mkRule('r-stars-1')
  const stat = recordFeedback(u, g, '穿搭', 'useful', { aesthetic_score: 5, fit_score: 3 })
  assert.strictEqual(stat.aesthetic_score, 5)
  assert.strictEqual(stat.fit_score, 3)
  const row = memDb
    .prepare('SELECT * FROM feedback_events WHERE user_id = ? AND group_id = ?')
    .get(u, g)
  assert.strictEqual(row.aesthetic_score, 5, '审美星真的进那一列')
  assert.strictEqual(row.fit_score, 3, '合身星真的进那一列')
  assert.strictEqual(row.signal, 'useful')
})

test('recordFeedback：只点按钮、没给星 ⇒ 上一次打的星一个字都不动（undefined＝这次没动这一格）', () => {
  const u = mkUser('stars-2')
  const g = mkRule('r-stars-2')
  recordFeedback(u, g, '穿搭', 'useful', { aesthetic_score: 4, fit_score: 5 })
  const again = recordFeedback(u, g, '穿搭', 'inaccurate')
  assert.strictEqual(again.aesthetic_score, 4, '换主意不该把已打的星抹掉')
  assert.strictEqual(again.fit_score, 5)
  assert.strictEqual(again.signal, 'inaccurate')
  assert.strictEqual(again.feedback_up, 0, '好评/差评从 feedback_events 重算，不是累加')
  assert.strictEqual(again.feedback_down, 1)
})

test('recordFeedback：明确传 null 才是清空那一把星；脏值按没打处理（service 层不报错，闸门在路由）', () => {
  const u = mkUser('stars-3')
  const g = mkRule('r-stars-3')
  recordFeedback(u, g, '穿搭', 'useful', { aesthetic_score: 2 })
  const cleared = recordFeedback(u, g, '穿搭', 'useful', { aesthetic_score: null })
  assert.strictEqual(cleared.aesthetic_score, null, 'null＝用户明确取消这一把星')
})

test('scoreError：0/6/小数/文字一律 400 话术，空值放行（没打不等于打 1 分）', () => {
  assert.strictEqual(scoreError({}), null)
  assert.strictEqual(scoreError({ aesthetic_score: null, fit_score: '' }), null)
  assert.strictEqual(scoreError({ aesthetic_score: 1 }), null)
  assert.strictEqual(scoreError({ fit_score: 5 }), null)
  assert.match(scoreError({ aesthetic_score: 6 }), /审美评分只能是 1~5/)
  assert.match(scoreError({ aesthetic_score: 0 }), /审美评分只能是 1~5/)
  assert.match(scoreError({ fit_score: 3.5 }), /合身度评分只能是 1~5/)
  assert.match(scoreError({ fit_score: '五星' }), /合身度评分只能是 1~5/)
})

test('snapshotValue：只认 rankDims 的出账形状，三维全空就存 null（宁缺不猜）', () => {
  const rank = {
    score: 76,
    coverage: 0.83,
    dims: [
      { key: 'rule', score: 100 },
      { key: 'color', score: 80 },
      { key: 'body', score: null },
    ],
  }
  const snap = JSON.parse(snapshotValue(rank))
  assert.deepStrictEqual(snap, { rule: 100, color: 80, body: null, total: 76, coverage: 0.83 })
  assert.strictEqual(snapshotValue({ score: 50, dims: [{ key: 'noise', score: 1 }] }), null)
  assert.strictEqual(snapshotValue('一串字符串'), null)
  assert.strictEqual(snapshotValue(null), null)
})

// ============================================================
// 2. 路由层：POST /feedback 的四格新入参
// ============================================================

test('POST /feedback：星级 + 落在哪件衣服 + 打分快照一起进库', () => {
  const sid = 'sid-fb-route-1'
  const g = mkRule('r-fb-1')
  const item = memDb
    .prepare(`INSERT INTO user_wardrobe (session_id, name, category, fit_type) VALUES (?, ?, ?, ?)`)
    .run(sid, '衬衫', '上衣', '合身').lastInsertRowid
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: {
      group_id: g,
      signal: 'useful',
      category: '穿搭',
      aesthetic_score: 4,
      fit_score: 2,
      wardrobe_item_id: item,
      rank: { score: 70, coverage: 1, dims: [{ key: 'color', score: 80 }] },
    },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(res.body.data.aesthetic_score, 4)
  assert.strictEqual(res.body.data.fit_score, 2)
  const row = memDb.prepare('SELECT * FROM feedback_events WHERE group_id = ?').get(g)
  assert.strictEqual(row.wardrobe_item_id, Number(item), '这条评价锚在哪件衣服上')
  assert.deepStrictEqual(JSON.parse(row.rank_snapshot), {
    rule: null,
    color: 80,
    body: null,
    total: 70,
    coverage: 1,
  })
})

test('POST /feedback：星级越界 400，库里那行不受影响（不静默抹成"没打"）', () => {
  const sid = 'sid-fb-route-2'
  const g = mkRule('r-fb-2')
  const ok = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'useful', aesthetic_score: 5 },
  })
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body))
  const bad = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'useful', aesthetic_score: 9 },
  })
  assert.strictEqual(bad.statusCode, 400, JSON.stringify(bad.body))
  assert.match(bad.body.error.message, /审美评分只能是 1~5/)
  const row = memDb.prepare('SELECT aesthetic_score FROM feedback_events WHERE group_id = ?').get(g)
  assert.strictEqual(row.aesthetic_score, 5, '400 之后库里那颗五星必须还在')
})

test('POST /feedback：没给星级与快照 ⇒ 老四样照常工作（这一步不能把既有反馈打断）', () => {
  const sid = 'sid-fb-route-3'
  const g = mkRule('r-fb-3')
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'inaccurate', category: '穿搭' },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  assert.strictEqual(res.body.data.aesthetic_score, null)
  assert.strictEqual(res.body.data.fit_score, null)
  const row = memDb
    .prepare('SELECT rank_snapshot, wardrobe_item_id FROM feedback_events WHERE group_id = ?')
    .get(g)
  assert.strictEqual(row.rank_snapshot, null, '没给快照就是没给，不补一份猜的')
  assert.strictEqual(row.wardrobe_item_id, null)
})

test('POST /feedback：规则不存在仍旧 404，与星级无关', () => {
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': 'sid-fb-route-4' },
    body: { group_id: 999999, signal: 'useful', fit_score: 3 },
  })
  assert.strictEqual(res.statusCode, 404, JSON.stringify(res.body))
})

test('写读契约：snapshotValue 存出去的那串 JSON，回归脚本原样读得回三维分（10-19 第三阶段）', () => {
  // 写入端(services/ruleFeedback.js)与读取端(scripts/regress-rank-weights.js)用的是两份代码，
  // 形状一漂移，回归就会把所有样本当成"没快照"静默清空——所以这条钉的是两端而不是单端。
  const { collectSamples } = require('../scripts/regress-rank-weights')
  const g = mkRule('r-fb-writer')
  const sid = 'sid-fb-writer'
  const rank = {
    score: 72.5,
    coverage: 1,
    dims: [
      { key: 'rule', name_cn: '规则基础分', score: 60, weight: 0.2 },
      { key: 'color', name_cn: '色彩贴合分', score: 80, weight: 0.4 },
      { key: 'body', name_cn: '廓形贴合分', score: 70, weight: 0.4 },
    ],
  }
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: {
      group_id: g,
      signal: 'useful',
      category: '穿搭',
      aesthetic_score: 4,
      fit_score: 5,
      rank,
    },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const raw = memDb
    .prepare('SELECT rank_snapshot FROM feedback_events WHERE group_id = ?')
    .get(g).rank_snapshot
  assert.deepStrictEqual(JSON.parse(raw), {
    rule: 60,
    color: 80,
    body: 70,
    total: 72.5,
    coverage: 1,
  })

  const { samples, dropped } = collectSamples(
    [
      memDb
        .prepare(
          'SELECT group_id, user_id, signal, aesthetic_score, fit_score, rank_snapshot FROM feedback_events WHERE group_id = ?',
        )
        .get(g),
    ],
    'aesthetic',
  )
  assert.strictEqual(dropped.no_snapshot, 0, '刚写进去的快照读不回来 ⇒ 形状漂移')
  assert.strictEqual(samples.length, 1)
  assert.deepStrictEqual(
    samples[0].x,
    [0.6, 0.8, 0.7],
    '三维分要按 rule/color/body 顺序、归一到 0~1',
  )
  assert.strictEqual(samples[0].y, 0.75, '四星 ⇒ (4-1)/4')
})

test('写读契约：三维只出一维时，回归端按"缺格"剔除而不是当 0 分', () => {
  const { collectSamples } = require('../scripts/regress-rank-weights')
  const g = mkRule('r-fb-partial')
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': 'sid-fb-partial' },
    body: {
      group_id: g,
      signal: 'inaccurate',
      aesthetic_score: 2,
      // 非规则候选没有 rule 维：rankDims 里那一维 score 是 null
      rank: {
        score: 55,
        coverage: 0.8,
        dims: [
          { key: 'color', score: 80 },
          { key: 'body', score: 30 },
        ],
      },
    },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const row = memDb.prepare('SELECT * FROM feedback_events WHERE group_id = ?').get(g)
  assert.deepStrictEqual(JSON.parse(row.rank_snapshot), {
    rule: null,
    color: 80,
    body: 30,
    total: 55,
    coverage: 0.8,
  })
  const { samples, dropped } = collectSamples([row], 'aesthetic')
  assert.strictEqual(samples.length, 0)
  assert.strictEqual(dropped.incomplete_dims, 1)
})

// ============================================================
// 3. 第八阶段·一b（10-20）：`rated` 这一档——只打星也要落库，但不许冒充表态
//    规范见 docs/依据/16-数据采集输入输出规范-20261020.md §一·1.1 与 §三
// ============================================================

test('SIGNALS 现量三档：useful / inaccurate / rated（多出来的那档是本轮唯一新白名单值）', () => {
  assert.deepStrictEqual(SIGNALS, ['useful', 'inaccurate', 'rated'])
})

test('POST /feedback：只给星不表态 ⇒ signal=rated 落库，好评差评计数一个都不动', () => {
  const sid = 'sid-rated-1'
  const g = mkRule('r-rated-1')
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: {
      group_id: g,
      signal: 'rated',
      category: '穿搭',
      aesthetic_score: 4,
      fit_score: 5,
      rank: {
        score: 60,
        coverage: 1,
        dims: [
          { key: 'rule', score: 50 },
          { key: 'color', score: 70 },
          { key: 'body', score: 80 },
        ],
      },
    },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const row = memDb.prepare('SELECT * FROM feedback_events WHERE group_id = ?').get(g)
  assert.strictEqual(row.signal, 'rated')
  assert.strictEqual(row.aesthetic_score, 4, '星真的进了那一列，不是停在浏览器里')
  assert.strictEqual(row.fit_score, 5)
  const rule = memDb
    .prepare('SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?')
    .get(g)
  assert.strictEqual(rule.feedback_up, 0, '⛔ rated 绝不许被数成好评')
  assert.strictEqual(rule.feedback_down, 0, '⛔ 也绝不许被数成差评')
  // 回归侧两个目标差别要分明：星级目标收这一行（解绑就是为了它），正负目标必须丢掉它
  const { collectSamples } = require('../scripts/regress-rank-weights')
  const star = collectSamples([row], 'aesthetic')
  assert.strictEqual(star.samples.length, 1, '三维快照齐的 rated 行要能进星级回归')
  assert.strictEqual(star.samples[0].y, 0.75, 'y＝(星-1)/4')
  const binary = collectSamples([row], 'signal')
  assert.strictEqual(binary.samples.length, 0)
  assert.strictEqual(binary.dropped.no_target, 1, '没表态就不是正负样本，不许猜成「有用」')
})

test('POST /feedback：rated 但两把星都没给 ⇒ 400（不许写出一行空信息，还会顶掉本人旧表态）', () => {
  const sid = 'sid-rated-2'
  const g = mkRule('r-rated-2')
  const res = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'rated' },
  })
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body))
  assert.match(res.body.error.message, /至少要给一把星/)
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM feedback_events WHERE group_id = ?').get(g).n,
    0,
    '400 之后不许留行',
  )
})

test('POST /feedback：先点👍再补星 ⇒ 沿用原 signal，好评计数不掉（前端走的是这条）', () => {
  const sid = 'sid-rated-3'
  const g = mkRule('r-rated-3')
  const first = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'useful' },
  })
  assert.strictEqual(first.statusCode, 200, JSON.stringify(first.body))
  const second = call(findRoute(recommendRouter, 'post', '/feedback'), {
    headers: { 'x-session-id': sid },
    body: { group_id: g, signal: 'useful', aesthetic_score: 3 },
  })
  assert.strictEqual(second.statusCode, 200, JSON.stringify(second.body))
  const rule = memDb.prepare('SELECT feedback_up FROM rule_groups WHERE id = ?').get(g)
  assert.strictEqual(rule.feedback_up, 1, '重复提交只覆盖那一行，好评数不许翻倍')
  const rows = memDb.prepare('SELECT COUNT(*) n FROM feedback_events WHERE group_id = ?').get(g).n
  assert.strictEqual(rows, 1, 'UNIQUE(user_id, group_id)：一人一规则只留一行')
  const row = memDb
    .prepare('SELECT signal, aesthetic_score FROM feedback_events WHERE group_id = ?')
    .get(g)
  assert.strictEqual(row.signal, 'useful')
  assert.strictEqual(row.aesthetic_score, 3, '星补上了，表态没被抹成 rated')
})
