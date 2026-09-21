/**
 * 面容/身体分析路由模块
 * 对应 Python: app/routes/analysis.py
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// AI 分析类端点限流：每分钟最多 5 次（消耗 DashScope 额度）
const aiLimiter = rateLimit({ windowMs: 60000, max: 5, message: '分析请求过于频繁，请稍后再试' })

/** 提交面部分析 */
router.post('/face', loginRequired, aiLimiter, (req, res) => {
  try {
    // TODO: 调用 DashScope API 进行面部分析
    return sendSuccess(res, { status: 'pending' })
  } catch (err) {
    console.error('[分析] 面部分析提交失败:', err)
    return sendError(res, '分析提交失败', 500)
  }
})

/** 获取面部分析结果 */
router.get('/face/:photoId', loginRequired, (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId, 10)
    if (isNaN(photoId)) return sendError(res, '无效的照片ID', 400)

    const feature = db
      .prepare(
        'SELECT * FROM face_features WHERE photo_id = ? AND user_id = ? ORDER BY created_at DESC',
      )
      .get(photoId, req.user.id)

    if (!feature) {
      return sendError(res, '分析结果不存在', 404)
    }

    return sendSuccess(res, { feature })
  } catch (err) {
    console.error('[分析] 获取面部分析结果失败:', err)
    return sendError(res, '获取分析结果失败', 500)
  }
})

/** 校验数值参数，返回安全值或 null */
function safeNum(val, min, max) {
  const n = parseFloat(val)
  if (isNaN(n)) return null
  if (min !== undefined && n < min) return null
  if (max !== undefined && n > max) return null
  return n
}

/** 提交身体指标 */
router.post('/body', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const {
      height_cm,
      weight_kg,
      body_type,
      shoulder_width_cm,
      waist_cm,
      hip_cm,
      leg_length_ratio,
      bust_cm,
      neck_length,
    } = req.body || {}

    // 校验数值范围
    const safeHeight = safeNum(height_cm, 50, 300)
    const safeWeight = safeNum(weight_kg, 20, 500)
    const safeShoulder = safeNum(shoulder_width_cm, 20, 100)
    const safeWaist = safeNum(waist_cm, 30, 200)
    const safeHip = safeNum(hip_cm, 30, 200)
    const safeBust = safeNum(bust_cm, 30, 200)
    const safeNeck = safeNum(neck_length, 3, 30)
    const safeLegRatio = safeNum(leg_length_ratio, 0.3, 0.8)

    const existing = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(userId)
    if (existing) {
      db.prepare(
        `UPDATE body_metrics SET
        height_cm=?, weight_kg=?, body_type=?, shoulder_width_cm=?,
        waist_cm=?, hip_cm=?, leg_length_ratio=?, bust_cm=?, neck_length=?,
        updated_at=datetime('now') WHERE user_id=?`,
      ).run(
        safeHeight,
        safeWeight,
        body_type,
        safeShoulder,
        safeWaist,
        safeHip,
        safeLegRatio,
        safeBust,
        safeNeck,
        userId,
      )
    } else {
      db.prepare(
        `INSERT INTO body_metrics
        (user_id, height_cm, weight_kg, body_type, shoulder_width_cm,
         waist_cm, hip_cm, leg_length_ratio, bust_cm, neck_length)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        safeHeight,
        safeWeight,
        body_type,
        safeShoulder,
        safeWaist,
        safeHip,
        safeLegRatio,
        safeBust,
        safeNeck,
      )
    }

    return sendSuccess(res, {
      height_cm: safeHeight,
      weight_kg: safeWeight,
      body_type,
      shoulder_width_cm: safeShoulder,
      waist_cm: safeWaist,
      hip_cm: safeHip,
      leg_length_ratio: safeLegRatio,
      bust_cm: safeBust,
      neck_length: safeNeck,
    })
  } catch (err) {
    console.error('[分析] 保存身体指标失败:', err)
    return sendError(res, '保存失败', 500)
  }
})

/** 获取身体指标 */
router.get('/body', loginRequired, (req, res) => {
  try {
    const metric = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(req.user.id)
    return sendSuccess(res, { metric: metric || null })
  } catch (err) {
    console.error('[分析] 获取身体指标失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

module.exports = router
