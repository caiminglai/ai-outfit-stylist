/**
 * 单件记录与整个档案删除时的 upload_files / 物理文件一致性。
 * 真实 Express 路由 + 内存 SQLite + 系统临时上传目录，不访问运行库。
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-ownership-cleanup-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_UPLOAD_DIR = uploadDir
process.env.SECRET_KEY = 'ownership-cleanup-test-secret'

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = { id: initPath, filename: initPath, loaded: true, exports: db, paths: [] }

const { registerUpload } = require('../utils/uploads')
const { loginRequired } = require('../middleware/auth')
const express = require('express')
const clothingRoutes = require('../routes/clothing')
const photoRoutes = require('../routes/photos')
const creatorRoutes = require('../routes/creator')
const analysisRoutes = require('../routes/analysis')

const SESSION = 'acct_66666666-6666-4666-8666-666666666666'
const OTHER_SESSION = 'acct_77777777-7777-4777-8777-777777777777'
let userId
let otherUserId
let server
let base

before(async () => {
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (session_id, session_expires_at) VALUES (?, datetime('now', '+30 days'))",
      )
      .run(SESSION).lastInsertRowid,
  )
  otherUserId = Number(
    db
      .prepare(
        "INSERT INTO users (session_id, session_expires_at) VALUES (?, datetime('now', '+30 days'))",
      )
      .run(OTHER_SESSION).lastInsertRowid,
  )

  const app = express()
  app.use(express.json())
  app.use('/api/clothing', loginRequired, clothingRoutes)
  app.use('/api/photos', photoRoutes)
  app.use('/api/creator', creatorRoutes)
  app.use('/api/analysis', analysisRoutes)
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { message: err.message } })
  })
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

function makeFile(filename) {
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(filename))
  return `/uploads/${filename}`
}

function addClothing(filename, sessionId = SESSION) {
  const url = makeFile(filename)
  const info = db
    .prepare('INSERT INTO clothing_items (session_id, filename, image_url) VALUES (?, ?, ?)')
    .run(sessionId, filename, url)
  registerUpload(filename, sessionId === SESSION ? userId : otherUserId)
  return { id: Number(info.lastInsertRowid), url }
}

function addPhoto(filename, ownerId = userId) {
  const url = makeFile(filename)
  const info = db
    .prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
    .run(ownerId, url, 'face')
  registerUpload(filename, ownerId)
  return { id: Number(info.lastInsertRowid), url }
}

function addWork(filename, ownerId = userId) {
  const url = makeFile(filename)
  const info = db
    .prepare(
      "INSERT INTO creator_works (user_id, share_code, type, title, cover_url, status) VALUES (?, ?, 'outfit', '测试作品', ?, 'pending')",
    )
    .run(ownerId, `code-${filename}`, url)
  registerUpload(filename, ownerId)
  return { id: Number(info.lastInsertRowid), url }
}

async function remove(route, sessionId = SESSION) {
  const res = await fetch(`${base}${route}`, {
    method: 'DELETE',
    headers: sessionId ? { 'x-session-id': sessionId } : {},
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

function owned(filename) {
  return db
    .prepare('SELECT 1 FROM upload_files WHERE filename = ? AND user_id = ?')
    .get(filename, userId)
}

test('删除衣物同步删除物理文件和所有权台账', async () => {
  const item = addClothing('cloth-delete.png')
  const result = await remove(`/api/clothing/${item.id}`)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(fs.existsSync(path.join(uploadDir, 'cloth-delete.png')), false)
  assert.equal(owned('cloth-delete.png'), undefined)
  assert.equal(db.prepare('SELECT 1 FROM clothing_items WHERE id = ?').get(item.id), undefined)
})

test('删除照片同步删除物理文件和所有权台账', async () => {
  const photo = addPhoto('photo-delete.png')
  const result = await remove(`/api/photos/${photo.id}`)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(fs.existsSync(path.join(uploadDir, 'photo-delete.png')), false)
  assert.equal(owned('photo-delete.png'), undefined)
})

test('作者删除作品时同步删除封面物理文件和所有权台账', async () => {
  const work = addWork('cover-delete.png')
  const result = await remove(`/api/creator/works/${work.id}`)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(fs.existsSync(path.join(uploadDir, 'cover-delete.png')), false)
  assert.equal(owned('cover-delete.png'), undefined)
  assert.equal(db.prepare('SELECT 1 FROM creator_works WHERE id = ?').get(work.id), undefined)
})

test('非作者不能删除作品或封面', async () => {
  const work = addWork('cover-other-owner.png', otherUserId)
  const result = await remove(`/api/creator/works/${work.id}`)
  assert.equal(result.status, 404, JSON.stringify(result.body))
  assert.ok(fs.existsSync(path.join(uploadDir, 'cover-other-owner.png')))
  assert.ok(db.prepare('SELECT 1 FROM creator_works WHERE id = ?').get(work.id))
})

test('删除整个档案清理本人全部所有权文件与台账，保留他人文件', async () => {
  addClothing('archive-cloth.png')
  addPhoto('archive-photo.png')
  addWork('archive-cover.png')
  const standalone = makeFile('archive-standalone-cover.png')
  registerUpload('archive-standalone-cover.png', userId)
  const tryonUrl = makeFile('archive-tryon.png')
  registerUpload('archive-tryon.png', userId)
  db.prepare('INSERT INTO tryon_results (user_id, result_url, status) VALUES (?, ?, ?)').run(
    userId,
    tryonUrl,
    'done',
  )
  const wardrobeUrl = makeFile('archive-wardrobe.png')
  registerUpload('archive-wardrobe.png', userId)
  db.prepare(
    'INSERT INTO user_wardrobe (session_id, user_id, name, category, image_url) VALUES (?, ?, ?, ?, ?)',
  ).run(SESSION, userId, '上衣', '上装', wardrobeUrl)
  addPhoto('archive-other-user.png', otherUserId)

  const result = await remove('/api/analysis/archive')
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM upload_files WHERE user_id = ?').get(userId).n,
    0,
  )
  assert.equal(
    fs
      .readdirSync(uploadDir)
      .some((name) => name.startsWith('archive-') && name !== 'archive-other-user.png'),
    false,
  )
  assert.ok(fs.existsSync(path.join(uploadDir, 'archive-other-user.png')))
  assert.ok(owned('archive-other-user.png') === undefined)
  assert.ok(
    db
      .prepare('SELECT 1 FROM upload_files WHERE filename = ? AND user_id = ?')
      .get('archive-other-user.png', otherUserId),
  )
  assert.ok(standalone)
})

test('单件删除不误删仍被其他业务记录共享的文件', async () => {
  const item = addClothing('shared-cloth.png')
  addPhoto('shared-cloth.png')
  const result = await remove(`/api/clothing/${item.id}`)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(db.prepare('SELECT 1 FROM clothing_items WHERE id = ?').get(item.id), undefined)
  assert.ok(fs.existsSync(path.join(uploadDir, 'shared-cloth.png')))
  assert.ok(owned('shared-cloth.png'))
  assert.equal(db.prepare('SELECT url FROM photos WHERE user_id = ?').get(userId).url, item.url)
})

test('整个档案删除不误删被保留付款凭证共享的文件', async () => {
  const proof = makeFile('archive-shared-proof.png')
  registerUpload('archive-shared-proof.png', userId)
  db.prepare(
    "INSERT INTO deposits (user_id, channel, amount, proof_url, status) VALUES (?, 'wechat', 1, ?, 'pending')",
  ).run(userId, proof)
  const result = await remove('/api/analysis/archive')
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.ok(fs.existsSync(path.join(uploadDir, 'archive-shared-proof.png')))
  assert.ok(owned('archive-shared-proof.png'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deposits').get().n, 1)
})

test('衣物文件删除失败返回 500 并保留业务行、台账和文件', async () => {
  const item = addClothing('cloth-unlink-fail.png')
  const realUnlink = fs.unlinkSync
  fs.unlinkSync = (file) => {
    if (path.basename(String(file)) === 'cloth-unlink-fail.png') {
      throw Object.assign(new Error('forced unlink failure'), { code: 'EPERM' })
    }
    return realUnlink(file)
  }
  try {
    const result = await remove(`/api/clothing/${item.id}`)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.ok(db.prepare('SELECT 1 FROM clothing_items WHERE id = ?').get(item.id))
    assert.ok(owned('cloth-unlink-fail.png'))
    assert.ok(fs.existsSync(path.join(uploadDir, 'cloth-unlink-fail.png')))
  } finally {
    fs.unlinkSync = realUnlink
  }
})

test('照片文件删除失败返回 500 并保留业务行、台账和文件', async () => {
  const photo = addPhoto('photo-unlink-fail.png')
  const realUnlink = fs.unlinkSync
  fs.unlinkSync = (file) => {
    if (path.basename(String(file)) === 'photo-unlink-fail.png') {
      throw Object.assign(new Error('forced unlink failure'), { code: 'EPERM' })
    }
    return realUnlink(file)
  }
  try {
    const result = await remove(`/api/photos/${photo.id}`)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.ok(db.prepare('SELECT 1 FROM photos WHERE id = ?').get(photo.id))
    assert.ok(owned('photo-unlink-fail.png'))
    assert.ok(fs.existsSync(path.join(uploadDir, 'photo-unlink-fail.png')))
  } finally {
    fs.unlinkSync = realUnlink
  }
})

test('封面文件删除失败返回 500 并保留作品、台账和文件', async () => {
  const work = addWork('cover-unlink-fail.png')
  const realUnlink = fs.unlinkSync
  fs.unlinkSync = (file) => {
    if (path.basename(String(file)) === 'cover-unlink-fail.png') {
      throw Object.assign(new Error('forced unlink failure'), { code: 'EPERM' })
    }
    return realUnlink(file)
  }
  try {
    const result = await remove(`/api/creator/works/${work.id}`)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.ok(db.prepare('SELECT 1 FROM creator_works WHERE id = ?').get(work.id))
    assert.ok(owned('cover-unlink-fail.png'))
    assert.ok(fs.existsSync(path.join(uploadDir, 'cover-unlink-fail.png')))
  } finally {
    fs.unlinkSync = realUnlink
  }
})

test('整个档案文件删除失败返回 207 部分成功，并保留失败文件台账', async () => {
  addPhoto('archive-unlink-fail.png')
  const realUnlink = fs.unlinkSync
  fs.unlinkSync = (file) => {
    if (path.basename(String(file)) === 'archive-unlink-fail.png') {
      throw Object.assign(new Error('forced unlink failure'), { code: 'EPERM' })
    }
    return realUnlink(file)
  }
  try {
    const result = await remove('/api/analysis/archive')
    assert.equal(result.status, 207, JSON.stringify(result.body))
    assert.equal(result.body.success, true)
    assert.ok(result.body.data.files_failed > 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?').get(userId).n, 0)
    assert.ok(fs.existsSync(path.join(uploadDir, 'archive-unlink-fail.png')))
    assert.ok(owned('archive-unlink-fail.png'))
  } finally {
    fs.unlinkSync = realUnlink
  }
})

test('单件业务删除失败返回 500，文件与台账保持不动', async () => {
  const item = addClothing('cloth-db-fail.png')
  db.exec(`CREATE TRIGGER fail_clothing_delete BEFORE DELETE ON clothing_items
           BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END`)
  try {
    const result = await remove(`/api/clothing/${item.id}`)
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.ok(db.prepare('SELECT 1 FROM clothing_items WHERE id = ?').get(item.id))
    assert.ok(owned('cloth-db-fail.png'))
    assert.ok(fs.existsSync(path.join(uploadDir, 'cloth-db-fail.png')))
  } finally {
    db.exec('DROP TRIGGER fail_clothing_delete')
  }
})

for (const [label, add, routeFor] of [
  ['衣物', () => addClothing('cloth-ledger-retry.png'), (row) => `/api/clothing/${row.id}`],
  ['照片', () => addPhoto('photo-ledger-retry.png'), (row) => `/api/photos/${row.id}`],
  ['作品封面', () => addWork('cover-ledger-retry.png'), (row) => `/api/creator/works/${row.id}`],
]) {
  test(`${label}文件已删但台账写入失败后，重试能清掉残留台账`, async () => {
    const row = add()
    const route = routeFor(row)
    const filename = path.basename(row.url)
    const trigger = `fail_ledger_once_${filename.replace(/[^A-Za-z0-9_]/g, '_')}`
    db.exec(`CREATE TRIGGER ${trigger} BEFORE DELETE ON upload_files
             WHEN OLD.filename = '${filename}'
             BEGIN SELECT RAISE(ABORT, 'forced one-time ledger failure'); END`)
    try {
      const failed = await remove(route)
      assert.equal(failed.status, 500, JSON.stringify(failed.body))
      assert.equal(fs.existsSync(path.join(uploadDir, filename)), false)
      assert.ok(owned(filename), '数据库回滚后业务行和台账应恢复')
      const table =
        label === '衣物' ? 'clothing_items' : label === '照片' ? 'photos' : 'creator_works'
      assert.ok(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id))
    } finally {
      db.exec(`DROP TRIGGER ${trigger}`)
    }

    const retried = await remove(route)
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal(owned(filename), undefined, '重试必须删除已恢复业务行对应的残留台账')
  })
}

test('同表另一件衣物仍引用文件时，删除当前衣物不能误删文件', async () => {
  const first = addClothing('same-table-shared.png')
  addClothing('same-table-shared.png')
  const result = await remove(`/api/clothing/${first.id}`)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.ok(fs.existsSync(path.join(uploadDir, 'same-table-shared.png')))
  assert.ok(owned('same-table-shared.png'))
  assert.equal(db.prepare('SELECT 1 FROM clothing_items WHERE id = ?').get(first.id), undefined)
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM clothing_items WHERE filename = 'same-table-shared.png'")
      .get().n,
    1,
  )
})

test('整个档案事务失败返回 500，不进入文件清理', async () => {
  addPhoto('archive-db-fail.png')
  db.prepare('INSERT INTO body_metrics (user_id, height_cm) VALUES (?, 170)').run(userId)
  db.exec(`CREATE TRIGGER fail_archive_delete BEFORE DELETE ON body_metrics
           BEGIN SELECT RAISE(ABORT, 'forced archive failure'); END`)
  try {
    const result = await remove('/api/analysis/archive')
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.ok(fs.existsSync(path.join(uploadDir, 'archive-db-fail.png')))
    assert.ok(owned('archive-db-fail.png'))
    assert.ok(db.prepare('SELECT 1 FROM body_metrics WHERE user_id = ?').get(userId))
  } finally {
    db.exec('DROP TRIGGER fail_archive_delete')
  }
})

test('整个档案台账清理失败返回 207 部分成功，业务已删且台账保留可重试', async () => {
  addPhoto('archive-ledger-fail.png')
  db.exec(`CREATE TRIGGER fail_ledger_delete BEFORE DELETE ON upload_files
           BEGIN SELECT RAISE(ABORT, 'forced ledger failure'); END`)
  try {
    const result = await remove('/api/analysis/archive')
    assert.equal(result.status, 207, JSON.stringify(result.body))
    assert.equal(result.body.success, true)
    assert.ok(result.body.data.files_failed > 0)
    assert.ok(owned('archive-ledger-fail.png'))
    assert.equal(db.prepare('SELECT 1 FROM photos WHERE user_id = ?').get(userId), undefined)
  } finally {
    db.exec('DROP TRIGGER fail_ledger_delete')
  }
})
