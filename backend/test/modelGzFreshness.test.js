/**
 * /models 预压缩下发口径测试：真实 HTTP + 内存库。
 * 源文件与 .gz 夹具只放系统临时目录，不写仓库 models/。
 * 运行: npm test
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const Database = require('better-sqlite3')

const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-model-gz-'))
process.env.STYLEAI_MODEL_DIR = modelsDir
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
assert.ok(server, 'server.js 必须导出 listen 实例')
let closed = false
const closeServer = async () => {
  if (!closed && server.listening) await new Promise((resolve) => server.close(resolve))
  closed = true
}
test.after(async () => {
  await closeServer()
  memDb.close()
  fs.rmSync(modelsDir, { recursive: true, force: true })
})

const stem = 'probe-gz'
const srcFile = path.join(modelsDir, `${stem}.bin`)
const gzFile = `${srcFile}.gz`
let baseUrl = null
const statMs = (p) => fs.statSync(p).mtimeMs

test('准备：端口就绪 + 在临时模型根造源文件与较新的 .gz', async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  fs.writeFileSync(srcFile, Buffer.from('plain-source-bytes'))
  fs.writeFileSync(gzFile, zlib.gzipSync(Buffer.from('plain-source-bytes')))
  const past = new Date(Date.now() - 3600 * 1000)
  fs.utimesSync(srcFile, past, past)
})

test('.gz 不比源文件旧 ⇒ 下发 gzip，Last-Modified 按源文件、带 Vary 与 CORS', async () => {
  const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('content-encoding'), 'gzip')
  assert.match(String(res.headers.get('vary')), /Accept-Encoding/i)
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*')
  assert.strictEqual(res.headers.get('last-modified'), new Date(statMs(srcFile)).toUTCString())
  assert.match(String(res.headers.get('cache-control')), /max-age=604800/)
  assert.strictEqual(
    Buffer.from(new Uint8Array(await res.arrayBuffer())).toString('latin1'),
    'plain-source-bytes',
  )
})

test('源文件比 .gz 新 ⇒ 不下发旧压缩件，回落到源文件', async () => {
  const future = new Date(Date.now() + 3600 * 1000)
  fs.utimesSync(srcFile, future, future)
  const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  assert.strictEqual(res.status, 200)
  assert.notStrictEqual(res.headers.get('content-encoding'), 'gzip')
  assert.strictEqual(
    Buffer.from(new Uint8Array(await res.arrayBuffer())).toString('latin1'),
    'plain-source-bytes',
  )
})

test('不带 Accept-Encoding: gzip ⇒ 走源文件', async () => {
  const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
    headers: { 'Accept-Encoding': 'identity' },
  })
  assert.strictEqual(res.status, 200)
  assert.notStrictEqual(res.headers.get('content-encoding'), 'gzip')
})

test('/api/models/file/* 同口径：.gz 新 ⇒ gzip；.gz 旧 ⇒ 源文件；只有 .gz ⇒ 照旧 gzip', async () => {
  const apiPath = `${baseUrl}/api/models/file/${stem}.bin`
  const enc = (res) => res.headers.get('content-encoding')
  const past = new Date(Date.now() - 3600 * 1000)
  fs.utimesSync(srcFile, past, past)
  const freshRes = await fetch(apiPath, { headers: { 'Accept-Encoding': 'gzip' } })
  assert.strictEqual(freshRes.status, 200)
  assert.strictEqual(enc(freshRes), 'gzip')
  assert.strictEqual(
    Buffer.from(new Uint8Array(await freshRes.arrayBuffer())).toString('latin1'),
    'plain-source-bytes',
  )

  const future = new Date(Date.now() + 3600 * 1000)
  fs.utimesSync(srcFile, future, future)
  const staleRes = await fetch(apiPath, { headers: { 'Accept-Encoding': 'gzip' } })
  assert.strictEqual(staleRes.status, 200)
  assert.notStrictEqual(enc(staleRes), 'gzip')
  assert.strictEqual(
    Buffer.from(new Uint8Array(await staleRes.arrayBuffer())).toString('latin1'),
    'plain-source-bytes',
  )

  const held = `${srcFile}.held`
  fs.renameSync(srcFile, held)
  try {
    const onlyGz = await fetch(apiPath, { headers: { 'Accept-Encoding': 'gzip' } })
    assert.strictEqual(onlyGz.status, 200)
    assert.strictEqual(enc(onlyGz), 'gzip')
  } finally {
    fs.renameSync(held, srcFile)
  }
})

test('收尾：探针文件删除，关端口', async () => {
  fs.rmSync(gzFile, { force: true })
  fs.rmSync(srcFile, { force: true })
  assert.strictEqual(fs.existsSync(srcFile), false)
  assert.strictEqual(fs.existsSync(gzFile), false)
  await closeServer()
})
