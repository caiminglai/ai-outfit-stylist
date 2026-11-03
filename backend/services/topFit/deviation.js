// 11-03 大文件拆分轮：这一段从 services/topFitBody.js 逐字搬来（2 偏差向量（原 topFitBody.js 第 2 节））。
// 函数体、注释、值表一处未改；⛔ 对外出口仍只走 topFitBody.js 那份再导出。

const { bmiValue } = require('../bmi')
const { clamp, clamp01, r1, r2, meas, BODY_REF } = require('./refs')

// ------------------------------------------------------------
// 2. 偏差向量：这个人身上"能被上衣改"的几维，各往哪个方向修（+加 / −收）
// ------------------------------------------------------------

/**
 * @param {object} person 档案（enrichProfile 的输入或输出都行，字段名同一套）
 * @param {object} [est] `estimateBodyDims()` 的结果；不传时回落到 `person.body_est`
 *        （enrichProfile 挂的那一格），所以现有五个调用点不改也能吃到估算值。
 * @returns {{measure:object, person_cm:object, person_cm_src:object, want:object,
 *            ease_window:number[]|null, notes:string[]}}
 *          某维的输入没量 ⇒ want 该维为 null，这一维就不进总分
 *
 * 🔴 第五阶段·第一步接线：`est` **只许补 `person_cm` 的 bust／shoulder 两格**
 * （`docs/依据/13-体型估算输入输出规范-20261020.md` §五 第 1、4 条）。
 * 上面 `measure`／`want` 用的仍是"量到的"那几个局部变量 ⇒ 同一个档案喂 est 与不喂 est，
 * `measure` 与 `want` 逐格相同（这条有单测断言）。补进来的那一格在 `person_cm_src`
 * 里标 `'estimated'`，`describeTop` 据此在覆盖率里按半格计、在 based_on 里写明是估的。
 */
function bodyDeviation(person, est) {
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

  // 10-19 第二阶段：成衣实测尺寸要和**人体净尺寸**做减法（成品胸围−净胸围＝松量、
  // 成品肩宽−净肩宽＝肩缝外移量），而上面那份 measure 全是比值与差值，拿不到原始 cm。
  // 这里把量到的四个原值随向量一起带出去，describeTop 只读这一份，不再自己去猜字段。
  // 没量的记 null（0 是 meas() 的内部哨兵，绝不外传——外传就变成"净胸围 0cm"这种假数）。
  //
  // 10-20 第五阶段·第一步：没量到的那两格（净胸围／净肩宽）允许由"身高+体重+年龄"估出来顶上。
  // 🔴 估算值只在这里进 `person_cm`，⛔ 不回写 `p.bust`／`p.shoulder`、⛔ 不参与上面的 measure／want。
  //    所以"这个人是苹果型""肩宽比在不在带内"这些结论跟以前一模一样，估的数碰不到（`13` §五 2~4 条）。
  let e = null
  if (est && est.estimated) e = est
  else if (p.body_est && p.body_est.estimated) e = p.body_est
  const estBust = e ? meas(e.bust_cm) : 0
  const estShoulder = e ? meas(e.shoulder_cm) : 0
  const estHip = e ? meas(e.hip_cm) : 0
  const person_cm = {
    height: height > 0 ? r1(height) : null,
    bust: bust > 0 ? r1(bust) : estBust > 0 ? r1(estBust) : null,
    shoulder: shoulder > 0 ? r1(shoulder) : estShoulder > 0 ? r1(estShoulder) : null,
    waist: waist > 0 ? r1(waist) : null,
    hip: hip > 0 ? r1(hip) : estHip > 0 ? r1(estHip) : null,
  }
  // 每格的出处（实测／估算／没量）。`describeTop` 靠它决定这一轴在覆盖率里算整格还是半格，
  // 报告与后台靠它把"估的"两个字带到用户眼前——⛔ 不许显示成"你填的胸围"（`13` §五 第 6 条）。
  const person_cm_src = {
    height: height > 0 ? 'measured' : null,
    bust: bust > 0 ? 'measured' : estBust > 0 ? 'estimated' : null,
    shoulder: shoulder > 0 ? 'measured' : estShoulder > 0 ? 'estimated' : null,
    waist: waist > 0 ? 'measured' : null,
    hip: hip > 0 ? 'measured' : estHip > 0 ? 'estimated' : null,
  }

  const want = { shoulder: null, waist: null, length: null, volume: null, pattern: null }
  const notes = []

  // 估算顶上的那几格必须在审计里露名（`13` §五 第 6 条：⛔ 不能让人读成"你填的胸围"）。
  if (person_cm_src.bust === 'estimated') {
    const from = e && e.bust_from
    if (from === 'waist_regression') {
      notes.push(
        `净胸围没量 ⇒ 按苏南青年女性三围回归（B=0.59×腰围+45.37）估的 ${person_cm.bust}cm ⇒ 只喂减法，这一轴按半格计`,
      )
    } else {
      notes.push(
        `净胸围没量 ⇒ 用身高体重按 GB/T 10000-2023 人群分布估的 ${person_cm.bust}cm（本站实测残差 ±2cm 上下）⇒ 只喂减法，这一轴按半格计`,
      )
    }
  }
  if (person_cm_src.shoulder === 'estimated')
    notes.push(
      `净肩宽没量 ⇒ 估的 ${person_cm.shoulder}cm（端到端残差男 ≤5.5%／女 ≤7.0%，偏瘦小个子那端会估高）⇒ 只喂减法，这一轴按半格计`,
    )
  if (person_cm_src.hip === 'estimated')
    notes.push(
      `净臀围没量 ⇒ 按苏南青年女性三围回归（H=0.55×腰围+53.96）估的 ${person_cm.hip}cm ⇒ 只喂减法，这一轴按半格计`,
    )

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

  return { measure, person_cm, person_cm_src, want, ease_window: easeWindow, notes }
}

/**
 * 成衣实测尺寸 → 修形向量的刻度（10-19 第二阶段新增；全部 C 档手拍，标定中）。
 * ⚠️ 表里的比例没有一条有国标原文：GB/T 10000-2023 的百分位本机读不到原值 ⇒【无法证真】，
 * 0.40 只是站内自建的"肩颈点到胯线的距离≈身高多少倍"原点，不当任何合格线。
 */
const GARMENT_REF = {
  /** 肩颈点(HPS)→胯线 ≈ 身高×0.40（衣长落在这一带＝下摆在胯） */
  hps_to_hip_ratio: 0.4,
  // S9（10-23 摘除）：原 `hps_to_waist_ratio: 0.24` 全仓只命中定义行本身、没有任何读取方，
  // 留在原地会让下一个改代码的人以为"腰位那一维"在参与计算（蓝图 §3.2 #9）。
  /** 下摆离胯线 12cm 算"视觉腰位"这一维拉满（C 档手拍） */
  hem_span_cm: 12,
  /** 腰头/收口 5cm 及以上算"腰线强调"拉满，0cm 算完全不强调（C 档手拍） */
  waistband_strong_cm: 5,
  /** 条纹这一格只认这四个自填值（不再从商品名里找"条"字） */
  pattern_values: { 竖条: 1, 竖条纹: 1, 横条: -1, 横条纹: -1 },
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

module.exports = {
  bodyDeviation,
  GARMENT_REF,
  easeWindowFor,
}
