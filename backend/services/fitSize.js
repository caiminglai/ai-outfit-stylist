/**
 * 合身层（上衣处方的第 0 层）：先回答"尺寸合不合"，再谈"往哪修"和"颜色"
 * ============================================================================
 * 建档 2026-10-09。**这份文件的算法与措辞边界以 `docs/依据/09-合身层输入输出规范.md` 为准**，
 * 两边必须同轮改；对外文案要看这一层的档位表也在那份文件里。
 *
 * 产品口径（用户 10-09 定）：上衣首先是合身，合身要"以人的身体为准"有一套可算的标准。
 * 中国现行且真能落到"该买哪一件"的只有 GB/T 1335 服装号型系列 ⇒ 这一层以它为主干。
 *
 * 依据硬度（逐条标，别含糊）：
 *  · 号（身高 5cm 一档）、型（胸围 4cm 一档）、Y/A/B/C 按胸腰差分四体型
 *      ⇒ A 档标准本体：GB/T 1335.1-2008（男）／1335.2-2008（女）均**现行**【官方原文，openstd 详情页】
 *      ⇒ ⚠️ **分档的具体 cm 区间是公开转录【二手】**：openstd 对该条不提供免费文本阅读，
 *        我们没逐字核对过标准原文 ⇒ 对外必须带"正式引用前需购文本复核"，
 *        且只能说"按号型系列的逻辑换算"，不能说"按国标算出你的体型"。
 *  · 松量窗口 ⇒ 复用 `topFitBody.easeWindowFor()`（全局只有一套松量口径，B− 档研究 + C 档 BMI 分档）。
 *  · 肩缝落点容差 ±1.5cm／落肩 +3cm ⇒ **C 档手拍**（版型行业经验，无标准无论文，标定中）。
 *  · 测量指引 ⇒ GB/T 16160-2017《服装用人体测量的尺寸定义与方法》【官方原文·现行】，
 *      它只管"怎么量、量哪两点"，**不管量到多少算好看**，也不含任何适合度判据。
 *
 * ⛔ 这一层判不了的事（项目里没这些字段，写清楚是为了不许被当成漏实现）：
 *    袖长、袖笼弧长、腰节长/背长、领围、成衣实际尺码。
 *    衣柜表 `user_wardrobe` 无 `size`／成品尺寸列 ⇒ "你身上这件合不合身"目前判不了，
 *    只能回答"你该买成品胸围几 cm 的那件"。
 */

const { meas, easeWindowFor, BODY_REF } = require('./topFitBody')

const r1 = (v) => Math.round(v * 10) / 10

// ------------------------------------------------------------
// 1. 号型分档（GB/T 1335 的号与型；数值见 09 §2）
// ------------------------------------------------------------

const SIZE_STEPS = {
  height: 5, // "号"＝身高，按 5cm 分档
  chest: 4, // "型"＝胸围，上装按 4cm 分档
  // 常用档系范围；出范围仍给就近档，但必须标 size_scope='near'
  height_range: [145, 190],
  chest_range: [72, 120],
}

/** 胸腰差（净胸围−净腰围）分四体型。区间边界包含在内；流传值【二手】 */
const DROP_BANDS = {
  男: [
    { code: 'Y', lo: 17, hi: 22, cn: '瘦体' },
    { code: 'A', lo: 12, hi: 16, cn: '正常体' },
    { code: 'B', lo: 7, hi: 11, cn: '偏胖体' },
    { code: 'C', lo: 2, hi: 6, cn: '胖体' },
  ],
  女: [
    { code: 'Y', lo: 19, hi: 24, cn: '瘦体' },
    { code: 'A', lo: 14, hi: 18, cn: '正常体' },
    { code: 'B', lo: 9, hi: 13, cn: '偏胖体' },
    { code: 'C', lo: 4, hi: 8, cn: '胖体' },
  ],
}

