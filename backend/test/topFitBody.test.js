/**
 * 上衣 × 身体 适配分测试（topFitBody，不看脸那一半）
 *
 * 这个模块是纯函数，不 require db、不写库，可以脱离数据库重复跑。
 *
 * 2026-10-19 第二阶段「最后一公里」把入参口径换了：上衣那一侧的修形向量现在**只从衣柜行的
 * 四格实测尺寸算**（shoulder_cm／bust_cm／length_cm／waistband_cm ＋ color／fabric_weight／pattern
 * 三个真字段），原来那套从商品名里认"宽松/落肩/oversize"的中文词典已整块删除。
 * ⇒ 本文件的样本从"一句话"改成"一行衣柜数据"，方向断言一条没减。
 *
 * 2026-10-19 第三阶段·模块二补上**覆盖率惩罚**：在场轴归一让"六格只量出一格、那格恰好满分"归出
 * 100 分 ⇒ 靠少填给高分。现在 score = raw_score ×（floor + span×coverage），本文件第 5 条钉住它。
 *
 * 测的是五件事，跟 docs/依据/08 的硬规矩一一对上：
 *  1) 同一件上衣在不同人身上必须给出不同分（这条线存在的全部理由）
 *  2) 缺测的轴不进总分、权重按在场轴归一化；一维都凑不齐就返回 null（缺测不出分）
 *  3) body_type / kibbe_type 这类离散标签不得参与打分（08 §9.2）
 *  4) **自由文本不再产生任何分数**（10-19 废除伪量化：商品名换写法就换分，那分数没有依据）
 *  5) **缺格必须扣分**（10-19 第三阶段：量得越少分越低，"只填一格"拿不到满分）
 *
 * 方向断言只咬"谁比谁高"，不咬绝对分值 —— 绝对分值里的刻度与权重是 C 档手拍值（标定中），
 * 拿它当通过标准等于把自己的猜测当尺子。
 * ⚠️ 唯一的例外是 5b/5c 两节：它们咬的是**惩罚因子与版型映射表本身**的结构值
 *    （0.5+0.5×coverage、区间中值、半格计法），那是要钉住的实现口径，不是身材刻度。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const {
  BODY_REF,
  AXIS_WEIGHTS,
  GARMENT_REF,
  COVERAGE_PENALTY,
  FIT_TYPE_VALUES,
  FIT_TYPE_EASE,
  ESTIMATED_AXIS_WEIGHT,
  easeFromFitType,
  bodyDeviation,
  describeTop,
  isTopCategory,
  topFitBody,
  rankTopsByBody,
} = require('../services/topFitBody')

// 两个人：甲＝腰线明显、肩偏窄、腿身比标准、BMI 20.2（偏瘦一侧）
const JIA = {
  gender: '女',
  height: 163,
  weight: 54,
  bust: 88,
  waist: 70,
  hip: 92,
  shoulder: 36,
  leg_length: 88,
}
// 乙：腰腹粗（腰线平）、肩偏宽、腿偏短、BMI 28.7
const YI = {
  gender: '男',
  height: 174,
  weight: 87,
  bust: 104,
  waist: 95,
  hip: 99,
  shoulder: 47,
  leg_length: 86,
}

/**
 * 衣柜一行（样本全部是"量出来的数"，没有一个字是形容词）。
 * 名字只当标签用 —— 词典已删，写什么名字都不许影响分数（下面第 16 条钉住这件事）。
 */
const row = (over) => ({
  id: 1,
  name: '一件上衣',
  category: '衬衫',
  color: null,
  pattern: null,
  fit_style: null,
  fabric_weight: null,
  shoulder_cm: null,
  bust_cm: null,
  length_cm: null,
  waistband_cm: null,
  fit_type: null,
  ...over,
})
// 宽松廓形：肩缝外移 6cm、胸围放松 14cm、衣长压到胯下、没有腰头
const LOOSE = row({
  name: '宽松廓形上衣',
  shoulder_cm: 42,
  bust_cm: 102,
  length_cm: 72,
  waistband_cm: 0,
  color: '米白',
})
// 收腰款：腰头缝带 8cm（≥5cm 拉满），其余与 LOOSE 同
const CINCHED = row({
  name: '收腰款上衣',
  shoulder_cm: 37,
  bust_cm: 92,
  length_cm: 60,
  waistband_cm: 8,
  color: '米白',
})

const score = (person, top) => {
  const r = topFitBody(person, top)
  assert.ok(r, `不该返回 null：${JSON.stringify(top)}`)
  return r
}
const axisOf = (r, key) => r.axes.find((a) => a.key === key)

// ============================================================
// 1. 同一件上衣，两个人必须不同分
// ============================================================

