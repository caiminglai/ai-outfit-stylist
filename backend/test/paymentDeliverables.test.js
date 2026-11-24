/**
 * 付款即交付·路由与经营读数测试（2026-10-21 第十二阶段·第一步 一g）
 *
 * 规范出处：`docs/依据/20-付款即交付输入输出规范-20261021.md` §九 验收矩阵第 9~13 条
 * （三张读数卡的数怎么算、`closed` 关单状态的三条边界、`/my` 只读支零写库）。
 *
 * 钉死这五件事：
 *  ① **分母为 0 的比值回 `null`，不回 0**：库里还没收过钱时，后台显示"转化 0%"是假读数
 *     ——它和"来了 100 单全没付"长得一模一样，而这两种情况的处置完全相反；
 *  ② **两张账不相加、镜像要剔掉**：`businessSummary` 里 `proof_approved` 是含镜像的口径（审核台
 *     看见的凭证数），`proof_manual_*` 才是人工那一路的实收，两个数同时给出才不会被拿去做加法；
 *  ③ **累计与近 30 天同轴**：窗口只在 SQL 里用 `datetime('now','-30 days')` 比 UTC，
 *     断言用一条 40 天前的凭证把两个桶拉开，写成 `>=` 东八区日期串会当场露馅；
 *  ④ **关单只关自己、只关 created**：门店演示机多人共用一把浏览器，写成全表 UPDATE
 *     就会把别人正在扫的那笔码关掉；已付单更碰不得（钱已到账，状态由 `markPaid` 说了算）；
 *  ⑤ **`/my` 不带 `report` 时零写库**：这一支每次打开前后台都要读，一旦它写日志表，
 *     "看了多少次"就会被当成"领了多少份"，而 §二 的权益是现算的——写一次就脏一次。
 *
 * ⛔ 矩阵 12 那条 30 分钟边界只测 `-31` 与 `-29`，不测 `-30`：
 * `created_at` 与比较用的 `datetime('now','-30 minutes')` 都是**秒**精度，
 * 正好 30 分钟那一行会因为测试跑过了半秒而从"不关"翻成"关"，是抖动不是行为。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉，鉴权与限流中间件绕开（只调路由 stack 最后一个业务 handler），
 * 全程不打开 backend/db/styleai.db、不起真端口。
 * 运行: node --test test/paymentDeliverables.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const PR = require('../services/paidReport')
const paymentRouter = require('../routes/payment')

const db = memDb

function newUser(tag) {
  return Number(
    db.prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run('sid-' + tag, tag)
      .lastInsertRowid,
  )
}

/** `minutes_ago` 不给就用当前 UTC 秒；`created_at` 全部由 `datetime('now', …)` 造，与线上同一把尺子 */
function addOrder(no, userId, status, fen, minutesAgo) {
  const t =
    minutesAgo == null ? "datetime('now')" : `datetime('now', '-${Number(minutesAgo)} minutes')`
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, paid_at, created_at)
     VALUES (?, ?, '形象定制服务费', ?, ?, ${status === 'paid' ? t : 'NULL'}, ${t})`,
  ).run(no, userId, fen, status)
}

function addDeposit(userId, status, yuan, note, daysAgo) {
  const t = daysAgo == null ? "datetime('now')" : `datetime('now', '-${Number(daysAgo)} days')`
  db.prepare(
    `INSERT INTO deposits (user_id, channel, amount, proof_url, status, admin_note, created_at)
     VALUES (?, 'wechat', ?, '/uploads/p.png', ?, ?, ${t})`,
  ).run(userId, yuan, status, note)
}

/** 一行报告（`result.paid_report.out_trade_no` 在场＝§二 那把 `IS_REPORT` 尺子认的形状） */
function addReportRow(userId) {
  db.prepare(
    `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
     VALUES (?, ?, 'store', '{"gender":"女"}', '{"穿搭":[],"paid_report":{"out_trade_no":"S3CARD0001"}}')`,
  ).run('sid-card', userId)
}

function addPlainLogRow(userId) {
  db.prepare(
    `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
     VALUES (?, ?, 'store', '{"gender":"女"}', '{"穿搭":[]}')`,
  ).run('sid-card', userId)
}

function findRoute(method, routePath) {
  for (const layer of paymentRouter.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    const p = r.path
    if (Array.isArray(p) ? p.includes(routePath) : p === routePath) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

/** 只调最后一个 handler＝业务本体，`loginRequired` 与 `reportLimiter` 都在这层之外 */
function callMy(userId, query = {}) {
  const route = findRoute('get', '/my')
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
    // 下面两个是 express-rate-limit 会碰的：只读支用不到，但少一个就会在别处炸得莫名其妙
    setHeader() {
      return res
    },
    getHeader() {
      return undefined
    },
    headersSent: false,
  }
  handler(
    {
      params: {},
      query,
      body: {},
      headers: { 'x-session-id': 'sid-card' },
      ip: '1.1.1.1',
      socket: {},
      user: { id: userId, session_id: 'sid-card' },
    },
    res,
    () => {},
  )
  return res
}

const COUNT = (sql, ...p) => db.prepare(sql).get(...p).n

test('矩阵9：0 行副本上三张卡字段齐全，分母为 0 的比值是 null 不是 0', () => {
  const s = PR.businessSummary()
  assert.strictEqual(s.window_days, 30)
  assert.match(s.time_axis, /UTC/, '时间口径必须写进响应，⛔ 让人拿东八区日期去对这张卡')
  for (const bucket of ['cumulative', 'last_30_days']) {
    const c = s[bucket]
    for (const k of [
      'paid_orders',
      'paid_amount_yuan',
      'payers',
      'created_orders',
      'created_amount_yuan',
      'closed_orders',
      'closed_amount_yuan',
      'proof_approved',
      'proof_pending',
      'proof_rejected',
      'proof_manual_orders',
      'proof_manual_yuan',
      'claims',
      'pay_rate',
      'claim_rate',
      'proof_pass_rate',
    ]) {
      assert.ok(k in c, `${bucket}.${k} 必须存在（后台卡片按键取值，缺一个就是一片空白）`)
    }
    assert.strictEqual(c.paid_orders, 0)
    assert.strictEqual(c.claims, 0)
    assert.strictEqual(c.pay_rate, null, '没开过单⇒转化率是"未知"，显示成 0% 就是假读数')
    assert.strictEqual(c.claim_rate, null)
    assert.strictEqual(c.proof_pass_rate, null)
    assert.strictEqual(c.last_paid_at, null)
    assert.strictEqual(c.last_paid_at_beijing, null, '空值原样回 null，⛔ 回 1970-01-01')
  }
})

test('矩阵10：paid＋created＋closed＋两种凭证的副本上，§七 的数可手算复现', () => {
  const u1 = newUser('card-u1')
  const u2 = newUser('card-u2')
  addOrder('S3CARD0001', u1, 'paid', 9900)
  addOrder('S3CARD0002', u1, 'paid', 9900)
  addOrder('A3CARD0003', u2, 'paid', 5900)
  addOrder('S3CARD0004', u1, 'created', 9900)
  addOrder('S3CARD0005', u1, 'closed', 9900)
  // 人工核过的一笔（真收钱）＋ markPaid 的镜像一笔：两笔都在，但只有前者进"人工实收"
  addDeposit(u1, 'approved', 99, '支付宝转账 截图')
  addDeposit(u1, 'approved', 99, '微信在线支付 TXN-CARD')
  addDeposit(u1, 'pending', 99, '')
  addDeposit(u1, 'rejected', 99, '')
  // 窗口外那条：40 天前核过的凭证，只该出现在累计里
  addDeposit(u2, 'approved', 99, '老凭证', 40)
  addReportRow(u1)
  addPlainLogRow(u1)

  const c = PR.businessSummary().cumulative
  // ① 实收：9900+9900+5900 = 25700 分 = 257 元，两个人
  assert.strictEqual(c.paid_orders, 3)
  assert.strictEqual(c.paid_amount_yuan, 257)
  assert.strictEqual(c.payers, 2, '同一人两单只算一个人')
  assert.strictEqual(c.claims, 1, '普通方案行不算领取')
  assert.strictEqual(c.claim_rate, 0.333, '1 份报告 / 3 单实收（保留三位）')
  // ② 掉在中段的：待付 1 笔 99、已关 1 笔 99
  assert.strictEqual(c.created_orders, 1)
  assert.strictEqual(c.created_amount_yuan, 99)
  assert.strictEqual(c.closed_orders, 1)
  assert.strictEqual(c.closed_amount_yuan, 99)
  // ③ 漏斗与凭证：approved 含镜像＝3（人工 1＋镜像 1＋40 天前人工 1），人工那一路＝2 笔 198 元
  assert.strictEqual(c.proof_approved, 3)
  assert.strictEqual(c.proof_manual_orders, 2, '镜像那笔不进来（两张账不相加）')
  assert.strictEqual(c.proof_manual_yuan, 198)
  assert.strictEqual(c.proof_pass_rate, 0.6, '3 / (3+1+1)')
  assert.strictEqual(c.pay_rate, 0.6, '3 / (3+1+1)')
  assert.ok(c.last_paid_at && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(c.last_paid_at))
  assert.strictEqual(
    c.last_paid_at_beijing,
    PR.toBeijing(c.last_paid_at),
    '东八区那列由同一把尺子转',
  )

  const d = PR.businessSummary().last_30_days
  assert.strictEqual(d.paid_orders, 3, '今天下的单两个桶都该看见')
  assert.strictEqual(d.proof_approved, 2, '40 天前那笔只准留在累计里')
  assert.strictEqual(d.proof_manual_orders, 1)
  assert.strictEqual(d.proof_manual_yuan, 99)
  assert.strictEqual(d.proof_pass_rate, 0.5, '2 / (2+1+1)＝窗口一开，分母跟着换')
})

test('矩阵11：关单只关自己、只关 created；别人的超时单与自己的已付单都不动', () => {
  const a = newUser('stale-a')
  const b = newUser('stale-b')
  addOrder('S3STALE0001', a, 'created', 9900, 60)
  addOrder('S3STALE0002', a, 'paid', 9900, 60)
  addOrder('S3STALE0003', b, 'created', 9900, 60)
  addOrder('S3STALE0004', b, 'closed', 9900, 120)

  const res = callMy(a)
  assert.strictEqual(res.statusCode, 200)
  const st = (no) =>
    db.prepare('SELECT status FROM payment_orders WHERE out_trade_no = ?').get(no).status
  assert.strictEqual(st('S3STALE0001'), 'closed', '自己名下超时的未付单要关掉')
  assert.strictEqual(st('S3STALE0002'), 'paid', '⛔ 钱已到账的单不归关单管（那是 markPaid 的状态）')
  assert.strictEqual(
    st('S3STALE0003'),
    'created',
    '⛔ 门店演示机共用浏览器时不许关掉别人正在扫的那笔',
  )
  assert.strictEqual(st('S3STALE0004'), 'closed')
  // 响应里给的是这个人的单，且 closed 口径带出来了（前端"重新下单"判据）
  const d = res.body.data
  assert.strictEqual(d.entitlement.closed_orders, 1)
  assert.strictEqual(d.entitlement.pending_orders, 0, '自己那笔超时单已经不在待付里')
  assert.ok(
    d.orders.every((o) => o.out_trade_no.startsWith('S3STALE000')),
    '⛔ 不许把 B 的单混进 A 的列表',
  )
})

test('矩阵12：30 分钟边界，-31 关、-29 不关', () => {
  const u = newUser('ttl-u')
  addOrder('S3TTL00031', u, 'created', 9900, 31)
  addOrder('S3TTL00029', u, 'created', 9900, 29)
  const res = callMy(u)
  assert.strictEqual(res.statusCode, 200)
  const st = (no) =>
    db.prepare('SELECT status FROM payment_orders WHERE out_trade_no = ?').get(no).status
  assert.strictEqual(st('S3TTL00031'), 'closed')
  assert.strictEqual(
    st('S3TTL00029'),
    'created',
    '还在有效期内就被关掉＝顾客刚要点支付码发现单没了',
  )
  assert.strictEqual(res.body.data.entitlement.pending_orders, 1)
})

test('矩阵13：/my 不带 report 时零写库（除那条关单 UPDATE 外）', () => {
  const u = newUser('readonly-u')
  addOrder('S3RO00000001', u, 'paid', 9900)
  addOrder('S3RO00000002', u, 'created', 9900, 60)
  addDeposit(u, 'approved', 99, '支付宝转账 截图')
  const logs = COUNT('SELECT COUNT(*) n FROM recommendation_logs')
  const deposits = COUNT('SELECT COUNT(*) n FROM deposits')
  const orders = COUNT('SELECT COUNT(*) n FROM payment_orders')
  const users = COUNT('SELECT COUNT(*) n FROM users')

  const res = callMy(u)
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(
    COUNT('SELECT COUNT(*) n FROM recommendation_logs'),
    logs,
    '⛔ 只读支不许跑引擎、不许落报告行',
  )
  assert.strictEqual(COUNT('SELECT COUNT(*) n FROM deposits'), deposits)
  assert.strictEqual(COUNT('SELECT COUNT(*) n FROM users'), users, '⛔ 不许顺手建用户')
  assert.strictEqual(
    COUNT('SELECT COUNT(*) n FROM payment_orders'),
    orders,
    '关单只改状态，⛔ 不许增删行',
  )
  assert.strictEqual(
    db.prepare('SELECT status FROM payment_orders WHERE out_trade_no = ?').get('S3RO00000001')
      .status,
    'paid',
  )

  // 凭证那 8 个键原样在外（老前端 pay.html 的 showMine 读的就是它们），新增的东西只在 entitlement 之后
  const d = res.body.data
  for (const k of [
    'id',
    'channel',
    'amount',
    'proof_url',
    'status',
    'admin_note',
    'created_at',
    'approved_at',
  ]) {
    assert.ok(k in d, `旧键 ${k} 必须还在`)
  }
  assert.ok(d.entitlement && d.orders && d.time_axis, '第十二阶段新增的三样')
  assert.strictEqual(d.entitlement.granted, 2, '在线 1 单＋人工凭证 1 笔')
  assert.strictEqual(d.entitlement.left, 1)
  assert.match(d.time_axis, /东八区/)
})

test('矩阵13b：没有凭证也没有订单的人，/my 回一串 null 而不是 500', () => {
  const u = newUser('nobody-u')
  const res = callMy(u)
  assert.strictEqual(res.statusCode, 200)
  const d = res.body.data
  assert.strictEqual(d.id, null)
  assert.strictEqual(d.status, null, '前端 showMine 靠 status 判空，缺这个键会抛')
  assert.deepStrictEqual(d.orders, [])
  assert.strictEqual(d.entitlement.granted, 0)
  assert.strictEqual(d.entitlement.left, 0)
  assert.deepStrictEqual(d.entitlement.claimable, [])
})
