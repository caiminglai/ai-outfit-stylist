/**
 * 付款即交付服务层（第十二阶段·第一步，唯一权威规范＝docs/依据/20-付款即交付输入输出规范-20261021.md）
 * ============================================================
 * 本文件是三件事的唯一出处：
 *   1. **解锁真相源**（§二）：这个人名下付了几单、领了几份、还能显示几份——全部从库里现算。
 *      ⛔ 不建权益表、⛔ 不加列、⛔ 不写 app_settings。权益一旦变成"另存的一份状态"，
 *      它就会与 `payment_orders` 打架，而打架的结论永远是"顾客付了钱却没拿到东西"。
 *   2. **报告的生成与幂等**（§三/§四）：一笔到账换一份深度细账，**一笔一报、可复读**。
 *      判据是幂等键，不是额度计数器——重复查看同一笔永远返回同一行日志。
 *      🔴 第十四阶段·第一步 C1：到账事实有两条来路（`resolveOrderGrant` 在线订单／
 *      `resolveProofGrant` 人工已核凭证），共用同一个 `deliver()`；凭证流的键是 `DEPOSIT-<id>`，
 *      ⛔ 不往 `payment_orders` 塞伪造单号（那张表是实收读数的唯一出处）。
 *   3. **后台三张经营读数**（§七）：实收／掉在中段的／漏斗。只读数，⛔ 不改 `/admin/api/stats` 的语义。
 *
 * 🔴 三条不能错的口径：
 *  - `markPaid`（`routes/payment.js:206-233`）在把订单置 `paid` 的同时，**还会往 `deposits` 插一条
 *    `approved` 镜像**（`:224-227`，`proof_url` 写死空串）。所以两张账不能相加，凭证流那一路必须把镜像剔掉；
 *    🔴 剔镜像那把尺子**本文件是唯一出处**（`ONLINE_MIRROR` 那段 SQL ＋ 下面 `isOnlineMirror()`），
 *    `routes/payment.js` 的审核口现在反过来调它（`:639`），⛔ 两边各起一把（同层两把尺子是本项目反复清扫的病灶）。
 *  - 库里 `created_at`/`paid_at` 全是 SQLite `datetime('now')`＝**UTC**。窗口比较只在 SQL 里用
 *    `datetime('now', '-30 days')` 同一把尺子做，⛔ 不与东八区日期串比；只有给用户看的那一刻才转东八区。
 *  - 重放引擎算报告时 `incrementHitCount` 一律传 **false**：领取可能重复发生（重试、多设备），
 *    抬 `rule_groups.hit_count` 等于用支付回调污染第四/第九阶段回归脚本的自变量。
 */
const db = require('../db/init')
const { buildRecommendation } = require('./recommendEngine')
const { beijingTimestamp } = require('../utils/beijingTime')

/**
 * 在线支付「镜像凭证」的判据（与下面 JS 侧的 `isOnlineMirror()` 同一条，⛔ 不另起一把尺子）。
 *
 * 🔴 第十四阶段·第一步 组4 的**真钱测单**（2026-10-22 支付宝 0.01 元到账）抓到的洞：
 * 这把尺子原来**只认 `admin_note` 前缀**，而那个前缀是 `markPaid` 写进去的
 * （`routes/payment.js:226-229`），后台审核口 `POST /admin/:id/status`（`routes/payment.js:622-681`）
 * 却把整列覆盖成后台备注框里的内容——框里没字就覆盖成空串 ⇒ 判据当场失效。
 * 现量：那笔 0.01 元付完、又在后台点了一次「通过」之后，`entitlement` 回
 * `granted 2／paid_orders 1／proof_approved 1`，`claimable_proofs` 里多出 `deposit_id 1`，
 * 按 `?proof=1` **真领出了第二份报告**（在盘外副本上复现：报告行 id 2 与 id 3 同时在库）。
 * ⇒ 补一条**覆盖不掉的结构性判据**：在线到账的镜像行没有上传凭证（`proof_url` 为空），
 * 而人工那一路 `POST /deposit` 必须带图 ⇒ `proof_url` 空 ＋ 渠道是 `wechat`/`alipay` ＝ 镜像。
 * ⚠️ 这条不依赖任何一列能被后台改写，所以已经写坏的那一行（活库里此刻就是）不必改数据也自动归位。
 */
