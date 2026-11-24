/**
 * 2026-10-12 全项目重审修复批次的行为测试
 * ============================================================
 * 报告在仓内（docs/复盘/站3全项目重审报告-20261012.md，10-19 从盘外搬进来），
 * 36 条里能写成断言的都钉在这个文件。全部走 db/init 的内存库替身（schema.sql 同源），
 * 不碰 backend/db/styleai.db，也不起真端口：直接调路由 stack 里最后一个业务 handler，
 * 鉴权与限流中间件因此被绕过——本文件验的是入参收敛与写库结果，不是闸门本身
 * （闸门另有 guardHelpers / routeLimiterCoverage / disabledModelFileGuard 三个文件覆盖）。
 *
 * 运行: node --test test/auditFixes20261012.test.js
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

const { maskQuery, safeUrl } = require('../middleware/logger')
const { getTodayFileName, logTimeStamp } = require('../utils/logger')
const { beijingDateStr } = require('../utils/beijingTime')
const { outfitHarmony } = require('../services/colorMetrics')

const customerRouter = require('../routes/customer')
const wardrobeRouter = require('../routes/wardrobe')
const recommendRouter = require('../routes/recommend')
const rulesRouter = require('../routes/rules')
const modelsRouter = require('../routes/models')
const adminRouter = require('../routes/admin')
const { addNewRules, newRules } = require('../db/add-rules')

/**
 * 按 method+path 找路由（admin 那条是数组路径，一起支持）。
 * 11-03 拆分轮起这份实现搬到 `test/helpers/routeLookup.js`：衣橱的「二、搭配组合管理」
 * 拆成同前缀子路由后，平铺版会把 `/outfits` 读成"不存在"⇒ 假红，判据本身没错。
 */
const { findRoute } = require('./helpers/routeLookup')

/** 只调最后一个 handler（业务本体），返回 {statusCode, body} */
function call(route, { params = {}, query = {}, body = {}, headers = {} }) {
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
    // sendCreated 要 res.setHeader('Location', …)。express 的真 res 一定有这方法，
    // 双重缺它＝创建口在 handler 的 try 里抛 TypeError ⇒ 平白 500，看着像业务炸了
    setHeader() {
      return res
    },
    getHeader() {
      return undefined
    },
  }
  handler({ params, query, body, headers, ip: '1.1.1.1', socket: {}, user: null }, res, () => {})
  return res
}

const day = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString()

// ============================================================
// L16 日志脱敏与北京日切（纯函数）
// ============================================================

test('L16 maskQuery: 口令类整值抹掉，会话 ID 只留前 8 位，普通参数不动', () => {
  const out = maskQuery(
    'token=abc.def.ghi&phone=13800001111&session_id=abcdefghijklmnop1234&color=%E7%99%BD&zodiac',
  )
  assert.ok(out.includes('token=***'), out)
  assert.ok(out.includes('phone=***'), out)
  assert.ok(out.includes('session_id=abcdefgh…'), out)
  assert.ok(out.includes('color=%E7%99%BD'), '非敏感参数必须原样留着，否则日志失去排查价值')
  assert.ok(out.endsWith('&zodiac'), '没有 = 的裸键也要原样带过')
  assert.ok(!out.includes('13800001111'), '手机号一位都不能留在日志里')
})

test('L16 maskQuery: 键名大小写混写也挡得住，空 query 不炸', () => {
  assert.strictEqual(maskQuery('Token=x&ACCESS_TOKEN=y'), 'Token=***&ACCESS_TOKEN=***')
  assert.strictEqual(maskQuery(''), '')
})

test('L16 safeUrl: 超长 URL 截断，一条 10MB 的 query 不能整段进日志', () => {
  const req = { originalUrl: '/api/x?' + 'a'.repeat(5000) }
  const out = safeUrl(req)
  assert.ok(out.length < 600, `实际长度 ${out.length}`)
  assert.ok(out.endsWith('…(已截断)'))
})

test('L16 日志文件名与行首时间戳同用北京日，容器 UTC 也不再跨日错文件', () => {
  assert.strictEqual(getTodayFileName(), `server-${beijingDateStr()}.log`)
  // UTC 2026-10-11T16:30 = 北京 2026-10-12T00:30：以前这一行写进 10-11 的文件、行首印 10-11
  const at = new Date('2026-10-11T16:30:00Z')
  assert.strictEqual(logTimeStamp(at), '2026-10-12 00:30:00')
})

