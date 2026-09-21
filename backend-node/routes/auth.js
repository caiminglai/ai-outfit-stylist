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
