/**
 * 智能估算：身高＋体重（年龄选填）⇒ 净胸围、净肩宽
 * ============================================================
 * 建档：2026-10-20（第五阶段·第一步）。规范本体在 `docs/依据/13-体型估算输入输出规范-20261020.md`，
 * 本文件是它的实现，两边同轮改；动这里任何一个数之前先读那份的 §五（七条边界禁令）与 §七（可复算判据）。
 *
 * 为什么要这一层（现量，不是设想）：`profileArchive.js:63-78`（🔴 10-30 按内容重指：原写 56-71，56 那行是 `/**`，数组真身 63 起 78 收） 的 `BODY_FIELDS` 里 bust（胸围）与
 * shoulder（肩宽）都是**选填**，只填身高体重的档案走到 `topFitBody.bodyDeviation()` 时
 * `person_cm` 这两格是 null ⇒ 松量轴与肩缝轴算不出 ⇒ coverage 掉分 ⇒ 排序层拿不到身体侧的算法分
 * （第四阶段改前/改后差分里档案 D 的 `in_pool=0` 就是这笔账）。这一层把这两格补上，
 * **补成"标了是估的"的数，不是补成看起来像实测的数**。
 * 🟢 2026-10-20 同轮已接线：`profileEnricher.enrichProfile` 挂 `p.body_est`（独立通道，
 *    ⛔ 不改写 `p.bust`/`p.shoulder`），`topFitBody.bodyDeviation(person, est)` 只把它补进
 *    `person_cm.bust`/`person_cm.shoulder`，顶上来的那一轴在覆盖率里按半格计。
 *
 * ⚠️ 档位诚实（对外措辞红线见 `docs/依据/05-对外措辞红线.md`）：
 *  - **锚点**＝下面八张分位表的每一个数，取自 GB/T 10000-2023 的 P1~P99，A 档·【官方原文·目视抄读】
 *    （那份 PDF 的文本层是废的：U+FFFD 28,263／CJK 0 ⇒ 2026-10-20 用 mupdf `zoom=1.5` 渲染成图后
 *    逐格目视抄；逐格读数与页码在 `13` §二，抄读记录在 `10` §1m）。
 *  - **从体重推到胸围的那条曲线**＝本站自拟的幂律，**C 档**。🔴 GB/T 10000-2023 全文**没有**任何
 *    "身高＋体重 → 胸围"的回归式或换算表，它给的是每个部位各自的人群**边缘**分布，部位之间不配对
 *    ⇒ 国标在这里只能当锚点与钳位框，给不了斜率。所以对外 ✅ 说"按我国成年人人体尺寸的人群分布估"，
 *    ⛔ 不许说"按国标测算／科学估算／AI 精准识别身材"。
 *  - 肩宽的**绝对值**锚在 10000 的「肩宽」＝GB/T 5703-2023 §6.2.7 两肩峰点**直线距离**；
 *    跟着胸围走的**档间斜率**借自 GB/T 1335 附录 B 表 B.1 的「总肩宽」分档增量（男 +1.2÷4＝0.30、
 *    女 +1.0÷4＝0.25，【官方原文·文本层逐字】，男册 PDF p10／女册 p8）。⚠️ 1335 的「总肩宽」按
 *    GB/T 16160-2017 §2.2.5 是肩峰点间**水平弧长**，与上面那个直线口径同一个人差 3~5 cm
 *    ⇒ **只借斜率，绝对值绝不互换**；这条跨标准借用是明写的取舍（`13` §三 第 2 步、`10` §2e）。
 *  - 肩宽最后再叠一层**身高相对框**（0.2105~0.2354，现算自同一批锚点里"同表同分位"的 44 个配对点，
 *    不是第三个手拍常数）⇒ 拦的是幂律在身高两端的飘移。这一框 ⛔ 不给胸围加：5703 §6.2.7 的肩宽
 *    是两肩峰点直线距离（骨骼量，随身高走），胸围吃脂肪，同档配对里胸围÷身高能跨 47%~65%。
 *    实测后果写在 `13` §三 第 3 步：整张输入网格上这一框经常咬住 ⇒ 肩宽那一维实际由身高决定，
 *    胸围项只在框内起作用。
 *
 * ⛔ 出口只有一个：这一层的数只许喂 `topFitBody.js` 的 `person_cm.bust` / `person_cm.shoulder`
 *    （合身层拿成衣实测尺寸做减法的那两个原值）。不许喂 `computeBodyShape`（体型五分类）、
 *    不许喂规则匹配（引擎是严格 AND，估算值一进 `profile.bust` 就会命中本该"没量⇒不命中"的规则）、
 *    不许进 `measure` / `want` 向量、不许在顾客端显示成"你填的胸围"。逐条见 `13` §五。
 */

