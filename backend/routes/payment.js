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
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { generateUUID, UPLOAD_DIR, asId, getSessionId } = require('../utils/common')
const { loginRequired, adminLoginRequired } = require('../middleware/auth')
const { upload, validateImage } = require('../middleware/upload')
const { rateLimit } = require('../middleware/rateLimit')
// 日志走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，落盘的只有
// logs/server-*.log 这一份（别名与 server.js:42 保持一致，判据见 test/loggerDiscipline.test.js）
const { log: logMsg, error: logErr } = require('../utils/logger')
const wxpay = require('../services/wechatPay')
const alipay = require('../services/alipay')
const paidReport = require('../services/paidReport')

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

// ============================================================
// 第十二阶段·第一步（`docs/依据/20-付款即交付输入输出规范-20261021.md` §六）：订单补 `closed`
// ============================================================

/**
 * 一笔已下单没付款的单子，多久算过期。
 * 30 分钟这个数是手拍的（C 档）：微信/支付宝自己的预下单也在这个量级，
 * 而且它只影响**列表口径**——钱真到账时 `markPaid` 照样把它记成 `paid`（见下面那条注释）。
 * ⛔ 对外不许说这是"行业标准"，它是本站的一条运维约定。
 */
const ORDER_TTL_MINUTES = 30

/**
 * 关掉这个人名下超时的未付单。三条边界写死在这里：
 *  - `user_id` 必须在 WHERE 里：⛔ 不许写成全表扫，门店演示机上多人共用一把浏览器时
 *    会把别人正在扫的那笔码关掉；
 *  - `status = 'created'` 既是过滤条件也是幂等保证：已付单碰不到，重复调用只关一次；
 *  - 时间轴与 `created_at` 同为 SQLite `datetime('now')`（UTC），⛔ 不与东八区串比。
 * `changes` 只进日志不进响应：顾客不需要知道"系统悄悄关了你的旧单"，那是后台口径。
 */
function closeStaleOrders(userId) {
  try {
    const r = db
      .prepare(
        `UPDATE payment_orders
         SET status = 'closed'
         WHERE user_id = ? AND status = 'created'
           AND created_at < datetime('now', '-' || ? || ' minutes')`,
      )
      .run(userId, ORDER_TTL_MINUTES)
    if (r.changes > 0) logMsg('[收款] 关闭超时未付单:', userId, r.changes, '笔')
    return r.changes
  } catch (err) {
    // 关单失败不该挡住下单或读数：那是清理动作，不是交易动作
    logErr('[收款] 关闭超时未付单失败:', err)
    return 0
  }
}

/**
 * 领取报告一支的限流：⛔ 只挂 `?report=`，不挂 `/my` 的只读支。
 * 领取会跑整趟推荐引擎（比 `orderQueryLimiter` 那 40 次/分重得多），
 * 而只读支还要给后台/前台显示权益用，掐了它等于让付了钱的人看不见自己付了什么。
 */
const reportLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '领取过于频繁，请稍后再试',
})