test('topFitBody: 同一件上衣在不同人身上给出不同分（这就是"按人决定上衣"）', () => {
  const a = score(JIA, LOOSE)
  const b = score(YI, LOOSE)
  assert.notStrictEqual(a.score, b.score, '两个人的分数一样说明这一维还是跟人无关')
  // 甲腰线明显(想强调)、乙腰线平(想收)；这件 waistband_cm=0 ⇒ 修形方向是"不强调"
  // ⇒ 对想收的乙更对得上，对想强调腰线的甲正好反着
  assert.ok(b.score > a.score, `没有腰头的宽松上衣对腰线平的人应更占优：甲${a.score} 乙${b.score}`)
})

test('topFitBody: 收腰上衣对腰线明显的人分高，对腰线平的人分低', () => {
  const jia = axisOf(score(JIA, CINCHED), 'waist')
  const yi = axisOf(score(YI, CINCHED), 'waist')
  assert.ok(jia && yi)
  assert.ok(jia.score > yi.score, `腰线明显一侧应更高：甲${jia.score} 乙${yi.score}`)
})

test('topFitBody: 肩窄的人给肩缝外移的上衣加分，肩宽的人给正肩的上衣加分', () => {
  const jia = bodyDeviation(JIA)
  const yi = bodyDeviation(YI)
  assert.ok(jia.want.shoulder > 0, '甲肩宽比应低于参考带 ⇒ 想往外加肩')
  assert.ok(yi.want.shoulder < 0, '乙肩宽比应高于参考带 ⇒ 想收')
  // 肩缝外移量是唯一变量；每人的"正肩"取自己的净肩宽（甲 36、乙 47）
  const base = { name: '衬衫', bust_cm: 91, length_cm: 62, waistband_cm: 3 }
  const forJia = axisOf(score(JIA, row({ ...base, shoulder_cm: 40 })), 'shoulder')
  const forJiaSet = axisOf(score(JIA, row({ ...base, shoulder_cm: 36 })), 'shoulder')
  assert.ok(
    forJia.score > forJiaSet.score,
    `甲：外移 4cm${forJia.score} 应高于正肩${forJiaSet.score}`,
  )
  const forYi = axisOf(score(YI, row({ ...base, shoulder_cm: 47 })), 'shoulder')
  const forYiWide = axisOf(score(YI, row({ ...base, shoulder_cm: 55 })), 'shoulder')
  assert.ok(
    forYi.score > forYiWide.score,
    `乙：正肩${forYi.score} 应高于再外移 8cm${forYiWide.score}`,
  )
})

// ---- 肩宽÷腰围（站内比值；Pazhoohi 2023 的 SHR 是肩围÷臀围，本机量不到肩围）----

test('bodyDeviation: 肩宽÷腰围算得出来，落在参考带内时明确写"不推拉"', () => {
  const d = bodyDeviation(JIA) // 36/70 = 0.514
  assert.strictEqual(d.measure.shoulder_waist_ratio, 0.51)
  assert.ok(
    d.notes.some((n) => n.includes('肩宽÷腰围 0.51 在参考带内')),
    `带内要给一条 note：${d.notes.join(' | ')}`,
  )
})

test('bodyDeviation: 肩宽÷腰围偏低⇒往加肩修，偏高⇒收；肩宽÷身高那条留在带内不干扰', () => {
  const narrow = bodyDeviation({ height: 170, shoulder: 38, waist: 92 }) // 22.4% 带内；0.41 出带下侧
  assert.strictEqual(narrow.measure.shoulder_ratio, 22.4)
  assert.strictEqual(narrow.measure.shoulder_waist_ratio, 0.41)
  assert.ok(narrow.want.shoulder > 0, `比值低应想加肩：${narrow.want.shoulder}`)

  const wide = bodyDeviation({ height: 170, shoulder: 38, waist: 60 }) // 0.63 出带上侧
  assert.ok(wide.want.shoulder < 0, `比值高应收：${wide.want.shoulder}`)
})

test('bodyDeviation: 没量腰围就不算这条比值，缺测不兜底', () => {
  const d = bodyDeviation({ height: 170, shoulder: 38 }) // 只有身高+肩宽
  assert.strictEqual(d.measure.shoulder_waist_ratio, null)
  assert.strictEqual(d.measure.shoulder_ratio, 22.4)
  assert.ok(!d.notes.some((n) => n.includes('肩宽÷腰围')), '没量到就不该出现这条 note')
})

// ============================================================
// 2. 松量 × BMI（Liu 2006 的方向 + Sakata 2020 的区间先验）
// ============================================================

test('bodyDeviation: 松量窗口按 BMI 分档，切点与 Liu 2006 的三档一致', () => {
  const thin = bodyDeviation({ height: 165, weight: 48 }) // BMI 17.6
  const mid = bodyDeviation({ height: 165, weight: 60 }) // BMI 22.0
  const heavy = bodyDeviation({ height: 165, weight: 88 }) // BMI 32.3
  assert.deepStrictEqual(thin.ease_window, BODY_REF.ease_windows[0].range)
  assert.deepStrictEqual(mid.ease_window, BODY_REF.ease_windows[1].range)
  assert.deepStrictEqual(heavy.ease_window, BODY_REF.ease_windows[3].range)
  // 窗口宽度随 BMI 往宽挪，到 >28 又收回中段（Liu：过紧过松都显胖）
  assert.ok(mid.ease_window[1] - mid.ease_window[0] >= 4)
  assert.ok(heavy.ease_window[1] - heavy.ease_window[0] <= 5)
})

