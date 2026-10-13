/**
 * 支付宝「电脑网站支付」客户端（下单 / 查单 / 异步通知验签）
 *
 * 只用 Node 内置 crypto，不引第三方 SDK；签名算法 RSA2 就是 SHA256WithRSA。
 * 配置缺失时 isConfigured() 返回 false，调用方据此回落到旧的
 * "静态收款码 + 上传凭证"，所以本模块在没有商户号的环境里也能被安全加载。
 *
 * 需要的环境变量（全部只写在 .env，不进仓库）：
 *   ALIPAY_APP_ID            开放平台应用 AppID（2021... 16 位数字）
 *   ALIPAY_PRIVATE_KEY_PATH  应用私钥 pem（PKCS#8；公钥贴到开放平台"设置公钥"）
 *   ALIPAY_PUBLIC_KEY_PATH   支付宝公钥 pem（核身后平台返回的那把，与应用公钥不是同一把）
 *   ALIPAY_NOTIFY_URL        异步通知地址，https 且不能被 SPA 兜底吃掉
 *   ALIPAY_RETURN_URL        可选，付款后浏览器同步跳回的前端地址
 *   ALIPAY_SELLER_ID         可选，商户号 PID（2088...）；配了就用它卡通知里的收款方
 */
const fs = require('fs')
const crypto = require('crypto')
const { beijingTimestamp, beijingStamp } = require('../utils/beijingTime')

const GATEWAY = 'https://openapi.alipay.com/gateway.do'
const PRODUCT_CODE = 'FAST_INSTANT_TRADE_PAY'
// 只有这两个终态算收到钱；WAIT_BUYER_PAY / TRADE_CLOSED 都不算
const PAID_STATUSES = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED'])

function env(name) {
  const v = process.env[name]
  return typeof v === 'string' ? v.trim() : ''
}

const REQUIRED_KEYS = [
  'ALIPAY_APP_ID',
  'ALIPAY_PRIVATE_KEY_PATH',
  'ALIPAY_PUBLIC_KEY_PATH',
  'ALIPAY_NOTIFY_URL',
]

/** 缺哪些配置；全齐返回空数组 */
function missingConfig() {
  const missing = REQUIRED_KEYS.filter((k) => !env(k))
  if (!missing.length) {
    for (const k of ['ALIPAY_PRIVATE_KEY_PATH', 'ALIPAY_PUBLIC_KEY_PATH']) {
      if (!fs.existsSync(env(k))) missing.push(`${k}(文件不存在)`)
    }
  }
  return missing
}

function isConfigured() {
  return missingConfig().length === 0
}

// 两把钥匙各读一次；配置改了要重启进程才生效，这里不做热加载
let appPrivateKey = null
let alipayPublicKey = null

function getAppPrivateKey() {
  if (!appPrivateKey) appPrivateKey = fs.readFileSync(env('ALIPAY_PRIVATE_KEY_PATH'), 'utf8')
  return appPrivateKey
}

function getAlipayPublicKey() {
  if (!alipayPublicKey) alipayPublicKey = fs.readFileSync(env('ALIPAY_PUBLIC_KEY_PATH'), 'utf8')
  return alipayPublicKey
}

/**
 * 待签名串：按 key 的 ASCII 升序拼 k=v&k=v，值不做 URL 编码、空值剔除。
 * 请求方向只剔 sign（sign_type 要参与签名）；通知方向官方要求 sign 和 sign_type 都剔掉，
 * 两个口径不一样是这里最容易错的地方，所以做成开关而不是写死。
 * @param {Record<string,string>} params
 * @param {boolean} dropSignType 验通知时用 true
 */
function buildSignContent(params, dropSignType = false) {
  const skip = dropSignType ? new Set(['sign', 'sign_type']) : new Set(['sign'])
  return Object.keys(params)
    .filter(
      (k) => !skip.has(k) && params[k] !== '' && params[k] !== undefined && params[k] !== null,
    )
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

function sign(content) {
  return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(getAppPrivateKey(), 'base64')
}

function verifyAlipay(content, signature) {
  return crypto
    .createVerify('RSA-SHA256')
    .update(content, 'utf8')
    .verify(getAlipayPublicKey(), signature, 'base64')
}

/**
 * 支付宝要求的 timestamp 格式是"北京时间" yyyy-MM-dd HH:mm:ss。
 * 原来这里用 d.getFullYear()/getHours()——那读的是**容器时区**，而容器没设 TZ（实测 `date` 回 UTC）
 * ⇒ 签出去的 timestamp 恒早 8 小时，症状是"一上线就下单失败"，
 *   而本机（东八区）跑着完全看不出问题。偏差的容忍窗口官方文档没在本机原文里，不写具体秒数。
 * 口径统一放 utils/beijingTime.js，容器时区怎么设都不影响。
 */
const alipayTimestamp = (at = new Date()) => beijingTimestamp(at)

function baseParams(method) {
  return {
    app_id: env('ALIPAY_APP_ID'),
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
  }
}

/** 组装并签名一组请求参数 */
function signedParams(method, bizContent) {
  const params = baseParams(method)
  const notifyUrl = env('ALIPAY_NOTIFY_URL')
  if (notifyUrl) params.notify_url = notifyUrl
  const returnUrl = env('ALIPAY_RETURN_URL')
  if (returnUrl) params.return_url = returnUrl
  params.biz_content = JSON.stringify(bizContent)
  params.sign = sign(buildSignContent(params))
  return params
}

function formEncode(params) {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
}

/**
 * 从应答原文里切出 `"alipay_xxx_response":{...}` 那段 JSON 原文。
 * 必须切原文而不是 JSON.stringify(解析后的对象)——应答里 key 顺序和空白一旦变动，
 * 签名就对不上了，这是支付宝应答验签与微信最大的差别。
 * @returns {string|null} 含大括号的原文，找不到返回 null
 */
function extractResponseNode(raw, nodeKey) {
  const key = `"${nodeKey}":`
  const at = raw.indexOf(key)
  if (at < 0) return null
  let i = at + key.length
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== '{') return null
  const from = i
  let depth = 0
  let inStr = false
  let escaped = false
  for (; i < raw.length; i++) {
    const ch = raw[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(from, i + 1)
    }
  }
  return null
}

