/**
 * 生日派生层：周岁／年龄段＋八字五行（11-03 从 profileEnricher.js 拆出，行为不变；原文 :790-850）。
 *
 * 职责：由 `birth_date`（和 `birth_hour`）算出规则条件要用的 age／age_range 与
 * day_master_element／favorable_element／unfavorable_element，外加报告页展示的 bazi／bazi_today。
 *
 * 这一段单独立一个文件有两个原因，都写在原注释里、别当装饰看：
 *  1. 它是**第二条判定依据**（风水八字＋日期），与体型/色彩那批"人体测量"依据不同源，
 *     档位诚实的措辞也不同（`services/evidenceLevels.js` 的 D 档）；
 *  2. "今天""周岁"必须按**北京时间**判，而容器实测 TZ 是 UTC——这条口径与
 *     `utils/beijingTime.js` 同属一处，散在主入口里迟早被人改回 `new Date()`。
 *
 * 共同纪律：填了才算，没填或填错就返回空对象。宁可不给这条依据，
 * ⛔ 也不许往 profile 里塞 undefined——引擎是严格 AND，多一个空字段就多一批永远命中不了的规则。
 */
const { analyzeBazi, analyzeDay, parseBirthDate } = require('../baziWuxing')
const { beijingParts } = require('../../utils/beijingTime')

// ============================================================
// 8.6. 八字五行（第二条判定依据：风水八字 + 日期）
// ============================================================

/** 年龄段档位，和规则里 age_range 条件用的是同一套值 */
const AGE_BANDS = [
  [18, 25, '18-25'],
  [26, 35, '26-35'],
  [36, 45, '36-45'],
  [46, 120, '46+'],
]

/**
 * 由出生日期算周岁与年龄段
 * 拿 age_range 当条件的规则有 12 条，生日一填就不必再让人点一遍年龄段；
 * 生日没填时返回空对象，表单上那份手选的 age_range 照常生效。
 * @param {string} birthDate 'YYYY-MM-DD'
 * @returns {object} { age, age_range? }
 */
function deriveAgeFields(birthDate) {
  const b = parseBirthDate(birthDate)
  if (!b) return {}
  // 生日"到没到"必须按北京时间判：容器实测 TZ 是 UTC，用 new Date() 的本地月/日
  // 在北京时间 00:00–07:59 这一档读到的还是"昨天"⇒ 当天过生日的人整档算小一岁
  // （25 岁当天被归进 18-25 带，26 岁档的规则一条不命中）。这里只取年月日三个
  // 数字，不碰时分，与 utils/beijingTime.js 同一口径。
  const now = beijingParts()
  const nowYear = Number(now.year)
  const nowMonth = Number(now.month)
  const nowDay = Number(now.day)
  let age = nowYear - b.y
  const reached = nowMonth > b.m || (nowMonth === b.m && nowDay >= b.d)
  if (!reached) age -= 1
  const out = { age }
  const band = AGE_BANDS.find(([lo, hi]) => age >= lo && age <= hi)
  if (band) out.age_range = band[2]
  return out
}

/**
 * 由出生日期与时辰档派生五行字段
 * 没填或填错返回空对象——宁可不给这条依据，也不能往 profile 里塞 undefined，
 * 引擎是严格 AND，多一个空字段就多一批永远命中不了的规则。
 * @param {string} birthDate 'YYYY-MM-DD'
 * @param {string} birthHour '子时'…'亥时' | '不清楚'
 * @returns {object} 可 Object.assign 进 profile 的字段包
 */
function computeBaziFields(birthDate, birthHour) {
  if (!birthDate) return {}
  const a = analyzeBazi(birthDate, birthHour || '不清楚')
  if (!a) return {}
  return {
    // 规则条件用的三个标量（in/eq 只能比单值，所以喜用只取主气那一行）
    day_master_element: a.day_master_element,
    favorable_element: a.favorable_element,
    unfavorable_element: a.unfavorable_element,
    // 报告页展示用
    bazi: a,
    bazi_today: analyzeDay(a),
  }
}

module.exports = { deriveAgeFields, computeBaziFields }
