/**
 * 文字版报告的"三层顺序"验收（docs/依据/09 §5：文字报告与处方卡同顺序，颜色段挪到最后）
 * ============================================================
 * 这个函数原先长在 routes/recommend.js 里，require 它会连库并起定时器，测试没法碰；
 * 10-09 原样搬到 services/recommendReportText.js 后才有这份断言。
 * 断言的是**段序与诚实口径**，不是文案好不好看。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { generateStructuredText } = require('../services/recommendReportText')
const { buildRecommendation } = require('../services/recommendEngine')

const 全身 = {
  gender: '女',
  height: 165,
  weight: 62,
  bust: 92,
  waist: 84,
  hip: 98,
  shoulder: 39,
  leg_length: 88,
  skin_tone: '白皙',
  scenario: '通勤',
}
const report = (p) =>
  generateStructuredText(buildRecommendation(p, 'personal', false), null, 'personal')

test('报告里三段的先后顺序＝合身 → 修形 → 颜色', () => {
  const t = report(全身)
  const i0 = t.indexOf('### 第 0 层 · 合身')
  const i1 = t.indexOf('### 第 1 层 · 修形')
  const i2 = t.indexOf('### 第 2 层 · 颜色')
  assert.ok(i0 > 0 && i1 > 0 && i2 > 0, `三段标题都要在：${i0}/${i1}/${i2}`)
  assert.ok(i0 < i1 && i1 < i2, `段序错了：合身 ${i0} / 修形 ${i1} / 颜色 ${i2}`)
})

test('合身段出号型与四道判据，判不了的两道要点名缺哪个字段', () => {
  const t = report(全身)
  const seg = t.slice(t.indexOf('### 第 0 层'), t.indexOf('### 第 1 层'))
  assert.match(seg, /号型\*\*: 165\/92/)
  assert.match(seg, /成衣胸围该到\*\*: 94~99cm/)
  assert.match(seg, /正肩_cm 37\.5~40\.5/)
  assert.equal((seg.match(/〔判不了〕/g) || []).length, 2, '衣长与袖长两道都该标判不了')
  assert.match(seg, /腰节长/)
  assert.match(seg, /袖长／袖笼/)
  assert.ok(!seg.includes('不合格'), '没有成衣实测通道，报告里就不许出现"你这件不合格"')
})

test('没量净胸围 ⇒ 合身段只出"先量身体"与测量指引，不许出号型', () => {
  const t = report({ ...全身, bust: undefined })
  const seg = t.slice(t.indexOf('### 第 0 层'), t.indexOf('### 第 1 层'))
  assert.match(seg, /这一层判不了/)
  assert.match(seg, /净胸围没量/)
  assert.match(seg, /怎么量/)
  assert.match(seg, /呼气末/, '测量指引要真给方法，不是"建议咨询专业人士"')
  assert.ok(!/号型\*\*:/.test(seg), `缺测还出号型就是编：${seg.slice(0, 200)}`)
  assert.ok(t.indexOf('### 第 1 层') > 0, '合身判不了不影响修形段照出')
})

test('报告里的国标口径：现行说现行，逐字核对说逐字核对（旧"需购文本复核"已过期）', () => {
  const seg = report(全身)
  assert.match(seg, /GB\/T 1335/)
  assert.match(seg, /逐字核对/)
  assert.ok(!/需购/.test(seg), '本机 PDF 已逐字核对，报告不许再挂"需购文本复核"')
  assert.match(seg, /GB\/T 16160-2017/)
  assert.match(seg, /腰际线/)
  assert.match(seg, /GB\/T 5703-2023/)
  assert.match(seg, /不含好不好看的判据|号型只管尺寸分档/)
})

test('报告里 BMI 那条轴要出现，并带实施日期与"另一条轴"的定性', () => {
  const seg = report(全身)
  assert.match(seg, /胖瘦程度\(另一条轴/)
  assert.match(seg, /31901-2024/)
  assert.match(seg, /2026-12-01/)
  assert.match(seg, /内部口径/)
})

test('修形段与颜色段的既有内容没被搬家搬坏（档位行、肤色口径、实测数都还在）', () => {
  const t = report(全身)
  const seg1 = t.slice(t.indexOf('### 第 1 层'), t.indexOf('### 第 2 层'))
  const seg2 = t.slice(t.indexOf('### 第 2 层'))
  assert.match(seg1, /肩线宽窄/)
  assert.match(seg1, /算它用的实测数/)
  assert.match(seg1, /档位: 方向 B/)
  assert.match(seg2, /上衣颜色\*\*\(肤色口径 深浅 白皙/)
  assert.match(seg2, /档位: A 色差公式/)
  assert.match(t, /顺序是定的|可以相反/, '顶层那句"两段结论可以相反"要留在报告里')
})

// ============================================================
// 天气段与数据概览（10-12 第二十七轮）
// ============================================================

test('报告的"今日天气"段真的会出：前端送的键是 temperature/condition，不是 temp/description', () => {
  const rec = buildRecommendation(全身, 'personal', false)
  const t = generateStructuredText(
    rec,
    { temperature: 5.2, feelsLike: 2.1, condition: '阴', humidity: 71 },
    'personal',
  )
  assert.match(t, /## 今日天气/)
  assert.match(t, /气温 5\.2°C（体感 2\.1°C），阴，湿度 71%/)
})

test('天气缺项只少那一格；没送气温就整段不出（不写"天气良好"）', () => {
  const rec = buildRecommendation(全身, 'personal', false)
  const 无湿度 = generateStructuredText(rec, { temperature: 30, feelsLike: 33 }, 'personal')
  assert.match(无湿度, /气温 30°C（体感 33°C），天气状况未知/)
  assert.ok(!无湿度.includes('湿度'), '湿度没读到就不许印这一格')
  assert.ok(!无湿度.includes('天气良好'), '"天气良好"是原来那句 || 兜底编出来的')

  const 没天气 = generateStructuredText(rec, { feelsLike: 3 }, 'personal')
  assert.ok(!没天气.includes('## 今日天气'), '读不到气温就整段不出')
  assert.ok(!没天气.includes('气温 '), '假气温一行都不许出现')
})

test('数据概览：档位没算出来时不把 bmi_level/wh_status 显示成"正常"', () => {
  // computeBmi 现在量不到就返回 {}，_computed 里可能只有数字没有档位
  const t = generateStructuredText({ 上衣: [], _computed: { bmi: 22.8 } }, null, 'personal')
  assert.match(t, /^- BMI: 22\.8$/m)
  assert.ok(!t.includes('（正常）'), '档位没读到就不许写"正常"')
})
