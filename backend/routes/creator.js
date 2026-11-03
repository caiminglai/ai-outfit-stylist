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
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { generateUUID, parsePagination, UPLOAD_DIR, asId } = require('../utils/common')
const { loginRequired, adminLoginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')

const router = express.Router()

const WORK_TYPES = new Set(['outfit', 'makeup', 'rule'])
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected'])
const PAYLOAD_MAX_CHARS = 20000

const submitLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: '提交过于频繁，请稍后再试',
})

// 浏览量：按"同一 IP × 同一作品"每分钟最多 3 次。
// 这条 POST 匿名可达、heat 又是广场排序的第一权重，原来只有全局 100/15min 兜着 ⇒ 脚本循环打就能把任意作品顶到榜首。
// key 里带上作品 id：一个人连着看好几件作品时不吃同一条额度，正常浏览不会被误锁。
const viewLimiter = rateLimit({
  windowMs: 60000,
  max: 3,
  keyFn: (req) => `${req.ip || 'unknown'}|${req.params?.id || ''}`,
  message: '该作品的浏览过于频繁，请稍后再试',
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
    logErr('[创作者] 读取作品列表失败:', err)
    return sendError(res, '读取作品列表失败', 500)
  }
})

/** 作品详情（只读）：计数写入挪到 POST /works/:id/view，GET 不再有感侧效果 */
router.get('/works/:id', (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)

    // 列必须点名列：这是匿名可达的公开详情，SELECT * 会把 admin_note（后台审核
    // 备注，常写作者违规原因）发出去。广场列表 :63 早就只点公开列，详情这里是唯一
    // 漏的那处。user_id 只用来查作者昵称，下发前剥掉。
    const row = db
      .prepare(
        `SELECT id, share_code, type, title, summary, cover_url, payload, status,
                featured, heat, share_views, created_at, reviewed_at, user_id
         FROM creator_works WHERE id = ?`,
      )
      .get(id)
    if (!row || row.status !== 'approved') {
      return sendError(res, '作品不存在或未通过审核', 404)
    }

    const author = db.prepare('SELECT nickname FROM users WHERE id = ?').get(row.user_id)
    delete row.user_id
    return sendSuccess(res, {
      ...row,
      payload: parsePayload(row.payload),
      author_name: (author && author.nickname) || '匿名作者',
    })
  } catch (err) {
    logErr('[创作者] 读取作品详情失败:', err)
    return sendError(res, '读取作品详情失败', 500)
  }
})

/**
 * 记录一次作品浏览：热度 +1，ref 等于作者分享码时另记分享带量。
 * 原来这段计数写在 GET /works/:id 里——GET 必须无副作用（预取/爬虫/重试都会
 * 把 heat 灌大，且违反 HTTP 幂等约定），所以挪成显式 POST。
 * 前端调用点已同步改口：app/public/creator.html 详情渲染成功后 POST 本路由，
 * GET 响应形状不变（heat/share_views 字段仍在，只是不再虚 +1）。
 */
router.post('/works/:id/view', viewLimiter, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)

    const row = db.prepare('SELECT id, share_code, status FROM creator_works WHERE id = ?').get(id)
    if (!row || row.status !== 'approved') {
      return sendError(res, '作品不存在或未通过审核', 404)
    }

    // ref 兼容查询串与请求体两种带法：POST 体是 JSON 的前端与拼 URL 的老页面都能用
    const ref = String(req.body?.ref ?? req.query.ref ?? '')
    const byShare = ref && ref === row.share_code ? 1 : 0
    db.prepare(
      'UPDATE creator_works SET heat = heat + 1, share_views = share_views + ? WHERE id = ?',
    ).run(byShare, id)

    const fresh = db.prepare('SELECT heat, share_views FROM creator_works WHERE id = ?').get(id)
    return sendSuccess(res, { id, heat: fresh.heat, share_views: fresh.share_views })
  } catch (err) {
    logErr('[创作者] 记录浏览失败:', err)
    return sendError(res, '记录浏览失败', 500)
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
    const summary = String(req.body?.summary || '')
      .trim()
      .slice(0, 300)

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
      .run(req.user.id, newShareCode(), type, title, summary, coverUrl, payloadText)

    return sendCreated(
      res,
      { id: Number(result.lastInsertRowid), status: 'pending' },
      // 不发 Location：这一条是 'pending'，公开的 GET /works/:id 只放审核过的作品，
      // 照 Location 去读实测 404「作品不存在或未通过审核」（test/createdStatus.test.js 钉着）。
      // 指不到地方的 Location 比不给更糟——作者自己要看进度走 GET /creator/my。
      null,
      '已提交，等待审核',
    )
  } catch (err) {
    logErr('[创作者] 提交作品失败:', err)
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
    logErr('[创作者] 上传封面失败:', err)
    return sendError(res, '上传封面失败', 500)
  }
})

