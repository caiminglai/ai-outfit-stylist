/**
 * 八字五行推算
 *
 * 分两层：
 *   排盘（四柱/藏干/节气定月柱）用 vendor 的 lunar，它不含任何吉凶判定；
 *   五行力量 → 日主强弱 → 喜用/忌神 这一段传统上各家不一，没有任何库给结论
 *   （lunar 源码里"用神""旺衰""身强"关键词命中 0 次），所以本文件自写。
 *
 * 口径（写成注释是为了报告页被追问时能自证）：
 *   1. 力量 = 天干权重 + 地支按藏干拆分权重；月支加倍（月令为纲）。
 *   2. 以日主为轴把其余四行折成 生我/同我/我生/我克/克我 五组，
 *      同我+生我 为帮扶、其余为克泄耗，比值为强弱。
 *   3. 身强取"克泄耗里最弱的两种"为喜用（抑其有余），身弱取"生我/同我"为喜用（扶其不足），
 *      中和则全局补最弱。忌神取对立面里最强的一行。
 *      ——不是民间"缺什么补什么"，缺的那行若是忌神就不该补。
 *   4. 调候：亥子丑月加火、巳午未月加水；若该行正落在忌神上则不加（宁可不调候，不自相矛盾）。
 *      喜用只留两个 ⇒ 调候那一行是**替换**掉原第 2 位（summary 里会写明是哪一行让位）。
 *
 * 时辰按用户选的时辰档取时段中点，不做经度真太阳时校正；子时按早子时（00:30）算，
 * 不处理 23:00 后晚子时换日那一派；时辰选"不清楚"只用年月日三柱推，precision 标"三柱"。
 */

const { Solar } = require('../vendor/lunar/lunar.js')
const { beijingParts } = require('../utils/beijingTime')

const ELEMENTS = ['木', '火', '土', '金', '水']

const GAN_ELEMENT = {
  甲: '木',
  乙: '木',
  丙: '火',
  丁: '火',
  戊: '土',
  己: '土',
  庚: '金',
  辛: '金',
  壬: '水',
  癸: '水',
}

const ZHI_ELEMENT = {
  子: '水',
  丑: '土',
  寅: '木',
  卯: '木',
  辰: '土',
  巳: '火',
  午: '火',
  未: '土',
  申: '金',
  酉: '金',
  戌: '土',
  亥: '水',
}

/** 相生：木生火、火生土、土生金、金生水、水生木 */
const GENERATES = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
/** 相克：木克土、土克水、水克火、火克金、金克木 */
const OVERCOMES = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

/** 时辰档 → 时段中点小时。"不清楚"用 12:30（正午前后，日柱不受时辰影响） */
const SHICHEN = {
  子: 0,
  丑: 2,
  寅: 4,
  卯: 6,
  辰: 8,
  巳: 10,
  午: 12,
  未: 14,
  申: 16,
  酉: 18,
  戌: 20,
  亥: 22,
}
const SHICHEN_LABELS = [...Object.keys(SHICHEN).map((z) => `${z}时`), '不清楚']

/** 每柱位置权重：月令为纲所以月支加倍，日支坐支次之 */
const STEM_WEIGHT = { year: 1.0, month: 1.2, day: 1.0, time: 1.0 }
const BRANCH_WEIGHT = { year: 1.0, month: 2.0, day: 1.2, time: 1.0 }
/** 藏干按本气/中气/余气分摊本柱地支的力量 */
const HIDDEN_FRACTION = { 1: [1], 2: [0.7, 0.3], 3: [0.6, 0.3, 0.1] }

const ELEMENT_STYLE = {
  木: { color: '绿色系', material: '棉麻、木质饰品', direction: '东' },
  火: { color: '红橙色系', material: '皮革、树脂饰品', direction: '南' },
  土: { color: '黄棕米色系', material: '羊毛、陶瓷饰品', direction: '东北/西南' },
  金: { color: '白金银灰色系', material: '金属、镜面饰品', direction: '西' },
  水: { color: '黑蓝色系', material: '丝绸、玻璃饰品', direction: '北' },
}

