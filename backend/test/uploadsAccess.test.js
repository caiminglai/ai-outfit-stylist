/**
 * /uploads/:filename 访问闸门测试。
 *
 * 公开文件匿名可读；私有文件必须带绑定文件名与过期时间的 HMAC 签名。
 * 上传目录通过 STYLEAI_UPLOAD_DIR 注入系统临时目录，绝不使用 backend/uploads。
 * 活库由 db/init 替身隔离；server 用 PORT=0 起临时端口，测完即关。
 * 运行: node --test test/uploadsAccess.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-upload-access-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_UPLOAD_DIR = uploadDir
process.env.PORT = '0'

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

const app = require('../server')
const server = app.server
assert.ok(server, 'server.js 必须导出 listen 实例（测试据此关端口）')

const publicName = 'public-test-gate.png'
const serveName = `test-gate-${Date.now()}.png`
let baseUrl = null

test.before(async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
  fs.writeFileSync(path.join(uploadDir, publicName), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  fs.writeFileSync(path.join(uploadDir, serveName), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  memDb.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('路径遍历照旧 400：编码后的 ../ 在 basename 这一关就被挡', async () => {
  const res = await fetch(`${baseUrl}/uploads/..%2Fdb%2Fstyleai.db`)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.success, false)
  assert.strictEqual(body.error.code, 'BAD_REQUEST')
})

test('不存在的公开文件名给统一形状 404', async () => {
  const res = await fetch(`${baseUrl}/uploads/public-deadbee0-0000-4000-8000-000000000000.png`)
  assert.strictEqual(res.status, 404)
  const body = await res.json()
  assert.strictEqual(body.error.code, 'NOT_FOUND')
})

test('公开文件从临时上传目录匿名可读', async () => {
  const res = await fetch(`${baseUrl}/uploads/${publicName}`)
  assert.strictEqual(res.status, 200)
  assert.deepEqual(
    [...new Uint8Array(await res.arrayBuffer())].slice(0, 4),
    [0x89, 0x50, 0x4e, 0x47],
  )
})

test('私有文件无签名时一律 401', async () => {
  const res = await fetch(`${baseUrl}/uploads/${serveName}`)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.success, false)
  assert.strictEqual(body.error.code, 'UNAUTHORIZED')
})

test('/uploads 挂上了专用限流：响应带 RateLimit 标准头且额度是 600/15 分钟', async () => {
  const res = await fetch(`${baseUrl}/uploads/${publicName}`)
  const limitHeader = res.headers.get('ratelimit-limit') ?? res.headers.get('ratelimit')
  assert.ok(limitHeader, `应有限流响应头，实际拿到：${JSON.stringify([...res.headers])}`)
  assert.match(String(limitHeader), /(^|[,\s=])600\b/, `额度应为 600，头内容：${limitHeader}`)
})
