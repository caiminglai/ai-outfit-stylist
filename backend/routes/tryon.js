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
const { loginRequired, optionalUser } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
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

      // category 只当短文本回显：对象/数组过 asText 变 ''，落回默认 'top'，
      // 免得把 [object Object] 一样的形状原样带回响应
      const category = asText(req.body?.category).slice(0, 40) || 'top'

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
        logWarn('[试穿] DashScope 服务不可用，使用降级模式:', e.message)
      }

      // 降级模式：返回人物照片作为结果
      // 注意 virtualTryon 在未配置 API Key 时不报错，而是原样返回人物图，
      // 所以"结果等于原图"也必须算降级，否则会把原图说成试穿成功
      if (!resultUrl || resultUrl === personUrl) {
        resultUrl = personUrl
        degraded = true
      }

      // 保存试穿结果到数据库
      // 线上这张表的 user_id / photo_id 都是 NOT NULL(实测 PRAGMA table_info,与 schema.sql 的宽松声明不一致,
      // 而 CREATE TABLE IF NOT EXISTS 不会改动已存在的表),所以 photo_id 只能写真实值:
      // 先按 /api/photos 同一套写法把两张上传图都登记成 photos 记录,再让结果引用人物那张。
      // 服装图也必须登记,不登记就成了「删除我的数据」清不掉的孤儿文件。
      // 没有可归属身份的请求(不带 X-Session-Id)跳过落库——图已经返回了,但不假装存住了。
      const user = optionalUser(req)
      // 默认 false：没有可归属身份就确实没落库。原来初始化成 true，匿名请求走的正是
      // "文件已落盘、落库整段跳过"这条路，响应却回 saved:true ⇒ 谎报已入账，
      // 那两张图成了"删除我的数据"按 user/session 够不到的永久孤儿文件。
      let saved = false
      if (user) {
        try {
          // 三条写要么全成要么全不成都回滚：老代码逐条 run，中途炸了会留下
          // 「人物照片有行、服装照片/结果行没有」的半截账，比一行都没有更难对
          const writeTryon = db.transaction(() => {
            const insertPhoto = db.prepare(
              'INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)',
            )
            const personPhoto = insertPhoto.run(user.id, personUrl, 'tryon')
            insertPhoto.run(user.id, garmentUrl, 'tryon')
            db.prepare(
              `INSERT INTO tryon_results (user_id, photo_id, result_url, status)
             VALUES (?, ?, ?, ?)`,
            ).run(user.id, personPhoto.lastInsertRowid, resultUrl, degraded ? 'degraded' : 'done')
          })
          writeTryon()
          saved = true
        } catch (e) {
          // 不回滚到 500：图已经生成好了、链接就在本次响应里，删文件等于把用户刚拿到的结果毁掉。
          // 但要打成 error 并把 saved 如实带回响应，别让它继续是一条没人看的 warn
          saved = false
          logErr('[试穿] 结果落库失败(文件已返回但未入账):', e.message)
        }
      }

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
      return sendError(res, '试穿失败', 500)
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
    return sendError(res, '获取失败', 500)
  }
})

module.exports = router
