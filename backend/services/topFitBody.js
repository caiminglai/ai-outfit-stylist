/**
 * 上衣 × 身体 的按人适配分（这一层不看脸）
 *
 * 建档：2026-10-09。设计口径见 docs/依据/08-上衣适配规则-量化方案.md §5/§8/§9/§10。
 * 脸侧那一半（上衣代表色 vs 肤色锚点）在 colorMetrics.js 的 colorFit，两个分数不许混进一个数。
 *
 * 一句话做法：**先算这个人身上"能被上衣改"的比例偏差（偏差向量），再读这件上衣"往哪个方向修、
 * 修多少"（修形向量），同向得分、反向扣分；缺哪一维就不算哪一维，权重按在场维重新归一化。**
 * 这样"同一件上衣在不同人身上分数不同"是几何出来的，不需要谁背书。
 *
 * 输入只用连续量（cm、BMI、明度）。`body_type` / `kibbe_type` / 色彩四季型这类离散标签
 * 一律不进公式（08 §9.2：分类会把分类自身的信度问题带进分数，还会让人以为系统在"判定体型"）。
 *
 * 六根轴与出处（DOI 均已于 10-08 逐条走 api.crossref.org 自核，记录在 docs/依据/06 §8）：
 *  1) shoulder 肩线宽窄   —— 肩宽÷身高、肩宽÷腰围两条离带距离 + 梨形信号；上衣往肩上加体量还是收
 *       Pazhoohi 2023 的 SHR＝肩围÷臀围（本机原文 p2 逐字：the circumference of the shoulders relative to the hips）；
 *       我们量不到"肩围"⇒ 肩宽÷腰围是站内自建比值，只借它方向（p1 摘要：larger SHRs were considered more attractive）
 *  2) waist 腰线强调      —— 人的胸腰差/臀腰差；上衣收腰还是直筒（顺着身体走，不给不存在腰线硬收）
 *  3) ease 松量           —— Liu/Fan/Lau 2006, PMS 103(1):253-264, DOI 10.2466/pms.103.1.253-264
 *       （9 名中国男性 × 5 档白 T：BMI<20 穿大码被评更胖、20–28 更瘦、>28 两端都罚；最小感知尺寸在胸围松量 2–3 cm）B
 *       + Sakata/Kim/Takatera 2020, IJCSCT 33(3):448-464, DOI 10.1108/ijcst-03-2020-0031
 *       （女式衬衫 fit 款胸围 1–7 cm、straight 款约 4 cm；n=20 低于 ITU-T P.910 的 ≥24）B−，只当先验区间
 *  4) length 视觉腰位     —— 人的腿身比偏差 vs 上衣把视觉重心上移/下移（短款、塞腰头 vs 长款过胯）
 *       Kiire 2016 与 Versluys 2018 对腿长比例结论不一致 ⇒ 参考带只当"偏差原点"，不当判据
 *  5) volume 观感体量     —— 深色收缩：Koutsoumpis/Economou/van der Burg 2021, Perception 50(9):741-756,
 *       DOI 10.1177/03010066211038158（深色独立效应 d=0.35–0.58）B；面料厚薄加体量是 C 档经验
 *  6) pattern 条纹方向    —— 结论对冲（Thompson & Mikellidou 2011 DOI 10.1068/i0405 与 Swami & Harris 2012
 *       DOI 10.2224/sbp.2012.40.8.1239 方向相反；Ashida 2013 DOI 10.1068/i0595rep 指出体型大时减弱甚至反转；
 *       Chen & Peng 2026 DOI 10.1177/20416695261441454 给的是"最瘦判断"不是绝对量）
 *       ⇒ 权重压到最低，且 BMI≥25 直接关掉这根轴；对外措辞禁止写"横条显胖/显瘦"（docs/依据/05）
 *
 * 档位诚实说明：修形向量的**方向**来自上面这些 B 档实验；**刻度**（want 拉到 ±1 的换算、词典打分、
 * 厚薄分档、六根轴的权重）全是 C 档手拍值，处于"标定中"。没有任何国标/行标/同行评议文献规定
 * "某人穿某件上衣好不好看"（08 开头 + 06 的证伪记录）。对外只可以说"按公开研究的方向给参考分"。
 */