test('topFitBody: 偏瘦的人穿大松量（成品胸围−净胸围 22cm）的松量分低于穿小松量的', () => {
  const thin = { height: 165, weight: 48, bust: 84, waist: 68, hip: 88, shoulder: 38 } // BMI 17.6 ⇒ 窗口 1~4
  const fitted = axisOf(score(thin, row({ bust_cm: 87, shoulder_cm: 39 })), 'ease') // 松量 3
  const oversize = axisOf(score(thin, row({ bust_cm: 106, shoulder_cm: 45 })), 'ease') // 松量 22
  assert.ok(
    fitted.score > oversize.score,
    `BMI<20 一侧：松量3${fitted.score} 应高于松量22${oversize.score}`,
  )
})

test('topFitBody: BMI 24–28 的人，成品胸围放松 7cm 比放松 1cm 松量分高（Liu 2006 的那段反向）', () => {
  const mid = { height: 168, weight: 70, bust: 96, waist: 82, hip: 96, shoulder: 41 } // BMI 24.8
  assert.deepStrictEqual(bodyDeviation(mid).ease_window, BODY_REF.ease_windows[2].range)
  const tight = axisOf(score(mid, row({ bust_cm: 97, shoulder_cm: 41 })), 'ease') // 松量 1，出带下侧
  const loose = axisOf(score(mid, row({ bust_cm: 103, shoulder_cm: 41 })), 'ease') // 松量 7，窗口 3~10 内
  assert.ok(loose.score > tight.score, `24–28 一侧：放松 7${loose.score} 应高于紧身${tight.score}`)
})

// ============================================================
// 3. 深色收缩（Koutsoumpis 2021）与腿身比
// ============================================================

test('topFitBody: 想收体量的人深色上衣体量分高于浅色，想加体量的人反过来', () => {
  const heavy = { height: 170, weight: 84, bust: 100, waist: 92, hip: 98, shoulder: 45 }
  const dark = axisOf(score(heavy, row({ color: '#111111', fabric_weight: '中' })), 'volume')
  const light = axisOf(score(heavy, row({ color: '#FFFFFF', fabric_weight: '中' })), 'volume')
  assert.ok(dark.score > light.score, `偏胖一侧：深色${dark.score} 应高于浅色${light.score}`)

  const thin = { height: 160, weight: 44, bust: 82, waist: 66, hip: 86, shoulder: 35 }
  assert.ok(bodyDeviation(thin).want.volume > 0, '偏瘦一侧应想往外加体量')
  const d2 = axisOf(score(thin, row({ color: '#111111', fabric_weight: '中' })), 'volume')
  const l2 = axisOf(score(thin, row({ color: '#FFFFFF', fabric_weight: '中' })), 'volume')
  assert.ok(l2.score > d2.score, `偏瘦一侧：浅色${l2.score} 应高于深色${d2.score}`)
})

test('topFitBody: 腿身比偏短的人，衣长 50cm 的视觉腰位轴高于衣长 100cm 的', () => {
  const dev = bodyDeviation(YI)
  assert.ok(dev.want.length > 0, '乙腿身比应低于参考带')
  // 乙身高 174 ⇒ 胯线原点 ≈ 174×0.40 = 69.6cm；50 在胯上（提视线）、100 过胯 30cm（压视线）
  const short = axisOf(score(YI, row({ length_cm: 50 })), 'length')
  const long = axisOf(score(YI, row({ length_cm: 100 })), 'length')
  assert.ok(short.score > long.score, `腿偏短一侧：短款${short.score} 应高于长款${long.score}`)
})

// ============================================================
// 4. 条纹轴：最低权重 + BMI 闸门（Ashida 2013 说体型大时反转）
// ============================================================

test('topFitBody: BMI≥25 时条纹轴直接缺席，不进入总分', () => {
  const heavy = { height: 172, weight: 90, bust: 106, waist: 96, hip: 102, shoulder: 46 }
  // 闸门关上时人的偏差向量里也不许留"条纹想收"，否则界面挂着这条却一维都没算它
  const dev = bodyDeviation(heavy)
  assert.strictEqual(dev.want.pattern, null, 'BMI≥25 ⇒ want.pattern 必须是 null')
  assert.ok(
    dev.notes.some((n) => n.includes('条纹方向这条不采用')),
    'notes 要写明为什么不用',
  )
  assert.ok(bodyDeviation(heavy).measure.bmi >= BODY_REF.stripe_bmi_max)
  // 拿"黑色横条纹"那一行当样本：体量这一维在场，才能看清条纹那一维是被闸门关掉的
  const r = score(heavy, row({ color: '#111111', fabric_weight: '中', pattern: '横条' }))
  assert.ok(r.axes_present.includes('volume'), '体量轴应在场，否则这条断言看不出闸门生效')
  assert.ok(!r.axes_present.includes('pattern'), 'BMI 闸门没生效')
  assert.ok(r.axes_missing.includes('pattern'))
  assert.strictEqual(
    AXIS_WEIGHTS.pattern,
    Math.min(...Object.values(AXIS_WEIGHTS)),
    '条纹必须是最低权重',
  )
})

