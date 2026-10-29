/**
 * 2026-10-13 深夜轮（第三批：推荐引擎层 + 模型目录解析 + 文字报告 + 两个路由）行为测试
 * ============================================================
 * 覆盖九处改动加一枚时间保险。每处都先复现"改之前会错成什么样"再断言改后的行为；
 * 这份 19 条在"把 9 个源文件换回 HEAD 改前版本"的仓库外副本里实跑过：15 红 4 绿。
 * 绿的 4 条是"照旧/仍"型守卫（并列时的建规顺序、上传落盘位置、北京 00:30 的日期、
 * 小时不出 '24'）——它们钉的是别把已有行为改坏，本来就不该在改前红。
 * 与 logicFixes20261013.test.js 的 25 条合起来跑同一份 HEAD 副本：44 条里 31 红 13 绿。
 *
 *   1. utils/model-utils.js  parseFolderName —— SOURCE_MAP 三处方括号取值顺原型链：
 *                              目录名 `角色+constructor` 出来的 source 是一个函数（实测 typeof='function'），
 *                              写库时 better-sqlite3 认不了函数参数直接抛，序列化进 JSON 这个键又整个消失；
 *                              `+` 与 `-` 分支都剥 [作者]/去尾数字/全角冒号归一，`_by_` 分支一个都不做
 *   2. services/recommendEngine.js —— 场景别名只归一"规则条件值"一侧，profile 传 '上班通勤' 时
 *                              预筛只放 scenario='上班通勤' 的组（线上 10 行），那些组的条件值又已被
 *                              归成 '通勤' ⇒ 两侧对不上，一条都不命中，整屏退回硬编码"休闲"套
 *   3. services/recommendEngine.js —— `cond.weight || 1`：weight 列是自由 TEXT，'abc' 是 truthy
 *                              ⇒ scoredWeight 变 NaN ⇒ 排序比较器回 NaN、报告里的匹配分打成 null；
 *                              weight=0 这个"不计分软信号"被抬成 1 分
 *   4. services/recommendEngine.js —— `const actions = {}`：库里一行 action_type='__proto__'
 *                              时赋值改的是原型而不是自有键 ⇒ 那条动作文案静默消失
 *   5. services/recommendEngine.js —— 排序只到 priority/score 两级，同分先后交给 SQL 返回序（现量线上
 *                              enabled=1 里 priority=25 有 79 组、priority=5 有 76 组），报告端只取前 3
 *                              ⇒ 重建一次库 top3 可能整体换人
 *   6. services/recommendReportText.js —— AXIS_CN[k] 顺原型链（k 来自 /enhance 请求体）、
 *                              recommendation[cat] 不是数组也照样循环、a.side 缺测被印成"(想收)"、
 *                              fit.drop_cm 为 0 时那半个括号整段消失
 *   7. services/ruleExplainer.js —— 'in' 的显示侧不按 、,， 二次切分（引擎切），
 *                              匹配分只给一个掺了反馈的总数
 *   8. routes/clothing.js —— body.name 只回显不入库（表里有 item_name 这一列）、
 *                              DELETE 的 id 用 parseInt：'12abc' 真删第 12 行并把图 unlink
 *   9. routes/tryon.js —— GET /:id 同上，'12abc' 取回的是 #12 那份结果
 *  10. utils/beijingTime.js —— formatToParts 的区域从 'en-GB' 钉成 'en-GB-u-hc-h23'：
 *                              改前改后在 2000 个抽样时刻逐字段全等（实测），这条不是修错，
 *                              是把"24 时"这种区域默认值可能变的东西写死进断言
 *
 * 库走 db/init 的内存替身（与 db/schema.sql 同源），不碰 backend/db/styleai.db、不起真端口；
 * 上传落盘目录在 require clothing.js 之前被改到仓库外的临时目录，测完即删。
 *
 * 运行: node --test test/engineFixes20261013.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const Module = require('node:module')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

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

function call(route, opt = {}) {
  const { params = {}, query = {}, body = {}, headers = {}, user = null, file, extra = {} } = opt
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
  handler(
    { params, query, body, headers, ip: '1.1.1.1', socket: {}, user, file, ...extra },
    res,
    () => {},
  )
  return res
}

// 引擎内部函数 matchRules 不在 module.exports 里，用"喂源码"的工装把它取出来（不改生产导出）。
const engineSrc = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'recommendEngine.js'),
  'utf-8',
)
const engineRequire = Module.createRequire(
  path.join(__dirname, '..', 'services', 'recommendEngine.js'),
)
const engineMod = { exports: {} }
new Function(
  'module',
  'exports',
  'require',
  engineSrc + '\nmodule.exports.__matchRules = matchRules\n',
)(engineMod, engineMod.exports, engineRequire)
const matchRules = engineMod.exports.__matchRules

// ============================================================
// 一、model-utils：parseFolderName 的三处查表与三种命名格式
// ============================================================

const { parseFolderName } = require('../utils/model-utils')

test('model：目录名里的 constructor / __proto__ 不再查出原型上的东西', () => {
  // 改前实测：parseFolderName('角色+constructor').source 的 typeof 是 'function'
  for (const raw of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    for (const form of [`${'雪女'}+${raw}`, '雪女_by_' + raw, '雪女-' + raw]) {
      const r = parseFolderName(form)
      assert.equal(typeof r.source, 'string', `${form} ⇒ source 不是字符串`)
      assert.equal(r.source, '其他', `${form} ⇒ 应当落成 '其他'，实际 ${r.source}`)
      assert.ok(JSON.stringify(r).includes('"source":"其他"'), `${form} 序列化后 source 键没了`)
    }
  }
})

test('model：正常目录名照旧认得出来源（改动没有把 28 条展厅模型判歪）', () => {
  assert.deepEqual(parseFolderName('今汐+鸣潮'), { name: '今汐', source: '鸣潮' })
  assert.deepEqual(parseFolderName('凯茜娅-尘白禁区[神帝宇]'), {
    name: '凯茜娅',
    source: '尘白禁区',
  })
  assert.deepEqual(parseFolderName('太一·庚辰-深空之眼'), { name: '太一·庚辰', source: '深空之眼' })
  // 名字里本身带 '-' 且尾巴对不上已知来源 ⇒ 整体当名字
  assert.deepEqual(parseFolderName('A-Constructor').source, '其他')
})

test('model：_by_ 旧格式与另两种格式同一套清洗（剥作者、去尾编号、全角冒号）', () => {
  // 改前实测：parseFolderName('今汐_by_鸣潮[作者]') 的 source 是 '其他'
  assert.equal(parseFolderName('今汐_by_鸣潮[作者]').source, '鸣潮')
  assert.equal(parseFolderName('凝光_by_原神1').source, '原神')
  assert.equal(parseFolderName('三月七_by_崩坏：星穹铁道').source, '崩坏:星穹铁道')
  // 盘上现量（models/ 递归 68 个目录名）：`_by_` 格式 0 条 ⇒ 这条只影响以后新建的目录
})

// ============================================================
// 二、引擎：场景别名两侧同尺
// ============================================================

function seedScenarioGroup(canonScenario) {
  const g = memDb
    .prepare(
      `INSERT INTO rule_groups (name, mode, gender, category, scenario, priority, enabled)
       VALUES (?, 'personal', '女', '穿搭', ?, 20, 1)`,
    )
    .run(`组-${canonScenario}`, canonScenario)
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, 'scenario', 'eq', ?, 3)`,
    )
    .run(g.lastInsertRowid, '{"scenario": "上班通勤"}')
  memDb
    .prepare(`INSERT INTO rule_actions (group_id, action_type, content) VALUES (?, 'top_style', ?)`)
    .run(g.lastInsertRowid, `上衣-${canonScenario}`)
  return g.lastInsertRowid
}

test('引擎：profile 传别名（上班通勤）时，与传规范值（通勤）命中同一批规则', () => {
  // 改前只有规范值这一侧能用：传 '上班通勤' 时预筛按原始值找 aliases=SCENARIO_ALIASES['上班通勤']
  // 是 undefined ⇒ 只放 scenario='上班通勤' 的组，而那组的条件值已被归成 '通勤' ⇒ 不等 ⇒ 0 命中
  const idAlias = seedScenarioGroup('上班通勤')
  const idCanon = seedScenarioGroup('通勤')
  const byCanon = matchRules({ gender: '女', scenario: '通勤' }, 'personal', null, false)
  const byAlias = matchRules({ gender: '女', scenario: '上班通勤' }, 'personal', null, false)
  // matchRules 回来的 group_id 是数字（db 行的 id），lastInsertRowid 也是数字，
  // 原来两边一个 String() 一个不转 ⇒ includes 恒 false，是我这条断言的尺子错，不是引擎的。
  const ids = (arr) => arr.map((m) => Number(m.group_id)).sort((a, b) => a - b)
  assert.deepEqual(ids(byCanon).includes(Number(idCanon)), true, '规范值一侧必须命中')
  assert.deepEqual(
    ids(byAlias),
    ids(byCanon),
    `别名一侧与规范值一侧命中的不是同一批：${JSON.stringify(ids(byAlias))} vs ${JSON.stringify(ids(byCanon))}`,
  )
  assert.ok(
    ids(byAlias).includes(Number(idAlias)),
    '按原始值建的组也要能被规范值查到（预筛别名那半边不能丢）',
  )
})

// ============================================================
// 三、引擎：权重与打分
// ============================================================

function seedWeightedGroup(weights, scenario) {
  const g = memDb
    .prepare(
      `INSERT INTO rule_groups (name, mode, gender, category, scenario, priority, enabled)
       VALUES (?, 'personal', '女', '妆容', ?, 20, 1)`,
    )
    .run(`权重组-${weights.join('_')}`, scenario || null)
  for (const [i, w] of weights.entries()) {
    memDb
      .prepare(
        `INSERT INTO rule_conditions (group_id, field, operator, value, weight)
         VALUES (?, 'gender', 'eq', '女', ?)`,
      )
      .run(g.lastInsertRowid, w)
    void i
  }
  memDb
    .prepare(
      `INSERT INTO rule_actions (group_id, action_type, content) VALUES (?, 'makeup_style', '妆')`,
    )
    .run(g.lastInsertRowid)
  return g.lastInsertRowid
}

test('引擎：脏权重不再把匹配分打成 NaN/null', () => {
  const idBad = seedWeightedGroup(['abc', 3], null)
  const m = matchRules({ gender: '女' }, 'personal', null, false).find((x) => x.group_id === idBad)
  assert.ok(m, '脏权重那条应当仍然命中（条件本身是 gender=女）')
  assert.ok(Number.isFinite(m.score), `匹配分不是有限数: ${m.score}`)
  assert.equal(m.score, 4, `'abc' 按 1 计、3 原样加 ⇒ 应为 4，实际 ${m.score}`)
  assert.ok(!JSON.stringify({ score: m.score }).includes('null'), '序列化后分数变 null')
})

test('引擎：weight=0 是不计分软信号，不再被抬成 1', () => {
  const idZero = seedWeightedGroup([0, 5], null)
  const m = matchRules({ gender: '女' }, 'personal', null, false).find((x) => x.group_id === idZero)
  assert.ok(m)
  assert.equal(m.score, 5, `0 权重该原样加 0，实际 ${m.score}`)
})

// ============================================================
// 四、引擎：__proto__ 动作与并列排序
// ============================================================

test('引擎：action_type 写成 __proto__ 时那条动作文案不静默消失', () => {
  const g = memDb
    .prepare(
      `INSERT INTO rule_groups (name, mode, gender, category, priority, enabled)
       VALUES ('原型动作组', 'personal', '女', '配饰', 20, 1)`,
    )
    .run()
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, 'gender', 'eq', '女', 2)`,
    )
    .run(g.lastInsertRowid)
  memDb
    .prepare(
      `INSERT INTO rule_actions (group_id, action_type, content) VALUES (?, '__proto__', '这条不许丢')`,
    )
    .run(g.lastInsertRowid)
  const m = matchRules({ gender: '女' }, 'personal', null, false).find(
    (x) => x.group_id === g.lastInsertRowid,
  )
  assert.ok(m)
  // 改前：actions = {} ⇒ actions['__proto__'] = '这条不许丢' 改的是原型，自有键一个没有
  assert.equal(
    Object.keys(m.actions).length,
    1,
    `actions 应有 1 个自有键，实际 ${JSON.stringify(Object.keys(m.actions))}`,
  )
  assert.equal(m.actions.__proto__, '这条不许丢')
})

test('引擎：priority 与 score 全并列时，先后按建规顺序定死', () => {
  const ids = []
  for (let i = 0; i < 3; i++) {
    const g = memDb
      .prepare(
        `INSERT INTO rule_groups (name, mode, gender, category, priority, enabled)
         VALUES (?, 'personal', '女', '发型', 20, 1)`,
      )
      .run(`并列组${i}`)
    memDb
      .prepare(
        `INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, 'gender', 'eq', '女', 1)`,
      )
      .run(g.lastInsertRowid)
    ids.push(g.lastInsertRowid)
  }
  const hits = matchRules({ gender: '女' }, 'personal', '发型', false)
  assert.deepEqual(
    hits.map((h) => h.group_id),
    ids,
    `同 priority 同分时应按 id 升序，实际 ${JSON.stringify(hits.map((h) => h.group_id))}`,
  )
  // 再查一遍：两次调用必须给同一个序（改前由 SQL 返回序决定，不保证）
  const again = matchRules({ gender: '女' }, 'personal', '发型', false).map((h) => h.group_id)
  assert.deepEqual(
    again,
    hits.map((h) => h.group_id),
  )
})

// ============================================================
// 五、文字报告：请求体脏值与缺测
// ============================================================

const { generateStructuredText } = require('../services/recommendReportText')

// 真实签名是 generateStructuredText(recommendation, weather, mode)，
// 上衣处方挂在 recommendation.top_spec 上（fit / axes / missing / colour 四块）
const recWith = (extra) => ({ 穿搭: [{ group_name: 'g', top_style: 'x' }], ...extra })
const specOf = (axes) => ({
  top_spec: {
    // fitSize.js:283-293 现量：present:false 那一支总是同时带 blocking / measure_guide / note 三件，
    // 这里照它的产出形状给，缺一样就是测试自己的形状错了
    fit: { present: false, blocking: [], measure_guide: [], note: '' },
    axes,
    missing: [],
    colour: { present: false },
  },
})

test('报告：axes_missing 里塞原型键不再把函数打进顾客文案', () => {
  const rec = recWith({
    穿搭: [
      {
        group_name: '组A',
        top_style: 'V领',
        body_fit: { score: 60, axes: [], axes_missing: ['constructor', 'shoulder'] },
      },
    ],
  })
  const out = generateStructuredText(rec, null, 'personal')
  assert.ok(!/function/.test(out), `报告里出现了函数体：${out.slice(0, 300)}`)
  assert.ok(out.includes('constructor'), '认不出的轴名要原样列出来，不许变成 Object')
})

test('报告：分类值不是数组时不逐字循环、也不 500', () => {
  const asText = generateStructuredText({ 穿搭: '一二三四五' }, null, 'personal')
  assert.ok(!/\*\*0\*\*:/.test(asText), `逐字符打了行: ${asText}`)
  const asNumber = generateStructuredText({ 穿搭: 5 }, null, 'personal')
  assert.equal(typeof asNumber, 'string', '数字分类值不能再抛 TypeError')
})

test('报告：a.side 缺测时不写方向，0/正/负/window 各归各', () => {
  const mk = (side) =>
    generateStructuredText(
      recWith(specOf([{ name_cn: '肩', label: 'L', side, prefer: [], avoid: [], tier: '一档' }])),
      null,
      'personal',
    )
  assert.ok(mk(undefined).includes('**肩**'), '缺测不应整条丢掉')
  assert.ok(!/\*\*肩\*\*\(想收\)/.test(mk(undefined)), '缺测不许被印成"想收"')
  assert.ok(mk(-1).includes('**肩**(想收)'))
  assert.ok(mk(1).includes('**肩**(想加)'))
  assert.ok(mk(0).includes('**肩**(不推拉)'))
  assert.ok(mk('window').includes('**肩**: '), 'window 不写方向')
})

test('报告：胸腰差真的是 0 时那半个括号还在', () => {
  const out = generateStructuredText(
    recWith({
      top_spec: {
        fit: {
          present: true,
          size_label: '160/84A',
          size_scope: 'exact',
          size: { 体型档: ['-2~-6'], 体型中文: 'A' },
          drop_cm: 0,
          bmi: 22,
          bmi_band: { cn: '正常' },
          checks: [],
          measure_guide: [],
          note: 'n',
          ease_window_cm: [8, 12],
          target_finished_bust: [92, 96],
        },
        axes: [],
        missing: [],
        colour: { present: false },
      },
    }),
    null,
    'personal',
  )
  assert.ok(/胸腰差 0cm/.test(out), `drop_cm=0 的括号被 falsy 吞掉: ${out.slice(0, 500)}`)
})

// ============================================================
// 六、可解释性：'in' 的显示与匹配分拆分
// ============================================================

const { explainCondition, explainMatchedRecommendation } = require('../services/ruleExplainer')

test('解释：in 的值里带顿号逗号时，显示侧按同一个尺子切开', () => {
  // 引擎（checkSingleCondition）对数组元素再按 、,， 切一次，原来显示侧不切：
  // 一条 ["小麦色,古铜色"] 的规则两个值都能命中，界面只显示成"小麦色,古铜色"一个值
  const s = explainCondition({
    field: 'skin_tone',
    operator: 'in',
    value: JSON.stringify(['小麦色,古铜色']),
  })
  assert.ok(s.includes('小麦色') && s.includes('古铜色'), `没拆: ${s}`)
  assert.ok(!s.includes('小麦色,古铜色'), `还是连着的: ${s}`)
})

test('解释：匹配分给出分量，负分不再与"命中条件"同屏矛盾', () => {
  const out = explainMatchedRecommendation(
    { group_name: 'g', score: -2, feedback: -4, priority: 20, evidence_level: 'B' },
    [{ field: 'leg_proportion', operator: 'eq', value: 'short', matched: true }],
  )
  assert.equal(out.匹配分, -2, '总数仍是排序用的那个数')
  assert.equal(out.其中反馈修正, -4)
  assert.equal(out.其中权重和, 2)
})

// ============================================================
// 七、clothing：name 入库 + 路径 id 形状
// ============================================================

// 把上传落盘目录改到仓库外，再 require clothing.js（它在 require 时解构 UPLOAD_DIR）
const common = require('../utils/common')
const sandboxUpload = fs.mkdtempSync(path.join(os.tmpdir(), 'site3-clothing-'))
common.UPLOAD_DIR = sandboxUpload
const clothingRouter = require('../routes/clothing')
const uploadRoute = findRoute(clothingRouter, 'post', '/upload')
const deleteRoute = findRoute(clothingRouter, 'delete', '/:id')
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
])
const CLO_SID = 'sid-clothing-batch'
memDb.prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)').run('衣服测试者', CLO_SID)
const USER = {
  id: memDb.prepare('SELECT id FROM users WHERE session_id = ?').get(CLO_SID).id,
  session_id: CLO_SID,
}

test('clothing：上传时填的名字真的进了库，列表读得回来', () => {
  const r = call(uploadRoute, {
    user: USER,
    file: { originalname: 'a.png', mimetype: 'image/png', buffer: PNG },
    body: { name: '白衬衫', category: '上衣' },
  })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const row = memDb
    .prepare('SELECT item_name FROM clothing_items WHERE id = ?')
    .get(r.body.data.clothing_id)
  assert.equal(row.item_name, '白衬衫', 'body.name 原来只回显不入库')
  const list = call(findRoute(clothingRouter, 'get', '/list'), { user: USER })
  assert.equal(list.body.data.items[0].item_name, '白衬衫')
})

test('clothing：DELETE 的路径 id 必须逐字符是数字（12abc 不再真删第 12 行）', () => {
  const bad = call(deleteRoute, { params: { id: '12abc' }, user: USER })
  assert.equal(bad.statusCode, 400, JSON.stringify(bad.body))
  // 改前实测：parseInt('12abc') 得 12，这条 URL 会真删掉第 12 行并把那张图从磁盘 unlink
  const mine = call(deleteRoute, { params: { id: '999999' }, user: USER })
  assert.equal(mine.statusCode, 404, JSON.stringify(mine.body))
})

test('clothing：上传的文件落在仓库外的临时目录，测试结束一个不剩', () => {
  const left = fs.readdirSync(sandboxUpload)
  assert.ok(left.length > 0, '上传应当真的落盘过（否则上面那条断言没测到写盘）')
  for (const f of left) fs.unlinkSync(path.join(sandboxUpload, f))
  fs.rmdirSync(sandboxUpload)
  assert.equal(fs.existsSync(sandboxUpload), false, '落盘目录没清干净')
})

// ============================================================
// 八、tryon：路径 id 形状
// ============================================================

const tryonRouter = require('../routes/tryon')
const tryonGet = findRoute(tryonRouter, 'get', '/:id')

test('tryon：GET /:id 脏 id 回 400，不再把 #12 那份当成自己要的', () => {
  const g = memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run('试穿者', 'sid-tryon-b')
  const uid = g.lastInsertRowid
  const t = memDb
    .prepare(
      "INSERT INTO tryon_results (user_id, result_url, status) VALUES (?, '/uploads/t.png', 'done')",
    )
    .run(uid)
  const user = { id: uid, session_id: 'sid-tryon-b' }
  const ok = call(tryonGet, { params: { id: String(t.lastInsertRowid) }, user })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.data.result.id, Number(t.lastInsertRowid))
  const dirty = call(tryonGet, { params: { id: `${t.lastInsertRowid}abc` }, user })
  assert.equal(
    dirty.statusCode,
    400,
    `改前这条会回 #${t.lastInsertRowid} 的结果: ${JSON.stringify(dirty.body)}`,
  )
  const abc = call(tryonGet, { params: { id: 'abc' }, user })
  assert.equal(abc.statusCode, 400, JSON.stringify(abc.body))
})

// ============================================================
// 九、beijingTime：小时制写死
// ============================================================

const { beijingParts, beijingDateStr, beijingStamp } = require('../utils/beijingTime')

test("时间：北京 00:30 的日期是当天，且小时永远不出 '24'", () => {
  // 10-13 实测：本机与容器同为 Node v24.20.0，'en-GB' 与 'en-GB-u-hc-h23' 的
  // formatToParts 在 2000 个抽样时刻逐字段全等、且没有一次回 '24' ⇒ 这次是把默认值写死
  const at = new Date('2026-10-12T16:30:00Z') // = 北京 2026-10-13 00:30
  const p = beijingParts(at)
  assert.deepEqual([p.year, p.month, p.day], ['2026', '10', '13'])
  assert.equal(p.hour, '00')
  assert.equal(beijingDateStr(at), '2026-10-13')
  assert.equal(beijingStamp(at), '20261013003000')
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 47 * 61000)
    assert.notEqual(beijingParts(d).hour, '24')
  }
})