const ONLINE_MIRROR =
  "(admin_note LIKE '微信在线支付 %' OR admin_note LIKE '支付宝在线支付 %' OR ((proof_url IS NULL OR TRIM(proof_url) = '') AND channel IN ('wechat', 'alipay')))"

/** 30 天窗口（§七 的"近 30 天"那一组数） */
const WINDOW_DAYS = 30

/** 报告行认得出来的唯一键：`result.paid_report.out_trade_no`。`json_valid` 兜旧数据里的非 JSON 串。 */
function rpPath(key) {
  return (
    "CASE WHEN result IS NOT NULL AND json_valid(result) THEN json_extract(result, '$.paid_report." +
    key +
    "') END"
  )
}
// 🔴 外面一律以 `AND (…)` / `AND NOT (…)` 的形式拼接：少了这层括号，
// `NOT result IS NOT NULL AND …` 会先与 `result IS NOT NULL` 结合，NULL 快照那几行被误当成报告行排除。
const IS_REPORT =
  "(result IS NOT NULL AND json_valid(result) AND json_extract(result, '$.paid_report.out_trade_no') IS NOT NULL)"

/** UTC 串（'YYYY-MM-DD HH:MM:SS'）→ 东八区显示串。空值原样回 null，⛔ 不许回 1970。 */
function toBeijing(utcStr) {
  if (typeof utcStr !== 'string' || !utcStr.trim()) return null
  const d = new Date(utcStr.trim().replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : beijingTimestamp(d)
}

/**
 * 权益读数（§二）。`granted` ＝ 在线已付单数 ＋ 非镜像的人工已核凭证数。
 * 它**只用于显示**"还能领几份"；领取的硬约束是"一单一报"（`claimReport` 里按订单号判），
 * 这样两张账哪天口径对不上，被锁在门外的也不会是付了钱的人。
 */
function entitlement(userId) {
  const paid = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount_fen), 0) AS fen FROM payment_orders WHERE user_id = ? AND status = 'paid'",
    )
    .get(userId)
  const proof = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS yuan FROM deposits WHERE user_id = ? AND status = 'approved' AND NOT " +
        ONLINE_MIRROR,
    )
    .get(userId)
  const created = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount_fen), 0) AS fen FROM payment_orders WHERE user_id = ? AND status = 'created'",
    )
    .get(userId)
  const closed = db
    .prepare("SELECT COUNT(*) AS n FROM payment_orders WHERE user_id = ? AND status = 'closed'")
    .get(userId)
  const usedRow = db
    .prepare('SELECT COUNT(*) AS n FROM recommendation_logs WHERE user_id = ? AND ' + IS_REPORT)
    .get(userId)

  const paidReports = db
    .prepare(
      'SELECT id AS log_id, created_at AS generated_at, ' +
        rpPath('out_trade_no') +
        ' AS out_trade_no, ' +
        rpPath('amount_fen') +
        ' AS amount_fen, ' +
        rpPath('channel') +
        ' AS channel, ' +
        rpPath('source') +
        ' AS source, ' +
        rpPath('deposit_id') +
        ' AS deposit_id, ' +
        rpPath('paid_at') +
        ' AS paid_at, ' +
        rpPath('report_no') +
        ' AS report_no, ' +
        rpPath('basis_log_id') +
        ' AS basis_log_id FROM recommendation_logs WHERE user_id = ? AND ' +
        IS_REPORT +
        ' ORDER BY id ASC',
    )
    .all(userId)

  // 已付但还没领的订单（可领列表的真相源：直接从订单表来，⛔ 不从"报告行"反推）
  // 🔴 第十四阶段·第一步 C1：报告行的 `out_trade_no` 现在有两种——平台单号与 `DEPOSIT-<id>` 幂等键。
  // 算"订单还剩几份可领"时必须只数平台单号那一路，否则领完一份凭证报告会凭空吃掉一个订单额度。
  const claimed = new Set(
    paidReports
      .map((r) => r.out_trade_no)
      .filter((k) => typeof k === 'string' && k.length > 0 && !k.startsWith('DEPOSIT-')),
  )
  const claimedProofs = new Set(
    paidReports
      .map((r) => r.out_trade_no)
      .filter((k) => typeof k === 'string' && k.startsWith('DEPOSIT-'))
      .map((k) => Number(k.slice('DEPOSIT-'.length)))
      .filter((n) => Number.isInteger(n)),
  )
  const paidOrders = db
    .prepare(
      "SELECT out_trade_no, amount_fen, paid_at, transaction_id FROM payment_orders WHERE user_id = ? AND status = 'paid' ORDER BY id DESC",
    )
    .all(userId)
  const proofOrders = db
    .prepare(
      "SELECT id, amount, approved_at FROM deposits WHERE user_id = ? AND status = 'approved' AND NOT " +
        ONLINE_MIRROR +
        ' ORDER BY id ASC',
    )
    .all(userId)

  const granted = paid.n + proof.n
  const used = usedRow.n
  return {
    granted,
    used,
    // 只当提示用：paid_orders 与"已领"之差就是可领条数；凭证流那一路另有 `claimable_proofs`
    left: Math.max(0, paid.n - claimed.size),
    paid_orders: paid.n,
    paid_amount_yuan: Math.round(paid.fen) / 100,
    proof_granted: proof.n,
    // deposits.amount 是 REAL（存"元"），先乘回分再除 100，⛔ 不在服务层用浮点连加
    proof_amount_yuan: Math.round(proof.yuan * 100) / 100,
    created_orders: created.n,
    // 🔴 第十四阶段·第一步 C1 现量到的漏项：`routes/payment.js:127` 一直在读
    // `e.created_amount_yuan`，而这里从来没给过 ⇒ 「待付金额」在顾客端恒为 `undefined`（JSON 直接掉键）。
    created_amount_yuan: Math.round(created.fen) / 100,
    closed_orders: closed.n,
    reports: paidReports.map((r) => ({
      log_id: r.log_id,
      out_trade_no: r.out_trade_no,
      // 凭证流的 `out_trade_no` 是内部幂等键，不是平台单号 ⇒ 前端拿这个布尔决定"要不要显示成单号"
      is_platform_order_no:
        typeof r.out_trade_no === 'string' && !r.out_trade_no.startsWith('DEPOSIT-'),
      source: r.source ?? (r.deposit_id != null ? 'manual_deposit' : 'online_order'),
      deposit_id: r.deposit_id ?? null,
      amount_yuan: r.amount_fen == null ? null : Number(r.amount_fen) / 100,
      channel: r.channel,
      paid_at: r.paid_at,
      paid_at_beijing: toBeijing(r.paid_at),
      generated_at: r.generated_at,
      generated_at_beijing: toBeijing(r.generated_at),
      report_no: r.report_no,
      basis_log_id: r.basis_log_id,
    })),
    claimable: paidOrders
      .filter((o) => !claimed.has(o.out_trade_no))
      .map((o) => ({
        out_trade_no: o.out_trade_no,
        amount_yuan: o.amount_fen / 100,
        paid_at: o.paid_at,
        paid_at_beijing: toBeijing(o.paid_at),
      })),
    // 🔴 待领取的人工凭证（C1 的正解：`pay.html` 承诺"人工确认后就能领"，这里必须给得出入口）
    claimable_proofs: proofOrders
      .filter((d) => !claimedProofs.has(d.id))
      .map((d) => ({
        deposit_id: d.id,
        amount_yuan: Math.round(Number(d.amount || 0) * 100) / 100,
        paid_at: d.approved_at,
        paid_at_beijing: toBeijing(d.approved_at),
      })),
    claimed_orders: paidOrders.filter((o) => claimed.has(o.out_trade_no)).length,
  }
}

