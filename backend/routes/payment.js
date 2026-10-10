/**
 * 收款路由模块
 *
 * 二维码是放在 app/public/ 下的静态图片（vite 构建时拷进 dist 根目录），
 * 换收款码 = 换图片文件，不用改代码；收款金额在后台「收款凭证」页改，
 * 标题与说明才改本文件的 PRICE。
 * 流程：配齐了商户号密钥的渠道走「一键付款」在线支付 -> 回调到账后自动放行；
 * 个人收款码 + 上传付款截图 + 后台人工审核只在该渠道没通电时当备用路（pay.html 会收起码）。
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
const wxpay = require('../services/wechatPay')
const alipay = require('../services/alipay')

const router = express.Router()

const PRICE = {
  title: '形象定制服务费',
  // 兜底默认值：app_settings 里没有 payment_amount_fen 这条记录时才用它。
  // 常规改价走后台「收款凭证」页，不动这里。
  amount: 99,
  qrcodes: {
    wechat: '/wechat-qr.png',
    alipay: '/alipay-qr.png',
  },
}

// 说明随渠道通电状态变：只留一句"上传截图人工确认"会把在线付款那条正路说没。
const NOTE_ONLINE = '点「一键付款」在线支付，付完本页自动确认到账并放行服务，无需上传凭证。'
const NOTE_OFFLINE = '扫码付款后上传付款截图，我们在 24 小时内人工确认并放行服务。'

const PRICE_KEY = 'payment_amount_fen'

/** 当前收款金额，单位分。库里存整数字符串，避免用浮点存钱。 */
function currentPriceFen() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PRICE_KEY)
  const fen = row ? parseInt(row.value, 10) : NaN
  return Number.isInteger(fen) && fen > 0 ? fen : alipay.yuanToFen(PRICE.amount)
}

function savePriceFen(fen) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PRICE_KEY, String(fen))
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
    // 两个开关让前端知道商户号是否已配好：都 false 时页面只剩"静态码 + 上传凭证"
    const online = wxpay.isConfigured() || alipay.isConfigured()
    return sendSuccess(res, {
      title: PRICE.title,
      amount: currentPriceFen() / 100,
      note: online ? NOTE_ONLINE : NOTE_OFFLINE,
      qrcodes: PRICE.qrcodes,
      wechat_native: wxpay.isConfigured(),
      alipay_web: alipay.isConfigured(),
    })
  } catch (err) {
    console.error('[收款] 读取收款配置失败:', err)
    return sendError(res, '读取收款配置失败', 500)
  }
})

/**
 * 提交付款凭证
 * 金额一律取站点标价，不接受前端传入：用户在别的字段里改金额没有意义，
 * 真需要改价走后台「收款凭证」页，人工审核比对的也是那个数。
 */
// ============================================================
// 微信支付 APIv3（Native）
// 配置不全时这三个端点分别回 503 / 不查微信，前端自动回落到上面的凭证流程。
// ============================================================

/** 查单轮询限流：前端约 3 秒一次，60 秒窗口给到 40 次余量 */
const orderQueryLimiter = rateLimit({
  windowMs: 60000,
  max: 40,
  message: '查询过于频繁，请稍后再试',
})

/**
 * 置为已支付，并登记一条已审核凭证，后台列表和"我的凭证"照常显示。
 * 渠道方会重复推送同一回调，UPDATE 影响 0 行时直接返回，不会重复入账。
 * @param {'wechat'|'alipay'} [channel]
 */
