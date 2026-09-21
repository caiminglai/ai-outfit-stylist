/**
 * 顾客临时会话数据路由模块
 * 对应 Python: app/routes/customer.py
 *
 * 前端 api.ts 期望的接口：
 * - POST   /customer/session              创建会话
 * - GET    /customer/session/:sessionId   获取会话
 * - PUT    /customer/session/:sessionId   更新会话
 * - POST   /customer/session/:sessionId/sync       同步到门店
 * - DELETE /customer/session/:sessionId             删除会话
 * - POST   /customer/session/:sessionId/recommend   获取推荐
 * - GET    /customer/privacy-notice                  隐私声明
 */
const express = require('express')
const crypto = require('crypto')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { buildRecommendation } = require('../services/recommendEngine')

const router = express.Router()

const CUSTOMER_DATA_TTL = parseInt(process.env.CUSTOMER_DATA_TTL || '7200', 10)

/** 隐私声明内容 */
const PRIVACY_NOTICE = {
  title: '门店数据隐私保护声明',
  content: [
    '您的数据仅在本设备临时存储，不会上传到云端服务器。',
    '会话有效期为 2 小时，超时后自动清除。',
    '您可随时删除自己的数据，删除后不可恢复。',
    '推荐结果基于规则引擎生成，不涉及人脸识别等生物特征存储。',
  ],
  highlight: '我们尊重并保护您的个人隐私',
}

/** 生成会话 ID */
function generateSessionId() {
  if (crypto.randomUUID) {
    return 'sess_' + crypto.randomUUID().replace(/-/g, '')
  }
  // 安全 fallback：使用 crypto.randomBytes
  return 'sess_' + crypto.randomBytes(16).toString('hex')
}

/** 解析 profile_data */
function parseProfileData(val) {
  if (val == null) return {}
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return {}
  }
}

// ============================================================
// 隐私声明
// ============================================================

router.get('/privacy-notice', (_req, res) => {
  return sendSuccess(res, PRIVACY_NOTICE)
})

// ============================================================
// 会话 CRUD（路径前缀 /session）
// ============================================================

/** 创建顾客会话 */
router.post('/session', (req, res) => {
  try {
    const sessionId = generateSessionId()
    const profileData = JSON.stringify(req.body?.profile_data || req.body || {})
    const expiresAt = new Date(Date.now() + CUSTOMER_DATA_TTL * 1000).toISOString()

    db.prepare(
      `INSERT INTO customer_sessions (session_id, profile_data, expires_at, synced)
       VALUES (?, ?, ?, 0)`,
    ).run(sessionId, profileData, expiresAt)

    return sendSuccess(
      res,
      {
        session_id: sessionId,
        expires_at: expiresAt,
        privacy_notice: PRIVACY_NOTICE.highlight,
        profile_data: parseProfileData(profileData),
      },
      '顾客会话已创建',
    )
  } catch (err) {
    console.error('[顾客] 创建会话失败:', err)
    return sendError(res, '创建会话失败', 500)
  }
})

/** 获取顾客会话 */
router.get('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在或已过期', 404)
    }

    // 检查是否过期
    if (new Date(session.expires_at) < new Date()) {
      db.prepare('DELETE FROM customer_sessions WHERE session_id = ?').run(sessionId)
      return sendError(res, '会话已过期', 404)
    }

    return sendSuccess(
      res,
      {
        session_id: session.session_id,
        expires_at: session.expires_at,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: !!session.synced,
        synced_at: session.synced_at || undefined,
        profile_data: parseProfileData(session.profile_data),
      },
      '获取会话成功',
    )
  } catch (err) {
    console.error('[顾客] 获取会话失败:', err)
    return sendError(res, '获取会话失败', 500)
  }
})

/** 更新顾客会话 */
router.put('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在', 404)
    }

    const profileData = JSON.stringify(req.body?.profile_data || req.body || {})
    const expiresAt = new Date(Date.now() + CUSTOMER_DATA_TTL * 1000).toISOString()

    db.prepare(
      'UPDATE customer_sessions SET profile_data = ?, expires_at = ? WHERE session_id = ?',
    ).run(profileData, expiresAt, sessionId)

    return sendSuccess(
      res,
      {
        session_id: sessionId,
        expires_at: expiresAt,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: !!session.synced,
        synced_at: session.synced_at || undefined,
        profile_data: parseProfileData(profileData),
      },
      '会话已更新',
    )
  } catch (err) {
    console.error('[顾客] 更新会话失败:', err)
    return sendError(res, '更新会话失败', 500)
  }
})

/** 同步顾客数据到门店（标记 synced） */
router.post('/session/:sessionId/sync', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在', 404)
    }

    const syncedAt = new Date().toISOString()
    db.prepare('UPDATE customer_sessions SET synced = 1, synced_at = ? WHERE session_id = ?').run(
      syncedAt,
      sessionId,
    )

    return sendSuccess(
      res,
      {
        session_id: sessionId,
        expires_at: session.expires_at,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: true,
        synced_at: syncedAt,
        profile_data: parseProfileData(session.profile_data),
      },
      '数据已同步到门店',
    )
  } catch (err) {
    console.error('[顾客] 同步失败:', err)
    return sendError(res, '同步失败', 500)
  }
})

/** 删除顾客会话 */
router.delete('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const result = db.prepare('DELETE FROM customer_sessions WHERE session_id = ?').run(sessionId)
    if (result.changes === 0) {
      return sendError(res, '会话不存在', 404)
    }
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[顾客] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

/** 获取顾客推荐（基于会话中的 profile_data） */
router.post('/session/:sessionId/recommend', (req, res) => {
  try {
    const { sessionId } = req.params
    const mode = req.body?.mode || 'store'

    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在或已过期', 404)
    }

    // 检查是否过期
    if (new Date(session.expires_at) < new Date()) {
      db.prepare('DELETE FROM customer_sessions WHERE session_id = ?').run(sessionId)
      return sendError(res, '会话已过期', 404)
    }

    const profile = parseProfileData(session.profile_data)
    const recommendation = buildRecommendation(profile, mode)

    // 保存推荐日志
    let logId = null
    try {
      const result = db
        .prepare('INSERT INTO recommendation_logs (session_id, mode, result) VALUES (?, ?, ?)')
        .run(sessionId, mode, JSON.stringify(recommendation))
      logId = result.lastInsertRowid
    } catch {
      // recommendation_logs 表可能不存在，不影响主流程
    }

    return sendSuccess(
      res,
      {
        recommendation,
        mode,
        log_id: logId,
        privacy_notice: PRIVACY_NOTICE.highlight,
      },
      '推荐已生成',
    )
  } catch (err) {
    console.error('[顾客] 推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

module.exports = router