// 百分位栏的固定下标：与 `13` §二 那两张表的列序一一对应（P1／P5／P10／P50／P90／P95／P99）
const P1 = 0
const P50 = 3
const P90 = 4
const P99 = 6

// 体重（kg）与身高（mm）只取 P50 当幂律的分母，其余档位留着是给 fit-check 复算残差用的
const PERCENTILE_ORDER = ['p1', 'p5', 'p10', 'p50', 'p90', 'p95', 'p99']

/**
 * GB/T 10000-2023 的分位表锚点（逐格【官方原文·目视抄读】，2026-10-20 抄）。
 * 键＝性别 → 年龄段；`weight_kg` 单位 kg，其余三行单位 mm。
 * ⛔ 表 2（男 18~25）与表 7（女 18~25）的 `shoulder_mm` 只抄到 P50，其余六档读不稳 ⇒ 记 null，
 *    这两档的肩宽钳位改用六张表的实测包络（见 ENVELOPE），并打 `clamp_from_envelope`。
 * 表 5（男 61~70）／表 10（女 61~70）**没抄** ⇒ ≥61 岁落到 36~60 表并打 `age_above_range`。
 */
const ANCHORS = {
  男: {
    '18~70': {
      table: 'GB/T 10000-2023 表 1',
      page: 'PDF p6~p7（印刷 3~4）',
      weight_kg: [47, 52, 55, 68, 83, 88, 100],
      height_mm: [1528, 1578, 1604, 1687, 1773, 1800, 1860],
      bust_mm: [770, 809, 832, 927, 1032, 1064, 1123],
      shoulder_mm: [339, 354, 361, 386, 411, 419, 435],
    },
    '18~25': {
      table: 'GB/T 10000-2023 表 2',
      page: 'PDF p8~p10（印刷 5~7）',
      weight_kg: [45, 50, 53, 64, 80, 86, 101],
      height_mm: [1572, 1616, 1640, 1720, 1807, 1837, 1887],
      bust_mm: [745, 783, 804, 878, 988, 1029, 1118],
      shoulder_mm: [null, null, null, 391, null, null, null],
    },
    '26~35': {
      table: 'GB/T 10000-2023 表 3',
      page: 'PDF p10~p11（印刷 7~8）',
      weight_kg: [48, 53, 56, 69, 86, 92, 105],
      height_mm: [1556, 1607, 1629, 1706, 1789, 1813, 1865],
      bust_mm: [771, 808, 831, 924, 1038, 1075, 1140],
      shoulder_mm: [345, 359, 366, 391, 417, 424, 438],
    },
    '36~60': {
      table: 'GB/T 10000-2023 表 4',
      page: 'PDF p12~p13（印刷 9~10）',
      weight_kg: [47, 53, 56, 69, 83, 88, 98],
      height_mm: [1518, 1567, 1592, 1670, 1750, 1773, 1818],
      bust_mm: [786, 827, 851, 944, 1038, 1068, 1122],
      shoulder_mm: [337, 353, 359, 383, 408, 415, 428],
    },
  },
  女: {
    '18~70': {
      table: 'GB/T 10000-2023 表 6',
      page: 'PDF p16~p18（印刷 13~15）',
      weight_kg: [41, 45, 47, 57, 70, 75, 84],
      height_mm: [1440, 1479, 1500, 1572, 1650, 1673, 1725],
      bust_mm: [746, 783, 804, 895, 1009, 1042, 1109],
      shoulder_mm: [308, 323, 330, 354, 377, 383, 395],
    },
    '18~25': {
      table: 'GB/T 10000-2023 表 7',
      page: 'PDF p18~p20（印刷 15~17）',
      weight_kg: [39, 42, 44, 52, 62, 68, 81],
      height_mm: [1465, 1512, 1528, 1599, 1677, 1700, 1776],
      bust_mm: [730, 759, 776, 837, 924, 956, 1058],
      shoulder_mm: [null, null, null, 354, null, null, null],
    },
    '26~35': {
      table: 'GB/T 10000-2023 表 8',
      page: 'PDF p20~p21（印刷 17~18）',
      weight_kg: [41, 44, 46, 54, 68, 72, 85],
      height_mm: [1458, 1499, 1520, 1588, 1658, 1684, 1737],
      bust_mm: [747, 780, 792, 868, 978, 1015, 1095],
      shoulder_mm: [307, 324, 332, 355, 377, 383, 395],
    },
    '36~60': {
      table: 'GB/T 10000-2023 表 9',
      page: 'PDF p22~p24（印刷 19~21）',
      weight_kg: [42, 46, 49, 59, 71, 76, 85],
      height_mm: [1438, 1475, 1496, 1564, 1639, 1660, 1710],
      bust_mm: [760, 804, 828, 917, 1018, 1049, 1110],
      shoulder_mm: [310, 324, 331, 354, 377, 384, 396],
    },
  },
}

