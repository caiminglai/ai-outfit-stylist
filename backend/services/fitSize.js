/**
 * 合身层（上衣处方的第 0 层）：先回答"尺寸合不合"，再谈"往哪修"和"颜色"
 * ============================================================================
 * 建档 2026-10-09。**这份文件的算法与措辞边界以 `docs/依据/09-合身层输入输出规范.md` 为准**，
 * 两边必须同轮改；对外文案要看这一层的档位表也在那份文件里。
 *
 * 产品口径（用户 10-09 定）：上衣首先是合身，合身要"以人的身体为准"有一套可算的标准。
 * 中国现行且真能落到"该买哪一件"的只有 GB/T 1335 服装号型系列 ⇒ 这一层以它为主干。
 *
 * 依据硬度（10-10 按 `docs/依据/10` §4 定案改写，逐条标，别含糊）：
 *  · 号（身高 5cm 一档）、型（胸围 4cm 一档）、Y/A/B/C 按胸腰差分四体型
 *      ⇒ A 档标准本体：GB/T 1335.1-2008（男）／1335.2-2008（女）均**现行**
 *      ⇒ ✅ 分档数值已在本机 PDF 上逐字核对过（女册 §4.1.2/§4.1.3＋§3.3 与表 1~4；男册 §3.3 与附录 B 表 B.1~B.4）
 *        ⇒ 见 `10` §2 第 1~5 行、§2b 第 1~4 行，这一支从【二手·需购文本复核】升【官方原文·文本层逐字】
 *      ⇒ 🔴 **但 Y/A/B/C 那四个中文昵称（瘦体／正常体／偏胖体／胖体）不是国标用词**：两册全文 0 次出现"胖/瘦"，
 *        §3.3 只给代号与差数区间 ⇒ 本文件的 `cn` 是我们自己的描述词，对外不得称"国标名称"（`05` 措辞红线）。
 *  · 号／型的"常用档系"范围**现按性别分表**（10-10 定案）：女 号 145~180／型 68~112（Y、A 72~100，B 68~108，C 68~112），
 *    男 号 155~190／型 72~116（Y 76~104，A 72~104，B 72~116，C 76~116）——旧口径 145~190／72~120 是**两性并集**且上界比国标宽 4cm。
 *  · 胖瘦程度（BMI 档）⇒ GB/T 31901-2024 附录 A 表 A.2〔规范性〕：偏瘦 BMI＜18.5／正常 18.5≤BMI＜24／偏胖 BMI≥24。
 *      ⚠️ 2024 版 **2026-12-01 才实施** ⇒ 这一档现在只当内部口径，对外引用必须带日期；它与胸腰差 Y/A/B/C 是**两个轴**，不互相替换。
 *  · 松量窗口 ⇒ 复用 `topFitBody.easeWindowFor()`（全局只有一套松量口径，B− 档研究 + C 档 BMI 分档）。
 *  · 肩缝落点容差 ±1.5cm／落肩 +3cm ⇒ **C 档手拍**（版型行业经验，无标准无论文，标定中）。
 *  · 测量指引 ⇒ GB/T 16160-2017《服装用人体测量的尺寸定义与方法》【官方原文·现行，正文在本机】：
 *      腰围取 §2.2.10「胯骨上端与肋骨下缘之间**腰际线**」，**不是"腰最细处"**（10 §4 第 5 条定案）；
 *      肩宽取 GB/T 5703-2023 §6.2.7「两肩峰点之间的**直线距离**」（§6.2.8「肩最大宽」与 16160 §2.2.5「总肩宽（水平弧长）」是两个别的量）。
 *      ⚠️ 5703-2023 §4.2 把工具分工写死了：测宽度用**圆杆直角规／圆杆弯脚规**，软尺只管围长或弧长 ⇒
 *        用户在家拿软尺量出的肩宽**三个口径哪一个都不是**，所以对外永远不许写"按国标量／判你的肩宽"（`05`）。
 *
 * ⛔ 这一层判不了的事（项目里没这些字段，写清楚是为了不许被当成漏实现）：
 *    袖长、袖笼弧长、腰节长/背长、领围。
 *    10-19 第二阶段起，衣柜表 `user_wardrobe` 有了成衣四格实测尺寸（shoulder_cm／bust_cm／
 *    length_cm／waistband_cm），"你身上这件松量对不对"由 `topFitBody` 的实测对齐回答；
 *    10-19 第三阶段又补了 `fit_type`（修身/合身/宽松/廓形）：不动软尺的人选一档版型，
 *    松量按区间中值估、覆盖率只按半格计（`topFitBody.js` 的 FIT_TYPE_EASE）。
 *    这一层（第 0 层）仍然只回答**"你该买成品胸围几 cm 的那件"**——衣长与袖长两道还缺
 *    人体侧的腰节长/背长与袖长字段，量法见下面 MEASURE_GUIDE 末尾那四条成衣平铺量法。
 */

