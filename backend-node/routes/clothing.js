/**
 * 衣服照片上传与识别路由模块
 * 对应 Python: app/routes/clothing.py
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR, parsePagination } = require('../utils/common')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 上传限流：每分钟最多 10 次
const uploadLimiter = rateLimit({ windowMs: 60000, max: 10, message: '上传过于频繁，请稍后再试' })

/** 上传衣服照片 */
router.post('/upload', uploadLimiter, upload.single('file'), (req, res) => {
  try {
    const validation = validateImage(req.file)
    if (!validation.valid) {
      return sendError(res, validation.error, 400)
    }

    const sessionId = req.headers['x-session-id'] || generateUUID()
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)
    fs.writeFileSync(filepath, req.file.buffer)

    const imageUrl = `/uploads/${filename}`
    const result = db
      .prepare(
        'INSERT INTO clothing_items (session_id, filename, image_url, category) VALUES (?, ?, ?, ?)',
      )
      .run(sessionId, filename, imageUrl, req.body?.category || null)

    return sendSuccess(
      res,
      {
        clothing_id: result.lastInsertRowid,
        filename: filename,
        image_url: imageUrl,
        semantics: {
          category: req.body?.category || '未分类',
          color: '未知',
          style: [],
          season: [],
          usage: [],
          item_name: req.body?.name || '未命名',
        },
      },
      '衣服照片上传成功',
    )
  } catch (err) {
    console.error('[衣服] 上传失败:', err)
    return sendError(res, '上传失败', 500)
  }
})

/** 获取用户衣服列表（GET /list 和 GET / 共用） */
function handleList(req, res) {
  try {
    const sessionId = req.headers['x-session-id']
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 401)
    }

    const { page, limit, offset, paginated } = parsePagination(req.query)

    if (paginated) {
      const total = db
        .prepare('SELECT COUNT(*) as c FROM clothing_items WHERE session_id = ?')
        .get(sessionId).c
      const items = db
        .prepare(
          'SELECT * FROM clothing_items WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        )
        .all(sessionId, limit, offset)
      return sendSuccess(res, { items, total, page, limit })
    }

    const items = db
      .prepare('SELECT * FROM clothing_items WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId)

    return sendSuccess(res, { items })
  } catch (err) {
    console.error('[衣服] 获取列表失败:', err)
    return sendError(res, '获取失败', 500)
  }
}

router.get('/list', handleList)
router.get('/', handleList)

/** 删除衣服记录 */
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return sendError(res, '无效的ID', 400)
    const sessionId = req.headers['x-session-id']
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 401)
    }

    const item = db
      .prepare('SELECT * FROM clothing_items WHERE id = ? AND session_id = ?')
      .get(id, sessionId)

    if (!item) {
      return sendError(res, '记录不存在', 404)
    }

    const filepath = path.join(UPLOAD_DIR, path.basename(item.image_url))
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }

    db.prepare('DELETE FROM clothing_items WHERE id = ? AND session_id = ?').run(id, sessionId)
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[衣服] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
