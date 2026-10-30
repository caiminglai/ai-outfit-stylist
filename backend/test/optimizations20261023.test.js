/**
 * 2026-10-23 优化轮（第十-十九蓝图短期项落地批次）的行为测试
 * ============================================================
 * 覆盖六件：
 *   S1  brighten 形状改为"中心化 0.5＋分母 80"（同明度不再恒 0）
 *   S5  hit_count 一场一次批量落库（改前 11~14 条独立 UPDATE）
 *   S6  免费场日志瘦身（result 只存名单＋前 3 名次快照）＋ 90 天滚动清理（报告行豁免）
 *   S9  GARMENT_REF.hps_to_waist_ratio 摘除后其余比例照旧出分
 *   DR1 POST /body 生理范围收界＋越界从静默 null 改成点名 400＋BMI/腰胸交叉判据
 *   DR1 追加 顾客真正在走的 PUT /archive 与 /body 共用同一份界（services/bodyLimits.js），
 *         草稿路径不回 400，改在返回里回 `rejected` 点名是哪一格
 * 断言全部落在真代码路径：db/init 换内存库替身（与 db/schema.sql 同源），
 * 路由只调最后一个业务 handler，不碰 backend/db/styleai.db、不起真端口。
 *
 * 运行: node --test test/optimizations20261023.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const { buildRecommendation } = require('../services/recommendEngine')
const { writeRecommendationLog, saveArchive } = require('../services/profileArchive')
const { pruneOldLogs } = require('../services/paidReport')
const { colorFit, SKIN_TONE_ANCHORS } = require('../services/colorMetrics')
const { GARMENT_REF, bodyDeviation, topFitBody } = require('../services/topFitBody')
const analysisRouter = require('../routes/analysis')

/** 按 method+path 找路由 */
function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    const p = r.path
    const hit = Array.isArray(p) ? p.includes(routePath) : p === routePath
    if (hit) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

/** 只调最后一个 handler（业务本体），返回 {statusCode, body} */
function call(route, opt = {}) {
  const { params = {}, query = {}, body = {}, user = null } = opt
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
  }
  handler({ params, query, body, headers: {}, ip: '1.1.1.1', socket: {}, user }, res, () => {})
  return res
}

function mkUser(tag) {
  return memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run(`优化轮-${tag}`, `sid-opt-20261023-${tag}`).lastInsertRowid
}

// ============================================================
// 一、S1：brighten 中心化新形状（同明度=0.5，暗 40 拉满、亮 40 归零，中段连续）
// ============================================================
test('S1：同明度的上衣不再被钉死 0 分，而是中性 50', () => {
  // "同明度"动态跟锚点不写死数值（10-29 重锚定后白皙 L=65.42，旧钉 68 必破）
  const r = colorFit('白皙', { L: SKIN_TONE_ANCHORS['白皙'].L, a: 0, b: 0 })
  assert.ok(r, 'lab 对象入口应出分')
  assert.strictEqual(r.brighten, 50)
})

test('S1：比脸亮的衣服在这轴有了区分度（改前一律恒 0）', () => {
  const white = colorFit('白皙', '白色')
  const yellow = colorFit('白皙', '亮黄')
  assert.ok(white.brighten > 0 && yellow.brighten > 0, '亮色不该再恒 0')
  assert.notStrictEqual(
    white.brighten,
    yellow.brighten,
    `白 ${white.brighten} 与亮黄 ${yellow.brighten} 应可区分`,
  )
})

test('S1：方向没翻——同档肤色下深色仍比浅色显白，暗 40 仍拉满 100', () => {
  const black = colorFit('白皙', '黑色')
  const white = colorFit('白皙', '白色')
  assert.ok(black.brighten > white.brighten)
  assert.strictEqual(black.brighten, 100)
})