test('topFitBody: 条纹轴只认 pattern 那一格填的值，商品名里写"条"字不算（10-19 废词典）', () => {
  const dev = bodyDeviation(JIA)
  const on = dev.want.pattern != null && dev.measure.bmi < BODY_REF.stripe_bmi_max
  assert.ok(on, '甲 BMI 20.2 ⇒ 这条闸门本该开着，下面的断言才有意义')
  // 名字里带"竖条纹"但那一格空着 ⇒ 这一维必须缺席
  const byName = describeTop(row({ name: '竖条纹衬衫', pattern: null }), dev)
  assert.strictEqual(byName.pattern, null, '名称里的"条"字不许再凭空造出这一维')
  const byField = describeTop(row({ name: '衬衫', pattern: '竖条' }), dev)
  assert.strictEqual(byField.pattern, 1, 'pattern 格填了才认')
  assert.strictEqual(describeTop(row({ pattern: '格子' }), dev).pattern, null, '认不到的值当没填')
  assert.deepStrictEqual(
    Object.keys(GARMENT_REF.pattern_values).sort(),
    ['横条', '横条纹', '竖条', '竖条纹'].sort(),
    '这一格认的死值表变了要同步前端下拉与文档',
  )
  const r = score(JIA, row({ name: '衬衫', pattern: '竖条' }))
  assert.ok(r.axes_present.includes('pattern'))
  assert.match(
    r.axes.find((a) => a.key === 'pattern').based_on,
    /pattern 自填值/,
    '每一维都要写明这个数从哪一格来',
  )
})

// ============================================================
// 5. 缺测不出分
// ============================================================

test('bodyDeviation: 一个尺寸都没填 ⇒ want 全 null、person_cm 全 null、松量窗口 null', () => {
  const dev = bodyDeviation({})
  for (const v of Object.values(dev.want)) assert.strictEqual(v, null)
  for (const v of Object.values(dev.measure)) assert.strictEqual(v, null)
  for (const v of Object.values(dev.person_cm)) assert.strictEqual(v, null)
  assert.strictEqual(dev.ease_window, null)
})

test('topFitBody: 人没量尺寸 ⇒ 返回 null（不返回 0 分这种"看起来像判过"的东西）', () => {
  assert.strictEqual(topFitBody({}, LOOSE), null)
  assert.strictEqual(topFitBody(null, CINCHED), null)
})

test('topFitBody: 上衣不是衣柜行（只有自由文本）⇒ 返回 null，一格猜出来的分都不给', () => {
  // 这条是"最后一公里"的守门测试：改前这三句都能算出个分，分数还随措辞变
  assert.strictEqual(topFitBody(JIA, '宽松廓形针织开衫'), null)
  assert.strictEqual(topFitBody(JIA, '挺括垫肩小西装'), null)
  assert.strictEqual(topFitBody(JIA, '上衣'), null)
  assert.strictEqual(topFitBody(JIA, ''), null)
  assert.strictEqual(topFitBody(JIA, null), null)
  assert.strictEqual(topFitBody(JIA, undefined), null)
  // 空行（四格全没填、也没有色/面料）同样一维都凑不出 ⇒ null，不是 0 分
  assert.strictEqual(topFitBody(JIA, row({})), null)
  const g = describeTop('宽松廓形针织开衫', bodyDeviation(JIA))
  assert.strictEqual(g.source, 'no_row')
  assert.strictEqual(g.coverage, 0)
})

test('topFitBody: 只有部分轴在场时权重按在场轴归一化，总分仍在 0~100', () => {
  const onlyBmi = { height: 168, weight: 70 } // 只有 BMI ⇒ 松量/体量/条纹三维
  const r = score(onlyBmi, row({ bust_cm: 103, color: '#FFFFFF', fabric_weight: '中' }))
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.ok(!r.axes_present.includes('shoulder'), '没量净肩宽就不该有肩线这一维')
  for (const a of r.axes) {
    assert.ok(a.score >= 0 && a.score <= 1, `单轴分越界：${a.key}=${a.score}`)
  }
  // 缺的那几格要在返回值里点名，不能只给个总分
  assert.ok(r.missing_measure.includes('shoulder'), JSON.stringify(r.missing_measure))
  assert.ok(r.coverage > 0 && r.coverage < 1, `覆盖率应是个介于 0 和 1 的数：${r.coverage}`)
})

// ============================================================
// 5b. 覆盖率惩罚（10-19 第三阶段·模块二：堵住"只量一格反而满分"这个边界作弊）
// ============================================================

