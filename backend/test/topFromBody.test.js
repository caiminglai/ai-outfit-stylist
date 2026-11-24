/**
 * 上衣处方模块的离线工装（node --test，不碰 DB、不碰 HTTP）
 * ============================================================
 * 这个模块的立项口径是"只按这个人的身材与肤色说上衣该选成什么样"，所以断言的重点
 * 不是文案好不好看，而是三件事：① 缺测的维度不许出现（也不能编一条"不推拉"糊过去）；
 * ② 颜色那一段只吃肤色，不吃衣橱、不吃脸型标签；③ 每条都带档位，禁止写成"科学结论"。
 */

const { test } = require('node:test')
const assert = require('node:assert')
const { topSpec, SPEC, NEUTRAL_BAND } = require('../services/topFromBody')
// 锚点表本身也引进来：下面这几条断言要证的是「L 与彩度取自锚点、只有角度被照片顶掉」，
// 那就得跟同一张表比，而不是把表里的数抄成字面量——10-24 换成 CIE 华裔实测锚点时，
// 抄死的 57／46 与 hypot(10,19)／hypot(8,24) 四条全变红，就是这个抄法的代价。
const { skinToneToLab } = require('../services/colorMetrics')

/** 甲：肩偏窄、腰线平、腿身比在带内、BMI 26（条纹闸门关） */
const JIA = {
  height: 158,
  weight: 65,
  bust: 92,
  waist: 84,
  hip: 98,
  shoulder: 35,
  leg_length: 86,
  skin_tone: '白皙',
}
/** 乙：偏瘦、肩够宽、腰线明显、腿长 */
const YI = {
  height: 175,
  weight: 52,
  bust: 86,
  waist: 70,
  hip: 88,
  shoulder: 42,
  leg_length: 102,
  skin_tone: '小麦色',
}

const rowOf = (s, key) => s.axes.find((a) => a.key === key)
const missOf = (s, key) => s.missing.find((m) => m.key === key)

// ============================================================
// 1. 缺测不出处方（缺测不出分这条规则的处方版）
// ============================================================

test('topSpec: 一个数都没量也没肤色 ⇒ 返回 null，不出空表', () => {
  assert.strictEqual(topSpec({}), null)
  assert.strictEqual(topSpec({ gender: '女', scenario: '通勤' }), null)
  assert.strictEqual(topSpec(null), null)
})

test('topSpec: 只有肤色 ⇒ 只出颜色段，身材段一条不编', () => {
  const s = topSpec({ skin_tone: '白皙' })
  assert.ok(s, '肤色单独也能出一段')
  assert.strictEqual(s.axes.length, 0, `身材段该是空的，实际 ${s.axes.map((a) => a.key)} `)
  assert.strictEqual(s.missing.length, 6, '六轴都要写明为什么没出')
  assert.ok(s.colour.present)
  s.missing.forEach((m) => assert.ok(m.reason && m.reason.length > 3, `${m.key} 缺原因`))
})

test('topSpec: 只填身高体重 ⇒ 出松量与体量两轴，其余进 missing 且写明缺哪个数', () => {
  const s = topSpec({ height: 170, weight: 60 })
  assert.ok(rowOf(s, 'ease'), 'BMI 算得出 ⇒ 松量窗口该出')
  assert.ok(rowOf(s, 'volume') || missOf(s, 'volume'))
  assert.ok(missOf(s, 'shoulder').reason.includes('没量'))
  assert.ok(missOf(s, 'waist').reason.includes('腰沟'))
})

test('topSpec: 量了但落在参考带内 ⇒ 出"不推拉"行，绝不当成没算', () => {
  // 腿身比 0.53 在 0.52~0.56 带内 ⇒ want.length 是 null，但这一维确实算过
  const s = topSpec(JIA)
  const len = rowOf(s, 'length')
  assert.ok(len, '在带内也要出一行，否则顾客以为我们没看腿身比')
  assert.strictEqual(len.side, 0)
  assert.match(len.label, /不推拉/)
  assert.ok(len.based_on.includes('腿身比'), 'based_on 要指回实测数')
  assert.strictEqual(missOf(s, 'length'), undefined)
})

