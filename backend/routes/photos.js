/**
 * 照片路由模块
 * 对应 Python: app/routes/photos.py
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR, parsePagination, asId } = require('../utils/common')
const { loginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')

const router = express.Router()

// 上传限流：每分钟最多 10 次（与 clothing.js:17 同口径）
// 全仓四个上传口里只有本文件此前没有独立闸门：payment/creator/clothing 都有。
// 10MB 的图落盘走的是这条，光靠全局 100/15min 兜不住，认证后的脚本能把它打满。
const uploadLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '上传过于频繁，请稍后再试',
})

/**
 * photos.type 的已知取值（admin-utils.js:87 的中文标签表与 schema 默认值对齐）
 * 只收这几个：库里此前只有 'tryon'，前端没有任何地方调本接口，
 * 所以按枚举收紧不会打到现存客户端，却能挡住「把一个对象绑进 SQLite ⇒ 500」。
 */
const PHOTO_TYPES = ['face', 'body', 'cloth', 'tryon']

/** 上传照片 */
router.post('/', loginRequired, uploadLimiter, upload.single('photo'), (req, res) => {
  try {
    const validation = validateImage(req.file)
    if (!validation.valid) {
      return sendError(res, validation.error, 400)
    }

    // type 没传就是 schema 默认的 'face'；传了但不是上面那几个（包括对象/数组/空串）
    // 一律 400 说清楚，别让脏值进库变成后台显示不出来、也删不掉的分类
    const rawType = req.body?.type
    const type =
      rawType === undefined || rawType === null || rawType === ''
        ? 'face'
        : typeof rawType === 'string' && PHOTO_TYPES.includes(rawType.trim())
          ? rawType.trim()
          : null
    if (type === null) return sendError(res, `type 只能是 ${PHOTO_TYPES.join(' / ')}`, 400)
    const userId = req.user.id

    // 保存文件
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)
    fs.writeFileSync(filepath, req.file.buffer)

    // 保存记录
    const imageUrl = `/uploads/${filename}`
    let result
    try {
      result = db
        .prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
        .run(userId, imageUrl, type)
    } catch (err) {
      // 图已落盘但行没写成 ⇒ 立刻把文件删掉，别留对不上账的孤儿文件
      try {
        fs.unlinkSync(filepath)
      } catch {
        /* 删不掉只是文件残留，不改变这条本就要回的 500 */
      }
      throw err
    }

    return sendCreated(
      res,
      {
        id: result.lastInsertRowid,
        url: imageUrl,
        type,
      },
      null,
      '照片上传成功',
    )
  } catch (err) {
    logErr('[照片] 上传失败:', err)
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
    logErr('[照片] 获取列表失败:', err)
    return sendError(res, '获取列表失败', 500)
  }
})

/** 删除照片 */
router.delete('/:id', loginRequired, (req, res) => {
  try {
    const photoId = asId(req.params.id)
    if (photoId === null) return sendError(res, 'id 必须是正整数', 400)
    const userId = req.user.id

    const photo = db
      .prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?')
      .get(photoId, userId)
    if (!photo) {
      return sendError(res, '照片不存在或不属于当前用户', 404)
    }

    // 先删行、后删文件（原来反着写）。
    // `unlinkSync` 成功、紧接的 `DELETE` 抛异常 ⇒ 回 500 但库里那行还在，
    // url 指向的文件已经没了：列表页每张图都是坏链，用户再点删除也删不掉，
    // 只能重启进程碰运气。反过来（行没了、文件没删成）最多多留一个孤儿文件，
    // 而且它会在下面这条 error 日志里被点名，状态至少是自洽的。
    //
    // 三张表的 photo_id 外键引用 photos(id)（schema.sql:44/138/148），而 db/init.js:44 开着
    // `PRAGMA foreign_keys = ON` ⇒ 不清子行就 DELETE 必抛 FOREIGN KEY constraint failed，
    // 于是"分析过／推荐过／试穿过"的照片在页面上永远删不掉（每点一次 500）。
    // face_features.photo_id 是 NOT NULL，只能连行一起删（它本来就是这张照片的分析结果）；
    // recommendations／tryon_results 的 photo_id 可空 ⇒ 只断引用，历史行留着。
    // 一个事务：要么"子行处理完＋照片删掉"，要么整笔不动。
    const deleteWithDependents = db.transaction(() => {
      db.prepare('DELETE FROM face_features WHERE photo_id = ?').run(photoId)
      db.prepare('UPDATE recommendations SET photo_id = NULL WHERE photo_id = ?').run(photoId)
      db.prepare('UPDATE tryon_results SET photo_id = NULL WHERE photo_id = ?').run(photoId)
      return db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?').run(photoId, req.user.id)
    })
    const info = deleteWithDependents()
    if (info.changes === 0) {
      // 并发下另一次请求已经删掉了这行：不算错误，幂等返回成功
      return sendSuccess(res, null)
    }

    // 删除物理文件：失败只记日志，不能把已经成功的删除动作回吐成 500
    // url 列可空（schema.sql:35）：`path.basename(null)` 自己就抛 TypeError，
    // 那会让"库里已经删干净"的这次请求回成 500，前端显示删除失败。
    const filepath =
      typeof photo.url === 'string' && photo.url
        ? path.join(UPLOAD_DIR, path.basename(photo.url))
        : null
    try {
      if (filepath && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } catch (err) {
      logErr('[照片] 数据库记录已删除，但物理文件没删掉，需要人工清理:', filepath, err.message)
    }

    return sendSuccess(res, null)
  } catch (err) {
    logErr('[照片] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