// ============================================================
// 二、S5：hit_count 一场一次批量落库
// ============================================================
function seedRule(category, field, value, name) {
  const gid = memDb
    .prepare(
      `INSERT INTO rule_groups (name, mode, gender, category, scenario, priority, enabled, hit_count)
       VALUES (?, 'store', NULL, ?, NULL, 10, 1, 0)`,
    )
    .run(name, category).lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value, weight)
       VALUES (?, ?, 'eq', ?, 1)`,
    )
    .run(gid, field, value)
  memDb
    .prepare(
      `INSERT INTO rule_actions (group_id, action_type, content, sort_order) VALUES (?, 'reason', ?, 0)`,
    )
    .run(gid, `${name} 的理由`)
  return gid
}

test('S5：跨品类命中只发一条 UPDATE，且每条命中的组 hit_count 恰好 +1', () => {
  const g1 = seedRule('穿搭', 'ageGroup', '18-25', 'S5-穿搭组')
  const g2 = seedRule('妆容', 'region', 'south', 'S5-妆容组')
  const profile = { gender: '女', ageGroup: '18-25', region: 'south' }
  const hitOf = (id) =>
    memDb.prepare('SELECT hit_count FROM rule_groups WHERE id = ?').get(id).hit_count
  assert.strictEqual(hitOf(g1), 0)

  // spy：数 `UPDATE rule_groups SET hit_count` 真正 run 了几次（prepare 复用不算写）
  const origPrepare = memDb.prepare.bind(memDb)
  let writes = 0
  memDb.prepare = (sql) => {
    const st = origPrepare(sql)
    if (typeof sql === 'string' && sql.includes('UPDATE rule_groups SET hit_count')) {
      const run = st.run.bind(st)
      st.run = (...a) => {
        writes += 1
        return run(...a)
      }
    }
    return st
  }
  try {
    buildRecommendation(profile, 'store', true, { sessionId: 'sid-s5-20261023' })
  } finally {
    memDb.prepare = origPrepare
  }
  assert.ok(writes >= 1 && writes <= 2, `一场批量写次数应 ≤2，实测 ${writes}`)
  assert.strictEqual(hitOf(g1), 1, '穿搭组应恰好 +1')
  assert.strictEqual(hitOf(g2), 1, '妆容组应恰好 +1')
})

test('S5：incrementHitCount=false 的重放路径一行都不写（付费领取的既有守卫没被批量改造绕开）', () => {
  const gid = memDb
    .prepare(
      `INSERT INTO rule_groups (name, mode, gender, category, scenario, priority, enabled, hit_count)
       VALUES (?, 'store', NULL, '配饰', NULL, 10, 1, 7)`,
    )
    .run('S5-不计数组').lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, 'ageGroup', 'eq', '18-25', 1)`,
    )
    .run(gid)
  const origPrepare = memDb.prepare.bind(memDb)
  let writes = 0
  memDb.prepare = (sql) => {
    const st = origPrepare(sql)
    if (typeof sql === 'string' && sql.includes('UPDATE rule_groups SET hit_count')) {
      const run = st.run.bind(st)
      st.run = (...a) => {
        writes += 1
        return run(...a)
      }
    }
    return st
  }
  try {
    buildRecommendation({ gender: '女', ageGroup: '18-25' }, 'store', false, {
      sessionId: 'sid-s5-off',
    })
  } finally {
    memDb.prepare = origPrepare
  }
  assert.strictEqual(writes, 0, 'false 那一路不该有任何计数写')
  assert.strictEqual(
    memDb.prepare('SELECT hit_count FROM rule_groups WHERE id = ?').get(gid).hit_count,
    7,
  )
})

