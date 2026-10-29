/**
 * 付款即交付·服务层行为测试（2026-10-21 第十二阶段·第一步 一g）
 *
 * 规范出处：`docs/依据/20-付款即交付输入输出规范-20261021.md` §九 验收矩阵第 1~6 条
 * （解锁真相源怎么数、幂等、三种错误码、重放不抬计数）。
 *
 * 钉死这四件事：
 *  ① **两张账不能相加**：`markPaid` 会往 `deposits` 插一条 `approved` 镜像，
 *     `entitlement` 必须按 `payment.js` 那把 `isOnlinePaid` 尺子把它剔掉——
 *     同一笔钱数两遍＝给顾客发两份报告；
 *  ② **幂等的键是订单号，不是计数器**：同一 `out_trade_no` 领两次必须回同一行 `log_id`，
 *     且 `recommendation_logs` 不增行（重试、多设备、刷新页面都不该再算一遍）；
 *  ③ **三种拒绝各有各的话**：别人的单＝404（与"不存在"同一句话，⛔ 不告诉探测者"这单存在但不是你的"）、
 *     没到账＝403、名下没有方案快照＝409；
 *  ④ **报告重放不抬 `hit_count`**：领取可能重复发生，一旦计次就等于用支付回调污染第四/第九阶段
 *     回归脚本的自变量（`scripts/regress-rank-weights.js` 读的就是这张表的分数来源）。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 `test/wardrobeDiaryWeatherRoutes.test.js` 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/paidReportService.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const PR = require('../services/paidReport')

const db = memDb

/** 造一个人（游客也有 users 行，权益就是挂在这行上） */
function newUser(sid) {
  return Number(db.prepare('INSERT INTO users (session_id) VALUES (?)').run(sid).lastInsertRowid)
}

