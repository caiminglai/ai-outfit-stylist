/**
 * 合身层（第 0 层）测试
 * ============================================================
 * 口径来源：docs/依据/09-合身层输入输出规范.md。
 * 这一层最要命的两件事：① 缺测必须挡在门口（不给任何目标值）；
 * ② 号型分档没落进整档就不许偷偷并进邻档（那是替人编体型）。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { fitLayer, bodyTypeOf, nearestStep, DROP_BANDS, SIZE_STEPS } = require('../services/fitSize')
const { bodyDeviation } = require('../services/topFitBody')

const 甲 = { height: 165, bust: 88, waist: 72, shoulder: 39, weight: 62, gender: '女' }
const check = (f, key) => f.checks.find((c) => c.key === key)

// ============================================================
// 1. 号型推导
// ============================================================

test('号按 5cm、型按 4cm 就近取档', () => {
  assert.strictEqual(nearestStep(166, SIZE_STEPS.height, SIZE_STEPS.height_range).value, 165)
  assert.strictEqual(nearestStep(167, SIZE_STEPS.height, SIZE_STEPS.height_range).value, 165)
  assert.strictEqual(nearestStep(168, SIZE_STEPS.height, SIZE_STEPS.height_range).value, 170)
  assert.strictEqual(nearestStep(87.5, SIZE_STEPS.chest, SIZE_STEPS.chest_range).value, 88)
  assert.strictEqual(nearestStep(85, SIZE_STEPS.chest, SIZE_STEPS.chest_range).value, 84)
})

test('fitLayer：女 165/88A（胸腰差 16 落在女 A 档 14~18）', () => {
  const f = fitLayer(甲)
  assert.ok(f.present)
  assert.strictEqual(f.size_label, '165/88A')
  assert.strictEqual(f.size.体型中文, '正常体')
  assert.deepStrictEqual(f.size.体型档, [14, 18])
  assert.strictEqual(f.drop_cm, 16)
  assert.strictEqual(f.size_scope, 'standard')
})

test('体型边界包含在内，跨到 Y 档就换码', () => {
  assert.strictEqual(bodyTypeOf(18, '女').code, 'A')
  assert.strictEqual(bodyTypeOf(19, '女').code, 'Y')
  assert.strictEqual(bodyTypeOf(24, '女').code, 'Y')
  assert.strictEqual(bodyTypeOf(17, '男').code, 'Y')
  assert.strictEqual(bodyTypeOf(16, '男').code, 'A')
  assert.strictEqual(bodyTypeOf(12, '男').code, 'A')
  assert.strictEqual(bodyTypeOf(11, '男').code, 'B')
})

test('落差是小数又恰好落在两档之间 ⇒ 判空隙，不四舍五入进档（09 §2 诚实规则 2）', () => {
  // 分档表的边界是整数（16 与 17 之间没有档位），16.4 落在这里 ⇒ 宁可不出字母
  const g = bodyTypeOf(16.4, '男')
  assert.strictEqual(g.code, undefined)
  assert.match(g.reason, /落在两档之间的空隙/)
  assert.ok(!('band' in g), '空隙里不许造一个档位区间出来')
})

test('胸腰差落在两档空隙 ⇒ 不四舍五入进档，体型位不出，号型不带字母', () => {
  const f = fitLayer({ ...甲, waist: 72.5 }) // 落差 15.5 ⇒ 女档 14~18 之内？换男验证
  assert.strictEqual(f.size_label, '165/88A')
  const g = fitLayer({ ...甲, gender: '男', bust: 92, waist: 75.5 }) // 落差 16.5 ⇒ A(12~16) 与 Y(17~22) 之间
  assert.strictEqual(g.size.体型, null)
  assert.match(g.drop_reason, /落在两档之间的空隙/)
  assert.strictEqual(g.size_label, '165/92', `号型不该带体型字母：${g.size_label}`)
})

test('腰围接近或超过胸围 ⇒ 不许塞进 C 档，要写明低于下界', () => {
  const f = fitLayer({ ...甲, bust: 88, waist: 86, gender: '女' }) // 落差 2 < 女 C 下界 4
  assert.strictEqual(f.size.体型, null)
  assert.match(f.drop_reason, /低于 C 档下界/)
  assert.ok(!/^[ABYC]$/.test(f.size.体型 || ''), '不许给字母')
})

test('性别没填 ⇒ 切点分男女，体型位不猜', () => {
  const f = fitLayer({ ...甲, gender: undefined })
  assert.strictEqual(f.size.体型, null)
  assert.match(f.drop_reason, /性别没填/)
})

test('号或型超出常用档系 ⇒ 仍给就近档但必须标 near', () => {
  const f = fitLayer({ ...甲, height: 142 })
  assert.strictEqual(f.size_scope, 'near')
  assert.match(f.size_scope_note, /就近换算，不是标准档/)
})

// ============================================================
// 2. 缺测挡在门口（这一层的硬规则）
// ============================================================

test('缺身高或缺净胸围 ⇒ present:false，且一个目标值都不给', () => {
  for (const p of [{ ...甲, height: 0 }, { ...甲, bust: undefined }, {}]) {
    const f = fitLayer(p)
    assert.strictEqual(f.present, false)
    assert.ok(f.blocking.length >= 1, '要点名缺的是哪个数')
    assert.ok(f.measure_guide.length >= 4, '必须附怎么量')
    assert.ok(!('size_label' in f), '挡住时不许出现号型')
    assert.ok(!('checks' in f), '挡住时不许出现判据')
    assert.match(f.note, /都是猜的/)
  }
})

test('缺体重 ⇒ 胸围那道判不了并点名要体重', () => {
  const f = fitLayer({ ...甲, weight: 0 })
  const c = check(f, 'bust_ease')
  assert.strictEqual(c.verdict, '判不了')
  assert.strictEqual(c.target, null)
  assert.strictEqual(f.target_finished_bust, null, '没有窗口就不编成衣胸围')
  assert.match(c.missing_input, /体重/)
})

test('缺肩宽 ⇒ 肩缝那道判不了，其余三道照出', () => {
  const f = fitLayer({ ...甲, shoulder: null })
  const c = check(f, 'shoulder_seam')
  assert.strictEqual(c.verdict, '判不了')
  assert.match(c.missing_input, /肩宽/)
  assert.strictEqual(check(f, 'bust_ease').verdict, '可给目标值')
})

// ============================================================
// 3. 四道判据与口径单点
// ============================================================

test('四道判据齐全，袖长与衣长两道永远标注缺哪个字段', () => {
  const f = fitLayer(甲)
  assert.deepStrictEqual(
    f.checks.map((c) => c.key),
    ['bust_ease', 'shoulder_seam', 'body_length', 'sleeve'],
  )
  for (const key of ['body_length', 'sleeve']) {
    const c = check(f, key)
    assert.strictEqual(c.verdict, '判不了')
    assert.strictEqual(c.target, null)
    assert.ok(c.missing_input, `${key} 要写明缺什么字段`)
  }
})

test('松量口径全局只有一处：与 bodyDeviation 的 ease_window 同一个数', () => {
  const f = fitLayer(甲)
  const d = bodyDeviation(甲)
  assert.deepStrictEqual(f.ease_window_cm, d.ease_window)
  assert.deepStrictEqual(f.target_finished_bust, [88 + d.ease_window[0], 88 + d.ease_window[1]])
})

test('肩缝判据：正肩区间=净肩宽±1.5，落肩另给下限，并标 C 档手拍', () => {
  const c = check(fitLayer(甲), 'shoulder_seam')
  assert.deepStrictEqual(c.target.正肩_cm, [37.5, 40.5])
  assert.strictEqual(c.target.落肩款式至少_cm, 42)
  assert.match(c.tier, /C 档手拍/)
  assert.match(c.why, /不是标准/)
})

// ============================================================
// 4. 依据诚实：档位、二手数值、不含美观判据
// ============================================================

test('evidence 串必须带"二手·需购文本复核"，note 必须说号型不含美观判据', () => {
  const f = fitLayer(甲)
  assert.match(f.evidence, /二手·需购文本复核/)
  assert.match(f.evidence, /GB\/T 1335/)
  assert.match(f.evidence, /GB\/T 16160/)
  assert.match(f.note, /不含任何"好不好看"的判据/)
  assert.match(f.note, /由你决定/)
})

test('测量指引只声称"怎么量"，不声称量到多少算好看', () => {
  const f = fitLayer(甲)
  const joined = f.measure_guide.join(' ')
  assert.match(joined, /呼气末/)
  assert.match(joined, /两人配合/)
  assert.ok(!/好看|显瘦|适合/.test(joined), '测量指引里不许混进美观判据')
})

// ============================================================
// 5. 输入隔离：衣橱与离散标签都进不了这一层
// ============================================================

test('塞进衣橱与购物字段 ⇒ 合身段逐字节不变', () => {
  const clean = fitLayer(甲)
  const dirty = fitLayer({
    ...甲,
    wardrobe_items: [{ name: '宽松卫衣', category: '上衣' }],
    wishlist: [{ name: '垫肩西装' }],
    wardrobe_gaps: { 穿搭: ['缺正肩外套'] },
  })
  assert.strictEqual(JSON.stringify(clean), JSON.stringify(dirty))
})

test('体型/Kibbe/四季型这些标签换成别的值 ⇒ 号型一字不变（离散标签不进公式）', () => {
  const base = fitLayer(甲)
  const swapped = fitLayer({
    ...甲,
    body_type: '苹果型',
    kibbe_type: 'Natural',
    color_season: '深秋',
    frame_size: '大气',
  })
  assert.strictEqual(base.size_label, swapped.size_label)
  assert.strictEqual(JSON.stringify(base), JSON.stringify(swapped))
})

test('DROP_BANDS：男女各四档，区间连续无重叠、Y 上界到 C 下界递减', () => {
  for (const g of ['男', '女']) {
    const bands = DROP_BANDS[g]
    assert.strictEqual(bands.length, 4)
    bands.forEach((b, i) => {
      assert.ok(b.lo <= b.hi, `${g} ${b.code} 区间反了`)
      if (i > 0) assert.ok(b.hi < bands[i - 1].lo, `${g} ${b.code} 与上一档重叠`)
    })
  }
})