// ============================================================
// 三、S6：免费场日志瘦身＋90 天滚动清理（报告行豁免）
// ============================================================
test('S6：writeRecommendationLog 只存名单与前 3 名次快照，整行 result < 1 KB 且不含动作文案', () => {
  const bigReason =
    '把这条动作文案的每一个字都存下来是付费报告那一行的事，免费样本不该复制它'.repeat(20)
  const mkItem = (id) => ({
    group_id: id,
    group_name: `组${id}`,
    reason: bigReason,
    explanation: { hit: [bigReason] },
    rank: {
      score: 54.3,
      coverage: 0.67,
      dims: [
        { key: 'rule', score: 60 },
        { key: 'color', score: 45 },
        { key: 'body', score: null },
      ],
    },
  })
  const result = { 穿搭: [mkItem(5), mkItem(6), mkItem(7), mkItem(8)], 妆容: [], _mode: 'store' }
  const logId = writeRecommendationLog({
    sessionId: 'sid-s6-slim',
    userId: mkUser('s6'),
    mode: 'store',
    profile: { gender: '女', height_cm: 165, nickname: '不该留的我' },
    result,
  })
  assert.ok(logId, '样本应落库')
  const row = memDb
    .prepare('SELECT result, input_snapshot FROM recommendation_logs WHERE id = ?')
    .get(logId)
  assert.ok(row.result.length < 1024, `新行 result 应 < 1 KB，实测 ${row.result.length} B`)
  assert.ok(!row.result.includes('动作文案'), '瘦身后的 result 不该带动作长文')
  const j = JSON.parse(row.result)
  assert.strictEqual(j._log_slim, 2)
  assert.deepStrictEqual(j.shown['穿搭'], [5, 6, 7, 8], '名单按展示序整类保留（ID 不截断）')
  assert.strictEqual(j.snap.length, 3, '每品类名次快照只存前 3')
  assert.strictEqual(j.snap[0].s, 54.3)
  assert.strictEqual(j.snap[0].cov, 0.67)
  assert.deepStrictEqual(j.snap[0].d, { rule: 60, color: 45, body: null })
  assert.ok(!('nickname' in JSON.parse(row.input_snapshot)), '快照剥身份的既有规矩没被瘦身改动绕开')
})

test('S6：衣橱行没有 group_id，名单里记成 w<衣橱行id> 而不是丢失', () => {
  const logId = writeRecommendationLog({
    sessionId: 'sid-s6-wardrobe',
    userId: mkUser('s6w'),
    mode: 'personal',
    profile: { gender: '女' },
    result: {
      穿搭: [{ wardrobe_item_id: 2, rank: { score: 40, dims: [{ key: 'color', score: 50 }] } }],
    },
  })
  const j = JSON.parse(
    memDb.prepare('SELECT result FROM recommendation_logs WHERE id = ?').get(logId).result,
  )
  assert.deepStrictEqual(j.shown['穿搭'], ['w2'])
  assert.strictEqual(j.snap[0].g, 'w2')
})

test('S6：真实形状——rank 只挂在穿搭，其余四类没 rank 时名单照记、快照不编分数', () => {
  // 10-23 5001 实例现量：引擎只重排穿搭一类（recommendEngine.js:788，10-30 按内容重指：原写 1683 是拆分前的位置，现引擎 961 行；"只在穿搭这一类"那条注释现在在 recommend/ranker.js:267），
  // 妆容/发型/配饰/姿势的条目根本没有 rank 键。瘦身后名单不能因此丢任何一类，
  // 快照也不许给没排过序的品类编一个 score 出来。
  const logId = writeRecommendationLog({
    sessionId: 'sid-s6-real',
    userId: mkUser('s6r'),
    mode: 'store',
    profile: { gender: '女' },
    result: {
      穿搭: [
        {
          group_id: 276,
          rank: { score: 46.2, coverage: 0.55, dims: [{ key: 'rule', score: 36 }] },
        },
      ],
      妆容: [{ group_id: 277, reason: '长文案' }],
      姿势: [{ group_id: 278 }, { group_id: 279 }],
    },
  })
  const j = JSON.parse(
    memDb.prepare('SELECT result FROM recommendation_logs WHERE id = ?').get(logId).result,
  )
  assert.deepStrictEqual(j.shown['妆容'], [277], '没 rank 的品类名单照记，不整类丢掉')
  assert.deepStrictEqual(j.shown['姿势'], [278, 279])
  assert.strictEqual(j.snap.length, 1, '快照只收真排过序的那一条')
  assert.strictEqual(j.snap[0].c, '穿搭')
})

