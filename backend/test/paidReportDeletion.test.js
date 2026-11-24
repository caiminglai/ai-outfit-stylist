/**
 * 普通历史删除与付费报告保护的行为测试。
 *
 * 真链路：本地 Express -> 真实 loginRequired -> 真实 history 路由 -> 内存 SQLite。
 * 运行: node --test test/paidReportDeletion.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-paid-report-delete-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_DB_PATH = path.join(tempDir, 'unused-styleai.db')
process.env.STYLEAI_UPLOAD_DIR = uploadDir

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

const express = require('express')
const historyRouter = require('../routes/history')
const app = express()
app.use(express.json())
app.use('/api/history', historyRouter)

let server
let baseUrl
let userId
const sessionId = 'sid-paid-report-delete'

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  userId = Number(
    memDb.prepare('INSERT INTO users (session_id) VALUES (?)').run(sessionId).lastInsertRowid,
  )
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  memDb.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function addOrder(outTradeNo, status) {
  return Number(
    memDb
      .prepare(
        `INSERT INTO payment_orders
         (out_trade_no, user_id, description, amount_fen, status, paid_at)
         VALUES (?, ?, '形象定制服务费', 9900, ?, ?)`,
      )
      .run(outTradeNo, userId, status, status === 'paid' ? "datetime('now')" : null)
      .lastInsertRowid,
  )
}

function addLog(result) {
  return Number(
    memDb
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
         VALUES (?, ?, 'store', '{"gender":"女"}', ?)`,
      )
      .run(sessionId, userId, result).lastInsertRowid,
  )
}

function addDeposit(status) {
  return Number(
    memDb
      .prepare(
        `INSERT INTO deposits
         (user_id, channel, amount, proof_url, status, admin_note, approved_at)
         VALUES (?, 'wechat', 99, '/uploads/manual-proof.png', ?, '人工确认到账', ?)`,
      )
      .run(userId, status, status === 'approved' ? "datetime('now')" : null).lastInsertRowid,
  )
}

const reportResult = (outTradeNo) =>
  JSON.stringify({ 穿搭: [], paid_report: { out_trade_no: outTradeNo } })
const manualReportResult = (depositId) =>
  JSON.stringify({
    穿搭: [],
    paid_report: {
      out_trade_no: `DEPOSIT-${depositId}`,
      amount_fen: 9900,
      channel: 'manual',
      source: 'manual_deposit',
      deposit_id: depositId,
      is_platform_order_no: false,
      paid_at: '2026-11-24 12:00:00',
    },
  })
const logRow = (id) => memDb.prepare('SELECT * FROM recommendation_logs WHERE id = ?').get(id)

async function deleteLog(id, sid = sessionId) {
  const res = await fetch(`${baseUrl}/api/history/${id}`, {
    method: 'DELETE',
    headers: { 'x-session-id': sid },
  })
  return { status: res.status, body: await res.json() }
}

test('已支付订单关联报告：删除返回 409 明确错误，报告与订单都不变', async () => {
  const outTradeNo = 'S3PAIDREPORT0001'
  addOrder(outTradeNo, 'paid')
  const logId = addLog(reportResult(outTradeNo))
  const logBefore = logRow(logId)
  const orderBefore = memDb
    .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
    .get(outTradeNo)

  const res = await deleteLog(logId)
  assert.equal(res.status, 409)
  assert.equal(res.body.success, false)
  assert.equal(res.body.error.code, 'CONFLICT')
  assert.match(res.body.error.message, /付费报告.*不能删除/)
  assert.deepEqual(logRow(logId), logBefore)
  assert.deepEqual(
    memDb.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo),
    orderBefore,
  )
})

test('普通推荐历史：仍可删除且返回成功', async () => {
  const logId = addLog(JSON.stringify({ 穿搭: [{ name: '衬衫' }] }))
  const res = await deleteLog(logId)
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(logRow(logId), undefined)
})

test('未支付订单号出现在报告形状里：不按已支付报告保护，仍可删除', async () => {
  const outTradeNo = 'S3CREATEDREPORT1'
  addOrder(outTradeNo, 'created')
  const logId = addLog(reportResult(outTradeNo))
  const res = await deleteLog(logId)
  assert.equal(res.status, 200)
  assert.equal(logRow(logId), undefined)
})

test('损坏 JSON 历史：删除不因报告关联查询变成 500', async () => {
  const logId = addLog('{not-json')
  const res = await deleteLog(logId)
  assert.equal(res.status, 200)
  assert.equal(logRow(logId), undefined)
})

test('报告引用了不存在的订单：不能误判为付费报告，仍可删除', async () => {
  const logId = addLog(reportResult('S3MISSINGORDER1'))
  const res = await deleteLog(logId)
  assert.equal(res.status, 200)
  assert.equal(logRow(logId), undefined)
})

test('别人的历史：仍回 404 且不泄露或删除该行', async () => {
  const otherSession = 'sid-paid-report-other'
  const otherUserId = Number(
    memDb.prepare('INSERT INTO users (session_id) VALUES (?)').run(otherSession).lastInsertRowid,
  )
  const logId = Number(
    memDb
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, result)
         VALUES (?, ?, 'store', ?)`,
      )
      .run(otherSession, otherUserId, JSON.stringify({ 穿搭: [] })).lastInsertRowid,
  )
  const before = logRow(logId)
  const res = await deleteLog(logId)
  assert.equal(res.status, 404)
  assert.deepEqual(logRow(logId), before)
})

test('人工已确认凭证报告：删除返回 409，报告与凭证都不变', async () => {
  const depositId = addDeposit('approved')
  const logId = addLog(manualReportResult(depositId))
  const logBefore = logRow(logId)
  const depositBefore = memDb.prepare('SELECT * FROM deposits WHERE id = ?').get(depositId)

  const res = await deleteLog(logId)
  assert.equal(res.status, 409)
  assert.equal(res.body.success, false)
  assert.equal(res.body.error.code, 'CONFLICT')
  assert.match(res.body.error.message, /付费报告.*不能删除/)
  assert.deepEqual(logRow(logId), logBefore)
  assert.deepEqual(
    memDb.prepare('SELECT * FROM deposits WHERE id = ?').get(depositId),
    depositBefore,
  )
})

for (const status of ['pending', 'rejected']) {
  test(`${status} 凭证报告尚未到账：仍可删除`, async () => {
    const depositId = addDeposit(status)
    const logId = addLog(manualReportResult(depositId))
    const res = await deleteLog(logId)
    assert.equal(res.status, 200)
    assert.equal(logRow(logId), undefined)
  })
}

test('报告引用不存在的凭证编号：不能误判为付费报告，仍可删除', async () => {
  const logId = addLog(manualReportResult(999999))
  const res = await deleteLog(logId)
  assert.equal(res.status, 200)
  assert.equal(logRow(logId), undefined)
})
