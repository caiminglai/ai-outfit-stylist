/**
 * 微信支付 APIv3 客户端（Native 下单 / 查单 / 回调验签解密）
 *
 * 只用 Node 内置 crypto + fetch，不引第三方 SDK。
 * 任何一项配置缺失时 isConfigured() 返回 false，调用方据此回落到旧的
 * "静态收款码 + 上传凭证"，所以本模块在没有商户号的环境里也能被安全加载。
 *
 * 需要的环境变量（全部只写在 .env，不进仓库）：
 *   WXPAY_MCHID             商户号
 *   WXPAY_SERIAL_NO         商户 API 证书序列号
 *   WXPAY_APIV3_KEY         APIv3 密钥，必须正好 32 字符
 *   WXPAY_PRIVATE_KEY_PATH  apiclient_key.pem
 *   WXPAY_PUBLIC_KEY_PATH   微信支付公钥 .pem
 *   WXPAY_PUBLIC_KEY_ID     微信支付公钥ID（PUB_KEY_ID_...）
 *   WXPAY_NOTIFY_URL        回调地址，https 且不能被 SPA 兜底吃掉
 *   WXPAY_APPID             必填；须是已在商户平台与该商户号关联过的 AppID
 */
const fs = require('fs')
const crypto = require('crypto')

const API_HOST = 'https://api.mch.weixin.qq.com'
// 回调/应答时间戳允许的偏差，超出按重放处理
const TIMESTAMP_TOLERANCE_SEC = 300
const AUTH_SCHEMA = 'WECHATPAY2-SHA256-RSA2048'

function env(name) {
  const v = process.env[name]
  return typeof v === 'string' ? v.trim() : ''
}

const REQUIRED_KEYS = [
  'WXPAY_APPID',
  'WXPAY_MCHID',
  'WXPAY_SERIAL_NO',
  'WXPAY_APIV3_KEY',
  'WXPAY_PRIVATE_KEY_PATH',
  'WXPAY_PUBLIC_KEY_PATH',
  'WXPAY_PUBLIC_KEY_ID',
  'WXPAY_NOTIFY_URL',
]

/** 缺哪些配置；全齐返回空数组 */
function missingConfig() {
  const missing = REQUIRED_KEYS.filter((k) => !env(k))
  if (!missing.length) {
    for (const k of ['WXPAY_PRIVATE_KEY_PATH', 'WXPAY_PUBLIC_KEY_PATH']) {
      if (!fs.existsSync(env(k))) missing.push(`${k}(文件不存在)`)
    }
    if (env('WXPAY_APIV3_KEY').length !== 32) missing.push('WXPAY_APIV3_KEY(须 32 字符)')
  }
  return missing
}

function isConfigured() {
  return missingConfig().length === 0
}

// 私钥/公钥各读一次；配置改了要重启进程才生效，这里不做热加载
let privateKey = null
let publicKey = null

function getPrivateKey() {
  if (!privateKey) privateKey = fs.readFileSync(env('WXPAY_PRIVATE_KEY_PATH'), 'utf8')
  return privateKey
}

function getPublicKey() {
  if (!publicKey) publicKey = fs.readFileSync(env('WXPAY_PUBLIC_KEY_PATH'), 'utf8')
  return publicKey
}

function sign(message) {
  return crypto.createSign('RSA-SHA256').update(message, 'utf8').sign(getPrivateKey(), 'base64')
}

/**
 * 微信对签名原文的格式统一是"字段\n拼接"，请求与应答只差字段个数，
 * 所以签名和验签共用这一个拼装函数。
 */
function buildMessage(parts) {
  return `${parts.join('\n')}\n`
}

function nonce() {
  return crypto.randomUUID().replace(/-/g, '').toUpperCase()
}

function authorization(method, urlPath, bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const str = nonce()
  const signature = sign(buildMessage([method, urlPath, timestamp, str, bodyStr]))
  const header = [
    `mchid="${env('WXPAY_MCHID')}"`,
    `nonce_str="${str}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${env('WXPAY_SERIAL_NO')}"`,
  ].join(',')
  return `${AUTH_SCHEMA} ${header}`
}

/**
 * 验证微信侧签名（应答与回调共用）
 * 用微信支付公钥验，并要求 serial 就是我们那把公钥、时间戳没过期。
 */
function verifyWechat({ timestamp, nonceStr, serial, signature, body }) {
  if (!timestamp || !nonceStr || !signature) return { ok: false, reason: '缺少验签头' }
  if (serial !== env('WXPAY_PUBLIC_KEY_ID')) {
    return { ok: false, reason: `序列号/公钥ID 不匹配：${serial}` }
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(skew) || skew > TIMESTAMP_TOLERANCE_SEC) {
    return { ok: false, reason: '时间戳超出允许偏差，按重放丢弃' }
  }
  const message = buildMessage([timestamp, nonceStr, body])
  let ok = false
  try {
    ok = crypto
      .createVerify('RSA-SHA256')
      .update(message, 'utf8')
      .verify(getPublicKey(), signature, 'base64')
  } catch (err) {
    return { ok: false, reason: `验签异常：${err.message}` }
  }
  return ok ? { ok: true } : { ok: false, reason: '签名校验未通过' }
}