/** 调一个需要解析应答的接口（查单等），返回业务节点对象 */
async function callApi(method, bizContent) {
  const params = signedParams(method, bizContent)
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: formEncode(params),
    // 查单挂在这里就没有 timeout：openapi 握手成功但不回时这个 promise 永远不 settle，
    // 而 routes/payment.js 查单分支的 catch 等的是 reject ⇒ 前端那一格一直转圈，
    // 钱其实已经扣了也不会被确认。与 wechatPay.request 同一把尺子。
    signal: AbortSignal.timeout(10000),
  })
  const text = await res.text()
  const nodeKey = `${method.replace(/\./g, '_')}_response`
  const nodeRaw = extractResponseNode(text, nodeKey)
  if (nodeRaw === null) {
    // 网关级错误（签名错、参数错）回的是 error_response，没有业务节点也没有 sign
    const err = new Error(`支付宝 ${res.status} ${text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new Error(`支付宝应答不是合法 JSON：${text.slice(0, 200)}`)
  }
  if (!envelope.sign) throw new Error('支付宝应答缺少 sign')
  let ok = false
  try {
    ok = verifyAlipay(nodeRaw, envelope.sign)
  } catch (verifyErr) {
    throw new Error(`支付宝应答验签异常：${verifyErr.message}`)
  }
  if (!ok) throw new Error('支付宝应答验签失败')

  const node = JSON.parse(nodeRaw)
  if (node.code !== '10000') {
    const err = new Error(
      `支付宝 ${node.code} ${node.sub_code || ''} ${node.sub_msg || node.msg || ''}`,
    )
    err.detail = node
    throw err
  }
  return node
}

/**
 * 电脑网站支付下单：不出二维码，返回一个把浏览器送到支付宝收银台的 GET 地址。
 * 地址里带签名，本身不是凭证——真正的到账只认异步通知与查单。
 */
function pagePayUrl({ outTradeNo, amountFen, subject }) {
  const params = signedParams('alipay.trade.page.pay', {
    out_trade_no: outTradeNo,
    total_amount: fenToYuan(amountFen),
    subject,
    product_code: PRODUCT_CODE,
  })
  return `${GATEWAY}?${formEncode(params)}`
}

/** 按商户订单号查单——通知万一没到，这里也能确认到账 */
async function queryOrderByOutTradeNo(outTradeNo) {
  return callApi('alipay.trade.query', { out_trade_no: outTradeNo })
}

/**
 * 处理异步通知：req.body 已由 express.urlencoded 解析成扁平字符串对象。
 * 与微信不同，支付宝的通知不是 JSON 也没有签名头，签名就是其中一个表单字段。
 * @returns {{ok:true,paid:boolean,data:object}|{ok:false,reason:string}}
 */
function handleNotify(params) {
  if (!params || typeof params !== 'object') return { ok: false, reason: '通知体为空' }
  if (!params.sign) return { ok: false, reason: '通知缺少 sign' }
  let ok = false
  try {
    ok = verifyAlipay(buildSignContent(params, true), params.sign)
  } catch (err) {
    return { ok: false, reason: `验签异常：${err.message}` }
  }
  if (!ok) return { ok: false, reason: '签名校验未通过' }
  if (params.app_id !== env('ALIPAY_APP_ID')) {
    return { ok: false, reason: `app_id 不匹配：${params.app_id}` }
  }
  const seller = env('ALIPAY_SELLER_ID')
  if (seller) {
    if (!params.seller_id) return { ok: false, reason: '通知缺少 seller_id，无法确认收款方' }
    if (params.seller_id !== seller) {
      return { ok: false, reason: `seller_id 不匹配：${params.seller_id}` }
    }
  }
  if (!params.out_trade_no) return { ok: false, reason: '通知缺少 out_trade_no' }
  return { ok: true, paid: PAID_STATUSES.has(params.trade_status), data: params }
}

/** 商户订单号：A3 + 14 位时间 + 8 位随机，24 字符。前缀与微信的 S3 区分渠道 */
function newOutTradeNo() {
  // 单号里的 14 位时间也走东八区：容器 UTC 会让"今天下的单"在 00:00~07:59 挂上前一天的日期，
  // 对账按单号前缀筛某一天时就会漏
  return `A3${beijingStamp()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

/** 分 -> 支付宝要求的两位小数字符串元 */
function fenToYuan(fen) {
  return (Number(fen) / 100).toFixed(2)
}

// 元 -> 分。用 round 而不是 parseInt，避免 99.9 * 100 = 9989.9999 这类浮点坑
function yuanToFen(yuan) {
  return Math.round(Number(yuan) * 100)
}

module.exports = {
  GATEWAY,
  PAID_STATUSES,
  isConfigured,
  missingConfig,
  pagePayUrl,
  queryOrderByOutTradeNo,
  handleNotify,
  newOutTradeNo,
  fenToYuan,
  yuanToFen,
  // 下面三个是给离线断言用的，业务代码不要直接调
  buildSignContent,
  sign,
  alipayTimestamp,
}
