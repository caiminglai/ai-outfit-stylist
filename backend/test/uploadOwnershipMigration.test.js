/**
 * 老库 upload_files 升级回归。
 *
 * 只回填服务端上传链路产生的历史 URL；用户可编辑的 image_url / cover_url
 * 不能证明归属，否则升级本身会重新打开“引用他人文件后给自己签名”的口子。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { backfillUploadOwnership } = require('../db/backfillUploadOwnership')

function fixture() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
  db.prepare(
    "INSERT INTO users (id, session_id, session_expires_at) VALUES (1, 'legacy-session', datetime('now', '+30 days'))",
  ).run()
  return db
}

test('老库只从服务端上传表回填所有权，忽略用户可编辑引用', () => {
  const db = fixture()
  try {
    db.prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)').run(
      1,
      '/uploads/legacy-photo.png?expires=123&signature=old',
      'face',
    )
    db.prepare('INSERT INTO clothing_items (session_id, filename, image_url) VALUES (?, ?, ?)').run(
      'legacy-session',
      'legacy-cloth.png',
      '/uploads/legacy-cloth.png',
    )
    db.prepare(
      "INSERT INTO deposits (user_id, channel, amount, proof_url, status) VALUES (?, 'wechat', 0.99, ?, 'pending')",
    ).run(1, '/uploads/legacy-proof.png')
    db.prepare(
      "INSERT INTO tryon_results (user_id, photo_id, result_url, status) VALUES (1, NULL, ?, 'done')",
    ).run('/uploads/legacy-tryon.png')
    db.prepare(
      'INSERT INTO user_wardrobe (session_id, user_id, name, category, image_url) VALUES (?, ?, ?, ?, ?)',
    ).run('legacy-session', 1, '攻击者引用', '上装', '/uploads/someone-else.png')
    db.prepare(
      "INSERT INTO creator_works (user_id, share_code, type, title, cover_url, status) VALUES (1, 'legacy-code', 'outfit', '引用封面', ?, 'pending')",
    ).run('/uploads/another-else.png')

    assert.equal(backfillUploadOwnership(db), 4)
    const rows = db.prepare('SELECT filename, user_id FROM upload_files ORDER BY filename').all()
    assert.deepEqual(rows, [
      { filename: 'legacy-cloth.png', user_id: 1 },
      { filename: 'legacy-photo.png', user_id: 1 },
      { filename: 'legacy-proof.png', user_id: 1 },
      { filename: 'legacy-tryon.png', user_id: 1 },
    ])
  } finally {
    db.close()
  }
})

test('启动初始化真实执行回填，历史照片重新归还原会员', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-upload-backfill-'))
  const dbPath = path.join(dir, 'legacy.db')
  try {
    const legacy = new Database(dbPath)
    legacy.pragma('foreign_keys = ON')
    legacy.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
    legacy.prepare("INSERT INTO users (id, session_id) VALUES (1, 'legacy-session')").run()
    legacy
      .prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
      .run(1, '/uploads/startup-legacy.png', 'face')
    legacy.close()

    execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'db', 'init.js'))})`],
      {
        env: {
          ...process.env,
          STYLEAI_DB_PATH: dbPath,
          STYLEAI_SKIP_MODEL_SCAN: '1',
          STYLEAI_TEST_INIT: '1',
          SECRET_KEY: 'upload-backfill-test-secret',
        },
        stdio: 'pipe',
      },
    )

    const reopened = new Database(dbPath)
    try {
      assert.deepEqual(reopened.prepare('SELECT filename, user_id FROM upload_files').all(), [
        { filename: 'startup-legacy.png', user_id: 1 },
      ])
    } finally {
      reopened.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('回填幂等且不覆盖已有归属，非法路径与孤儿用户被跳过', () => {
  const db = fixture()
  try {
    db.prepare('INSERT INTO upload_files (filename, user_id) VALUES (?, ?)').run(
      'legacy-photo.png',
      1,
    )
    db.prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)').run(
      1,
      '/uploads/legacy-photo.png',
      'face',
    )
    db.prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)').run(
      1,
      '/uploads/../escape.png',
      'face',
    )
    db.pragma('foreign_keys = OFF')
    db.prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)').run(
      999,
      'https://evil.example/uploads/external.png',
      'face',
    )

    assert.equal(backfillUploadOwnership(db), 0)
    assert.equal(backfillUploadOwnership(db), 0)
    assert.deepEqual(db.prepare('SELECT filename, user_id FROM upload_files').all(), [
      { filename: 'legacy-photo.png', user_id: 1 },
    ])
  } finally {
    db.close()
  }
})