test('topFitBody: 只填 1 格 ⇒ 那一格算得再准也拿不到满分（raw 100 必须被压到 60 以下）', () => {
  const dev = bodyDeviation(JIA) // 净胸围 88，BMI 20.3 ⇒ 松量窗口 2~7cm
  const r = score(JIA, row({ bust_cm: 92.5 }), dev)
  assert.strictEqual(r.axes_present.join(','), 'ease', '只填胸围这一格 ⇒ 只有松量一维在场')
  assert.strictEqual(r.coverage, 0.17, `六格量到一格：${r.coverage}`)
  // 病灶本身：在场轴归一后 raw_score 确实是 100（这一格满分），惩罚前它就顶着 100 出门了
  assert.strictEqual(r.raw_score, 100)
  const cap = Math.ceil(100 * (COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * (1 / 6)))
  assert.ok(
    r.score <= cap,
    `只填一格的最多只能拿 ${cap} 分，实际 ${r.score}（这证明惩罚真的乘上去了）`,
  )
  assert.ok(r.score < r.raw_score, `缺格不扣分就是没惩罚：${r.score} vs ${r.raw_score}`)
  assert.strictEqual(
    r.score,
    Math.round(r.raw_score * (COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * r.coverage)),
    '公式：FinalBodyFit = RawBodyFit ×（floor + span × Coverage）',
  )
})

test('topFitBody: 只填 2 格的必须高于只填 1 格，且两件都不许越过六格齐全的那件', () => {
  const dev = bodyDeviation(JIA)
  const one = score(JIA, row({ bust_cm: 92.5 }), dev)
  const two = score(JIA, row({ bust_cm: 92.5, waistband_cm: 8 }), dev)
  assert.strictEqual(two.coverage, 0.33, `六格量到两格：${two.coverage}`)
  assert.strictEqual(two.raw_score, 100, '两格都算得满分 ⇒ 归一后仍是 100')
  assert.strictEqual(
    two.score,
    Math.round(100 * (COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * two.coverage)),
  )
  assert.ok(two.score > one.score, `量两格的该比量一格的占优：${two.score} vs ${one.score}`)
  const full = score(
    JIA,
    row({
      shoulder_cm: 37,
      bust_cm: 92,
      length_cm: 60,
      waistband_cm: 8,
      color: '米白',
      pattern: '竖条',
    }),
    dev,
  )
  assert.strictEqual(full.coverage, 1)
  assert.strictEqual(full.coverage_penalty, 1, '六格齐全 ⇒ 因子恰好 1，不打折')
  assert.strictEqual(full.score, full.raw_score, '不齐全才打折，齐全的一分不扣')
  for (const [tag, r] of [
    ['只填 1 格', one],
    ['只填 2 格', two],
  ]) {
    assert.ok(
      full.score > r.score,
      `靠少填不许给高分：${tag} ${r.score} 竟不低于六格齐全的 ${full.score}`,
    )
  }
})

test('topFitBody: 惩罚只乘这一次，且方向断言不受影响（同一个人两件收腰款仍谁对给谁高分）', () => {
  const dev = bodyDeviation(JIA)
  const straight = score(JIA, row({ bust_cm: 92, waistband_cm: 0 }), dev)
  const cinched = score(JIA, row({ bust_cm: 92, waistband_cm: 8 }), dev)
  assert.strictEqual(straight.coverage, cinched.coverage, '两件量到的格子数相同 ⇒ 因子必须相同')
  assert.strictEqual(cinched.coverage_penalty, straight.coverage_penalty)
  assert.ok(
    cinched.score > straight.score,
    `腰线明显的人该更认收腰款：${cinched.score} vs ${straight.score}`,
  )
})

// ============================================================
// 5c. 版型映射兜底（10-19 第三阶段·模块一：不动软尺也能让公式跑，但估的那格只算半格）
// ============================================================

test('easeFromFitType: 四档各有区间中值；认不到的值一律 null，不"就近归档"', () => {
  assert.deepStrictEqual(FIT_TYPE_VALUES, ['修身', '合身', '宽松', '廓形'])
  // 映射表本体（第三阶段·模块一要交付的东西）：区间钉死，改了这张表就得同时改这条断言
  assert.deepStrictEqual(
    FIT_TYPE_VALUES.map((v) => FIT_TYPE_EASE[v].range),
    [
      [0, 2],
      [2, 7],
      [8, 15],
      [15, 26],
    ],
    '修身/合身/宽松/廓形 的放松量区间（cm，胸围）',
  )
  assert.deepStrictEqual(
    FIT_TYPE_VALUES.map(easeFromFitType),
    FIT_TYPE_VALUES.map((v) => {
      const [lo, hi] = FIT_TYPE_EASE[v].range
      return Math.round(((lo + hi) / 2) * 10) / 10
    }),
    '估计值＝区间中值',
  )
  // 旧词与自由词都不认：合体是退役的 fit_style 值域，紧身/oversize 是商品名里的形容词
  for (const bad of [null, undefined, '', '   ', '合体', '紧身', 'oversize', '宽松x', 12]) {
    assert.strictEqual(easeFromFitType(bad), null, `"${bad}" 不该被归档`)
  }
  assert.strictEqual(easeFromFitType(' 宽松 '), 11.5, '前后空格要清掉再认')
})