/** a 是否生 b */
const isGenerate = (a, b) => GENERATES[a] === b
/** a 是否克 b */
const isOvercome = (a, b) => OVERCOMES[a] === b

/**
 * 相对日主的十神分组（只按五行，不分阴阳）
 * @returns {'比劫'|'印'|'食伤'|'财'|'官杀'}
 */
function relationOf(day, x) {
  if (x === day) return '比劫'
  if (isGenerate(x, day)) return '印'
  if (isGenerate(day, x)) return '食伤'
  if (isOvercome(day, x)) return '财'
  return '官杀'
}

/** 解析并校验出生日期；不合格返回 null */
function parseBirthDate(raw) {
  const s = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  if (y < 1900 || y > 2100) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  if (dt.getTime() > Date.now()) return null
  return { y, m, d }
}

/** 时辰档 → { hour, known } */
function parseBirthHour(raw) {
  const s = String(raw || '').trim()
  if (!s) return { hour: 12, known: false }
  if (s === '不清楚') return { hour: 12, known: false }
  const label = s.endsWith('时') ? s : `${s}时`
  const zhi = label.charAt(0)
  if (SHICHEN[zhi] === undefined) return { hour: 12, known: false }
  return { hour: SHICHEN[zhi], known: true }
}

/**
 * 五行力量分布
 * @param {Array<{gan:string, hideGan:string[], pos:'year'|'month'|'day'|'time'}} pillars
 */
function scoreElements(pillars) {
  const score = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  for (const p of pillars) {
    score[GAN_ELEMENT[p.gan]] += STEM_WEIGHT[p.pos]
    const fr = HIDDEN_FRACTION[p.hideGan.length] || HIDDEN_FRACTION[1]
    p.hideGan.forEach((g, i) => {
      score[GAN_ELEMENT[g]] += BRANCH_WEIGHT[p.pos] * (fr[i] || fr[fr.length - 1])
    })
  }
  return score
}

/** 四柱数组 → 报告页与人话摘要都从这里取 */
function pickPillars(ec, known) {
  return [
    {
      pos: 'year',
      pillar: ec.getYear(),
      gan: ec.getYearGan(),
      zhi: ec.getYearZhi(),
      hideGan: ec.getYearHideGan(),
    },
    {
      pos: 'month',
      pillar: ec.getMonth(),
      gan: ec.getMonthGan(),
      zhi: ec.getMonthZhi(),
      hideGan: ec.getMonthHideGan(),
    },
    {
      pos: 'day',
      pillar: ec.getDay(),
      gan: ec.getDayGan(),
      zhi: ec.getDayZhi(),
      hideGan: ec.getDayHideGan(),
    },
    known
      ? {
          pos: 'time',
          pillar: ec.getTime(),
          gan: ec.getTimeGan(),
          zhi: ec.getTimeZhi(),
          hideGan: ec.getTimeHideGan(),
        }
      : null,
  ].filter(Boolean)
}

/**
 * 主函数：由出生日期 + 时辰档推出日主、强弱、喜用、忌神
 * @param {string} birthDate 'YYYY-MM-DD'
 * @param {string} birthHour '子时'…'亥时' | '不清楚'
 * @returns {object|null} 日期不合格返回 null
 */