/**
 * 胸围幂律的指数——**C 档·本站自拟**，不是我拍的：把 8 张表 × 7 档＝56 格（每格是该档人群的一个
 * 「体重／身高／胸围」三元组）喂进 `bust = bustP50 × ratio^b`，取"最大绝对残差最小"的那个 b。
 * 复算＝`node -e` 现扫（工装 `E:/website/站3产生临时文件/phase5-20261020/render/fit-check.mjs`
 * 在 2026-10-20 只扫了 0.5/0.6/0.65/0.68/0.7/0.75 这六个点，**漏在 0.69 更好**⇒ 本数已按 0.001 步长重扫修正）。
 * 最大绝对残差：b=0.5 → 6.48%／0.6 → 3.77%／0.65 → 2.70%／0.68 → 2.11%／**0.69 → 1.92%**／
 * 0.7 → 2.27%／0.75 → 4.15%；最优格＝女 26~35 的 P1（正）与男 18~25 的 P1（负）。
 * ⛔ 改这个数字必须同轮在 `13` §三 补一行残差复算。
 */
const BUST_EXPONENT = 0.69

/**
 * 肩宽跟着胸围动的档间斜率（cm 肩宽 / cm 胸围），出处 GB/T 1335 附录 B 表 B.1【官方原文·文本层逐字】：
 * 男 胸围 76→104 每档 +4、总肩宽 40.4→48.8 每档 +1.2 ⇒ 1.2÷4＝0.30（`GBT+1335-1-2008 …男子.pdf` PDF p10）
 * 女 胸围 72→100 每档 +4、总肩宽 37.0→44.0 每档 +1.0 ⇒ 1.0÷4＝0.25（`GBT+1335-2-2008 …女子 .pdf` PDF p8）
 * ⚠️ 借的是**增量比**，不是绝对值：1335 的「总肩宽」与 10000 的「肩宽」两个口径差 3~5 cm（见文件头）。
 */
const SHOULDER_SLOPE = { 男: 0.3, 女: 0.25 }

