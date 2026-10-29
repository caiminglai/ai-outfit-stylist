/**
 * 八字五行推算测试（纯函数，不连数据库）
 *
 * 防四件事：
 *   1. 排盘错 —— 日柱拿独立儒略日公式交叉对，对不上就是整盘皆错
 *   2. 节气/立春边界错 —— 月柱年柱换柱那两天最容易错
 *   3. 喜忌自相矛盾 —— 同一行既当喜用又当忌神，引擎会同时命中"宜"和"忌"
 *   4. 文案漏英文 —— 全站中文化的口径，算出的摘要也必须纯中文
 *
 * 运行: node --test test/baziWuxing.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const { Solar } = require('../vendor/lunar/lunar.js')
const {
  ELEMENTS,
  ELEMENT_STYLE,
  GAN_ELEMENT,
  SHICHEN_LABELS,
  analyzeBazi,
  analyzeDay,
  relationOf,
} = require('../services/baziWuxing')

const GANS = '甲乙丙丁戊己庚辛壬癸'
const ZHIS = '子丑寅卯辰巳午未申酉戌亥'

/** 独立算法：儒略日序数 mod 60 推日柱，与 lunar 无任何共享代码 */
function dayGanzhi(y, m, d) {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  const jdn =
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  const idx = (jdn + 49) % 60
  return GANS[idx % 10] + ZHIS[idx % 12]
}

test('日柱与独立儒略日公式交叉对：跨世纪 6 档全等', () => {
  const cases = [
    [1899, 12, 31],
    [1949, 10, 1],
    [1992, 3, 14],
    [2000, 1, 1],
    [2026, 9, 28],
    [2100, 12, 31],
  ]
  let diff = 0
  for (const [y, m, d] of cases) {
    const mine = dayGanzhi(y, m, d)
    const lib = Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getEightChar().getDay()
    if (mine !== lib) diff++
    assert.strictEqual(lib, mine, `${y}-${m}-${d} 库=${lib} 独立算=${mine}`)
  }
  assert.strictEqual(diff, 0, '日柱 DIFF-COUNT 必须为 0')
})

test('立春定年柱、节气定月柱', () => {
  // 2026 年立春在 2 月 4 日：前一天仍属乙巳年，后一天起算丙午年庚寅月
  const before = analyzeBazi('2026-02-03', '午时')
  const after = analyzeBazi('2026-02-05', '午时')
  assert.strictEqual(before.pillars[0], '乙巳')
  assert.strictEqual(before.pillars[1], '己丑')
  assert.strictEqual(after.pillars[0], '丙午')
  assert.strictEqual(after.pillars[1], '庚寅')
})

test('非法出生日期一律返回 null', () => {
  for (const bad of [
    '',
    '1992-3-14',
    '1992/03/14',
    '1899-01-01',
    '2101-01-01',
    '1992-13-01',
    '1992-02-30',
  ]) {
    assert.strictEqual(analyzeBazi(bad, '午时'), null, `${bad} 应当判为非法`)
  }
  assert.strictEqual(analyzeBazi('2099-01-01', '午时'), null, '未来日期应当判为非法')
})

test('时辰档位：不清楚 → 三柱，只出年月日', () => {
  assert.strictEqual(SHICHEN_LABELS.length, 13, '12 时辰 + 不清楚')
  const four = analyzeBazi('1992-03-14', '巳时')
  const three = analyzeBazi('1992-03-14', '不清楚')
  assert.strictEqual(four.precision, '四柱')
  assert.strictEqual(four.pillars.length, 4)
  assert.strictEqual(three.precision, '三柱')
  assert.strictEqual(three.pillars.length, 3)
  // 日柱不随时辰档变，其余三柱同
  assert.strictEqual(three.pillars.join(''), four.pillars.slice(0, 3).join(''))
  assert.strictEqual(three.birthHour, '不清楚')
})