/** 回调里的 resource 用 APIv3 密钥做 AES-256-GCM 解密 */
function decryptResource(resource) {
  const raw = Buffer.from(resource.ciphertext, 'base64')
  if (raw.length <= 16) throw new Error('密文长度异常')
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(env('WXPAY_APIV3_KEY'), 'utf8'),
    Buffer.from(resource.nonce, 'utf8'),
  )
  decipher.setAuthTag(raw.subarray(raw.length - 16))
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
  }
  const plain = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

/**
 * 发一个已签名的 v3 请求
 * @param {string} method
 * @param {string} urlPath 含 query，签名用的 URL 必须与实际请求完全一致
 * @param {object} [payload]
 */
async function request(method, urlPath, payload) {
  const bodyStr = payload === undefined ? '' : JSON.stringify(payload)
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'styleai-backend/1.0',
    Authorization: authorization(method, urlPath, bodyStr),
  }
  if (bodyStr) headers['Content-Type'] = 'application/json'

  const res = await fetch(API_HOST + urlPath, {
    method,
    headers,
    body: bodyStr || undefined,
  })
  const text = await res.text()

  if (!res.ok) {
    const err = new Error(`微信支付 ${res.status} ${text.slice(0, 300)}`)
    err.status = res.status
    try {
      err.detail = JSON.parse(text)
    } catch {
      /* 非 JSON 错误体，保留原文即可 */
    }
    throw err
  }
  if (text) {
    const check = verifyWechat({
      timestamp: res.headers.get('Wechatpay-Timestamp'),
      nonceStr: res.headers.get('Wechatpay-Nonce'),
      serial: res.headers.get('Wechatpay-Serial'),
      signature: res.headers.get('Wechatpay-Signature'),
      body: text,
    })
    if (!check.ok) throw new Error(`微信应答验签失败：${check.reason}`)
    return JSON.parse(text)
  }
  return null
}

/** 商户订单号：S3 + 14 位时间 + 8 位随机，24 字符，落在微信要求的 6~32 内 */
function newOutTradeNo() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `S3${stamp}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

/** Native 下单，成功返回 { code_url } */
async function nativeOrder({ outTradeNo, amountFen, description, attach }) {
  const payload = {
    appid: env('WXPAY_APPID'),
    mchid: env('WXPAY_MCHID'),
    out_trade_no: outTradeNo,
    // 微信要求 total 为整数分，且回调金额必须与之一致
    amount: { total: amountFen, currency: 'CNY' },
    description,
    notify_url: env('WXPAY_NOTIFY_URL'),
  }
  if (attach) payload.attach = attach
  return request('POST', '/v3/pay/transactions/native', payload)
}

/** 按商户订单号查单——回调丢了也能靠它兜底 */
async function queryOrderByOutTradeNo(outTradeNo) {
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${env('WXPAY_MCHID')}`
  return request('GET', path)
}

/**
 * 处理回调：rawBody 必须是未解析的原始字节转成的字符串，
 * 一旦经过 JSON.parse 再 stringify，签名就对不上了。
 * @returns {{ok:true,data:object}|{ok:false,reason:string}}
 */
function handleNotify(rawBody, headers) {
  const check = verifyWechat({
    timestamp: headers['wechatpay-timestamp'],
    nonceStr: headers['wechatpay-nonce'],
    serial: headers['wechatpay-serial'],
    signature: headers['wechatpay-signature'],
    body: rawBody,
  })
  if (!check.ok) return { ok: false, reason: check.reason }

  let envelope
  try {
    envelope = JSON.parse(rawBody)
  } catch {
    return { ok: false, reason: '回调体不是合法 JSON' }
  }
  if (!envelope.resource) return { ok: false, reason: '回调缺少 resource' }
  try {
    return { ok: true, data: decryptResource(envelope.resource) }
  } catch (err) {
    return { ok: false, reason: `解密失败：${err.message}` }
  }
}

module.exports = {
  API_HOST,
  isConfigured,
  missingConfig,
  nativeOrder,
  queryOrderByOutTradeNo,
  handleNotify,
  newOutTradeNo,
  // 元 -> 分。用 round 而不是 parseInt，避免 99.9 * 100 = 9989.9999 这类浮点坑
  yuanToFen: (yuan) => Math.round(Number(yuan) * 100),
}