/**
 * 肩宽 P50 的**绝对**钳位包络（本表 spread 缺失时兜底）。
 * 只在表 2／表 7 那两档用（它们的肩宽 spread 没抄），用了就打 `clamp_from_envelope`；
 * 这两档的绝对框退化成 `[0.865, 1.127] × P50`＝另外六张表里 P1/P50 的最小值与 P99/P50 的最大值。
 */
const SHOULDER_ENVELOPE = [0.865, 1.127]

/**
 * 肩宽÷身高的**配对分位包络**＝[最小值, 最大值]，由下面 ANCHORS 现算，不是手拍的第二个常数。
 * 做法：把每张表里"同一张表、同一个分位档"的肩宽与身高配成一对再取比值（P1 配 P1、P50 配 P50…），
 * 44 个配对点的范围＝**0.2105 ~ 0.2354**（最小＝女 26~35 的 P1，最大＝男 26~35 的 P99）。
 * ⚠️ 这仍是**边缘分布的同档配对**，不是对同一个真人的联合测量（`13` §六 第 3 条那笔债）；
 *    但它比胸围那根轴硬得多：同一把尺子量"胸围÷身高"在同档配对里跨 47.4%~64.9%（因为胸围吃脂肪，
 *    而 GB/T 5703-2023 §6.2.7 的「肩宽＝两肩峰点直线距离」是骨骼量、主要随身高走）。
 * ⇒ 所以这一层**只给肩宽加身高相对框**，⛔ 不给胸围加（加了会把偏胖的人的胸围压回人群中间值，
 *    那正是合身层要避开的事）。它拦的是幂律在身高两端的飘移：不拦的话，140 cm 的女士会被估到
 *    肩宽 39.5 cm＝身高的 28.2%，而国标同一档配对里最宽也只到 23.5%。
 */
const SHOULDER_HEIGHT_RATIO = (() => {
  let lo = Infinity
  let hi = -Infinity
  for (const gender of Object.keys(ANCHORS)) {
    for (const band of Object.keys(ANCHORS[gender])) {
      const t = ANCHORS[gender][band]
      for (let i = 0; i < t.height_mm.length; i++) {
        const s = t.shoulder_mm[i]
        if (s === null || s === undefined) continue
        const r = s / t.height_mm[i]
        if (r < lo) lo = r
        if (r > hi) hi = r
      }
    }
  }
  return [lo, hi]
})()

// 输入合格框（`13` §一）。⛔ 框外一律返回 null，不返回 0、不返回"中位人的身材"＝硬规矩 2。
const HEIGHT_RANGE = [140, 200] // cm
const WEIGHT_RANGE = [30, 150] // kg
const AGE_MAX = 120 // 岁；只在"填了但读不出数"时用来拒算，≤0 或 >120 视同没填（见 estimateBodyDims ③）

const r1 = (v) => Math.round(v * 10) / 10

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 性别 × 年龄 ⇒ 用哪张表的锚点（`13` §一 选表规则）
 * @param {'男'|'女'} gender
 * @param {number|null} age 没填＝null
 * @returns {{band: string, flags: string[]}}
 */
function selectBand(gender, age) {
  const flags = []
  const tables = ANCHORS[gender]
  if (!tables) return { band: null, flags }
  if (age === null) return { band: '18~70', flags } // 没填年龄不算缺测，用全人群表
  if (age < 18) {
    flags.push('age_below_range')
    return { band: '18~25', flags }
  }
  if (age <= 25) return { band: '18~25', flags }
  if (age <= 35) return { band: '26~35', flags }
  if (age <= 60) return { band: '36~60', flags }
  flags.push('age_above_range') // 表 5／表 10（61~70）没抄 ⇒ 外推到 36~60（方向：会低估胸围）
  return { band: '36~60', flags }
}

