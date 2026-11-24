/**
 * 认证中间件
 *
 * 两种认证方式：
 * 1. 游客：X-Session-Id 请求头（UUID）
 * 2. 管理员：Authorization: Bearer <token>（HMAC-SHA256 签名，24h 有效）
 */

const crypto = require('crypto')
const db = require('../db/init')
const { getSessionId } = require('../utils/common')
const { sendError } = require('../utils/response')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')

/**
 * 记录会话活跃时间，并在历史 NULL 首次命中时补固定 30 天窗口。
 *
 * last_active_at 每小时最多写一次，且永不参与过期判断；session_expires_at 只在
 * 为 NULL 时补值，不在后续请求中延长，因此会话是固定 30 天窗口而非滚动续期。
 * try/catch 兜底：观测或迁移写失败不能反过来拖垮认证，下一 hit 会再补。
 */
function touchSessionActivity(userId) {
  try {
    db.prepare(
      `UPDATE users
       SET last_active_at = CASE
             WHEN last_active_at IS NULL OR last_active_at < datetime('now', '-1 hour')
             THEN datetime('now')
             ELSE last_active_at
           END,
           session_expires_at = COALESCE(session_expires_at, datetime('now', '+30 days'))
       WHERE id = ?
         AND (
           session_expires_at IS NULL
           OR last_active_at IS NULL
           OR last_active_at < datetime('now', '-1 hour')
         )`,
    ).run(userId)
  } catch {
    /* 活跃时间或历史窗口没补上而已，认证照常；下次命中再试 */
  }
}

/** 只查有效会话；NULL 是待迁移的历史行，过期或被轮换的 ID 一律拒绝。 */
function findValidUser(sessionId) {
  return (
    db
      .prepare(
        `SELECT * FROM users
         WHERE session_id = ?
           AND (session_expires_at IS NULL OR session_expires_at > datetime('now'))
           AND NOT EXISTS (
             SELECT 1 FROM revoked_sessions r WHERE r.session_id = users.session_id
           )`,
      )
      .get(sessionId) || null
  )
}

/**
 * 获取当前用户（通过 X-Session-Id）
 * @returns {object|null}
 */
function getCurrentUser(req) {
  const sessionId = getSessionId(req)
  if (!sessionId) return null
  const user = findValidUser(sessionId)
  if (user) touchSessionActivity(user.id)
  return user
}

/**
 * 前端本地就能生成 session id（展厅 SPA 从不调 /api/auth/guest），
 * 首次访问时补一条游客记录，否则衣橱/化妆柜/配饰柜/跨柜搭配恒 401。
 * acct_ 是会员保留前缀，绝不能自动补建：新会员旧 ID 轮换后必须自然失效。
 * 升级前的非 acct_ 旧 ID 有墓碑，也不能再被补成新游客；过期旧行不会复活。
 */
function ensureGuestUser(sessionId) {
  if (typeof sessionId === 'string' && sessionId.startsWith('acct_')) return null
  db.prepare(
    `INSERT OR IGNORE INTO users (session_id, session_expires_at)
     SELECT ?, datetime('now', '+30 days')
     WHERE NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE session_id = ?)`,
  ).run(sessionId, sessionId)
  return findValidUser(sessionId)
}

/**
 * 游客登录验证中间件
 */
function loginRequired(req, res, next) {
  const user = optionalUser(req)
  if (!user) {
    // 统一形状：这里是全仓最后一处把 message 放在顶层的 401，
    // 前端按 error.message 读 ⇒ 认证失败时提示是空的
    return sendError(res, '未授权访问，请先登录或提供有效的 X-Session-Id', 401)
  }
  req.user = user
  next()
}

/**
 * 尽力识别当前用户：识别不出来就返回 null（不拦请求）
 * 推荐引擎用它按人读写长期档案，同时保持匿名可用
 */
function optionalUser(req) {
  let user = getCurrentUser(req)
  if (!user) {
    const sessionId = getSessionId(req)
    // 只接受与 UUID / sess_ 同形状的游客 id；acct_ 会员 ID 禁止自动补建。
    if (
      typeof sessionId === 'string' &&
      !sessionId.startsWith('acct_') &&
      /^[A-Za-z0-9_-]{8,64}$/.test(sessionId)
    ) {
      user = ensureGuestUser(sessionId)
    }
  }
  return user || null
}

