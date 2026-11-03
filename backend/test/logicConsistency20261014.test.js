/**
 * 10-14 第五批：同一件事在两处口径不一致的那几条
 *
 * 来路：一只只读子代理把 backend/services|utils|middleware|db 重扫一遍，回 12 条。
 * 我逐条自己现量后，采纳 6 条改法，其余判为"不是本轮该动的"（理由写在这里，别下轮再重开）：
 *   · 已按测试声明的兜底（未知肤色→自然白 / 未知体型→hourglass / 未知脸型→鹅蛋脸）
 *     是 product 决定且 `test/profileEnricher.test.js:233-257` 明写在测，改它要他拍 ⇒ 这轮没动。
 *   · `profileArchive.js:219` 草稿只跳 nickname/phone，与 :399 的 12 键 stripIdentityFields
 *     用途不同（草稿要能回填表单，门店同步才剥身份）⇒ 判为有意不同，没动。
 *   · `colorMetrics.js` 的 NaN 分支、`dashscopeService.js` 的 mock 分支：全仓无生产调用方
 *     （analyzeFace 只有导出处）⇒ 不可达代码，按"先跑通"线不补。
 *   · `recommendEngine.js` 无条件组恒命中：种子端 applyRuleSeeds.js 已挡，写入口在 routes ⇒ 超本轮范围。
 *   · `backend/middleware/auth.js:175` 读的 password_changed_at：只有 `db/init.js:264` 写过 ⇒ 改密路径在 routes，超本轮范围。
 *
 * 采纳的 6 条（每条都是"两处不是同一个数/两个结论相反"，不是新功能）：
 *   1 解释层取值顺了原型链，判定层不顺（recommendEngine.js 用 ownValue）
 *   2 肩宽比：画像层拿原始值比切点、只在输出取整；版型层拿取整后的值比带 ⇒ 同一个人两个说法
 *   3 腿身比：同上，切点 0.52/0.56
 *   4 BMI 体量轴与松量窗口：同上，measure.bmi 是 r1 过的，判据却读原始值
 *   5 种子 operator=in 缺候选值 ⇒ 塞 'all'，存成 ['all'] 永不命中，那条守卫永远走不到
 *   6 全套搭配的 complete 数格数、note 看 missing ⇒ 没衣服也能"已凑齐"
 *   7 八字调候替换掉原第 2 位喜用，summary 不说让位的是哪一行
 */
const test = require('node:test')
const assert = require('node:assert')

const { extractMatchValue } = require('../services/ruleExplainer')
const { computeShoulderRatio, computeLegRatio } = require('../services/profileEnricher')
const { bodyDeviation } = require('../services/topFitBody')
const { normalizeCondition } = require('../db/applyRuleSeeds')
const { buildFullLook } = require('../services/fullLookAdvisor')
const { analyzeBazi } = require('../services/baziWuxing')

const item = (name, category) => ({ name, category })

// ---------- 1 解释层不再从原型上捞值 ----------

test('extractMatchValue: 自有键照旧取值', () => {
  assert.strictEqual(extractMatchValue({ gender: '女' }, 'gender'), '女')
})

test('extractMatchValue: field 是原型名时不把 Object.prototype 当条件值', () => {
  const parsed = { color_season: '春型' }
  for (const field of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const got = extractMatchValue(parsed, field)
    assert.notStrictEqual(got, Object.prototype, field + ' 命中了原型')
    assert.notStrictEqual(typeof got, 'function', field + ' 返回了函数')
    // 与判定层同一个结论：解释层这里落到"取第一个自有值"，绝不返回原型对象
    assert.strictEqual(got, '春型')
  }
})

test('extractMatchValue: 数组与直接值形状不受影响', () => {
  assert.deepStrictEqual(extractMatchValue(['春型', '秋型'], 'color_season'), ['春型', '秋型'])
  assert.strictEqual(extractMatchValue('春型', 'color_season'), '春型')
})

// ---------- 2 肩宽比：先取整再比切点 ----------

test('computeShoulderRatio: 24.03 取整成 24.0 后是带内，不再报偏宽', () => {
  const r = computeShoulderRatio(38.45, 160) // 原始 24.03125
  assert.strictEqual(r.shoulder_ratio, 24)
  assert.strictEqual(r.shoulder_status, 'normal')
})

test('computeShoulderRatio: 真的过线才报偏宽（反向对照）', () => {
  const r = computeShoulderRatio(38.5, 160) // 24.0625 → 24.1
  assert.strictEqual(r.shoulder_ratio, 24.1)
  assert.strictEqual(r.shoulder_status, 'wide')
})

test('computeShoulderRatio: 21 那条切点同口径（边界取整后算带内）', () => {
  assert.strictEqual(computeShoulderRatio(33.55, 160).shoulder_status, 'normal') // 20.96875 → 21.0
  assert.strictEqual(computeShoulderRatio(33.5, 160).shoulder_status, 'narrow') // 20.9375 → 20.9
})

test('版型层同一人：肩宽比 24.0 走"带内不推拉"，与画像层的 normal 对得上', () => {
  const d = bodyDeviation({ height: 160, shoulder: 38.45 })
  assert.strictEqual(d.measure.shoulder_ratio, 24)
  assert.ok(
    d.notes.some((n) => n.includes('肩宽比') && n.includes('在参考带内')),
    'notes=' + JSON.stringify(d.notes),
  )
})

// ---------- 3 腿身比：同一口径 ----------