/** §四 那一版对外键名：服务层内部是 `*_yuan`／`created_orders`，对外统一叫「待付/实收/已关」 */
function entitlementForClient(e) {
  return {
    granted: e.granted,
    used: e.used,
    left: e.left,
    paid_orders: e.paid_orders,
    paid_amount: e.paid_amount_yuan,
    pending_orders: e.created_orders,
    pending_amount: e.created_amount_yuan,
    closed_orders: e.closed_orders,
    proof_approved: e.proof_granted,
    proof_amount: e.proof_amount_yuan,
    reports: e.reports.map((r) => ({
      out_trade_no: r.out_trade_no,
      // 🔴 C1：`DEPOSIT-<id>` 是凭证流的幂等键、不是平台单号，前端据此决定这一行怎么显示
      is_platform_order_no: r.is_platform_order_no,
      source: r.source,
      deposit_id: r.deposit_id,
      amount: r.amount_yuan,
      channel: r.channel,
      paid_at: r.paid_at_beijing || r.paid_at,
      log_id: r.log_id,
      report_no: r.report_no,
      basis_log_id: r.basis_log_id,
      granted_at: r.generated_at_beijing || r.generated_at,
    })),
    claimable: e.claimable.map((c) => ({
      out_trade_no: c.out_trade_no,
      amount: c.amount_yuan,
      channel: String(c.out_trade_no).startsWith('A3') ? 'alipay' : 'wechat',
      paid_at: c.paid_at_beijing || c.paid_at,
    })),
    // 🔴 C1：人工凭证那一路的可领列表（`?proof=<deposit_id>` 就是领它的方式）
    claimable_proofs: (e.claimable_proofs || []).map((p) => ({
      deposit_id: p.deposit_id,
      amount: p.amount_yuan,
      paid_at: p.paid_at_beijing || p.paid_at,
    })),
  }
}

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
    logErr('[收款] 读取收款配置失败:', err)
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
 *
 * 🔴 第十二阶段·第一步（`docs/依据/20` §六）：这一段的判断**一个字没动**，包括
 * `WHERE … AND status != 'paid'` 会把 `closed` 也更新成 `paid` 这件事。
 * 那是故意的：超时关单只是**列表口径**（免得后台挂着几十笔永远不会付的单），
 * 而钱真到了就该记到账——⛔ 绝不能因为本站超时就把人家付了的钱判死。
 * 所以这里只加一行日志，把"从哪个状态翻成 paid"打出来：
 * `from_status=closed` 出现就说明渠道的回调比 30 分钟慢，那时候要查的是回调延迟，不是关单逻辑。
 * @param {'wechat'|'alipay'} [channel]
 */
function markPaid(outTradeNo, transactionId, notifyRaw, channel = 'wechat') {
  const label = channel === 'alipay' ? '支付宝' : '微信'
  const before = db
    .prepare('SELECT status FROM payment_orders WHERE out_trade_no = ?')
    .get(outTradeNo)
  const fromStatus = before ? before.status : 'missing'
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
  const ok = apply()
  if (ok) logMsg('[收款] 到账:', outTradeNo, 'from_status=' + fromStatus)
  return ok
}

/** Native 下单：返回 code_url，前端用它生成二维码 */
router.post('/order', loginRequired, async (req, res) => {
  try {
    if (!wxpay.isConfigured()) return sendError(res, '在线收款暂未开放，请上传付款凭证', 503)
    // 下单前先把这人名下超时的旧单关掉（§六）：不挂定时任务，靠既有入口顺手清
    closeStaleOrders(req.user.id)
    const outTradeNo = wxpay.newOutTradeNo()
    const amountFen = currentPriceFen()
    const info = await wxpay.nativeOrder({ outTradeNo, amountFen, description: PRICE.title })
    db.prepare(
      `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, code_url)
       VALUES (?, ?, ?, ?, 'created', ?)`,
    ).run(outTradeNo, req.user.id, PRICE.title, amountFen, info.code_url)
    return sendCreated(
      res,
      { out_trade_no: outTradeNo, code_url: info.code_url, amount: amountFen / 100 },
      `${req.baseUrl}/order/${outTradeNo}`,
      '下单成功，请扫码支付',
    )
  } catch (err) {
    logErr('[收款] 微信下单失败:', err.detail || err.message)
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
    logErr('[收款] 查单失败:', err)
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
    logErr('[收款] 回调验签失败:', result.reason)
    return res.status(401).json({ code: 'FAIL', message: '验签失败' })
  }
  const data = result.data
  try {
    if (data.trade_state !== 'SUCCESS') return res.json({ code: 'SUCCESS', message: '成功' })
    const order = db
      .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
      .get(data.out_trade_no)
    if (!order) {
      logErr('[收款] 回调对应订单不存在:', data.out_trade_no)
      return res.status(404).json({ code: 'FAIL', message: '订单不存在' })
    }
    // 金额必须等于下单金额，否则不是这一单该收的钱
    if (data.amount?.total !== order.amount_fen) {
      logErr('[收款] 回调金额不符:', data.out_trade_no, data.amount?.total, order.amount_fen)
      return res.status(400).json({ code: 'FAIL', message: '金额不符' })
    }
    markPaid(data.out_trade_no, data.transaction_id, JSON.stringify(data))
    return res.json({ code: 'SUCCESS', message: '成功' })
  } catch (err) {
    logErr('[收款] 回调处理失败:', err)
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
    // 同一条尺子：支付宝那一路用户在收银台停留更久，所以也是"下单前顺手关自己的陈旧单"
    closeStaleOrders(req.user.id)
    const outTradeNo = alipay.newOutTradeNo()
    const amountFen = currentPriceFen()
    const payUrl = alipay.pagePayUrl({ outTradeNo, amountFen, subject: PRICE.title })
    db.prepare(
      `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, code_url)
       VALUES (?, ?, ?, ?, 'created', ?)`,
    ).run(outTradeNo, req.user.id, PRICE.title, amountFen, payUrl)
    return sendCreated(
      res,
      { out_trade_no: outTradeNo, pay_url: payUrl, amount: amountFen / 100 },
      `${req.baseUrl}/order/${outTradeNo}`,
      '下单成功，请前往支付宝付款',
    )
  } catch (err) {
    logErr('[收款] 支付宝下单失败:', err.detail || err.message)
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
    logErr('[收款] 支付宝通知验签失败:', result.reason)
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
      logErr('[收款] 支付宝通知对应订单不存在:', data.out_trade_no)
      return res.status(404).send('fail')
    }
    // 通知金额必须等于下单金额，否则不是这一单该收的钱
    if (alipay.yuanToFen(data.total_amount) !== order.amount_fen) {
      logErr('[收款] 支付宝通知金额不符:', data.out_trade_no, data.total_amount, order.amount_fen)
      return res.status(400).send('fail')
    }
    markPaid(data.out_trade_no, data.trade_no || '', JSON.stringify(data), 'alipay')
    return res.send('success')
  } catch (err) {
    logErr('[收款] 支付宝通知处理失败:', err)
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

    return sendCreated(
      res,
      { id: Number(result.lastInsertRowid), status: 'pending', amount },
      null,
      '凭证已提交，等待人工确认',
    )
  } catch (err) {
    logErr('[收款] 提交凭证失败:', err)
    return sendError(res, '提交凭证失败', 500)
  }
})

