'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

test('启动隐私清理删除过期未同步会话时，同时删除其推荐画像快照', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-session-cleanup-'))
  const dbPath = path.join(tempDir, 'cleanup.db')
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'))
    db.prepare('INSERT INTO stores (id, name) VALUES (1, ?)').run('测试门店')
    const session = db
      .prepare(
        `INSERT INTO customer_sessions (session_id, store_id, profile_data, synced, expires_at)
         VALUES ('expired-unsynced', 1, '{"height_cm":170}', 0, '2000-01-01T00:00:00.000Z')`,
      )
      .run()
    db.prepare(
      `INSERT INTO recommendation_logs (session_id, mode, input_snapshot, result)
       VALUES ('expired-unsynced', 'store', '{"height_cm":170}', '{}')`,
    ).run()
    db.prepare(
      `INSERT INTO customer_sessions (session_id, store_id, profile_data, synced, expires_at)
       VALUES ('active', 1, '{}', 0, '2999-01-01T00:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO recommendation_logs (session_id, mode, input_snapshot, result)
       VALUES ('active', 'store', '{}', '{}')`,
    ).run()
    assert.ok(session.lastInsertRowid > 0)
    db.close()

    const initPath = path.join(__dirname, '..', 'db', 'init.js')
    const result = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(initPath)}); process.exit(0)`],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          STYLEAI_DB_PATH: dbPath,
          STYLEAI_SKIP_MODEL_SCAN: '1',
          STYLEAI_MODEL_DIR: path.join(tempDir, 'empty-models'),
          STYLEAI_UPLOAD_DIR: path.join(tempDir, 'uploads'),
          STYLEAI_LOG_DIR: path.join(tempDir, 'logs'),
          DOTENV_CONFIG_PATH: path.join(tempDir, 'disabled.env'),
          ADMIN_PASSWORD: 'session-cleanup-test-password',
          SECRET_KEY: 'session-cleanup-test-secret',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const verify = new Database(dbPath, { readonly: true })
    try {
      assert.equal(
        verify.prepare('SELECT COUNT(*) AS n FROM customer_sessions').get().n,
        1,
        '只应留下未过期会话',
      )
      assert.deepEqual(
        verify
          .prepare('SELECT session_id FROM recommendation_logs ORDER BY session_id')
          .all()
          .map((row) => row.session_id),
        ['active'],
        '过期会话的 input_snapshot 不能继续留在推荐日志里',
      )
      assert.equal(verify.pragma('integrity_check', { simple: true }), 'ok')
    } finally {
      verify.close()
    }
  } finally {
    if (db.open) db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('启动隐私清理保留已到账报告时，连同生成依据一起保留', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-session-cleanup-paid-'))
  const dbPath = path.join(tempDir, 'cleanup.db')
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'))
    const owner = db
      .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
      .run('清理测试付款人', 'sid-cleanup-paid-owner')
    const ownerId = Number(owner.lastInsertRowid)
    db.prepare(
      `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, paid_at)
       VALUES ('A3-cleanup-paid', ?, '测试报告', 9900, 'paid', datetime('now'))`,
    ).run(ownerId)
    const sessionId = 'expired-with-paid-report'
    db.prepare(
      `INSERT INTO customer_sessions (session_id, profile_data, synced, expires_at)
       VALUES (?, '{"height_cm":170}', 0, '2000-01-01T00:00:00.000Z')`,
    ).run(sessionId)
    const insertLog = db.prepare(
      `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
       VALUES (?, ?, 'store', '{"height_cm":170}', ?)`,
    )
    const basis = insertLog.run(sessionId, null, '{}')
    const report = insertLog.run(
      sessionId,
      ownerId,
      JSON.stringify({
        paid_report: {
          out_trade_no: 'A3-cleanup-paid',
          basis_log_id: Number(basis.lastInsertRowid),
        },
      }),
    )
    const free = insertLog.run(sessionId, null, '{}')
    db.close()

    const initPath = path.join(__dirname, '..', 'db', 'init.js')
    const result = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(initPath)}); process.exit(0)`],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          STYLEAI_DB_PATH: dbPath,
          STYLEAI_SKIP_MODEL_SCAN: '1',
          STYLEAI_MODEL_DIR: path.join(tempDir, 'empty-models'),
          STYLEAI_UPLOAD_DIR: path.join(tempDir, 'uploads'),
          STYLEAI_LOG_DIR: path.join(tempDir, 'logs'),
          DOTENV_CONFIG_PATH: path.join(tempDir, 'disabled.env'),
          ADMIN_PASSWORD: 'session-cleanup-test-password',
          SECRET_KEY: 'session-cleanup-test-secret',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const verify = new Database(dbPath, { readonly: true })
    try {
      assert.equal(
        verify
          .prepare('SELECT COUNT(*) AS n FROM customer_sessions WHERE session_id = ?')
          .get(sessionId).n,
        0,
        '过期未同步会话本身仍必须删除',
      )
      assert.deepEqual(
        verify
          .prepare('SELECT id FROM recommendation_logs WHERE session_id = ? ORDER BY id')
          .all(sessionId),
        [{ id: Number(basis.lastInsertRowid) }, { id: Number(report.lastInsertRowid) }],
        '报告和生成依据是同一份交付物，不能只留下报告而删掉复读依据',
      )
      assert.equal(
        verify
          .prepare('SELECT COUNT(*) AS n FROM recommendation_logs WHERE id = ?')
          .get(free.lastInsertRowid).n,
        0,
        '普通免费样本仍随过期会话清除',
      )
      assert.equal(verify.pragma('integrity_check', { simple: true }), 'ok')
    } finally {
      verify.close()
    }
  } finally {
    if (db.open) db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
