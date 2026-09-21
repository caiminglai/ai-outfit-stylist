/**
 * 推荐历史路由模块
 * 对应 Python: app/routes/history.py
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { parsePagination } = require('../utils/common')

const router = express.Router()

/** 获取用户推荐历史 */
router.get('/', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const { page, limit, offset, paginated } = parsePagination(req.query)

    if (paginated) {
      const total = db
        .prepare('SELECT COUNT(*) as c FROM recommendations WHERE user_id = ?')
        .get(userId).c
      const history = db
        .prepare(
          `SELECT id, user_id, photo_id, scenario, result_json, created_at
         FROM recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, limit, offset)
      return sendSuccess(res, { history, total, page, limit })
    }

    const history = db
      .prepare(
        `SELECT id, user_id, photo_id, scenario, result_json, created_at
       FROM recommendations WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(userId)

    return sendSuccess(res, { history })
  } catch (err) {
    console.error('[历史] 获取失败:', err)
    return sendError(res, '获取历史记录失败', 500)
  }
})

/** 获取单条历史详情 */
router.get('/:id', loginRequired, (req, res) => {
  try {
    const historyId = parseInt(req.params.id, 10)
    const userId = req.user.id

    const record = db
      .prepare('SELECT * FROM recommendations WHERE id = ? AND user_id = ?')
      .get(historyId, userId)

    if (!record) {
      return sendError(res, '记录不存在', 404)
    }

    return sendSuccess(res, { record })
  } catch (err) {
    console.error('[历史] 获取详情失败:', err)
    return sendError(res, '获取记录详情失败', 500)
  }
})

/** 删除历史记录 */
router.delete('/:id', loginRequired, (req, res) => {
  try {
    const historyId = parseInt(req.params.id, 10)
    const userId = req.user.id

    const record = db
      .prepare('SELECT * FROM recommendations WHERE id = ? AND user_id = ?')
      .get(historyId, userId)

    if (!record) {
      return sendError(res, '记录不存在', 404)
    }

    db.prepare('DELETE FROM recommendations WHERE id = ? AND user_id = ?').run(
      historyId,
      req.user.id,
    )
    return sendSuccess(res, null)
  } catch (err) {
    console.error('[历史] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
