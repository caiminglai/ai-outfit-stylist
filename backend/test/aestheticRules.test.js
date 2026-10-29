/**
 * 第二批美学规则（环5）测试
 *
 * 全部是纯函数与纯数据检查，不连数据库，跑在哪都一样：
 * - computeColorSeason：冷暖×深浅两轴 → 四季型，缺一轴就不猜
 * - computeProportionLevels：比例状态/肩型 → 中文档位（规则条件只能比分类值，不能比数字）
 * - rules-aesthetic.json：结构合格 + 条件值真的能被算出来（防"写一条永远命中不了的死规则"）
 * - 全部 rules-*.json + db/seed/rules.json 快照：档位有没有人管、两性各自能不能被服务到
 *   （10-19 加：原先这条反向防漏档只按 field/value 聚合，把组的性别整个丢掉了，
 *    于是"姿势只有女性组"这种事查不出来；见下面 loadCoverageCorpus）
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
const { HEALTH_BANDS } = require('../services/bmi')
const { BODY_TYPES } = require('../services/bodyTypes')

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
// bmi_level / body_type 两档直接从词表的唯一出处取（services/bmi.js 的 HEALTH_BANDS、
// services/bodyTypes.js 的 BODY_TYPES），不在这里手抄一遍——10-19 的词形断裂就是
// 因为「引擎出一套、规则库抄一套」，手抄的那份永远比真身慢一轮。
const REACHABLE_VALUES = {
  color_season: ['春型', '夏型', '秋型', '冬型'],
  leg_proportion: ['偏短', '标准', '偏长'],
  shoulder_frame: ['偏窄', '标准', '偏宽'],
  waist_definition: ['明显', '中等', '模糊'],
  skin_tone: ['暖皮', '冷皮', '自然', '白皙', '自然白', '偏黄', '小麦色', '古铜色'],
  height_range: ['150-160', '160-170', '170-180', '180+'],
  bmi_level: HEALTH_BANDS.map((b) => b.level),
  body_type: BODY_TYPES,
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

// 反方向：算得出的取值，有没有至少一条规则真的会命中它。
// 上面那条只查"规则里写的值算不算得出来"（防死规则），查不到"某个档位没人管"。
// 10-12 全量审计就是靠这条才发现 height_range 少 170-180 一档：170~179cm 的人
// 命不中任何按身高分档的规则组，而库里 180+ 那组的 reason 原文写的是「高个子（>170cm）」。
// 语料＝五个种子文件（applyRuleSeeds 每次启动按 key 补）＋ db/seed/rules.json
//（rules.json 是 export-rules.js 导出的整库快照，add-rules.js 那批老规则没有 source_key，只在这里能查到）。
//
// ⚠️ 10-19 改造：这一条原先只看条件的 field/value，把整条组的信息全丢了 ⇒
// 「body_type=梨形 有规则」这种结论其实只覆盖女性（男性那一档压根没有），漏档被算成已覆盖。
// 现在每条条件都带着它所在组的 gender / mode / category / enabled 一起判。
const COVERAGE_FILES = [
  'db/seed/rules-aesthetic.json',
  'db/seed/rules-aesthetic-2.json',
  'db/seed/rules-wuxing.json',
  'db/seed/rules-height-bmi-gapfill.json',
  'db/seed/rules-pose-male-personal.json',
  'db/seed/rules-scenario-genderfill.json',
  'db/seed/rules.json',
]

/** 把一条条件的存值切成候选值数组：种子写 "春型" 或 ["春型","夏型"]，库里存 {"field":...} 或 JSON 串 */
function conditionCandidates(cond) {
  let v = cond.value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      /* 不是 JSON，原样当字符串 */
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    v = Object.prototype.hasOwnProperty.call(v, cond.field) ? v[cond.field] : Object.values(v)[0]
  }
  return String(Array.isArray(v) ? v.join('、') : v)
    .split(/[、,，]/)
    .map((s) => String(s).trim())
    .filter(Boolean)
}

/**
 * 读全部语料，产出**规则组**列表（不是裸条件列表）：
 *   { from, key, name, mode, category, gender, enabled, conditions:[{field,operator,values}] }
 * 种子形状里组自己带 conditions；快照形状要按 group_id 把 rule_conditions join 回来，
 * 否则 gender/mode/category 这三样全丢——那正是原先这个测试查不出性别漏档的原因。
 */
function loadCoverageCorpus() {
  const groups = []
  for (const rel of COVERAGE_FILES) {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8'))
    if (Array.isArray(data.rules)) {
      for (const r of data.rules) {
        groups.push({
          from: rel,
          key: r.key,
          name: r.name,
          mode: r.mode,
          category: r.category,
          gender: r.gender === undefined ? null : r.gender,
          enabled: r.enabled === 0 ? 0 : 1,
          conditions: (r.conditions || []).map((c) => ({
            field: c.field,
            operator: c.operator || 'eq',
            values: conditionCandidates(c),
          })),
        })
      }
      continue
    }
    const meta = new Map()
    for (const g of data.rule_groups || []) meta.set(g.id, g)
    const condByGroup = new Map()
    for (const c of data.rule_conditions || []) {
      if (!condByGroup.has(c.group_id)) condByGroup.set(c.group_id, [])
      condByGroup.get(c.group_id).push({
        field: c.field,
        operator: c.operator || 'eq',
        values: conditionCandidates(c),
      })
    }
    for (const g of meta.values()) {
      groups.push({
        from: rel,
        key: g.source_key || `(无key#${g.id})`,
        name: g.name,
        mode: g.mode,
        category: g.category,
        gender: g.gender === undefined ? null : g.gender,
        enabled: g.enabled === 0 ? 0 : 1,
        conditions: condByGroup.get(g.id) || [],
      })
    }
  }
  return groups
}