test('200 个日期扫描：喜用两行不重复、忌神不与喜用同行、五行标量必在合法档位内', () => {
  const seen = { 身强: 0, 身弱: 0, 中和: 0 }
  const hitFavorable = new Set()
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(1940, 0, 1) + i * 31 * 86400000)
    const iso = d.toISOString().slice(0, 10)
    const hour = SHICHEN_LABELS[i % 13]
    const a = analyzeBazi(iso, hour)
    assert.ok(a, `${iso} 应当算得出`)
    assert.strictEqual(a.favorable.length, 2, `${iso} 喜用应为两行`)
    assert.strictEqual(new Set(a.favorable).size, 2, `${iso} 喜用两行重复`)
    assert.ok(ELEMENTS.includes(a.favorable_element), `${iso} 喜用标量非法值`)
    assert.ok(ELEMENTS.includes(a.unfavorable_element), `${iso} 忌神标量非法值`)
    assert.ok(!a.favorable.includes(a.unfavorable_element), `${iso} 忌神撞进喜用`)
    assert.strictEqual(a.day_master_element, GAN_ELEMENT[a.day_master])
    // 口径不变量：身强抑有余(主气喜用取克泄耗、忌取帮扶)，身弱扶不足(反过来的)
    // 第二行允许是调候补进来的火/水，它天然在帮扶/克泄耗之外
    const mainFavRel = relationOf(a.day_master_element, a.favorable_element)
    const unRel = relationOf(a.day_master_element, a.unfavorable_element)
    if (a.strength === '身强') {
      assert.ok(['食伤', '财', '官杀'].includes(mainFavRel), `${iso} 身强主气喜用不在克泄耗内`)
      assert.ok(['比劫', '印'].includes(unRel), `${iso} 身强忌神不在帮扶内`)
    } else if (a.strength === '身弱') {
      assert.ok(['比劫', '印'].includes(mainFavRel), `${iso} 身弱主气喜用不在帮扶内`)
      assert.ok(['食伤', '财', '官杀'].includes(unRel), `${iso} 身弱忌神不在克泄耗内`)
    }
    // 每一行喜用：身强取克泄耗、身弱取帮扶、中和取除日主本行外的任意行；调候字例外
    const inPool = (e) => {
      const r = relationOf(a.day_master_element, e)
      if (a.strength === '身强') return ['食伤', '财', '官杀'].includes(r)
      if (a.strength === '身弱') return ['比劫', '印'].includes(r)
      return e !== a.day_master_element
    }
    assert.ok(
      a.favorable.every((e) => inPool(e) || e === a.seasonal),
      `${iso} 喜用${a.favorable.join('')}不合${a.strength}档口径`,
    )
    assert.ok(ELEMENTS.every((e) => Number.isFinite(a.scores[e]) && a.scores[e] >= 0))
    assert.ok(ELEMENT_STYLE[a.favorable_element].color)
    seen[a.strength]++
    hitFavorable.add(a.favorable_element)
  }
  assert.ok(seen['身强'] > 0 && seen['身弱'] > 0 && seen['中和'] > 0, '强弱三档都该出现')
  assert.strictEqual(
    hitFavorable.size,
    5,
    '五行都应有机会成为喜用，否则五行规则会有一档永远命中不了',
  )
})

test('调候：冬月取火、夏月取水，撞上忌神则不强调', () => {
  const winter = []
  const summer = []
  for (let y = 1950; y <= 2020; y++) {
    winter.push(analyzeBazi(`${y}-12-20`, '卯时'))
    summer.push(analyzeBazi(`${y}-06-21`, '酉时'))
  }
  for (const a of winter) {
    assert.strictEqual(a.seasonal, '火')
    // 三种正当收口：调候补进来了 / 火正落忌神(故意不调) / 喜用本就含火(无需再调)
    assert.ok(
      a.seasonal_applied || a.unfavorable === '火' || a.favorable.includes('火'),
      `${a.birthDate} 冬月调候未收口`,
    )
  }
  for (const a of summer) {
    assert.strictEqual(a.seasonal, '水')
    assert.ok(
      a.seasonal_applied || a.unfavorable === '水' || a.favorable.includes('水'),
      `${a.birthDate} 夏月调候未收口`,
    )
  }
  const cnt = { 火: 0, 水: 0 }
  for (const a of [...winter, ...summer]) {
    if (a.seasonal_applied) {
      cnt[a.seasonal]++
      // 闸门生效的证据：真调候的样本里，忌神绝不可能是那个调候字
      assert.notStrictEqual(a.unfavorable, a.seasonal, `${a.birthDate} 忌神与调候字撞车`)
      assert.ok(a.favorable.includes(a.seasonal), `${a.birthDate} 调候字没进喜用`)
    }
  }
  assert.ok(cnt['火'] > 0, '冬月调候一次都没生效 = 这段是死码')
  assert.ok(cnt['水'] > 0, '夏月调候一次都没生效 = 这段是死码')
})

