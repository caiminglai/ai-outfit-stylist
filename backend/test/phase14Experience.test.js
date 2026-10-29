/**
 * 第十四阶段·第一步 采集/交付两处的行为测试（2026-10-22 一f）
 *
 * 规范出处：`docs/依据/22-用户体验与商业模式输入输出规范-20261022.md` §五（X4 规则星可撤）、
 * §十（C1 人工凭证也能领）、§十一 待裁第 2 条（C3 分母跟着比值一起出门）。
 *
 * 为什么单独开一个文件（与 `phase13CollectionRoutes.test.js` 同一个理由）：
 * `/feedback/*` 那把桶是 60 次/分钟、按 IP 计，本文件要打的反馈与领取次数都不少；
 * `node --test` 每文件一个进程 ⇒ 新文件有自己一整窗额度，⛔ 不把两边的额度叠进同一扇窗。
 *
 * 钉死这三组事（全是**行为**证据：内存库替身＋临时实例真发 HTTP，⛔ 源码级钉桩）：
 *
 *  X4 撤规则星（`DELETE /api/recommend/feedback/group`）
 *   ① 自己那行 ⇒ `deleted:1`，`feedback_events` 里查不到了；
 *   ② **计数是从表里现数的，不是做减法**：先把 `rule_groups.feedback_up` 人为写成 9（库里常见的脏数），
 *      记 1 条 useful ⇒ 回 1；撤掉 ⇒ 回 0。减法实现会写成 8→7，这一条当场露馅；
 *   ③ 重复点「清除」⇒ 200＋`deleted:0`（幂等，前端按钮连点不许报错）；
 *   ④ 别人的那行 ⇒ 删不动，⛔ 不许顺手把 A 的也清掉；
 *   ⑤ 规则不存在（形状对、库里没）⇒ 404；形状不对 ⇒ 400；认不出身份 ⇒ 401 —— 三种说法⛔ 不合并；
 *   ⑥ 撤规则星**不碰** `item_feedback`（两层语义：这条规则准不准 ≠ 这件衣服穿得怎么样）。
 *
 *  C1 人工凭证领取（`claimReportByProof` ＋ `GET /api/payment/my?proof=<deposits.id>`）
 *   ⑦ `approved` 且非镜像 ⇒ 200，幂等键是 `DEPOSIT-<id>`，回执带 `source:'manual_deposit'`＋`deposit_id`，
 *      并给出 `is_platform_order_no:false`（前端据此决定这一行不许显示成商户单号）；
 *   ⑧ `pending`/`rejected` ⇒ 403，话里必须带「待人工确认」/「已拒绝」——这是"等一下再来"，不是"这单没有"；
 *   ⑨ 在线支付的**镜像行** ⇒ 403 另有一句（钱已经有一笔订单号了，⛔ 按凭证再领一份＝发两份报告）；
 *   ⑩ 别人的凭证 ⇒ **404**（与"不存在"同一句话，⛔ 不告诉探测者这行存在但不是他的）；id 形状不对 ⇒ 400；
 *   ⑪ 同一笔凭证领两次 ⇒ 同一行 `log_id`、日志表不增行；
 *   ⑫ **两份账不互相吃额度**：领掉一份凭证报告后，`entitlement.left`（只数平台单号那一路）不许跟着减 1，
 *      `claimable` 里那笔订单还在；`claimable_proofs` 领完就消失；
 *   ⑬ `created_amount_yuan` 必须在场（第十二阶段起 `routes/payment.js:125` 一直在读它，
 *      服务层没给过 ⇒ 顾客端「待付金额」恒为 undefined，这一条钉住那个 bug 不再回来）；
 *   ⑭ 路由分发：`?proof=` 数字才走凭证支；`?proof=abc` 当没带 ⇒ 落只读支（⛔ 拿它去拼一次领取）；
 *      只读支继续零写库。
 *
 *  C3 分母跟着比值一起出（`businessSummary`）
 *   ⑮ `claim_rate` 的分子是**在线那一路**（含凭证的总领取率另出 `claim_all_rate`）：
 *      造 1 笔在线已付＋1 笔人工凭证＋2 份报告 ⇒ 旧算法会报 2/1＝200%，新口径必须是 1/1＝100% 与 2/2＝100%；
 *   ⑯ 四条比值各带自己的 `*_den`，分母为 0 时比值回 null 且 `den` 回 0（前端显示「分母 0」而不是空白）。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 `test/paidReportService.test.js`、
 * `test/phase13CollectionRoutes.test.js` 同一套路），全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/phase14Experience.test.js（本文件自带内存库替身；环境若要求 STYLEAI_DB_PATH，指一个仓外路径即可，⛔ 指 backend/db/styleai.db）
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const express = require('express')
const PR = require('../services/paidReport')
const recommendRoutes = require('../routes/recommend')
const paymentRouter = require('../routes/payment')

const db = memDb

const SESS_A = 'sess-phase14-a'
const SESS_B = 'sess-phase14-b'

/** 两个人各有一条 `users` 行：`feedback_events.user_id` 与 `deposits.user_id` 都是 NOT NULL */
function ensureUser(sid, nickname) {
  db.prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run(sid, nickname)
  return db.prepare('SELECT id FROM users WHERE session_id = ?').get(sid).id
}
const UID_A = ensureUser(SESS_A, '十四A')
const UID_B = ensureUser(SESS_B, '十四B')