/** C 档手拍：肩缝落点容差（正肩 ±1.5cm，落肩款式至少 +3cm） */
const SHOULDER_TOLERANCE = { set_in: 1.5, drop_from: 3 }

/**
 * 胸腰差 ⇒ Y/A/B/C。**空隙、超上界、低于下界三种情况都不许偷偷并进邻档。**
 * @returns {{code:string, cn:string, band:number[]}|{reason:string}}
 */
function bodyTypeOf(drop, gender) {
  const g = gender === '男' || gender === '女' ? gender : null
  if (!g) return { reason: '性别没填 ⇒ Y/A/B/C 的切点分男女，这一位不替你猜' }
  if (!(drop > 0)) return { reason: '腰围没量或量得不比胸围小 ⇒ 胸腰差算不出，体型位不出' }
  const bands = DROP_BANDS[g]
  for (const b of bands) {
    if (drop >= b.lo && drop <= b.hi) return { code: b.code, cn: b.cn, band: [b.lo, b.hi] }
  }
  const top = bands[0]
  const bottom = bands[bands.length - 1]
  if (drop > top.hi)
    return { reason: `胸腰差 ${r1(drop)} cm 高于 Y 档上界 ${top.hi} cm ⇒ 超出号型分档表，体型位不替你编` }
  if (drop < bottom.lo)
    return {
      reason: `胸腰差 ${r1(drop)} cm 低于 C 档下界 ${bottom.lo} cm（腰围接近或超过胸围）⇒ 体型位不替你编`,
    }
  return { reason: `胸腰差 ${r1(drop)} cm 落在两档之间的空隙 ⇒ 不四舍五入进档，体型位不出` }
}

/** 就近取档；返回档位值与"是否在常用档系内" */
function nearestStep(value, step, [lo, hi]) {
  const n = Math.round(value / step) * step
  return { value: n, in_range: n >= lo && n <= hi }
}

// ------------------------------------------------------------
// 2. 四道部位判据（09 §3）
// ------------------------------------------------------------

const CHECK_CN = {
  bust_ease: '胸围松量',
  shoulder_seam: '肩缝落点',
  body_length: '衣长／腰节',
  sleeve: '袖长／袖笼',
}

function checkBustEase(bust, easeWindow) {
  const t = '可给目标值'
  if (!easeWindow) {
    return {
      key: 'bust_ease',
      name_cn: CHECK_CN.bust_ease,
      verdict: '判不了',
      target: null,
      why: '松量窗口按 BMI 取档，体重没量 ⇒ 取不到窗口。没有窗口就不给成衣胸围，不硬编一个数。',
      tier: '窗口 B−（Liu 2006 n=9 中国男性／Sakata 2020 n=20）＋ BMI 分档 C 手拍',
      missing_input: '体重（kg）',
    }
  }
  const [lo, hi] = easeWindow
  return {
    key: 'bust_ease',
    name_cn: CHECK_CN.bust_ease,
    verdict: t,
    target: { 净胸围_cm: r1(bust), 松量_cm: easeWindow, 成衣胸围_cm: [r1(bust + lo), r1(bust + hi)] },
    why:
      `买衣服看的是**成品胸围**，不是 S/M/L。你的净胸围 ${r1(bust)}cm，合适松量 ${lo}~${hi}cm ` +
      `⇒ 成衣胸围落在 ${r1(bust + lo)}~${r1(bust + hi)}cm 那一件才是合身的。` +
      '针织有弹可以取窗口下限，无弹机织取上限（项目里没有面料弹性字段，这句只是提示，不进算法）。',
    tier: '窗口 B−（Liu 2006／Sakata 2020，两个样本量都低于 ITU-T P.910 的 ≥24 被试线）＋ BMI 分档 C 手拍',
    missing_input: null,
  }
}

