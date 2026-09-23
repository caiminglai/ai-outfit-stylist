/**
 * 收款路由模块
 *
 * 二维码是放在 app/public/ 下的静态图片（vite 构建时拷进 dist 根目录），
 * 换收款码 = 换图片文件，不用改代码；价格与说明改本文件的 PRICE。
 * 流程：访客扫码付款 -> 上传付款截图 -> 后台人工审核 -> 放行服务。
 */
const express = require('express')
const fs = require('fs')
const path = require('path')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR } = require('../utils/common')
const { loginRequired, adminLoginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

const PRICE = {
  title: '形象定制服务费',
  amount: 99,
  note: '扫码付款后上传付款截图，我们在 24 小时内人工确认并放行服务。',
  qrcodes: {
    wechat: '/wechat-qr.png',
    alipay: '/alipay-qr.png',
  },
}

const DEPOSIT_STATUSES = new Set(['pending', 'approved', 'rejected'])

// 凭证提交限流：每分钟 5 次，防止刷上传目录
const depositLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: '提交过于频繁，请稍后再试',
})

/** 收款码 + 价格（公开） */
router.get('/qrcodes', (req, res) => {
  try {
    return sendSuccess(res, PRICE)
  } catch (err) {
    console.error('[收款] 读取收款配置失败:', err)
    return sendError(res, '读取收款配置失败', 500)
  }
})

/**
 * 提交付款凭证
 * 金额一律取站点标价，不接受前端传入：用户在别的字段里改金额没有意义，
 * 真需要改价是改 PRICE，人工审核比对的也是这个数。
 */
router.post('/deposit', loginRequired, depositLimiter, upload.single('file'), (req, res) => {
  try {
    const validation = validateImage(req.file)
    if (!validation.valid) {
      return sendError(res, validation.error, 400)
    }

    const channel = req.body?.channel === 'alipay' ? 'alipay' : 'wechat'
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filename = `${generateUUID()}${ext}`
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer)

    const result = db
      .prepare(
        'INSERT INTO deposits (user_id, channel, amount, proof_url, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(req.user.id, channel, PRICE.amount, `/uploads/${filename}`, 'pending')

    return sendSuccess(
      res,
      { id: Number(result.lastInsertRowid), status: 'pending', amount: PRICE.amount },
      '凭证已提交，等待人工确认',
    )
  } catch (err) {
    console.error('[收款] 提交凭证失败:', err)
    return sendError(res, '提交凭证失败', 500)
  }
})

/** 我的最近一条凭证 */
router.get('/my', loginRequired, (req, res) => {
  try {
    const row = db
      .prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(req.user.id)
    if (!row) return sendSuccess(res, null)
    return sendSuccess(res, {
      id: row.id,
      channel: row.channel,
      amount: row.amount,
      proof_url: row.proof_url,
      status: row.status,
      admin_note: row.admin_note,
      created_at: row.created_at,
      approved_at: row.approved_at,
    })
  } catch (err) {
    console.error('[收款] 读取凭证失败:', err)
    return sendError(res, '读取凭证失败', 500)
  }
})

// ============================================================
// 管理端（供后台页面调用，与 /api/models/admin/* 同一套约定）
// ============================================================

/** 凭证列表 */
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const status = req.query.status
    const allowed = ['pending', 'approved', 'rejected']
    let sql = `SELECT d.*, u.nickname, u.phone FROM deposits d
      LEFT JOIN users u ON d.user_id = u.id`
    const params = []
    if (allowed.includes(status)) {
      sql += ' WHERE d.status = ?'
      params.push(status)
    }
    sql += ' ORDER BY d.id DESC LIMIT 200'
    return sendSuccess(res, db.prepare(sql).all(...params))
  } catch (err) {
    console.error('[收款] 读取凭证列表失败:', err)
    return sendError(res, '读取凭证列表失败', 500)
  }
})

/** 审核凭证 */
router.post('/admin/:id/status', adminLoginRequired, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return sendError(res, 'ID 格式错误', 400)

    const status = req.body?.status
    if (!DEPOSIT_STATUSES.has(status)) {
      return sendError(res, 'status 只能是 pending / approved / rejected', 400)
    }

    const adminNote = String(req.body?.admin_note || '').slice(0, 200)
    const approvedAt = status === 'approved' ? new Date().toISOString() : null
    const result = db
      .prepare(
        'UPDATE deposits SET status = ?, admin_note = ?, approved_at = ? WHERE id = ?',
      )
      .run(status, adminNote, approvedAt, id)

    if (result.changes === 0) return sendError(res, '凭证不存在', 404)
    return sendSuccess(res, { id, status }, '审核已保存')
  } catch (err) {
    console.error('[收款] 审核失败:', err)
    return sendError(res, '审核失败', 500)
  }
})

module.exports = router