/** 这一单在这个人名下已经生成的那一份（幂等查据） */
function findReport(userId, outTradeNo) {
  return db
    .prepare(
      'SELECT id FROM recommendation_logs WHERE user_id = ? AND ' +
        IS_REPORT +
        " AND json_extract(result, '$.paid_report.out_trade_no') = ?",
    )
    .get(userId, outTradeNo)
}

/**
 * 最近一条**不是报告**的推荐日志＝报告的重放依据（§四 409 那条的唯一判据）。
 *
 * 🔴 第十二阶段·第一步 一g（真浏览器点验时发现的洞，见 `docs/依据/20` §十二）：
 * 门店快速模式走的是 `POST /api/customer/session/:sid/recommend`，那条样本的归属只有
 * `session_id`（= `sess_…` 这种门店会话号），**`user_id` 是 NULL**——`customer_sessions` 表根本没有
 * `user_id` 列（现量 `db/schema.sql:269-278`），写进去的 `user_id` 想有也没有。
 * 所以只按 `user_id` 找会一律 409：顾客付了钱、也填了表，系统却说"你还没生成过方案"。
 * 正解沿用本仓既有口径（`routes/recommend.js:97-110` 与日记/衣橱都是"会话 ∪ 用户"并集认人）：
 * 给了 `basisSessionId` 就并上这一档，⛔ 不放宽到全表。
 *
 * 安全边界照原来的模型，没有新增：这条号本来就是那台浏览器的凭据（前端拿它读写这次会话），
 * 128 位随机串，猜不到别人的；报告行落在**付款人自己**名下，⛔ 不动那次门店会话的任何数据。
 */