/**
 * 估算净胸围与净肩宽
 * @param {{gender?:string, height?:number|string, weight?:number|string, age?:number|string,
 *          height_cm?:number|string, weight_kg?:number|string}} input
 *        gender 必须逐字 '男'／'女'（`profileEnricher._normGender` 已归一后写回 `p.gender`）；
 *        身高 cm、体重 kg；年龄选填
 * @returns {{bust_cm:number, shoulder_cm:number, band:string,
 *            basis:{table:string, page:string, bust_p50_mm:number, shoulder_p50_mm:number,
 *                   exponent:number, slope:number, evidence:string},
 *            flags:string[], estimated:true} | null}
 *          **输入任何一项不合格 ⇒ null**（不是 {}、不是 0）
 */
function estimateBodyDims(input) {
  const p = input || {}
  const gender = p.gender
  if (gender !== '男' && gender !== '女') return null

  const height = num(p.height != null ? p.height : p.height_cm)
  const weight = num(p.weight != null ? p.weight : p.weight_kg)
  if (height === null || weight === null) return null
  if (height < HEIGHT_RANGE[0] || height > HEIGHT_RANGE[1]) return null
  if (weight < WEIGHT_RANGE[0] || weight > WEIGHT_RANGE[1]) return null

  // 年龄三档处理：① 没填（undefined/null/''）⇒ 用全人群表，不算缺测；
  // ② 填了但读不出有限数（'abc'／NaN）⇒ **整层拒算**，静默降级会把上游的 bug 藏进一张对的表里；
  // ③ 读得出数但 ≤0（表单常用 0 当"没选"哨兵）⇒ 视同没填、走全人群表并打 `age_ignored`，
  //    >120 同理（离谱到不该拿它选表）。方向性差别写在注释里：③ 是"这格别信"，不是"这档案废了"。
  const rawAge = p.age
  const age = num(rawAge)
  if (rawAge != null && rawAge !== '' && age === null) return null
  let usedAge = age
  const ageFlags = []
  if (age !== null && (age <= 0 || age > AGE_MAX)) {
    usedAge = null
    ageFlags.push('age_ignored')
  }

  const { band, flags: bandFlags } = selectBand(gender, usedAge)
  if (!band) return null
  const flags = ageFlags.concat(bandFlags)
  const t = ANCHORS[gender][band]

  // —— 第 1 步 胸围＝幂律（锚点 A 档、指数 C 档）——
  // ratio 是"这个人的体重/身高 相对该表 P50 同行比值"的倍数，量纲在同单位内自动抵消。
  // ⚠️ 表里身高是 mm、输入是 cm ⇒ 先把表的 P50 身高换成 cm，否则 ratio 差 10 倍。
  const h50cm = t.height_mm[P50] / 10
  const w50 = t.weight_kg[P50]
  const ratio = weight / height / (w50 / h50cm)
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  const bustP50 = t.bust_mm[P50]
  let bust = bustP50 * Math.pow(ratio, BUST_EXPONENT)
  const bustLo = t.bust_mm[P1]
  const bustHi = t.bust_mm[P99]
  if (bust < bustLo) {
    bust = bustLo
    flags.push('bust_clamped')
  } else if (bust > bustHi) {
    bust = bustHi
    flags.push('bust_clamped')
  }

  // —— 第 2 步 肩宽＝锚 P50 + 借 1335 的斜率（第 1 步**钳过之后**的 bust 才进来）——
  // 顺序是刻意的：钳位不放在最后，是为了不让"幂律在两端飘出去的胸围"再乘一遍斜率飘进肩宽。
  const slope = SHOULDER_SLOPE[gender]
  const shoulderP50 = t.shoulder_mm[P50]
  let shoulder = shoulderP50 + slope * (bust - bustP50)

  // —— 第 3 步 钳位——
  // 两层框：① 本表的绝对分位框（表 2／表 7 的肩宽 spread 没抄 ⇒ 退化成包络比）；
  // ② 肩宽÷身高的配对分位包络（SHOULDER_HEIGHT_RATIO，现算自同一批锚点）。
  // 取两层里更紧的那一侧。**flag 只在真咬住时打**：`shoulder_clamped`＝夹过（任一层），
  // `shoulder_height_envelope`＝夹住它的那一侧来自身高相对框而不是本表分位框。
  // always-on 的 flag 等于没有 flag，下游读不出这一格到底动没动。
  const shLo = t.shoulder_mm[P1]
  const shHi = t.shoulder_mm[P99]
  let lo = shLo
  let hi = shHi
  let loFrom = 'table'
  let hiFrom = 'table'
  if (lo === null || hi === null) {
    // 表 2／表 7 的肩宽 spread 没抄 ⇒ 用六张表的绝对包络，比另外六档粗一档（`13` §六 第 2 条）
    lo = shoulderP50 * SHOULDER_ENVELOPE[0]
    hi = shoulderP50 * SHOULDER_ENVELOPE[1]
    loFrom = 'spread_envelope'
    hiFrom = 'spread_envelope'
    flags.push('clamp_from_envelope')
  }
  const hLo = height * 10 * SHOULDER_HEIGHT_RATIO[0]
  const hHi = height * 10 * SHOULDER_HEIGHT_RATIO[1]
  if (hLo > lo) {
    lo = hLo
    loFrom = 'height'
  }
  if (hHi < hi) {
    hi = hHi
    hiFrom = 'height'
  }
  // ⚠️ 两框会打架：这个人的身高在本表 P1 之外（男 140~152cm、女 140~143cm 那一角），
  //    于是"本表 P1 的下限"比"身高相对框的上限"还高 ⇒ 谁都不肯让。取**本表那侧**（宁可给一个
  //    人群里的最窄肩，也不给一个国标本表里不存在的肩宽数），并打 `shoulder_frame_conflict`
  //    让下游知道这一格的比值会越过 23.54%。实测：男 140/30 那格 ⇒ 33.9cm＝24.2%。
  if (lo > hi) {
    hi = lo
    hiFrom = loFrom
    flags.push('shoulder_frame_conflict')
  }
  if (shoulder < lo) {
    shoulder = lo
    flags.push('shoulder_clamped')
    if (loFrom === 'height') flags.push('shoulder_height_envelope')
  } else if (shoulder > hi) {
    shoulder = hi
    flags.push('shoulder_clamped')
    if (hiFrom === 'height') flags.push('shoulder_height_envelope')
  }

  return {
    bust_cm: r1(bust / 10),
    shoulder_cm: r1(shoulder / 10),
    band,
    basis: {
      table: t.table,
      page: t.page,
      bust_p50_mm: bustP50,
      shoulder_p50_mm: shoulderP50,
      exponent: BUST_EXPONENT,
      slope,
      evidence:
        '人群分位锚点【官方原文·目视抄读】（GB/T 10000-2023）＋幂律与指数【C 档·本站自拟】' +
        '＋肩宽档间斜率借 GB/T 1335 表 B.1【官方原文·文本层逐字】（只借斜率，绝对值不跨口径互换）',
    },
    // flags 顺序＝age_ignored → age_below_range／age_above_range → bust_clamped
    // → clamp_from_envelope → shoulder_frame_conflict → shoulder_clamped → shoulder_height_envelope。
    // 每条各有一个 if 守卫、最多进一次；出现两次说明我把钳位写坏了（单测里断言无重复）。
    flags,
    estimated: true,
  }
}