/**
 * 我的提交（含未通过审核的）+ 流量汇总
 * 返回: { items, total, limit, totals }
 * totals 走一条独立的聚合，查的是这个人的全部作品，不再从被 LIMIT 截过的 items 现算：
 * 原来 items 只取最近 100 条，而页面把 totals 显示成「总浏览／分享带量」，
 * 提交超过 100 件的人看到的是一被截断的假总数；「N 提交」同样只能数到 100。
 */
const MY_LIST_LIMIT = 100
router.get('/my', loginRequired, (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, share_code, type, title, summary, cover_url, status, admin_note, heat, share_views, featured, created_at, reviewed_at
         FROM creator_works WHERE user_id = ? ORDER BY id DESC LIMIT ${MY_LIST_LIMIT}`,
      )
      .all(req.user.id)
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS submissions,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
                COALESCE(SUM(heat), 0) AS heat,
                COALESCE(SUM(share_views), 0) AS share_views
         FROM creator_works WHERE user_id = ?`,
      )
      .get(req.user.id)
    return sendSuccess(res, {
      items: rows,
      total: agg ? agg.submissions : 0,
      limit: MY_LIST_LIMIT,
      totals: agg,
    })
  } catch (err) {
    logErr('[创作者] 读取我的作品失败:', err)
    return sendError(res, '读取我的作品失败', 500)
  }
})

// ============================================================
// 管理端
// ============================================================

/**
 * 审核列表
 * 返回: { success: true, data: { list, total, limit } }
 * total 是真 COUNT(*)，理由与 /api/payment/admin/list 同一条：后台把行数当「共 N 件」显示，
 * list 被 LIMIT 截过的时候那个 N 就是假的。
 */
const ADMIN_LIST_LIMIT = 200
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const allowed = ['pending', 'approved', 'rejected']
    const hasFilter = allowed.includes(req.query.status)
    const where = hasFilter ? 'WHERE w.status = ?' : ''
    const filterParams = hasFilter ? [req.query.status] : []
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM creator_works w ${where}`)
      .get(...filterParams)
    const rows = db
      .prepare(
        `SELECT w.*, u.nickname, ua.phone FROM creator_works w
         LEFT JOIN users u ON w.user_id = u.id
         LEFT JOIN user_accounts ua ON ua.user_id = w.user_id
         ${where}
         ORDER BY w.id DESC
         LIMIT ${ADMIN_LIST_LIMIT}`,
      )
      .all(...filterParams)
    return sendSuccess(res, {
      list: rows,
      total: totalRow ? totalRow.n : 0,
      limit: ADMIN_LIST_LIMIT,
    })
  } catch (err) {
    logErr('[创作者] 读取审核列表失败:', err)
    return sendError(res, '读取审核列表失败', 500)
  }
})

/** 审核：通过即上广场 */
router.post('/admin/:id/review', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const status = req.body?.status
    if (!REVIEW_STATUSES.has(status)) {
      return sendError(res, 'status 只能是 pending / approved / rejected', 400)
    }
    const adminNote = String(req.body?.admin_note || '').slice(0, 200)
    const result = db
      .prepare(
        "UPDATE creator_works SET status = ?, admin_note = ?, reviewed_at = datetime('now') WHERE id = ?",
      )
      .run(status, adminNote, id)
    if (result.changes === 0) return sendError(res, '作品不存在', 404)
    return sendSuccess(res, { id, status }, '审核已保存')
  } catch (err) {
    logErr('[创作者] 审核失败:', err)
    return sendError(res, '审核失败', 500)
  }
})

/** 是否精选（广场排序的第一权重） */
router.post('/admin/:id/feature', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)
    const featured = req.body?.featured ? 1 : 0
    const result = db
      .prepare('UPDATE creator_works SET featured = ? WHERE id = ?')
      .run(featured, id)
    if (result.changes === 0) return sendError(res, '作品不存在', 404)
    return sendSuccess(res, { id, featured }, featured ? '已设为精选' : '已取消精选')
  } catch (err) {
    logErr('[创作者] 精选设置失败:', err)
    return sendError(res, '精选设置失败', 500)
  }
})

module.exports = router