const { meas, easeWindowFor, BODY_REF } = require('./topFitBody')
const { bmiValue, gbBand, GB_BANDS } = require('./bmi')
const { ownValue } = require('../utils/common')

const r1 = (v) => Math.round(v * 10) / 10

// ------------------------------------------------------------
// 1. 号型分档（GB/T 1335 的号与型；数值见 09 §2）
// ------------------------------------------------------------

const SIZE_STEPS = {
  height: 5, // "号"＝身高，按 5cm 分档
  chest: 4, // "型"＝胸围，上装按 4cm 分档
  /**
   * 常用档系范围，**按性别分表**（10-10 定案，取代原来两性并集的 145~190／72~120）。
   * 数值逐字来自本机原文：女册 1335.2-2008 表 1~4（p4-5），男册 1335.1-2008 附录 B 表 B.1~B.4（p10~p12）。
   * `chest` 里 `all` 是该性别全表并集（性别填了、体型代号还没出来时用），其余四档按体型收窄。
   * 出范围仍给就近档，但必须标 size_scope='near'。
   */
  scope: {
    女: {
      height: [145, 180],
      chest: { all: [68, 112], Y: [72, 100], A: [72, 100], B: [68, 108], C: [68, 112] },
      ref: 'GB/T 1335.2-2008 表 1~4',
    },
    男: {
      height: [155, 190],
      chest: { all: [72, 116], Y: [76, 104], A: [72, 104], B: [72, 116], C: [76, 116] },
      ref: 'GB/T 1335.1-2008 附录 B 表 B.1~B.4',
    },
  },
  // 性别没填时的兜底＝两性别并集（只用于"是不是标准档"的提示，不许当某一册的表列引用）
  height_range: [145, 190],
  chest_range: [68, 116],
}

/**
 * 胖瘦程度档（另一条轴，与 Y/A/B/C 并存）。表本身搬进 services/bmi.js 的 GB_BANDS，
 * 这里只留一个同名出口给报告与测试用。出处：GB/T 31901-2024 附录 A 表 A.2〔规范性〕成人栏，
 * 逐字「偏胖 BMI≥24」「正常 18.5≤BMI<24」「偏瘦 BMI＜18.5」，脚注公式 BMI＝体重(kg)/身高(m)²。
 * ⚠️ 该版 2026-12-01 才实施 ⇒ 现在只当内部口径；`cn` 是表 A.2 的用词，对外要带日期限定。见 `10` §2f。
 */
function bmiBand(bmi) {
  return gbBand(bmi)
}