function addRule(name, up) {
  return Number(
    db
      .prepare(
        `INSERT INTO rule_groups (name, category, priority, feedback_up) VALUES (?, 'occasion', 1, ?)`,
      )
      .run(name, up == null ? 0 : up).lastInsertRowid,
  )
}

function addOrder(no, userId, status, fen = 9900) {
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, paid_at)
     VALUES (?, ?, '形象定制服务费', ?, ?, datetime('now'))`,
  ).run(no, userId, fen, status)
}

/** status 是人工那一路：`note` 决定它是不是在线支付自动生成的镜像行 */
function addProof(userId, status, yuan, note) {
  return Number(
    db
      .prepare(
        `INSERT INTO deposits (user_id, channel, amount, proof_url, status, admin_note, approved_at)
         VALUES (?, 'wechat', ?, '/uploads/p14.png', ?, ?, datetime('now'))`,
      )
      .run(userId, yuan, status, note).lastInsertRowid,
  )
}

const SNAP = { gender: '女', age: 29, height: 163, weight: 55, occasion: '职场' }

function addBasis(userId, sid, snapshot = SNAP) {
  return Number(
    db
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
         VALUES (?, ?, 'store', ?, '{"穿搭":[]}')`,
      )
      .run(sid, userId, JSON.stringify(snapshot)).lastInsertRowid,
  )
}

// ---------- X4：真发 HTTP 打 DELETE /feedback/group（限流桶是本进程独有的） ----------
const app = express()
app.use(express.json())
app.use('/api/recommend', recommendRoutes)

let server
let base = ''

async function call(method, route, session = SESS_A, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(session ? { 'X-Session-Id': session } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json || {} }
}

/** POST /feedback 的入参在 body 里（`routes/recommend.js:298`），⛔ 不是 query */
const postFeedback = (groupId, extra, session = SESS_A) =>
  call('POST', '/feedback', session, { group_id: groupId, ...extra })

function feedbackRow(userId, groupId) {
  return db
    .prepare('SELECT * FROM feedback_events WHERE user_id = ? AND group_id = ?')
    .get(userId, groupId)
}