test('describeTop: 没量胸围但选了版型 ⇒ 松量估出来、标 estimated、覆盖率只按半格计', () => {
  const dev = bodyDeviation(JIA)
  const g = describeTop(row({ fit_type: '合身' }), dev)
  assert.strictEqual(g.ease, 4.5, '合身档 ⇒ 区间 2~7 的中值')
  assert.deepStrictEqual(g.estimated, ['ease'], '这一维是估的，必须点名')
  assert.deepStrictEqual(g.measured, [], '没量到任何一格 ⇒ measured 是空表')
  assert.strictEqual(g.fit_type, '合身')
  assert.strictEqual(
    g.coverage,
    Math.round((ESTIMATED_AXIS_WEIGHT / 6) * 100) / 100,
    '估的那一维只按半格计：0.5 ÷ 6',
  )
  assert.ok(
    g.signals.some((s) => s.startsWith('松量按版型')),
    `要写清这一维是估的：${g.signals.join(' | ')}`,
  )
  // 认不到的版型值 ⇒ 和没填一样，这一维整块缺席
  const junk = describeTop(row({ fit_type: '紧身' }), dev)
  assert.strictEqual(junk.ease, null)
  assert.ok(junk.missing.includes('ease'))
  assert.strictEqual(junk.coverage, 0)
})

test('topFitBody: 只选一档版型 ⇒ 惩罚照样压在头上（半格覆盖率 ⇒ 因子 0.54，最高只到 54 分）', () => {
  const dev = bodyDeviation(JIA) // BMI 20.3 ⇒ 松量窗口 2~7cm，合身档正好落在窗口里
  const fit = score(JIA, row({ fit_type: '合身' }), dev)
  assert.strictEqual(fit.raw_score, 100, '估出来的松量落在窗口内 ⇒ 归一后确实是满分')
  assert.strictEqual(
    fit.coverage,
    Math.round((ESTIMATED_AXIS_WEIGHT / 6) * 100) / 100,
    '只选版型 ⇒ 覆盖率只有半格那一档',
  )
  assert.strictEqual(
    fit.score,
    Math.round(fit.raw_score * (COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * fit.coverage)),
    `半格覆盖率必须被惩罚折过：实际 ${fit.score}／因子 ${fit.coverage_penalty}`,
  )
  assert.ok(fit.score < fit.raw_score, '选了版型不等于量了尺寸')
  assert.strictEqual(
    fit.axes.find((a) => a.key === 'ease').estimated,
    true,
    '轴上要带 estimated 标记',
  )
  // 越偏离这个人的窗口，估出来的分越低（四档单调性只咬方向，不咬刻度）
  const four = FIT_TYPE_VALUES.map((v) => [v, score(JIA, row({ fit_type: v }), dev).score])
  assert.ok(
    four.find((x) => x[0] === '合身')[1] > four.find((x) => x[0] === '宽松')[1],
    `窗口内那档必须高于一档放大的：${JSON.stringify(four)}`,
  )
  assert.ok(
    four.find((x) => x[0] === '宽松')[1] > four.find((x) => x[0] === '廓形')[1],
    `越界越远分越低：${JSON.stringify(four)}`,
  )
})

test('topFitBody: 胸围量到了 ⇒ 只认实测，版型那一格一个分都不改（一维一源，不重复收钱）', () => {
  const dev = bodyDeviation(JIA)
  const a = score(JIA, row({ bust_cm: 92 }), dev)
  const b = score(JIA, row({ bust_cm: 92, fit_type: '廓形' }), dev)
  assert.strictEqual(b.score, a.score, '同一件衣服，填不填版型都得同一个分')
  assert.strictEqual(b.coverage, a.coverage, '覆盖率也不许因为选了版型而涨')
  const g = describeTop(row({ bust_cm: 92, fit_type: '廓形' }), dev)
  assert.strictEqual(g.ease, 4, '松量＝92 − 88 = 4cm（实测口径）')
  assert.deepStrictEqual(g.estimated, [])
  assert.ok(g.measured.includes('bust_cm'))
})

test('rankTopsByBody: 只有版型的行能进排序（不再整块缺席），但仍排在量齐的那件之后', () => {
  const dev = bodyDeviation(JIA)
  const out = rankTopsByBody(
    JIA,
    [
      row({ id: 1, name: '只选了版型', fit_type: '合身' }),
      row({
        id: 2,
        name: '量齐的一件',
        shoulder_cm: 37,
        bust_cm: 92,
        length_cm: 60,
        waistband_cm: 8,
        color: '米白',
        pattern: '竖条',
      }),
    ],
    dev,
  )
  assert.strictEqual(out.unscored, 0, '版型档把水注进来了：这一件不该再是"不打分"')
  assert.deepStrictEqual(
    out.ranked.map((r) => r.item.id),
    [2, 1],
    `量齐的必须压过只选版型的：${JSON.stringify(out.ranked.map((r) => [r.item.id, r.score, r.coverage]))}`,
  )
})