test('摘要纯中文：不含任何 ASCII 字母', () => {
  for (const [d, h] of [
    ['1992-03-14', '巳时'],
    ['2000-01-01', '不清楚'],
    ['1968-07-20', '子时'],
  ]) {
    const a = analyzeBazi(d, h)
    assert.match(a.summary, /日主./)
    assert.ok(!/[A-Za-z]/.test(a.summary), `摘要漏英文: ${a.summary}`)
  }
})

test('当日干支与喜用的关系：三档口径、无喜用时降级', () => {
  const a = analyzeBazi('1992-03-14', '巳时')
  const today = analyzeDay(a, new Date(2026, 8, 28))
  assert.strictEqual(today.ganzhi, '乙巳')
  assert.strictEqual(today.element, '木')
  assert.ok(['顺', '平', '忌'].includes(today.tone), `tone 非法: ${today.tone}`)
  assert.ok(!/[A-Za-z]/.test(today.note), `当日文案漏英文: ${today.note}`)
  const plain = analyzeDay(null, new Date(2026, 8, 28))
  assert.strictEqual(plain.tone, '平')
  assert.ok(plain.note.includes('填了出生日期'))
})

// 判定用的比值和返回/文案用的比值必须是同一个数（2026-10-12 补）。
// 原来判定加了"月支得令 +0.06"，而 strength_ratio 与 summary 里的百分比打的都是未加权的
// support/total ⇒ 帮扶 49~50% 且得令时，结论写"身强"、括号里却写"帮扶占 49%"，
// 顾客看到的是一句自相矛盾的话，排查的人还以为是四舍五入。
test('身强弱档位与 strength_ratio、summary 文案同源', () => {
  let checkedDeLing = 0
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(1940, 0, 1) + i * 31 * 86400000)
    const iso = d.toISOString().slice(0, 10)
    const a = analyzeBazi(iso, SHICHEN_LABELS[i % 13])
    assert.ok(a, `${iso} 应当算得出`)
    const r = a.strength_ratio
    // strength_ratio 是判定那个数保留 3 位的结果 ⇒ 档位只能按 ±0.0005 的截断容差反推，
    // 边界上（真值 0.4401 被截成 0.44）不允许判成"不同源"
    const EPS = 0.0005
    const bandOk =
      (a.strength === '身强' && r >= 0.56 - EPS) ||
      (a.strength === '身弱' && r <= 0.44 + EPS) ||
      (a.strength === '中和' && r >= 0.44 - EPS && r <= 0.56 + EPS)
    assert.ok(bandOk, `${iso} 档位 ${a.strength} 与 strength_ratio=${r} 不同源`)
    // 文案里的百分比就是从同一个数打出来的：strength_ratio 留 3 位、文案取整到百分点，
    // 所以只允许差半个百分点（0.005）＋三位截断（0.0005）
    const m = a.summary.match(/帮扶占 (\d+)%/)
    assert.ok(m, `${iso} summary 里找不到帮扶占比：${a.summary}`)
    assert.ok(
      Math.abs(Number(m[1]) / 100 - r) <= 0.006,
      `${iso} 文案「帮扶占 ${m[1]}%」与 strength_ratio=${r} 不同源`,
    )
    if (a.summary.includes('含得令加权')) checkedDeLing++
  }
  assert.ok(checkedDeLing > 0, '200 个日期里一次都没出现得令加权，这条测试等于没跑')
})