function findBasis(userId, basisSessionId) {
  const sid =
    typeof basisSessionId === 'string' && basisSessionId.trim() ? basisSessionId.trim() : null
  if (!sid) {
    return db
      .prepare(
        'SELECT id, mode, store_id, session_id, input_snapshot, created_at FROM recommendation_logs WHERE user_id = ? AND NOT ' +
          IS_REPORT +
          ' ORDER BY id DESC LIMIT 1',
      )
      .get(userId)
  }
  return db
    .prepare(
      'SELECT id, mode, store_id, session_id, input_snapshot, created_at FROM recommendation_logs WHERE (user_id = ? OR session_id = ?) AND NOT ' +
        IS_REPORT +
        ' ORDER BY id DESC LIMIT 1',
    )
    .get(userId, sid)
}

/**
 * 「到账事实」的两条来路，收敛成同一个形状交给 `deliver` 用。
 *
 * 🔴 第十四阶段·第一步 C1（`docs/依据/22` §十）：`app/public/pay.html:52/64/70` 三处对顾客承诺（10-30 窄屏补正在这三处之前插了 7 行 CSS，原号 45/57/63；按内容回读这三行一字未动。本行**净零加行**，因为 `docs/依据/22` 正按行号引本文件）
 * 「扫备用收款码＋上传截图＋我们人工确认后，就能回展厅「我的报告」领取这份细账」，
 * 而本文件原来**只认 `payment_orders`**（`claimReport` 第一句就是 `SELECT * FROM payment_orders`），
 * 后台审核口（`routes/payment.js:622-681`）又只 `UPDATE deposits`、⛔ 一行订单都不写
 * （`INSERT INTO payment_orders` 全仓只有在线下单那两处：`payment.js:247`/`:371`）。
 * ⇒ 照承诺做了的顾客**必然 404**，而钱是真到账了。这不是文案问题，是账与承诺两套。
 *
 * 两条出路里选了这条窄的：**领取口承认已审核的凭证，但⛔ 不往 `payment_orders` 补一行**。
 * 补那一行等于我用代码替站长把"人工收到钱"记进营收读数（`businessSummary` 的 `pay_rate` 分母就是它），
 * 那属于 §十一 待裁第 2 条，归他拍。现在这样：钱能领到、账上看得清是人工确认的那笔、营收读数一个字没变。
 *
 * `ONLINE_MIRROR` 那把尺子在这里同样生效：在线支付到账时 `markPaid` 会往 `deposits` 插一条
 * `approved` 镜像（`payment.js:226-229`），那笔钱已经有订单号了，⛔ 不能再按凭证领第二遍。
 *
 * @returns {{code:number, error:string, reason:string} | {grant:{key:string, amount_fen:number|null,
 *          paid_at:string|null, channel:string, source:string, deposit_id:number|null}}}
 */
function resolveOrderGrant({ userId, outTradeNo }) {
  const order = db
    .prepare('SELECT * FROM payment_orders WHERE out_trade_no = ?')
    .get(String(outTradeNo || ''))
  if (!order || order.user_id !== userId) {
    return { code: 404, error: '订单不存在或不属于当前会话', reason: 'not_found' }
  }
  if (order.status !== 'paid') {
    return { code: 403, error: '这笔订单还没到账，付完成后即可领取', reason: 'not_paid' }
  }
  return {
    grant: {
      key: order.out_trade_no,
      amount_fen: order.amount_fen,
      paid_at: order.paid_at,
      channel: String(order.out_trade_no || '').startsWith('A3') ? 'alipay' : 'wechat',
      source: 'online_order',
      deposit_id: null,
    },
  }
}