// ============================================================
// L14 配色面积权重
// ============================================================

test('L14 outfitHarmony: 面积写 0 就是不占面积，不再被 `|| 1` 抬成平均一件', () => {
  const withZero = outfitHarmony([
    { label: '上衣', color: '白色', area: 0.5 },
    { label: '裤子', color: '黑色', area: 0.5 },
    { label: '戒指', color: '金色', area: 0 },
  ])
  const withoutZero = outfitHarmony([
    { label: '上衣', color: '白色', area: 0.5 },
    { label: '裤子', color: '黑色', area: 0.5 },
  ])
  assert.ok(withZero && withoutZero)
  assert.strictEqual(
    withZero.score,
    withoutZero.score,
    '第三件面积 0 ⇒ 加权必须完全不起作用（原来它算 1，把分数拉向金色）',
  )
})

test('L14 outfitHarmony: 全 0 与只有一对权重为 0 时退化成等权，不出 NaN', () => {
  const allZero = outfitHarmony([
    { label: 'a', color: '白色', area: 0 },
    { label: 'b', color: '黑色', area: 0 },
  ])
  assert.ok(allZero)
  assert.ok(Number.isFinite(allZero.score), `全 0 应出分，实得 ${allZero.score}`)

  const oneZero = outfitHarmony([
    { label: 'a', color: '白色', area: 1 },
    { label: 'b', color: '黑色', area: 0 },
  ])
  assert.ok(oneZero)
  assert.ok(Number.isFinite(oneZero.score), `权重和为 0 时应出分，实得 ${oneZero.score}`)

  const noArea = outfitHarmony([
    { label: 'a', color: '白色' },
    { label: 'b', color: '黑色' },
  ])
  assert.ok(Number.isFinite(noArea.score), '没填面积仍按平均一件算')
})

// ============================================================
// H2 门店顾客会话过期闸门
// ============================================================

function seedSession(sessionId, { expiresAt, synced = 0, profileData }) {
  // customer_sessions.store_id 是指向 stores(id) 的外键，schema 里 PRAGMA 开着 FK ⇒
  // 不先挂一家店，这行根本插不进去（报 FOREIGN KEY constraint failed）
  memDb.prepare(`INSERT OR IGNORE INTO stores (id, name) VALUES (1, '测试门店')`).run()
  memDb
    .prepare(
      `INSERT INTO customer_sessions (session_id, store_id, profile_data, synced, expires_at)
       VALUES (?, 1, ?, ?, ?)`,
    )
    .run(sessionId, JSON.stringify(profileData), synced, expiresAt)
}

const putRoute = findRoute(customerRouter, 'put', '/session/:sessionId')
const syncRoute = findRoute(customerRouter, 'post', '/session/:sessionId/sync')

test('H2 PUT 过期会话：404 且不再重铸 expires_at，未同步的行当场删掉', () => {
  seedSession('exp-put-1', {
    expiresAt: day(-1),
    profileData: { gender: '女' },
  })
  const res = call(putRoute, {
    params: { sessionId: 'exp-put-1' },
    body: { profile_data: { gender: '男' } },
  })
  assert.strictEqual(res.statusCode, 404)
  assert.strictEqual(res.body.error.message, '会话已过期')
  const left = memDb
    .prepare('SELECT COUNT(*) c FROM customer_sessions WHERE session_id = ?')
    .get('exp-put-1')
  assert.strictEqual(left.c, 0, '未同步的过期行必须被删掉，隐私声明那句"超时自动清除"才算数')
})

test('H2 PUT 过期但已同步：404 且行保留（门店那条记录归顾客自己 DELETE）', () => {
  seedSession('exp-put-2', {
    expiresAt: day(-1),
    synced: 1,
    profileData: { gender: '女' },
  })
  const res = call(putRoute, {
    params: { sessionId: 'exp-put-2' },
    body: { profile_data: { gender: '男' } },
  })
  assert.strictEqual(res.statusCode, 404)
  const row = memDb
    .prepare('SELECT synced, profile_data FROM customer_sessions WHERE session_id = ?')
    .get('exp-put-2')
  assert.strictEqual(row.synced, 1)
  assert.strictEqual(JSON.parse(row.profile_data).gender, '女', '过期后一个字都不许改')
})