/**
 * 苏南回归方程：腰围 ⇒ 胸围、臀围
 * ============================================================
 * 出处：王萍、张秀《基于三维人体测量的苏南地区青年女性体型特征》（2012），
 *   样本＝苏南地区 18~24 岁女性 185 人（三维扫描），回归方程见论文 §2.6：
 *     胸围 B ＝ 0.59 × 腰围 W ＋ 45.37（cm）
 *     臀围 H ＝ 0.55 × 腰围 W ＋ 53.96（cm）
 *   论文用 GB/T 1335.2—2008 的 165/84A（W=68）回代：B=85.49／H=91.36，
 *   与样本均值（B=85.02／H=91.13）误差 <0.5cm ⇒ 方程精度在该群体内较高。
 *
 * ⚠️ 档位诚实：
 *  - 方程的适用群体是**苏南 18~24 岁青年女性**；对其他地区／年龄段，
 *    围度间的线性关系仍然成立（都是软组织围度，不像身高体重幂律那样吃年龄），
 *    但截距会有偏移 ⇒ 超出 18~35 岁时打 `age_out_of_study_range`，
 *    对外 ✅ 说"按江浙青年女性三围回归估"，⛔ 不说"按你的腰围精准推算"。
 *  - 这一层的数同样 ⛔ 不许喂 computeBodyShape／规则匹配／顾客端实测展示，
 *    唯一出口是 topFitBody.person_cm.bust／hip（合身层做减法的原值）。
 */