/**
 * 获取管理员 Token 签名密钥
 */
function getAdminSecret() {
  const secret = process.env.SECRET_KEY
  if (!secret) {
    logErr('[安全] SECRET_KEY 未配置！管理员认证将不可用')
  }
  return secret || ''
}

/**
 * 生成管理员 Token
 * 格式: base64(username:timestamp:hmac_signature)
 * 有效期: 24 小时
 * @param {string} username
 * @returns {string}
 */
function generateAdminToken(username) {
  const secret = getAdminSecret()
  if (!secret) throw new Error('SECRET_KEY 未配置，无法生成管理员令牌')
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payload = `${username}:${timestamp}`

  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

  const tokenStr = `${payload}:${signature}`
  return Buffer.from(tokenStr).toString('base64url')
}

/**
 * 验证管理员 Token
 * @param {string} token
 * @returns {boolean}
 */
function verifyAdminToken(token) {
  try {
    const secret = getAdminSecret()
    if (!secret) return false
    const tokenStr = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = tokenStr.split(':')
    if (parts.length < 3) return false

    // 签名是 hex（不含冒号），时间戳是纯数字，所以从右往左数两段才是它们。
    // 原来 `parts.length !== 3` 直接拒：管理员账号名里带一个冒号就永远登录不了
    // （generateAdminToken 拼出来的 token 会变成 4 段）。
    const signature = parts[parts.length - 1]
    const timestamp = parts[parts.length - 2]
    const username = parts.slice(0, -2).join(':')
    const payload = `${username}:${timestamp}`

    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    // 常量时间比较，防止时序攻击
    // 先比长度：长度不等时 timingSafeEqual 是直接抛 RangeError 的，原来这条抛出去
    // 由最外层 catch 折成 false。结果没变（还是拒），但"拒绝"是靠异常兜出来的——
    // 同一个 catch 还兜着 JSON.parse、DB 查询等真故障，将来谁在这些地方改了抛法，
    // 这里就会被当成"签名不对"静默放行成 401。长度这一眼不是安全判断，直接 return。
    const sigBuf = Buffer.from(signature)
    if (sigBuf.length !== expectedSig.length) return false
    if (!crypto.timingSafeEqual(sigBuf, Buffer.from(expectedSig))) {
      return false
    }

    // 检查有效期（24小时）
    // 时间戳必须是正整数秒：parseInt 认不出来时原来是 NaN ⇒ new Date(NaN) 是 Invalid Date
    // ⇒ `now - tokenTime` 为 NaN ⇒ `NaN > 86400000` 是 false ⇒ 24 小时上限被悄悄跳过，
    // 这样一个持密钥方签出的"永不过期"token 就一直能用。
    const tokenSeconds = Number.parseInt(timestamp, 10)
    if (!Number.isInteger(tokenSeconds) || tokenSeconds <= 0) return false
    const tokenTime = new Date(tokenSeconds * 1000)
    if (!Number.isFinite(tokenTime.getTime())) return false
    const now = new Date()
    if (now - tokenTime > 24 * 60 * 60 * 1000) return false

    // 签名对只证明"持密钥方签过"，不证明这个账号还在：删号/禁用后旧 token 必须当场失效
    const account = db
      .prepare('SELECT password_changed_at FROM admin_users WHERE username = ? AND is_active = 1')
      .get(username)
    if (!account) return false
    // 改过密码则更早签发的 token 全部作废；NULL=从没改过，不能因此把已登录的后台踢下线
    if (account.password_changed_at > tokenSeconds) return false
    return true
  } catch {
    return false
  }
}

/**
 * 管理员登录验证中间件
 */
function adminLoginRequired(req, res, next) {
  const authHeader = req.headers['authorization'] || ''
  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, '未授权，请提供管理员 Token', 401)
  }

  const token = authHeader.slice(7)
  if (!verifyAdminToken(token)) {
    return sendError(res, 'Token 无效或已过期', 401)
  }

  next()
}

module.exports = {
  getSessionId,
  getCurrentUser,
  optionalUser,
  loginRequired,
  generateAdminToken,
  verifyAdminToken,
  adminLoginRequired,
}