test('H2 sync 过期会话：404，不把过期画像固化进门店', () => {
  seedSession('exp-sync-1', { expiresAt: day(-1), profileData: { gender: '女' } })
  const res = call(syncRoute, { params: { sessionId: 'exp-sync-1' } })
  assert.strictEqual(res.statusCode, 404)
  const row = memDb
    .prepare('SELECT synced FROM customer_sessions WHERE session_id = ?')
    .get('exp-sync-1')
  assert.strictEqual(row.synced, 0)
})

test('H2 sync 未过期：嵌套写法里的 nickname/phone/email 也一并剥掉', () => {
  seedSession('ok-sync-1', {
    expiresAt: day(1),
    profileData: {
      gender: '女',
      nickname: '小红',
      contact: { phone: '13800001111', email: 'a@b.c' },
      items: [{ nickname: '内层昵称', note: '留着' }],
    },
  })
  const res = call(syncRoute, { params: { sessionId: 'ok-sync-1' } })
  assert.strictEqual(res.statusCode, 200)
  const row = memDb
    .prepare('SELECT profile_data FROM customer_sessions WHERE session_id = ?')
    .get('ok-sync-1')
  const stored = JSON.parse(row.profile_data)
  assert.ok(!('nickname' in stored), JSON.stringify(stored))
  assert.ok(!('phone' in stored.contact), '顶层 delete 挡不住嵌套写法')
  assert.ok(!('nickname' in stored.items[0]))
  assert.strictEqual(stored.gender, '女')
  assert.strictEqual(stored.items[0].note, '留着')
  assert.ok(!('email' in stored.contact), 'email 也在 IDENTITY_KEYS 里，嵌套位置同样剥掉')
})

test('H2 PUT 未过期：照常能改，expires_at 续期', () => {
  seedSession('ok-put-1', { expiresAt: day(1), profileData: { gender: '女' } })
  const res = call(putRoute, {
    params: { sessionId: 'ok-put-1' },
    body: { profile_data: { gender: '男' } },
  })
  assert.strictEqual(res.statusCode, 200)
  const row = memDb
    .prepare('SELECT profile_data, expires_at FROM customer_sessions WHERE session_id = ?')
    .get('ok-put-1')
  assert.strictEqual(JSON.parse(row.profile_data).gender, '男')
  assert.ok(new Date(row.expires_at) > new Date())
})

// ============================================================
// L12 衣橱搭配的 item_ids
// ============================================================

const outfitsRoute = findRoute(wardrobeRouter, 'post', '/outfits')
const SID = 'wardrobe-fixtures-sid'

memDb
  .prepare(
    `INSERT INTO user_wardrobe (session_id, name, category)
     VALUES (?, '白T', '上衣'), (?, '牛仔裤', '裤子')`,
  )
  .run(SID, SID)
const OWN_A = memDb.prepare('SELECT id FROM user_wardrobe ORDER BY id LIMIT 1').get().id
const OWN_B = memDb.prepare('SELECT id FROM user_wardrobe ORDER BY id DESC LIMIT 1').get().id
memDb
  .prepare(
    `INSERT INTO user_wardrobe (session_id, name, category) VALUES ('别人家的会话', '别人的外套', '外套')`,
  )
  .run()

function createOutfit(itemIds, name = '通勤一套') {
  return call(outfitsRoute, {
    headers: { 'x-session-id': SID },
    body: { name, item_ids: itemIds },
  })
}

test('L12 item_ids 传字符串/对象：400，不再靠 .length 蒙过去', () => {
  for (const bad of ['123', { 0: 1 }, 12, null, undefined]) {
    const res = createOutfit(bad)
    assert.strictEqual(res.statusCode, 400, `输入 ${JSON.stringify(bad)} 应 400`)
  }
  const res = createOutfit([])
  assert.strictEqual(res.statusCode, 400, '空数组也算没填')
})

test('L12 item_ids 混非整数：400', () => {
  assert.strictEqual(createOutfit([OWN_A, 'abc']).statusCode, 400)
  assert.strictEqual(createOutfit([OWN_A, 1.5]).statusCode, 400)
  assert.strictEqual(createOutfit([OWN_A, -3]).statusCode, 400)
})

test('L12 item_ids 里挂别人的单品：400 且点名是哪条', () => {
  const foreign = memDb
    .prepare(`SELECT id FROM user_wardrobe WHERE session_id = '别人家的会话'`)
    .get().id
  const res = createOutfit([OWN_A, foreign])
  assert.strictEqual(res.statusCode, 400)
  assert.ok(res.body.error.message.includes(String(foreign)), res.body.error.message)
})

