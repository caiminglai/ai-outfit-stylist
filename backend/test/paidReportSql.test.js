'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { collectPaidReportRetention } = require('../services/paidReportSql')

const db = new Database(':memory:')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
db.pragma('foreign_keys = ON')
const ownerId = Number(
  db.prepare('INSERT INTO users (session_id) VALUES (?)').run('sid-paid-owner').lastInsertRowid,
)
const otherUserId = Number(
  db.prepare('INSERT INTO users (session_id) VALUES (?)').run('sid-paid-other').lastInsertRowid,
)

function addOrder(outTradeNo, userId, status) {
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, paid_at)
     VALUES (?, ?, '测试报告', 9900, ?, ?)`,
  ).run(outTradeNo, userId, status, status === 'paid' ? "datetime('now')" : null)
}

function addDeposit(userId, status) {
  return Number(
    db
      .prepare(
        `INSERT INTO deposits (user_id, channel, amount, proof_url, status, approved_at)
         VALUES (?, 'wechat', 99, '/uploads/test-proof.png', ?, ?)`,
      )
      .run(userId, status, status === 'approved' ? "datetime('now')" : null).lastInsertRowid,
  )
}

function addReport(outTradeNo, reportUserId = ownerId) {
  const basisId = Number(
    db
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
         VALUES ('sid-paid-basis', ?, 'store', '{"height":170}', '{}')`,
      )
      .run(reportUserId).lastInsertRowid,
  )
  const reportId = Number(
    db
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
         VALUES ('sid-paid-report', ?, 'store', '{"height":170}', ?)`,
      )
      .run(
        reportUserId,
        JSON.stringify({ paid_report: { out_trade_no: outTradeNo, basis_log_id: basisId } }),
      ).lastInsertRowid,
  )
  return { basisId, reportId }
}

function retention(reportId) {
  return collectPaidReportRetention(db, 'id = ?', [reportId])
}

test('本人已到账订单的报告及生成依据必须保留', () => {
  const no = 'PAID-SQL-OWNER'
  addOrder(no, ownerId, 'paid')
  const { basisId, reportId } = addReport(no)
  const result = retention(reportId)
  assert.deepEqual(
    result.paidReports.map((row) => row.id),
    [reportId],
  )
  assert.deepEqual(
    result.retainedList.sort((a, b) => a - b),
    [basisId, reportId].sort((a, b) => a - b),
  )
  assert.equal(result.paidReportsRetained, 1)
  assert.equal(result.reportBasisRetained, 1)
})

for (const status of ['created', 'closed']) {
  test(`${status} 订单只有报告形状时不能保留`, () => {
    const no = `PAID-SQL-${status}`
    addOrder(no, ownerId, status)
    const { reportId } = addReport(no)
    const result = retention(reportId)
    assert.equal(result.paidReportsRetained, 0)
    assert.deepEqual(result.retainedList, [])
  })
}

test('报告引用不存在的订单时不能保留', () => {
  const { reportId } = addReport('PAID-SQL-MISSING')
  const result = retention(reportId)
  assert.equal(result.paidReportsRetained, 0)
  assert.deepEqual(result.retainedList, [])
})

test('订单已到账但不属于报告本人时不能保留', () => {
  const no = 'PAID-SQL-OTHER-OWNER'
  addOrder(no, otherUserId, 'paid')
  const { reportId } = addReport(no)
  const result = retention(reportId)
  assert.equal(result.paidReportsRetained, 0)
  assert.deepEqual(result.retainedList, [])
})

test('本人已确认人工凭证的报告及生成依据必须保留', () => {
  const depositId = addDeposit(ownerId, 'approved')
  const { basisId, reportId } = addReport(`DEPOSIT-${depositId}`)
  const result = retention(reportId)
  assert.deepEqual(
    result.paidReports.map((row) => row.id),
    [reportId],
  )
  assert.deepEqual(
    result.retainedList.sort((a, b) => a - b),
    [basisId, reportId].sort((a, b) => a - b),
  )
})

for (const status of ['pending', 'rejected']) {
  test(`${status} 凭证只有报告形状时不能保留`, () => {
    const depositId = addDeposit(ownerId, status)
    const { reportId } = addReport(`DEPOSIT-${depositId}`)
    const result = retention(reportId)
    assert.equal(result.paidReportsRetained, 0)
    assert.deepEqual(result.retainedList, [])
  })
}

test('凭证已确认但不属于报告本人时不能保留', () => {
  const depositId = addDeposit(otherUserId, 'approved')
  const { reportId } = addReport(`DEPOSIT-${depositId}`)
  const result = retention(reportId)
  assert.equal(result.paidReportsRetained, 0)
  assert.deepEqual(result.retainedList, [])
})

test('报告没有账号归属时不能借他人的到账凭据获得保留', () => {
  const no = 'PAID-SQL-NULL-OWNER'
  addOrder(no, ownerId, 'paid')
  const { reportId } = addReport(no, null)
  const result = retention(reportId)
  assert.equal(result.paidReportsRetained, 0)
  assert.deepEqual(result.retainedList, [])
})

test.after(() => db.close())