// ============================================================
// 1.5 三层顺序：合身是第 0 层，且与修形/颜色互不污染（docs/依据/09 §0、§5）
// ============================================================

test('topSpec: fit 是第 0 段，排在 axes 前，colour 在最后', () => {
  const s = topSpec(JIA)
  const keys = Object.keys(s)
  assert.ok(keys.includes('fit'), '合身段必须挂在处方上')
  assert.ok(
    keys.indexOf('fit') < keys.indexOf('axes') && keys.indexOf('axes') < keys.indexOf('colour'),
    `顺序该是 fit→axes→colour，实际 ${keys.join(',')}`,
  )
  assert.deepStrictEqual(s.layer_order, ['fit', 'axes', 'colour'])
})

test('topSpec: 三层各说各的，不许出现合并后的总分字段', () => {
  const s = topSpec(JIA)
  for (const banned of ['score', 'total_score', 'fit_score', 'final_score']) {
    assert.ok(!(banned in s), `合身与修形是两套结论，平均成一个 ${banned} 就是造假`)
  }
  assert.match(s.note, /可以相反/)
})

test('topSpec: 缺身高或胸围 ⇒ fit 只出 blocking 与测量指引，修形层照出', () => {
  const s = topSpec({ ...JIA, bust: undefined })
  assert.strictEqual(s.fit.present, false)
  assert.ok(Array.isArray(s.fit.blocking) && s.fit.blocking.length >= 1)
  assert.match(JSON.stringify(s.fit.blocking), /净胸围/)
  assert.ok(s.fit.measure_guide.length >= 4, '缺测必须把怎么量交回给用户')
  assert.ok(!(s.fit.size_label || s.fit.checks), 'present:false 时一个目标值都不许出')
  assert.ok(s.axes.length > 0, '合身判不了不等于修形层也没话可说，两段各自独立')
})

test('topSpec: 换肤色只动颜色段，号型与四道判据逐字节不变', () => {
  const pale = topSpec({ ...JIA, skin_tone: '白皙' })
  const deep = topSpec({ ...JIA, skin_tone: '古铜色' })
  assert.strictEqual(JSON.stringify(pale.fit), JSON.stringify(deep.fit))
})

test('topSpec: 塞衣橱/购物字段、换离散标签 ⇒ 合身段一字不变', () => {
  const base = topSpec(JIA).fit
  const dirty = topSpec({
    ...JIA,
    wardrobe_items: [{ name: '真丝衬衫', category: '衬衫', size: 'M' }],
    shopping_list: ['买 170/88A'],
    body_type: '梨形',
    kibbe_type: '自然型',
    color_season: '冬型',
  }).fit
  assert.strictEqual(JSON.stringify(base), JSON.stringify(dirty), '号型只吃身体实测数')
})

test('topSpec: 合身段证据串报出四件国标（分档值已逐字核对），措辞仍不许升级成国标算出的体型', () => {
  const f = topSpec(JIA).fit
  assert.match(f.evidence, /GB\/T 1335/)
  assert.match(f.evidence, /官方原文·文本层逐字/)
  assert.match(f.evidence, /GB\/T 31901-2024/)
  assert.ok(!/需购文本复核/.test(f.evidence), '原文已在本机逐字核对，这句过期限定不得再出现')
  assert.match(f.note, /好不好看/)
  assert.ok(
    !JSON.stringify(f.checks).includes('不合格'),
    '没有成衣实测通道，就不许判"你这件不合格"',
  )
})

// ============================================================
// 2. 只吃身体与肤色：不读衣橱、不吃离散标签
// ============================================================

test('topSpec: 输入里塞衣橱与购物字段 ⇒ 输出里一个都不出现', () => {
  const dirty = {
    ...JIA,
    wardrobe_items: [{ name: '真丝衬衫', category: '衬衫', color: '藏蓝' }],
    shopping_list: ['买一件垫肩西装'],
    gaps: ['外套'],
  }
  const s = topSpec(dirty)
  const json = JSON.stringify(s)
  assert.ok(!json.includes('真丝衬衫'), '处方不许引用衣橱里具体某件')
  assert.ok(!json.includes('shopping'), '处方不许给购物建议')
  assert.ok(!json.includes('gaps'), '处方不许做缺口分析')
})