test('L12 数字字符串入库归一成正整数，重复 ID 只留一份', () => {
  const res = createOutfit([String(OWN_A), OWN_A, OWN_B])
  // 201＝POST /outfits 真的建了一条搭配日记（创建口的约定，见 utils/response.js sendCreated）
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.body))
  assert.deepEqual(res.body.data.item_ids, [OWN_A, OWN_B])
  const row = memDb
    .prepare('SELECT item_ids FROM wardrobe_outfits WHERE id = ?')
    .get(res.body.data.id)
  assert.deepEqual(JSON.parse(row.item_ids), [OWN_A, OWN_B])
})

test('L12 一次挂 51 件：400，整份 JSON 不能再直接进 TEXT 列', () => {
  const many = Array.from({ length: 51 }, (_, i) => OWN_A + i)
  assert.strictEqual(createOutfit(many).statusCode, 400)
})

// ============================================================
// L20 推荐模式枚举
// ============================================================

const engineRoute = findRoute(recommendRouter, 'post', '/engine')
const enhanceRoute = findRoute(recommendRouter, 'post', '/enhance')

test('L20 /engine 的 mode 认不到就 400，不再原样写进 recommendation_logs.mode', () => {
  for (const bad of ['门店', 'all', 'x'.repeat(200), ['store']]) {
    const res = call(engineRoute, { body: { profile: { gender: '女' }, mode: bad } })
    assert.strictEqual(res.statusCode, 400, `mode=${JSON.stringify(bad)} 应 400`)
  }
  const ok = call(engineRoute, { body: { profile: { gender: '女' }, mode: 'personal' } })
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body))
  assert.strictEqual(ok.body.data.mode, 'personal')
})

test('L20 /engine 不带 mode 仍按 store 走（默认档没被改坏）', () => {
  const res = call(engineRoute, { body: { profile: { gender: '女' } } })
  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.body.data.mode, 'store')
})

test('L20 /enhance 同一个取值表', () => {
  const bad = call(enhanceRoute, {
    body: { recommendation: { 穿搭: [] }, mode: 'weird-mode' },
  })
  assert.strictEqual(bad.statusCode, 400)
  const good = call(enhanceRoute, { body: { recommendation: { 穿搭: [] } } })
  assert.strictEqual(good.statusCode, 200, JSON.stringify(good.body))
})

// ============================================================
// L2 规则组 priority 整数化 + L19 PUT 部分更新 + L18 toggle 竞态
// ============================================================

const postGroup = findRoute(rulesRouter, 'post', '/groups')
const putGroup = findRoute(rulesRouter, 'put', '/groups/:id')
const toggleGroup = findRoute(rulesRouter, 'post', '/groups/:id/toggle')

const MIN_RULE = {
  name: '测试-女-通勤',
  mode: 'store',
  category: '穿搭',
  conditions: [{ field: 'gender', operator: 'eq', value: '女' }],
  actions: [{ action_type: 'top_style', content: '简洁利落的衬衫' }],
}

test('L2 priority 传字符串数字：入库是整数；传 "abc"：400 而不是 500', () => {
  const created = call(postGroup, { body: { ...MIN_RULE, priority: '12' } })
  assert.strictEqual(created.statusCode, 201, JSON.stringify(created.body))
  const row = memDb
    .prepare('SELECT priority, typeof(priority) t FROM rule_groups WHERE id = ?')
    .get(created.body.data.id)
  assert.strictEqual(row.priority, 12)
  assert.strictEqual(row.t, 'integer', 'TEXT 混进 INTEGER 列会让 ORDER BY priority DESC 整体失真')

  const bad = call(postGroup, { body: { ...MIN_RULE, priority: 'abc' } })
  assert.strictEqual(bad.statusCode, 400)
  assert.strictEqual(bad.body.error.message, 'priority 只能是整数')
})

