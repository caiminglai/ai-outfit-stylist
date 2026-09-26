/**
 * 第二批美学规则（环5）测试
 *
 * 全部是纯函数与纯数据检查，不连数据库，跑在哪都一样：
 * - computeColorSeason：冷暖×深浅两轴 → 四季型，缺一轴就不猜
 * - computeProportionLevels：比例状态/肩型 → 中文档位（规则条件只能比分类值，不能比数字）
 * - rules-aesthetic.json：结构合格 + 条件值真的能被算出来（防"写一条永远命中不了的死规则"）
 *
 * 运行: node --test test/aestheticRules.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  computeColorSeason,
  computeProportionLevels,
  enrichProfile,
} = require('../services/profileEnricher')
const { FIELD_LABELS, ACTION_LABELS } = require('../services/ruleExplainer')
const { validateGroup, normalizeCondition, normalizeAction } = require('../db/applyRuleSeeds')

const SEED_PATH = path.join(__dirname, '..', 'db', 'seed', 'rules-aesthetic.json')
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'))
const rules = seed.rules

test('rules-aesthetic.json: 有规则且 key 不重复', () => {
  assert.ok(rules.length >= 30, `规则数应不少于 30,实际 ${rules.length}`)
  const keys = rules.map((r) => r.key)
  assert.strictEqual(new Set(keys).size, keys.length, '存在重复 key,会撞唯一索引')
})

test('rules-aesthetic.json: 每条都通过增量应用的骨架校验', () => {
  for (const r of rules) {
    assert.deepStrictEqual(validateGroup(r), [], `${r.key} 骨架不合格`)
  }
})

test('rules-aesthetic.json: 条件字段都在 FIELD_LABELS 里(否则后台看不到、引擎取不到)', () => {
  for (const r of rules) {
    for (const c of r.conditions) {
      assert.ok(FIELD_LABELS[c.field], `${r.key} 的条件字段无中文标签: ${c.field}`)
      assert.ok(!normalizeCondition(c).error, `${r.key} 条件归一化失败: ${c.field}`)
    }
  }
})

test('rules-aesthetic.json: 动作类型都有中文标签(否则英文键会直接显示给顾客)', () => {
  for (const r of rules) {
    r.actions.forEach((a, idx) => {
      assert.ok(ACTION_LABELS[a.type], `${r.key} 的动作类型无标签: ${a.type}`)
      assert.ok(!normalizeAction(a, idx).error, `${r.key} 第 ${idx + 1} 条动作不合格`)
    })
  }
})

// 规则条件只能按分类值命中，写一个算不出来的值就是一条永远不生效的死规则。
// 这张表是"每个条件字段能被 enrichProfile 算出的全部取值"，与 profileEnricher 的档位表对齐。
const REACHABLE_VALUES = {
  color_season: ['春型', '夏型', '秋型', '冬型'],
  leg_proportion: ['偏短', '标准', '偏长'],
  shoulder_frame: ['偏窄', '标准', '偏宽'],
  waist_definition: ['明显', '中等', '模糊'],
  skin_tone: ['暖皮', '冷皮', '自然', '白皙', '自然白', '偏黄', '小麦色', '古铜色'],
  scenario: [
    '通勤',
    '约会',
    '面试',
    '休闲',
    '聚会',
    '校园日常',
    '居家休闲',
    '商务正式',
    '运动健身',
    '婚礼宴会',
    '日常街拍',
    '职业照',
    '旅行打卡',
    '探店',
    '户外写真',
    '闺蜜合照',
    '自拍',
  ],
}

test('rules-aesthetic.json: 条件取值都算得出来(防死规则)', () => {
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

test('computeColorSeason: 冷暖×深浅两轴齐全才出四季型', () => {
  assert.deepStrictEqual(computeColorSeason('暖皮', '白皙'), { color_season: '春型' })
  assert.deepStrictEqual(computeColorSeason('暖皮', '偏黄'), { color_season: '秋型' })
  assert.deepStrictEqual(computeColorSeason('冷皮', '白皙'), { color_season: '夏型' })
  assert.deepStrictEqual(computeColorSeason('冷皮', '小麦色'), { color_season: '冬型' })
  assert.deepStrictEqual(computeColorSeason('自然', '白皙'), { color_season: '夏型' })
  assert.deepStrictEqual(computeColorSeason('自然', '古铜色'), { color_season: '秋型' })
})

test('computeColorSeason: 只有一轴时按深浅就近推,连深浅都没有就不给', () => {
  assert.deepStrictEqual(computeColorSeason('暖皮', null), {}, '只有冷暖不该硬猜四季')
  assert.deepStrictEqual(computeColorSeason('自然', null), {})
  assert.deepStrictEqual(
    computeColorSeason('白皙', undefined),
    { color_season: '夏型' },
    '只有深浅时按白皙→冷调兜底',
  )
  assert.deepStrictEqual(computeColorSeason('小麦色', undefined), { color_season: '秋型' })
  assert.deepStrictEqual(computeColorSeason(null, null), {})
})

test('computeProportionLevels: 三档换算成中文,肩宽缺实测时退回肩型', () => {
  assert.deepStrictEqual(computeProportionLevels({ leg_status: 'short' }), {
    leg_proportion: '偏短',
  })
  assert.deepStrictEqual(computeProportionLevels({ wh_status: 'warning' }), {
    waist_definition: '模糊',
  })
  assert.deepStrictEqual(computeProportionLevels({ shoulder_status: 'wide' }), {
    shoulder_frame: '偏宽',
  })
  assert.deepStrictEqual(computeProportionLevels({ shoulder_type: '窄肩' }), {
    shoulder_frame: '偏窄',
  })
  assert.deepStrictEqual(
    computeProportionLevels({ shoulder_status: 'narrow', shoulder_type: '宽肩' }),
    { shoulder_frame: '偏窄' },
    '有实测肩宽时不该被肩型覆盖',
  )
  assert.deepStrictEqual(computeProportionLevels({ shoulder_type: '斜肩' }), {}, '认不出的肩型不猜')
  assert.deepStrictEqual(computeProportionLevels({}), {})
})

test('enrichProfile: 门店口径(冷暖+深浅)能算出四季型', () => {
  const p = enrichProfile({
    gender: '女',
    skin_tone: '冷皮',
    skin_tone_detail: '小麦色',
    scenario: '通勤',
  })
  assert.strictEqual(p.color_season, '冬型')
})

test('enrichProfile: 个人口径(三围+腿高+肩型)能算出比例档位', () => {
  const p = enrichProfile({
    gender: '女',
    height: 160,
    weight: 50,
    bust: 86,
    waist: 66,
    hip: 96,
    leg_length: 72,
    shoulder_type: '窄肩',
    occasion: '商务正式',
  })
  assert.strictEqual(p.shoulder_frame, '偏窄')
  assert.ok(
    ['偏短', '标准', '偏长'].includes(p.leg_proportion),
    `腿身比档位异常: ${p.leg_proportion}`,
  )
  assert.ok(
    ['明显', '中等', '模糊'].includes(p.waist_definition),
    `腰线档位异常: ${p.waist_definition}`,
  )
  assert.strictEqual(p.scenario, '商务正式')
})

test('enrichProfile: 只填了深浅的老档案也能算出四季型', () => {
  const p = enrichProfile({ gender: '女', skin_tone_detail: '偏黄' })
  assert.strictEqual(p.skin_tone, '偏黄', '老映射:深浅缺冷暖时被当肤色基调用')
  assert.strictEqual(p.color_season, '秋型')
})