function markPaid(outTradeNo, transactionId, notifyRaw, channel = 'wechat') {
  const label = channel === 'alipay' ? '支付宝' : '微信'
  const apply = db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE payment_orders
         SET status = 'paid', transaction_id = ?, paid_at = datetime('now'), notify_raw = ?
         WHERE out_trade_no = ? AND status != 'paid'`,
      )
      .run(transactionId, notifyRaw, outTradeNo).changes
    if (!changed) return false
    const order = db
      .prepare('SELECT user_id, amount_fen FROM payment_orders WHERE out_trade_no = ?')
      .get(outTradeNo)
    db.prepare(
      `INSERT INTO deposits (user_id, channel, amount, proof_url, status, admin_note, approved_at)
       VALUES (?, ?, ?, '', 'approved', ?, datetime('now'))`,
    ).run(order.user_id, channel, order.amount_fen / 100, `${label}在线支付 ${transactionId}`)
    return true
  })
  return apply()
}

/** Native 下单：返回 code_url，前端用它生成二维码 */
router.post('/order', loginRequired, async (req, res) => {
  try {
    if (!wxpay.isConfigured()) return sendError(res, '在线收款暂未开放，请上传付款凭证', 503)
    const outTradeNo = wxpay.newOutTradeNo()
    const amountFen = currentPriceFen()
    const info = await wxpay.nativeOrder({ outTradeNo, amountFen, description: PRICE.title })
    db.prepare(
      `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, code_url)
       VALUES (?, ?, ?, ?, 'created', ?)`,
    ).run(outTradeNo, req.user.id, PRICE.title, amountFen, info.code_url)
    return sendSuccess(
      res,
      { out_trade_no: outTradeNo, code_url: info.code_url, amount: amountFen / 100 },
      '下单成功，请扫码支付',
    )
  } catch (err) {
    console.error('[收款] 微信下单失败:', err.detail || err.message)
    return sendError(res, '下单失败，请稍后再试', 502)
  }
})

/** 查单：回调万一没到，这里也能确认到账 */
router.get('/order/:outTradeNo', loginRequired, orderQueryLimiter, async (req, res) => {
  try {
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
      .get(req.params.outTradeNo)
    if (!order) return sendError(res, '订单不存在', 404)
    if (order.user_id !== req.user.id) return sendError(res, '无权查看该订单', 403)

    // 商户订单号前缀就是渠道：A3=支付宝、S3=微信，不必额外加列
    const isAlipay = order.out_trade_no.startsWith('A3')
    if (order.status !== 'paid' && isAlipay && alipay.isConfigured()) {
      try {
        const remote = await alipay.queryOrderByOutTradeNo(order.out_trade_no)
        if (alipay.PAID_STATUSES.has(remote.trade_status)) {
          markPaid(order.out_trade_no, remote.trade_no, JSON.stringify(remote), 'alipay')
        }
      } catch {
        /* 用户还没付款时支付宝回 ACQ.TRADE_NOT_EXIST，属正常，状态保持 created */
      }
    } else if (order.status !== 'paid' && !isAlipay && wxpay.isConfigured()) {
      try {
        const remote = await wxpay.queryOrderByOutTradeNo(order.out_trade_no)
        if (remote.trade_state === 'SUCCESS') {
          markPaid(order.out_trade_no, remote.transaction_id, JSON.stringify(remote))
        }
      } catch {
        /* 用户还没扫码时微信回 ORDERNOTEXIST，属正常，状态保持 created */
      }
    }
    const fresh = db
      .prepare('SELECT status, paid_at FROM payment_orders WHERE out_trade_no = ?')
      .get(order.out_trade_no)
    return sendSuccess(res, {
      out_trade_no: order.out_trade_no,
      status: fresh.status,
      amount: order.amount_fen / 100,
      paid_at: fresh.paid_at,
    })
  } catch (err) {
    console.error('[收款] 查单失败:', err)
    return sendError(res, '查单失败', 500)
  }
})

/**
 * 微信支付回调：由微信服务器直接调用，不能挂 loginRequired。
 * 验签原文必须是 req.rawBody（express.json 的 verify 钩子存下的原始字节）。
 * 返回 SUCCESS 微信才停止重试；非 2xx 会按它的策略重推。
 */
router.post('/notify', (req, res) => {
  const result = wxpay.handleNotify(req.rawBody || '', req.headers)
  if (!result.ok) {
    console.error('[收款] 回调验签失败:', result.reason)
    return res.status(401).json({ code: 'FAIL', message: '验签失败' })
  }
  const data = result.data
  try {
    if (data.trade_state !== 'SUCCESS') return res.json({ code: 'SUCCESS', message: '成功' })
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
      .get(data.out_trade_no)
    if (!order) {
      console.error('[收款] 回调对应订单不存在:', data.out_trade_no)
      return res.status(404).json({ code: 'FAIL', message: '订单不存在' })
    }
    // 金额必须等于下单金额，否则不是这一单该收的钱
    if (data.amount?.total !== order.amount_fen) {
      console.error('[收款] 回调金额不符:', data.out_trade_no, data.amount?.total, order.amount_fen)
      return res.status(400).json({ code: 'FAIL', message: '金额不符' })
    }
    markPaid(data.out_trade_no, data.transaction_id, JSON.stringify(data))
    return res.json({ code: 'SUCCESS', message: '成功' })
  } catch (err) {
    console.error('[收款] 回调处理失败:', err)
    return res.status(500).json({ code: 'FAIL', message: '处理失败' })
  }
})

// ============================================================
// 支付宝 电脑网站支付
// 与微信同一套把关：验签 -> 订单存在 -> 金额等于下单金额 -> 幂等入账。
// ============================================================

/**
 * 电脑网站支付下单：返回 pay_url，前端 window.location.href 过去即可。
 * 与微信 Native 的差别是支付宝不出二维码，直接把浏览器送到收银台，
 * 所以地址借用 code_url 列存放，不加新列。
 */
router.post('/alipay/order', loginRequired, (req, res) => {
  try {
    if (!alipay.isConfigured()) return sendError(res, '在线收款暂未开放，请上传付款凭证', 503)
    const outTradeNo = alipay.newOutTradeNo()
    const amountFen = currentPriceFen()
    const payUrl = alipay.pagePayUrl({ outTradeNo, amountFen, subject: PRICE.title })
    db.prepare(
      `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, code_url)
       VALUES (?, ?, ?, ?, 'created', ?)`,
    ).run(outTradeNo, req.user.id, PRICE.title, amountFen, payUrl)
    return sendSuccess(
      res,
      { out_trade_no: outTradeNo, pay_url: payUrl, amount: amountFen / 100 },
      '下单成功，请前往支付宝付款',
    )
  } catch (err) {
    console.error('[收款] 支付宝下单失败:', err.detail || err.message)
    return sendError(res, '下单失败，请稍后再试', 502)
  }
})

/**
 * 支付宝异步通知：form-urlencoded，签名就在表单字段里，不需要 rawBody。
 * 处理成功必须回纯文本 success，否则支付宝会在 25 小时内按 4m/10m/... 重推。
 */
router.post('/notify/alipay', (req, res) => {
  const result = alipay.handleNotify(req.body)
  if (!result.ok) {
    console.error('[收款] 支付宝通知验签失败:', result.reason)
    return res.status(401).send('fail')
  }
  const data = result.data
  try {
    // 未付款的中间态也回 success 让支付宝停止重推，但不入账
    if (!result.paid) return res.send('success')
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
      .get(data.out_trade_no)
    if (!order) {
      console.error('[收款] 支付宝通知对应订单不存在:', data.out_trade_no)
      return res.status(404).send('fail')
    }
    // 通知金额必须等于下单金额，否则不是这一单该收的钱
    if (alipay.yuanToFen(data.total_amount) !== order.amount_fen) {
      console.error(
        '[收款] 支付宝通知金额不符:',
        data.out_trade_no,
        data.total_amount,
        order.amount_fen,
      )
      return res.status(400).send('fail')
    }
    markPaid(data.out_trade_no, data.trade_no || '', JSON.stringify(data), 'alipay')
    return res.send('success')
  } catch (err) {
    console.error('[收款] 支付宝通知处理失败:', err)
    return res.status(500).send('fail')
  }
})

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

    const amount = currentPriceFen() / 100
    const result = db
      .prepare(
        'INSERT INTO deposits (user_id, channel, amount, proof_url, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(req.user.id, channel, amount, `/uploads/${filename}`, 'pending')

    return sendSuccess(
      res,
      { id: Number(result.lastInsertRowid), status: 'pending', amount },
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
    let sql = `SELECT d.*, u.nickname, ua.phone FROM deposits d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN user_accounts ua ON ua.user_id = d.user_id`
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
      .prepare('UPDATE deposits SET status = ?, admin_note = ?, approved_at = ? WHERE id = ?')
      .run(status, adminNote, approvedAt, id)

    if (result.changes === 0) return sendError(res, '凭证不存在', 404)
    return sendSuccess(res, { id, status }, '审核已保存')
  } catch (err) {
    console.error('[收款] 审核失败:', err)
    return sendError(res, '审核失败', 500)
  }
})

/** 当前收款金额（管理端） */
router.get('/admin/price', adminLoginRequired, (req, res) => {
  try {
    const row = db.prepare('SELECT updated_at FROM app_settings WHERE key = ?').get(PRICE_KEY)
    const fen = currentPriceFen()
    return sendSuccess(res, {
      amount: fen / 100,
      amount_fen: fen,
      default_amount: PRICE.amount,
      source: row ? 'db' : 'code',
      updated_at: row ? row.updated_at : null,
    })
  } catch (err) {
    console.error('[收款] 读取标价失败:', err)
    return sendError(res, '读取标价失败', 500)
  }
})

/**
 * 改价。只影响之后新建的订单：每笔订单在下单那一刻就把 amount_fen 写死在自己那行，
 * 异步通知与查单核对的都是那一行，所以改价不会让已经在付的单子对不上账。
 */
router.put('/admin/price', adminLoginRequired, (req, res) => {
  try {
    const raw = String(req.body?.amount ?? '').trim()
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return sendError(res, '金额最多两位小数，例如 99 或 59.9', 400)
    const fen = alipay.yuanToFen(raw)
    if (fen < 1 || fen > 9999999) return sendError(res, '金额需在 0.01 ～ 99999.99 元之间', 400)

    const before = currentPriceFen()
    savePriceFen(fen)
    console.log('[收款] 标价变更:', before / 100, '->', fen / 100)
    return sendSuccess(res, { amount: fen / 100, amount_fen: fen }, '收款金额已更新')
  } catch (err) {
    console.error('[收款] 改价失败:', err)
    return sendError(res, '改价失败', 500)
  }
})

module.exports = router