test('L2 PUT 把 priority 改成小数字符串：落成整数 7', () => {
  const created = call(postGroup, { body: { ...MIN_RULE, priority: 1 } })
  const res = call(putGroup, {
    params: { id: String(created.body.data.id) },
    body: { priority: '7.9' },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const row = memDb
    .prepare('SELECT priority, typeof(priority) t FROM rule_groups WHERE id = ?')
    .get(created.body.data.id)
  assert.strictEqual(row.priority, 7)
  assert.strictEqual(row.t, 'integer')
})

test('L19 PUT 只带 conditions：200，动作原样保留（原来必 400，部分更新是假契约）', () => {
  const created = call(postGroup, { body: MIN_RULE })
  const id = created.body.data.id
  const res = call(putGroup, {
    params: { id: String(id) },
    body: { conditions: [{ field: 'scenario', operator: 'eq', value: '通勤' }] },
  })
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body))
  const conds = memDb
    .prepare('SELECT field FROM rule_conditions WHERE group_id = ?')
    .all(id)
    .map((r) => r.field)
  const acts = memDb
    .prepare('SELECT action_type, content FROM rule_actions WHERE group_id = ?')
    .all(id)
  assert.deepEqual(conds, ['scenario'], '条件整侧被替换')
  assert.strictEqual(acts.length, 1)
  assert.strictEqual(acts[0].action_type, 'top_style')
  assert.strictEqual(acts[0].content, '简洁利落的衬衫', '没带的动作侧必须原样留着')
})

test('L19 PUT 显式传空数组：仍然 400（清空不是部分更新）', () => {
  const created = call(postGroup, { body: MIN_RULE })
  const res = call(putGroup, {
    params: { id: String(created.body.data.id) },
    body: { actions: [] },
  })
  assert.strictEqual(res.statusCode, 400)
})

test('L18 toggle 连点两次净回到原值，不存在的 id 回 404', () => {
  const created = call(postGroup, { body: MIN_RULE })
  const id = created.body.data.id
  const enabledOf = () =>
    memDb.prepare('SELECT enabled FROM rule_groups WHERE id = ?').get(id).enabled
  assert.strictEqual(enabledOf(), 1)
  const first = call(toggleGroup, { params: { id: String(id) } })
  assert.strictEqual(first.statusCode, 200)
  assert.strictEqual(first.body.data.enabled, false)
  assert.strictEqual(enabledOf(), 0)
  const second = call(toggleGroup, { params: { id: String(id) } })
  assert.strictEqual(second.body.data.enabled, true)
  assert.strictEqual(enabledOf(), 1, '两次翻转净结果是回到 1，中间没有丢翻转')
  const missing = call(toggleGroup, { params: { id: '99999999' } })
  assert.strictEqual(missing.statusCode, 404)
})

// ============================================================
// L1 模型后台写入口布尔 + L18 模型 toggle
// ============================================================

const putModel = findRoute(modelsRouter, 'put', '/admin/:id')
const toggleModel = findRoute(modelsRouter, 'post', '/admin/:id/toggle')

memDb
  .prepare(
    `INSERT INTO model_configs (name, icon, description, file, folder, enabled)
     VALUES ('测试模型', 'x', '', 'a.pmx', '测试+a', 1)`,
  )
  .run()
const MODEL_ID = memDb.prepare('SELECT id FROM model_configs WHERE name = ?').get('测试模型').id

test('L1 PUT 模型 name 传布尔：400，不再绑进 better-sqlite3 抛 TypeError 变 500', () => {
  const res = call(putModel, { params: { id: String(MODEL_ID) }, body: { name: true } })
  assert.strictEqual(res.statusCode, 400, JSON.stringify(res.body))
  const still = call(putModel, { params: { id: String(MODEL_ID) }, body: { name: false } })
  assert.strictEqual(still.statusCode, 400)
  const ok = call(putModel, { params: { id: String(MODEL_ID) }, body: { name: '改好的名字' } })
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body))
})

test('L18 模型 toggle 连点两次回到启用，缺失 id 回 404', () => {
  const enabledOf = () =>
    memDb.prepare('SELECT enabled FROM model_configs WHERE id = ?').get(MODEL_ID).enabled
  assert.strictEqual(enabledOf(), 1)
  const off = call(toggleModel, { params: { id: String(MODEL_ID) } })
  assert.strictEqual(off.body.data.enabled, false)
  assert.strictEqual(enabledOf(), 0)
  const on = call(toggleModel, { params: { id: String(MODEL_ID) } })
  assert.strictEqual(on.body.data.enabled, true)
  assert.strictEqual(enabledOf(), 1)
  assert.strictEqual(call(toggleModel, { params: { id: '99999999' } }).statusCode, 404)
})

// ============================================================
// L11 后台源码查看器
// ============================================================

const sourceRoute = findRoute(adminRouter, 'get', '/api/source')

test('L11 .sqlite3 库文件进黑名单', () => {
  const res = call(sourceRoute, { query: { file: 'db/some.sqlite3' } })
  assert.strictEqual(res.statusCode, 403)
  assert.strictEqual(res.body.error.message, '禁止访问此文件')
})