/** 组上 gender 留空＝两性通用；写死＝只有那一性（引擎那句是 `gender = ? OR gender IS NULL`） */
function servesGender(group, gender) {
  return group.gender === null || group.gender === gender
}

/**
 * 已知且暂时不补的性别漏档（10-19 逐格数出来 5 处）。
 * 这是**棘轮**不是免检牌：清单里每一格测试会确认它现在确实还是空的（补上了就报"请删掉这一行"），
 * 清单外新出现的空格直接判失败。为什么先留着这 5 格：skin_tone_detail 那五档（白皙/自然白/
 * 偏黄/小麦色/古铜色）目前只有女性向的妆容组在用；男性 personal 模式这一栏不至于整栏为空
 * （「暖皮/冷皮/自然」三档各有配饰组命中），要不要给男性补五档妆容是产品决定，等他拍。
 */
const KNOWN_GENDER_GAPS = [
  'skin_tone=白皙 × 男',
  'skin_tone=自然白 × 男',
  'skin_tone=偏黄 × 男',
  'skin_tone=小麦色 × 男',
  'skin_tone=古铜色 × 男',
]

test('每个算得出的分档取值 × 两性各自至少被一条启用的规则命中(反向防漏档·性别感知)', () => {
  const groups = loadCoverageCorpus().filter((g) => g.enabled === 1)
  const gaps = []
  for (const [field, values] of Object.entries(REACHABLE_VALUES)) {
    for (const value of values) {
      for (const gender of ['男', '女']) {
        // ne 是"排除"，它命中不了某个具体档位，不能拿来充覆盖
        const hit = groups.filter(
          (g) =>
            servesGender(g, gender) &&
            g.conditions.some(
              (c) => c.field === field && c.operator !== 'ne' && c.values.includes(value),
            ),
        )
        if (hit.length === 0) gaps.push(`${field}=${value} × ${gender}`)
      }
    }
  }
  const extra = gaps.filter((g) => !KNOWN_GENDER_GAPS.includes(g))
  const stale = KNOWN_GENDER_GAPS.filter((g) => !gaps.includes(g))
  assert.deepStrictEqual(
    extra,
    [],
    `新出现的性别漏档 ${extra.length} 处（这个分档只有另一性别有规则）：\n  ${extra.join('\n  ')}`,
  )
  assert.deepStrictEqual(
    stale,
    [],
    `KNOWN_GENDER_GAPS 里这 ${stale.length} 格现在已经有规则命中了，请把清单里那一行删掉：${stale.join('、')}`,
  )
})

test('两性在每个 category × mode 下可用的规则组都不为空(姿势整栏为空就是在这里抓)', () => {
  const groups = loadCoverageCorpus().filter((g) => g.enabled === 1)
  // 引擎筛 mode 的那句是 `mode = ? OR mode = 'all'` ⇒ mode=all 同时服务两套
  const covers = (g, mode) => g.mode === mode || g.mode === 'all'
  const empty = []
  for (const category of [...new Set(groups.map((g) => g.category))].sort()) {
    for (const mode of ['personal', 'store']) {
      const count = (gender) =>
        groups.filter((g) => g.category === category && covers(g, mode) && servesGender(g, gender))
          .length
      const male = count('男')
      const female = count('女')
      if (male === 0 || female === 0) {
        empty.push(`${category} / ${mode} ⇒ 男 ${male} 组、女 ${female} 组`)
      }
    }
  }
  assert.deepStrictEqual(
    empty,
    [],
    `这些 (category × mode) 格子里有一性别的顾客一条规则都命不中，那一栏会整屏退回硬编码兜底：\n  ${empty.join('\n  ')}`,
  )
})

test('全部 rules-*.json 种子：骨架合格、key 跨文件唯一、条件与动作都有标签', () => {
  const dir = path.join(__dirname, '..', 'db', 'seed')
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^rules-.*\.json$/.test(f))
    .sort()
  assert.ok(files.length >= 5, `种子文件应有 5 份以上，实际 ${files.length}: ${files.join(',')}`)
  const keys = []
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
    for (const r of data.rules || []) {
      assert.deepStrictEqual(validateGroup(r), [], `${f}/${r.key} 骨架不合格`)
      keys.push(r.key)
      for (const c of r.conditions) {
        assert.ok(FIELD_LABELS[c.field], `${f}/${r.key} 条件字段无中文标签: ${c.field}`)
        assert.ok(!normalizeCondition(c).error, `${f}/${r.key} 条件归一化失败: ${c.field}`)
      }
      r.actions.forEach((a, idx) => {
        assert.ok(ACTION_LABELS[a.type], `${f}/${r.key} 动作类型无中文标签: ${a.type}`)
        assert.ok(!normalizeAction(a, idx).error, `${f}/${r.key} 第 ${idx + 1} 条动作不合格`)
      })
    }
  }
  assert.strictEqual(
    new Set(keys).size,
    keys.length,
    `跨文件存在重复 key，会撞唯一索引（共 ${keys.length} 条）`,
  )
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
