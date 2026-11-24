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
  assert.strictEqual(f.size.体型中文, '收腰适中')
  assert.deepStrictEqual(f.size.体型档, [14, 18])
  assert.strictEqual(f.drop_cm, 16)
  assert.strictEqual(f.size_scope, 'standard')
  assert.match(f.size_scope_ref, /1335\.2-2008/)
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
// 2b. 常用档系按性别分表（10-10 定案，10 §4 第 2 条）
// ============================================================

test('女体胸围 68~71：在原文 B/C 系列表内 ⇒ 不再误报 near', () => {
  const f = fitLayer({ height: 160, bust: 69, waist: 60, weight: 50, gender: '女' }) // 差 9 ⇒ B 档，女 B 型列表列 68~108
  assert.strictEqual(f.size.体型, 'B')
  assert.strictEqual(f.size.型, 68)
  assert.strictEqual(f.size_scope, 'standard', `女 B 档 68 该在表列内：${f.size_scope_note}`)
})

test('女体 Y 档上界收到 100：胸围 104 出界 ⇒ near', () => {
  const f = fitLayer({ ...甲, bust: 104, waist: 80, gender: '女' }) // 差 24 ⇒ Y，女 Y 列表列 72~100
  assert.strictEqual(f.size.体型, 'Y')
  assert.strictEqual(f.size_scope, 'near')
  assert.match(f.size_scope_note, /型 72~100/)
})

test('男体"号"从 155 起：身高 150 出界 ⇒ near（旧口径 145 是女册的值）', () => {
  const f = fitLayer({ height: 150, bust: 92, waist: 78, weight: 45, gender: '男' }) // 差 14 ⇒ A
  assert.strictEqual(f.size.体型, 'A')
  assert.strictEqual(f.size_scope, 'near')
  assert.match(f.size_scope_ref, /1335\.1-2008/)
  assert.match(f.size_scope_note, /号 155~190/)
})

test('男体上界收到 116：胸围 118 就近到 120 ⇒ near（旧口径 120 比国标宽 4cm）', () => {
  const f = fitLayer({ height: 170, bust: 118, waist: 110, weight: 80, gender: '男' }) // 差 8 ⇒ B，男 B 列表列 72~116
  assert.strictEqual(f.size.体型, 'B')
  assert.strictEqual(f.size.型, 120)
  assert.strictEqual(f.size_scope, 'near')
})

test('性别没填 ⇒ 用两册并集兜底，并在 ref 里写明是并集', () => {
  const f = fitLayer({ height: 170, bust: 118, waist: 110, weight: 80 })
  assert.match(f.size_scope_ref, /两册并集/)
  assert.strictEqual(f.size_scope, 'near')
})

// ============================================================
// 2c. 胖瘦程度＝另一条轴（GB/T 31901-2024 附录 A 表 A.2）
// ============================================================

test('BMI 档：偏瘦＜18.5／正常 18.5~24／偏胖≥24，且不推翻体型代号', () => {
  const thin = fitLayer({ ...甲, weight: 40 }) // 40/1.65² ≈ 14.7
  const normal = fitLayer(甲) // 62/1.65² ≈ 22.8
  const heavy = fitLayer({ ...甲, weight: 70 }) // ≈ 25.7
  assert.strictEqual(thin.bmi_band.cn, '偏瘦')
  assert.strictEqual(normal.bmi_band.cn, '正常')
  assert.strictEqual(heavy.bmi_band.cn, '偏胖')
  assert.strictEqual(normal.bmi, 22.8)
  assert.deepStrictEqual(normal.bmi_band.band, [18.5, 24])
  // 两个轴并存：BMI 换了，胸腰差定出来的 Y/A/B/C 一个字不变
  assert.strictEqual(thin.size.体型, heavy.size.体型)
  assert.strictEqual(thin.size_label, heavy.size_label)
})

test('缺体重 ⇒ bmi 与 bmi_band 都不出，不兜底', () => {
  const f = fitLayer({ ...甲, weight: 0 })
  assert.strictEqual(f.bmi, null)
  assert.strictEqual(f.bmi_band, null)
})