test('topSpec: 体型/Kibbe/四季型这些标签换成别的值 ⇒ 处方逐字不变', () => {
  const base = topSpec(JIA)
  const withLabels = topSpec({
    ...JIA,
    body_type: '梨形',
    kibbe_type: '自然型',
    frame_size: '大气',
    line_quality: '偏直线',
    color_season: '冬型',
    color_season_12: '深冬型',
  })
  assert.strictEqual(
    JSON.stringify(base),
    JSON.stringify(withLabels),
    '分类标签只许展示，不许进规格',
  )
})

test('topSpec: 同一身材换肤色 ⇒ 只有颜色段变，身材六轴一字不动', () => {
  const pale = topSpec({ ...JIA, skin_tone: '白皙' })
  const deep = topSpec({ ...JIA, skin_tone: '古铜色' })
  assert.strictEqual(JSON.stringify(pale.axes), JSON.stringify(deep.axes))
  assert.notStrictEqual(
    JSON.stringify(pale.colour.prefer),
    JSON.stringify(deep.colour.prefer),
    '肤色该影响颜色候选，否则这一维等于没接上',
  )
})

test('topSpec: 两个人身材不同 ⇒ 至少一根轴方向相反', () => {
  const a = topSpec(JIA)
  const b = topSpec(YI)
  const shared = a.axes.filter((r) => b.axes.some((x) => x.key === r.key))
  const flipped = shared.filter((r) => {
    const other = rowOf(b, r.key)
    return r.side !== 0 && other.side !== 0 && Math.sign(r.side) !== Math.sign(other.side)
  })
  assert.ok(
    flipped.length >= 1,
    `没有任何一轴随人变方向：${shared.map((r) => r.key + '/' + r.side)}`,
  )
})

// ============================================================
// 3. 诚实口径：档位、闸门、不夸成判定
// ============================================================

test('topSpec: 每条轴与颜色段都带档位，顶层 note 承认没有标准', () => {
  const s = topSpec(JIA)
  s.axes.forEach((a) => assert.ok(a.tier && /B|C/.test(a.tier), `${a.key} 缺档位串`))
  assert.ok(
    s.colour.tier.includes('A') && s.colour.tier.includes('C'),
    '颜色段要同时标出公式档与手拍权重',
  )
  assert.match(s.note, /没有任何标准/)
  assert.match(s.evidence, /手拍/)
  assert.ok(Object.keys(s.axis_tiers).length >= 1)
})

test('topSpec: BMI≥25 时条纹轴写"这条我们不用"，不许写成"不推拉"', () => {
  const s = topSpec(JIA) // BMI 26
  const m = missOf(s, 'pattern')
  assert.ok(m, '闸门关 ⇒ 这一轴该进 missing')
  assert.match(m.reason, /这条我们不用/)
  assert.ok(!m.reason.includes('不推拉'), '把"不敢用"说成"不用改"就是骗人')
  assert.strictEqual(rowOf(s, 'pattern'), undefined)
})

test('topSpec: 条纹轴只在偏瘦的人身上出现，并带"文献结论互相冲突"的限定', () => {
  const s = topSpec(YI) // BMI 17，闸门开
  const p = rowOf(s, 'pattern')
  assert.ok(p, '偏瘦 ⇒ 条纹这一维可用（低权重修正）')
  assert.match(p.tier, /互相冲突|结论不一致/)
  assert.strictEqual(p.gated, 'BMI<25 才用这一条；文献本身结论不一致')
  if (p.side !== 0) assert.ok(p.prefer.join(' ').includes('竖'))
})

test('topSpec: 松量那一轴给区间，净胸围在场才换算成衣尺寸', () => {
  const withBust = rowOf(topSpec(JIA), 'ease')
  assert.match(withBust.label, /松量落在 \d+(\.\d+)?~\d+(\.\d+)? cm/)
  assert.ok(
    withBust.prefer.some((t) => t.includes('成衣胸围≈') && t.includes('cm')),
    '给了净胸围就该换算',
  )
  const noBust = rowOf(topSpec({ height: 158, weight: 65 }), 'ease')
  assert.ok(
    noBust.prefer.some((t) => t.includes('不给成衣尺寸')),
    '没量胸围就只给区间，不编成衣尺寸',
  )
})

