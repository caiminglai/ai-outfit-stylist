/**
 * 会话滚动活跃时间测试（middleware/auth.js，审计第 4 条）
 *
 * users.session_id 原本是永久 bearer token，没有任何过期口径。本轮只加"记录"：
 * 认证命中时刷 last_active_at（每小时最多一次），不拿它拦任何人——
 * 直接执法会把迁移前的全部老账号当场踢下线。
 *
 * db/init 用内存库替身（schema.sql 同源），不碰活库。
 * 运行: node --test test/sessionActivity.test.js
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

const { getCurrentUser, loginRequired } = require('../middleware/auth')

const SID = 'sess_activity_fixture_0001'
memDb.prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run(SID, '活跃测试')

const row = () => memDb.prepare('SELECT * FROM users WHERE session_id = ?').get(SID)
const reqWith = (sid) => ({ headers: { 'x-session-id': sid }, body: {}, socket: {} })

test('schema.sql 的新库基线：users 自带 last_active_at，且无 DEFAULT（NULL＝未观测）', () => {
  const col = memDb
    .prepare('SELECT name, dflt_value FROM pragma_table_info(?)')
    .all('users')
    .find((c) => c.name === 'last_active_at')
  assert.ok(col, '新库建表必须包含这一列')
  assert.strictEqual(col.dflt_value, null, '默认值必须为空，否则"新建即已过期"的口径会被掩盖')
})

test('认证命中就记活跃：老会话（NULL）照常通过认证，同时补上时间戳', () => {
  assert.strictEqual(row().last_active_at, null)
  const user = getCurrentUser(reqWith(SID))
  assert.ok(user, 'last_active_at 为 NULL 绝不能成为拒绝理由')
  assert.strictEqual(user.id, row().id)
  // getCurrentUser 返回的是 UPDATE 之前读的行，库里的新值要重新查
  assert.ok(row().last_active_at, '认证命中后必须落下 last_active_at')
})

test('一小时内重复认证不重写（挡住每请求一条 UPDATE 的写放大）', () => {
  getCurrentUser(reqWith(SID))
  const stamp = row().last_active_at
  getCurrentUser(reqWith(SID))
  assert.strictEqual(row().last_active_at, stamp, '同一小时窗口内应命中同一条记录')
})

test('超过一小时的旧时间戳会被刷成当前值（滚动语义）', () => {
  memDb
    .prepare("UPDATE users SET last_active_at = datetime('now', '-2 hours') WHERE session_id = ?")
    .run(SID)
  const stale = row().last_active_at
  getCurrentUser(reqWith(SID))
  assert.notStrictEqual(row().last_active_at, stale)
})

test('没带 session 时 getCurrentUser 返回 null，loginRequired 回统一形状 401', () => {
  assert.strictEqual(getCurrentUser({ headers: {}, body: {}, socket: {} }), null)
  let nextCalled = false
  let statusCode = null
  let body = null
  const res = {
    status(c) {
      statusCode = c
      return res
    },
    json(b) {
      body = b
      return res
    },
  }
  loginRequired({ headers: {}, body: {}, socket: {} }, res, () => {
    nextCalled = true
  })
  assert.strictEqual(nextCalled, false)
  assert.strictEqual(statusCode, 401)
  assert.strictEqual(body.success, false)
  assert.strictEqual(body.error.code, 'UNAUTHORIZED')
})
