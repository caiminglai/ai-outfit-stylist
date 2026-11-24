/**
 * 上传签名 URL、公开判定与请求/响应清洗回归。
 *
 * 使用系统临时上传目录、临时 SQLite 文件和真实 Express HTTP 路由。
 * 不读取 backend/uploads、运行数据库或 .env。
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-upload-signing-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_UPLOAD_DIR = uploadDir
process.env.SECRET_KEY = 'upload-access-test-secret'

const db = new Database(path.join(tempDir, 'uploads.db'))
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
db.exec('CREATE TABLE request_body_fixture (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')

const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: db,
  paths: [],
}

const {
  signUploadUrl,
  verifyUploadToken,
  isPublicUpload,
  registerUpload,
  PUBLIC_UPLOAD_QUERIES,
} = require('../utils/uploads')
const {
  uploadAccess,
  stripUploadUrlQueries,
  signUploadJsonResponses,
} = require('../middleware/uploadAccess')
const express = require('express')
const { generateAdminToken } = require('../middleware/auth')
const inventoryRoutes = require('../routes/inventory')
const wardrobeRoutes = require('../routes/wardrobe')
const creatorRoutes = require('../routes/creator')
const paymentRoutes = require('../routes/payment')

const PRIVATE = 'private.png'
const OTHER_PRIVATE = 'other-private.png'
const PUBLIC = 'public-banner.png'
const APPROVED = 'approved-cover.png'
const APPROVED_QUERY = 'approved-query-cover.png'
const PENDING = 'pending-cover.png'
const REJECTED = 'rejected-cover.png'
const PRODUCT = 'product-image.png'
const PRODUCT_QUERY = 'product-query-image.png'
const PRODUCT_WRITE = 'product-write.png'
const FILE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SESSION = 'acct_22222222-2222-4222-8222-222222222222'
const ATTACKER_SESSION = 'acct_33333333-3333-4333-8333-333333333333'

const app = express()
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if (req.originalUrl.startsWith('/api/payment/notify')) req.rawBody = buf.toString('utf8')
    },
  }),
)
app.use(express.urlencoded({ extended: true }))
app.use(stripUploadUrlQueries)
app.use(signUploadJsonResponses)

let nowSeconds = Math.floor(Date.now() / 1000)
app.get('/uploads/:filename', uploadAccess({ uploadDir, database: db, now: () => nowSeconds }))

const responseFixture = {
  success: true,
  data: {
    private_url: `/uploads/${PRIVATE}`,
    private_signed_url: `/uploads/${PRIVATE}?expires=1&signature=old`,
    public_url: `/uploads/${PUBLIC}`,
    approved_url: `/uploads/${APPROVED}`,
    product_url: `/uploads/${PRODUCT}`,
    pending_url: `/uploads/${PENDING}`,
    list: [`/uploads/${OTHER_PRIVATE}`],
    prose: `说明文字 /uploads/${PRIVATE} 不是独立 URL 字段`,
    created_at: new Date('2026-01-02T03:04:05.000Z'),
    bytes: Buffer.from([1, 2, 3]),
    invalid_url: `/uploads/${'a'.repeat(256)}`,
  },
}
app.get('/api/upload-response-fixture', (_req, res) => res.json(responseFixture))
app.post('/api/request-body-fixture', (req, res) => {
  db.prepare('INSERT INTO request_body_fixture (body) VALUES (?)').run(JSON.stringify(req.body))
  res.json({ success: true, data: null })
})
app.post('/api/payment/notify', (req, res) => {
  db.prepare('INSERT INTO request_body_fixture (body) VALUES (?)').run(
    JSON.stringify({ raw: req.rawBody, body: req.body }),
  )
  res.json({ success: true, data: null })
})
app.use('/api/inventory', inventoryRoutes)
app.use('/api/wardrobe', wardrobeRoutes)
app.use('/api/creator', creatorRoutes)
app.use('/api/payment', paymentRoutes)
app.use((_err, _req, res, _next) => {
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } })
})

let server
let base
let adminToken

before(async () => {
  for (const name of [
    PRIVATE,
    OTHER_PRIVATE,
    PUBLIC,
    APPROVED,
    APPROVED_QUERY,
    PENDING,
    REJECTED,
    PRODUCT,
    PRODUCT_QUERY,
    PRODUCT_WRITE,
  ]) {
    fs.writeFileSync(path.join(uploadDir, name), FILE_BYTES)
  }

  db.prepare(
    `INSERT INTO users (session_id, nickname, session_expires_at)
     VALUES (?, '上传测试会员', datetime('now', '+30 days'))`,
  ).run(SESSION)
  db.prepare(
    `INSERT INTO users (session_id, nickname, session_expires_at)
     VALUES (?, '越权测试会员', datetime('now', '+30 days'))`,
  ).run(ATTACKER_SESSION)
  db.prepare(
    `INSERT INTO clothing_items (session_id, filename, image_url)
     VALUES (?, ?, ?)`,
  ).run(SESSION, PRIVATE, `/uploads/${PRIVATE}`)
  db.prepare(
    `INSERT INTO clothing_items (session_id, filename, image_url)
     VALUES (?, ?, ?)`,
  ).run(SESSION, OTHER_PRIVATE, `/uploads/${OTHER_PRIVATE}`)
  registerUpload(PRIVATE, 1)
  registerUpload(OTHER_PRIVATE, 1)
  registerUpload(PENDING, 1)
  const work = db.prepare(
    `INSERT INTO creator_works (user_id, share_code, type, title, cover_url, status)
     VALUES (1, ?, 'outfit', '封面测试', ?, ?)`,
  )
  work.run('approved-code', `/uploads/${APPROVED}`, 'approved')
  work.run(
    'approved-query-code',
    `/uploads/${APPROVED_QUERY}?expires=old&signature=old#fragment`,
    'approved',
  )
  work.run('pending-code', `/uploads/${PENDING}`, 'pending')
  work.run('rejected-code', `/uploads/${REJECTED}`, 'rejected')
  db.prepare(
    "INSERT INTO inventory_categories (name, code) VALUES ('测试分类', 'upload-test')",
  ).run()
  db.prepare(
    `INSERT INTO inventory_products (category_id, name, image_url)
     VALUES (1, '公开商品图', ?)`,
  ).run(`/uploads/${PRODUCT}`)
  db.prepare(
    `INSERT INTO inventory_products (category_id, name, image_url)
     VALUES (1, '历史签名商品图', ?)`,
  ).run(`/uploads/${PRODUCT_QUERY}?expires=old#fragment`)
  db.prepare(
    `INSERT INTO inventory_products (category_id, name, image_url)
     VALUES (1, '外链不应放行本站文件', ?)`,
  ).run(`https://evil.example/uploads/${PRIVATE}`)

  db.prepare('INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, 1)').run(
    'admin',
    bcrypt.hashSync('upload-test-admin-password', 10),
  )
  adminToken = generateAdminToken('admin')

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
  nowSeconds = Math.floor(Date.now() / 1000)
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function tokenParts(filename, expiresInSeconds = 3600) {
  const url = new URL(signUploadUrl(filename, expiresInSeconds), 'http://uploads.test')
  return {
    expires: url.searchParams.get('expires'),
    signature: url.searchParams.get('signature'),
  }
}

async function getUpload(filename, query = '') {
  const res = await fetch(`${base}/uploads/${filename}${query}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : null
  return { res, bytes, body }
}

async function postJson(route, body, headers = {}) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { res, body: await res.json() }
}

test('HMAC 令牌绑定文件名和过期时间，过期边界拒绝', () => {
  const signed = signUploadUrl(PRIVATE)
  const { expires, signature } = tokenParts(PRIVATE)
  const token = `${expires}.${signature}`
  const expiry = Number(expires)

  assert.match(signed, /^\/uploads\/private\.png\?expires=\d+&signature=[a-f0-9]{64}$/)
  assert.strictEqual(verifyUploadToken(PRIVATE, token, expiry - 1), true)
  assert.strictEqual(verifyUploadToken(PRIVATE, token, expiry), false)
  assert.strictEqual(verifyUploadToken(PRIVATE, token, expiry + 1), false)
  assert.strictEqual(verifyUploadToken(OTHER_PRIVATE, token, expiry - 1), false)

  const tampered = `${expires}.${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`
  assert.strictEqual(verifyUploadToken(PRIVATE, tampered, expiry - 1), false)
  assert.strictEqual(verifyUploadToken(PRIVATE, '', expiry - 1), false)
  assert.strictEqual(verifyUploadToken(PRIVATE, `${expires}.`, expiry - 1), false)
  assert.strictEqual(verifyUploadToken(PRIVATE, `.${signature}`, expiry - 1), false)
})

test('签名密钥缺失或变化时不能签发/验证令牌', () => {
  const original = process.env.SECRET_KEY
  const { expires, signature } = tokenParts(PRIVATE)
  try {
    process.env.SECRET_KEY = 'a-different-upload-secret'
    assert.strictEqual(verifyUploadToken(PRIVATE, `${expires}.${signature}`, nowSeconds), false)
    delete process.env.SECRET_KEY
    assert.throws(() => signUploadUrl(PRIVATE), /SECRET_KEY/)
    assert.strictEqual(verifyUploadToken(PRIVATE, `${expires}.${signature}`, nowSeconds), false)
  } finally {
    process.env.SECRET_KEY = original
  }
})

test('公开判定覆盖 public- 前缀、已审核封面和后台商品图，其余私有', () => {
  assert.strictEqual(isPublicUpload(PUBLIC, db), true)
  assert.strictEqual(isPublicUpload(APPROVED, db), true)
  assert.strictEqual(isPublicUpload(PRODUCT, db), true)
  assert.strictEqual(isPublicUpload(PENDING, db), false)
  assert.strictEqual(isPublicUpload(REJECTED, db), false)
  assert.strictEqual(isPublicUpload(PRIVATE, db), false)
  assert.strictEqual(isPublicUpload('../private.png', db), false)
})

test('公开引用识别历史查询串，数据库查询失败时按私有处理', () => {
  assert.strictEqual(isPublicUpload(APPROVED_QUERY, db), true)
  assert.strictEqual(isPublicUpload(PRODUCT_QUERY, db), true)
  const unavailableDb = {
    prepare() {
      throw new Error('database unavailable')
    },
  }
  assert.strictEqual(isPublicUpload(APPROVED, unavailableDb), false)
  assert.strictEqual(isPublicUpload(PUBLIC, unavailableDb), true)
})

test('公开引用查询走文件名索引，不退回全表扫描', () => {
  const creatorPlan = db
    .prepare(`EXPLAIN QUERY PLAN ${PUBLIC_UPLOAD_QUERIES.creator}`)
    .all(`/uploads/${APPROVED}`, `/uploads/${APPROVED}[?#]*`)
    .map((row) => row.detail)
    .join('\n')
  assert.match(creatorPlan, /ix_creator_works_status_cover_url/)
  assert.match(creatorPlan, /status=\? AND cover_url=\?/)
  assert.match(creatorPlan, /status=\? AND cover_url>\? AND cover_url<\?/)

  const productPlan = db
    .prepare(`EXPLAIN QUERY PLAN ${PUBLIC_UPLOAD_QUERIES.product}`)
    .all(`/uploads/${PRODUCT}`, `/uploads/${PRODUCT}[?#]*`)
    .map((row) => row.detail)
    .join('\n')
  assert.match(productPlan, /ix_inventory_products_image_url/)
  assert.doesNotMatch(productPlan, /SCAN inventory_products/)
})

test('私有直链、缺签名、缺过期时间与过期签名一律 401', async () => {
  const { expires, signature } = tokenParts(PRIVATE)
  const expired = tokenParts(PRIVATE, 0)
  const queries = [
    '',
    `?expires=${expires}`,
    `?signature=${signature}`,
    `?expires=${expired.expires}&signature=${expired.signature}`,
  ]
  for (const query of queries) {
    const { res, body } = await getUpload(PRIVATE, query)
    assert.strictEqual(res.status, 401, `query=${query}`)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error.code, 'UNAUTHORIZED')
  }
})

test('不存在的私有文件在验签前统一 401，不泄露存在性', async () => {
  const { res } = await getUpload('missing-private.png')
  assert.strictEqual(res.status, 401)
})

test('合法签名在过期前 200，文件名或签名篡改 401', async () => {
  const originalNow = nowSeconds
  try {
    const { expires, signature } = tokenParts(PRIVATE, 60)
    nowSeconds = Number(expires) - 1
    const valid = await getUpload(PRIVATE, `?expires=${expires}&signature=${signature}`)
    assert.strictEqual(valid.res.status, 200)
    assert.deepEqual(valid.bytes, FILE_BYTES)
    assert.strictEqual(valid.res.headers.get('cache-control'), 'private, no-store')

    const wrongFile = await getUpload(OTHER_PRIVATE, `?expires=${expires}&signature=${signature}`)
    assert.strictEqual(wrongFile.res.status, 401)

    const tampered = `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`
    const wrongSignature = await getUpload(PRIVATE, `?expires=${expires}&signature=${tampered}`)
    assert.strictEqual(wrongSignature.res.status, 401)

    nowSeconds = Number(expires)
    const expired = await getUpload(PRIVATE, `?expires=${expires}&signature=${signature}`)
    assert.strictEqual(expired.res.status, 401)
  } finally {
    nowSeconds = originalNow
  }
})

test('公开前缀、已审核封面和商品图均可匿名读取', async () => {
  for (const name of [PUBLIC, APPROVED, PRODUCT]) {
    const { res, bytes } = await getUpload(name)
    assert.strictEqual(res.status, 200, name)
    assert.deepEqual(bytes, FILE_BYTES)
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=300', name)
  }
  for (const name of [APPROVED_QUERY, PRODUCT_QUERY]) {
    const { res } = await getUpload(name)
    assert.strictEqual(res.status, 200, name)
  }
})

test('JSON 响应递归签名本人私有 URL，公开 URL 与普通文本保持原样', async () => {
  const res = await fetch(`${base}/api/upload-response-fixture`, {
    headers: { 'x-session-id': SESSION },
  })
  const body = await res.json()
  assert.strictEqual(res.status, 200)
  assert.strictEqual(body.success, true)

  for (const value of [
    body.data.private_url,
    body.data.private_signed_url,
    body.data.pending_url,
    body.data.list[0],
  ]) {
    const url = new URL(value, 'http://uploads.test')
    assert.strictEqual(url.pathname.startsWith('/uploads/'), true)
    assert.strictEqual(
      verifyUploadToken(
        url.pathname.slice('/uploads/'.length),
        `${url.searchParams.get('expires')}.${url.searchParams.get('signature')}`,
        nowSeconds,
      ),
      true,
      value,
    )
  }
  assert.strictEqual(body.data.public_url, `/uploads/${PUBLIC}`)
  assert.strictEqual(body.data.approved_url, `/uploads/${APPROVED}`)
  assert.strictEqual(body.data.product_url, `/uploads/${PRODUCT}`)
  assert.strictEqual(body.data.prose, `说明文字 /uploads/${PRIVATE} 不是独立 URL 字段`)
  assert.strictEqual(body.data.invalid_url, `/uploads/${'a'.repeat(256)}`)
  assert.strictEqual(body.data.created_at, '2026-01-02T03:04:05.000Z')
  assert.deepEqual(body.data.bytes, { type: 'Buffer', data: [1, 2, 3] })
  assert.ok(responseFixture.data.created_at instanceof Date)
  assert.ok(Buffer.isBuffer(responseFixture.data.bytes))
  assert.strictEqual(
    responseFixture.data.private_url,
    `/uploads/${PRIVATE}`,
    '不得原地改写响应对象',
  )
})

test('密钥缺失时响应签发失败关闭，不返回任何上传 URL', async () => {
  const original = process.env.SECRET_KEY
  try {
    delete process.env.SECRET_KEY
    const res = await fetch(`${base}/api/upload-response-fixture`, {
      headers: { 'x-session-id': SESSION },
    })
    const text = await res.text()
    assert.strictEqual(res.status, 500)
    assert.ok(!text.includes(PRIVATE))
    assert.ok(!text.includes('signature='))
  } finally {
    process.env.SECRET_KEY = original
  }
})

test('有效后台 Bearer 可读取任意私有文件，无效 Bearer 不能借后台响应签名', async () => {
  const invalid = await fetch(`${base}/api/upload-response-fixture`, {
    headers: { authorization: 'Bearer invalid-admin-token' },
  })
  const invalidBody = await invalid.json()
  assert.strictEqual(invalidBody.data.private_url, `/uploads/${PRIVATE}`)

  const admin = await fetch(`${base}/api/upload-response-fixture`, {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  const adminBody = await admin.json()
  const url = new URL(adminBody.data.private_url, 'http://uploads.test')
  assert.strictEqual(
    verifyUploadToken(
      url.pathname.slice('/uploads/'.length),
      `${url.searchParams.get('expires')}.${url.searchParams.get('signature')}`,
      nowSeconds,
    ),
    true,
  )
  const download = await getUpload(PRIVATE, url.search)
  assert.strictEqual(download.res.status, 200)
  assert.deepEqual(download.bytes, FILE_BYTES)
})

test('跨会话引用他人文件不会获得签名，原私有直链仍为 401', async () => {
  const { res, body } = await postJson(
    '/api/wardrobe/items',
    { name: '引用他人图片', category: '上装', image_url: `/uploads/${PRIVATE}` },
    { 'x-session-id': ATTACKER_SESSION },
  )
  assert.strictEqual(res.status, 201)
  assert.strictEqual(body.data.image_url, `/uploads/${PRIVATE}`)
  const download = await getUpload(PRIVATE)
  assert.strictEqual(download.res.status, 401)

  const fixture = await fetch(`${base}/api/upload-response-fixture`, {
    headers: { 'x-session-id': ATTACKER_SESSION },
  })
  const fixtureBody = await fixture.json()
  assert.strictEqual(fixtureBody.data.private_url, `/uploads/${PRIVATE}`)
  assert.strictEqual(fixtureBody.data.list[0], `/uploads/${OTHER_PRIVATE}`)
})

test('超长上传文件名在写入前返回 400，不污染数据库', async () => {
  const invalid = `/uploads/${'a'.repeat(256)}`
  const { res } = await postJson(
    '/api/wardrobe/items',
    { name: '超长文件名', category: '上装', image_url: invalid },
    { 'x-session-id': SESSION },
  )
  assert.strictEqual(res.status, 400)
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM user_wardrobe WHERE name = '超长文件名'").get().count,
    0,
  )
})

test('创作者封面只接受本人上传文件，拒绝把他人私有图提交审核', async () => {
  const foreign = await postJson(
    '/api/creator/works',
    {
      type: 'outfit',
      title: '越权封面',
      cover_url: `/uploads/${PRIVATE}`,
      payload: { items: [] },
    },
    { 'x-session-id': ATTACKER_SESSION },
  )
  assert.strictEqual(foreign.res.status, 400)
  assert.strictEqual(foreign.body.success, false)
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM creator_works WHERE title = '越权封面'").get().count,
    0,
    '他人私有文件不能进入待审核作品，否则审核通过后会变成公开封面',
  )

  const own = await postJson(
    '/api/creator/works',
    {
      type: 'outfit',
      title: '本人封面',
      cover_url: `/uploads/${PENDING}`,
      payload: { items: [] },
    },
    { 'x-session-id': SESSION },
  )
  assert.strictEqual(own.res.status, 201)
  const row = db.prepare("SELECT cover_url FROM creator_works WHERE title = '本人封面'").get()
  assert.strictEqual(row.cover_url, `/uploads/${PENDING}`)
})

test('创作者真实上传封面可立即取得本人签名并读取', async () => {
  const form = new FormData()
  form.append('file', new Blob([FILE_BYTES], { type: 'image/png' }), 'cover.png')
  const res = await fetch(`${base}/api/creator/cover`, {
    method: 'POST',
    headers: { 'x-session-id': SESSION },
    body: form,
  })
  const body = await res.json()
  assert.strictEqual(res.status, 200)
  const url = new URL(body.data.url, 'http://uploads.test')
  const filename = url.pathname.slice('/uploads/'.length)
  assert.strictEqual(
    verifyUploadToken(
      filename,
      `${url.searchParams.get('expires')}.${url.searchParams.get('signature')}`,
      nowSeconds,
    ),
    true,
  )
  const download = await getUpload(filename, url.search)
  assert.strictEqual(download.res.status, 200)
})

test('真实库存写入口剥离签名查询串，签名 URL 不回存数据库', async () => {
  const signed = signUploadUrl(PRODUCT_WRITE)
  const { res } = await postJson(
    '/api/inventory/products',
    { category_id: 1, name: '签名清洗商品', image_url: signed },
    { authorization: `Bearer ${adminToken}` },
  )
  assert.strictEqual(res.status, 201)
  const row = db
    .prepare('SELECT image_url FROM inventory_products WHERE name = ?')
    .get('签名清洗商品')
  assert.strictEqual(row.image_url, `/uploads/${PRODUCT_WRITE}`)

  const list = await fetch(`${base}/api/inventory/products`, {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  const listBody = await list.json()
  const product = listBody.data.find((item) => item.name === '签名清洗商品')
  assert.strictEqual(product.image_url, `/uploads/${PRODUCT_WRITE}`)
})

test('请求体递归清洗数组与对象中的上传 URL，其他查询串不动', async () => {
  const input = {
    image_url: `/uploads/${PRIVATE}?expires=123&signature=abc`,
    spaced_image_url: `  /uploads/${PRIVATE}?expires=123&signature=abc  `,
    nested: { images: [`/uploads/${OTHER_PRIVATE}?token=old#fragment`] },
    external: 'https://example.com/image.png?width=100',
  }
  const { res } = await postJson('/api/request-body-fixture', input)
  assert.strictEqual(res.status, 200)
  const stored = JSON.parse(
    db.prepare('SELECT body FROM request_body_fixture ORDER BY id DESC LIMIT 1').get().body,
  )
  assert.deepEqual(stored, {
    image_url: `/uploads/${PRIVATE}`,
    spaced_image_url: `/uploads/${PRIVATE}`,
    nested: { images: [`/uploads/${OTHER_PRIVATE}`] },
    external: 'https://example.com/image.png?width=100',
  })
})

test('表单请求体同样剥离上传 URL 查询串', async () => {
  const res = await fetch(`${base}/api/request-body-fixture`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ image_url: `/uploads/${PRIVATE}?expires=123&signature=abc` }),
  })
  assert.strictEqual(res.status, 200)
  const stored = JSON.parse(
    db.prepare('SELECT body FROM request_body_fixture ORDER BY id DESC LIMIT 1').get().body,
  )
  assert.strictEqual(stored.image_url, `/uploads/${PRIVATE}`)
})

test('凭证取价失败时不写文件，不留下无人审核的孤儿凭证', async () => {
  const beforeFiles = fs.readdirSync(uploadDir).sort()
  const beforeOwnership = db.prepare('SELECT COUNT(*) AS count FROM upload_files').get().count
  const originalPrepare = db.prepare
  db.prepare = function prepareWithPriceFailure(sql) {
    if (sql === 'SELECT value FROM app_settings WHERE key = ?') {
      throw new Error('price database unavailable')
    }
    return originalPrepare.call(this, sql)
  }
  let res
  try {
    const form = new FormData()
    form.append('file', new Blob([FILE_BYTES], { type: 'image/png' }), 'proof.png')
    form.append('channel', 'wechat')
    res = await fetch(`${base}/api/payment/deposit`, {
      method: 'POST',
      headers: { 'x-session-id': SESSION },
      body: form,
    })
  } finally {
    db.prepare = originalPrepare
  }
  assert.strictEqual(res.status, 500)
  assert.deepStrictEqual(fs.readdirSync(uploadDir).sort(), beforeFiles)
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM upload_files').get().count,
    beforeOwnership,
    '失败请求不能登记文件所有权',
  )
})

test('支付回调验签原文保持逐字节不变，清洗只作用于解析后的 body', async () => {
  const raw = JSON.stringify({
    resource: { ciphertext: 'offline-ciphertext' },
    proof_url: `/uploads/${PRIVATE}?expires=123&signature=abc`,
  })
  const res = await fetch(`${base}/api/payment/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  })
  assert.strictEqual(res.status, 200)
  const stored = JSON.parse(
    db.prepare('SELECT body FROM request_body_fixture ORDER BY id DESC LIMIT 1').get().body,
  )
  assert.strictEqual(stored.raw, raw)
  assert.strictEqual(stored.body.proof_url, `/uploads/${PRIVATE}`)
})
