/**
 * 认证路由模块
 * 对应 Python: app/routes/auth.py
 */
const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID } = require('../utils/common')
const { generateAdminToken, verifyAdminToken } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 登录类端点限流：每分钟最多 10 次
const loginLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '登录尝试过于频繁，请稍后再试',
})

/** 游客登录 */
router.post('/guest', loginLimiter, (req, res) => {
  try {
    const sessionId = generateUUID()
    const nickname = req.body?.nickname || null

    const result = db
      .prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)')
      .run(sessionId, nickname)

    return sendSuccess(res, { session_id: sessionId, user_id: result.lastInsertRowid })
  } catch (err) {
    console.error('[认证] 游客登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 正式账号：手机号 + 密码 */
const PHONE_RE = /^1[3-9]\d{9}$/
const registerLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: '注册过于频繁，请稍后再试',
})
// 手机号不存在时也走一次 bcrypt，让两种失败耗时一致，防止按响应时间枚举手机号
const DUMMY_HASH = bcrypt.hashSync('invalid-placeholder-password', 10)

/** 注册：新建一条 users 身份并绑定手机号密码（老游客数据不迁移、不接管） */
router.post('/register', registerLimiter, (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')
    const nickname = String(req.body?.nickname || '').trim().slice(0, 40) || null

    if (!PHONE_RE.test(phone)) return sendError(res, '请输入正确的 11 位手机号', 400)
    if (password.length < 6 || password.length > 64) {
      return sendError(res, '密码长度需在 6-64 位之间', 400)
    }
    if (db.prepare('SELECT 1 FROM user_accounts WHERE phone = ?').get(phone)) {
      return sendError(res, '该手机号已注册，请直接登录', 409)
    }

    const sessionId = generateUUID()
    const hash = bcrypt.hashSync(password, 10)
    const create = db.transaction(() => {
      const u = db
        .prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)')
        .run(sessionId, nickname)
      db.prepare(
        `INSERT INTO user_accounts (phone, password_hash, user_id) VALUES (?, ?, ?)`,
      ).run(phone, hash, u.lastInsertRowid)
      return Number(u.lastInsertRowid)
    })
    const userId = create()

    return sendSuccess(res, { session_id: sessionId, user_id: userId, phone, nickname }, '注册成功')
  } catch (err) {
    console.error('[认证] 注册失败:', err)
    return sendError(res, '注册失败', 500)
  }
})

/** 登录：换回该账号对应的 session_id，前端之后照旧走 X-Session-Id */
router.post('/login', loginLimiter, (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')

    if (!PHONE_RE.test(phone) || !password) return sendError(res, '手机号或密码错误', 401)

    const acc = db
      .prepare(
        `SELECT a.user_id, a.password_hash, u.session_id, u.nickname
         FROM user_accounts a JOIN users u ON u.id = a.user_id
         WHERE a.phone = ?`,
      )
      .get(phone)

    if (!bcrypt.compareSync(password, acc ? acc.password_hash : DUMMY_HASH)) {
      return sendError(res, '手机号或密码错误', 401)
    }
    if (!acc) return sendError(res, '手机号或密码错误', 401)

    return sendSuccess(res, {
      session_id: acc.session_id,
      user_id: acc.user_id,
      phone,
      nickname: acc.nickname,
    })
  } catch (err) {
    console.error('[认证] 登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 管理员登录 */
router.post('/admin/login', loginLimiter, (req, res) => {
  try {
    const username = (req.body?.username || 'admin').trim()
    const password = req.body?.password || ''

    if (!password) {
      return sendError(res, '请输入密码', 400)
    }

    const admin = db
      .prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1')
      .get(username)

    if (!admin) {
      return sendError(res, '账号或密码错误', 401)
    }

    if (!bcrypt.compareSync(password, admin.password_hash)) {
      return sendError(res, '账号或密码错误', 401)
    }

    // 更新最后登录时间
    db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).run(admin.id)

    const token = generateAdminToken(admin.username)
    return sendSuccess(res, { token })
  } catch (err) {
    console.error('[认证] 管理员登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 验证管理员 Token */
router.get('/admin/verify', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || ''
    if (!authHeader.startsWith('Bearer ')) {
      return sendSuccess(res, { valid: false })
    }

    const token = authHeader.slice(7)
    const valid = verifyAdminToken(token)
    return sendSuccess(res, { valid })
  } catch {
    return sendSuccess(res, { valid: false })
  }
})

module.exports = router