function analyzeBazi(birthDate, birthHour) {
  const bd = parseBirthDate(birthDate)
  if (!bd) return null
  const { hour, known } = parseBirthHour(birthHour)

  const ec = Solar.fromYmdHms(bd.y, bd.m, bd.d, hour, 30, 0).getLunar().getEightChar()
  const pillars = pickPillars(ec, known)
  const scores = scoreElements(pillars)

  const dayMaster = ec.getDayGan()
  const day = GAN_ELEMENT[dayMaster]
  const rel = {}
  for (const e of ELEMENTS) rel[e] = relationOf(day, e)

  const groupSum = (names) =>
    ELEMENTS.filter((e) => names.includes(rel[e])).reduce((s, e) => s + scores[e], 0)
  const support = groupSum(['比劫', '印'])
  const drain = groupSum(['食伤', '财', '官杀'])
  const total = support + drain
  if (total <= 0) return null

  // 月支主气落帮扶组 = 得令，比值上再抬一点。
  // 抬完的这个数才是判定依据：下面 strength_ratio 与文案里的百分比必须都用它。
  // 原来判定用 decisionRatio、返回与文案用 support/total ⇒ 帮扶占 49~50% 时
  // 结论写"身强"、旁边括号里却打着"帮扶占 49%"，同一句话自己跟自己对不上（2026-10-12 改）。
  const monthMainElem = GAN_ELEMENT[ec.getMonthHideGan()[0]] || ZHI_ELEMENT[ec.getMonthZhi()]
  const monthRel = relationOf(day, monthMainElem)
  const supportRatio = support / total
  const deLing = monthRel === '比劫' || monthRel === '印'
  const decisionRatio = supportRatio + (deLing ? 0.06 : 0)

  const strength = decisionRatio >= 0.56 ? '身强' : decisionRatio <= 0.44 ? '身弱' : '中和'

  const pickLowest = (pool, n) =>
    [...pool]
      .sort((a, b) => scores[a] - scores[b] || ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b))
      .slice(0, n)
  const pickHighest = (pool) =>
    [...pool].sort((a, b) => scores[b] - scores[a] || ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b))[0]

  const helpPool = ELEMENTS.filter((e) => ['比劫', '印'].includes(rel[e]))
  const drainPool = ELEMENTS.filter((e) => ['食伤', '财', '官杀'].includes(rel[e]))

  let favorable
  let unfavorable
  if (strength === '身强') {
    favorable = pickLowest(drainPool, 2)
    unfavorable = pickHighest(helpPool)
  } else if (strength === '身弱') {
    favorable = pickLowest(helpPool, 2)
    unfavorable = pickHighest(drainPool)
  } else {
    favorable = pickLowest(
      ELEMENTS.filter((e) => e !== day),
      2,
    )
    unfavorable = pickHighest(ELEMENTS)
  }
  // 中和档力量并列时忌神可能和喜用撞同一行，那样引擎会同时命中"宜"和"忌"，必须消歧
  if (favorable.includes(unfavorable)) {
    unfavorable =
      pickHighest(
        ELEMENTS.filter(
          (e) => !favorable.includes(e) && (strength === '中和' || rel[e] !== '比劫'),
        ),
      ) || day
  }

  // 调候：冬月取暖、夏月取水。撞上忌神就不调，避免自相矛盾
  const monthZhi = ec.getMonthZhi()
  // 用数组精确匹配，不用 `'亥子丑'.includes(monthZhi)`：字符串版对空串恒为 true
  // （`'亥子丑'.includes('')` === true），月支一旦取不到值就被当成冬月硬加一条"取火调候"，
  // 而这条会直接改写喜用列表。数组 includes 对 '' 回 false，缺值就是不判。
  const seasonal = ['亥', '子', '丑'].includes(monthZhi)
    ? '火'
    : ['巳', '午', '未'].includes(monthZhi)
      ? '水'
      : null
  let seasonalApplied = false
  let seasonalReplaced = null
  if (seasonal && seasonal !== unfavorable && !favorable.includes(seasonal)) {
    seasonalReplaced = favorable[1]
    favorable = [favorable[0], seasonal]
    seasonalApplied = true
  }

  const missing = ELEMENTS.filter((e) => scores[e] === 0)
  const strongest = pickHighest(ELEMENTS)

  const summary =
    `日主${dayMaster}${day}，生于${ec.getMonthZhi()}月。` +
    `五行力量 ${ELEMENTS.map((e) => `${e}${Math.round(scores[e])}`).join('、')}，` +
    `${strength}（帮扶占 ${Math.round(decisionRatio * 100)}%${deLing ? '，含得令加权' : ''}）` +
    `${seasonalApplied ? `，${seasonal === '火' ? '冬月取火' : '夏月取水'}调候（${seasonalReplaced}让位）` : ''}。` +
    `喜用${favorable.join('、')}，忌${unfavorable}。`

  return {
    birthDate: `${bd.y}-${String(bd.m).padStart(2, '0')}-${String(bd.d).padStart(2, '0')}`,
    birthHour: known ? (String(birthHour).endsWith('时') ? birthHour : `${birthHour}时`) : '不清楚',
    precision: known ? '四柱' : '三柱',
    pillars: pillars.map((p) => p.pillar),
    day_master: dayMaster,
    day_master_element: day,
    strength,
    strength_ratio: Number(decisionRatio.toFixed(3)),
    month_zhi: monthZhi,
    seasonal,
    seasonal_applied: seasonalApplied,
    scores: Object.fromEntries(ELEMENTS.map((e) => [e, Number(scores[e].toFixed(2))])),
    missing,
    strongest,
    favorable,
    unfavorable,
    // 引擎条件用的三个标量字段（in/eq 只能比单值，所以喜用只取主气那一行）
    favorable_element: favorable[0],
    unfavorable_element: unfavorable,
    favorable_direction: favorable.map((e) => ELEMENT_STYLE[e].direction).join('、'),
    favorable_colors: favorable.map((e) => ELEMENT_STYLE[e].color).join('、'),
    summary,
  }
}