// ============================================================
// 6. 离散标签不参与打分（08 §9.2 的落地证据）
// ============================================================

test('topFitBody: 改 body_type / kibbe_type / frame_size / 色彩季型，分数一字不变', () => {
  const base = score(JIA, CINCHED)
  for (const label of [
    { body_type: '沙漏型' },
    { body_type: '苹果型', body_shape: '苹果型' },
    { kibbe_type: 'SN', frame_size: '大气', line_quality: '偏曲线' },
    { color_season: '夏型', color_season_12: '冷夏' },
  ]) {
    const r = score({ ...JIA, ...label }, CINCHED)
    assert.strictEqual(r.score, base.score, `离散标签 ${JSON.stringify(label)} 进了公式`)
  }
})

// ============================================================
// 7. 衣柜真字段：每一维都要能追到某一格实测值
// ============================================================

test('describeTop: 四格实测各进哪一维、算式写在 signals 里；版型档不再参与算分', () => {
  const dev = bodyDeviation(JIA) // 净胸围 88、净肩宽 36、身高 163
  const g = describeTop(
    row({ fit_style: '宽松', shoulder_cm: 40, bust_cm: 96, length_cm: 59, waistband_cm: 6 }),
    dev,
  )
  assert.strictEqual(g.ease, 8, '松量＝成品胸围 96 − 净胸围 88 = 8cm')
  assert.strictEqual(g.shoulder, 0.82, '肩缝外移 4cm = 肩宽比 2.5 个百分点 ÷ 带宽 3')
  assert.strictEqual(g.waist, 1, '腰头 6cm ≥ 拉满线 5cm ⇒ +1')
  assert.strictEqual(g.length, 0.52, '胯线 65.2 − 衣长 59 = 6.2cm ÷ 12')
  assert.deepStrictEqual(g.garment_cm, {
    shoulder_cm: 40,
    bust_cm: 96,
    length_cm: 59,
    waistband_cm: 6,
  })
  // 关键：fit_style='宽松' 这一格不再被当成松量代理（原来是它直接给 9）
  assert.ok(
    g.signals.some((s) => s.startsWith('松量＝成品胸围')),
    `松量必须由两格胸围相减：${g.signals.join(' | ')}`,
  )
  assert.ok(!g.signals.some((s) => s.startsWith('版型=')), '版型档不许再进修形向量')
  assert.strictEqual(describeTop(row({ fit_style: '宽松', bust_cm: null }), dev).ease, null)
})

test('describeTop: 腰头高填 0 是"这件明确直筒"，留空才是"没量"（两件事不许混）', () => {
  const dev = bodyDeviation(JIA)
  const zero = describeTop(row({ waistband_cm: 0 }), dev)
  assert.strictEqual(zero.waist, -1, '0cm ⇒ 腰线强调拉满到"不强调"那一端')
  assert.ok(zero.measured.includes('waistband_cm'))
  const blank = describeTop(row({ waistband_cm: null }), dev)
  assert.strictEqual(blank.waist, null, '没填 ⇒ 这一维缺席')
  assert.ok(blank.missing.includes('waist'))
  assert.strictEqual(describeTop(row({ waistband_cm: '' }), dev).waist, null, '空串当没量')
})

test('describeTop: 颜色认得出色名/hex 才给体量方向，认不出就是 null', () => {
  const dev = bodyDeviation(JIA)
  assert.ok(describeTop(row({ color: '#111111' }), dev).volume < 0, '近黑应判成"收"')
  assert.ok(describeTop(row({ color: '白色' }), dev).volume > 0, '白应判成"胀"')
  assert.strictEqual(describeTop(row({ color: '未知' }), dev).volume, null, '"未知"不是颜色')
  // 厚薄是第二个真字段：同色下厚的那件更"胀"（C 档经验刻度，只咬方向）
  const thin = describeTop(row({ color: '中灰', fabric_weight: '薄' }), dev).volume
  const thick = describeTop(row({ color: '中灰', fabric_weight: '厚' }), dev).volume
  assert.ok(thick > thin, `厚${thick} 应比薄${thin} 更往外加体量`)
})

// ============================================================
// 8. 排序输出
// ============================================================

