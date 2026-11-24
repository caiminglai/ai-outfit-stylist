/**
 * 会话生命周期回归测试。
 *
 * 使用内存 SQLite 与真实 Express 路由，不读取运行数据库。
 * 运行：STYLEAI_TEST_INIT=1 STYLEAI_SKIP_MODEL_SCAN=1 node --test test/sessionLifecycle.test.js
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

const BACKEND = path.join(__dirname, '..')
const SCHEMA_SQL = fs.readFileSync(path.join(BACKEND, 'db', 'schema.sql'), 'utf-8')

const memDb = new Database(':memory:')
memDb.exec(SCHEMA_SQL)
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

process.env.SECRET_KEY = 'session-lifecycle-test-secret'
const bcrypt = require('bcryptjs')
const { getCurrentUser, optionalUser, generateAdminToken } = require('../middleware/auth')
const express = require('express')
const authRoutes = require('../routes/auth')
const historyRoutes = require('../routes/history')

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/history', historyRoutes)

let server
let base
let adminToken

before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
  memDb
    .prepare('INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, 1)')
    .run('admin', bcrypt.hashSync('Adm1n-Pass-123', 10))
  adminToken = generateAdminToken('admin')
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  memDb.close()
})

const limiters = new Map()
for (const layer of authRoutes.stack) {
  const routePath = layer.route && layer.route.path
  if (!routePath) continue
  const mw = layer.route.stack.map((s) => s.handle).find((h) => h && h.rateLimitProfile)
  if (mw) limiters.set(routePath, mw)
}

async function resetBuckets() {
  for (const mw of limiters.values()) {
    for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) {
      await mw.resetKey(key)
    }
  }
}

async function call(method, route, { body, sessionId, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (sessionId) headers['x-session-id'] = sessionId
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${base}${route}`, {
    method,
    headers,
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

const post = (route, body, options) => call('POST', route, { body, ...options })
const protectedHistory = (sessionId) => call('GET', '/api/history', { sessionId })
const reqWith = (sid) => ({ headers: { 'x-session-id': sid }, body: {}, socket: {} })

function userColumns(db) {
  return db
    .prepare('SELECT name, type FROM pragma_table_info(?)')
    .all('users')
    .map(({ name, type }) => ({ name, type }))
}

function sessionRow(sid) {
  return memDb.prepare('SELECT * FROM users WHERE session_id = ?').get(sid)
}

function accountRow(phone) {
  return memDb
    .prepare(
      `SELECT u.*, a.password_hash
       FROM user_accounts a JOIN users u ON u.id = a.user_id
       WHERE a.phone = ?`,
    )
    .get(phone)
}

function remainingDays(sid) {
  const row = memDb
    .prepare(
      `SELECT julianday(session_expires_at) - julianday('now') AS days
       FROM users WHERE session_id = ?`,
    )
    .get(sid)
  return row ? Number(row.days) : null
}

function assertThirtyDays(sid) {
  const days = remainingDays(sid)
  assert.ok(
    Number.isFinite(days) && days > 29.99 && days < 30.01,
    `${sid} 的剩余有效期应约 30 天，实际为 ${days}`,
  )
}

function createAccount(phone, password, sid, nickname = '会员') {
  const hash = bcrypt.hashSync(password, 10)
  const user = memDb
    .prepare(
      `INSERT INTO users (session_id, nickname, session_expires_at)
       VALUES (?, ?, datetime('now', '+30 days'))`,
    )
    .run(sid, nickname)
  memDb
    .prepare('INSERT INTO user_accounts (phone, password_hash, user_id) VALUES (?, ?, ?)')
    .run(phone, hash, user.lastInsertRowid)
  return Number(user.lastInsertRowid)
}

// 每张表都有一条最小合法样本；hasUserId 同时用于断言轮换只改 session_id。
const SESSION_OWNED_FIXTURES = [
  {
    table: 'user_wardrobe',
    hasUserId: true,
    sql: `INSERT INTO user_wardrobe (session_id, user_id, name, category)
          VALUES (?, ?, '回归衬衫', '上衣')`,
  },
  {
    table: 'wardrobe_outfits',
    hasUserId: true,
    sql: `INSERT INTO wardrobe_outfits (session_id, user_id, name, item_ids)
          VALUES (?, ?, '回归搭配', '[]')`,
  },
  {
    table: 'shopping_wishlist',
    hasUserId: true,
    sql: `INSERT INTO shopping_wishlist (session_id, user_id, item_name)
          VALUES (?, ?, '回归心愿单品')`,
  },
  {
    table: 'user_cosmetics',
    hasUserId: true,
    sql: `INSERT INTO user_cosmetics (session_id, user_id, name, category)
          VALUES (?, ?, '回归口红', '唇妆')`,
  },
  {
    table: 'user_accessories',
    hasUserId: true,
    sql: `INSERT INTO user_accessories (session_id, user_id, name, category)
          VALUES (?, ?, '回归项链', '首饰')`,
  },
  {
    table: 'clothing_items',
    hasUserId: false,
    sql: `INSERT INTO clothing_items (session_id, filename, image_url)
          VALUES (?, 'regression.jpg', '/uploads/regression.jpg')`,
  },
  {
    table: 'recommendation_logs',
    hasUserId: true,
    sql: `INSERT INTO recommendation_logs (session_id, user_id, mode)
          VALUES (?, ?, 'store')`,
  },
  {
    table: 'item_feedback',
    hasUserId: true,
    sql: null,
  },
]

function insertSessionOwnedFixture({ table, hasUserId, sql }, sid, userId) {
  if (table !== 'item_feedback') {
    return memDb.prepare(sql).run(...(hasUserId ? [sid, userId] : [sid]))
  }
  const item = memDb
    .prepare(
      `INSERT INTO user_wardrobe (session_id, user_id, name, category)
              VALUES (?, ?, '回归打分上衣', '上衣')`,
    )
    .run(sid, userId)
  return memDb
    .prepare(
      `INSERT INTO item_feedback (actor_key, user_id, session_id, wardrobe_item_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(`s${sid}`, userId, sid, item.lastInsertRowid)
}

test('新库 users 表包含 TEXT 类型的 session_expires_at', () => {
  const db = new Database(':memory:')
  try {
    db.exec(SCHEMA_SQL)
    const column = userColumns(db).find((c) => c.name === 'session_expires_at')
    assert.ok(column, '新库建表必须包含 session_expires_at')
    assert.strictEqual(column.type, 'TEXT')
  } finally {
    db.close()
  }
})

test('老库启动迁移补出 session_expires_at，并保留历史 NULL 行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-session-migration-'))
  const dbPath = path.join(dir, 'legacy.db')
  let db
  try {
    db = new Database(dbPath)
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        phone TEXT UNIQUE,
        nickname TEXT,
        gender TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_active_at TEXT
      );
      INSERT INTO users (session_id, nickname) VALUES ('legacy-session-0001', '老用户');
    `)
    db.close()
    db = null

    const init = spawnSync(
      process.execPath,
      ['-e', "const db = require('./db/init'); db.stopWalCheckpointTimer(); db.close()"],
      {
        cwd: BACKEND,
        env: {
          ...process.env,
          STYLEAI_DB_PATH: dbPath,
          STYLEAI_TEST_INIT: '1',
          STYLEAI_SKIP_MODEL_SCAN: '1',
          ADMIN_PASSWORD: 'migration-test-admin-password',
          SECRET_KEY: 'migration-test-secret-key-at-least-16-chars',
        },
        encoding: 'utf8',
      },
    )
    assert.strictEqual(init.status, 0, `老库初始化失败：${init.stdout || ''}\n${init.stderr || ''}`)

    db = new Database(dbPath)
    const column = userColumns(db).find((c) => c.name === 'session_expires_at')
    assert.ok(column, 'MISSING_COLUMNS 必须给老库补出 session_expires_at')
    assert.strictEqual(column.type, 'TEXT')
    const legacy = db
      .prepare('SELECT session_id, session_expires_at FROM users WHERE session_id = ?')
      .get('legacy-session-0001')
    assert.deepStrictEqual(legacy, {
      session_id: 'legacy-session-0001',
      session_expires_at: null,
    })
  } finally {
    if (db) db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('/guest 创建 30 天会话，受保护接口可访问', async () => {
  await resetBuckets()
  const r = await post('/api/auth/guest', { nickname: '游客' })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const sid = r.body.data.session_id
  assertThirtyDays(sid)
  assert.strictEqual((await protectedHistory(sid)).status, 200)
})

test('/register 创建独立的新会话，并给出 30 天有效期', async () => {
  await resetBuckets()
  const guest = await post('/api/auth/guest', {})
  const r = await post('/api/auth/register', {
    phone: '13800138001',
    password: 'abcdef',
    nickname: '新会员',
  })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const sid = r.body.data.session_id
  assert.match(sid, /^acct_[0-9a-f-]{36}$/i, `注册 session 必须使用 acct_ UUID：${sid}`)
  assert.notStrictEqual(sid, guest.body.data.session_id)
  assertThirtyDays(sid)
  assert.strictEqual((await protectedHistory(sid)).status, 200)
})

test('未知但形状合法的游客 session 首次访问受保护接口时补 30 天窗口', async () => {
  const sid = 'sess_unknown_guest_0001'
  const r = await protectedHistory(sid)
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assertThirtyDays(sid)
})

test('optionalUser 拒绝把未知 acct_ ID 自动补建成游客', async () => {
  const sid = 'acct_unknown_member_0001'
  assert.strictEqual(optionalUser(reqWith(sid)), null, '未知 acct_ ID 不能获得游客身份')
  assert.strictEqual(sessionRow(sid), undefined, 'optionalUser 不能为 acct_ ID 插入 users 行')

  const r = await protectedHistory(sid)
  assert.strictEqual(r.status, 401, JSON.stringify(r.body))
  assert.strictEqual(r.body.error.code, 'UNAUTHORIZED')
  assert.strictEqual(sessionRow(sid), undefined, '受保护接口也不能复活未知 acct_ ID')
})

test('过期 session 请求受保护接口得 401，且不会作为新游客复活', async () => {
  const sid = 'sess_expired_guest_0001'
  memDb
    .prepare(
      `INSERT INTO users (session_id, session_expires_at)
       VALUES (?, datetime('now', '-1 second'))`,
    )
    .run(sid)
  const r = await protectedHistory(sid)
  assert.strictEqual(r.status, 401, JSON.stringify(r.body))
  assert.strictEqual(r.body.error.code, 'UNAUTHORIZED')
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM users WHERE session_id = ?').get(sid).n,
    1,
    '过期身份不能被自动补游客逻辑重新创建',
  )
})

test('历史 NULL 首次命中补 30 天窗口并记录活跃时间', () => {
  const sid = 'sess_legacy_null_0001'
  memDb.prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run(sid, '老账号')
  const user = getCurrentUser(reqWith(sid))
  assert.ok(user, '历史 NULL 必须继续放行，避免升级即全员掉线')
  assertThirtyDays(sid)
  assert.ok(sessionRow(sid).last_active_at, '首次命中必须补 last_active_at')
})

test('活跃时间刷新不延长固定会话窗口', () => {
  const sid = 'sess_fixed_window_0001'
  memDb
    .prepare(
      `INSERT INTO users (session_id, session_expires_at, last_active_at)
       VALUES (?, datetime('now', '+2 days'), datetime('now', '-2 hours'))`,
    )
    .run(sid)
  const expiryBefore = sessionRow(sid).session_expires_at
  const activeBefore = sessionRow(sid).last_active_at
  assert.ok(getCurrentUser(reqWith(sid)))
  assert.strictEqual(sessionRow(sid).session_expires_at, expiryBefore)
  assert.notStrictEqual(sessionRow(sid).last_active_at, activeBefore)
})

test('历史 sess_ 会员 ID 轮换仍写墓碑，旧 ID 401 且不能补建成游客', async () => {
  await resetBuckets()
  const phone = '13800138002'
  const oldSid = 'sess_account_before_login_0001'
  const userId = createAccount(phone, 'abcdef', oldSid)

  const r = await post('/api/auth/login', { phone, password: 'abcdef' })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const newSid = r.body.data.session_id
  assert.match(newSid, /^acct_[0-9a-f-]{36}$/i, `登录 session 必须使用 acct_ UUID：${newSid}`)
  assert.notStrictEqual(newSid, oldSid, '正式登录必须签发新 session')
  assertThirtyDays(newSid)
  assert.deepStrictEqual(
    memDb
      .prepare('SELECT session_id, user_id FROM revoked_sessions WHERE session_id = ?')
      .get(oldSid),
    { session_id: oldSid, user_id: userId },
    '升级前 sess_ 会员 ID 必须留下一次性墓碑',
  )
  assert.strictEqual(sessionRow(oldSid), undefined, '旧 session 不应继续挂在 users 行上')
  assert.strictEqual((await protectedHistory(oldSid)).status, 401)
  assert.strictEqual(sessionRow(oldSid), undefined, '历史 sess_ 旧 ID 也不能被补建成游客')
  assert.strictEqual((await protectedHistory(newSid)).status, 200)
})

test('acct_ 会员 ID 轮换不写墓碑，旧 ID 401，重复登录不增长墓碑', async () => {
  await resetBuckets()
  const phone = '13800138006'
  let oldSid = 'acct_member_before_login_0001'
  createAccount(phone, 'abcdef', oldSid)

  for (let login = 1; login <= 2; login++) {
    const r = await post('/api/auth/login', { phone, password: 'abcdef' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    const newSid = r.body.data.session_id
    assert.notStrictEqual(newSid, oldSid, '正式登录必须签发新 session')
    assertThirtyDays(newSid)
    assert.strictEqual(
      memDb.prepare('SELECT COUNT(*) n FROM revoked_sessions WHERE session_id = ?').get(oldSid).n,
      0,
      'acct_ 旧 ID 由自动补建闸门保证失效，不能再留下永久墓碑',
    )
    assert.match(newSid, /^acct_[0-9a-f-]{36}$/i, `登录 session 必须使用 acct_ UUID：${newSid}`)
    assert.strictEqual(sessionRow(oldSid), undefined, '旧 acct_ session 不应继续挂在 users 行上')
    assert.strictEqual((await protectedHistory(oldSid)).status, 401)
    assert.strictEqual(sessionRow(oldSid), undefined, '旧 acct_ ID 不能补建成新游客')
    assert.strictEqual((await protectedHistory(newSid)).status, 200)
    oldSid = newSid
  }
})

for (const fixture of SESSION_OWNED_FIXTURES) {
  test(`登录轮换迁移 ${fixture.table}.session_id，其他归属字段保持不变`, async () => {
    await resetBuckets()
    const phone = `138001380${SESSION_OWNED_FIXTURES.indexOf(fixture) + 10}`
    const oldSid = `sess_migrate_${fixture.table}_0001`
    const userId = createAccount(phone, 'abcdef', oldSid)
    insertSessionOwnedFixture(fixture, oldSid, userId)

    const r = await post('/api/auth/login', { phone, password: 'abcdef' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    const newSid = r.body.data.session_id
    assert.notStrictEqual(newSid, oldSid)
    assert.strictEqual(
      memDb.prepare(`SELECT COUNT(*) n FROM ${fixture.table} WHERE session_id = ?`).get(oldSid).n,
      0,
      `${fixture.table} 不能继续挂在旧 session 下`,
    )
    assert.strictEqual(
      memDb.prepare(`SELECT COUNT(*) n FROM ${fixture.table} WHERE session_id = ?`).get(newSid).n,
      1,
      `${fixture.table} 必须跟随 session 轮换`,
    )
    if (fixture.hasUserId) {
      assert.strictEqual(
        memDb.prepare(`SELECT user_id FROM ${fixture.table} WHERE session_id = ?`).get(newSid)
          .user_id,
        userId,
        `${fixture.table}.user_id 不能随 session 轮换被改写`,
      )
    }
    if (fixture.table === 'item_feedback') {
      assert.strictEqual(
        memDb.prepare('SELECT actor_key FROM item_feedback WHERE session_id = ?').get(newSid)
          .actor_key,
        `s${oldSid}`,
        'item_feedback 只迁移 session_id，actor_key 必须保持原值',
      )
    }
  })
}

test('管理员重置密码轮换会员 session：旧 ID 立即 401，新密码可登录', async () => {
  await resetBuckets()
  const phone = '13800138003'
  const oldSid = 'sess_before_password_reset_0001'
  createAccount(phone, 'abcdef', oldSid)
  const r = await post(
    '/api/auth/admin/reset-password',
    { phone, new_password: 'brand-new-pw' },
    { token: adminToken },
  )
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.strictEqual(sessionRow(oldSid), undefined, '重置密码必须轮换会员 session')
  assert.strictEqual((await protectedHistory(oldSid)).status, 401)

  const oldPassword = await post('/api/auth/login', { phone, password: 'abcdef' })
  assert.strictEqual(oldPassword.status, 401)
  const newPassword = await post('/api/auth/login', { phone, password: 'brand-new-pw' })
  assert.strictEqual(newPassword.status, 200, JSON.stringify(newPassword.body))
  const resetSid = newPassword.body.data.session_id
  assert.match(resetSid, /^acct_[0-9a-f-]{36}$/i, `改密后登录必须签发 acct_ UUID：${resetSid}`)
  assertThirtyDays(resetSid)
})

test('登录轮换失败时事务回滚，旧 session 与数据归属保持原样', async () => {
  await resetBuckets()
  const phone = '13800138004'
  const oldSid = 'sess_login_rollback_0001'
  createAccount(phone, 'abcdef', oldSid)
  memDb
    .prepare(
      `INSERT INTO clothing_items (session_id, filename, image_url)
       VALUES (?, 'rollback.jpg', '/uploads/rollback.jpg')`,
    )
    .run(oldSid)
  memDb.exec(`
    CREATE TRIGGER fail_login_rotation
    BEFORE UPDATE ON clothing_items
    BEGIN
      SELECT RAISE(ABORT, 'forced login rotation failure');
    END;
  `)
  try {
    const r = await post('/api/auth/login', { phone, password: 'abcdef' })
    assert.strictEqual(r.status, 500, JSON.stringify(r.body))
    assert.strictEqual(accountRow(phone).session_id, oldSid, 'users 轮换不能留下半状态')
    assert.strictEqual((await protectedHistory(oldSid)).status, 200)
    assert.strictEqual(
      memDb.prepare('SELECT COUNT(*) n FROM clothing_items WHERE session_id = ?').get(oldSid).n,
      1,
    )
  } finally {
    memDb.exec('DROP TRIGGER IF EXISTS fail_login_rotation')
  }
})

test('重置密码时 session 轮换失败会回滚密码，旧 session 仍有效', async () => {
  const phone = '13800138005'
  const oldSid = 'sess_reset_rollback_0001'
  const userId = createAccount(phone, 'abcdef', oldSid)
  const hashBefore = accountRow(phone).password_hash
  memDb.exec(`
    CREATE TRIGGER fail_reset_rotation
    BEFORE UPDATE OF session_id ON users
    WHEN OLD.id = ${userId}
    BEGIN
      SELECT RAISE(ABORT, 'forced reset rotation failure');
    END;
  `)
  try {
    const r = await post(
      '/api/auth/admin/reset-password',
      { phone, new_password: 'brand-new-pw' },
      { token: adminToken },
    )
    assert.strictEqual(r.status, 500, JSON.stringify(r.body))
    assert.strictEqual(accountRow(phone).password_hash, hashBefore, '密码更新必须随事务回滚')
    assert.strictEqual(accountRow(phone).session_id, oldSid, 'session 不能变成半轮换状态')
    assert.strictEqual((await protectedHistory(oldSid)).status, 200)
    assert.ok(bcrypt.compareSync('abcdef', hashBefore))
  } finally {
    memDb.exec('DROP TRIGGER IF EXISTS fail_reset_rotation')
  }
})
