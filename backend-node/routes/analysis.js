/**
 * 面容/身体分析路由模块
 * 对应 Python: app/routes/analysis.py
 */
const express = require('express')
const fs = require('fs')
const path = require('path')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
const { loadArchive, loadTags } = require('../services/profileArchive')
const { clearFeedback } = require('../services/ruleFeedback')
const { UPLOAD_DIR } = require('../utils/common')

const router = express.Router()

// AI 分析类端点限流：每分钟最多 5 次（消耗 DashScope 额度）
const aiLimiter = rateLimit({ windowMs: 60000, max: 5, message: '分析请求过于频繁，请稍后再试' })

/** 提交面部分析（能力未开放） */
router.post('/face', loginRequired, aiLimiter, (_req, res) => {
  return sendError(
    res,
    '照片自动识别肤色/脸型尚未开放，请在表单中选择肤色与脸型',
    501,
  )
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

/** 获取长期档案（身体 + 面容 + 已算出的标签，字段名与推荐表单一致，供前端预填） */
router.get('/archive', loginRequired, (req, res) => {
  try {
    return sendSuccess(res, {
      profile: loadArchive(req.user.id),
      tags: loadTags(req.user.id),
    })
  } catch (err) {
    console.error('[分析] 获取长期档案失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 删除我的全部数据：档案 + 标签 + 反馈 + 样本 + 照片 + 试穿结果（含磁盘文件），一并清掉 */
router.delete('/archive', loginRequired, (req, res) => {
  try {
    const userId = req.user.id

    // 文件清单必须在删行之前取：行一旦删掉就再也不知道文件叫什么
    const fileUrls = [
      ...db.prepare('SELECT url FROM photos WHERE user_id = ?').all(userId),
      ...db.prepare('SELECT result_url AS url FROM tryon_results WHERE user_id = ?').all(userId),
    ]
      .map((row) => row.url)
      .filter((url) => typeof url === 'string' && url.startsWith('/uploads/'))

    const delBody = db.prepare('DELETE FROM body_metrics WHERE user_id = ?')
    const delFace = db.prepare('DELETE FROM face_profiles WHERE user_id = ?')
    const delTags = db.prepare('DELETE FROM profile_tags WHERE user_id = ?')
    const delLogs = db.prepare('DELETE FROM recommendation_logs WHERE user_id = ?')
    const delRecords = db.prepare('DELETE FROM recommendations WHERE user_id = ?')
    const delTryon = db.prepare('DELETE FROM tryon_results WHERE user_id = ?')
    const delPhotos = db.prepare('DELETE FROM photos WHERE user_id = ?')
    const removed = db.transaction(() => ({
      body: delBody.run(userId).changes,
      face: delFace.run(userId).changes,
      tags: delTags.run(userId).changes,
      // 反馈要连带把规则的计数改回来，不能只删行
      feedback: clearFeedback(userId),
      logs: delLogs.run(userId).changes,
      // recommendations 与 tryon_results 都外键引用 photos，删除必须排在清照片之前
      records: delRecords.run(userId).changes,
      tryon: delTryon.run(userId).changes,
      photos: delPhotos.run(userId).changes,
    }))()

    // 磁盘文件放在事务之后：删掉的文件回滚不了，先保证库里的账对上
    let files = 0
    let filesFailed = 0
    for (const url of fileUrls) {
      const filepath = path.join(UPLOAD_DIR, path.basename(url))
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
          files += 1
        }
      } catch (err) {
        filesFailed += 1
        console.warn('[档案] 删除照片文件失败:', err.message)
      }
    }

    return sendSuccess(
      res,
      filesFailed > 0 ? { ...removed, files, files_failed: filesFailed } : { ...removed, files },
      '您的档案与相关记录已删除',
    )
  } catch (err) {
    console.error('[分析] 删除长期档案失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