function addOrder(no, userId, status, fen = 9900) {
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status, paid_at)
     VALUES (?, ?, '形象定制服务费', ?, ?, datetime('now'))`,
  ).run(no, userId, fen, status)
}

/** 一次方案记录＝报告的重放依据（`recommendation_logs.input_snapshot`） */
function addBasis(userId, sid, snapshot) {
  const r = db
    .prepare(
      `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
       VALUES (?, ?, 'store', ?, '{"穿搭":[]}')`,
    )
    .run(sid, userId, JSON.stringify(snapshot))
  return Number(r.lastInsertRowid)
}

const SNAP = { gender: '女', age: 29, height: 163, weight: 55, occasion: '职场' }

test('矩阵1：在线那笔只数一次（markPaid 的镜像凭证不往上加）', () => {
  const uid = newUser('sess-p12-1')
  addOrder('S3P1200001', uid, 'paid')
  // 这就是 markPaid 的第二笔写入：同一笔钱在 deposits 里也有一行 approved
  db.prepare(
    `INSERT INTO deposits (user_id, channel, amount, proof_url, status, admin_note, approved_at)
     VALUES (?, 'wechat', 99, '', 'approved', '微信在线支付 TXN-A', datetime('now'))`,
  ).run(uid)
  const e = PR.entitlement(uid)
  assert.strictEqual(e.granted, 1, '在线一笔 ⇒ granted 恰好 1，镜像那行不许顶成 2')
  assert.strictEqual(e.proof_granted, 0, '镜像必须被 ONLINE_MIRROR 剔掉')
  assert.strictEqual(e.paid_orders, 1)
  assert.strictEqual(e.left, 1)
})

test('矩阵2：人工凭证 approved 加一份、改判 rejected 回落', () => {
  const uid = newUser('sess-p12-2')
  const r = db
    .prepare(
      `INSERT INTO deposits (user_id, channel, amount, proof_url, status)
       VALUES (?, 'alipay', 99, '/uploads/x.png', 'approved')`,
    )
    .run(uid)
  assert.strictEqual(PR.entitlement(uid).granted, 1, '人工确认那一笔要算进权益')
  assert.strictEqual(PR.entitlement(uid).proof_granted, 1)
  // 后台把同一笔改成驳回（不是镜像、是人工那一行）⇒ 权益必须跟着回落
  db.prepare('UPDATE deposits SET status = ? WHERE id = ?').run('rejected', r.lastInsertRowid)
  assert.strictEqual(PR.entitlement(uid).granted, 0, 'rejected 的凭证不该还占着一份额度')
})

test('矩阵3：同一订单号领两次回同一行，日志表不增行', () => {
  const uid = newUser('sess-p12-3')
  addBasis(uid, 'sess-p12-3', SNAP)
  addOrder('S3P1200003', uid, 'paid')
  const first = PR.claimReport({ userId: uid, sessionId: 'sess-p12-3', outTradeNo: 'S3P1200003' })
  assert.strictEqual(first.code, 200)
  assert.strictEqual(first.data.fresh, true)
  const rowsAfterFirst = db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n
  const second = PR.claimReport({ userId: uid, sessionId: 'sess-p12-3', outTradeNo: 'S3P1200003' })
  assert.strictEqual(second.code, 200)
  assert.strictEqual(second.data.fresh, false, '第二次必须是复读，⛔ 不许重算')
  assert.strictEqual(second.data.log_id, first.data.log_id, '幂等键＝订单号：两次要落同一行')
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM recommendation_logs').get().n,
    rowsAfterFirst,
    '复读不许再插一行',
  )
  // 回执块必须自己带得出一笔钱对应一份报告（A/D/E 三节里 E 的全部内容物）
  const rp = second.data.report.paid_report
  assert.strictEqual(rp.out_trade_no, 'S3P1200003')
  assert.strictEqual(rp.amount_fen, 9900)
  assert.strictEqual(rp.channel, 'wechat', 'S3 前缀＝微信（与 payment.js 那把判据同一条）')
  assert.strictEqual(rp.basis_log_id, 1, '重放依据必须指回那次填的表')
  assert.deepStrictEqual(rp.sections, ['ledger', 'analysis', 'measure', 'params', 'receipt'])
})

test('矩阵4：别人的单 404、没到账的单 403，两句不许合并成一句', () => {
  const owner = newUser('sess-p12-4o')
  const thief = newUser('sess-p12-4t')
  addBasis(owner, 'sess-p12-4o', SNAP)
  addBasis(thief, 'sess-p12-4t', SNAP)
  addOrder('S3P1200004', owner, 'paid')
  const stolen = PR.claimReport({
    userId: thief,
    sessionId: 'sess-p12-4t',
    outTradeNo: 'S3P1200004',
  })
  assert.strictEqual(stolen.code, 404)
  assert.strictEqual(
    stolen.error,
    '订单不存在或不属于当前会话',
    '⛔ 不告诉探测者"这单存在但不是你的"',
  )
  addOrder('S3P1200005', thief, 'created')
  const unpaid = PR.claimReport({
    userId: thief,
    sessionId: 'sess-p12-4t',
    outTradeNo: 'S3P1200005',
  })
  assert.strictEqual(unpaid.code, 403, '没到账是"等一下再来"，不是"这单没有"')
})

test('矩阵5：名下没有方案快照 ⇒ 409，话术要给出路', () => {
  const uid = newUser('sess-p12-5')
  addOrder('S3P1200006', uid, 'paid')
  const r = PR.claimReport({ userId: uid, sessionId: 'sess-p12-5', outTradeNo: 'S3P1200006' })
  assert.strictEqual(r.code, 409, '硬规矩 2 的引申：⛔ 不许拿空画像硬出一份报告')
  assert.match(r.error, /先在展厅生成一次方案/)
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE user_id = ?').get(uid).n,
    0,
    '被拒的那一路一行都不许落',
  )
})

test('矩阵5b：门店那条样本只有会话号、没有 user_id ⇒ 带上会话号才领得到', () => {
  // 复现 `POST /api/customer/session/:sid/recommend` 写进去的那种行：
  // user_id 恒 NULL（customer_sessions 没这列），归属只认 session_id。
  const uid = newUser('sess-p12-5b')
  addOrder('S3P1200012', uid, 'paid')
  const storeSid = 'sess_store_only_5b'
  const basis = db
    .prepare(
      `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result)
       VALUES (?, NULL, 'store', ?, '{"穿搭":[]}')`,
    )
    .run(storeSid, JSON.stringify(SNAP))
  const basisId = Number(basis.lastInsertRowid)

  // 不带会话号＝改前的行为，必须是 409（这一条钉住"洞确实存在过、修法就是那一个参数"）
  const blind = PR.claimReport({ userId: uid, sessionId: 'sess-p12-5b', outTradeNo: 'S3P1200012' })
  assert.strictEqual(blind.code, 409, '⛔ 只按 user_id 查会一律 409，把付了钱的门店顾客关在门外')
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE session_id = ?').get('sess-p12-5b')
      .n,
    0,
    '被拒那一路不许在付款人名下留行',
  )

  const got = PR.claimReport({
    userId: uid,
    sessionId: 'sess-p12-5b',
    outTradeNo: 'S3P1200012',
    basisSessionId: storeSid,
  })
  assert.strictEqual(got.code, 200, '并集口径（会话 ∪ 用户）才认得出这次填表')
  assert.strictEqual(
    got.data.report.paid_report.basis_log_id,
    basisId,
    '重放依据要指回门店那条会话行',
  )

  // 带了的会话号查不到行 ⇒ 仍然 409，⛔ 不许因为多传了一个参数就退化成"全表捞最近一条"
  addOrder('S3P1200013', uid, 'paid')
  const stray = PR.claimReport({
    userId: uid,
    sessionId: 'sess-p12-5b',
    outTradeNo: 'S3P1200013',
    basisSessionId: 'sess_not_exist_5b',
  })
  assert.strictEqual(stray.code, 409, '别人的/不存在的会话号不该被当成自己的填表记录')
  // 上面那笔 409 落在同一个用户名下：确认它一行都没写
  assert.strictEqual(
    db
      .prepare(
        "SELECT COUNT(*) n FROM recommendation_logs WHERE user_id = ? AND result LIKE '%paid_report%'",
      )
      .get(uid).n,
    1,
    '名下只许有那一成功份报告，被拒的 409 一行都不落',
  )
})

test('矩阵6：领取重放不抬 hit_count（支付回调不许污染回归脚本的自变量）', () => {
  const uid = newUser('sess-p12-6')
  addBasis(uid, 'sess-p12-6', SNAP)
  addOrder('S3P1200007', uid, 'paid')
  const sum = () => db.prepare('SELECT COALESCE(SUM(hit_count),0) s FROM rule_groups').get().s
  const before = sum()
  const r = PR.claimReport({ userId: uid, sessionId: 'sess-p12-6', outTradeNo: 'S3P1200007' })
  assert.strictEqual(r.code, 200)
  assert.strictEqual(sum(), before, 'incrementHitCount 必须是 false')
  // 换一份快照再领第二单：重放吃的是"最近那条"，不是第一次那份
  const basis2 = addBasis(uid, 'sess-p12-6', { ...SNAP, occasion: '约会' })
  addOrder('S3P1200008', uid, 'paid')
  const r2 = PR.claimReport({ userId: uid, sessionId: 'sess-p12-6', outTradeNo: 'S3P1200008' })
  assert.strictEqual(r2.code, 200)
  assert.strictEqual(sum(), before, '第二份同样不抬计数')
  assert.strictEqual(
    r2.data.report.paid_report.basis_log_id,
    basis2,
    '第二份报告要指回它自己那次填表，⛔ 不许还挂着第一份',
  )
})

test('权益是现算的：报告行数变了，left/used 跟着变，⛔ 没有第二份状态', () => {
  const uid = newUser('sess-p12-7')
  addBasis(uid, 'sess-p12-7', SNAP)
  addOrder('S3P1200009', uid, 'paid')
  addOrder('S3P1200010', uid, 'paid')
  let e = PR.entitlement(uid)
  assert.strictEqual(e.granted, 2)
  assert.strictEqual(e.claimable.length, 2)
  PR.claimReport({ userId: uid, sessionId: 'sess-p12-7', outTradeNo: 'S3P1200009' })
  e = PR.entitlement(uid)
  assert.strictEqual(e.used, 1)
  assert.strictEqual(e.left, 1)
  assert.strictEqual(e.claimable.length, 1)
  assert.strictEqual(e.claimable[0].out_trade_no, 'S3P1200010')
  assert.strictEqual(e.reports.length, 1)
  assert.strictEqual(e.reports[0].out_trade_no, 'S3P1200009')
})

test('没有会话串就不落库：400 而不是塞一个空 session_id', () => {
  const uid = newUser('sess-p12-8')
  addBasis(uid, 'sess-p12-8', SNAP)
  addOrder('S3P1200011', uid, 'paid')
  const r = PR.claimReport({ userId: uid, sessionId: '', outTradeNo: 'S3P1200011' })
  assert.strictEqual(r.code, 400)
  // 只数这个人名下（⛔ 全表 LIKE：前面那几单的报告行会把这条断言顶成假通过）
  assert.strictEqual(
    db
      .prepare(
        "SELECT COUNT(*) n FROM recommendation_logs WHERE user_id = ? AND result LIKE '%paid_report%'",
      )
      .get(uid).n,
    0,
    '归属不明的报告行一条都不许有',
  )
  assert.strictEqual(PR.findReport(uid, 'S3P1200011'), undefined, '这一单没落任何报告行')
  assert.strictEqual(
    PR.entitlement(uid).left,
    1,
    '但权益还在：领取失败只是没做成，⛔ 不许把付了钱的人锁在门外',
  )
})

test('UTC 与东八区：库里存 UTC 串，出账才转东八区', () => {
  assert.strictEqual(PR.toBeijing(null), null, '空值原样回 null，⛔ 不许回 1970')
  assert.strictEqual(PR.toBeijing('  '), null)
  assert.strictEqual(PR.toBeijing('不是时间'), null)
  assert.strictEqual(PR.toBeijing('2026-10-21 00:11:33'), '2026-10-21 08:11:33')
})
