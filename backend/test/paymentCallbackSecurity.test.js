/**
 * 支付回调商户绑定与幂等行为测试。
 *
 * 真链路：本地 Express -> 真实 payment 路由 -> 真实微信/支付宝服务验签与解密 -> 内存 SQLite。
 * 密钥由本测试临时生成，回调只发往 127.0.0.1，不访问支付网关，也不读取 .env。
 * 运行: node --test test/paymentCallbackSecurity.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-payment-callback-'))
const uploadDir = path.join(tempDir, 'uploads')
fs.mkdirSync(uploadDir)
process.env.STYLEAI_DB_PATH = path.join(tempDir, 'unused-styleai.db')
process.env.STYLEAI_UPLOAD_DIR = uploadDir

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

function makeKeyPair(name) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const privatePath = path.join(tempDir, `${name}-private.pem`)
  const publicPath = path.join(tempDir, `${name}-public.pem`)
  fs.writeFileSync(privatePath, privateKey)
  fs.writeFileSync(publicPath, publicKey)
  return { privateKey, privatePath, publicPath }
}

const wxKeys = makeKeyPair('wechat')
const aliKeys = makeKeyPair('alipay')
const WX = {
  appid: 'wx-test-app',
  mchid: '1900000101',
  serial: 'MERCHANT_SERIAL_TEST',
  apiKey: '12345678901234567890123456789012',
  publicKeyId: 'PUB_KEY_ID_TEST',
}
const ALI = {
  appId: '2026000000000000',
  sellerId: '2088000000000000',
}

Object.assign(process.env, {
  WXPAY_APPID: WX.appid,
  WXPAY_MCHID: WX.mchid,
  WXPAY_SERIAL_NO: WX.serial,
  WXPAY_APIV3_KEY: WX.apiKey,
  WXPAY_PRIVATE_KEY_PATH: wxKeys.privatePath,
  WXPAY_PUBLIC_KEY_PATH: wxKeys.publicPath,
  WXPAY_PUBLIC_KEY_ID: WX.publicKeyId,
  WXPAY_NOTIFY_URL: 'https://example.test/api/payment/notify',
  ALIPAY_APP_ID: ALI.appId,
  ALIPAY_SELLER_ID: ALI.sellerId,
  ALIPAY_PRIVATE_KEY_PATH: aliKeys.privatePath,
  ALIPAY_PUBLIC_KEY_PATH: aliKeys.publicPath,
  ALIPAY_NOTIFY_URL: 'https://example.test/api/payment/notify/alipay',
})

const express = require('express')
const paymentRouter = require('../routes/payment')
const app = express()
app.use(
  express.json({
    verify(req, res, buf) {
      req.rawBody = buf.toString('utf8')
    },
  }),
)
app.use(express.urlencoded({ extended: false }))
app.use('/api/payment', paymentRouter)

let server
let baseUrl

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.beforeEach(() => {
  memDb.exec('DELETE FROM deposits; DELETE FROM payment_orders; DELETE FROM users;')
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  memDb.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function addOrder(outTradeNo, status = 'created') {
  const userId = Number(
    memDb
      .prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)')
      .run(`sid-${outTradeNo}`, outTradeNo).lastInsertRowid,
  )
  memDb
    .prepare(
      `INSERT INTO payment_orders
       (out_trade_no, user_id, description, amount_fen, status, paid_at)
       VALUES (?, ?, '形象定制服务费', 9900, ?, ?)`,
    )
    .run(outTradeNo, userId, status, status === 'paid' ? "datetime('now')" : null)
  return userId
}

const orderRow = (outTradeNo) =>
  memDb.prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?').get(outTradeNo)
const depositCount = () => memDb.prepare('SELECT COUNT(*) AS n FROM deposits').get().n

function encryptWechatResource(data) {
  const nonce = 'callback-nonce'
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(WX.apiKey), Buffer.from(nonce))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return {
    associated_data: '',
    nonce,
    ciphertext: ciphertext.toString('base64'),
  }
}

async function postWechat(data, { invalidSignature = false } = {}) {
  const rawBody = JSON.stringify({
    id: `evt-${data.out_trade_no}`,
    event_type: 'TRANSACTION.SUCCESS',
    resource: encryptWechatResource(data),
  })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = 'header-nonce'
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`
  const signature = invalidSignature
    ? 'invalid-signature'
    : crypto.sign('RSA-SHA256', Buffer.from(message), wxKeys.privateKey).toString('base64')
  const res = await fetch(`${baseUrl}/api/payment/notify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-serial': WX.publicKeyId,
      'wechatpay-signature': signature,
    },
    body: rawBody,
  })
  return { status: res.status, body: await res.json() }
}

function wechatData(outTradeNo, overrides = {}) {
  return {
    appid: WX.appid,
    mchid: WX.mchid,
    out_trade_no: outTradeNo,
    transaction_id: `WX-${outTradeNo}`,
    trade_state: 'SUCCESS',
    amount: { total: 9900, currency: 'CNY' },
    ...overrides,
  }
}

/** 独立按支付宝 RSA2 通知规则拼签名串，不复用被测服务的签名助手。 */
function alipaySignature(params) {
  const content = Object.keys(params)
    .filter((key) => !['sign', 'sign_type'].includes(key) && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return crypto.sign('RSA-SHA256', Buffer.from(content), aliKeys.privateKey).toString('base64')
}

async function postAlipay(params, { invalidSignature = false } = {}) {
  const signed = { ...params, sign_type: 'RSA2' }
  signed.sign = invalidSignature ? 'invalid-signature' : alipaySignature(signed)
  const res = await fetch(`${baseUrl}/api/payment/notify/alipay`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(signed).toString(),
  })
  return { status: res.status, body: await res.text() }
}