function resolveProofGrant({ userId, depositId }) {
  const id = Number(depositId)
  if (!Number.isInteger(id) || id <= 0) {
    return { code: 400, error: '凭证编号必须是正整数', reason: 'bad_deposit_id' }
  }
  // 先只按 id 查一次，为的是"不存在"与"不是你的"能合并成同一句话（⛔ 不告诉探测者这单存在但不是你的）
  const bare = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id)
  if (!bare || bare.user_id !== userId) {
    return { code: 404, error: '付款凭证不存在或不属于当前账号', reason: 'not_found' }
  }
  if (bare.status !== 'approved') {
    return {
      code: 403,
      error:
        '这笔凭证现在还是「' +
        (bare.status === 'pending' ? '待人工确认' : '已拒绝') +
        '」，确认到账后即可领取。',
      reason: 'not_paid',
    }
  }
  if (isOnlineMirror(bare)) {
    return {
      code: 403,
      error: '这笔是在线支付自动生成的记录，钱已经到账，请用订单号领取这一份。',
      reason: 'online_mirror',
    }
  }
  return {
    grant: {
      // 幂等键：凭证流的钱没有平台单号，用 `DEPOSIT-<id>` 当这一份的唯一键（⛔ 不冒充商户单号写进订单表）
      key: 'DEPOSIT-' + id,
      // `deposits.amount` 是 REAL 且单位是**元**，转成分交给下游同一把尺子
      amount_fen: Math.round(Number(bare.amount || 0) * 100),
      paid_at: bare.approved_at,
      channel: 'manual',
      source: 'manual_deposit',
      deposit_id: id,
    },
  }
}

/** `ONLINE_MIRROR` 那句 SQL 的同一判据，这里要的是 JS 侧一次判断（两处口径必须同源） */
const ONLINE_MIRROR_RE = /^(微信|支付宝)在线支付 /

/**
 * 这一行 `deposits` 是不是**在线支付自动生成的镜像凭证**（与上面 `ONLINE_MIRROR` 那段 SQL 同一条尺子）。
 * 两条判据任一成立即算镜像，⛔ 两条都要成立才拦得住：
 *  ① `admin_note` 的 `支付宝在线支付 ` / `微信在线支付 ` 前缀＝`markPaid` 写进去的原样；
 *  ② 没有上传凭证（`proof_url` 为空）＋渠道是 `wechat`/`alipay`＝结构性判据，
 *     后台审核口把 `admin_note` 覆盖成空串也覆盖不掉它（真钱测单抓到的就是这一种）。
 * 人工上传那一路 `POST /deposit` 必须带图，所以 ② 不会把真凭证误当成镜像。
 * @param {{admin_note?: string|null, proof_url?: string|null, channel?: string|null}|null} row
 */
function isOnlineMirror(row) {
  if (!row) return false
  if (ONLINE_MIRROR_RE.test(row.admin_note || '')) return true
  const hasProof = String(row.proof_url || '').trim().length > 0
  return !hasProof && (row.channel === 'wechat' || row.channel === 'alipay')
}

/**
 * 领取（或复读）这份深度细账。到账事实来自**在线订单**。
 * `basisSessionId`＝这次填表用的门店会话号（可空；门店快速模式那条样本只有会话号、没有 user_id，
 * 不带上它，付了款的门店顾客会一律撞 409，判据见上面 `findBasis` 那段）。
 * @returns {{code:number, data?:object, error?:string, reason?:string}}
 *   404 订单不存在**或不属于当前身份**（两种合并同一句话，⛔ 不告诉探测者"这单存在但不是你的"）
 *   403 这一单还没到账（`created`/`closed` 都算没付）
 *   409 名下没有任何可重放的方案记录（硬规矩 2 的引申：⛔ 不许拿空画像硬出一份报告）
 *   500 生成或落库失败
 */
function claimReport({ userId, sessionId, outTradeNo, basisSessionId }) {
  const r = resolveOrderGrant({ userId, outTradeNo })
  if (r.code) return r
  return deliver(r.grant, { userId, sessionId, basisSessionId })
}

/** 第十四阶段·第一步 C1：同一份交付，到账事实来自**已人工确认的凭证** */
function claimReportByProof({ userId, sessionId, depositId, basisSessionId }) {
  const r = resolveProofGrant({ userId, depositId })
  if (r.code) return r
  return deliver(r.grant, { userId, sessionId, basisSessionId })
}