test('L11 WAL/SHM 伴生文件按后缀挡，不看库名', () => {
  for (const f of ['db/styleai.db-wal', 'db/backup.db-shm', 'db/other.sqlite-wal']) {
    const res = call(sourceRoute, { query: { file: f } })
    assert.strictEqual(res.statusCode, 403, f)
  }
})

test('L11 root 外的路径先判越界回 403，不再用 404 泄露"存在与否"，也不回显原路径', () => {
  const res = call(sourceRoute, { query: { file: '../../../etc/passwd' } })
  assert.strictEqual(res.statusCode, 403, JSON.stringify(res.body))
  assert.strictEqual(res.body.error.message, '非法路径')
  assert.ok(!JSON.stringify(res.body).includes('etc/passwd'), '响应里不该出现请求原文')

  const missing = call(sourceRoute, { query: { file: 'routes/__nope__.js' } })
  assert.strictEqual(missing.statusCode, 404)
  assert.ok(!JSON.stringify(missing.body).includes('__nope__'), '404 也不再回显文件名')
})

// ============================================================
// L21 历史脚本 add-rules 幂等
// ============================================================

test('L21 add-rules 跑第二遍不再整批重复插，主键交给 AUTOINCREMENT', () => {
  // 只数本脚本自己那批名字：上面 L2/L19 的用例往 rule_groups 里写过同名规则，
  // 全表 GROUP BY name 会把它们也算成"重复"，那是用例的串扰不是脚本的问题。
  const batchNames = new Set(newRules.map((r) => r.group.name))
  assert.strictEqual(batchNames.size, newRules.length, '脚本内部就不该有两条同名规则')
  const inBatch = () =>
    memDb
      .prepare(
        `SELECT COUNT(*) c FROM rule_groups WHERE name IN (${[...batchNames]
          .map(() => '?')
          .join(',')})`,
      )
      .get(...batchNames).c

  const before = inBatch()
  addNewRules(memDb)
  const afterFirst = inBatch()
  assert.ok(afterFirst > before, `首跑应当真的导入（${before} → ${afterFirst}）`)
  assert.strictEqual(afterFirst - before, newRules.length, '首跑导入条数应等于脚本定义的规则数')

  addNewRules(memDb)
  assert.strictEqual(inBatch(), afterFirst, '第二遍必须一条都不加')
  const dupNames = memDb
    .prepare(
      `SELECT name FROM rule_groups WHERE name IN (${[...batchNames]
        .map(() => '?')
        .join(',')}) GROUP BY name HAVING COUNT(*) > 1`,
    )
    .all(...batchNames)
  assert.deepEqual(dupNames, [], '这批规则在库里每条只该有一份')
})

test('L22 parsePagination：离谱页码给空页，不再把 OFFSET 撑成浮点抛 datatype mismatch', () => {
  const { parsePagination } = require('../utils/common')
  // 原来 (page-1)*limit 在 page=1e20 时是 2e21 的浮点 ⇒ 绑进 LIMIT/OFFSET 直接抛
  // （2026-10-12 实测 §6.3 那条：better-sqlite3 报 "SqliteError: datatype mismatch"）
  for (const raw of ['99999999999999999999', '9223372036854775807', '999999999999999999999999']) {
    const p = parsePagination({ page: raw, limit: 20 })
    assert.ok(Number.isInteger(p.offset), `page=${raw} 的 offset 必须是整数，实得 ${p.offset}`)
    assert.ok(p.offset <= (1000000 - 1) * 20, `page=${raw} 的 offset 不该爆掉，实得 ${p.offset}`)
    assert.strictEqual(p.page, 1000000)
  }
  // '1e300' 这种写法 parseInt 只吃 '1'，本来就是第 1 页，不是溢出
  assert.strictEqual(parsePagination({ page: '1e300', limit: 20 }).page, 1)
  // 正常翻页一格都不许动
  assert.deepEqual(
    (() => {
      const r = parsePagination({ page: '3', limit: '10' })
      return [r.page, r.limit, r.offset]
    })(),
    [3, 10, 20],
  )
  // 真库上跑一遍：过去会抛，现在给空页
  const route = findRoute(adminRouter, 'get', '/api/data/:tableName')
  const res = call(route, {
    params: { tableName: 'users' },
    query: { page: '99999999999999999999' },
  })
  assert.strictEqual(res.statusCode, 200, '离谱页码不该再回 500')
})

test('收尾：关掉内存库', () => {
  memDb.close()
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'db', 'styleai.db.test-lock')))
})