test('topSpec: 中性阈值两侧都算"不推拉"，且不给出方向性文案', () => {
  assert.ok(NEUTRAL_BAND > 0 && NEUTRAL_BAND < 0.5)
  const near = { ...JIA, bust: 91, waist: 84, hip: 90 } // 腰沟落在中位附近
  const s = topSpec(near)
  const w = rowOf(s, 'waist')
  if (w && w.side === 0) {
    assert.deepStrictEqual(w.prefer, [])
    assert.deepStrictEqual(w.avoid, [])
    assert.match(w.label, /不推拉/)
  }
})

test('SPEC: 六轴每轴两侧都有词表，且 avoid 与 prefer 不重叠', () => {
  const keys = ['shoulder', 'waist', 'ease', 'length', 'volume', 'pattern']
  keys.forEach((k) => assert.ok(SPEC[k], `缺 ${k} 的规格表`))
  ;['shoulder', 'waist', 'length', 'volume', 'pattern'].forEach((k) => {
    assert.ok(SPEC[k].plus && SPEC[k].minus, `${k} 两侧不齐`)
    const overlap = SPEC[k].plus.prefer.filter((w) => SPEC[k].minus.avoid.includes(w))
    assert.deepStrictEqual(overlap, [], `${k} 的"要选"与"要避"打架：${overlap}`)
    assert.ok(SPEC[k].neutral, `${k} 缺不推拉说法`)
  })
})

test('topSpec: 每一根出了说法的轴都带上"算它用的实测数"', () => {
  for (const p of [JIA, YI]) {
    const s = topSpec(p)
    s.axes
      .filter((a) => a.key !== 'ease')
      .forEach((a) => {
        assert.ok(a.based_on && a.based_on.length > 0, `${a.key} 这一行没写它靠哪个实测数推出来的`)
        assert.match(a.based_on, /\d/, `${a.key} 的 based_on 里没有数：${a.based_on}`)
      })
  }
})

test('topSpec: 肩那一行的实测数带上肩宽÷腰围，并写明它不是论文那个肩围÷臀围', () => {
  const s = topSpec(JIA)
  const row = rowOf(s, 'shoulder')
  assert.ok(row, '甲量了肩宽与腰围 ⇒ 肩轴该出')
  assert.match(row.based_on, /肩宽÷腰围 = 0\.42/, row.based_on)
  assert.match(row.based_on, /不是论文那个肩围÷臀围/, row.based_on)
  // 没量腰围 ⇒ 这条比值整个不出现（缺测不编）
  const noWaist = topSpec({ ...JIA, waist: null })
  const row2 = rowOf(noWaist, 'shoulder')
  if (row2) assert.doesNotMatch(row2.based_on, /肩宽÷腰围/, row2.based_on)
})

test('topSpec: 肤色两个口径都在 ⇒ 颜色分取更低那个，并标出短板口径', () => {
  const both = topSpec({ ...JIA, skin_tone: '冷皮', skin_tone_detail: '白皙' })
  const deepOnly = topSpec({ ...JIA, skin_tone: null, skin_tone_detail: '白皙' })
  assert.strictEqual(both.colour.anchor_count, 2)
  assert.strictEqual(both.colour.scoring, 'min')
  assert.match(both.colour.skin_label, /深浅 白皙/)
  assert.match(both.colour.skin_label, /冷暖 冷皮/)
  assert.match(both.colour.note, /两个口径/)
  // 取低分 ⇒ 榜首不可能比单口径时更高
  assert.ok(
    both.colour.prefer[0].score <= deepOnly.colour.prefer[0].score,
    `双口径 ${both.colour.prefer[0].score} 不该高于单口径 ${deepOnly.colour.prefer[0].score}`,
  )
  both.colour.prefer.forEach((c) =>
    assert.ok(['深浅', '冷暖'].includes(c.limit_field), `${c.name} 没标短板口径`),
  )
})

test('topSpec: 只有一个肤色口径 ⇒ 不谎称两个都算', () => {
  const s = topSpec({ height: 158, weight: 65, skin_tone: '冷皮' })
  assert.strictEqual(s.colour.anchor_count, 1)
  assert.strictEqual(s.colour.scoring, 'single')
  assert.match(s.colour.skin_label, /^冷暖 冷皮$/)
  assert.ok(!s.colour.note.includes('两个口径'))
})

