/**
 * 创作者闭环路由模块
 *
 * 闭环链路：作者提交（搭配/化妆/规则）-> 后台审核 -> 通过后进入广场按热度曝光
 *          -> 作者拿自己的分享链接（?ref=）去站外拉流量 -> 平台按 share_views 计量。
 * 分成不在本模块：资金二次分配需要持牌分账通道，等通道和比例定下来再接，
 * 现在只把"该给谁结、结多少"的原始计数记下来。
 */
const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID, parsePagination, UPLOAD_DIR } = require('../utils/common')
const { loginRequired, adminLoginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

const WORK_TYPES = new Set(['outfit', 'makeup', 'rule'])
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected'])
const PAYLOAD_MAX_CHARS = 20000

const submitLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: '提交过于频繁，请稍后再试',
})

function newShareCode() {
  return crypto.randomBytes(4).toString('hex')
}

/** 广场列表：只出已通过的，精选优先、其次热度 */
router.get('/works', (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query)
    const where = ["status = 'approved'"]
    const params = []
    if (WORK_TYPES.has(req.query.type)) {
      where.push('type = ?')
      params.push(req.query.type)
    }
    const whereSql = where.join(' AND ')

    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM creator_works WHERE ${whereSql}`)
      .get(...params).c
    const rows = db
      .prepare(
        `SELECT id, share_code, type, title, summary, cover_url, heat, share_views, featured, user_id, created_at, reviewed_at
         FROM creator_works WHERE ${whereSql}
         ORDER BY featured DESC, heat DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)
    const authors = db
      .prepare(
        `SELECT id, nickname FROM users WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'})`,
      )
      .all(...rows.map((r) => r.user_id))
    const nameById = new Map(authors.map((a) => [a.id, a.nickname || '匿名作者']))

    return sendSuccess(res, {
      page,
      limit,
      total,
      items: rows.map((r) => ({ ...r, author_name: nameById.get(r.user_id) || '匿名作者' })),
    })
  } catch (err) {
    console.error('[创作者] 读取作品列表失败:', err)
    return sendError(res, '读取作品列表失败', 500)
  }
})

/** 作品详情：浏览量 +1，ref 等于作者分享码时另记分享带量 */
router.get('/works/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return sendError(res, 'ID 格式错误', 400)

    const row = db.prepare('SELECT * FROM creator_works WHERE id = ?').get(id)
    if (!row || row.status !== 'approved') {
      return sendError(res, '作品不存在或未通过审核', 404)
    }

    const ref = String(req.query.ref || '')
    const byShare = ref && ref === row.share_code ? 1 : 0
    db.prepare(
      'UPDATE creator_works SET heat = heat + 1, share_views = share_views + ? WHERE id = ?',
    ).run(byShare, id)

    const author = db.prepare('SELECT nickname FROM users WHERE id = ?').get(row.user_id)
    return sendSuccess(res, {
      ...row,
      payload: parsePayload(row.payload),
      heat: row.heat + 1,
      share_views: row.share_views + byShare,
      author_name: (author && author.nickname) || '匿名作者',
    })
  } catch (err) {
    console.error('[创作者] 读取作品详情失败:', err)
    return sendError(res, '读取作品详情失败', 500)
  }
})