/**
 * 当日干支与个人喜用的关系（日期依据）
 * 同一个人在不同日子得到不同强度的建议，靠的就是这一段
 *
 * 日期一律按东八区拆（`utils/beijingTime.js` 的头注释里写了为什么）：容器没设 TZ，
 * 实测读出来是 UTC ⇒ 原来这三行 `getFullYear/getMonth/getDate` 在北京 00:00~07:59
 * 会取到**前一天**，日柱、干支、节气整段跟着错，而同一页面里的星座运势走的是
 * `beijingDateStr()`，两处口径对不上（2026-10-12 修）。
 */
function analyzeDay(analysis, date = new Date()) {
  const bj = beijingParts(date)
  const y = Number(bj.year)
  const m = Number(bj.month)
  const d = Number(bj.day)
  const ec = Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getEightChar()
  const dayElem = GAN_ELEMENT[ec.getDayGan()]
  const out = {
    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    ganzhi: ec.getDay(),
    element: dayElem,
    branch: ec.getDayZhi(),
    term: Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getPrevJieQi(true).getName(),
  }
  if (!analysis) {
    out.tone = '平'
    out.note = `今日${out.ganzhi}（${out.element}）。填了出生日期后可按你的喜用五行调整当日建议。`
    return out
  }
  const fav = analysis.favorable
  const un = analysis.unfavorable
  let tone
  let reason
  // 忌神这条必须排在"生喜用"前面：忌神常常正是喜用的母气（喜木火 ⇒ 忌水，而水生木），
  // 排在后面时同一天既被档案写"忌水"又被当日建议写"顺"。
  // 300 个生日 × 60 天 = 18000 组实测，这种自相矛盾占 1488 组（8.27%）。
  if (fav.includes(dayElem)) {
    tone = '顺'
    reason = '与你的喜用同气'
  } else if (dayElem === un) {
    tone = '忌'
    reason = '正是你的忌神'
  } else if (fav.some((f) => isGenerate(dayElem, f))) {
    // isGenerate(a, b) ＝ a 生 b，这里是"今日五行去生喜用"，不是"喜用生它"
    tone = '顺'
    reason = '生你的喜用，助喜用'
  } else if (fav.some((f) => isOvercome(dayElem, f))) {
    tone = '忌'
    reason = '克制你的喜用'
  } else {
    tone = '平'
    reason = '与你喜用无直接生克'
  }
  out.tone = tone
  out.reason = reason
  out.colors = tone === '顺' ? analysis.favorable_colors : ELEMENT_STYLE[dayElem].color
  out.note = `今日${out.ganzhi}（${dayElem}），${reason}，宜${out.colors}。`
  return out
}

module.exports = {
  ELEMENTS,
  ELEMENT_STYLE,
  GAN_ELEMENT,
  ZHI_ELEMENT,
  SHICHEN_LABELS,
  relationOf,
  analyzeBazi,
  analyzeDay,
  parseBirthDate,
}