test('topSpec: skin_tone 被回填成深浅值 ⇒ 只算一个口径，不冒充冷暖', () => {
  const s = topSpec({ height: 158, weight: 65, skin_tone: '白皙', skin_tone_detail: '白皙' })
  assert.strictEqual(s.colour.anchor_count, 1)
  assert.match(s.colour.skin_label, /^深浅 白皙$/)
  const t = topSpec({ height: 158, weight: 65, skin_tone: '自然' })
  assert.match(t.colour.skin_label, /^冷暖 自然$/)
})

// ============================================================
// 10-21 第十阶段·第一步补口：这里原来是**第五处**自己拼肤色字符串的取值点
// （改前 `colorSpec` 只调 `skinToneToLab(value)`，完全不看 `skin_hue`），
// 实测现象＝照片角度改了 Top-8 名次却没改顾客看到的那串建议色。
// 下面这组断言钉的就是"建议色必须跟着角度走"这一件事本身。
//
// ⚠️ 中途走错过一次（同轮实测，盘外 `api-diff.cjs`）：第一版写成"照片顶掉 toneText 那一档"，
// 在 自然白／自然 这个人身上六个建议色分逐字没动——取低分时瓶颈全在冷暖那颗，
// 顶错格子等于照片又被瓶颈吃掉。判据：h° 本身就是冷暖轴，深浅轴是 L\*，而本站不吃照片明度。
// ============================================================

const TWO_CALIBER = { ...JIA, skin_tone: '冷皮', skin_tone_detail: '白皙' }
const _C = (lab) => Math.hypot(lab.a, lab.b)
const _H = (lab) => (Math.atan2(lab.b, lab.a) * 180) / Math.PI

test('照片色相角在场 ⇒ 顶掉的是冷暖那一格，深浅锚点与它的 L 一字不动', () => {
  const base = topSpec(TWO_CALIBER)
  const photo = topSpec({ ...TWO_CALIBER, skin_hue: 70 })
  assert.strictEqual(base.colour.photo_hue, null)
  assert.strictEqual(base.colour.photo_lab, null)
  assert.strictEqual(base.colour.photo_undertone, null)
  assert.strictEqual(photo.colour.photo_hue, 70)
  assert.strictEqual(photo.colour.photo_undertone, '暖皮')
  // 冷暖词「冷皮」被实测角度顶掉（同一口径的更细读数），⛔ 不是再叠一个口径
  assert.match(photo.colour.skin_label, /^深浅 白皙／冷暖 照片色相 70°（暖皮）$/)
  assert.strictEqual(photo.colour.anchor_count, 2)
  assert.ok(!photo.colour.skin_label.includes('冷皮'), '冷暖口径没被顶掉＝照片挂错了格子')
  // anchors[0] 是深浅那颗：L/a/b 必须逐字等于没照片时（照片绝不许冒充明度）
  assert.deepStrictEqual(photo.colour.skin_lab, base.colour.skin_lab)
  // 合成那颗：L 与 C 一律取自深浅锚点，只有 h 是传进来的角
  const pl = photo.colour.photo_lab
  assert.strictEqual(pl.L, base.colour.skin_lab.L, '合成颗的明度不是锚点表那个数')
  assert.ok(
    Math.abs(_C(pl) - _C(base.colour.skin_lab)) < 1e-9,
    `合成颗彩度被照片改掉了：${_C(base.colour.skin_lab)} → ${_C(pl)}`,
  )
  assert.ok(Math.abs(_H(pl) - 70) < 1e-9, `合成颗角度不是 70°：${_H(pl).toFixed(3)}`)
  assert.match(photo.colour.tier, /照片色相角/)
  assert.ok(!base.colour.tier.includes('照片色相角'), '没照片却声明吃了照片')
})