function parsePayload(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** 提交作品（进入待审核） */
router.post('/works', loginRequired, submitLimiter, (req, res) => {
  try {
    const type = req.body?.type
    if (!WORK_TYPES.has(type)) {
      return sendError(res, 'type 只能是 outfit / makeup / rule', 400)
    }

    const title = String(req.body?.title || '').trim()
    if (!title || title.length > 40) {
      return sendError(res, '标题不能为空且不超过 40 字', 400)
    }
    const summary = String(req.body?.summary || '').trim().slice(0, 300)

    let payloadText = '{}'
    if (req.body?.payload !== undefined) {
      payloadText =
        typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload)
      if (payloadText.length > PAYLOAD_MAX_CHARS) {
        return sendError(res, `数据过大，最多 ${PAYLOAD_MAX_CHARS} 字符`, 400)
      }
      try {
        JSON.parse(payloadText)
      } catch {
        return sendError(res, '内容格式不正确，请重写一次', 400)
      }
    }

    const coverUrl = /^\/uploads\/[\w.-]+$/.test(String(req.body?.cover_url || ''))
      ? String(req.body.cover_url)
      : ''

    const result = db
      .prepare(
        `INSERT INTO creator_works (user_id, share_code, type, title, summary, cover_url, payload, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        req.user.id,
        newShareCode(),
        type,
        title,
        summary,
        coverUrl,
        payloadText,
      )

    return sendSuccess(
      res,
      { id: Number(result.lastInsertRowid), status: 'pending' },
      '已提交，等待审核',
    )
  } catch (err) {
    console.error('[创作者] 提交作品失败:', err)
    return sendError(res, '提交作品失败', 500)
  }
})

/** 上传作品封面 */
router.post('/cover', loginRequired, submitLimiter, upload.single('file'), (req, res) => {
  try {
    const validation = validateImage(req.file)
    if (!validation.valid) return sendError(res, validation.error, 400)

    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer)
    return sendSuccess(res, { url: `/uploads/${filename}` }, '封面已上传')
  } catch (err) {
    console.error('[创作者] 上传封面失败:', err)
    return sendError(res, '上传封面失败', 500)
  }
})

/** 我的提交（含未通过审核的）+ 流量汇总 */
router.get('/my', loginRequired, (req, res) => {
  try {
    const rows = db
      .prepare(
        'SELECT id, share_code, type, title, summary, cover_url, status, admin_note, heat, share_views, featured, created_at, reviewed_at FROM creator_works WHERE user_id = ? ORDER BY id DESC LIMIT 100',
      )
      .all(req.user.id)
    const totals = rows.reduce(
      (acc, r) => {
        acc.approved += r.status === 'approved' ? 1 : 0
        acc.pending += r.status === 'pending' ? 1 : 0
        acc.rejected += r.status === 'rejected' ? 1 : 0
        acc.heat += r.heat || 0
        acc.share_views += r.share_views || 0
        return acc
      },
      { approved: 0, pending: 0, rejected: 0, heat: 0, share_views: 0 },
    )
    return sendSuccess(res, { items: rows, totals })
  } catch (err) {
    console.error('[创作者] 读取我的作品失败:', err)
    return sendError(res, '读取我的作品失败', 500)
  }
})

// ============================================================
// 管理端
// ============================================================

/** 审核列表 */
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const allowed = ['pending', 'approved', 'rejected']
    let sql = `SELECT w.*, u.nickname, u.phone FROM creator_works w
      LEFT JOIN users u ON w.user_id = u.id`
    const params = []
    if (allowed.includes(req.query.status)) {
      sql += ' WHERE w.status = ?'
      params.push(req.query.status)
    }
    sql += ' ORDER BY w.id DESC LIMIT 200'
    return sendSuccess(res, db.prepare(sql).all(...params))
  } catch (err) {
    console.error('[创作者] 读取审核列表失败:', err)
    return sendError(res, '读取审核列表失败', 500)
  }
})

/** 审核：通过即上广场 */
router.post('/admin/:id/review', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return sendError(res, 'ID 格式错误', 400)
    const status = req.body?.status
    if (!REVIEW_STATUSES.has(status)) {
      return sendError(res, 'status 只能是 pending / approved / rejected', 400)
    }
    const adminNote = String(req.body?.admin_note || '').slice(0, 200)
    const result = db
      .prepare(
        'UPDATE creator_works SET status = ?, admin_note = ?, reviewed_at = datetime(\'now\') WHERE id = ?',
      )
      .run(status, adminNote, id)
    if (result.changes === 0) return sendError(res, '作品不存在', 404)
    return sendSuccess(res, { id, status }, '审核已保存')
  } catch (err) {
    console.error('[创作者] 审核失败:', err)
    return sendError(res, '审核失败', 500)
  }
})

/** 是否精选（广场排序的第一权重） */
router.post('/admin/:id/feature', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return sendError(res, 'ID 格式错误', 400)
    const featured = req.body?.featured ? 1 : 0
    const result = db
      .prepare('UPDATE creator_works SET featured = ? WHERE id = ?')
      .run(featured, id)
    if (result.changes === 0) return sendError(res, '作品不存在', 404)
    return sendSuccess(res, { id, featured }, featured ? '已设为精选' : '已取消精选')
  } catch (err) {
    console.error('[创作者] 精选设置失败:', err)
    return sendError(res, '精选设置失败', 500)
  }
})

module.exports = router