const RULE_1 = addRule('十四阶段-可撤星', 0)
const RULE_2 = addRule('十四阶段-别人的星', 0)
const RULE_MIRROR = addRule('十四阶段-两层语义', 0)

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}/api/recommend`
})

test.after(() => {
  server.close()
  memDb.close()
})

// ============================================================
// §五 X4 规则星可以撤
// ============================================================

test('X4①② 撤自己那行 ⇒ deleted:1，计数从表里现数（⛔ 做减法）', async () => {
  // 库里常见的脏数：规则上写着 9 条好评，表里其实一条都没有
  db.prepare('UPDATE rule_groups SET feedback_up = 9 WHERE id = ?').run(RULE_1)
  const r1 = await postFeedback(RULE_1, {
    signal: 'useful',
    aesthetic_score: 4,
    fit_score: 5,
  })
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body).slice(0, 240))
  assert.ok(feedbackRow(UID_A, RULE_1), '打完星库里必须有行，否则下面那条删除什么都没验')
  assert.strictEqual(
    db.prepare('SELECT feedback_up FROM rule_groups WHERE id = ?').get(RULE_1).feedback_up,
    1,
    '记一条就应该现数是 1（写入侧本来就是重算，先把这一步钉住）',
  )

  const d = await call('DELETE', `/feedback/group?group_id=${RULE_1}`)
  assert.strictEqual(d.status, 200)
  assert.strictEqual(d.body.data.deleted, 1)
  assert.strictEqual(d.body.data.group_id, RULE_1)
  assert.strictEqual(feedbackRow(UID_A, RULE_1), undefined, '这一行要真没了')
  assert.strictEqual(
    db.prepare('SELECT feedback_up FROM rule_groups WHERE id = ?').get(RULE_1).feedback_up,
    0,
    '⛔ 减法实现会回 8：那张表的好评数必须从 feedback_events 现数出来',
  )
  assert.match(d.body.message, /已清除/)
})

test('X4③ 重复点「清除」⇒ 200＋deleted:0（幂等，⛔ 第二遍报错）', async () => {
  const again = await call('DELETE', `/feedback/group?group_id=${RULE_1}`)
  assert.strictEqual(again.status, 200)
  assert.strictEqual(again.body.data.deleted, 0)
  assert.match(again.body.message, /本来就没有/)
})

test('X4④ 别人的那行删不动，⛔ 顺手把 A 的也清掉', async () => {
  const ra = await postFeedback(RULE_2, { signal: 'useful', aesthetic_score: 3 })
  assert.strictEqual(ra.status, 200)
  const rb = await postFeedback(RULE_2, { signal: 'inaccurate' }, SESS_B)
  assert.strictEqual(rb.status, 200, JSON.stringify(rb.body).slice(0, 240))

  const d = await call('DELETE', `/feedback/group?group_id=${RULE_2}`, SESS_B)
  assert.strictEqual(d.status, 200)
  assert.strictEqual(d.body.data.deleted, 1, 'B 只能撤到 B 自己那一行')
  assert.ok(feedbackRow(UID_A, RULE_2), 'A 的那一行还在')
  assert.strictEqual(
    db.prepare('SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?').get(RULE_2)
      .feedback_up,
    1,
    'A 那条 useful 还在表里 ⇒ 重算出来还得是 1',
  )
})

test('X4⑤ 形状不对 400／库里没有 404／没身份 401，三种说法⛔ 不合并', async () => {
  for (const bad of ['abc', '0', '-3', '1.5', '']) {
    const r = await call('DELETE', `/feedback/group?group_id=${bad}`)
    assert.strictEqual(r.status, 400, `group_id＝${JSON.stringify(bad)} 该 400，实际 ${r.status}`)
    assert.match(r.body.error.message, /规则编号/)
  }
  const gone = await call('DELETE', '/feedback/group?group_id=424242')
  assert.strictEqual(gone.status, 404, '规则不存在＝这一条本身没有，与"没身份""编号写错"三回事')
  assert.match(gone.body.error.message, /规则不存在/)
  const anon = await call('DELETE', `/feedback/group?group_id=${RULE_1}`, null)
  assert.strictEqual(anon.status, 401)
  assert.match(anon.body.error.message, /识别不出你是谁/)
})

test('X4⑥ 撤规则星不碰 item_feedback（两层语义不许混）', async () => {
  const itemId = Number(
    db
      .prepare(
        `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type)
         VALUES (?, '十四阶段-雾霾蓝衬衫', 'top', '雾霾蓝', '合身')`,
      )
      .run(SESS_A).lastInsertRowid,
  )
  db.prepare(
    `INSERT INTO item_feedback (actor_key, wardrobe_item_id, aesthetic_score, fit_score)
     VALUES (?, ?, 4, 5)`,
  ).run('u' + UID_A, itemId)

  await postFeedback(RULE_MIRROR, { signal: 'useful', aesthetic_score: 2 })
  const d = await call('DELETE', `/feedback/group?group_id=${RULE_MIRROR}`)
  assert.strictEqual(d.body.data.deleted, 1)
  assert.ok(
    db
      .prepare('SELECT id FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?')
      .get('u' + UID_A, itemId),
    '⛔ 撤"这条规则准不准"不等于撤"这件衣服我穿得怎么样"',
  )
})

// ============================================================
// §十 C1 人工凭证也能领
// ============================================================

test('C1⑦ approved 且非镜像 ⇒ 200，幂等键 DEPOSIT-<id>，回执说清这一份的来路', () => {
  addBasis(UID_A, SESS_A)
  const pid = addProof(UID_A, 'approved', 99, '支付宝转账截图')
  const r = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: pid })
  assert.strictEqual(r.code, 200, JSON.stringify(r).slice(0, 300))
  assert.strictEqual(r.data.fresh, true)
  const rp = r.data.report.paid_report
  assert.strictEqual(
    rp.out_trade_no,
    'DEPOSIT-' + pid,
    '幂等键＝凭证行 id，⛔ 冒充商户单号写进订单表',
  )
  assert.strictEqual(rp.is_platform_order_no, false, '前端据此决定这一行不许显示成单号')
  assert.strictEqual(rp.source, 'manual_deposit')
  assert.strictEqual(rp.deposit_id, pid)
  assert.strictEqual(rp.amount_fen, 9900, 'deposits.amount 存的是元，出门前统一换算成分')
  assert.strictEqual(rp.channel, 'manual')
})

test('C1⑪ 同一笔凭证领两次 ⇒ 同一行 log_id，日志表不增行', () => {
  const before = db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n
  const pid = db
    .prepare(
      "SELECT id FROM deposits WHERE user_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1",
    )
    .get(UID_A).id
  const again = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: pid })
  assert.strictEqual(again.code, 200)
  assert.strictEqual(again.data.fresh, false, '第二次必须复读，⛔ 重算')
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n,
    before,
    '复读不许再插一行',
  )
})

test('C1⑧ pending / rejected ⇒ 403，话里带「待人工确认」「已拒绝」', () => {
  const p = addProof(UID_A, 'pending', 99, '')
  const pend = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: p })
  assert.strictEqual(pend.code, 403)
  assert.match(pend.error, /待人工确认/)
  const rj = addProof(UID_A, 'rejected', 99, '')
  const rej = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: rj })
  assert.strictEqual(rej.code, 403)
  assert.match(rej.error, /已拒绝/)
})

test('C1⑨ 在线支付的镜像行 ⇒ 403 另有一句：钱已经有订单号了，请用订单号领', () => {
  const mirror = addProof(UID_A, 'approved', 99, '微信在线支付 TXN-P14')
  const r = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: mirror })
  assert.strictEqual(r.code, 403)
  assert.strictEqual(r.reason, 'online_mirror')
  assert.match(r.error, /请用订单号领取/)
  assert.strictEqual(
    PR.entitlement(UID_A).proof_granted,
    1,
    '同一笔钱在权益读数里也只许数一次（镜像那行早就被 ONLINE_MIRROR 剔掉了）',
  )
})

test('C1⑩ 别人的凭证 404（⛔ 不告诉探测者这行存在但不是他的）／id 形状不对 400', () => {
  const mine = addProof(UID_A, 'approved', 99, '本人截图')
  const stolen = PR.claimReportByProof({ userId: UID_B, sessionId: SESS_B, depositId: mine })
  assert.strictEqual(stolen.code, 404)
  assert.match(stolen.error, /不存在或不属于当前账号/)
  for (const bad of [0, -1, 1.5, NaN, undefined, null, 'abc']) {
    const r = PR.claimReportByProof({ userId: UID_A, sessionId: SESS_A, depositId: bad })
    assert.strictEqual(r.code, 400, `depositId＝${String(bad)} 该 400`)
    assert.match(r.error, /正整数/)
  }
})

test('C1⑨b 没有方案快照 ⇒ 409（凭证到账了也不许拿空画像硬出报告）', () => {
  const pid = addProof(UID_B, 'approved', 99, '截图-无快照')
  const r = PR.claimReportByProof({ userId: UID_B, sessionId: SESS_B, depositId: pid })
  assert.strictEqual(r.code, 409, `实际 ${JSON.stringify(r).slice(0, 200)}`)
  assert.strictEqual(
    db
      .prepare(
        "SELECT COUNT(*) n FROM recommendation_logs WHERE user_id = ? AND result LIKE '%paid_report%'",
      )
      .get(UID_B).n,
    0,
    '被拒那一路一行都不许落',
  )
})

test('C1⑫ 两份账不互相吃额度：领掉一份凭证报告，订单那一路的 left 不许跟着减', () => {
  const uid = ensureUser('sess-p14-claim', '额度对照')
  addBasis(uid, 'sess-p14-claim')
  addOrder('S3P1400001', uid, 'paid')
  const pid = addProof(uid, 'approved', 99, '人工截图-额度对照')

  let e = PR.entitlement(uid)
  assert.strictEqual(e.granted, 2, '一笔在线 ＋ 一笔人工＝两份')
  assert.strictEqual(e.left, 1, 'left 只数平台单号那一路')
  assert.strictEqual(e.claimable.length, 1)
  assert.strictEqual(e.claimable_proofs.length, 1)
  assert.strictEqual(e.claimable_proofs[0].deposit_id, pid)

  PR.claimReportByProof({ userId: uid, sessionId: 'sess-p14-claim', depositId: pid })
  e = PR.entitlement(uid)
  assert.strictEqual(e.used, 1)
  assert.strictEqual(e.left, 1, '⛔ 凭证那一领就把订单额度吃掉：那笔钱还没领呢')
  assert.strictEqual(e.claimable.length, 1, '那笔订单还在可领列表里')
  assert.strictEqual(e.claimable_proofs.length, 0, '凭证领完了就从可领列表里消失')
  assert.strictEqual(e.reports[0].is_platform_order_no, false)
  assert.strictEqual(e.reports[0].source, 'manual_deposit')

  // 再领订单那一路：两份都齐了，left 才归 0
  PR.claimReport({ userId: uid, sessionId: 'sess-p14-claim', outTradeNo: 'S3P1400001' })
  const done = PR.entitlement(uid)
  assert.strictEqual(done.left, 0)
  assert.strictEqual(done.used, 2)
  assert.strictEqual(done.claimed_orders, 1)
})

test('C1⑬ created_amount_yuan 必须在场（payment.js:125 一直在读它）', () => {
  const uid = ensureUser('sess-p14-created', '待付读数')
  addOrder('S3P1400002', uid, 'created', 19900)
  const e = PR.entitlement(uid)
  assert.ok('created_amount_yuan' in e, '⛔ 键不存在＝顾客端「待付金额」恒为 undefined')
  assert.strictEqual(e.created_amount_yuan, 199)
  assert.strictEqual(e.created_orders, 1)
  assert.strictEqual(e.left, 0, '没到账的单不进权益')
})

// ---------- C1⑭ 路由分发：只认数字 proof，其余一律当没带 ----------

function findRoute(method, routePath) {
  for (const layer of paymentRouter.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    const p = r.path
    if (Array.isArray(p) ? p.includes(routePath) : p === routePath) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

/** 只调最后一个 handler＝业务本体；`loginRequired` 与 `reportLimiter` 都在这层之外 */
function callMy(userId, query = {}) {
  const route = findRoute('get', '/my')
  const handler = route.stack[route.stack.length - 1].handle
  const res = {
    statusCode: 200,
    body: null,
    status(c) {
      res.statusCode = c
      return res
    },
    json(b) {
      res.body = b
      return res
    },
    setHeader() {
      return res
    },
    getHeader() {
      return undefined
    },
    headersSent: false,
  }
  handler(
    {
      params: {},
      query,
      body: {},
      headers: { 'x-session-id': 'sess-p14-route' },
      ip: '9.9.9.9',
      socket: {},
      user: { id: userId, session_id: 'sess-p14-route' },
    },
    res,
    () => {},
  )
  return res
}

test('C1⑭ ?proof=<id> 走凭证支；?proof=abc 当没带 ⇒ 落只读支且零写库', () => {
  const uid = ensureUser('sess-p14-route', '路由分发')
  addBasis(uid, 'sess-p14-route')
  const pid = addProof(uid, 'approved', 99, '截图-路由')

  const logsBefore = db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n
  const junk = callMy(uid, { proof: 'abc' })
  assert.strictEqual(junk.statusCode, 200, '⛔ 一个写错的查询参数不该把只读页打成 400')
  assert.ok(junk.body.data.entitlement, '回的是只读支那份平铺读数')
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n,
    logsBefore,
    '只读支一行都不许写（第十二阶段矩阵 13 那条口径在这里继续成立）',
  )

  const got = callMy(uid, { proof: String(pid) })
  assert.strictEqual(got.statusCode, 200, JSON.stringify(got.body).slice(0, 300))
  assert.strictEqual(got.body.data.report.paid_report.out_trade_no, 'DEPOSIT-' + pid)

  // 别人的凭证经路由 ⇒ 与"不存在"同一句话
  const other = ensureUser('sess-p14-other', '探测者')
  const stolen = callMy(other, { proof: String(pid) })
  assert.strictEqual(stolen.statusCode, 404)
})

// ============================================================
// §十一 C3 分母跟着比值一起出门
// ============================================================

test('C3⑮ claim_rate 的分子只数在线那一路；含凭证的总领取率另出 claim_all_rate', () => {
  const uid = ensureUser('sess-p14-funnel', '漏斗对照')
  addBasis(uid, 'sess-p14-funnel')
  addOrder('S3P1400003', uid, 'paid', 9900)
  const pid = addProof(uid, 'approved', 99, '截图-漏斗')
  PR.claimReport({ userId: uid, sessionId: 'sess-p14-funnel', outTradeNo: 'S3P1400003' })
  PR.claimReportByProof({ userId: uid, sessionId: 'sess-p14-funnel', depositId: pid })

  // 这一格跑在别的用例之后，绝对数会随前面落的行变 ⇒ 只验**关系**：分子取哪一路、分母是谁
  const c = PR.businessSummary().cumulative
  const R = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null)
  assert.strictEqual(c.claims_manual + c.claims_online, c.claims, '两条路加起来才是总领取数')
  assert.ok(c.claims_manual >= 1, '本文件前面已经领过凭证报告，这里必须数得到（数不到＝判据失效）')
  assert.strictEqual(
    c.claim_rate,
    R(c.claims_online, c.paid_orders),
    '⛔ 分子用全部报告行：凭证流上线后同一份报告既进分子又不进分母，极端能报出 150%',
  )
  assert.strictEqual(c.claim_all_rate, R(c.claims, c.claim_all_rate_den))
  assert.notStrictEqual(
    c.claim_rate,
    R(c.claims, c.paid_orders),
    '这一条只在"有凭证领取且未领满订单"时才成立：两个数一样就说明分子没换成在线那一路',
  )
  assert.strictEqual(c.proof_manual_orders >= 1, true, '镜像行不进这一格（人工那一路才数）')
})

test('C3⑯ 四条比值各带自己的分母；den 为 0 时比必须回 null（⛔ 用 0 冒充 0%）', () => {
  const pairs = [
    ['pay_rate', 'pay_rate_den'],
    ['claim_rate', 'claim_rate_den'],
    ['proof_pass_rate', 'proof_pass_rate_den'],
    ['claim_all_rate', 'claim_all_rate_den'],
  ]
  for (const bucket of ['cumulative', 'last_30_days']) {
    const c = PR.businessSummary()[bucket]
    for (const [rate, den] of pairs) {
      assert.ok(
        den in c,
        `${bucket}.${den} 必须与比值同格出门（后台卡片要显示「分子 N / 分母 D」）`,
      )
      assert.strictEqual(typeof c[den], 'number', `${bucket}.${den} 得是个数，⛔ undefined`)
      if (c[den] === 0) {
        assert.strictEqual(c[rate], null, `${bucket}.${rate}：分母 0 却回了个数＝拿 0 冒充了读数`)
      } else {
        assert.strictEqual(typeof c[rate], 'number', `${bucket}.${rate}：分母不为 0 就该算得出数`)
      }
    }
    // 分母本身可复现：不是拍出来的数
    assert.strictEqual(c.pay_rate_den, c.paid_orders + c.created_orders + c.closed_orders)
    assert.strictEqual(c.claim_rate_den, c.paid_orders)
    assert.strictEqual(
      c.claim_all_rate_den,
      c.paid_orders + c.proof_manual_orders,
      '⛔ 把在线镜像也算进到账笔数：一笔钱数两遍，分母就虚了',
    )
    assert.strictEqual(c.proof_pass_rate_den, c.proof_approved + c.proof_pending + c.proof_rejected)
  }
})