test('照片角度确实接管了建议色这一层（本轮要修的洞：改名次不改处方）', () => {
  const base = topSpec(TWO_CALIBER)
  const photo = topSpec({ ...TWO_CALIBER, skin_hue: 70 })
  const score = (s) => JSON.stringify(s.colour.prefer.map((x) => x.score))
  assert.notStrictEqual(score(photo), score(base), '建议色一个分都没变＝处方层没被照片接管')
  // 名次允许不变（两个口径取低分本就保守），但短板口径必须还在白名单里
  photo.colour.prefer.forEach((c) =>
    assert.ok(['深浅', '冷暖'].includes(c.limit_field), `${c.name} 没标短板口径`),
  )
  // 冷皮→70°（暖皮）方向上的角度挪动，短板该开始落在冷暖这一格
  assert.ok(
    photo.colour.prefer.some((c) => c.limit_field === '冷暖'),
    '照片接管冷暖后，六个建议色没有一个短板在冷暖＝角度还是没进分',
  )
})

test('过不了闸的角度 ⇒ 处方层逐字回改前行为，⛔ 不编一个肤色', () => {
  const base = topSpec(TWO_CALIBER)
  for (const v of ['x', {}, null, undefined, NaN, 90, 20, '30', 0]) {
    const s = topSpec({ ...TWO_CALIBER, skin_hue: v })
    assert.strictEqual(s.colour.photo_hue, null, `角度 ${String(v)} 竟然接管了处方`)
    assert.strictEqual(s.colour.photo_lab, null, `角度 ${String(v)} 竟然编出了一颗 Lab`)
    assert.strictEqual(
      s.colour.skin_label,
      base.colour.skin_label,
      `角度 ${String(v)} 改了口径标注`,
    )
    assert.deepStrictEqual(s.colour.skin_lab, base.colour.skin_lab, `角度 ${String(v)} 改了 Lab`)
    assert.deepStrictEqual(
      s.colour.prefer.map((x) => x.score),
      base.colour.prefer.map((x) => x.score),
      `角度 ${String(v)} 改了建议色`,
    )
  }
})

test('只有冷暖词 ⇒ 照片把它顶成连续读数，整段仍只算一个口径', () => {
  const s = topSpec({ ...JIA, skin_tone: '自然', skin_tone_detail: null, skin_hue: 45 })
  assert.strictEqual(s.colour.photo_hue, 45)
  assert.strictEqual(s.colour.anchor_count, 1)
  assert.strictEqual(s.colour.scoring, 'single')
  assert.match(s.colour.skin_label, /^冷暖 照片色相 45°（冷皮）$/)
  // L 与彩度仍取自「自然」那颗锚点（现量：L58.53、a10.27、b16.77 ⇒ C=19.664837），只有角度换成 45
  const AN_NAT = skinToneToLab('自然')
  assert.strictEqual(s.colour.skin_lab.L, AN_NAT.L, 'L 没沿用深浅锚点的值')
  assert.ok(
    Math.abs(_C(s.colour.skin_lab) - Math.hypot(AN_NAT.a, AN_NAT.b)) < 1e-9,
    '彩度被照片改掉了',
  )
  assert.ok(Math.abs(_H(s.colour.skin_lab) - 45) < 1e-9, '角度不是照片给的 45°')
  assert.ok(!s.colour.note.includes('两个口径'))
})

test('只有深浅词 ⇒ 照片补出来的就是缺的那个冷暖口径，不谎称深浅测过', () => {
  const s = topSpec({ ...JIA, skin_tone: null, skin_tone_detail: '小麦色', skin_hue: 70 })
  assert.strictEqual(s.colour.anchor_count, 2)
  assert.strictEqual(s.colour.scoring, 'min')
  assert.match(s.colour.skin_label, /^深浅 小麦色／冷暖 照片色相 70°（暖皮）$/)
  const AN_WHEAT = skinToneToLab('小麦色')
  assert.strictEqual(s.colour.photo_lab.L, AN_WHEAT.L, '深浅锚点的 L 没进合成颗')
  assert.ok(
    Math.abs(_C(s.colour.photo_lab) - Math.hypot(AN_WHEAT.a, AN_WHEAT.b)) < 1e-9,
    '合成颗彩度没守住锚点彩度',
  )
  const noPhoto = topSpec({ ...JIA, skin_tone: null, skin_tone_detail: '小麦色' })
  assert.strictEqual(noPhoto.colour.anchor_count, 1, '没照片时竟然凭空多了个冷暖口径')
})