function checkShoulder(shoulder) {
  const tol = SHOULDER_TOLERANCE
  if (!shoulder) {
    return {
      key: 'shoulder_seam',
      name_cn: CHECK_CN.shoulder_seam,
      verdict: '判不了',
      target: null,
      why: '净肩宽没量 ⇒ 肩缝该落在哪儿算不出来。',
      tier: 'C 档手拍（±1.5cm／落肩 +3cm 是版型经验值，无标准无论文，标定中）',
      missing_input: '肩宽（cm，两肩点直线宽）',
    }
  }
  return {
    key: 'shoulder_seam',
    name_cn: CHECK_CN.shoulder_seam,
    verdict: '可给目标值',
    target: {
      净肩宽_cm: r1(shoulder),
      正肩_cm: [r1(shoulder - tol.set_in), r1(shoulder + tol.set_in)],
      落肩款式至少_cm: r1(shoulder + tol.drop_from),
    },
    why:
      `肩缝（袖子与衣身那条缝）落点在净肩宽 ${r1(shoulder)}cm 的 ±${tol.set_in}cm 内叫正肩，` +
      `肩点外移 ${tol.drop_from}cm 以上是落肩。这两类都算合身，区别是款式取向，不是尺寸错。` +
      '⚠️ ±1.5／+3 是我们手拍的版型经验值（C 档），不是标准。',
    tier: 'C 档手拍（版型经验，标定中）',
    missing_input: null,
  }
}

function checkLength() {
  return {
    key: 'body_length',
    name_cn: CHECK_CN.body_length,
    verdict: '判不了',
    target: null,
    why:
      '衣长合不合要看**腰节长／背长**（颈后点到腰线的距离），项目里没有这个字段 ⇒ 这一道给不了数。' +
      '现在只能按腿身比在"修形层"里说视线上移还是下移，那是比例修形，不是尺寸合身。',
    tier: '—（无字段，不判）',
    missing_input: '腰节长／背长（cm）',
  }
}

function checkSleeve() {
  return {
    key: 'sleeve',
    name_cn: CHECK_CN.sleeve,
    verdict: '判不了',
    target: null,
    why:
      '袖长（肩点经肘到腕）与袖笼弧长都没有字段，衣柜表 `user_wardrobe` 也没有成品尺寸列 ⇒ 判不了。' +
      '要真判，录入表得加"成品胸围／肩宽／袖长"三格。',
    tier: '—（无字段，不判）',
    missing_input: '袖长／袖笼（cm）',
  }
}

// ------------------------------------------------------------
// 3. 测量指引（GB/T 16160-2017 口径；只覆盖"怎么量"）
// ------------------------------------------------------------

const MEASURE_GUIDE = [
  '准备：软尺、赤足站直、双臂自然下垂、穿贴身薄衣；每个数取**呼气末**读数，软尺水平绕测、贴皮不勒。',
  '身高：背墙立正，耳眼水平线（眼耳平面）与地面平行，头顶到地面的垂直距离。',
  '净胸围：经乳头点（bp）水平绕胸一周，软尺过背部肩胛骨下角，不吸气不挺肚。',
  '净腰围：站直侧身找腰部最细处（约肚上 1~2cm，即腰线 w1）水平一周。',
  '净肩宽：左右肩点（acromiale，肩峰外缘最凸点）之间的直线宽——**需两人配合，从背面量**。',
  '体重：晨起排空后、同一台秤、贴身薄衣。',
]

// ------------------------------------------------------------
// 4. 主入口
// ------------------------------------------------------------

/**
 * @param {object} person 档案（enrich 前后都行，字段名同一套）
 * @param {{ease_window:number[]|null, measure?:object}} [dev] `bodyDeviation()` 的结果；
 *        不传就自己算一次（保证松量口径全局只有一处）
 * @returns {object} 见 09 §5。`present:false` 时只有 `blocking` 与 `measure_guide`
 */
