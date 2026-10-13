/**
 * /models 预压缩下发口径测试（审计第 7 条）
 *
 * 原来这条分支只看"有没有 .gz"就下发，且把 Cache-Control 写成 7 天，
 * 却按 .gz 自己的 mtime 出校验值 ⇒ 源文件（纹理/模型）改过、预压缩没重跑时，
 * 浏览器抱着旧字节整整一周，页面上没有任何入口能让它重新拉。
 * 本轮口径：.gz 比源文件旧就不下发（回落 express.static 走源文件），
 * 且 Last-Modified 一律按源文件给。活库由 db/init 替身隔离；PORT=0 起临时端口。
 * 运行: node --test test/modelGzFreshness.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const Database = require('better-sqlite3')

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

const modelsDir = path.join(__dirname, '..', '..', 'models')
// 名字不能以下划线开头：shouldSkipDir 把所有 `_`/`.` 开头的段当隔离区拦掉（那是对的），
// 探针文件必须以普通名字进来、普通名字离开
const stem = `probe-gz-${Date.now()}`
const srcFile = path.join(modelsDir, `${stem}.bin`)
const gzFile = `${srcFile}.gz`
let baseUrl = null

function statMs(p) {
  return fs.statSync(p).mtimeMs
}

// 环境闸门：部署容器里 /models 是只读 bind mount（compose 的 `:ro`），CI 那侧也可能没这棵树。
// 本文件要在 models/ 里造一对探针文件，写不进去就是"环境不给写"而不是代码坏了 ⇒ 真试写一次，
// 失败则整组 skip 并把 err.code 写进原因（收尾那条不 skip：端口开了就得关）。
let canWrite = true
let skipWhy = ''
try {
  const probe = path.join(modelsDir, `probe-writable-${Date.now()}`)
  fs.writeFileSync(probe, 'x')
  fs.unlinkSync(probe)
} catch (err) {
  canWrite = false
  skipWhy = `${err.code || err.message}（models=${modelsDir}）`
}
const OPT = canWrite ? {} : { skip: `models/ 写不进去：${skipWhy}` }

test('准备：端口就绪 + 在 models/ 造一对源文件与 .gz（.gz 比源文件新）', OPT, async () => {
  if (!fs.existsSync(modelsDir)) throw new Error(`models/ 不在盘上：${modelsDir}，本测试无法自证`)
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  fs.writeFileSync(srcFile, Buffer.from('plain-source-bytes'))
  fs.writeFileSync(gzFile, zlib.gzipSync(Buffer.from('plain-source-bytes')))
  // 源文件 mtime 往前挪 1 小时 ⇒ .gz 是"新的"，应当被下发
  const past = new Date(Date.now() - 3600 * 1000)
  fs.utimesSync(srcFile, past, past)
})

test('.gz 不比源文件旧 ⇒ 下发 gzip，且 Last-Modified 按源文件、带 Vary 与 CORS', OPT, async () => {
  const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('content-encoding'), 'gzip')
  // 同一 URL 现在按编码给两种字节，CDN 不分 Vary 就会把 gzip 喂给不支持的客户端
  assert.match(String(res.headers.get('vary')), /Accept-Encoding/i)
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*')
  assert.strictEqual(
    res.headers.get('last-modified'),
    new Date(statMs(srcFile)).toUTCString(),
    '校验值必须代表源文件，不能是 .gz 自己的时间',
  )
  assert.match(String(res.headers.get('cache-control')), /max-age=604800/)
  const body = new Uint8Array(await res.arrayBuffer())
  assert.strictEqual(Buffer.from(body).toString('latin1'), 'plain-source-bytes')
})

test(
  '源文件比 .gz 新 ⇒ 不下发旧压缩件，回落到源文件（预压缩没重跑时不能让用户拿旧字节）',
  OPT,
  async () => {
    const future = new Date(Date.now() + 3600 * 1000)
    fs.utimesSync(srcFile, future, future)
    const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    assert.strictEqual(res.status, 200)
    assert.notStrictEqual(res.headers.get('content-encoding'), 'gzip', '旧 .gz 不许下发')
    const body = new Uint8Array(await res.arrayBuffer())
    assert.strictEqual(Buffer.from(body).toString('latin1'), 'plain-source-bytes')
  },
)

test('不带 Accept-Encoding: gzip ⇒ 走源文件，不受本轮改动影响', OPT, async () => {
  const res = await fetch(`${baseUrl}/models/${stem}.bin`, {
    headers: { 'Accept-Encoding': 'identity' },
  })
  assert.strictEqual(res.status, 200)
  assert.notStrictEqual(res.headers.get('content-encoding'), 'gzip')
})

test(
  '/api/models/file/* 同口径：.gz 新 ⇒ 下发 gzip；.gz 旧 ⇒ 回落源文件；只有 .gz ⇒ 照旧下发',
  OPT,
  async () => {
    const apiPath = (q) => `${baseUrl}/api/models/file/${q}`
    const enc = (res) => res.headers.get('content-encoding')

    // ① .gz 不比源文件旧 ⇒ 压缩件照发（闸门不能把正路堵死）
    const past = new Date(Date.now() - 3600 * 1000)
    fs.utimesSync(srcFile, past, past)
    const freshRes = await fetch(apiPath(`${stem}.bin`), { headers: { 'Accept-Encoding': 'gzip' } })
    assert.strictEqual(freshRes.status, 200)
    assert.strictEqual(enc(freshRes), 'gzip', '.gz 是新的就该走压缩')
    assert.strictEqual(
      Buffer.from(new Uint8Array(await freshRes.arrayBuffer())).toString('latin1'),
      'plain-source-bytes',
    )

    // ② 源文件比 .gz 新 ⇒ 旧压缩件不下发（展厅走的就是这一条路由，原来它只看有没有 .gz）
    const future = new Date(Date.now() + 3600 * 1000)
    fs.utimesSync(srcFile, future, future)
    const staleRes = await fetch(apiPath(`${stem}.bin`), { headers: { 'Accept-Encoding': 'gzip' } })
    assert.strictEqual(staleRes.status, 200)
    assert.notStrictEqual(enc(staleRes), 'gzip', '旧 .gz 不许下发')
    assert.strictEqual(
      Buffer.from(new Uint8Array(await staleRes.arrayBuffer())).toString('latin1'),
      'plain-source-bytes',
    )

    // ③ 盘上只有 .gz、没有源文件可比对（线上确有这种只压了一份的纹理）⇒ 照发，别把它判成 404
    const held = `${srcFile}.held`
    fs.renameSync(srcFile, held)
    try {
      const onlyGz = await fetch(apiPath(`${stem}.bin`), { headers: { 'Accept-Encoding': 'gzip' } })
      assert.strictEqual(onlyGz.status, 200, '只有 .gz 时不能 404')
      assert.strictEqual(enc(onlyGz), 'gzip')
    } finally {
      fs.renameSync(held, srcFile)
    }
  },
)
test('收尾：删掉探针文件（源与 .gz 各一，不留残留）', () => {
  fs.rmSync(gzFile, { force: true })
  fs.rmSync(srcFile, { force: true })
  assert.strictEqual(fs.existsSync(srcFile), false)
  assert.strictEqual(fs.existsSync(gzFile), false)
  return new Promise((resolve) => server.close(resolve))
})
