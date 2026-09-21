/**
 * 虚拟试穿路由模块
 * 对应 Python: app/routes/tryon.py
 *
 * 端点：
 * - POST /tryon/direct  直接试穿（FormData: person_image, garment_image, category）
 * - POST /tryon/        提交试穿（需登录，JSON）
 * - GET  /tryon/:id     获取试穿结果
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')
const dashscope = require('../services/dashscopeService')

const router = express.Router()

// 试穿限流：每分钟最多 5 次
const tryonLimiter = rateLimit({ windowMs: 60000, max: 5, message: '试穿请求过于频繁，请稍后再试' })
const { generateUUID, UPLOAD_DIR } = require('../utils/common')

/**
 * 直接虚拟试穿（无需登录，使用 FormData）
 * 前端 api.ts directTryon 发送：
 *   FormData { person_image: File, garment_image: File, category: string }
 */
router.post(
  '/direct',
  tryonLimiter,
  upload.fields([
    { name: 'person_image', maxCount: 1 },
    { name: 'garment_image', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const personFile = req.files?.person_image?.[0]
      const garmentFile = req.files?.garment_image?.[0]

      if (!personFile) return sendError(res, '缺少 person_image 人物照片', 400)
      if (!garmentFile) return sendError(res, '缺少 garment_image 服装照片', 400)

      // 校验图片
      const personValid = validateImage(personFile)
      if (!personValid.valid) return sendError(res, `人物照片: ${personValid.error}`, 400)
      const garmentValid = validateImage(garmentFile)
      if (!garmentValid.valid) return sendError(res, `服装照片: ${garmentValid.error}`, 400)

      const category = req.body?.category || 'top'

      // 保存上传的图片
      const personExt = path.extname(personFile.originalname).toLowerCase()
      const garmentExt = path.extname(garmentFile.originalname).toLowerCase()
      const personFilename = `${generateUUID()}${personExt}`
      const garmentFilename = `${generateUUID()}${garmentExt}`
      const personPath = path.join(UPLOAD_DIR, personFilename)
      const garmentPath = path.join(UPLOAD_DIR, garmentFilename)

      fs.writeFileSync(personPath, personFile.buffer)
      fs.writeFileSync(garmentPath, garmentFile.buffer)

      const personUrl = `/uploads/${personFilename}`
      const garmentUrl = `/uploads/${garmentFilename}`

      // 尝试调用 DashScope 虚拟试穿服务
      let resultUrl = null
      let degraded = false
      try {
        if (typeof dashscope.virtualTryon === 'function') {
          resultUrl = await dashscope.virtualTryon(personUrl, garmentUrl)
        }
      } catch (e) {
        console.warn('[试穿] DashScope 服务不可用，使用降级模式:', e.message)
      }

      // 降级模式：返回人物照片作为结果
      if (!resultUrl) {
        resultUrl = personUrl
        degraded = true
      }

      // 保存试穿结果到数据库
      let resultId = null
      try {
        const result = db
          .prepare(
            `INSERT INTO tryon_results (user_id, photo_id, result_url, status)
         VALUES (?, ?, ?, ?)`,
          )
          .run(0, 0, resultUrl, 'done')
        resultId = result.lastInsertRowid
      } catch {
        // tryon_results 表可能不存在，不影响主流程
      }

      return sendSuccess(
        res,
        {
          result_url: resultUrl,
          category: category,
          person_image: personUrl,
          garment_image: garmentUrl,
          degraded,
        },
        '虚拟试穿完成',
      )
    } catch (err) {
      console.error('[试穿] 直接试穿失败:', err)
      return sendError(res, '试穿失败', 500)
    }
  },
)

/** 提交虚拟试穿（需登录） */
router.post('/', loginRequired, (req, res) => {
  // TODO: 调用 DashScope 虚拟试穿 API
  return sendSuccess(res, { status: 'pending' })
})

/** 获取试穿结果 */
router.get('/:id', loginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const result = db
      .prepare('SELECT * FROM tryon_results WHERE id = ? AND user_id = ?')
      .get(id, req.user.id)

    if (!result) {
      return sendError(res, '试穿结果不存在', 404)
    }

    return sendSuccess(res, { result })
  } catch (err) {
    return sendError(res, '获取失败', 500)
  }
})

module.exports = router