function deliver(grant, { userId, sessionId, basisSessionId }) {
  // 幂等：这一笔已经生成过就直接返回那一行，⛔ 不重算、⛔ 不新增
  const existing = findReport(userId, grant.key)
  if (existing) return replay(existing.id, userId)

  const basis = findBasis(userId, basisSessionId)
  let profile = null
  if (basis && typeof basis.input_snapshot === 'string' && basis.input_snapshot.trim()) {
    try {
      const parsed = JSON.parse(basis.input_snapshot)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) profile = parsed
    } catch {
      profile = null // 快照坏了就当没有：宁缺不猜，交给下面那条 409
    }
  }
  if (!profile || Object.keys(profile).length === 0) {
    return {
      code: 409,
      error: '还没有可用于生成报告的方案记录，请先在展厅生成一次方案，再回到这里领取。',
      reason: 'no_basis',
    }
  }

  const mode = basis.mode === 'personal' ? 'personal' : 'store'
  // `session_id` 那列 NOT NULL，而且它是"上次填的表单"预填的查询键之一：
  // 塞空串会让这一行与别的空串行混在一起（同 profileArchive.js:500-501 那段拒绝兜底串的理由（🔴 10-30 按内容重指：原写 390＝空行）），
  // 所以只准用本次请求的身份串，取不到就干脆不落库——宁可不发报告，不能发一份归属不明的报告。
  const sid = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null
  if (!sid) {
    return { code: 400, error: '缺少会话标识，无法登记这份报告', reason: 'no_session' }
  }
  let result
  try {
    // 第 3 参 incrementHitCount＝false（本文件开头那条）；第 5 参那两个开关见 docs/依据/20 §五
    result = buildRecommendation(
      profile,
      mode,
      false,
      { sessionId, userId },
      {
        deep_analysis: true,
        keep_ranked_out: true,
      },
    )
  } catch (err) {
    console.error('[交付] 报告生成失败:', err)
    return { code: 500, error: '报告生成失败，请稍后再试', reason: 'engine_failed' }
  }

  const usedRow = db
    .prepare('SELECT COUNT(*) AS n FROM recommendation_logs WHERE user_id = ? AND ' + IS_REPORT)
    .get(userId)

  // 生成时刻与 `paid_at`、`created_at` 必须同一把轴（都是 SQLite `datetime('now')`＝UTC），
  // ⛔ 不许在这里塞 `toISOString()` 或东八区串：payment.js:666-668 那条"同一列两种格式、
  // 按时间排序时 ISO 的 'T' 恒大于空格"的坑就是这么来的。给用户看的东八区由 `toBeijing` 现转。
  const grantedAt = db.prepare("SELECT datetime('now') AS t").get().t

  // 🔴 第十四阶段·第一步 C1：这一段原来直接读 `order.*`，现在两条来路共用一个 `grant`。
  // `paid_report.out_trade_no` 存的是**幂等键**（在线＝平台商户单号；人工凭证＝`DEPOSIT-<id>`），
  // 所以 `findReport`/`IS_REPORT` 那把尺子对两条路同一条判断，⛔ 不为凭证流另建一份状态。
  // 人工凭证那一路⛔ 不写 `payment_orders`：那张表是老板看实收的唯一出处，往里塞伪造单号
  // 等于把"人工确认到账"混进"在线支付到账"，改了读数的语义（立为 `22` §十一 待裁第 2 条）。
  result.paid_report = {
    out_trade_no: grant.key,
    amount_fen: grant.amount_fen,
    channel: grant.channel,
    source: grant.source,
    deposit_id: grant.deposit_id ?? null,
    // 只有在线那一路的 `out_trade_no` 真的是平台单号；凭证流那个是内部幂等键，前端不许当单号展示
    is_platform_order_no: grant.source === 'online_order',
    paid_at: grant.paid_at,
    granted_at: grantedAt,
    report_no: usedRow.n + 1,
    basis_log_id: basis.id,
    basis_input_at: basis.created_at,
    mode,
    sections: ['ledger', 'analysis', 'measure', 'params', 'receipt'],
  }

  // 生成与插入之间不重查会怎样？同一进程里 better-sqlite3 是同步执行，两个并发请求不会交错，
  // 但事务里再查一次可以把"以后改成异步"这条风险也挡住，代价是一行 SELECT。
  let logId = null
  try {
    logId = db.transaction(() => {
      const raced = findReport(userId, grant.key)
      if (raced) return raced.id
      const info = db
        .prepare(
          `INSERT INTO recommendation_logs (session_id, user_id, store_id, mode, input_snapshot, result)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sid,
          userId,
          basis.store_id ?? null,
          mode,
          basis.input_snapshot,
          JSON.stringify(result),
        )
      return Number(info.lastInsertRowid)
    })()
  } catch (err) {
    console.error('[交付] 报告落库失败:', err)
    return { code: 500, error: '报告保存失败，请稍后再试', reason: 'insert_failed' }
  }

  return { code: 200, data: { report: result, profile, mode, log_id: logId, fresh: true } }
}

/** 复读已存在的那一份（⛔ 不重算，所以也不会再抬任何计数） */
function replay(logId, userId) {
  const row = db
    .prepare(
      'SELECT id, mode, input_snapshot, result FROM recommendation_logs WHERE id = ? AND user_id = ?',
    )
    .get(logId, userId)
  if (!row) return { code: 404, error: '订单不存在或不属于当前会话', reason: 'not_found' }
  let report = null
  let profile = null
  try {
    report = JSON.parse(row.result)
  } catch {
    report = null
  }
  try {
    profile = JSON.parse(row.input_snapshot)
  } catch {
    profile = null
  }
  if (!report || !report.paid_report) {
    console.error('[交付] 报告行读不出结构:', logId)
    return { code: 500, error: '报告已损坏，请联系客服', reason: 'corrupt' }
  }
  return { code: 200, data: { report, profile, mode: row.mode, log_id: row.id, fresh: false } }
}

/**
 * 后台三张卡的读数（§七）。全部是**累计**与**近 30 天**两组同轴数字，
 * 窗口只在 SQL 里用 `datetime('now', '-30 days')` 比（UTC 与 UTC 同尺，⛔ 不与东八区串比）。
 * 分母为 0 的比值回 `null`（前端显示「—」）——把"没数据"显示成"转化 0%"是假读数。
 */
function businessSummary() {
  const bucket = (since) => {
    const w = since ? "AND created_at >= datetime('now', ?)" : ''
    const p = since ? [since] : []
    const order = (status) =>
      db
        .prepare(
          'SELECT COUNT(*) AS n, COALESCE(SUM(amount_fen), 0) AS fen, COUNT(DISTINCT user_id) AS payers FROM payment_orders WHERE status = ? ' +
            w,
        )
        .get(status, ...p)
    const dep = (status) =>
      db
        .prepare(
          'SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS yuan FROM deposits WHERE status = ? ' +
            w,
        )
        .get(status, ...p)
    const paid = order('paid')
    const created = order('created')
    const closed = order('closed')
    const proofApproved = dep('approved')
    const proofPending = dep('pending')
    const proofRejected = dep('rejected')
    // 人工凭证流那一路的实收：剔掉在线支付镜像，否则一笔钱数两遍（本文件开头那条）
    const proofManual = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS yuan FROM deposits WHERE status = 'approved' AND NOT " +
          ONLINE_MIRROR +
          (since ? " AND created_at >= datetime('now', ?)" : ''),
      )
      .get(...p)
    const claims = db
      .prepare(
        'SELECT COUNT(*) AS n FROM recommendation_logs WHERE ' +
          IS_REPORT +
          (since ? " AND created_at >= datetime('now', ?)" : ''),
      )
      .get(...p)
    const lastPaid = db
      .prepare("SELECT MAX(paid_at) AS t FROM payment_orders WHERE status = 'paid' " + w)
      .get(...p)
    // 🔴 第十四阶段·第一步 C1：领取现在也可能来自人工凭证那一路，判据＝幂等键前缀 `DEPOSIT-`
    // （用 LIKE 而⛔ 不用 `$.paid_report.source`：上一版报告行没有 source 键，LIKE 对新旧都行）
    const claimsManual = db
      .prepare(
        'SELECT COUNT(*) AS n FROM recommendation_logs WHERE ' +
          IS_REPORT +
          " AND json_extract(result, '$.paid_report.out_trade_no') LIKE 'DEPOSIT-%'" +
          (since ? " AND created_at >= datetime('now', ?)" : ''),
      )
      .get(...p)
    const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null)
    const ordersTotal = paid.n + created.n + closed.n
    const proofTotal = proofApproved.n + proofPending.n + proofRejected.n
    // 🔴 C3：分母跟着比值一起出门。原来卡片只有「支付率 60.0%」这一句，老板看不出
    // "3/5"还是"300/500"，也无法复核；把分母算在服务层（⛔ 让前端再算＝第二把尺子）。
    const claimAllDen = paid.n + proofManual.n
    return {
      paid_orders: paid.n,
      paid_amount_yuan: paid.fen / 100,
      payers: paid.payers,
      created_orders: created.n,
      created_amount_yuan: created.fen / 100,
      closed_orders: closed.n,
      closed_amount_yuan: closed.fen / 100,
      proof_approved: proofApproved.n,
      proof_pending: proofPending.n,
      proof_rejected: proofRejected.n,
      proof_manual_orders: proofManual.n,
      proof_manual_yuan: Math.round(proofManual.yuan * 100) / 100,
      claims: claims.n,
      claims_manual: claimsManual.n,
      // 在线那一路的领取数（`claim_rate` 真正的分子）。⛔ 让后台用 `claims - claims_manual` 现减，
      // 那是在第二把尺子上算数；这里减一次，服务层仍是唯一出处。
      claims_online: claims.n - claimsManual.n,
      last_paid_at: lastPaid && lastPaid.t ? lastPaid.t : null,
      last_paid_at_beijing: lastPaid && lastPaid.t ? toBeijing(lastPaid.t) : null,
      pay_rate: ratio(paid.n, ordersTotal),
      // 🔴 C1 起的口径变更（写在 `22` §十 与本文件末尾待裁第 2 条）：分子换成**在线那一路**的领取数。
      // 原来这里用全部报告行数除 `paid` 单数——凭证流上线后同一份报告会既进分子又不进分母，
      // 极端情况能报出 150% 这种假读数。含两条路的总领取率另出一个键 `claim_all_rate`。
      claim_rate: ratio(claims.n - claimsManual.n, paid.n),
      proof_pass_rate: ratio(proofApproved.n, proofTotal),
      // 三条比值各自的分母（C3）。`claim_all_rate` 是 C1 之后才成立的那条：
      // 到账笔数＝在线单数＋人工凭证笔数，⛔ 用 `claim_rate` 的旧分母去除含凭证的分子。
      pay_rate_den: ordersTotal,
      claim_rate_den: paid.n,
      proof_pass_rate_den: proofTotal,
      claim_all_rate: ratio(claims.n, claimAllDen),
      claim_all_rate_den: claimAllDen,
    }
  }
  return {
    window_days: WINDOW_DAYS,
    // 时间口径写进响应：库里全是 UTC，读数说明白了才不会有人拿东八区日期去对这张卡
    time_axis: 'UTC（SQLite datetime(now)）；*_beijing 字段才是东八区',
    cumulative: bucket(null),
    last_30_days: bucket('-' + WINDOW_DAYS + ' days'),
  }
}

/**
 * S6 滚动清理（10-19 蓝图短期项，10-23 落）：免费场样本保留 90 天，付费报告行**永久豁免**。
 * 判据就是本文件 `:59` 那把 `IS_REPORT`，⛔ 不在别处复制第二份谓词。
 * 被清掉的是"领取重放用的依据行"：付款人隔了 90 天以上再来领，会得到既有的 409 话术
 * （"请先在展厅生成一次方案"）而不是错拿旧档——报告本体不受影响（它的快照在报告行自己身上，
 * `deliver()` 插入时复制了一份 `input_snapshot`）。
 * 时间轴与全库同尺：SQLite `datetime('now')` 的 UTC 串，⛔ 不许在这里塞 ISO 或东八区串
 * （`:470` 上方那段注释说透了为什么）。
 * @param {number} days 保留天数（默认 90，测试传小值）
 * @returns {number} 删除行数
 */
function pruneOldLogs(days = 90) {
  const d = Number.isInteger(days) && days >= 1 ? days : 90
  const cutoff = db.prepare("SELECT datetime('now', ?) AS t").get(`-${d} days`).t
  const info = db
    .prepare(
      'DELETE FROM recommendation_logs WHERE created_at IS NOT NULL AND created_at < ? AND NOT ' +
        IS_REPORT,
    )
    .run(cutoff)
  return info.changes
}

module.exports = {
  entitlement,
  claimReport,
  claimReportByProof,
  findReport,
  findBasis,
  businessSummary,
  toBeijing,
  ONLINE_MIRROR,
  isOnlineMirror,
  pruneOldLogs,
}
