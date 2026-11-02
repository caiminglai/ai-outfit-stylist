/**
 * 上传闸门测试（middleware/upload.js 的 fileFilter + limits）
 *
 * 钉三件事：
 *   1) 白名单外的扩展名 multer 就不收（不进内存、不落盘），且拒绝时带 uploadRejected 标记，
 *      好让 server.js 把"仅支持 jpg, jpeg, png, webp"这句原话带到生产环境；
 *   2) fileFilter 只拦扩展名，深校验（magic bytes、扩展名与内容是否一致）仍在 validateImage，
 *      所以"名字对、内容不是图"这条路必须还能被第二道闸拒掉——两道闸不能被合并掉一道；
 *   3) limits 里钉死的文件数/部件数/字段数是实数，不是 multer 默认的无上限。
 *
 * 活库由 db/init 替身隔离；server 用 PORT=0 起临时端口，测完即关（与 uploadsAccess.test.js 同法）。
 * 走的是 /api/tryon/direct：它是上传类路由里唯一一个没挂在 loginRequired 后面的
 * （server.js:326，对照 331/333/336/339/340 那几条要登录或有支付验签），
 * 所以这里不用先造登录态就能验到闸门本身。
 * 运行: node --test test/uploadGuards.test.js
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

const { fileFilter, UPLOAD_LIMITS, ALLOWED_EXTENSIONS } = require('../middleware/upload')
const app = require('../server')
const server = app.server
assert.ok(server, 'server.js 必须导出 listen 实例（测试据此关端口）')

let baseUrl = null

/** 直接喂 fileFilter 一个假 file，看它 cb 的第一参是错还是 null */
function filter(name) {
  return new Promise((resolve) => {
    fileFilter({}, { originalname: name, mimetype: 'application/octet-stream' }, (err, ok) =>
      resolve({ err, ok }),
    )
  })
}

/** 手工拼一份 multipart/form-data；只用来构造"该被拒"的请求体 */
function multipart(boundary, parts) {
  const chunks = []
  for (const p of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
          `Content-Type: ${p.type}\r\n\r\n`,
      ),
    )
    chunks.push(Buffer.from(p.content, 'utf8'))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

async function postTryon(parts) {
  const boundary = '----uploadGuards' + Date.now() + Math.random().toString(36).slice(2)
  const res = await fetch(`${baseUrl}/api/tryon/direct`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: multipart(boundary, parts),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('准备：等待端口就绪', async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
  assert.ok(baseUrl)
})

test('白名单里的四种扩展名逐个放行（大小写混写也放行）', async () => {
  for (const n of ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'A.JPG', 'b.PNG']) {
    const { err, ok } = await filter(n)
    assert.strictEqual(err, null, `${n} 不该被拒`)
    assert.strictEqual(ok, true, `${n} 该被放行`)
  }
})

test('白名单外一律不收，且带的标记让全局错误处理能把原话说给生产环境', async () => {
  for (const n of ['a.gif', 'a.txt', 'a.exe', 'a.svg', 'a.html', 'no-ext', 'a.zip']) {
    const { err, ok } = await filter(n)
    assert.ok(err, `${n} 应被拒`)
    assert.notStrictEqual(ok, true, `${n} 不该被放行`)
    assert.strictEqual(err.uploadRejected, true, `${n} 缺 uploadRejected 标记`)
    assert.strictEqual(err.status, 400)
    // 这句话是给用户照着改的，必须把白名单列全
    for (const ext of ALLOWED_EXTENSIONS) {
      assert.ok(err.message.includes(ext), `拒绝话里少了 ${ext}：${err.message}`)
    }
  }
})

test('limits 钉死了文件数/部件数/字段数，不是 multer 的无上限默认', () => {
  assert.strictEqual(UPLOAD_LIMITS.fileSize, 10 * 1024 * 1024)
  assert.strictEqual(UPLOAD_LIMITS.files, 2)
  assert.strictEqual(UPLOAD_LIMITS.parts, 6)
  assert.strictEqual(UPLOAD_LIMITS.fields, 8)
})

test('真发一张 .txt：400 + BAD_REQUEST + 白名单那句原话（闸门在 multer 就拦下）', async () => {
  const r = await postTryon([
    { name: 'person_image', filename: 'note.txt', type: 'text/plain', content: 'hello' },
    { name: 'garment_image', filename: 'shirt.txt', type: 'text/plain', content: 'hello' },
  ])
  assert.strictEqual(r.status, 400)
  assert.strictEqual(r.body.success, false)
  assert.strictEqual(r.body.error.code, 'BAD_REQUEST')
  assert.match(r.body.error.message, /仅支持/)
})

test('名字对、内容不是图：仍被 validateImage 这道深闸拒（两道闸没被合并）', async () => {
  const r = await postTryon([
    { name: 'person_image', filename: 'p.png', type: 'image/png', content: '假的 png' },
    { name: 'garment_image', filename: 'g.png', type: 'image/png', content: '假的 png' },
  ])
  assert.strictEqual(r.status, 400)
  assert.match(r.body.error.message, /人物照片/)
  assert.match(r.body.error.message, /不是合法的图片格式/)
})

test('收尾：关掉临时端口', async () => {
  await new Promise((resolve) => server.close(resolve))
})