test('S6：pruneOldLogs 只清 90 天外的免费样本；报告行与新鲜行不动', () => {
  const mk = (ageDays, resultObj, sid) =>
    memDb
      .prepare(
        `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result, created_at)
         VALUES (?, 1, 'store', '{}', ?, datetime('now', ?))`,
      )
      .run(sid, JSON.stringify(resultObj), `-${ageDays} days`).lastInsertRowid
  const oldFree = mk(120, { _log_slim: 2, shown: {}, snap: [] }, 'sid-old-free')
  const freshFree = mk(10, { _log_slim: 2, shown: {}, snap: [] }, 'sid-fresh-free')
  const oldReport = mk(
    200,
    { paid_report: { out_trade_no: 'O-20261023' }, 穿搭: [] },
    'sid-old-report',
  )
  const noTimestamp = memDb
    .prepare(
      `INSERT INTO recommendation_logs (session_id, user_id, mode, input_snapshot, result, created_at)
       VALUES ('sid-null-ct', 1, 'store', '{}', '{"_log_slim":2}', NULL)`,
    )
    .run().lastInsertRowid
  const removed = pruneOldLogs(90)
  assert.strictEqual(removed, 1, `应只删 1 行（90 天外的免费样本），实测 ${removed}`)
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE id = ?').get(oldFree).n,
    0,
  )
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE id = ?').get(freshFree).n,
    1,
  )
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE id = ?').get(oldReport).n,
    1,
  )
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM recommendation_logs WHERE id = ?').get(noTimestamp).n,
    1,
    'created_at 为 NULL 的旧行不误删（宁留不误删）',
  )
})

// ============================================================
// 四、S9：死常量摘除后，GARMENT_REF 其余刻度照常参与出分
// ============================================================
test('S9：hps_to_waist_ratio 已摘除；hps_to_hip_ratio 与 hem_span_cm 还在且衣长轴照常出分', () => {
  assert.ok(!('hps_to_waist_ratio' in GARMENT_REF), '死常量不该还留在表里')
  assert.strictEqual(GARMENT_REF.hps_to_hip_ratio, 0.4)
  assert.strictEqual(GARMENT_REF.hem_span_cm, 12)
  // 吃真代码路径：身高 160 ⇒ 胯线 64，衣长 55 ⇒ 视觉腰位 (64−55)/12 = +0.75。
  // want.length 由腿身比偏短抬出来（60/160=0.375 < 带下限 ⇒ 想把视线上移），
  // 这条钉的是"摘掉那个全仓零命中的键之后，衣长这一维的算式一根手指没动"。
  const person = {
    gender: '女',
    height: 160,
    weight: 50,
    bust: 84,
    waist: 66,
    hip: 90,
    shoulder: 36,
    leg_length: 60,
  }
  const top = { name: 'S9 测试上衣', category: '衬衫', length_cm: 55 }
  const d = bodyDeviation(person)
  assert.ok(d.want.length != null, `want.length 应被腿身比抬出来，实得 ${JSON.stringify(d.want)}`)
  const g = topFitBody(person, top, d)
  assert.ok(g, '有 length_cm 且 want.length 在场就不该返回 null')
  const lenAxis = g.axes.find((a) => a.key === 'length')
  assert.ok(
    lenAxis && lenAxis.score != null,
    `length 轴应出分，实得 ${JSON.stringify(g.axes_present)}`,
  )
  assert.strictEqual(lenAxis.garment, 0.75, '视觉腰位 = (身高×0.40 − 衣长) ÷ 12')
})

// ============================================================
// 五、DR1：POST /body 生理范围收界＋点名 400＋交叉判据
// ============================================================
const post = (userId, body) =>
  call(findRoute(analysisRouter, 'post', '/body'), { user: { id: userId }, body })

test('DR1：身高 300 不再是静默丢弃，而是点名哪一格的 400', () => {
  const uid = mkUser('dr1-a')
  const res = post(uid, { height_cm: 300 })
  assert.strictEqual(res.statusCode, 400)
  const msg = JSON.stringify(res.body)
  assert.ok(msg.includes('身高'), `400 话术应点名"身高"，实际 ${msg}`)
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) n FROM body_metrics WHERE user_id = ?').get(uid).n,
    0,
    '400 时一行都不该写',
  )
})

