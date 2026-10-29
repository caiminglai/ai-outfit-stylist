/**
 * 请求日志中间件 - 同时输出到控制台和日志文件(按日期轮转)
 *
 * 记的是 originalUrl，里面带 query ⇒ 现在没有路由从 query 读口令，
 * 但这条口子一旦有人加（`?token=`、`?phone=`），日志文件就成了凭据落盘点，
 * 而且日志是明文躺在 backend/logs/ 里的。所以进门先过一次脱敏：
 * 命中敏感键名的值直接抹掉，会话 ID 这类"既是凭据又要用来定位"的只留前 8 位
 * （和 server.js 里 /uploads 那条同一口径）。
 */

const { log } = require('../utils/logger')

/** 整值抹掉的敏感 query 键名（小写比较） */
const MASKED_QUERY_KEYS = [
  'token',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'id_token',
  'password',
  'passwd',
  'pwd',
  'secret',
  'app_secret',
  'api_key',
  'apikey',
  'sign',
  'signature',
  'authorization',
  'auth',
  'cookie',
  'phone',
  'mobile',
  'tel',
  'idcard',
  'id_card',
  'code',
  'captcha',
  'verify_code',
  'email',
]
/** 只留前 8 位的键名：游客 sid 是永久凭据（L4），但排查又要能认出是谁 */
const TRUNCATED_QUERY_KEYS = ['session_id', 'sid', 'sessionid']

/** URL 里 query 部分的最大长度，超了直接截断（防一条 10MB 长 URL 把日志撑爆） */
const MAX_URL_LEN = 500

/** `token[]=x`／`token[0]=x` 这类数组写法：去掉尾部方括号再比键名 */
const BRACKET_SUFFIX = /\[[^\]]*\]$/

/**
 * 键名的候选写法：原样、按百分号解码（最多两层，挡 %2574oken 这种双重编码）、
 * 再去掉数组后缀。
 * 原来只拿 `rawKey.toLowerCase()` 直接比 ⇒ `%74oken=secret`（把 t 编码掉）在日志里
 * 一字不动地落盘，而 Express 解析 query 时是会解码的 ⇒ 这条日志记的就是真凭据。
 * 10-13 实测：改前 `?%74oken=abc123` 原样进日志，改后回 `?%74oken=***`。
 */
function keyCandidates(rawKey) {
  const out = new Set()
  let cur = String(rawKey)
  for (let depth = 0; depth < 3 && cur; depth++) {
    const k = cur.toLowerCase()
    out.add(k)
    out.add(k.replace(BRACKET_SUFFIX, ''))
    let next = null
    try {
      next = decodeURIComponent(cur.replace(/\+/g, ' '))
    } catch {
      break // 畸形百分号编码（'%zz'）：URIError 不是错误，按到这一步的写法比就够了
    }
    if (!next || next === cur) break
    cur = next
  }
  return out
}

function matchesKeyList(rawKey, list) {
  for (const k of keyCandidates(rawKey)) {
    if (list.includes(k)) return true
  }
  return false
}

function maskQuery(query) {
  if (!query) return ''
  // 契约上这里收的是「已经切掉 ? 的 query 串」（safeUrl 切的）。但调用方一旦把整条
  // 带 ? 的串递进来，第一个键名就会变成 '?token'，解码后仍带问号 ⇒ 一个都不认，
  // 真凭据原样落盘。这里先把问号吃掉，两种写法都拦得住。
  const cleaned = query[0] === '?' ? query.slice(1) : query
  const out = []
  for (const pair of cleaned.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1)
    if (matchesKeyList(rawKey, MASKED_QUERY_KEYS)) out.push(`${rawKey}=***`)
    else if (matchesKeyList(rawKey, TRUNCATED_QUERY_KEYS))
      out.push(`${rawKey}=${rawVal.slice(0, 8)}…`)
    else out.push(pair)
  }
  return out.join('&')
}

/** 把 originalUrl 里的 query 脱敏；解析失败也不能让日志中间件把请求打断 */
function safeUrl(req) {
  try {
    const raw = String(req.originalUrl || req.url || '')
    const q = raw.indexOf('?')
    const base = q === -1 ? raw : raw.slice(0, q)
    const query = q === -1 ? '' : maskQuery(raw.slice(q + 1))
    const full = query ? `${base}?${query}` : base
    return full.length > MAX_URL_LEN ? `${full.slice(0, MAX_URL_LEN)}…(已截断)` : full
  } catch {
    return '(URL 无法记录)'
  }
}

function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, ip } = req
  const url = safeUrl(req)

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const tag = status >= 400 ? 'WARN' : 'INFO'
    log(`[${tag}] ${method} ${url} ${status} ${duration}ms (${ip})`)
  })

  next()
}

module.exports = { requestLogger, safeUrl, maskQuery, MASKED_QUERY_KEYS, TRUNCATED_QUERY_KEYS }