test('rankTopsByBody: 分数降序、没量尺寸的进 unscored 并写明缺哪四格', () => {
  const tops = [
    row({
      id: 1,
      name: '宽松廓形上衣',
      shoulder_cm: 44,
      bust_cm: 118,
      length_cm: 74,
      waistband_cm: 0,
      color: '米白',
      fabric_weight: '中',
    }),
    row({
      id: 2,
      name: '收腰衬衫',
      shoulder_cm: 48,
      bust_cm: 112,
      length_cm: 60,
      waistband_cm: 7,
      color: '藏蓝',
      fabric_weight: '中',
    }),
    row({ id: 3, name: '一件四格都没量的上衣' }),
  ]
  const out = rankTopsByBody(YI, tops)
  assert.strictEqual(out.ranked.length, 2)
  assert.strictEqual(out.unscored, 1)
  for (let i = 1; i < out.ranked.length; i++) {
    assert.ok(out.ranked[i - 1].score >= out.ranked[i].score, '没按分数降序')
  }
  assert.ok(out.person_deviation.want.waist < 0, '乙的腰线平 ⇒ 偏差向量应想收')
  assert.ok(out.ranked.every((r) => r.axes.length === r.axes_present.length))
  assert.ok(out.ranked[0].measured.length >= 1, '打分结果要带回"用了哪几格"')
  assert.match(out.unscored_reason[0], /肩宽\/胸围\/衣长\/腰头高/)
})

test('rankTopsByBody: 空衣柜返回空表不报错', () => {
  const out = rankTopsByBody(JIA, [])
  assert.deepStrictEqual(out.ranked, [])
  assert.strictEqual(out.unscored, 0)
})

test('isTopCategory: 认活库里真实存在的中文品类，也认英文键；下装/鞋不算上衣', () => {
  // 现量 10-09：user_wardrobe.category 存的是中文自由标签（'衬衫'/'开衫'/'外套'/'裤子'/'未分类'）
  // ⇒ 判定只按英文键写死会一条不中，这条锁住中文口径
  ;[
    '衬衫',
    '开衫',
    '外套',
    '西装',
    '卫衣',
    'T恤',
    '针织衫',
    '毛衣',
    '风衣',
    '夹克',
    '大衣',
  ].forEach((c) => assert.ok(isTopCategory(c), `中文品类该认出来: ${c}`))
  ;['top', 'outerwear', 'Top', 'OUTERWEAR'].forEach((c) =>
    assert.ok(isTopCategory(c), `英文键该认出来: ${c}`),
  )
  ;['裤子', '半身裙', '连衣裙', '鞋子', '未分类', '', null, undefined].forEach((c) =>
    assert.ok(!isTopCategory(c), `不是上衣: ${c}`),
  )
})

// ============================================================
// 7. 读路径接线：版型那一列真从库里走到了算分现场（10-19 第三阶段·模块一）
// ============================================================

/**
 * 单测里 describeTop 一直看得见 fit_type，但**路由把那行衣柜数据摊成描述符时漏掉这一列**，
 * 线上照样估不出松量 —— 19:5x 真浏览器点验时现量到这条断线（衣橱"上衣打分"面板给只选版型的
 * 行回"四格一个都没量"）。这一条不测算法，只钉接线：两处投影都必须带 fit_type。
 * 判据＝直接读源文本（与 regressRankWeights.test.js 的权重漂移哨兵同一招）。
 *
 * 🔴 2026-10-21 第九阶段·第一步改了落点：`/api/recommend/engine` 也要注入衣橱行
 * （`docs/依据/17` §五 第 2 条），两处各抄一份字段清单迟早打架 ⇒ 投影搬进
 * `utils/common.js` 的 `projectWardrobeForEngine` 当唯一真相源。断言跟着改成三件事：
 * ① 那份唯一投影里 `fit_type` 在场；② 衣橱口与推荐口**都真的在用它**（漏接一处等于没搬）。
 */
test('读路径接线: 两处衣柜行投影都走同一份唯一真相源且带 fit_type（漏一处，版型兜底就在现场失灵）', () => {
  const fs = require('node:fs')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '') // 注释里的字面量不算接线
  const read = (p) => strip(fs.readFileSync(require.resolve(p), 'utf8'))
  const common = read('../utils/common.js')
  const wardrobe = read('../routes/wardrobe.js')
  const recommend = read('../routes/recommend.js')

  const proj = common.slice(common.indexOf('function projectWardrobeForEngine'))
  assert.match(
    proj,
    /fit_type:\s*i\.fit_type/,
    '唯一投影 projectWardrobeForEngine 没把 fit_type 带上',
  )
  assert.match(proj, /shoulder_cm:\s*i\.shoulder_cm/, '唯一投影没带四格实测里的 shoulder_cm')

  const descriptor = wardrobe.slice(wardrobe.indexOf('function toTopDescriptor'))
  assert.match(descriptor, /fit_type:\s*row\.fit_type/, 'toTopDescriptor 没把 fit_type 带进描述符')

  assert.match(
    wardrobe,
    /\.map\(projectWardrobeForEngine\)/,
    '衣橱口(/wardrobe/recommend)没接唯一投影',
  )
  assert.match(
    recommend,
    /\.map\(projectWardrobeForEngine\)/,
    '推荐口(/recommend/engine)没接唯一投影',
  )
})