test('DR1：字符串数字照收，垃圾值与负数报"得填数字/超出范围"而不是悄悄留空', () => {
  const uid = mkUser('dr1-b')
  assert.strictEqual(post(uid, { height_cm: '165', weight_kg: '60' }).statusCode, 200)
  assert.strictEqual(
    memDb.prepare('SELECT height_cm, weight_kg FROM body_metrics WHERE user_id = ?').get(uid)
      .height_cm,
    165,
  )
  const bad = post(uid, { height_cm: '170abc' })
  assert.strictEqual(bad.statusCode, 400)
  assert.ok(JSON.stringify(bad.body).includes('得填数字'))
})

test('DR1：组合才违和的要拦——档案里已有身高 200，这次只补体重 25 ⇒ BMI 400 点名两格', () => {
  const uid = mkUser('dr1-c')
  assert.strictEqual(post(uid, { height_cm: 200, weight_kg: 100 }).statusCode, 200)
  assert.strictEqual(post(uid, { weight_kg: 25 }).statusCode, 400)
  const last = post(uid, { weight_kg: 25 })
  assert.ok(JSON.stringify(last.body).includes('BMI'))
})

test('DR1：腰围比胸围大 15cm 以上＝生理不可能 ⇒ 400', () => {
  const uid = mkUser('dr1-d')
  const res = post(uid, { waist_cm: 120, bust_cm: 80 })
  assert.strictEqual(res.statusCode, 400)
  assert.ok(JSON.stringify(res.body).includes('腰围'))
})

test('DR1：没提交的列保留原值（局部提交语义没被 400 改造破坏）', () => {
  const uid = mkUser('dr1-e')
  assert.strictEqual(post(uid, { height_cm: 168, waist_cm: 70 }).statusCode, 200)
  const res = post(uid, { weight_kg: 58, body_type: '梨形' })
  assert.strictEqual(res.statusCode, 200)
  const row = memDb.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(uid)
  assert.strictEqual(row.height_cm, 168, '上次量好的身高不该被这次局部提交清掉')
  assert.strictEqual(row.waist_cm, 70)
  assert.strictEqual(row.weight_kg, 58)
})

// ============================================================
// 六、DR1 追加：顾客真正在走的那条路（PUT /archive）必须用同一把尺子
// ============================================================
// 前端 `saveProfileArchive()`  PUT 的就是 `/analysis/archive`，全仓 0 处调 `/analysis/body`
// （10-23 现量）。所以只收紧 `/body` ＝ 收紧了一扇没人走的门，
// 而档案那条把越界值被 `cleanNum` 抹成 null 后回一句"已保存"。
// 本轮把界挪进 `services/bodyLimits.js` 一份、两个入口同取，
// 档案这条⛔回 400（它是 1.5 秒防抖的自动保存），改的回法是"不写这一格 + 在返回里点名"。
const putArchive = (userId, form) =>
  call(findRoute(analysisRouter, 'put', '/archive'), { user: { id: userId }, body: form })

const rowOf = (uid) => memDb.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(uid)

test('DR1·档案路径：身高 300 不再被静默丢弃——200 的返回里点名是哪一格，且库里没写进去', () => {
  const uid = mkUser('dr1-f')
  const res = putArchive(uid, { height: 300, weight: 60 })
  assert.strictEqual(res.statusCode, 200, '草稿路径不回 400，靠 rejected 点名')
  const data = res.body.data
  assert.strictEqual(
    data.rejected.length,
    1,
    `应只点名身高一格，实际 ${JSON.stringify(data.rejected)}`,
  )
  assert.ok(data.rejected[0].reason.includes('身高'), JSON.stringify(data.rejected[0]))
  assert.strictEqual(data.rejected[0].key, 'height')
  const row = rowOf(uid)
  assert.strictEqual(row.height_cm, null, '越界的那格不该写进档案')
  assert.strictEqual(row.weight_kg, 60, '同一份表单里合法的那格照写')
  assert.strictEqual(data.body, 1, '写入计数只数真写进去的列（被拒的那格不算已保存）')
})

