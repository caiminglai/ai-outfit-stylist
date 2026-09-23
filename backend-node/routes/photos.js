/**
 * 照片路由模块
 * 对应 Python: app/routes/photos.py
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR, parsePagination } = require('../utils/common')
const { loginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')

const router = express.Router()

/** 上传照片 */
router.post('/', loginRequired, upload.single('photo'), (req, res) => {
  try {
    const validation = validateImage(req.file)
    if (!validation.valid) {
      return sendError(res, validation.error, 400)
    }

    const { type = 'face' } = req.body || {}
    const userId = req.user.id

    // 保存文件
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)
    fs.writeFileSync(filepath, req.file.buffer)

    // 保存记录
    const imageUrl = `/uploads/${filename}`
    const result = db
      .prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
      .run(userId, imageUrl, type)

    return sendSuccess(
      res,
      {
        id: result.lastInsertRowid,
        url: imageUrl,
        type,
      },
      '照片上传成功',
    )
  } catch (err) {
    console.error('[照片] 上传失败:', err)
    return sendError(res, '上传失败', 500)
  }
})

/** 获取用户照片列表 */
router.get('/', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const { page, limit, offset, paginated } = parsePagination(req.query)

    if (paginated) {
      const total = db.prepare('SELECT COUNT(*) as c FROM photos WHERE user_id = ?').get(userId).c
      const photos = db
        .prepare(
          'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        )
        .all(userId, limit, offset)
      return sendSuccess(res, { photos, total, page, limit })
    }

    const photos = db
      .prepare('SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC')
      .all(userId)

    return sendSuccess(res, { photos })
  } catch (err) {
    console.error('[照片] 获取列表失败:', err)
    return sendError(res, '获取列表失败', 500)
  }
})

/** 删除照片 */
router.delete('/:id', loginRequired, (req, res) => {
  try {
    const photoId = parseInt(req.params.id, 10)
    const userId = req.user.id

    const photo = db
      .prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?')
      .get(photoId, userId)
    if (!photo) {
      return sendError(res, '照片不存在或不属于当前用户', 404)
    }

    // 删除物理文件
    const filepath = path.join(UPLOAD_DIR, path.basename(photo.url))
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }

    // 删除数据库记录
    db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?').run(photoId, req.user.id)

    return sendSuccess(res, null)
  } catch (err) {
    console.error('[照片] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