const { resolveColor, hexToLab } = require('./colorMetrics')
const { TOP_WORDS, OUTER_WORDS, hitsWord } = require('./fullLookAdvisor')
const { ownValue } = require('../utils/common')
const { bmiValue } = require('./bmi')

// ------------------------------------------------------------
// 0. 通用小工具
// ------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v) => clamp(v, 0, 1)
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
/** 数值项：非正数、非有限、空串一律当"没量"，不兜底不编造 */
function meas(val) {
  const n = Number(val)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ------------------------------------------------------------
// 1. 参考带（站内口径；带外的"想要往哪修"才是算分用的东西）
// ------------------------------------------------------------

const BODY_REF = {
  // 肩宽÷身高 %。GB/T 10000-2023 的百分位公开渠道读不到原值 ⇒【无法证真】，
  // 这里 21~24 只当**站内偏差原点**（与 computeShoulderRatio 的切点同一套），不当"合格线"。
  shoulder_band: [21, 24],
  shoulder_span: 3, // 离带 3 个百分点算这一维拉满
  // 肩宽÷净腰围（站内自建比值；Pazhoohi 2023 那个 SHR 是肩围÷臀围，量不到肩围 ⇒ 不是同一个量）。
  // 原点带由本机 GB/T 10000-2023 表2/表7 的 P50 目视抄读值推：男 391/763=0.512、女 354/690=0.513；
  // 腰围挪到 P10~P90（男 678~905、女 622~788）比值落在 0.43~0.58 ⇒ 取 0.44~0.57 当站内原点带。
  // ⚠️ 人群分布推出来的原点，不是判据（10 §2h ⑦ 那条口径）；span 是 C 档手拍。
  shr_band: [0.44, 0.57],
  shr_span: 0.1,
  // 腿长（髋骨到脚跟）÷身高。中枢≈0.54 是二手转录，切点 ±0.02 是产品假设（08 §2.3）
  leg_band: [0.52, 0.56],
  leg_span: 0.04,
  // 腰线明显度：min(胸围-腰围, 臀围-腰围) ≥12cm 算明显、≤6cm 算平直（产品刻度，C 档）
  waist_strong: 12,
  waist_flat: 6,
  waist_span: 6,
  // BMI 分档沿用 computeBmi 的 18.5 / 24 / 28 切点（体重口径，不是"好看"口径）
  bmi_thin: 18.5,
  bmi_normal: 24,
  bmi_heavy: 28,
  // 松量合适区间：按 BMI 分档（Liu 2006 的方向 + Sakata 2020 的区间先验，谁都不当判定线）
  ease_windows: [
    { below: 20, range: [1, 4], note: 'Liu 2006：BMI<20 穿大码被评更胖 ⇒ 只取小松量' },
    { below: 24, range: [2, 7], note: 'Liu 2006 最小感知尺寸 2–3cm；Sakata 2020 fit 款 1–7cm' },
    { below: 28, range: [3, 10], note: 'Liu 2006：20–28 穿大码被评更瘦 ⇒ 区间往宽挪' },
    { below: Infinity, range: [4, 8], note: 'Liu 2006：BMI>28 过紧过松都显胖 ⇒ 只留中段' },
  ],
  // 条纹轴闸门：Ashida 2013 指体型较大时效应减弱甚至反转
  stripe_bmi_max: 25,
}

/** 六根轴权重：C 档手拍值（标定中），任何对外说法不得称"回归得到"（08 §9.3 才是换它的协议） */
const AXIS_WEIGHTS = {
  shoulder: 0.2,
  waist: 0.18,
  ease: 0.22,
  length: 0.16,
  volume: 0.18,
  pattern: 0.06,
}

const AXIS_CN = {
  shoulder: '肩线宽窄',
  waist: '腰线强调',
  ease: '松量',
  length: '视觉腰位',
  volume: '观感体量',
  pattern: '条纹方向',
}

const AXIS_TIER = {
  shoulder:
    'B 方向(Pazhoohi 2023；该文的 SHR＝肩围÷臀围，本机原文 p2) + C 参考带与刻度(肩宽÷身高、肩宽÷腰围都是站内比值,手拍)',
  waist: 'B− 腰臀比与腰线可读性(Singh 系结论被 BMI 混淆) + C 刻度(手拍)',
  ease: 'B 方向与区间(Liu 2006 n=9 中国男性 / Sakata 2020 n=20) + C 松量代理(版型档换算)',
  length: 'B− 腿身比结论未闭合(Kiire 2016 vs Versluys 2018) + C 刻度(手拍)',
  volume: 'B 深色收缩(Koutsoumpis 2021 d=0.35–0.58) + C 面料厚薄加体量(经验)',
  pattern: 'B 结论对冲(四篇方向不一) ⇒ 最低权重且 BMI 闸门，禁止写成确定话',
}

// ------------------------------------------------------------
// 2. 偏差向量：这个人身上"能被上衣改"的几维，各往哪个方向修（+加 / −收）
// ------------------------------------------------------------

/**
 * @param {object} person 档案（enrichProfile 的输入或输出都行，字段名同一套）
 * @returns {{measure:object, want:object, ease_window:number[]|null, notes:string[]}}
 *          某维的输入没量 ⇒ want 该维为 null，这一维就不进总分
 */
function bodyDeviation(person) {
  const p = person || {}
  const height = meas(p.height)
  const weight = meas(p.weight)
  const shoulder = meas(p.shoulder)
  const bust = meas(p.bust)
  const waist = meas(p.waist)
  const hip = meas(p.hip)
  const leg = meas(p.leg_length)

  // 算式只在 services/bmi.js 有一份（本层内部沿用 0 当"没量"哨兵，146/212 两处判据都按它写）；带切点的三根比值先按对外精度取整再比（同 bmi.js、同条纹闸门）
  const bmi = r1(bmiValue(height, weight) ?? 0)
  const shoulderRatio = shoulder > 0 && height > 0 ? r1((shoulder / height) * 100) : 0
  const shr = shoulder > 0 && waist > 0 ? shoulder / waist : 0
  const legRatio = leg > 0 && height > 0 ? r2(leg / height) : 0

  const measure = {
    bmi: bmi > 0 ? r1(bmi) : null,
    shoulder_ratio: shoulderRatio > 0 ? r1(shoulderRatio) : null,
    shoulder_waist_ratio: shr > 0 ? r2(shr) : null,
    leg_ratio: legRatio > 0 ? r2(legRatio) : null,
    bust_waist_diff: bust > 0 && waist > 0 ? r1(bust - waist) : null,
    hip_waist_diff: hip > 0 && waist > 0 ? r1(hip - waist) : null,
    bust_hip_diff: bust > 0 && hip > 0 ? r1(bust - hip) : null,
  }

  const want = { shoulder: null, waist: null, length: null, volume: null, pattern: null }
  const notes = []

  // —— 肩线：离带就往外拉满；下身比上身宽（梨形侧）时也想让上衣把肩加出去 ——
  const shoulderSignals = []
  if (shoulderRatio > 0) {
    const [lo, hi] = BODY_REF.shoulder_band
    if (shoulderRatio < lo)
      shoulderSignals.push(clamp01((lo - shoulderRatio) / BODY_REF.shoulder_span))
    else if (shoulderRatio > hi)
      shoulderSignals.push(-clamp01((shoulderRatio - hi) / BODY_REF.shoulder_span))
    else notes.push(`肩宽比 ${r1(shoulderRatio)} 在参考带内 ⇒ 这维不推拉，上衣往任一侧修都扣分`)
  }
  // 肩宽÷腰围：比值低＝肩相对腰偏窄 ⇒ 想加肩（借 Pazhoohi 2023 的方向）；比值高只是"别再给肩加体量"，
  // 文献没说大到出带还要收，所以高带那一侧的方向是产品选择、不是文献结论（写进 note，别糊过去）
  if (shr > 0) {
    const [lo, hi] = BODY_REF.shr_band
    if (shr < lo) shoulderSignals.push(clamp01((lo - shr) / BODY_REF.shr_span))
    else if (shr > hi) shoulderSignals.push(-clamp01((shr - hi) / BODY_REF.shr_span))
    else notes.push(`肩宽÷腰围 ${r2(shr)} 在参考带内 ⇒ SHR 这条不推拉`)
  }
  if (bust > 0 && hip > 0) {
    // 臀围明显大于胸围 ⇒ 上身偏轻，往"加肩"方向修；反向只在明显超出参考带时才收
    const diff = hip - bust
    shoulderSignals.push(diff > 0 ? clamp01(diff / 8) : clamp(diff / 12, -1, 0))
  }
  if (shoulderSignals.length > 0) {
    want.shoulder = r2(shoulderSignals.reduce((s, v) => s + v, 0) / shoulderSignals.length)
  }

  // —— 腰线：顺着身体走。腰线本来就明显 ⇒ 收腰加分；平直 ⇒ 硬收腰扣分 ——
  const gaps = []
  if (bust > 0 && waist > 0) gaps.push(bust - waist)
  if (hip > 0 && waist > 0) gaps.push(hip - waist)
  if (gaps.length === 2) {
    const groove = Math.min(gaps[0], gaps[1])
    const mid = (BODY_REF.waist_strong + BODY_REF.waist_flat) / 2
    want.waist = r2(clamp((groove - mid) / BODY_REF.waist_span, -1, 1))
    measure.waist_groove_cm = r1(groove)
  } else if (gaps.length === 1) {
    // 只有臀腰差也算，但标成 partial：胸围没填时这一维的证据面窄一半
    const groove = gaps[0]
    const mid = (BODY_REF.waist_strong + BODY_REF.waist_flat) / 2
    want.waist = r2(clamp((groove - mid) / BODY_REF.waist_span, -1, 1))
    measure.waist_groove_cm = r1(groove)
    notes.push('胸围没量 ⇒ 腰线这维只用臀腰差算（partial）')
  }

  // —— 视觉腰位：腿身比偏短 ⇒ 想把视线上移（短款/塞腰头）；偏长 ⇒ 往下压 ——
  if (legRatio > 0) {
    const [lo, hi] = BODY_REF.leg_band
    if (legRatio < lo) want.length = r2(clamp01((lo - legRatio) / BODY_REF.leg_span))
    else if (legRatio > hi) want.length = r2(-clamp01((legRatio - hi) / BODY_REF.leg_span))
    else notes.push(`腿身比 ${r2(legRatio)} 在参考带内 ⇒ 这维不推拉`)
  }

  // —— 观感体量：偏瘦想加体量（浅/蓬），偏胖想收（深/顺） ——
  if (bmi > 0) {
    if (bmi >= BODY_REF.bmi_heavy) want.volume = -1
    else if (bmi >= BODY_REF.bmi_normal)
      want.volume = r2(-clamp01(0.3 + (bmi - BODY_REF.bmi_normal) / 4))
    else if (bmi < BODY_REF.bmi_thin) want.volume = r2(clamp01((BODY_REF.bmi_thin - bmi) / 4))
    else want.volume = 0
    // 条纹轴用同一个方向：想显窄 ⇒ 配对任务里横条更瘦（Koutsoumpis 2026），只当低权重修正
    want.pattern = want.volume
    // 但这方向文献自己就互相冲突（Thompson&Mikellidou 2011 / Swami&Harris 2012 /
    // Ashida 2013 / Chen&Peng 2026 结论不一），只敢在 BMI<25 时当低权重修正用；
    // 闸门关上时把 want.pattern 直接置 null ⇒ 界面不会挂着"条纹想收"却一维都没算它。
    // 闸门读的必须是 measure.bmi（已经 r1 取整那份），不能读原始 bmi：打分侧按 measure.bmi
    // 判 stripeOn，两边用两个数时原始 bmi 落在 24.95≤bmi<25.00（r1 把它抬成 25.0）会出现
    // "闸门放行、打分关掉" ⇒ want.pattern 留着而 pattern 这一维零贡献，
    // 正是这句话承诺不会出现的状态。
    if (measure.bmi >= BODY_REF.stripe_bmi_max) {
      want.pattern = null
      notes.push(
        `BMI ${r1(bmi)} ≥ ${BODY_REF.stripe_bmi_max} ⇒ 条纹方向这条不采用（文献结论互相冲突，只在偏瘦区间当低权重修正）`,
      )
    }
  }

  // —— 松量窗口（口径单点：合身层 fitSize.js 也调这个函数，两处不许各摆一套数） ——
  const win = easeWindowFor(bmi)
  const easeWindow = win ? win.range : null
  if (win) notes.push(`松量窗口 ${win.range.join('~')}cm（${win.note}）`)

  return { measure, want, ease_window: easeWindow, notes }
}

/**
 * 按 BMI 取"合适松量窗口"。
 * @param {number} bmi 没量（≤0 或非有限）⇒ 返回 null，不兜底
 * @returns {null|{range:number[], note:string, below:number}}
 */
function easeWindowFor(bmi) {
  const b = Number(bmi)
  if (!Number.isFinite(b) || b <= 0) return null
  const band = BODY_REF.ease_windows.find((x) => b < x.below)
  return band || null
}

// ------------------------------------------------------------
// 3. 修形向量：这件上衣往哪几个方向修、修多少
// ------------------------------------------------------------

/** 衣柜真字段优先：版型档 → 松量代理（cm）。合体≈Sakata fit 款下沿，宽松≈大码档 */
const FIT_STYLE_EASE = { 合体: 3, 宽松: 9 }
/** 面料厚薄 → 体量与肩上加量（C 档经验刻度） */
const FABRIC_BULK = { 薄: -0.4, 中: 0, 厚: 0.6 }
const FABRIC_SHOULDER = { 薄: -0.3, 中: 0, 厚: 0.4 }

/**
 * 结论文本词典（C 档）：只给上衣"贴标签"，不改规则文案一个字。
 * 认不到任何信号 ⇒ 各维全 null ⇒ 这件上衣不打分（不给一句话硬凑分数）。
 */
const LEXICON = {
  shoulder: [
    ['垫肩', 1],
    ['正肩', 0.6],
    ['小西装', 0.5],
    ['西装', 0.5],
    ['挺括', 0.4],
    ['泡泡袖', 0.6],
    ['荷叶边', 0.5],
    ['翻领', 0.3],
    ['衬衫', 0.25],
    ['落肩', -0.6],
    ['蝙蝠袖', -0.6],
    ['插肩', -0.4],
    ['吊带', -0.8],
    ['软针织', -0.4],
    ['针织', -0.25],
  ],
  waist: [
    ['收腰', 1],
    ['束腰', 0.9],
    ['腰线', 0.6],
    ['修身', 0.5],
    ['合体', 0.5],
    ['短款', 0.3],
    ['衬衫', 0.2],
    ['长款', -0.4],
    ['A字', -0.5],
    ['宽松', -0.5],
    ['直筒', -0.6],
    ['廓形', -0.6],
    ['开衫', -0.3],
    ['oversize', -0.7],
  ],
  length: [
    ['短款', 1],
    ['露腰', 1],
    ['露脐', 1],
    ['束进腰头', 0.9],
    ['扎进', 0.8],
    ['高腰', 0.6],
    ['及腰', 0.3],
    ['开衫', -0.3],
    ['中长', -0.6],
    ['大衣', -0.7],
    ['过胯', -0.8],
    ['过臀', -0.8],
    ['长款', -1],
  ],
  ease: [
    ['紧身', 1],
    ['修身', 2],
    ['合体', 3],
    ['合身', 3],
    ['直筒', 6],
    ['落肩', 8],
    ['宽松', 9],
    ['廓形', 9],
    ['大码', 11],
    ['oversize', 12],
  ],
}

/**
 * 这件算不算"上衣"（含外套）。现量：活库 user_wardrobe.category 存的是中文自由标签
 * （'衬衫'/'开衫'/'外套'…），库里从来没有 'top'/'outerwear' 这种英文键 ⇒ 只按英文键筛会一条不中。
 * 词表沿用 fullLookAdvisor 那一套，不再另立第二套口径；两种键都认，规则结论那条链路传的仍是英文。
 */
const TOP_CATEGORY_KEYS = ['top', 'outerwear']
function isTopCategory(category) {
  const c = String(category || '')
  if (TOP_CATEGORY_KEYS.includes(c.toLowerCase())) return true
  return hitsWord(TOP_WORDS, c) || hitsWord(OUTER_WORDS, c)
}

/**
 * 把上衣（衣柜一行 / 规则结论那句文本 / 已规范化的对象）翻成修形向量。
 * @param {string|object} top
 * @returns {{label:string, source:string, ease:number|null, shoulder:number|null,
 *            waist:number|null, length:number|null, volume:number|null, pattern:number|null,
 *            signals:string[]}}
 */
function describeTop(top) {
  const isRow = top && typeof top === 'object'
  const text = isRow
    ? [top.name, top.sub_category, top.pattern, top.style_tags && top.style_tags.join(' ')]
        .filter(Boolean)
        .join(' ')
    : String(top || '')
  const low = text.toLowerCase()

  const hit = (list) => {
    let best = null
    let at = Infinity
    for (const [word, val] of list) {
      const i = low.indexOf(word.toLowerCase())
      if (i >= 0 && i < at) {
        at = i
        best = val
      }
    }
    return best
  }

  const signals = []

  // 松量：衣柜真字段优先，其次文本词典（词典那条要写清是猜的）
  let ease = null
  const fitField = isRow ? String(top.fit_style || '').trim() : ''
  // 这三张表按衣橱里的自填文本查：'constructor' 之类原型键在普通查法下回一个函数，
  // `!= null` 挡不住它，于是松量变成"约 function Object(){...} cm"、肩线分成 NaN
  const fitEase = ownValue(FIT_STYLE_EASE, fitField)
  if (fitEase != null) {
    ease = fitEase
    signals.push(`版型=${fitField}→松量约${ease}cm`)
  } else {
    const e = hit(LEXICON.ease)
    if (e != null) {
      ease = e
      signals.push(`文本认版型→松量约${ease}cm`)
    }
  }

  const bulkField = isRow ? String(top.fabric_weight || '').trim() : ''
  const bulk = ownValue(FABRIC_BULK, bulkField)

  const shoulder = hit(LEXICON.shoulder)
  const waist = hit(LEXICON.waist)
  const length = hit(LEXICON.length)

  // 肩线：词典 + 面料厚薄（两个都认得到就取均值）
  const bulkShoulder = ownValue(FABRIC_SHOULDER, bulkField)
  let shoulderVal = shoulder
  if (shoulderVal != null && bulk != null) shoulderVal = r2(0.7 * shoulderVal + 0.3 * bulkShoulder)
  else if (shoulderVal == null && bulk != null) shoulderVal = bulkShoulder
  if (shoulder != null) signals.push(`肩线${shoulder > 0 ? '+' : '-'}${Math.abs(shoulder)}`)
  if (bulk != null)
    signals.push(`面料${bulkField}${bulk > 0 ? '加' : bulk < 0 ? '减' : '不动'}体量`)

  // 观感体量：色的明暗（resolveColor 认得出色名/hex 才有）+ 面料厚薄
  let lightnessDir = null
  let hex = null
  const colorInput = isRow ? top.color : null
  const resolved = resolveColor(colorInput || '') || resolveColor(text)
  if (resolved) {
    const lab = hexToLab(resolved)
    if (lab && Number.isFinite(lab.L)) {
      hex = resolved
      lightnessDir = r2(clamp((lab.L - 50) / 40, -1, 1)) // 深→负(收)，浅→正(胀)
    }
  }
  let volume = null
  if (lightnessDir != null && bulk != null) volume = r2(0.65 * lightnessDir + 0.35 * bulk)
  else if (lightnessDir != null) volume = lightnessDir
  else if (bulk != null) volume = bulk
  if (lightnessDir != null)
    signals.push(`色明度方向${lightnessDir > 0 ? '+' : '-'}${Math.abs(lightnessDir)}`)

  // 条纹方向：只在文本里确实出现"条"字时才有这一维
  let pattern = null
  if (/条/.test(text)) {
    if (/竖|直条/.test(text)) pattern = 1
    else if (/横/.test(text)) pattern = -1
    if (pattern != null) signals.push(pattern > 0 ? '竖条' : '横条')
  }

  return {
    label: isRow ? String(top.name || '').trim() || text.slice(0, 12) : text.slice(0, 24),
    source: isRow ? 'wardrobe' : 'text',
    text,
    hex,
    fit_style: fitField || null,
    fabric_weight: bulkField || null,
    ease,
    shoulder: shoulderVal == null ? null : r2(clamp(shoulderVal, -1, 1)),
    waist: waist == null ? null : r2(clamp(waist, -1, 1)),
    length: length == null ? null : r2(clamp(length, -1, 1)),
    volume,
    pattern,
    signals,
  }
}

// ------------------------------------------------------------
// 4. 打分：偏差向量 × 修形向量
// ------------------------------------------------------------

/** 同向=1、反向=0（抵消取均值不取乘积，免得某一维把总分打死 —— 08 §8 硬规矩 1） */
const align = (want, given) => r2(1 - Math.abs(want - given) / 2)

/** 松量：落在窗口内不扣分，越出窗口按每 6cm 掉到 0 */
function easeScore(window, ease) {
  if (!window || ease == null) return null
  const [lo, hi] = window
  const d = ease < lo ? lo - ease : ease > hi ? ease - hi : 0
  return r2(1 - clamp01(d / 6))
}

/**
 * 一件上衣对一个人的身材适配分。
 * @param {object} person 档案（含 height/weight/shoulder/bust/waist/hip/leg_length 中有的那些）
 * @param {string|object} top 规则结论那句文本，或衣柜一行
 * @param {object} [dev] 预先算好的偏差向量（批量排序时传进来，避免重复计算）
 * @returns {null|{score:number, axes:Array, axes_present:string[], axes_missing:string[],
 *                  person:object, top:object, evidence:string}}
 *          一维都凑不齐 ⇒ null（缺测不出分，不返回 0 分这种"看起来像判过"的东西）
 */
function topFitBody(person, top, dev) {
  const d = dev || bodyDeviation(person)
  const g = describeTop(top)
  const axes = []

  const add = (key, personVal, garmentVal, score, detail) => {
    axes.push({
      key,
      name_cn: AXIS_CN[key],
      score: score == null ? null : r2(score),
      weight: AXIS_WEIGHTS[key],
      person: personVal === undefined ? null : personVal,
      garment: garmentVal === undefined ? null : garmentVal,
      tier: AXIS_TIER[key],
      ...(detail || {}),
    })
  }

  add(
    'shoulder',
    d.want.shoulder,
    g.shoulder,
    d.want.shoulder != null && g.shoulder != null ? align(d.want.shoulder, g.shoulder) : null,
  )
  add(
    'waist',
    d.want.waist,
    g.waist,
    d.want.waist != null && g.waist != null ? align(d.want.waist, g.waist) : null,
  )
  add(
    'length',
    d.want.length,
    g.length,
    d.want.length != null && g.length != null ? align(d.want.length, g.length) : null,
  )
  add(
    'volume',
    d.want.volume,
    g.volume,
    d.want.volume != null && g.volume != null ? align(d.want.volume, g.volume) : null,
  )

  add(
    'ease',
    d.ease_window ? d.ease_window.join('~') + 'cm' : null,
    g.ease,
    easeScore(d.ease_window, g.ease),
  )

  // 条纹：BMI 闸门（Ashida 2013）+ 最低权重；want 为 null（BMI 没算出来）时也直接没有这一维
  const bmi = d.measure.bmi
  const stripeOn = bmi != null && bmi < BODY_REF.stripe_bmi_max
  add(
    'pattern',
    d.want.pattern,
    g.pattern,
    d.want.pattern != null && g.pattern != null && stripeOn
      ? align(d.want.pattern, g.pattern)
      : null,
    stripeOn
      ? undefined
      : {
          gated:
            bmi != null
              ? `BMI ${bmi}≥${BODY_REF.stripe_bmi_max} ⇒ 按 Ashida 2013 关掉`
              : 'BMI 没算出来 ⇒ 不启用',
        },
  )

  const present = axes.filter((a) => a.score != null)
  if (present.length === 0) return null

  const wsum = present.reduce((s, a) => s + a.weight, 0)
  const raw = present.reduce((s, a) => s + a.weight * a.score, 0) / wsum
  const score = Math.round(100 * raw)

  return {
    score,
    axes: present,
    axes_present: present.map((a) => a.key),
    axes_missing: axes.filter((a) => a.score == null).map((a) => a.key),
    person: { measure: d.measure, want: d.want, ease_window: d.ease_window, notes: d.notes },
    top: g,
    evidence:
      'B 方向(松量×BMI Liu 2006 / 深色收缩 Koutsoumpis 2021 / 肩宽侧更被偏好 Pazhoohi 2023) + C 刻度与权重(手拍,标定中)；' +
      '这一分只量"上衣往哪修、修多少"和这个人的偏差对不对得上，不是"好不好看"的判定',
  }
}

/**
 * 按身材给一摞上衣排序（衣柜里自己的上衣那条链路）。
 * @returns {{person_deviation:object, ranked:Array, unscored:number, unscored_reason:string[]}}
 */
function rankTopsByBody(person, tops) {
  const dev = bodyDeviation(person)
  const ranked = []
  const reasons = []
  for (const t of tops || []) {
    const res = topFitBody(null, t, dev)
    if (!res) {
      const name = t && t.name ? t.name : String(t).slice(0, 12)
      reasons.push(`${name}：这件上衣的版型/肩线/长短/色都没认出来，或这个人的尺寸没量 ⇒ 不打分`)
      continue
    }
    ranked.push({
      item: t,
      label: res.top.label,
      score: res.score,
      axes: res.axes.map((a) => ({
        key: a.key,
        name_cn: a.name_cn,
        score: a.score,
        person: a.person,
        garment: a.garment,
      })),
      axes_present: res.axes_present,
      axes_missing: res.axes_missing,
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return { person_deviation: dev, ranked, unscored: reasons.length, unscored_reason: reasons }
}

module.exports = {
  BODY_REF,
  meas,
  easeWindowFor,
  AXIS_WEIGHTS,
  AXIS_CN,
  AXIS_TIER,
  FIT_STYLE_EASE,
  FABRIC_BULK,
  LEXICON,
  bodyDeviation,
  describeTop,
  isTopCategory,
  topFitBody,
  rankTopsByBody,
}
