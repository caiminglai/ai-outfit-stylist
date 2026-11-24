/**
 * 后台数据浏览的列级脱敏回归。
 *
 * 使用系统临时目录中的真实 SQLite 与真实 Express 路由；不读取运行库。
 * 只验证 API 序列化结果，数据库中的凭据与支付原文必须保持原样。
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-admin-masking-'))
const db = new Database(path.join(tempDir, 'masking.db'))
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))

const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: db,
  paths: [],
}

process.env.SECRET_KEY = 'admin-data-masking-test-secret'
const express = require('express')
const { generateAdminToken } = require('../middleware/auth')
const adminRoutes = require('../routes/admin')

const app = express()
app.use('/admin', adminRoutes)

let server
let base
let token
const SESSION = 'acct_11111111-1111-4111-8111-111111111111'
const ADMIN_HASH = bcrypt.hashSync('admin-fixture-password', 10)
const ACCOUNT_HASH = bcrypt.hashSync('member-fixture-password', 10)
const NOTIFY_RAW = JSON.stringify({ transaction_id: 'wx-raw-secret', openid: 'openid-secret' })
const TRANSACTION_ID = 'wx-raw-secret'
const CODE_URL = 'weixin://wxpay/bizpayurl?pr=secret-code'

const SESSION_TABLES = [
  'clothing_items',
  'customer_sessions',
  'recommendation_logs',
  'user_wardrobe',
  'wardrobe_outfits',
  'shopping_wishlist',
  'user_cosmetics',
  'user_accessories',
]

const SESSION_FIXTURES = {
  clothing_items: `INSERT INTO clothing_items (session_id, filename, image_url)
                  VALUES (?, 'masking-item.png', '/uploads/masking-item.png')`,
  customer_sessions: `INSERT INTO customer_sessions (session_id) VALUES (?)`,
  recommendation_logs: `INSERT INTO recommendation_logs (session_id, mode) VALUES (?, 'test')`,
  user_wardrobe: `INSERT INTO user_wardrobe (session_id, name, category)
                  VALUES (?, '脱敏上衣', '上装')`,
  wardrobe_outfits: `INSERT INTO wardrobe_outfits (session_id, name, item_ids)
                     VALUES (?, '脱敏搭配', '[]')`,
  shopping_wishlist: `INSERT INTO shopping_wishlist (session_id, item_name)
                      VALUES (?, '脱敏心愿单')`,
  user_cosmetics: `INSERT INTO user_cosmetics (session_id, name, category)
                   VALUES (?, '脱敏化妆品', '面部')`,
  user_accessories: `INSERT INTO user_accessories (session_id, name, category)
                     VALUES (?, '脱敏配饰', '首饰')`,
}

before(async () => {
  db.prepare(
    'INSERT INTO admin_users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
  ).run('admin', ADMIN_HASH, 'superadmin')
  db.prepare(
    `INSERT INTO users (session_id, nickname, session_expires_at)
     VALUES (?, '脱敏会员', datetime('now', '+30 days'))`,
  ).run(SESSION)
  db.prepare('INSERT INTO user_accounts (phone, password_hash, user_id) VALUES (?, ?, 1)').run(
    '13800000000',
    ACCOUNT_HASH,
  )
  const insertOrder = db.prepare(
    `INSERT INTO payment_orders
       (out_trade_no, user_id, amount_fen, status, transaction_id, code_url, notify_raw)
     VALUES (?, 1, 19900, 'paid', ?, ?, ?)`,
  )
  insertOrder.run('masking-order-1', TRANSACTION_ID, CODE_URL, NOTIFY_RAW)
  insertOrder.run('masking-order-2', null, null, null)
  for (const tableName of SESSION_TABLES) {
    db.prepare(SESSION_FIXTURES[tableName]).run(SESSION)
  }

  token = generateAdminToken('admin')
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

async function getTable(tableName, authToken = token) {
  const headers = authToken ? { authorization: `Bearer ${authToken}` } : {}
  const res = await fetch(`${base}/admin/api/data/${tableName}`, { headers })
  const body = await res.json()
  return { res, body }
}

function assertNoSecret(text) {
  for (const secret of [SESSION, ADMIN_HASH, ACCOUNT_HASH, NOTIFY_RAW, TRANSACTION_ID, CODE_URL]) {
    assert.ok(!text.includes(secret), `响应不得包含真实敏感值: ${secret}`)
  }
}

test('users.session_id 固定掩码，昵称与分页信封不变', async () => {
  const { res, body } = await getTable('users')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(body.success, true)
  assert.strictEqual(body.data.total, 1)
  assert.strictEqual(body.data.rows[0].session_id, '***')
  assert.strictEqual(body.data.rows[0].nickname, '脱敏会员')
  assertNoSecret(JSON.stringify(body))
})

test('所有后台表中的 session_id 统一掩码，不泄露会员凭据', async () => {
  for (const tableName of SESSION_TABLES) {
    const { res, body } = await getTable(tableName)
    assert.strictEqual(res.status, 200, tableName)
    assert.strictEqual(body.data.total, 1, tableName)
    assert.strictEqual(body.data.rows[0].session_id, '***', tableName)
    assert.ok(!JSON.stringify(body).includes(SESSION), tableName)
  }
})

test('admin_users.password_hash 固定掩码，用户名与角色保留', async () => {
  const { res, body } = await getTable('admin_users')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(body.data.rows[0].password_hash, '***')
  assert.strictEqual(body.data.rows[0].username, 'admin')
  assert.strictEqual(body.data.rows[0].role, 'superadmin')
  assertNoSecret(JSON.stringify(body))
})

test('user_accounts.password_hash 固定掩码，手机号与 user_id 保留', async () => {
  const { res, body } = await getTable('user_accounts')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(body.data.rows[0].password_hash, '***')
  assert.strictEqual(body.data.rows[0].phone, '13800000000')
  assert.strictEqual(body.data.rows[0].user_id, 1)
  assertNoSecret(JSON.stringify(body))
})

test('payment_orders 的支付原文、交易号与支付链接固定掩码，订单金额保留', async () => {
  const { res, body } = await getTable('payment_orders')
  assert.strictEqual(res.status, 200)
  const paid = body.data.rows.find((row) => row.out_trade_no === 'masking-order-1')
  const empty = body.data.rows.find((row) => row.out_trade_no === 'masking-order-2')
  assert.ok(paid && empty)
  assert.strictEqual(paid.notify_raw, '***')
  assert.strictEqual(paid.transaction_id, '***')
  assert.strictEqual(paid.code_url, '***')
  assert.strictEqual(paid.amount_fen, 19900)
  assert.strictEqual(paid.status, 'paid')
  assert.strictEqual(empty.notify_raw, '***')
  assert.strictEqual(empty.transaction_id, '***')
  assert.strictEqual(empty.code_url, '***')
  assertNoSecret(JSON.stringify(body))
})

test('未带管理员 Token 仍返回原有 401 信封', async () => {
  const { res, body } = await getTable('users', null)
  assert.strictEqual(res.status, 401)
  assert.strictEqual(body.success, false)
  assert.strictEqual(body.error.code, 'UNAUTHORIZED')
})

test('脱敏只发生在 API 序列化层，数据库原值未被改写', () => {
  for (const tableName of SESSION_TABLES) {
    assert.strictEqual(
      db.prepare(`SELECT session_id FROM ${tableName} LIMIT 1`).get().session_id,
      SESSION,
      tableName,
    )
  }
  assert.strictEqual(
    db.prepare('SELECT session_id FROM users WHERE id = 1').get().session_id,
    SESSION,
  )
  assert.strictEqual(
    db.prepare('SELECT password_hash FROM admin_users WHERE id = 1').get().password_hash,
    ADMIN_HASH,
  )
  assert.strictEqual(
    db.prepare('SELECT password_hash FROM user_accounts WHERE id = 1').get().password_hash,
    ACCOUNT_HASH,
  )
  const order = db
    .prepare("SELECT * FROM payment_orders WHERE out_trade_no = 'masking-order-1'")
    .get()
  assert.strictEqual(order.notify_raw, NOTIFY_RAW)
  assert.strictEqual(order.transaction_id, TRANSACTION_ID)
  assert.strictEqual(order.code_url, CODE_URL)
})
