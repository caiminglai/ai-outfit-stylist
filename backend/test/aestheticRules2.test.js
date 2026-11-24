/**
 * 第三批美学规则（环5补：色彩十二型 + 风格型）测试
 *
 * 与 aestheticRules.test.js 同口径：全部纯函数/纯数据检查，不连数据库。
 * 重点防两件事：
 *   1. 新字段算不出来的取值写进规则 = 永远命中不了的死规则
 *   2. 加了纯度轴之后把老的四季型算没了 = 线上 20 条四季规则集体失效
 *
 * 运行: node --test test/aestheticRules2.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  computeColorSeason12,
  computeKibbeType,
  CHROMA_LEVEL,
  FRAME_LEVEL,
  LINE_LEVEL,
  COLOR_SEASON_12_TABLE,
  KIBBE_TABLE,
  enrichProfile,
} = require('../services/profileEnricher')
const { FIELD_LABELS, ACTION_LABELS } = require('../services/ruleExplainer')
const { validateGroup, normalizeCondition, normalizeAction } = require('../db/applyRuleSeeds')

const SEED_DIR = path.join(__dirname, '..', 'db', 'seed')
const rules = JSON.parse(
  fs.readFileSync(path.join(SEED_DIR, 'rules-aesthetic-2.json'), 'utf-8'),
).rules
const batch1 = JSON.parse(
  fs.readFileSync(path.join(SEED_DIR, 'rules-aesthetic.json'), 'utf-8'),
).rules

// 派生字段的合法取值直接从 profileEnricher 的档位表取，测试与实现不会各写一份而漂移
const REACHABLE_VALUES = {
  color_season_12: [
    ...new Set(Object.values(COLOR_SEASON_12_TABLE).flatMap((row) => Object.values(row))),
  ],
  kibbe_type: [...new Set(Object.values(KIBBE_TABLE).flatMap((row) => Object.values(row)))],
}

test('rules-aesthetic-2.json: 有规则且 key 不重复', () => {
  assert.strictEqual(rules.length, 34, `规则数应为 34,实际 ${rules.length}`)
  const keys = rules.map((r) => r.key)
  assert.strictEqual(new Set(keys).size, keys.length, '存在重复 key,会撞唯一索引')
  const overlap = keys.filter((k) => batch1.some((r) => r.key === k))
  assert.deepStrictEqual(overlap, [], '与第一批撞 key,后插的那批会被当成已存在')
})

test('rules-aesthetic-2.json: 每条都通过增量应用的骨架校验', () => {
  for (const r of rules) {
    assert.deepStrictEqual(validateGroup(r), [], `${r.key} 骨架不合格`)
  }
})

test('rules-aesthetic-2.json: 条件字段与动作类型都有中文标签', () => {
  for (const r of rules) {
    for (const c of r.conditions) {
      assert.ok(FIELD_LABELS[c.field], `${r.key} 的条件字段无中文标签: ${c.field}`)
      assert.ok(!normalizeCondition(c).error, `${r.key} 条件归一化失败: ${c.field}`)
    }
    r.actions.forEach((a, idx) => {
      assert.ok(ACTION_LABELS[a.type], `${r.key} 的动作类型无标签: ${a.type}`)
      assert.ok(!normalizeAction(a, idx).error, `${r.key} 第 ${idx + 1} 条动作不合格`)
    })
  }
})

test('rules-aesthetic-2.json: 条件取值都算得出来(防死规则)', () => {
  for (const r of rules) {
    for (const c of r.conditions) {
      const allowed = REACHABLE_VALUES[c.field]
      assert.ok(allowed, `测试未登记字段 ${c.field},请补进 REACHABLE_VALUES`)
      const values = Array.isArray(c.value)
        ? c.value
        : String(c.value)
            .split(/[、,，]/)
            .map((s) => s.trim())
      for (const v of values) {
        assert.ok(allowed.includes(v), `${r.key}: ${c.field}="${v}" 不是算得出的取值`)
      }
    }
  }
})

test('rules-aesthetic-2.json: 十二型每一型都有穿搭+妆容,五型每一种都有穿搭+配饰', () => {
  const countBy = (field, value, category) =>
    rules.filter((r) =>
      r.conditions.some((c) => c.field === field && c.value === value && r.category === category),
    ).length
  for (const v of REACHABLE_VALUES.color_season_12) {
    assert.strictEqual(countBy('color_season_12', v, '穿搭'), 1, `${v} 缺穿搭规则`)
    assert.strictEqual(countBy('color_season_12', v, '妆容'), 1, `${v} 缺妆容规则`)
  }
  for (const v of REACHABLE_VALUES.kibbe_type) {
    assert.strictEqual(countBy('kibbe_type', v, '穿搭'), 1, `${v} 缺穿搭规则`)
    assert.strictEqual(countBy('kibbe_type', v, '配饰'), 1, `${v} 缺配饰规则`)
  }
})

test('rules-aesthetic-2.json: 细化规则优先级高于第一批色彩规则,排在前面但不覆盖', () => {
  const batch1ColorMax = Math.max(
    ...batch1
      .filter((r) => r.conditions.some((c) => c.field === 'color_season'))
      .map((r) => r.priority),
  )
  const color12 = rules.filter((r) => r.conditions.some((c) => c.field === 'color_season_12'))
  assert.ok(color12.length > 0, '第一批里应该没有 color_season_12 规则')
  for (const r of color12) {
    assert.ok(
      r.priority > batch1ColorMax,
      `${r.key} 优先级 ${r.priority} 不高于第一批色彩规则 ${batch1ColorMax}`,
    )
  }
  for (const r of rules) {
    assert.ok(
      r.priority >= 1 && r.priority <= 30,
      `${r.key} 优先级 ${r.priority} 超出 1~30,会压过全部老规则`,
    )
  }
})

test('computeColorSeason12: 四季×纯度 12 格全落位,与第一批的四季归属不冲突', () => {
  const seen = new Set()
  for (const [season, row] of Object.entries(COLOR_SEASON_12_TABLE)) {
    for (const [formValue, axis] of Object.entries(CHROMA_LEVEL)) {
      assert.deepStrictEqual(
        computeColorSeason12(season, formValue),
        { color_season_12: row[axis] },
        `${season} × ${formValue} 落位不对`,
      )
      seen.add(row[axis])
    }
  }
  assert.strictEqual(seen.size, 12, `十二型应得 12 个不同结果,实际 ${seen.size}`)
})

test('computeColorSeason12: 缺纯度或缺四季型就不给,不硬猜', () => {
  assert.deepStrictEqual(computeColorSeason12('春型', null), {})
  assert.deepStrictEqual(computeColorSeason12('春型', '说不准'), {}, '认不出的纯度档不猜')
  assert.deepStrictEqual(computeColorSeason12(null, '净亮'), {})
  assert.deepStrictEqual(computeColorSeason12(undefined, undefined), {})
})

test('computeKibbeType: 骨架×线条 9 格收敛到五型方向', () => {
  const seen = new Set()
  for (const [formFrame, frameAxis] of Object.entries(FRAME_LEVEL)) {
    for (const [formLine, lineAxis] of Object.entries(LINE_LEVEL)) {
      const r = computeKibbeType(formFrame, formLine)
      assert.strictEqual(
        r.kibbe_type,
        KIBBE_TABLE[frameAxis][lineAxis],
        `${formFrame}×${formLine} 落位不对`,
      )
      assert.ok(
        REACHABLE_VALUES.kibbe_type.includes(r.kibbe_type),
        `算出的 ${r.kibbe_type} 不在五型内`,
      )
      seen.add(r.kibbe_type)
    }
  }
  assert.strictEqual(seen.size, 5, `九格应收敛出 5 型,实际 ${seen.size}`)
})

test('computeKibbeType: 缺一轴就不给', () => {
  assert.deepStrictEqual(computeKibbeType('小巧', null), {})
  assert.deepStrictEqual(computeKibbeType(null, '偏直线'), {})
  assert.deepStrictEqual(computeKibbeType('超大', '偏直线'), {}, '认不出的骨架档不猜')
})

test('enrichProfile: 冷暖+深浅+纯度三轴齐全才算十二型,四季型照常保留', () => {
  const p = enrichProfile({
    gender: '女',
    skin_tone: '暖皮',
    skin_tone_detail: '白皙',
    color_chroma: '净亮',
  })
  assert.strictEqual(p.color_season, '春型', '加了纯度不该把四季算丢')
  assert.strictEqual(p.color_season_12, '亮春型')
})

test('enrichProfile: 没选纯度的老档案结果与改动前一致(线上四季规则不受影响)', () => {
  const p = enrichProfile({ gender: '女', skin_tone: '暖皮', skin_tone_detail: '白皙' })
  assert.strictEqual(p.color_season, '春型')
  assert.strictEqual(p.color_season_12, undefined, '没选纯度不该凭空多出十二型')
})

test('enrichProfile: 骨架+线条两轴齐全才算风格型', () => {
  const p = enrichProfile({ gender: '女', frame_size: '大气', line_quality: '均衡' })
  assert.strictEqual(p.kibbe_type, '自然型')
  const partial = enrichProfile({ gender: '女', frame_size: '大气' })
  assert.strictEqual(partial.kibbe_type, undefined)
})