function alipayData(outTradeNo, overrides = {}) {
  return {
    app_id: ALI.appId,
    seller_id: ALI.sellerId,
    out_trade_no: outTradeNo,
    trade_no: `ALI-${outTradeNo}`,
    trade_status: 'TRADE_SUCCESS',
    total_amount: '99.00',
    gmt_payment: '2026-11-24 12:00:00',
    notify_id: `notify-${outTradeNo}`,
    ...overrides,
  }
}

test('测试全程使用内存库与临时上传目录，没有打开运行库', () => {
  assert.equal(fs.existsSync(process.env.STYLEAI_DB_PATH), false)
  assert.equal(path.dirname(process.env.STYLEAI_UPLOAD_DIR), tempDir)
})

test('微信签名有效但 appid 错误：400 且订单与镜像凭证不变', async () => {
  const no = 'S3WRONGAPP000001'
  addOrder(no)
  const before = orderRow(no)
  const depositsBefore = depositCount()
  const res = await postWechat(wechatData(no, { appid: 'wx-other-app' }))
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'FAIL')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), depositsBefore)
})

test('微信签名有效但 mchid 错误：400 且订单与镜像凭证不变', async () => {
  const no = 'S3WRONGMCH000001'
  addOrder(no)
  const before = orderRow(no)
  const depositsBefore = depositCount()
  const res = await postWechat(wechatData(no, { mchid: '1900000999' }))
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'FAIL')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), depositsBefore)
})

test('支付宝签名有效但 seller_id 错误：400 且订单与镜像凭证不变', async () => {
  const no = 'A3WRONGSELLER001'
  addOrder(no)
  const before = orderRow(no)
  const depositsBefore = depositCount()
  const res = await postAlipay(alipayData(no, { seller_id: '2088000000000999' }))
  assert.equal(res.status, 400)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), depositsBefore)
})

test('微信商户匹配：到账后重复推送只入账一次', async () => {
  const no = 'S3REPLAY00000001'
  addOrder(no)
  const data = wechatData(no)
  const first = await postWechat(data)
  assert.equal(first.status, 200)
  assert.equal(first.body.code, 'SUCCESS')
  const paid = orderRow(no)
  assert.equal(paid.status, 'paid')
  assert.equal(paid.transaction_id, `WX-${no}`)
  assert.equal(depositCount(), 1)

  const second = await postWechat(data)
  assert.equal(second.status, 200)
  assert.deepEqual(orderRow(no), paid)
  assert.equal(depositCount(), 1)
})

test('微信乱序到账：已关单可转已支付，重复推送不产生第二笔凭证', async () => {
  const no = 'S3LATE0000000001'
  addOrder(no, 'closed')
  const data = wechatData(no)
  assert.equal((await postWechat(data)).status, 200)
  const paid = orderRow(no)
  assert.equal(paid.status, 'paid')
  assert.equal(depositCount(), 1)
  assert.equal((await postWechat(data)).status, 200)
  assert.deepEqual(orderRow(no), paid)
  assert.equal(depositCount(), 1)
})

test('支付宝商户匹配：到账后重复推送只入账一次', async () => {
  const no = 'A3REPLAY00000001'
  addOrder(no)
  const data = alipayData(no)
  const first = await postAlipay(data)
  assert.equal(first.status, 200)
  assert.equal(first.body, 'success')
  const paid = orderRow(no)
  assert.equal(paid.status, 'paid')
  assert.equal(paid.transaction_id, `ALI-${no}`)
  assert.equal(depositCount(), 1)

  const second = await postAlipay(data)
  assert.equal(second.status, 200)
  assert.deepEqual(orderRow(no), paid)
  assert.equal(depositCount(), 1)
})