/** 胸腰差（净胸围−净腰围）分四体型。区间边界包含在内；男女四档均已对本机原文逐字核对（10 §2 第 2 行、§2b 第 1 行） */
const DROP_BANDS = {
  // ⚠️ cn 是我们给的描述词，不是国标用词（国标只写代号 Y/A/B/C 与差数区间）⇒ 对外不得称"国标名称"
  男: [
    { code: 'Y', lo: 17, hi: 22, cn: '收腰明显' },
    { code: 'A', lo: 12, hi: 16, cn: '收腰适中' },
    { code: 'B', lo: 7, hi: 11, cn: '接近直筒' },
    { code: 'C', lo: 2, hi: 6, cn: '直筒型' },
  ],
  女: [
    { code: 'Y', lo: 19, hi: 24, cn: '收腰明显' },
    { code: 'A', lo: 14, hi: 18, cn: '收腰适中' },
    { code: 'B', lo: 9, hi: 13, cn: '接近直筒' },
    { code: 'C', lo: 4, hi: 8, cn: '直筒型' },
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
    return {
      reason: `胸腰差 ${r1(drop)} cm 高于 Y 档上界 ${top.hi} cm ⇒ 超出号型分档表，体型位不替你编`,
    }
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
    target: {
      净胸围_cm: r1(bust),
      松量_cm: easeWindow,
      成衣胸围_cm: [r1(bust + lo), r1(bust + hi)],
    },
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
      missing_input: '肩宽（cm，两肩峰点之间的直线距离）',
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
      '衣长合不合要看**腰节长／背长**（颈后点到腰线的距离），人体侧没有这个字段 ⇒ 这一道给不了数。' +
      '衣柜里的成衣衣长（`length_cm`）10-19 起有格子了，但另一边缺人体腰节长，减法做不出来。' +
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
      '袖长（肩点经肘到腕）与袖笼弧长两侧都没有字段 ⇒ 判不了。' +
      '衣柜表 10-19 起有的四格是肩宽／胸围／衣长／腰头高，**不含袖长**；要真判这一道，录入表还得加"成品袖长／袖笼弧长"两格。',
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
  '净腰围：侧身找到胯骨上端与肋骨下缘之间的那条**腰际线**，在它上面水平绕测一周（GB/T 16160-2017 §2.2.10 的量法）。它一般就在肚脐上方一两指处，**别往下拉到肚脐**——位置低了围长会偏大，直接把体型档判错。',
  '净肩宽：左右肩峰点（肩膀最高处那块骨头的外侧点）之间的**直线距离**，肩膀放松、双臂自然下垂（口径取 GB/T 5703-2023 §6.2.7）——**需两人配合，从背面量**。⚠️ 国标测宽度要求用圆杆直角规，家里只有软尺，所以这一格只能当参考值，不叫"国标肩宽"。',
  '体重：晨起排空后、同一台秤、贴身薄衣。',
  // ↓ 这四条量的是**衣服**，不是人体，和上面 GB/T 16160-2017 那套人体口径无关（站内平铺量法）。
  //   10-19 第二阶段起衣柜表有这四格，上衣打分只认这几个数 ⇒ 怎么量必须一起交回给用户。
  '——— 以下四条量的是**平铺在桌上的衣服**（不是身体），站内口径，不引国标 ———',
  '衣服肩宽：衣服铺平、前后片对齐，量左右两条肩缝外端点之间的**直线距离**（不是绕一圈）。',
  '衣服胸围：衣服扣好铺平，从袖窿下方（腋下接缝）水平横量最宽处得到**半幅宽 ×2**，这才是成品胸围。',
  '衣服衣长：领口最高偏侧那一点（肩颈点）沿衣服表面垂直量到下摆边。',
  '腰头高：腰头那条缝带/收口**自身的高度**（横向那条宽边的上下沿距离）。这件没有腰头就填 0，0 是一个真实结论，与留空＝没量是两件事。',
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
  // 算式只在 services/bmi.js 有一份；量不到 ⇒ null（原来这里回 0，
  // 0 会顺着 `bmi > 0 ? r1(bmi) : null` 变 null，但 easeWindowFor(0) 那条分支读的是"数"，
  // 用 null 走同一道守卫更直白）
  const bmi = bmiValue(height, weight)
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
      note: '这一层判不了，先按下面的方法把这两个数量出来。**没有这两个数，任何"你该穿几号"的话都是猜的。**',
      evidence:
        'GB/T 1335.1-2008／1335.2-2008 号型系列（现行；5cm/4cm 分档与 Y/A/B/C 差数区间已对本机 PDF 逐字核对【官方原文·文本层逐字】，见 docs/依据/10 §2、§2b）＋ GB/T 16160-2017 测量方法（正文在本机【官方原文·现行】）',
    }
  }

  const drop = bust > 0 && waist > 0 ? r1(bust - waist) : null
  const bt = bodyTypeOf(drop, p.gender)
  const hasType = Boolean(bt.code)

  // 常用档系按性别取表；体型代号出来了再按体型那一列收窄（原文的系列表本来就是分体型列的）
  // 必须只认表自己的键：gender 是自由 TEXT 列（normalizeGender 认不出来就原样留着），
  // SIZE_STEPS.scope['constructor'] 会顺原型链拿到 Object 构造器（truthy ⇒ 过不了 `|| null`），
  // 下一行 `sc.chest[bt.code]` 就在 undefined 上取属性 ⇒ 整份合身层抛 TypeError、接口回 500。
  // 同函数上面的 bodyTypeOf 一直是按 `=== '男' || === '女'` 硬判的，这里不能比它松。
  const sc = ownValue(SIZE_STEPS.scope, p.gender) || null
  const heightRange = sc ? sc.height : SIZE_STEPS.height_range
  const chestRange = sc
    ? hasType
      ? sc.chest[bt.code] || sc.chest.all
      : sc.chest.all
    : SIZE_STEPS.chest_range
  const sizeRef = sc ? sc.ref : 'GB/T 1335.1／1335.2-2008 两册并集（性别没填 ⇒ 只能给并集）'
  const hao = nearestStep(height, SIZE_STEPS.height, heightRange)
  const xing = nearestStep(bust, SIZE_STEPS.chest, chestRange)

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
    size_scope_ref: sizeRef,
    size_scope_note:
      hao.in_range && xing.in_range
        ? null
        : `号 ${hao.value}／型 ${xing.value} 超出 ${sizeRef} 的档系表列（号 ${heightRange.join('~')}、型 ${chestRange.join('~')}）⇒ 就近换算，不是标准档`,
    drop_cm: drop,
    drop_reason: hasType ? null : bt.reason,
    bmi: bmi === null ? null : r1(bmi),
    bmi_band: bmiBand(bmi),
    bmi_band_note:
      '胖瘦程度是**另一条轴**：Y/A/B/C 按胸腰差（体型），胖瘦程度按 BMI（GB/T 31901-2024 附录 A 表 A.2〔规范性〕：偏瘦 BMI＜18.5／正常 18.5≤BMI＜24／偏胖 BMI≥24，BMI＝体重 kg÷身高 m²）。' +
      '国标自己就是两个轴并用，所以这一档不替换、也不推翻上面的体型代号。' +
      '⚠️ 2024 版 2026-12-01 才实施 ⇒ 现在只当内部口径，对外引用必须带这个日期。',
    target_finished_bust: easeWindow ? [r1(bust + easeWindow[0]), r1(bust + easeWindow[1])] : null,
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
      'GB/T 1335.1-2008／1335.2-2008 号型系列（现行；5cm/4cm 分档、胸腰差 Y/A/B/C 区间、按性别的常用档系表列＝本机 PDF 逐字核对【官方原文·文本层逐字】，见 docs/依据/10 §2、§2b）' +
      '＋ GB/T 16160-2017 测量方法（§2.2.10 腰际线【官方原文·现行】）＋ GB/T 5703-2023 §6.2.7 两肩峰点直线距离（宽度类量具按 §4.2 是圆杆直角规，家用软尺只能当参考值）' +
      '＋ GB/T 31901-2024 附录 A 表 A.2 胖瘦程度按 BMI（〔规范性〕，2026-12-01 实施 ⇒ 现为内部口径）' +
      '＋ 肩缝容差与松量 BMI 分档 C 手拍（标定中）',
  }
}

module.exports = {
  fitLayer,
  bodyTypeOf,
  nearestStep,
  SIZE_STEPS,
  DROP_BANDS,
  // 表本体已并入 services/bmi.js（一条 BMI 算式与两张档表只留一份）；
  // 这里继续导出同一引用，别的地方按 GB_BANDS 取
  GB_BANDS,
  bmiBand,
  SHOULDER_TOLERANCE,
  MEASURE_GUIDE,
  CHECK_CN,
  BODY_REF,
}