function fitLayer(person, dev) {
  const p = person || {}
  const d = dev || require('./topFitBody').bodyDeviation(p)
  const height = meas(p.height)
  const bust = meas(p.bust)
  const waist = meas(p.waist)
  const shoulder = meas(p.shoulder)
  const weight = meas(p.weight)
  const bmi = height > 0 && weight > 0 ? weight / ((height / 100) * (height / 100)) : 0
  const easeWindow = (d && d.ease_window) || easeWindowFor(bmi)

  const guide = { measure_guide: MEASURE_GUIDE }

  // —— 挡在门口：号或型出不来，这一层一个目标值都不给 ——
  const blocking = []
  if (!height) blocking.push('身高没量 ⇒ "号"（身高 5cm 一档）定不了')
  if (!bust) blocking.push('净胸围没量 ⇒ "型"（胸围 4cm 一档）与成衣胸围目标都定不了')
  if (blocking.length > 0) {
    return {
      present: false,
      layer_cn: '合身（第 0 层）',
      blocking,
      missing_input: ['身高', '净胸围'].filter((_, i) => (i === 0 ? !height : !bust)),
      ...guide,
      note:
        '这一层判不了，先按下面的方法把这两个数量出来。**没有这两个数，任何"你该穿几号"的话都是猜的。**',
      evidence:
        'GB/T 1335.1-2008／1335.2-2008 号型系列（现行，分档数值系公开转录【二手·需购文本复核】）＋ GB/T 16160-2017 测量方法',
    }
  }

  const hao = nearestStep(height, SIZE_STEPS.height, SIZE_STEPS.height_range)
  const xing = nearestStep(bust, SIZE_STEPS.chest, SIZE_STEPS.chest_range)
  const drop = bust > 0 && waist > 0 ? r1(bust - waist) : null
  const bt = bodyTypeOf(drop, p.gender)
  const hasType = Boolean(bt.code)

  return {
    present: true,
    layer_cn: '合身（第 0 层）',
    size_label: hasType ? `${hao.value}/${xing.value}${bt.code}` : `${hao.value}/${xing.value}`,
    size: {
      号: hao.value,
      型: xing.value,
      体型: hasType ? bt.code : null,
      体型中文: hasType ? bt.cn : null,
      体型档: hasType ? bt.band : null,
    },
    size_scope: hao.in_range && xing.in_range ? 'standard' : 'near',
    size_scope_note:
      hao.in_range && xing.in_range
        ? null
        : `号 ${hao.value}／型 ${xing.value} 超出常用档系（号 ${SIZE_STEPS.height_range.join('~')}、型 ${SIZE_STEPS.chest_range.join('~')}）⇒ 就近换算，不是标准档`,
    drop_cm: drop,
    drop_reason: hasType ? null : bt.reason,
    target_finished_bust: easeWindow
      ? [r1(bust + easeWindow[0]), r1(bust + easeWindow[1])]
      : null,
    ease_window_cm: easeWindow || null,
    checks: [
      checkBustEase(bust, easeWindow),
      checkShoulder(shoulder),
      checkLength(),
      checkSleeve(),
    ],
    ...guide,
    note:
      '这一层只回答**尺寸合不合**：号型、成衣胸围该到几 cm、肩缝落点该在哪儿。' +
      '号型本身不含任何"好不好看"的判据（GB/T 1335 就没写）；合不合身与显不显瘦是两件事，' +
      '下面的修形层与颜色层可能与这里结论不同，那是对的，不是冲突——由你决定今天要不要求合身。',
    evidence:
      'GB/T 1335.1-2008／1335.2-2008 号型系列（现行【官方原文】；5cm/4cm 分档与胸腰差 Y/A/B/C 区间取自公开转录【二手·需购文本复核】）＋ GB/T 16160-2017（测量方法【官方原文·现行】）＋ 肩缝容差与 BMI 分档 C 手拍（标定中）',
  }
}

module.exports = {
  fitLayer,
  bodyTypeOf,
  nearestStep,
  SIZE_STEPS,
  DROP_BANDS,
  SHOULDER_TOLERANCE,
  MEASURE_GUIDE,
  CHECK_CN,
  BODY_REF,
}
