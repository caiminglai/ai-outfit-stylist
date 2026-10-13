/**
 * 推荐历史路由模块
 * ============================================================
 * 10-12 第二十七轮改读 `recommendation_logs`。
 *
 * 原来这三条 CRUD 全打在 `recommendations` 上，而那张表：
 *   - 全仓零写入方（grep 只有本文件在读它）；
 *   - 本机库与服务器库现量都是 **0 行**；
 *   - 真正记推荐次数的是 `recommendation_logs`（由 services/profileArchive.js 写入，
 *     本机现量 30 行）。
 * 也就是说 `/api/history` 从写下起就只会回空数组——它不是"暂时没数据"，是接错了表。
 * 前端 `/history` 路由目前是 `<Navigate to="/" replace />`，页面进不来这里，
 * 所以这次只把接口本身接对，不动前端，也不删那张空表（删表属于库结构变更，另议）。
 *
 * 响应形状保持不变（history[].id / scenario / result_json / created_at），
 * 用 SQL 别名把 logs 的列名对上，免得以后有人按旧键读读到 undefined。
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { parsePagination, asId } = require('../utils/common')

const router = express.Router()

/** logs 里没有"照片"这一维，用 NULL 占位；scenario 用 mode（personal/store）顶 */
const SELECT_COLS = `id, user_id, NULL AS photo_id, mode AS scenario, result AS result_json, created_at`

/**
 * user_id 之外还带 session_id：游客的推荐记录只挂在 session_id 上（logs.user_id 可空），
 * 但本路由过的是 loginRequired，req.user 一定存在 ⇒ 只按 user_id 过滤即可，
 * 不给跨账号读别人记录的口子。
 */
router.get('/', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const { page, limit, offset, paginated } = parsePagination(req.query)

    if (paginated) {
      const total = db
        .prepare('SELECT COUNT(*) as c FROM recommendation_logs WHERE user_id = ?')
        .get(userId).c
      const history = db
        .prepare(
          `SELECT ${SELECT_COLS}
         FROM recommendation_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, limit, offset)
      return sendSuccess(res, { history, total, page, limit })
    }

    const history = db
      .prepare(
        `SELECT ${SELECT_COLS}
       FROM recommendation_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
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
    const historyId = asId(req.params.id)
    if (historyId === null) return sendError(res, 'id 必须是正整数', 400)
    const userId = req.user.id

    // 详情必须和列表走同一份 SELECT_COLS：原来这里写 `SELECT *`，回的是 logs 的原始列名
    // （mode／result），列表那边给的是别名（scenario／result_json）⇒ 同一个 id 在两个接口
    // 拿到的键不一样，前端按 result_json 读详情就是 undefined；顺带也不再把手里的
    // session_id、profile 快照这些前端不需要的列一并发出去。
    const record = db
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM recommendation_logs WHERE id = ? AND user_id = ?`,
      )
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

/** 删除单条历史记录（只删自己的那一行） */
router.delete('/:id', loginRequired, (req, res) => {
  try {
    const historyId = asId(req.params.id)
    if (historyId === null) return sendError(res, 'id 必须是正整数', 400)
    const userId = req.user.id

    const record = db
      .prepare('SELECT id FROM recommendation_logs WHERE id = ? AND user_id = ?')
      .get(historyId, userId)

    if (!record) {
      return sendError(res, '记录不存在', 404)
    }

    db.prepare('DELETE FROM recommendation_logs WHERE id = ? AND user_id = ?').run(
      historyId,
      userId,
    )
    return sendSuccess(res, null)
  } catch (err) {
    console.error('[历史] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
