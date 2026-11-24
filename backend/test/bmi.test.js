/**
 * BMI 单一口径（services/bmi.js）
 * ============================================================
 * 10-12 第二十七轮：算式原先在 profileEnricher / topFitBody / fitSize 各写一遍，
 * "量不到"怎么表示、什么时候取整都漂了。这份测试锁三件事：
 *  1) 量不到 ⇒ null，绝不回一个假想值（历史上是 22.0/'正常'）；
 *  2) 站内四档与国标三档各自的边界归上档；
 *  3) 两套档位是两条口径，谁也不许替换谁。
 *
 * 运行: node --test test/bmi.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const { bmiValue, healthBand, gbBand } = require('../services/bmi')
const { computeBmi } = require('../services/profileEnricher')

test('bmiValue：身高或体重缺测/非法 ⇒ null（不许有假想值）', () => {
  for (const args of [
    [0, 62],
    [-165, 62],
    [165, 0],
    [165, null],
    [null, null],
    ['abc', 62],
    ['', ''],
    [Infinity, 62],
  ]) {
    assert.strictEqual(bmiValue(...args), null, `bmiValue(${args.join(',')}) 应为 null`)
  }
  // 62 / 1.65² ≈ 22.77 ⇒ 注意这不是"缺测兜底"，是真的算出来了
  assert.ok(Math.abs(bmiValue(165, 62) - 22.77) < 0.01)
})

test('healthBand：18.5／24／28 三条边界都归上一档', () => {
  assert.strictEqual(healthBand(18.4).bmi_level, '偏瘦')
  assert.strictEqual(healthBand(18.5).bmi_level, '正常')
  assert.strictEqual(healthBand(23.9).bmi_level, '正常')
  assert.strictEqual(healthBand(24).bmi_level, '偏胖')
  assert.strictEqual(healthBand(27.9).bmi_level, '偏胖')
  assert.strictEqual(healthBand(28).bmi_level, '肥胖')
  assert.strictEqual(healthBand(40).bmi_status, 'danger')
  assert.strictEqual(healthBand(null), null)
  assert.strictEqual(healthBand(0), null)
})

test('gbBand：GB/T 31901-2024 表 A.2 只有三档，≥24 就叫偏胖（不叫肥胖）', () => {
  assert.strictEqual(gbBand(25).cn, '偏胖')
  assert.strictEqual(gbBand(40).cn, '偏胖')
  assert.deepStrictEqual(gbBand(22.8).band, [18.5, 24])
  assert.strictEqual(gbBand(14.7).cn, '偏瘦')
  // 上界 Infinity 转成 null，文案里不能出现 "Infinity"
  assert.strictEqual(gbBand(30).band[1], null)
  assert.strictEqual(gbBand(null), null)
})

test('两套档位并存：同一个 BMI 在站内是肥胖、在国标口径里是偏胖', () => {
  const b = bmiValue(165, 50) // ≈18.4
  assert.strictEqual(healthBand(b).bmi_level, '偏瘦')
  assert.strictEqual(gbBand(b).cn, '偏瘦')
  const c = bmiValue(165, 76) // ≈27.9
  assert.strictEqual(healthBand(c).bmi_level, '偏胖')
  assert.strictEqual(gbBand(c).cn, '偏胖')
})

test('computeBmi 就是 bmiValue + healthBand，取整只在出数这一层', () => {
  const r = computeBmi(170, 65) // 22.49…
  assert.strictEqual(r.bmi, 22.5)
  assert.strictEqual(r.bmi_level, '正常')
  assert.deepStrictEqual(computeBmi(0, 65), {})
})