test('BMI 档的对外诚实：必须写明 2026-12-01 实施、现为内部口径', () => {
  const f = fitLayer(甲)
  assert.match(f.bmi_band_note, /2026-12-01/)
  assert.match(f.bmi_band_note, /内部口径/)
  assert.match(f.bmi_band_note, /表 A\.2/)
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
  // 10-19 第二阶段：衣柜表已经有成衣四格了 ⇒ 话术不许再写"衣柜表没有成品尺寸列"，
  // 要写明缺的是**人体侧**的腰节长/袖长（这句是给用户看的，写错等于骗用户没格子）
  const joined = f.checks.map((c) => c.why).join(' ')
  assert.ok(!joined.includes('也没有成品尺寸列'), `袖长话术过期：${joined}`)
  assert.match(check(f, 'body_length').why, /人体侧没有这个字段/)
  assert.ok(
    f.measure_guide.some((g) => g.includes('衣服胸围')),
    '成衣四格的平铺量法必须随 measure_guide 一起交回用户',
  )
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

test('evidence 串：号型分档已升【官方原文·文本层逐字】，并点到 16160／5703／31901 三件', () => {
  const f = fitLayer(甲)
  assert.match(f.evidence, /GB\/T 1335/)
  assert.match(f.evidence, /官方原文·文本层逐字/)
  assert.match(f.evidence, /GB\/T 16160/)
  assert.match(f.evidence, /GB\/T 5703-2023 §6\.2\.7/)
  assert.match(f.evidence, /GB\/T 31901-2024/)
  assert.ok(
    !/需购文本复核/.test(f.evidence),
    '本机已有原文逐字核对，这句过期限定不得再出现在合身层 evidence 里',
  )
  assert.match(f.note, /不含任何"好不好看"的判据/)
  assert.match(f.note, /由你决定/)
})

test('缺身高/胸围被挡住时，evidence 也不得再挂"需购文本复核"', () => {
  const f = fitLayer({})
  assert.strictEqual(f.present, false)
  assert.ok(!/需购文本复核/.test(f.evidence), f.evidence)
})

test('测量指引：腰围走 16160 的腰际线、肩宽走 5703 的肩峰点直线，且不再说"腰最细处"', () => {
  const f = fitLayer(甲)
  const joined = f.measure_guide.join(' ')
  assert.match(joined, /腰际线/)
  assert.match(joined, /§2\.2\.10/)
  assert.match(joined, /肩峰点/)
  assert.match(joined, /§6\.2\.7/)
  assert.match(joined, /圆杆直角规/)
  assert.ok(!/最细处/.test(joined), '旧话术"腰部最细处"必须消失（与两份国标位置不一致）')
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

test('体型中文不许出现"胖/瘦"——1335 两册全文没有这两个字，代号才是国标的东西', () => {
  for (const g of ['男', '女']) {
    for (const b of DROP_BANDS[g]) {
      assert.ok(
        !/[胖瘦]/.test(b.cn),
        `${g} ${b.code} 的中文名 "${b.cn}" 挂的是评判词，不是国标用词`,
      )
      assert.match(b.cn, /收腰|直筒/, `${g} ${b.code} 的中文名要描述胸腰差，别描述身材好坏`)
    }
  }
})

test('常用档系表列与原文一致（防手改）：女 145~180／68~112，男 155~190／72~116', () => {
  assert.deepStrictEqual(SIZE_STEPS.scope['女'].height, [145, 180])
  assert.deepStrictEqual(SIZE_STEPS.scope['女'].chest.all, [68, 112])
  assert.deepStrictEqual(SIZE_STEPS.scope['女'].chest.Y, [72, 100])
  assert.deepStrictEqual(SIZE_STEPS.scope['女'].chest.B, [68, 108])
  assert.deepStrictEqual(SIZE_STEPS.scope['男'].height, [155, 190])
  assert.deepStrictEqual(SIZE_STEPS.scope['男'].chest.all, [72, 116])
  assert.deepStrictEqual(SIZE_STEPS.scope['男'].chest.Y, [76, 104])
  assert.deepStrictEqual(SIZE_STEPS.scope['男'].chest.C, [76, 116])
})
