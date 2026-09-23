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

/**
 * 获取当前用户（通过 X-Session-Id）
 * @returns {object|null}
 */
function getCurrentUser(req) {
  const sessionId = getSessionId(req)
  if (!sessionId) return null
  return db.prepare('SELECT * FROM users WHERE session_id = ?').get(sessionId) || null
}

/**
 * 前端本地就能生成 session id（展厅 SPA 从不调 /api/auth/guest），
 * 首次访问时补一条游客记录，否则衣橱/化妆柜/配饰柜/跨柜搭配恒 401。
 */
function ensureGuestUser(sessionId) {
  db.prepare('INSERT OR IGNORE INTO users (session_id) VALUES (?)').run(sessionId)
  return db.prepare('SELECT * FROM users WHERE session_id = ?').get(sessionId) || null
}

/**
 * 游客登录验证中间件
 */
function loginRequired(req, res, next) {
  let user = getCurrentUser(req)
  if (!user) {
    const sessionId = getSessionId(req)
    // 只接受与 UUID / sess_ 同形状的 id，挡住脚本乱填产生的垃圾行
    if (typeof sessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
      user = ensureGuestUser(sessionId)
    }
  }
  if (!user) {
    return res.status(401).json({
      success: false,
      data: null,
      message: '未授权访问，请先登录或提供有效的 X-Session-Id',
    })
  }
  req.user = user
  next()
}

/**
 * 获取管理员 Token 签名密钥
 */
function getAdminSecret() {
  const secret = process.env.SECRET_KEY
  if (!secret) {
    console.error('[安全] SECRET_KEY 未配置！管理员认证将不可用')
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
    if (parts.length !== 3) return false

    const [username, timestamp, signature] = parts
    const payload = `${username}:${timestamp}`

    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    // 常量时间比较，防止时序攻击
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return false
    }

    // 检查有效期（24小时）
    const tokenTime = new Date(parseInt(timestamp) * 1000)
    const now = new Date()
    if (now - tokenTime > 24 * 60 * 60 * 1000) return false

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
    return res.status(401).json({
      success: false,
      data: null,
      message: '未授权，请提供管理员 Token',
    })
  }

  const token = authHeader.slice(7)
  if (!verifyAdminToken(token)) {
    return res.status(401).json({
      success: false,
      data: null,
      message: 'Token 无效或已过期',
    })
  }

  next()
}

module.exports = {
  getSessionId,
  getCurrentUser,
  loginRequired,
  generateAdminToken,
  verifyAdminToken,
  adminLoginRequired,
}
