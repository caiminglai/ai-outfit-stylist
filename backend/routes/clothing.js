/**
 * 衣服照片上传与识别路由模块
 * 对应 Python: app/routes/clothing.py
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR, parsePagination, asText, asId } = require('../utils/common')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')

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

    // 整条 /api/clothing 挂在 loginRequired 后面(server.js:336),走到这儿 req.user 必然已解析出来。
    // 老代码只认 req.headers['x-session-id']、读不到就 generateUUID():
    // 用 body.session_id 认证进来的客户端(header 空、req.user 有)会把图挂到一个随机 UUID 下,
    // 既列不出、删不掉,也不会被"删除我的数据"清(那条按 req.user.session_id 收)⇒ 永久孤儿行。
    const sessionId = req.user.session_id
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)
    fs.writeFileSync(filepath, req.file.buffer)

    const imageUrl = `/uploads/${filename}`
    // category 只当短文本收:非字符串(asText ⇒ '')或超长一律落 null,
    // 免得把对象/数组一路带进绑参,也避免响应里的 semantics 跟着变形状
    const category = asText(req.body?.category).slice(0, 40) || null
    // 名字原来只回填进响应的 semantics.item_name，不进库：schema.sql:166 与线上表都有
    // item_name 这一列（10-13 现量 PRAGMA：11 列，含 item_name TEXT），可 INSERT 没带它。
    // 后果是上传那一屏显示"衬衫"，回到列表就读回 null——顾客填的名字当场丢。
    const itemName = asText(req.body?.name).slice(0, 40) || null
    let result
    try {
      result = db
        .prepare(
          'INSERT INTO clothing_items (session_id, filename, image_url, category, item_name) VALUES (?, ?, ?, ?, ?)',
        )
        .run(sessionId, filename, imageUrl, category, itemName)
    } catch (err) {
      // 图已落盘但行没写成 ⇒ 立刻把文件删掉,别留对不上账的孤儿文件
      try {
        fs.unlinkSync(filepath)
      } catch {
        /* 删不掉只是文件残留,不改变这条本就要回的 500 */
      }
      throw err
    }

    return sendCreated(
      res,
      {
        clothing_id: result.lastInsertRowid,
        filename: filename,
        image_url: imageUrl,
        semantics: {
          category: category || '未分类',
          color: '未知',
          style: [],
          season: [],
          usage: [],
          item_name: itemName || '未命名',
        },
      },
      null,
      '衣服照片上传成功',
    )
  } catch (err) {
    logErr('[衣服] 上传失败:', err)
    return sendError(res, '上传失败', 500)
  }
})

/** 获取用户衣服列表（GET /list 和 GET / 共用） */
function handleList(req, res) {
  try {
    // 与上传同一把尺子:req.user 由 loginRequired 兜底,不再各读各的 header
    const sessionId = req.user.session_id

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
    logErr('[衣服] 获取列表失败:', err)
    return sendError(res, '获取失败', 500)
  }
}

router.get('/list', handleList)
router.get('/', handleList)

/** 删除衣服记录 */
router.delete('/:id', (req, res) => {
  try {
    // 路径 id 必须逐字符是数字：parseInt('12abc') 得 12，
    // 一条写错的 URL 会真删掉第 12 行、并把那张图从磁盘 unlink（属主仍是自己，所以不是越权，
    // 但"删 12abc"删掉的是另一件衣服，且删不回）。该 400 的必须当场 400。
    if (!/^\d+$/.test(String(req.params.id))) return sendError(res, '无效的ID', 400)
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    // 认证已由 loginRequired 兜住,这里只认这个人自己的 session,不再依赖 header 是否带上
    const sessionId = req.user.session_id

    const item = db
      .prepare('SELECT * FROM clothing_items WHERE id = ? AND session_id = ?')
      .get(id, sessionId)

    if (!item) {
      return sendError(res, '记录不存在', 404)
    }

    // 与 photos.js 同一条顺序修正：先删行确认成功，再删物理文件。
    // 原来先 `unlinkSync` 后 `DELETE` ⇒ DELETE 一旦抛异常，库里这行还在、
    // 图已经没了，列表页这张图永远坏链，用户重复点删除也修不回来。
    // 文件删除失败只记日志（留一个可人工清理的孤儿文件），不回吐 500。
    const info = db
      .prepare('DELETE FROM clothing_items WHERE id = ? AND session_id = ?')
      .run(id, sessionId)
    if (info.changes === 0) return sendSuccess(res, { deleted: true })

    const filepath = path.join(UPLOAD_DIR, path.basename(item.image_url || ''))
    try {
      if (item.image_url && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    } catch (err) {
      logErr('[衣服] 数据库记录已删除，但物理文件没删掉，需要人工清理:', filepath, err.message)
    }

    return sendSuccess(res, { deleted: true })
  } catch (err) {
    logErr('[衣服] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