test('computeLegRatio 与版型层对 0.518 这档说法一致（都算带内）', () => {
  const e = computeLegRatio(82.88, 160) // 原始 0.518 → 取整 0.52
  assert.strictEqual(e.leg_ratio, 0.52)
  assert.strictEqual(e.leg_status, 'normal')
  const d = bodyDeviation({ height: 160, leg_length: 82.88 })
  assert.strictEqual(d.measure.leg_ratio, 0.52)
  assert.strictEqual(d.want.length, null, '取整后已在带内，不该再推短款塞腰头')
  assert.ok(
    d.notes.some((n) => n.includes('腿身比') && n.includes('在参考带内')),
    'notes=' + JSON.stringify(d.notes),
  )
})

test('腿身比真的偏短才推（反向对照）', () => {
  const d = bodyDeviation({ height: 160, leg_length: 82.0 }) // 0.5125 → 取整 0.51，仍在带下沿之外
  assert.strictEqual(d.measure.leg_ratio, 0.51)
  assert.ok(d.want.length > 0)
})

// ---------- 4 BMI：判据读的就是回显那个数 ----------

test('BMI 23.96 取整成 24.0 ⇒ 体量轴按"正常/偏胖切点"这一侧走，与 measure.bmi 同源', () => {
  const d = bodyDeviation({ height: 160, weight: 61.35 }) // 61.35/1.6² = 23.9648 → r1 24
  assert.strictEqual(d.measure.bmi, 24)
  // 切点 bmi_normal=24：原来判据读原始 23.96 ⇒ 落到最后那条 else（want.volume=0，"这维不推拉"），
  // 而卡片上的 measure.bmi 写着 24（"过线"那一侧）⇒ 同一个人两个口径。取整后两边都是 24 ⇒ -0.3。
  assert.strictEqual(d.want.volume, -0.3)
})

test('条纹闸门与体量轴用的是同一个取整值（24.95~25.0 那段不再自相矛盾）', () => {
  const d = bodyDeviation({ height: 160, weight: 63.9 }) // 63.9/2.56 = 24.9609 → r1 25.0
  assert.strictEqual(d.measure.bmi, 25)
  // measure.bmi=25 ≥ stripe_bmi_max=25 ⇒ 条纹这条不采用；两侧都读同一个 25
  assert.ok(
    d.notes.some((n) => n.includes('条纹方向这条不采用')),
    'notes=' + JSON.stringify(d.notes),
  )
})

// ---------- 5 种子：in 缺候选值是报错，不是塞 'all' ----------

test('normalizeCondition: operator=in 缺 value 直接报错（守卫可达）', () => {
  const r = normalizeCondition({ field: 'color_season', operator: 'in' })
  assert.ok(r.error, '应报错，实得=' + JSON.stringify(r))
  assert.match(r.error, /缺少候选值/)
})

test('normalizeCondition: 空串/空数组的 in 同样报错', () => {
  for (const value of ['', '   ', []]) {
    const r = normalizeCondition({ field: 'color_season', operator: 'in', value })
    assert.ok(r.error, JSON.stringify(value) + ' 应报错')
    assert.match(r.error, /缺少候选值/)
  }
})

test('normalizeCondition: eq 缺 value 仍是"不限"（原口径没被带歪）', () => {
  const r = normalizeCondition({ field: 'color_season', operator: 'eq' })
  assert.strictEqual(r.value, JSON.stringify({ color_season: 'all' }))
  assert.strictEqual(r.weight, 1)
})

test('normalizeCondition: in 给了候选值照常存数组', () => {
  const r = normalizeCondition({ field: 'color_season', operator: 'in', value: '春型、秋型' })
  assert.strictEqual(r.value, JSON.stringify({ color_season: ['春型', '秋型'] }))
})

// ---------- 6 全套搭配：complete 与 note 同一件事 ----------

test('只有妆容和配饰、衣服一件没有 ⇒ 不许报"已凑齐"', () => {
  const look = buildFullLook(
    {
      outfit: [],
      makeup: [item('粉底液', '粉底'), item('豆沙口红', '口红')],
      accessory: [item('锁骨链', '项链')],
    },
    '通勤',
  )
  assert.strictEqual(look.pieces.length, 3)
  assert.strictEqual(look.complete, false, '原来 pieces>=3 就报 true')
  assert.ok(look.missing_parts.includes('上衣'))
  assert.match(look.note, /还缺/)
})

test('衣服+妆容+配饰齐 ⇒ complete 与 note 同说"齐"（正向对照）', () => {
  const look = buildFullLook(
    {
      outfit: [item('白衬衫', '衬衫'), item('直筒牛仔裤', '裤子')],
      makeup: [item('粉底液', '粉底'), item('豆沙口红', '口红')],
      accessory: [item('锁骨链', '项链')],
    },
    '约会',
  )
  assert.strictEqual(look.complete, true)
  assert.deepStrictEqual(look.missing_parts, [])
  assert.match(look.note, /已凑齐一套/)
})

test('三柜全空仍是 false（原行为没被改坏）', () => {
  const look = buildFullLook({ outfit: [], makeup: [], accessory: [] })
  assert.strictEqual(look.complete, false)
  assert.match(look.note, /还没有可搭配的单品/)
})

// ---------- 7 八字调候：summary 交代让位的那一行 ----------

test('调候替换喜用时，summary 写明哪一行让位', () => {
  const r = analyzeBazi('2024-01-20', '02时')
  assert.ok(r, '2024-01-20 应能排盘')
  assert.match(r.summary, /冬月取火调候（.+让位）/)
  assert.deepStrictEqual(r.favorable, ['金', '火'])
  // 让位的那一行确实不在喜用里：说了就得是真说了
  assert.ok(!r.favorable.includes('水'))
})

test('非调候月份不写这句（反向对照）', () => {
  const r = analyzeBazi('2024-04-10', '10时')
  assert.ok(r)
  assert.ok(!r.summary.includes('让位'), 'summary=' + r.summary)
})
