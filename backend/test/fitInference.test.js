'use strict'
/**
 * 版型推断层单测（10-21 第十三阶段·第一步 §三；验收＝docs/依据/21 §八 第 6、7 格）。
 * ⛔ 本文件不碰数据库：词表与判据全是纯函数，全语料的在场率与冲突行数走盘外工装
 *    `probe-fit-infer.cjs`（跑在 `站3产生临时文件/phase13-20261021/base.db` 那份只读副本上）。
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { FIT_TYPE_VALUES, FABRIC_WEIGHT_VALUES } = require('../services/topFitBody')
const {
  FIT_INFER_WORDS,
  FABRIC_WEIGHT_WORDS,
  inferFitType,
  inferFabricWeight,
} = require('../services/fitInference')

test('§三·2 值域锁死：词表的键就是库里那四档与那三档，⛔ 第五档／数值档', () => {
  assert.deepStrictEqual(
    Object.keys(FIT_TYPE_VALUES.length === 4 ? FIT_INFER_WORDS : {}),
    FIT_TYPE_VALUES,
  )
  assert.deepStrictEqual(Object.keys(FABRIC_WEIGHT_WORDS), ['厚', '薄', '中'])
  assert.strictEqual(FIT_TYPE_VALUES.length, 4, '库里就是四档，本模块不许加第五档')
  assert.strictEqual(FABRIC_WEIGHT_VALUES.length, 3, '厚薄就是三档')
  // 每档至少有一个词，⛔ 空档（空档＝这一档永远认不出来，表就是骗人的）
  for (const [g, ws] of Object.entries(FIT_INFER_WORDS)) assert.ok(ws.length > 0, `${g} 档是空的`)
  for (const [g, ws] of Object.entries(FABRIC_WEIGHT_WORDS))
    assert.ok(ws.length > 0, `${g} 档是空的`)
  // 同一个词⛔ 跨档出现（跨档就是自己跟自己冲突，永远判不出）
  const seen = new Map()
  for (const [g, ws] of Object.entries(FIT_INFER_WORDS)) {
    for (const w of ws) {
      const k = String(w).toLowerCase()
      assert.ok(!seen.has(k), `款式词「${w}」同时出现在 ${seen.get(k)} 与 ${g} 两档`)
      seen.set(k, g)
    }
  }
  const seenFab = new Map()
  for (const [g, ws] of Object.entries(FABRIC_WEIGHT_WORDS)) {
    for (const w of ws) {
      const k = String(w).toLowerCase()
      assert.ok(!seenFab.has(k), `面料词「${w}」同时出现在 ${seenFab.get(k)} 与 ${g} 两档`)
      seenFab.set(k, g)
    }
  }
  // 🔴 §三·2 的 ⚠️：'挺括／硬挺' 说的是手感不是克重 ⇒ 只当廓形线索，⛔ 不进厚薄档
  assert.ok(FIT_INFER_WORDS.廓形.includes('挺括') && FIT_INFER_WORDS.廓形.includes('硬挺'))
  for (const ws of Object.values(FABRIC_WEIGHT_WORDS)) {
    assert.ok(!ws.includes('挺括') && !ws.includes('硬挺'), '挺括/硬挺 混进厚薄档了')
  }
})

test('§三·3 恰好一档才出档：单档命中带命中词与 basis', () => {
  const a = inferFitType('宽松阔腿裤')
  assert.ok(a)
  assert.strictEqual(a.fit_type, '宽松')
  assert.deepStrictEqual(
    a.words,
    ['宽松', '阔腿'],
    'words 要带**全部**命中词，报告要说清凭什么归的档',
  )
  assert.strictEqual(a.basis, 'inferred_from_text')
  // 'A字' 大小写同一条（库里两种写法都有）
  assert.strictEqual(inferFitType('A字裙').fit_type, '廓形')
  assert.strictEqual(inferFitType('a字裙').fit_type, '廓形')
  assert.strictEqual(inferFitType('直筒西装裤').fit_type, '合身')
  assert.strictEqual(inferFitType('紧身打底衫').fit_type, '修身')
  assert.strictEqual(inferFitType('oversize卫衣').fit_type, '宽松', '英文款式词也要认')
  // 现成版型词那几条：改前就认得的，改后必须认到**同一档**（⛔ 因为词表扩了就改口）
  for (const g of FIT_TYPE_VALUES) {
    assert.strictEqual(inferFitType(`一件${g}的上衣`).fit_type, g, `${g} 这条基本词不许改口`)
  }
})

test('§三·3 第 1、2 条：命中 0 档与 ≥2 档一律 null，⛔ 取第一个命中词、⛔ 多数表决', () => {
  for (const none of ['白色衬衫', '今天不下雨', '', '   ', null, undefined, 0, {}, '[]']) {
    assert.strictEqual(inferFitType(none), null, `无线索的 ${JSON.stringify(none)} 必须回 null`)
  }
  // ≥2 档冲突（库里 `bottom_style` 有几十行走这条，§〇·5：24.2%）
  for (const conf of [
    '合身不过度宽松', // 合身＋宽松
    '修身阔腿', // 修身＋宽松
    '直筒宽松卫裤', // 合身＋宽松
    '紧身外叠加蓬蓬裙', // 修身＋廓形
  ]) {
    assert.strictEqual(inferFitType(conf), null, `冲突的「${conf}」不许归任何一档`)
  }
  // 🔴 判不出时不许退化成"取命中最多的那一档"或"取第一个命中的词"（上面四条就是这一条的取证）
  assert.strictEqual(inferFitType('合身不过度宽松'), null)
})

test('§三·3 第 4 条（§八·7）：这一层只出离散档，⛔ 不回任何 cm／数值', () => {
  // 传进来的是一句"看着像尺寸"的话 ⇒ 既不认档、也不许吐个数
  for (const num of ['胸围 92', '肩宽 39cm', '身高165体重55', '腰围62', '+15cm 松量']) {
    assert.strictEqual(inferFitType(num), null, `「${num}」里没有一个款式词，必须 null`)
    assert.strictEqual(inferFabricWeight(num), null, `「${num}」里没有一个面料词，必须 null`)
  }
  // 出账的形状：只允许 {fit_type, words, basis} 三键，fit_type 必须是那四个串之一
  const keys = new Set(['fit_type', 'words', 'basis'])
  const sample = ['宽松落肩卫衣', '修身针织衫', 'A字伞裙', '直筒牛仔裤', '羊绒大衣', '泡泡袖衬衫']
  for (const t of sample) {
    const g = inferFitType(t)
    if (!g) continue
    assert.deepStrictEqual([...Object.keys(g)].sort(), [...keys].sort(), `${t} 出账键变了`)
    assert.ok(FIT_TYPE_VALUES.includes(g.fit_type), `${t} ⇒ ${g.fit_type} 不在值域`)
    assert.ok(Array.isArray(g.words) && g.words.every((w) => typeof w === 'string'))
  }
  // 全表扫一遍：任何词的命中结果都不许带数字（⛔ 不复辟 10-19 第二阶段废除的"中文猜尺寸"）
  for (const ws of Object.values(FIT_INFER_WORDS)) {
    for (const w of ws) {
      const g = inferFitType(w)
      if (!g) continue
      assert.ok(typeof g.fit_type === 'string' && Number.isNaN(Number(g.fit_type)))
      assert.ok(!('cm' in g) && !('ease' in g) && !('value' in g))
    }
  }
})

test('§三·2 面料厚薄：同档多词算一档，跨档就是判不出', () => {
  const a = inferFabricWeight('羊绒大衣') // 羊绒＋大衣 同属 厚 ⇒ 恰好一档
  assert.ok(a && a.fabric_weight === '厚')
  assert.deepStrictEqual(a.words, ['羊绒', '大衣'])
  assert.strictEqual(inferFabricWeight('真丝衬衫').fabric_weight, '薄')
  assert.strictEqual(inferFabricWeight('针织卫衣').fabric_weight, '中')
  assert.strictEqual(inferFabricWeight('羊毛与真丝混纺'), null, '厚＋薄 ⇒ 判不出，⛔ 取第一个')
  assert.strictEqual(inferFabricWeight('挺括外套'), null, '挺括是手感，⛔ 当厚薄档')
  for (const none of ['白色衬衫', '', null, undefined, '胸围 92']) {
    assert.strictEqual(inferFabricWeight(none), null)
  }
})

test('§三 推断是纯函数：同入参两次一字不差，⛔ 不读库不读时间', () => {
  const t = '宽松落肩卫衣'
  assert.deepStrictEqual(inferFitType(t), inferFitType(t))
  assert.deepStrictEqual(inferFabricWeight(t), inferFabricWeight(t))
  // 传入不许被改动（调用方复用同一个字符串常量时不能出现副作用）
  const obj = { text: t }
  inferFitType(obj.text)
  assert.deepStrictEqual(obj, { text: t })
})
