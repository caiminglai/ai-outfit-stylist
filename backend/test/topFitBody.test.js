/**
 * 上衣 × 身体 适配分测试（topFitBody，不看脸那一半）
 *
 * 这个模块是纯函数，不 require db、不写库，可以脱离数据库重复跑。
 *
 * 测的是三件事，跟 docs/依据/08 的硬规矩一一对上：
 *  1) 同一件上衣在不同人身上必须给出不同分（这条线存在的全部理由）
 *  2) 缺测的轴不进总分、权重按在场轴归一化；一维都凑不齐就返回 null（缺测不出分）
 *  3) body_type / kibbe_type 这类离散标签不得参与打分（08 §9.2）
 *
 * 方向断言只咬"谁比谁高"，不咬绝对分值 —— 绝对分值里的刻度与权重是 C 档手拍值（标定中），
 * 拿它当通过标准等于把自己的猜测当尺子。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const {
  BODY_REF,
  AXIS_WEIGHTS,
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

const score = (person, top) => {
  const r = topFitBody(person, top)
  assert.ok(r, `不该返回 null：${top}`)
  return r
}
const axisOf = (r, key) => r.axes.find((a) => a.key === key)

// ============================================================
// 1. 同一件上衣，两个人必须不同分
// ============================================================

test('topFitBody: 同一件上衣在不同人身上给出不同分（这就是"按人决定上衣"）', () => {
  const top = '宽松廓形针织开衫'
  const a = score(JIA, top)
  const b = score(YI, top)
  assert.notStrictEqual(a.score, b.score, '两个人的分数一样说明这一维还是跟人无关')
  // 甲腰线明显(想强调)、乙腰线平(别硬收) ⇒ 同一件宽松上衣对乙更合适
  assert.ok(b.score > a.score, `宽松上衣对腰线平的人应更占优：甲${a.score} 乙${b.score}`)
})

test('topFitBody: 收腰上衣对腰线明显的人分高，对腰线平的人分低', () => {
  const top = '收腰衬衫'
  const jia = axisOf(score(JIA, top), 'waist')
  const yi = axisOf(score(YI, top), 'waist')
  assert.ok(jia && yi)
  assert.ok(jia.score > yi.score, `腰线明显一侧应更高：甲${jia.score} 乙${yi.score}`)
})

test('topFitBody: 肩窄的人给垫肩上衣加分，肩宽的人给落肩上衣加分', () => {
  const jia = bodyDeviation(JIA)
  const yi = bodyDeviation(YI)
  assert.ok(jia.want.shoulder > 0, '甲肩宽比应低于参考带 ⇒ 想往外加肩')
  assert.ok(yi.want.shoulder < 0, '乙肩宽比应高于参考带 ⇒ 想收')
  const pad = axisOf(score(JIA, '挺括垫肩小西装'), 'shoulder')
  const drop = axisOf(score(JIA, '落肩宽松卫衣'), 'shoulder')
  assert.ok(pad.score > drop.score, `甲：垫肩${pad.score} 应高于落肩${drop.score}`)
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

test('topFitBody: 偏瘦的人穿 oversize 的松量分低于偏瘦的人穿合体款', () => {
  const thin = { height: 165, weight: 48, bust: 84, waist: 68, hip: 88, shoulder: 38 }
  const tight = axisOf(score(thin, '修身衬衫'), 'ease')
  const loose = axisOf(score(thin, '宽松oversize卫衣'), 'ease')
  assert.ok(tight.score > loose.score, `BMI<20 一侧：合体${tight.score} 应高于大码${loose.score}`)
})

test('topFitBody: BMI 24–28 的人穿宽松比穿紧身松量分高（Liu 2006 的那段反向）', () => {
  const mid = { height: 168, weight: 70, bust: 96, waist: 82, hip: 96, shoulder: 41 } // BMI 24.8
  assert.deepStrictEqual(bodyDeviation(mid).ease_window, BODY_REF.ease_windows[2].range)
  const tight = axisOf(score(mid, '紧身打底衫'), 'ease')
  const loose = axisOf(score(mid, '宽松直筒衬衫'), 'ease')
  assert.ok(loose.score > tight.score, `24–28 一侧：宽松${loose.score} 应高于紧身${tight.score}`)
})

// ============================================================
// 3. 深色收缩（Koutsoumpis 2021）与腿身比
// ============================================================

test('topFitBody: 想收体量的人深色上衣体量分高于浅色，想加体量的人反过来', () => {
  const heavy = { height: 170, weight: 84, bust: 100, waist: 92, hip: 98, shoulder: 45 }
  const dark = axisOf(score(heavy, '黑色修身针织衫'), 'volume')
  const light = axisOf(score(heavy, '白色针织衫'), 'volume')
  assert.ok(dark.score > light.score, `偏胖一侧：深色${dark.score} 应高于浅色${light.score}`)

  const thin = { height: 160, weight: 44, bust: 82, waist: 66, hip: 86, shoulder: 35 }
  assert.ok(bodyDeviation(thin).want.volume > 0, '偏瘦一侧应想往外加体量')
  const d2 = axisOf(score(thin, '黑色针织衫'), 'volume')
  const l2 = axisOf(score(thin, '米白针织衫'), 'volume')
  assert.ok(l2.score > d2.score, `偏瘦一侧：浅色${l2.score} 应高于深色${d2.score}`)
})

test('topFitBody: 腿身比偏短的人，短款上衣的视觉腰位轴高于长款', () => {
  const dev = bodyDeviation(YI)
  assert.ok(dev.want.length > 0, '乙腿身比应低于参考带')
  const short = axisOf(score(YI, '短款高腰针织衫'), 'length')
  const long = axisOf(score(YI, '长款过臀大衣'), 'length')
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
  assert.ok(dev.notes.some((n) => n.includes('条纹方向这条不采用')), 'notes 要写明为什么不用')
  assert.ok(bodyDeviation(heavy).measure.bmi >= BODY_REF.stripe_bmi_max)
  // 拿"黑色横条纹T恤"当样本：体量这一维在场，才能看清条纹那一维是被闸门关掉的
  const r = score(heavy, '黑色横条纹T恤')
  assert.ok(r.axes_present.includes('volume'), '体量轴应在场，否则这条断言看不出闸门生效')
  assert.ok(!r.axes_present.includes('pattern'), 'BMI 闸门没生效')
  assert.ok(r.axes_missing.includes('pattern'))
  assert.strictEqual(AXIS_WEIGHTS.pattern, Math.min(...Object.values(AXIS_WEIGHTS)), '条纹必须是最低权重')
})

test('topFitBody: 条纹轴只在文本里真的出现"条"时才有，且给的是修正分不是判定', () => {
  const plain = describeTop('纯色圆领T恤')
  assert.strictEqual(plain.pattern, null, '没写条纹就不许凭空造这一维')
  const dev = bodyDeviation(JIA)
  const on = dev.want.pattern != null && dev.measure.bmi < BODY_REF.stripe_bmi_max
  if (on) {
    const r = score(JIA, '竖条纹衬衫')
    assert.ok(r.axes_present.includes('pattern'))
  }
})

// ============================================================
// 5. 缺测不出分
// ============================================================

test('bodyDeviation: 一个尺寸都没填 ⇒ 所有 want 为 null、松量窗口为 null', () => {
  const dev = bodyDeviation({})
  for (const v of Object.values(dev.want)) assert.strictEqual(v, null)
  assert.strictEqual(dev.ease_window, null)
  for (const v of Object.values(dev.measure)) assert.strictEqual(v, null)
})

test('topFitBody: 人没量尺寸 ⇒ 返回 null（不返回 0 分这种"看起来像判过"的东西）', () => {
  assert.strictEqual(topFitBody({}, '宽松廓形针织开衫'), null)
  assert.strictEqual(topFitBody(null, '收腰衬衫'), null)
})

test('topFitBody: 上衣什么都认不出来 ⇒ 返回 null，不给一句话硬凑分', () => {
  assert.strictEqual(topFitBody(JIA, '上衣'), null)
  assert.strictEqual(topFitBody(JIA, ''), null)
  assert.strictEqual(topFitBody(JIA, null), null)
})

test('topFitBody: 只有部分轴在场时权重按在场轴归一化，总分仍在 0~100', () => {
  const onlyBmi = { height: 168, weight: 70 } // 只有 BMI ⇒ 松量/体量/条纹三维
  const r = score(onlyBmi, '宽松卫衣')
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.ok(!r.axes_present.includes('shoulder'), '没量肩宽就不该有肩线这一维')
  for (const a of r.axes) {
    assert.ok(a.score >= 0 && a.score <= 1, `单轴分越界：${a.key}=${a.score}`)
  }
})

// ============================================================
// 6. 离散标签不参与打分（08 §9.2 的落地证据）
// ============================================================

test('topFitBody: 改 body_type / kibbe_type / frame_size / 色彩季型，分数一字不变', () => {
  const base = score(JIA, '收腰短款针织衫')
  for (const label of [
    { body_type: '沙漏型' },
    { body_type: '苹果型', body_shape: '苹果型' },
    { kibbe_type: 'SN', frame_size: '大气', line_quality: '偏曲线' },
    { color_season: '夏型', color_season_12: '冷夏' },
  ]) {
    const r = score({ ...JIA, ...label }, '收腰短款针织衫')
    assert.strictEqual(r.score, base.score, `离散标签 ${JSON.stringify(label)} 进了公式`)
  }
})

// ============================================================
// 7. 衣柜真字段优先于文本词典
// ============================================================

test('describeTop: 版型/厚薄两格填了就用真字段，没填才退回词典', () => {
  const byField = describeTop({ name: '针织衫', fit_style: '宽松', fabric_weight: '厚' })
  assert.strictEqual(byField.ease, 9, '宽松档应对应大松量代理值')
  assert.ok(byField.signals.some((s) => s.startsWith('版型=宽松')))
  const byText = describeTop({ name: '宽松针织衫' })
  assert.strictEqual(byText.ease, 9)
  assert.ok(byText.signals.some((s) => s.startsWith('文本认版型')))
  const none = describeTop({ name: '针织衫' })
  assert.strictEqual(none.ease, null, '两格都没填也没词典线索 ⇒ 这一维不许有值')
})

test('describeTop: 颜色认得出色名/hex 才给体量方向，认不出就是 null', () => {
  assert.ok(describeTop({ name: '上衣', color: '#111111' }).volume < 0, '近黑应判成"收"')
  assert.ok(describeTop({ name: '上衣', color: '白色' }).volume > 0, '白应判成"胀"')
  assert.strictEqual(describeTop({ name: '上衣', color: '未知' }).volume, null, '"未知"不是颜色')
})

// ============================================================
// 8. 排序输出
// ============================================================

test('rankTopsByBody: 分数降序、认不出来的进 unscored 并写明原因', () => {
  const tops = [
    { id: 1, name: '宽松廓形针织开衫', category: 'top', fit_style: '宽松', fabric_weight: '中' },
    { id: 2, name: '收腰衬衫', category: 'top', fit_style: '合体', color: '藏蓝' },
    { id: 3, name: '一件什么都没说清的上衣', category: 'top' },
  ]
  const out = rankTopsByBody(YI, tops)
  assert.ok(out.ranked.length >= 2)
  assert.strictEqual(out.unscored, tops.length - out.ranked.length)
  for (let i = 1; i < out.ranked.length; i++) {
    assert.ok(out.ranked[i - 1].score >= out.ranked[i].score, '没按分数降序')
  }
  assert.ok(out.person_deviation.want.waist < 0, '乙的腰线平 ⇒ 偏差向量应想收')
  assert.ok(out.ranked.every((r) => r.axes.length === r.axes_present.length))
})

test('rankTopsByBody: 空衣柜返回空表不报错', () => {
  const out = rankTopsByBody(JIA, [])
  assert.deepStrictEqual(out.ranked, [])
  assert.strictEqual(out.unscored, 0)
})

test('isTopCategory: 认活库里真实存在的中文品类，也认英文键；下装/鞋不算上衣', () => {
  // 现量 10-09：user_wardrobe.category 存的是中文自由标签（'衬衫'/'开衫'/'外套'/'裤子'/'未分类'）
  // ⇒ 判定只按英文键写死会一条不中，这条锁住中文口径
  ;['衬衫', '开衫', '外套', '西装', '卫衣', 'T恤', '针织衫', '毛衣', '风衣', '夹克', '大衣'].forEach((c) =>
    assert.ok(isTopCategory(c), `中文品类该认出来: ${c}`),
  )
  ;['top', 'outerwear', 'Top', 'OUTERWEAR'].forEach((c) =>
    assert.ok(isTopCategory(c), `英文键该认出来: ${c}`),
  )
  ;['裤子', '半身裙', '连衣裙', '鞋子', '未分类', '', null, undefined].forEach((c) =>
    assert.ok(!isTopCategory(c), `不是上衣: ${c}`),
  )
})
