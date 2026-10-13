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
const { generateUUID, UPLOAD_DIR, asId } = require('../utils/common')
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
 * 回调专用限流：server.js 的全局 apiLimiter 豁免了 /api/payment/notify*（回调被掐
 * 会导致微信/支付宝按失败重推），两条 notify 之前是完全裸的——伪造回调的洪水可以
 * 不限次数地锤验签逻辑（RSA 验签是有真实 CPU 成本的）。这道闸只拦洪水：
 * 300 次/15 分钟按 IP 独立成桶，渠道方正常的重试与重推远够不着，不会掐掉真到账通知。
 */
const notifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: '回调过于频繁，请稍后再试',
})

/**
 * 微信支付回调：由微信服务器直接调用，不能挂 loginRequired。
 * 验签原文必须是 req.rawBody（express.json 的 verify 钩子存下的原始字节）。
 * 返回 SUCCESS 微信才停止重试；非 2xx 会按它的策略重推。
 */
router.post('/notify', notifyLimiter, (req, res) => {
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
router.post('/notify/alipay', notifyLimiter, (req, res) => {
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
    const proofUrl = `/uploads/${filename}`
    let result
    try {
      result = db
        .prepare(
          'INSERT INTO deposits (user_id, channel, amount, proof_url, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(req.user.id, channel, amount, proofUrl, 'pending')
    } catch (err) {
      // 凭证图已落盘但行没写成 ⇒ 删文件，别留一张后台永远看不见、
      // 也没人会被通知去审的孤儿凭证（这条和 clothing.js 同一处理）
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, filename))
      } catch {
        /* 删不掉只是文件残留，不改变这条本就要回的 500 */
      }
      throw err
    }

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

/**
 * 凭证列表
 * 返回: { success: true, data: { list, total, limit } }
 * total 是真 COUNT(*)。原来后台把接口返回的行数当"共 N 条"显示，而这里带 LIMIT：
 * 库里一旦超过 limit 条，"只给了最近 200 条"就会被显示成"一共 200 条"，
 * 审核页看上去就少了 pending 凭证。list 仍是被 limit 截过的那一段。
 */
const ADMIN_LIST_LIMIT = 200
router.get('/admin/list', adminLoginRequired, (req, res) => {
  try {
    const status = req.query.status
    const allowed = ['pending', 'approved', 'rejected']
    const hasFilter = allowed.includes(status)
    const where = hasFilter ? 'WHERE d.status = ?' : ''
    const filterParams = hasFilter ? [status] : []
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM deposits d ${where}`)
      .get(...filterParams)
    const rows = db
      .prepare(
        `SELECT d.*, u.nickname, ua.phone FROM deposits d
         LEFT JOIN users u ON d.user_id = u.id
         LEFT JOIN user_accounts ua ON ua.user_id = d.user_id
         ${where}
         ORDER BY d.id DESC
         LIMIT ${ADMIN_LIST_LIMIT}`,
      )
      .all(...filterParams)
    return sendSuccess(res, {
      list: rows,
      total: totalRow ? totalRow.n : 0,
      limit: ADMIN_LIST_LIMIT,
    })
  } catch (err) {
    console.error('[收款] 读取凭证列表失败:', err)
    return sendError(res, '读取凭证列表失败', 500)
  }
})

/** 审核凭证 */
router.post('/admin/:id/status', adminLoginRequired, (req, res) => {
  try {
    const id = asId(req.params.id)
    if (id === null) return sendError(res, 'id 必须是正整数', 400)

    const status = req.body?.status
    if (!DEPOSIT_STATUSES.has(status)) {
      return sendError(res, 'status 只能是 pending / approved / rejected', 400)
    }

    const adminNote = String(req.body?.admin_note || '').slice(0, 200)

    // 在线支付已到账的那笔凭证不能改判"拒绝"：钱是回调确认过的，deposits 这边改成 rejected
    // 而 payment_orders.status 还是 paid（:106-127 markPaid 写的），两张账从此相反，
    // 且这一改还把 approved_at 清成 NULL，对账时看不出来。退款要走平台原路，不是改状态。
    const current = db
      .prepare('SELECT status, admin_note, proof_url FROM deposits WHERE id = ?')
      .get(id)
    if (!current) return sendError(res, '凭证不存在', 404)
    const isOnlinePaid =
      current.status === 'approved' &&
      /^(微信|支付宝)在线支付 /.test(current.admin_note || '') &&
      !(current.proof_url || '')
    if (isOnlinePaid && status === 'rejected') {
      return sendError(
        res,
        '这笔是线上支付且已到账，不能改成拒绝；要退款请在支付平台走原路退款',
        400,
      )
    }

    // approved_at 必须与 markPaid 写库时(第 122 行)同用 SQLite datetime('now')。
    // 之前这里塞 new Date().toISOString() ⇒ 同一列两种格式('2026-…T…Z' vs '2026-… …'),
    // 按 approved_at 排序或和 created_at 比大小时,ISO 的 'T' 恒 > 空格,人工审核永远被排到后面。
    const result = db
      .prepare(
        "UPDATE deposits SET status = ?, admin_note = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE id = ?",
      )
      .run(status, adminNote, status, id)

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
    if (!/^\d+(\.\d{1,2})?$/.test(raw))
      return sendError(res, '金额最多两位小数，例如 99 或 59.9', 400)
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
