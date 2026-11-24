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
const { registerUpload, isValidFilename } = require('../utils/uploads')
const { rateLimit } = require('../middleware/rateLimit')
const dashscope = require('../services/dashscopeService')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr, warn: logWarn } = require('../utils/logger')

const router = express.Router()

// 试穿限流：每分钟最多 5 次
const tryonLimiter = rateLimit({ windowMs: 60000, max: 5, message: '试穿请求过于频繁，请稍后再试' })
const { generateUUID, UPLOAD_DIR, asText, asId } = require('../utils/common')

/**
 * 直接虚拟试穿（需有效游客或会员会话，使用 FormData）
 * 前端 api.ts directTryon 发送：
 *   FormData { person_image: File, garment_image: File, category: string }
 */
router.post(
  '/direct',
  loginRequired,
  tryonLimiter,
  upload.fields([
    { name: 'person_image', maxCount: 1 },
    { name: 'garment_image', maxCount: 1 },
  ]),
  async (req, res) => {
    // 先记录本轮准备写的路径；即使 writeFileSync 只写出半截后抛错，也能进入 finally 清理。
    const writtenFiles = []
    let saved = false
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

      // category 只当短文本回显：对象/数组过 asText 变 ''，落回默认 'top'，
      // 免得把 [object Object] 一样的形状原样带回响应
      const category = asText(req.body?.category).slice(0, 40) || 'top'

      // loginRequired 已确认可归属用户，之后才允许写盘。
      const user = req.user
      const personExt = path.extname(personFile.originalname).toLowerCase()
      const garmentExt = path.extname(garmentFile.originalname).toLowerCase()
      const personFilename = `${generateUUID()}${personExt}`
      const garmentFilename = `${generateUUID()}${garmentExt}`
      const personPath = path.join(UPLOAD_DIR, personFilename)
      const garmentPath = path.join(UPLOAD_DIR, garmentFilename)

      writtenFiles.push(personPath)
      fs.writeFileSync(personPath, personFile.buffer)
      writtenFiles.push(garmentPath)
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
        logWarn('[试穿] DashScope 服务不可用，使用降级模式:', e.message)
      }

      // 降级模式：返回人物照片作为结果
      // 注意 virtualTryon 在未配置 API Key 时不报错，而是原样返回人物图，
      // 所以"结果等于原图"也必须算降级，否则会把原图说成试穿成功
      if (!resultUrl || resultUrl === personUrl) {
        resultUrl = personUrl
        degraded = true
      }

      // 三条写要么全成要么全不成都回滚：照片、服装照片、所有权台账和结果必须一致。
      const writeTryon = db.transaction(() => {
        const insertPhoto = db.prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
        const personPhoto = insertPhoto.run(user.id, personUrl, 'tryon')
        insertPhoto.run(user.id, garmentUrl, 'tryon')
        registerUpload(personFilename, user.id)
        registerUpload(garmentFilename, user.id)
        const resultFilename = resultUrl.startsWith('/uploads/') ? path.basename(resultUrl) : null
        if (resultFilename && isValidFilename(resultFilename)) {
          registerUpload(resultFilename, user.id)
        }
        db.prepare(
          `INSERT INTO tryon_results (user_id, photo_id, result_url, status)
           VALUES (?, ?, ?, ?)`,
        ).run(user.id, personPhoto.lastInsertRowid, resultUrl, degraded ? 'degraded' : 'done')
      })
      writeTryon()
      saved = true

      return sendSuccess(
        res,
        {
          result_url: resultUrl,
          category: category,
          person_image: personUrl,
          garment_image: garmentUrl,
          degraded,
          saved,
        },
        degraded ? '未接入试穿模型，返回的是你的原图' : '虚拟试穿完成',
      )
    } catch (err) {
      logErr('[试穿] 直接试穿失败:', err)
      return sendError(res, '试穿失败，上传文件未保存', 500)
    } finally {
      if (!saved) {
        for (const filepath of writtenFiles) {
          try {
            fs.unlinkSync(filepath)
          } catch (err) {
            if (err.code !== 'ENOENT') logErr('[试穿] 清理未入账文件失败:', filepath, err.message)
          }
        }
      }
    }
  },
)

/**
 * 异步试穿任务（未开通）
 * 与 POST /api/analysis/face 同一口径：功能没实现就别回 200 假装排队中。
 */
router.post('/', loginRequired, (_req, res) => {
  return sendError(res, '异步试穿任务尚未开通，请直接使用 /api/tryon/direct 上传照片试穿', 501)
})

/** 获取试穿结果 */
router.get('/:id', loginRequired, (req, res) => {
  try {
    // 路径 id 必须逐字符是数字：parseInt('12abc',10) 得 12，
    // 一条写错的 URL 会把 #12 那份结果当成自己要的那份回出去（同一用户，不是越权，
    // 但取到的是另一条记录）；'abc' 得 NaN，绑进 SQL 后查无行 ⇒ 该 400 的回了 404。
    if (!/^\d+$/.test(String(req.params.id))) return sendError(res, '无效的ID', 400)
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const result = db
      .prepare('SELECT * FROM tryon_results WHERE id = ? AND user_id = ?')
      .get(id, req.user.id)

    if (!result) {
      return sendError(res, '试穿结果不存在', 404)
    }

    return sendSuccess(res, { result })
  } catch (err) {
    logErr('[试穿] 结果读取失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

module.exports = router
