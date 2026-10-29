/**
 * /uploads/:filename 访问闸门测试（审计第 3 条）
 *
 * 本轮结论：不加属主硬闸（全仓 grep 现量：本人试穿图 <img>、后台凭证图、creator 广场
 * 跨用户封面都靠浏览器自发请求带不了凭据头，硬闸会当场打挂这三条链），
 * 改为"专用限流 + 全量留痕"，本测试钉的就是这两件事 + 原有路径遍历防护没退化。
 * 活库由 db/init 替身隔离；server 用 PORT=0 起临时端口，测完即关。
 * 运行: node --test test/uploadsAccess.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

// PORT=0 要在 require('../server') 之前设：dotenv 不会覆盖已存在的环境变量
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

const serveName = `test-gate-${Date.now()}.png`
const uploadDir = path.join(__dirname, '..', 'uploads')
let baseUrl = null

test('准备：等待端口就绪并在 uploads/ 放一张临时图', async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
  fs.writeFileSync(path.join(uploadDir, serveName), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})

test('路径遍历照旧 400：编码后的 ../ 在 basename 这一关就被挡', async () => {
  const res = await fetch(`${baseUrl}/uploads/..%2Fdb%2Fstyleai.db`)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.success, false)
  assert.strictEqual(body.error.code, 'BAD_REQUEST')
})

test('不存在的文件名给统一形状 404（并落一条 MISS 留痕日志，见 backend/logs）', async () => {
  const res = await fetch(`${baseUrl}/uploads/deadbee0-0000-4000-8000-000000000000.png`)
  assert.strictEqual(res.status, 404)
  const body = await res.json()
  assert.strictEqual(body.error.code, 'NOT_FOUND')
})

test('存在的文件仍然匿名可读——本轮的属主闸门口径就是"不拦"（跨用户封面/凭证图不能坏）', async () => {
  const res = await fetch(`${baseUrl}/uploads/${serveName}`)
  assert.strictEqual(res.status, 200)
  assert.deepEqual(
    [...new Uint8Array(await res.arrayBuffer())].slice(0, 4),
    [0x89, 0x50, 0x4e, 0x47],
  )
})

test('/uploads 挂上了专用限流：响应带 RateLimit 标准头且额度是 600/15 分钟', async () => {
  const res = await fetch(`${baseUrl}/uploads/${serveName}`)
  // express-rate-limit 在 standardHeaders:true / legacyHeaders:false 下发 RateLimit-*
  const limitHeader = res.headers.get('ratelimit-limit') ?? res.headers.get('ratelimit')
  assert.ok(limitHeader, `应有限流响应头，实际拿到：${JSON.stringify([...res.headers])}`)
  assert.match(String(limitHeader), /(^|[,\s=])600\b/, `额度应为 600，头内容：${limitHeader}`)
})

test('收尾：删临时图、关掉临时端口', async () => {
  fs.unlinkSync(path.join(uploadDir, serveName))
  await new Promise((resolve) => server.close(resolve))
})