test('DR1·档案路径：非数字与越界都点名，草稿不整份失败', () => {
  const uid = mkUser('dr1-g')
  const res = putArchive(uid, { height: '一米七', waist: 12 })
  const reasons = res.body.data.rejected.map((r) => r.reason).join('；')
  assert.ok(reasons.includes('得填数字'), reasons)
  assert.ok(reasons.includes('腰围'), reasons)
  assert.strictEqual(res.body.data.body, 0, '两格都被拒 ⇒ 一列都没写')
  assert.strictEqual(rowOf(uid), undefined, '全被拒时不该插一条空档案行')
})

test('DR1·两个入口同一把尺子：同一个越界值，/body 与 /archive 给的是同一句话术', () => {
  const uidA = mkUser('dr1-h1')
  const uidB = mkUser('dr1-h2')
  const viaBody = post(uidA, { height_cm: 300 })
  const viaArchive = putArchive(uidB, { height: 300 })
  assert.strictEqual(viaBody.statusCode, 400)
  const bodyMsg = JSON.stringify(viaBody.body)
  const rejectedMsg = viaArchive.body.data.rejected[0].reason
  assert.ok(bodyMsg.includes(rejectedMsg), `两处的话术应一致：${bodyMsg} vs ${rejectedMsg}`)
  assert.ok(rejectedMsg.includes('140~220'), `界应来自同一份表，实得 ${rejectedMsg}`)
})

test('DR1·界不许凭想象收窄：臀围 190／胸围 170 这类大码实测值必须收进来', () => {
  const uid = mkUser('dr1-i')
  const res = putArchive(uid, { hip: 190, bust: 170 })
  assert.strictEqual(res.body.data.rejected.length, 0, JSON.stringify(res.body.data.rejected))
  const row = rowOf(uid)
  assert.strictEqual(row.hip_cm, 190)
  assert.strictEqual(row.bust_cm, 170)
  // /body 同一条值也不该被拦（围度上沿 200，见 bodyLimits.js 头部"⛔ 收到 160"那段）
  assert.strictEqual(post(uid, { hip_cm: 190, bust_cm: 170 }).statusCode, 200)
})

test('DR1·saveArchive 被拒的格不写库，但合法值仍照"只增不清"保留', () => {
  const uid = mkUser('dr1-j')
  assert.strictEqual(saveArchive(uid, { height: 165, leg_length: 88 }).body, 2)
  const rejected = saveArchive(uid, { height: 120, leg_length: 200 }).rejected
  assert.strictEqual(rejected.length, 2, JSON.stringify(rejected))
  const row = rowOf(uid)
  assert.strictEqual(row.height_cm, 165, '这次被拒 ⇒ 保留档案原值，不清空')
  assert.strictEqual(row.leg_length_cm, 88)
})

test('DR1·档案查看页不再单独说谎：GET /archive 追加 not_recorded，fields/profile 一行动都不砍', () => {
  const uid = mkUser('dr1-k')
  assert.strictEqual(putArchive(uid, { height: 300, weight: 60 }).statusCode, 200)
  const res = call(findRoute(analysisRouter, 'get', '/archive'), { user: { id: uid } })
  const d = res.body.data
  assert.strictEqual(d.not_recorded.length, 1, JSON.stringify(d.not_recorded))
  assert.ok(d.not_recorded[0].reason.includes('身高'), JSON.stringify(d.not_recorded[0]))
  assert.strictEqual(
    d.profile.height,
    300,
    '预填视图仍照"上次填的表单"原样回吐——砍行等于悄悄丢数据',
  )
  assert.ok(
    d.fields.some((f) => f.key === 'height'),
    'fields 清单不该被这次改动删行（要显式说明"没被记下"得等顾客端接 not_recorded）',
  )
  assert.strictEqual(
    rowOf(uid).height_cm,
    null,
    '库里确实没记 300，这条差值现在由 not_recorded 说明',
  )
})
