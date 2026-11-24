/**
 * 试穿上传的身份门禁与落盘/落库一致性。
 * 使用内存 SQLite、系统临时上传目录和真实 Express HTTP 路由。
 */
const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-tryon-cleanup-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_UPLOAD_DIR = uploadDir
process.env.SECRET_KEY = 'tryon-cleanup-test-secret'

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = { id: initPath, filename: initPath, loaded: true, exports: db, paths: [] }

const dashscope = require('../services/dashscopeService')
const realVirtualTryon = dashscope.virtualTryon
const express = require('express')
const tryonRoutes = require('../routes/tryon')

const SESSION = 'acct_44444444-4444-4444-8444-444444444444'
const EXPIRED_SESSION = 'acct_55555555-5555-4555-8555-555555555555'
const INVALID_SESSION = 'acct_88888888-8888-4888-8888-888888888888'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let server
let base

before(async () => {
  db.prepare(
    "INSERT INTO users (session_id, session_expires_at) VALUES (?, datetime('now', '+30 days'))",
  ).run(SESSION)
  db.prepare(
    "INSERT INTO users (session_id, session_expires_at) VALUES (?, datetime('now', '-1 day'))",
  ).run(EXPIRED_SESSION)
  dashscope.virtualTryon = async (personUrl) => personUrl

  const app = express()
  app.use('/api/tryon', tryonRoutes)
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { message: err.message } })
  })
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
})

beforeEach(() => {
  for (const name of fs.readdirSync(uploadDir)) {
    fs.unlinkSync(path.join(uploadDir, name))
  }
  for (const table of ['upload_files', 'tryon_results', 'photos']) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
})

after(async () => {
  dashscope.virtualTryon = realVirtualTryon
  await new Promise((resolve) => server.close(resolve))
  db.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function uploadNames() {
  return fs.readdirSync(uploadDir).sort()
}

async function directTryon(sessionId) {
  const form = new FormData()
  form.append('person_image', new Blob([PNG], { type: 'image/png' }), 'person.png')
  form.append('garment_image', new Blob([PNG], { type: 'image/png' }), 'garment.png')
  form.append('category', 'top')
  const headers = sessionId ? { 'x-session-id': sessionId } : {}
  const res = await fetch(`${base}/api/tryon/direct`, { method: 'POST', headers, body: form })
  return { status: res.status, body: await res.json() }
}

test('无 session 的试穿返回 401，不建档也不写文件', async () => {
  const usersBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  const result = await directTryon()
  assert.equal(result.status, 401, JSON.stringify(result.body))
  assert.deepEqual(uploadNames(), [])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, usersBefore)
})

test('无效 session 的试穿返回 401，不建档也不写文件', async () => {
  const usersBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  const result = await directTryon(INVALID_SESSION)
  assert.equal(result.status, 401, JSON.stringify(result.body))
  assert.deepEqual(uploadNames(), [])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, usersBefore)
})

test('过期 session 的试穿返回 401，不写文件', async () => {
  const result = await directTryon(EXPIRED_SESSION)
  assert.equal(result.status, 401, JSON.stringify(result.body))
  assert.deepEqual(uploadNames(), [])
})

test('有效身份试穿成功后文件、照片、结果和所有权台账一致', async () => {
  const result = await directTryon(SESSION)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.data.saved, true)
  const names = uploadNames()
  assert.equal(names.length, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tryon_results').get().n, 1)
  assert.deepEqual(
    db
      .prepare('SELECT filename FROM upload_files ORDER BY filename')
      .all()
      .map((r) => r.filename),
    names,
  )
})

test('试穿结果事务失败返回 500 并清理本轮全部文件与半截记录', async () => {
  db.exec(`CREATE TRIGGER fail_tryon_insert BEFORE INSERT ON tryon_results
           BEGIN SELECT RAISE(ABORT, 'forced tryon failure'); END`)
  try {
    const result = await directTryon(SESSION)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.deepEqual(uploadNames(), [])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tryon_results').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM upload_files').get().n, 0)
  } finally {
    db.exec('DROP TRIGGER fail_tryon_insert')
  }
})

test('第二张图写盘失败返回 500 并清理第一张已写文件', async () => {
  const realWriteFileSync = fs.writeFileSync
  let writes = 0
  fs.writeFileSync = function (file, ...args) {
    if (path.dirname(String(file)) === uploadDir) {
      writes += 1
      if (writes === 2) throw Object.assign(new Error('forced write failure'), { code: 'ENOSPC' })
    }
    return realWriteFileSync.call(this, file, ...args)
  }
  try {
    const result = await directTryon(SESSION)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.deepEqual(uploadNames(), [])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM upload_files').get().n, 0)
  } finally {
    fs.writeFileSync = realWriteFileSync
  }
})
