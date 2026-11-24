/**
 * 在线支付「镜像凭证」守卫测试（2026-10-22 第十四阶段·第一步 组4·真钱测单抓到的洞）
 *
 * 背景（全部是现量，不是推演）：支付宝 0.01 元真单到账后，`markPaid` 往 `deposits` 插了一条
 * 镜像行（`admin_note` 带「支付宝在线支付 <平台单号>」前缀、`proof_url` 空）。后台再点一次「通过」，
 * 审核口 `POST /admin/:id/status` 原来会把整列 `admin_note` 覆盖成后台备注框里的空串
 * （`static/admin/admin-review.js:264`：框里没字就发 `admin_note: ''`）⇒ 镜像判据当场失效。
 * 那一分钟里读到的 `GET /api/payment/my` 是 `granted 2／paid_orders 1／proof_approved 1`，
 * `claimable_proofs` 多出那颗 `deposit_id`，按 `?proof=1` **真领出了第二份报告**
 * （在盘外副本上复现：报告行 id 2 与 id 3 同时在库＝一笔 0.01 元换两份交付）。
 *
 * 钉死这六件事：
 *  ① 带前缀的镜像行：权益只数一份、可领清单里没有它、按凭证领取回 403 `online_mirror`；
 *  ② **被覆盖掉前缀的镜像行**（`admin_note` 空、`proof_url` 空、渠道是在线两个之一）：
 *     ①的三条断言一条都不许变——这就是本轮补丁要钉的行为，也是活库里此刻真实存在的形状；
 *  ③ 真人工凭证（`proof_url` 有图）：照常计入权益、照常可领，⛔ 不能被结构性判据误伤；
 *  ④ 后台对镜像行点「通过」＝**一个字节都不写**（`admin_note`／`approved_at`／`status` 逐字不变）；
 *  ⑤ 后台对镜像行改成「拒绝」「待确认」＝ 400（钱是平台确认过的，两张账不许反向）；
 *  ⑥ 后台对真人工凭证点「通过」＝ 照常写库（补丁没把既有正路堵掉）。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉，鉴权与限流中间件绕开（只调路由 stack 最后一个业务 handler），
 * 全程不打开 backend/db/styleai.db、不起真端口。
 * 运行: node --test test/mirrorDepositGuard.test.js
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

/** 一条已到账的在线订单（真钱测单的形状：`A3…` 单号＋`paid`＋平台流水号） */
function addPaidOrder(no, userId, fen) {
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, transaction_id, paid_at, created_at)
     VALUES (?, ?, '形象定制服务费', ?, 'paid', 'TXN-' || ?, datetime('now'), datetime('now'))`,
  ).run(no, userId, fen, no)
}

/**
 * 一条 `deposits` 行。`kind` 决定形状：
 *  - `mirror_ok`＝`markPaid` 刚写完的原样（带前缀、无图）；
 *  - `mirror_wiped`＝被后台点「通过」覆盖过的（前缀没了，但照样无图）；
 *  - `manual`＝顾客真上传截图、后台真确认的那一路。
 */
function addDeposit(userId, kind, yuan) {
  const shape = {
    mirror_ok: { channel: 'alipay', proof: '', note: '支付宝在线支付 TXN-A31' },
    mirror_wiped: { channel: 'alipay', proof: '', note: '' },
    manual: { channel: 'alipay', proof: '/uploads/proof-1.png', note: '' },
  }[kind]
  if (!shape) throw new Error('未知 kind: ' + kind)
  return Number(
    db
      .prepare(
        `INSERT INTO deposits (user_id, channel, amount, proof_url, status, admin_note, approved_at, created_at)
         VALUES (?, ?, ?, ?, 'approved', ?, datetime('now'), datetime('now'))`,
      )
      .run(userId, shape.channel, yuan, shape.proof, shape.note).lastInsertRowid,
  )
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

/** 后台审核口：`POST /admin/:id/status`，只调业务 handler（`adminLoginRequired` 在这层之外） */
function callAdminStatus(id, body) {
  const route = findRoute('post', '/admin/:id/status')
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
  handler(
    { params: { id: String(id) }, body, headers: {}, ip: '1.1.1.1', socket: {} },
    res,
    () => {},
  )
  return res
}

const row = (id) => db.prepare('SELECT * FROM deposits WHERE id = ?').get(id)

test('① 带前缀的镜像行：只数一份、可领清单里没有它、按凭证领回 403', () => {
  const u = newUser('mirror-ok')
  addPaidOrder('A31', u, 1)
  const d = addDeposit(u, 'mirror_ok', 0.01)
  const e = PR.entitlement(u)
  assert.strictEqual(e.granted, 1, '在线一笔钱只能换一份权益')
  assert.strictEqual(e.paid_orders, 1)
  assert.strictEqual(e.proof_granted, 0, '镜像行不许算成人工凭证那一份')
  assert.deepStrictEqual(e.claimable_proofs, [])
  assert.strictEqual(e.left, 1)
  const r = PR.claimReportByProof({ userId: u, depositId: d })
  assert.strictEqual(r.code, 403)
  assert.strictEqual(r.reason, 'online_mirror')
})

test('② 前缀被后台覆盖掉的镜像行：三条断言一条都不许变（本轮补丁的核心）', () => {
  const u = newUser('mirror-wiped')
  addPaidOrder('A32', u, 1)
  const d = addDeposit(u, 'mirror_wiped', 0.01)
  assert.strictEqual(row(d).admin_note, '', '这一行就是活库里此刻的真实形状：备注已经被抹空')
  const e = PR.entitlement(u)
  assert.strictEqual(e.granted, 1, '⛔ 覆盖掉备注就数成两份，那是本轮真钱测单量到的假读数')
  assert.strictEqual(e.proof_granted, 0)
  assert.deepStrictEqual(e.claimable_proofs, [])
  const r = PR.claimReportByProof({ userId: u, depositId: d })
  assert.strictEqual(r.code, 403)
  assert.strictEqual(r.reason, 'online_mirror')
})

test('③ 真人工凭证（带上传的图）不能被结构性判据误伤', () => {
  const u = newUser('manual-only')
  const d = addDeposit(u, 'manual', 99)
  const e = PR.entitlement(u)
  assert.strictEqual(e.granted, 1)
  assert.strictEqual(e.proof_granted, 1)
  assert.strictEqual(e.claimable_proofs.length, 1)
  assert.strictEqual(e.claimable_proofs[0].deposit_id, d)
  const r = PR.claimReportByProof({ userId: u, depositId: d })
  assert.notStrictEqual(r.reason, 'online_mirror', '人工那一路绝不能被判成镜像')
})

test('④ 后台对镜像行点「通过」＝一个字节都不写', () => {
  const u = newUser('admin-noop')
  addPaidOrder('A34', u, 1)
  const d = addDeposit(u, 'mirror_ok', 0.01)
  const before = row(d)
  const res = callAdminStatus(d, { status: 'approved', admin_note: '' })
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.body.success, true)
  assert.strictEqual(res.body.data.online_mirror, true)
  const after = row(d)
  assert.strictEqual(after.admin_note, before.admin_note, '到账来源那串一个字都不许被覆盖')
  assert.strictEqual(after.approved_at, before.approved_at, '到账时间轴不许被点一次「通过」挪一次')
  assert.strictEqual(after.status, 'approved')
})

test('⑤ 后台把镜像行改成「拒绝」「待确认」都是 400', () => {
  const u = newUser('admin-block')
  addPaidOrder('A35', u, 1)
  const d = addDeposit(u, 'mirror_ok', 0.01)
  for (const bad of ['rejected', 'pending']) {
    const res = callAdminStatus(d, { status: bad, admin_note: '测试' })
    assert.strictEqual(res.statusCode, 400, bad + ' 不该改得动在线到账的那笔')
    assert.strictEqual(row(d).admin_note, '支付宝在线支付 TXN-A31', bad + ' 这一支也不许写备注')
  }
})

test('⑥ 后台对真人工凭证点「通过」照常写库（补丁没堵掉既有正路）', () => {
  const u = newUser('admin-manual')
  const d = addDeposit(u, 'manual', 99)
  db.prepare("UPDATE deposits SET status = 'pending' WHERE id = ?").run(d)
  const res = callAdminStatus(d, { status: 'approved', admin_note: '已核对截图' })
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(row(d).admin_note, '已核对截图')
  assert.strictEqual(row(d).status, 'approved')
})