/**
 * 我的凭证 + 我的交付（第十二阶段·第一步，规范 §四）
 * ============================================================
 * 一条路径两种体，⛔ 不新增端点：
 *  - `GET /api/payment/my`（只读支）＝原来那行凭证的键**原样平铺**（`pay.html` 正在读
 *    `data.data.status`/`amount`，不改形状就不会把唯一的消费方打挂），只是从"没有凭证回 null"
 *    变成"没有凭证回这些键为 null"，同轮把 `showMine()` 加一条空值守卫。追加三键：
 *    `entitlement`（还能领几份／已领清单）、`orders`（名下订单状态）、`time_axis`。
 *  - `GET /api/payment/my?report=<out_trade_no>`＝领取／复读这一单的深度细账（见 `services/paidReport.js`）。
 *    这一支会跑引擎，所以单独挂 `reportLimiter`（10 次/分），只读支不挂。
 *
 * 关单动作挂在这里（§六 第三个挂载点）：只关**自己**名下超时的 `created` 单，
 * 于是"没人下单时也有一处会定期把陈旧单收口"，而代价是一次 UPDATE。
 */
router.get('/my', loginRequired, (req, res) => {
  try {
    closeStaleOrders(req.user.id)

    const reportNo = typeof req.query.report === 'string' ? req.query.report.trim() : ''
    // 🔴 第十四阶段·第一步 C1：`pay.html` 承诺"上传截图→人工确认→回展厅领取"，但原来这一支
    // 只读 `payment_orders`，而后台核凭证那条 `POST /admin/:id/status` 只 `UPDATE deposits`
    // （`:620-679`）——**两条路根本不接**，人工付过钱的顾客拿不到任何东西。
    // 正解＝多一个显式入参 `?proof=<deposits.id>`，服务层自己判"已核＋非镜像＋属于当前账号"，
    // ⛔ 不往 `payment_orders` 伪造单号（那会把"人工确认"混进老板看的实收读数）。
    const proofRaw = typeof req.query.proof === 'string' ? req.query.proof.trim() : ''
    const proofId = /^\d+$/.test(proofRaw) ? Number(proofRaw) : null
    if (reportNo || proofId !== null) {
      // 走限流：直接调用中间件函数，因为限流只该管这一支。
      // ⚠️ 第三个参数（也就是库里的 `next`）**必须接错误**：express-rate-limit 8.x 把任何内部
      // 异常都塞给 `next(error)`（源码 `node_modules/express-rate-limit/dist/index.cjs:871-877`
      // 那个 `handleAsyncErrors`），而这里 `next` 就是下面这个回调——原来它不接参数，等于
      // ①限流器一抛错就"当没事发生"照样发报告（静默失败开放），②回调里业务若抛异常，
      // 那次异常会经由 `.catch(next)` 回到同一个回调**再跑一遍业务**（`claimReport` 是要写库的）。
      // 接住它、直接回 500，两条都关掉。全仓这样的内联调用只有这一处（尺子＝`grep -rn "Limiter(req, res" backend/routes backend/server.js backend/middleware`）。
      // 上面那两条前提不是推测，钉在 `test/rateLimitWindow.test.js` 最后两条测试里（store 抛错走 next(err)、业务抛错会被再调一次）。
      return reportLimiter(req, res, (limiterErr) => {
        if (limiterErr) {
          logErr('[收款] 这一支的限流中间件抛错:', limiterErr)
          return sendError(res, '领取失败，请稍后重试', 500)
        }
        // 这次填表用的会话号：门店快速模式那条样本只有 `sess_…` 会话号、没有 user_id
        // （`customer_sessions` 没这列），不带进来付了款的门店顾客会一律撞 409。
        // 判据见 `services/paidReport.js` 的 `findBasis`；形状闸门与 `middleware/auth.js` 的
        // `optionalUser` 同一条，别的样子一律当"没带"，⛔ 不拿去查库。
        const rawBasis = typeof req.query.session === 'string' ? req.query.session.trim() : ''
        const basisSessionId = /^[A-Za-z0-9_-]{8,64}$/.test(rawBasis) ? rawBasis : null
        const identity = {
          userId: req.user.id,
          // 报告行的归属串＝本次请求的身份（`utils/common.js:92` 那把唯一尺子），
          // 取不到再退回 users.session_id；两个都没有 ⇒ 服务层回 400，⛔ 不落一条归属不明的行
          sessionId: getSessionId(req) || req.user.session_id || '',
          basisSessionId,
        }
        const r =
          proofId !== null
            ? paidReport.claimReportByProof({ ...identity, depositId: proofId })
            : paidReport.claimReport({ ...identity, outTradeNo: reportNo })
        if (r.code !== 200) {
          if (r.code === 404) return sendError(res, r.error, 404)
          if (r.code === 403) return sendError(res, r.error, 403)
          if (r.code === 409) return sendError(res, r.error, 409)
          if (r.code === 400) return sendError(res, r.error, 400)
          return sendError(res, r.error || '报告生成失败', 500)
        }
        return sendSuccess(res, {
          report: r.data.report,
          profile: r.data.profile,
          mode: r.data.mode,
          log_id: r.data.log_id,
          fresh: r.data.fresh,
        })
      })
    }

    const row = db
      .prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(req.user.id)
    const ent = paidReport.entitlement(req.user.id)
    // 订单状态单独给一份：前端要显示"有一笔还没付完"，而 `entitlement` 只给数不给单号
    const orderRows = db
      .prepare(
        `SELECT out_trade_no, status, amount_fen, paid_at, created_at
         FROM payment_orders WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
      )
      .all(req.user.id)
    return sendSuccess(res, {
      // 凭证那八个键原样留着；没有凭证时全部为 null，前端用 status 判空
      id: row ? row.id : null,
      channel: row ? row.channel : null,
      amount: row ? row.amount : null,
      proof_url: row ? row.proof_url : null,
      status: row ? row.status : null,
      admin_note: row ? row.admin_note : null,
      created_at: row ? row.created_at : null,
      approved_at: row ? row.approved_at : null,
      entitlement: entitlementForClient(ent),
      orders: orderRows.map((o) => ({
        out_trade_no: o.out_trade_no,
        status: o.status,
        amount: o.amount_fen / 100,
        // 库里全是 UTC，出门前统一转东八区显示串（utils/beijingTime.js 是唯一出处）
        paid_at: o.paid_at ? paidReport.toBeijing(o.paid_at) : null,
        created_at_beijing: paidReport.toBeijing(o.created_at),
      })),
      // 时间口径写明白：`left` 只是显示用的提示，真正的硬约束是"一单一报"（按订单号幂等），
      // 见 services/paidReport.js 开头那段。
      time_axis: '本响应里所有 *_beijing / paid_at / granted_at 字段是东八区显示串',
    })
  } catch (err) {
    logErr('[收款] 读取凭证失败:', err)
    return sendError(res, '读取凭证失败', 500)
  }
})

// ============================================================
// 管理端（供后台页面调用，与 /api/models/admin/* 同一套约定）
// ============================================================

/**
 * 凭证列表
 * 返回: { success: true, data: { list, total, limit, summary } }
 * total 是真 COUNT(*)。原来后台把接口返回的行数当"共 N 条"显示，而这里带 LIMIT：
 * 库里一旦超过 limit 条，"只给了最近 200 条"就会被显示成"一共 200 条"，
 * 审核页看上去就少了 pending 凭证。list 仍是被 limit 截过的那一段。
 *
 * 🔴 第十二阶段·第一步（`docs/依据/20` §七）：追加 `summary`＝后台三张读数卡的数（只增不改，
 * 老前端不读它照样跑）。两条口径写在这里：
 *  - `summary` 是**全库**口径，⛔ 不跟着 `?status=` 的筛选变——那张卡问的是"这个月赚了多少"，
 *    不是"当前这一屏有几条凭证"；
 *  - 数全部在 SQL 里现算（`services/paidReport.js` 的 `businessSummary()`），⛔ 服务层二次加工，
 *    分母为 0 的比值回 `null`，前端显示「—」。
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
      summary: paidReport.businessSummary(),
    })
  } catch (err) {
    logErr('[收款] 读取凭证列表失败:', err)
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
      .prepare('SELECT status, admin_note, proof_url, channel FROM deposits WHERE id = ?')
      .get(id)
    if (!current) return sendError(res, '凭证不存在', 404)
    const isOnlinePaid = paidReport.isOnlineMirror(current)
    if (isOnlinePaid && status !== 'approved') {
      return sendError(
        res,
        '这笔是线上支付且已到账的记录，不能改成「' +
          (status === 'rejected' ? '拒绝' : '待确认') +
          '」；要退款请在支付平台走原路退款',
        400,
      )
    }
    // 🔴 第十四阶段·第一步 组4 的**真钱测单**（2026-10-22 支付宝 0.01 元）抓到的洞：
    // 这一支原来照样往下走 UPDATE，把 `markPaid` 写的「支付宝在线支付 <平台单号>」覆盖成
    // 后台备注框里的空串（`static/admin/admin-review.js:264` 框里没字就发 `admin_note: ''`）。
    // 镜像判据一旦被覆盖掉，`entitlement` 就把同一笔钱数成两份（现量 `granted 2／paid_orders 1`），
    // `claimable_proofs` 里多出那颗 `deposit_id`，顾客按 `?proof=1` 真领出了第二份报告
    // （盘外副本复现：报告行 id 2 与 id 3 同时在库）。⇒ 在线到账的凭证不需要人再点一次「通过」，
    // 这里原样返回、一行都不写；要补的备注请走「订单号」那条，⛔ 不许覆盖这一列。
    if (isOnlinePaid && status === 'approved') {
      return sendSuccess(
        res,
        { id, status: 'approved', online_mirror: true },
        '这笔是在线支付自动到账的记录，已经是确认状态，无需再次审核（备注栏不会覆盖到账来源）',
      )
    }

    // approved_at 必须与 markPaid 写库时(第 226 行)同用 SQLite datetime('now')。
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
    logErr('[收款] 审核失败:', err)
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
    logErr('[收款] 读取标价失败:', err)
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
    logMsg('[收款] 标价变更:', before / 100, '->', fen / 100)
    return sendSuccess(res, { amount: fen / 100, amount_fen: fen }, '收款金额已更新')
  } catch (err) {
    logErr('[收款] 改价失败:', err)
    return sendError(res, '改价失败', 500)
  }
})

module.exports = router
