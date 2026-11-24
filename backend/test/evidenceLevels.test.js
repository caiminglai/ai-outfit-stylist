/**
 * 依据分档测试
 *
 * 为什么要单独测:档位决定顾客端能不能说"科学依据"。
 * 判档唯一实现处是 services/evidenceLevels.js，种子写入(applyRuleSeeds)与
 * 后台读写(routes/rules)都只是转调它，所以这里测前缀映射 + 解释器输出即可。
 */
const test = require('node:test')
const assert = require('node:assert')
const {
  EVIDENCE_LEVELS,
  VALUES,
  evidenceOf,
  evidenceNote,
  LABELS,
  DEFAULT_LEVEL,
} = require('../services/evidenceLevels')
const { explainGroup, explainMatchedRecommendation } = require('../services/ruleExplainer')

// ============================================================
// 前缀判档
// ============================================================
test('evidenceOf: 命理体系独立成 D 档，不混进 A/B', () => {
  assert.strictEqual(evidenceOf('wuxing_mu_outfit'), 'D')
  assert.strictEqual(evidenceOf('wuxing-火-配饰'), 'D')
})

test('evidenceOf: 比例类按硬度分档（肩宽国标、腰臀比与腿身比实证）', () => {
  assert.strictEqual(evidenceOf('proportion-shoulder-wide'), 'A')
  assert.strictEqual(evidenceOf('proportion-waist-good'), 'B')
  assert.strictEqual(evidenceOf('proportion-leg-short'), 'B')
  assert.strictEqual(evidenceOf('proportion_body_x'), 'B')
})

test('evidenceOf: 行业体系四类都是 C，查不到检验的不许升档', () => {
  ;[
    'color12-winter',
    'color-autumn-outfit-f',
    'kibbe-gamine-outfit',
    'dresscode-commute',
    'metal-warm',
  ].forEach((k) => assert.strictEqual(evidenceOf(k), 'C', k))
})

test('evidenceOf: 空 key 返回 null(未标注)，认不出的前缀按 C 兜底', () => {
  assert.strictEqual(evidenceOf(null), null)
  assert.strictEqual(evidenceOf(''), null)
  assert.strictEqual(evidenceOf('手写的某体系'), DEFAULT_LEVEL)
})

test('VALUES 只有 A/B/C/D 四档，A/B 才允许"科学/量化"话术', () => {
  assert.deepStrictEqual(VALUES, ['A', 'B', 'C', 'D'])
  assert.strictEqual(EVIDENCE_LEVELS.length, 4)
  EVIDENCE_LEVELS.forEach((l) => {
    assert.ok(l.label && l.note, `${l.value} 必须有标签与说明`)
  })
})

test('evidenceNote: 未标注按 C 对待而不是回空串', () => {
  assert.strictEqual(evidenceNote(null), evidenceNote('C'))
  assert.ok(
    String(evidenceNote('D')).includes('八字'),
    `D 档说明要点明是八字五行: ${evidenceNote('D')}`,
  )
  assert.ok(
    String(evidenceNote('A')).includes('标准'),
    `A 档说明要点明国标/国际标准: ${evidenceNote('A')}`,
  )
  assert.ok(String(LABELS.D).includes('命理'))
})

// ============================================================
// 可解释性输出要带档位(顾客端与后台都读这两个键)
// ============================================================
const fakeGroup = {
  id: 1,
  name: '比例-腿身比偏短',
  category: 'outfit',
  scenario: null,
  gender: null,
  priority: 18,
  description: '视觉比例',
  evidence_level: 'B',
}
const fakeConds = [
  {
    field: 'leg_proportion',
    operator: 'eq',
    value: '{"leg_proportion":"偏短"}',
    weight: 3,
    matched: true,
  },
]

test('explainGroup: 输出含依据档位与依据说明', () => {
  const out = explainGroup(fakeGroup, fakeConds, [])
  assert.strictEqual(out.依据档位, 'B 学术实证')
  assert.ok(String(out.依据说明).length > 10, '依据说明要能读，不能只给个字母')
})

test('explainGroup: 库里没标档位时显示未标注而不是空白', () => {
  const out = explainGroup({ ...fakeGroup, evidence_level: null }, fakeConds, [])
  assert.ok(String(out.依据档位).startsWith('未标注'), `实际: ${out.依据档位}`)
})

test('explainMatchedRecommendation: 命中说明也带依据档位', () => {
  const out = explainMatchedRecommendation(
    { group_name: '比例-腿身比偏短', score: 3, priority: 18, evidence_level: 'D' },
    fakeConds,
  )
  assert.strictEqual(out.依据档位, 'D 命理体系')
})