const WAIST_BUST_SLOPE = 0.59
const WAIST_BUST_INTERCEPT = 45.37
const WAIST_HIP_SLOPE = 0.55
const WAIST_HIP_INTERCEPT = 53.96
/** 腰围合格框（cm）：苏南样本 55.4~93.0，放宽到 40~130 覆盖偏瘦／偏胖端点 */
const WAIST_RANGE = [40, 130]
/** 回归方程的研究适用年龄段（岁），超出打 flag 但仍可算 */
const WAIST_STUDY_AGE_RANGE = [18, 35]

/**
 * 用腰围回归方程估算净胸围与净臀围
 * @param {{gender?:string, waist?:number|string, age?:number|string}} input
 *        gender 必须逐字 '女'（男性群体无此方程，⛔ 不跨性别套用）；
 *        waist 单位 cm；年龄选填（只用于打 flag，不改变方程）
 * @returns {{bust_cm:number, hip_cm:number, estimated:true,
 *            basis:{study:string, equation_bust:string, equation_hip:string,
 *                   sample_size:number, region:string, age_range:string},
 *            flags:string[]} | null}
 *          gender 不是 '女' 或 waist 不合格 ⇒ null
 */
function estimateFromWaist(input) {
  const p = input || {}
  if (p.gender !== '女') return null
  const waist = num(p.waist)
  if (waist === null) return null
  if (waist < WAIST_RANGE[0] || waist > WAIST_RANGE[1]) return null

  const flags = []
  const age = num(p.age)
  if (age !== null && (age < WAIST_STUDY_AGE_RANGE[0] || age > WAIST_STUDY_AGE_RANGE[1])) {
    flags.push('age_out_of_study_range')
  }

  const bust = WAIST_BUST_SLOPE * waist + WAIST_BUST_INTERCEPT
  const hip = WAIST_HIP_SLOPE * waist + WAIST_HIP_INTERCEPT

  return {
    bust_cm: r1(bust),
    hip_cm: r1(hip),
    estimated: true,
    basis: {
      study: '王萍、张秀《基于三维人体测量的苏南地区青年女性体型特征》(2012)',
      equation_bust: 'B = 0.59 × W + 45.37',
      equation_hip: 'H = 0.55 × W + 53.96',
      sample_size: 185,
      region: '苏南',
      age_range: '18~24',
    },
    flags,
  }
}

module.exports = {
  estimateBodyDims,
  estimateFromWaist,
  selectBand,
  ANCHORS,
  PERCENTILE_ORDER,
  BUST_EXPONENT,
  SHOULDER_SLOPE,
  SHOULDER_ENVELOPE,
  SHOULDER_HEIGHT_RATIO,
  HEIGHT_RANGE,
  WEIGHT_RANGE,
  WAIST_RANGE,
  WAIST_BUST_SLOPE,
  WAIST_BUST_INTERCEPT,
  WAIST_HIP_SLOPE,
  WAIST_HIP_INTERCEPT,
  P1,
  P50,
  P90,
  P99,
}