test('支付宝乱序到账：已关单可转已支付，重复推送不产生第二笔凭证', async () => {
  const no = 'A3LATE0000000001'
  addOrder(no, 'closed')
  const data = alipayData(no)
  assert.equal((await postAlipay(data)).status, 200)
  const paid = orderRow(no)
  assert.equal(paid.status, 'paid')
  assert.equal(depositCount(), 1)
  assert.equal((await postAlipay(data)).status, 200)
  assert.deepEqual(orderRow(no), paid)
  assert.equal(depositCount(), 1)
})

test('支付宝未配置 seller_id 时不额外要求通知携带该字段', async () => {
  const no = 'A3NOSELLER000001'
  addOrder(no)
  const data = alipayData(no)
  delete data.seller_id
  const previous = process.env.ALIPAY_SELLER_ID
  process.env.ALIPAY_SELLER_ID = ''
  try {
    const res = await postAlipay(data)
    assert.equal(res.status, 200)
    assert.equal(res.body, 'success')
    assert.equal(orderRow(no).status, 'paid')
  } finally {
    process.env.ALIPAY_SELLER_ID = previous
  }
})

test('支付宝签名有效但 app_id 错误：400 且订单不变', async () => {
  const no = 'A3WRONGAPP000001'
  addOrder(no)
  const before = orderRow(no)
  const res = await postAlipay(alipayData(no, { app_id: '2026000000000999' }))
  assert.equal(res.status, 400)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

test('支付宝签名有效但缺少 app_id：400 且订单不变', async () => {
  const no = 'A3NOAPP00000001'
  addOrder(no)
  const before = orderRow(no)
  const data = alipayData(no)
  delete data.app_id
  const res = await postAlipay(data)
  assert.equal(res.status, 400)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

test('支付宝已配置 seller_id 但通知缺少该字段：400 且订单不变', async () => {
  const no = 'A3MISSINGSELLER01'
  addOrder(no)
  const before = orderRow(no)
  const data = alipayData(no)
  delete data.seller_id
  const res = await postAlipay(data)
  assert.equal(res.status, 400)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

for (const key of ['WXPAY_APPID', 'WXPAY_MCHID']) {
  test(`微信缺少必需商户配置 ${key}：503 且不入账`, async () => {
    const no = `S3MISSING${key.slice(-4)}01`
    addOrder(no)
    const before = orderRow(no)
    const previous = process.env[key]
    process.env[key] = '   '
    try {
      const res = await postWechat(wechatData(no))
      assert.equal(res.status, 503)
      assert.equal(res.body.code, 'FAIL')
      assert.deepEqual(orderRow(no), before)
      assert.equal(depositCount(), 0)
    } finally {
      process.env[key] = previous
    }
  })
}

test('支付宝缺少必需 app_id 配置：503 且不入账', async () => {
  const no = 'A3MISSINGAPPID001'
  addOrder(no)
  const before = orderRow(no)
  const previous = process.env.ALIPAY_APP_ID
  process.env.ALIPAY_APP_ID = '   '
  try {
    const res = await postAlipay(alipayData(no))
    assert.equal(res.status, 503)
    assert.equal(res.body, 'fail')
    assert.deepEqual(orderRow(no), before)
    assert.equal(depositCount(), 0)
  } finally {
    process.env.ALIPAY_APP_ID = previous
  }
})

test('微信签名损坏：401 且订单与镜像凭证不变', async () => {
  const no = 'S3BADSIG00000001'
  addOrder(no)
  const before = orderRow(no)
  const res = await postWechat(wechatData(no), { invalidSignature: true })
  assert.equal(res.status, 401)
  assert.equal(res.body.code, 'FAIL')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

test('支付宝签名损坏：401 且订单与镜像凭证不变', async () => {
  const no = 'A3BADSIG00000001'
  addOrder(no)
  const before = orderRow(no)
  const res = await postAlipay(alipayData(no), { invalidSignature: true })
  assert.equal(res.status, 401)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

test('微信签名有效但金额不符：400 且不入账', async () => {
  const no = 'S3BADAMOUNT00001'
  addOrder(no)
  const before = orderRow(no)
  const res = await postWechat(wechatData(no, { amount: { total: 1, currency: 'CNY' } }))
  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'FAIL')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})

test('支付宝签名有效但金额不符：400 且不入账', async () => {
  const no = 'A3BADAMOUNT00001'
  addOrder(no)
  const before = orderRow(no)
  const res = await postAlipay(alipayData(no, { total_amount: '0.01' }))
  assert.equal(res.status, 400)
  assert.equal(res.body, 'fail')
  assert.deepEqual(orderRow(no), before)
  assert.equal(depositCount(), 0)
})
