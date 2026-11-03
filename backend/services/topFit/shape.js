// 11-03 大文件拆分轮：这一段从 services/topFitBody.js 逐字搬来（3 修形向量（原 topFitBody.js 第 3 节））。
// 函数体、注释、值表一处未改；⛔ 对外出口仍只走 topFitBody.js 那份再导出。

const { resolveColor, hexToLab } = require('../colorMetrics')
const { TOP_WORDS, OUTER_WORDS, hitsWord } = require('../fullLookAdvisor')
const { ownValue } = require('../../utils/common')
const {
  clamp,
  r1,
  r2,
  BODY_REF,
  FIT_TYPE_VALUES,
  FIT_TYPE_EASE,
  easeFromFitType,
  ESTIMATED_AXIS_WEIGHT,
  ESTIMATED_BODY_AXIS_WEIGHT,
} = require('./refs')
const { GARMENT_REF } = require('./deviation')

// ------------------------------------------------------------
// 3. 修形向量：这件上衣往哪几个方向修、修多少（10-19 第二阶段：只吃实测尺寸）
// ------------------------------------------------------------

/**
 * 面料厚薄三档（10-21 第十一阶段·第一步提到唯一真相源的位置）。
 * ⛔ 值表只准从这里取：`routes/wardrobe.js` 的录入校验、`services/wearPreference.js` 的
 * `warmth` 轴、以及未来的门店侧都吃这一份，抄第二份＝"改了那边忘了这边"那类病灶。
 */
const FABRIC_WEIGHT_VALUES = ['薄', '中', '厚']

/** 面料厚薄（衣橱里那一格由主人自己选：薄/中/厚）→ 观感体量加量。C 档经验刻度 */
const FABRIC_BULK = { 薄: -0.4, 中: 0, 厚: 0.6 }

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

/** 取一个"能进算术"的实测数：没填／非有限／≤0 一律当没量（0 不许冒充 0cm 的成衣） */
function cm(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 把**衣柜里的一行**翻成修形向量。
 *
 * 10-19 第二阶段把入参收窄成"必须是行对象"：传字符串（规则结论那句 `top_style` 自由文本）
 * 或 null ⇒ 直接返回一个各维全 null 的描述（`source:'no_row'`），这一件就不打分。
 * 改前这里会从 name/sub_category/pattern/style_tags 拼一句自由文本再认字（LEXICON 四张表），
 * 商品名写"廓形落肩卫衣"和只写"卫衣"能差出两三十分——那是把认字冒充成量出来的数。
 *
 * @param {object} row 衣柜一行（至少要有 shoulder_cm/bust_cm/length_cm/waistband_cm 里的某几个，
 *        或 fit_type 那一档版型——量不了尺寸的人走后者）
 * @param {object} dev `bodyDeviation()` 的结果，只用它的 `person_cm`（人体净尺寸，做减法用）
 *        与 `person_cm_src`（每一格是实测还是估算——决定这一轴在覆盖率里算整格还是半格）
 * @returns {{label:string, source:string, text:string, hex:string|null,
 *            fit_type:string|null,
 *            ease:number|null, shoulder:number|null, waist:number|null,
 *            length:number|null, volume:number|null, pattern:number|null,
 *            measured:string[], estimated:string[], body_estimated:string[], missing:string[],
 *            ease_src:string|null, shoulder_src:string|null,
 *            coverage:number, signals:string[]}}
 */
function describeTop(row, dev) {
  const isRow = row && typeof row === 'object'
  const p = (dev && dev.person_cm) || {}
  const src = (dev && dev.person_cm_src) || {}
  const signals = []
  const measured = []
  const missing = []
  // 由版型档**估**出来的轴（10-19 第三阶段·模块一）：与实测分开记，覆盖率里按半格计
  const estimated = []
  // 由**身体侧**估出来的轴（10-20 第五阶段·第一步：净胸围／净肩宽是身高体重推的）。
  // 同一轴同时被两侧估（松量会撞上）时只往 `estimated` 推一次 ⇒ 半格不叠乘（`13` §五 第 5 条）。
  const bodyEstimated = []
  const markBodyEstimated = (axisKey) => {
    bodyEstimated.push(axisKey)
    if (!estimated.includes(axisKey)) estimated.push(axisKey)
  }

  // 没有衣柜行 ⇒ 四格实测尺寸无从取，这一件不打分（不是打 0 分，是这一维整块缺席）
  if (!isRow) {
    return {
      label: String(row == null ? '' : row).slice(0, 24),
      source: 'no_row',
      text: String(row == null ? '' : row),
      hex: null,
      fit_style: null,
      fit_type: null,
      fabric_weight: null,
      ease: null,
      shoulder: null,
      waist: null,
      length: null,
      volume: null,
      pattern: null,
      measured,
      estimated,
      body_estimated: [],
      ease_src: null,
      shoulder_src: null,
      missing: ['shoulder', 'waist', 'ease', 'length', 'volume', 'pattern'],
      coverage: 0,
      signals: ['没有衣柜行（只有规则结论那句文本）⇒ 四格成品实测尺寸一个都取不到 ⇒ 这件不打分'],
    }
  }

  const gShoulder = cm(row.shoulder_cm)
  const gBust = cm(row.bust_cm)
  const gLength = cm(row.length_cm)
  // 腰头高这一格允许填 0（0＝"这件没有腰头/收口"是一个真实结论，与"没量"不同），
  // 所以它不能过 cm()：先分清"这格到底填了没"，再只挡非有限数与负数，0 照常进公式。
  const wbGiven =
    row.waistband_cm !== null &&
    row.waistband_cm !== undefined &&
    String(row.waistband_cm).trim() !== ''
  const wbRaw = Number(row.waistband_cm)
  const gWaistband = wbGiven && Number.isFinite(wbRaw) && wbRaw >= 0 ? wbRaw : null
  const text = [row.name, row.sub_category].filter(Boolean).join(' ')
  const label = String(row.name || '').trim() || text.slice(0, 12) || '（没填名字的一件）'

  const fitTypeGiven = typeof row.fit_type === 'string' ? row.fit_type.trim() : ''
  const fitType = FIT_TYPE_VALUES.includes(fitTypeGiven) ? fitTypeGiven : null
  if (fitTypeGiven !== '' && fitType === null) {
    signals.push(
      `版型那格填的「${fitTypeGiven.slice(0, 12)}」不在值域（${FIT_TYPE_VALUES.join('/')}）⇒ 不估`,
    )
  }

  // —— 松量：优先实测（成品胸围 − 净胸围）。量不了胸围、但选了版型 ⇒ 按版型区间中值**估**，
  //     这一维标记为 estimated、在覆盖率里只按半格计（10-19 第三阶段·模块一「注水」）。
  //     10-20 第五阶段·第一步：净胸围这一格本身可以是估的（`person_cm_src.bust==='estimated'`），
  //     减法照做、但这一轴同样按半格计——`bust_cm` 那格是成衣实测、`measured` 里照常记，
  //     人体侧的出处由 `ease_src`／`body_estimated` 说清楚，两套估算不叠乘。——
  let ease = null
  let easeSrc = null
  if (gBust != null && p.bust != null) {
    ease = r1(gBust - p.bust)
    measured.push('bust_cm')
    if (src.bust === 'estimated') {
      easeSrc = 'bust_est'
      markBodyEstimated('ease')
      signals.push(
        `松量＝成品胸围 ${gBust} − 净胸围 ${p.bust} = ${ease}cm；净胸围是身高体重估的（±2cm 上下）⇒ 这一格按半格计覆盖率`,
      )
    } else {
      easeSrc = 'bust_cm'
      signals.push(`松量＝成品胸围 ${gBust} − 净胸围 ${p.bust} = ${ease}cm`)
    }
    if (fitType) signals.push(`版型选了「${fitType}」但胸围量到了 ⇒ 只认实测，版型那格不参与算分`)
  } else if (fitType) {
    const est = easeFromFitType(fitType)
    ease = est
    easeSrc = 'fit_type'
    estimated.push('ease')
    signals.push(
      `松量按版型「${fitType}」估 = 区间 ${FIT_TYPE_EASE[fitType].range.join('~')}cm 的中值 ${est}cm（没量胸围 ⇒ 这一格按半格计覆盖率）`,
    )
  } else {
    missing.push('ease')
    if (gBust == null) signals.push('成品胸围没量 ⇒ 松量算不出')
    if (p.bust == null) signals.push('净胸围没量 ⇒ 松量算不出')
  }

  // —— 肩线：成品肩宽 − 净肩宽，换算成"肩宽÷身高"的百分点再除以 BODY_REF.shoulder_span，
  //     与 want.shoulder 用同一把尺子（want 那侧就是按百分点离带多远算出来的）——
  let shoulder = null
  let shoulderSrc = null
  if (gShoulder != null && p.shoulder != null && p.height != null) {
    const pts = ((gShoulder - p.shoulder) / p.height) * 100
    shoulder = r2(clamp(pts / BODY_REF.shoulder_span, -1, 1))
    measured.push('shoulder_cm')
    if (src.shoulder === 'estimated') {
      shoulderSrc = 'shoulder_est'
      markBodyEstimated('shoulder')
      signals.push(
        `肩缝外移 ${r1(gShoulder - p.shoulder)}cm = 肩宽比 ${r1(pts)} 个百分点 ⇒ 方向 ${shoulder > 0 ? '+' : ''}${shoulder}；净肩宽是估的（男 ≤5.5%／女 ≤7.0%）⇒ 这一格按半格计覆盖率`,
      )
    } else {
      shoulderSrc = 'shoulder_cm'
      signals.push(
        `肩缝外移 ${r1(gShoulder - p.shoulder)}cm = 肩宽比 ${r1(pts)} 个百分点 ⇒ 方向 ${shoulder > 0 ? '+' : ''}${shoulder}`,
      )
    }
  } else {
    missing.push('shoulder')
    signals.push('成品肩宽或净肩宽/身高没量齐 ⇒ 肩线方向算不出')
  }

  // —— 腰线强调：腰头/收口自身的高度。0cm＝这件明确直筒不强调，5cm 及以上＝拉满 ——
  let waist = null
  if (gWaistband != null) {
    waist = r2(clamp((2 * gWaistband) / GARMENT_REF.waistband_strong_cm - 1, -1, 1))
    measured.push('waistband_cm')
    signals.push(`腰头高 ${gWaistband}cm → 腰线强调 ${waist > 0 ? '+' : ''}${waist}`)
  } else {
    missing.push('waist')
    signals.push('腰头高没填 ⇒ 腰线强调这一维不算（0 与没填是两件事）')
  }

  // —— 视觉腰位：下摆落在人体哪条线上。衣长≈身高×0.40 时正落在胯线，往上为正（提腰）——
  let length = null
  if (gLength != null && p.height != null) {
    const hipLine = p.height * GARMENT_REF.hps_to_hip_ratio
    length = r2(clamp((hipLine - gLength) / GARMENT_REF.hem_span_cm, -1, 1))
    measured.push('length_cm')
    signals.push(
      `衣长 ${gLength}cm vs 胯线≈${r1(hipLine)}cm ⇒ 视觉腰位方向 ${length > 0 ? '+' : ''}${length}`,
    )
  } else {
    missing.push('length')
    signals.push('衣长或身高没量 ⇒ 视觉腰位算不出')
  }

  // —— 观感体量：两个真字段。色的 Lab 明度（A 档色差侧）+ 面料厚薄（主人自填档）——
  let lightnessDir = null
  let hex = null
  // 10-20 第六阶段·第一步接线：颜色栏空着、色写在商品名里（「雾霾蓝卫衣」）的那一行，
  // 改前这一格直接缺测。⚠️ 是"先试颜色栏、取不到才试名字"，不是把两串拼一起——
  // 拼串会把 '#111111' 这种 hex 变成非纯 hex 串，`resolveColor` 的 hex 分支只认整串是 hex（现量）。
  const colorField = typeof row.color === 'string' ? row.color.trim() : ''
  const nameField = typeof row.name === 'string' ? row.name.trim() : ''
  const resolved = resolveColor(colorField) || (nameField ? resolveColor(nameField) : null)
  if (resolved) {
    const lab = hexToLab(resolved)
    if (lab && Number.isFinite(lab.L)) {
      hex = resolved
      lightnessDir = r2(clamp((lab.L - 50) / 40, -1, 1)) // 深→负(收)，浅→正(胀)
      measured.push('color')
    }
  }
  const bulkField = typeof row.fabric_weight === 'string' ? row.fabric_weight.trim() : ''
  const bulk = ownValue(FABRIC_BULK, bulkField)
  if (bulk != null) {
    measured.push('fabric_weight')
    signals.push(`面料${bulkField}${bulk > 0 ? '加' : bulk < 0 ? '减' : '不动'}体量`)
  }
  let volume = null
  if (lightnessDir != null && bulk != null) volume = r2(0.65 * lightnessDir + 0.35 * bulk)
  else if (lightnessDir != null) volume = lightnessDir
  else if (bulk != null) volume = bulk
  if (lightnessDir != null)
    signals.push(
      `色明度 L*=${hex ? r1(hexToLab(hex).L) : '?'} → 方向 ${lightnessDir > 0 ? '+' : '-'}${Math.abs(lightnessDir)}`,
    )
  if (volume == null) missing.push('volume')

  // —— 条纹方向：只认 pattern 这一格的四个自填值，不再从商品名里找"条"字 ——
  let pattern = null
  const patField = typeof row.pattern === 'string' ? row.pattern.trim() : ''
  const pv = ownValue(GARMENT_REF.pattern_values, patField)
  if (pv != null) {
    pattern = pv
    measured.push('pattern')
    signals.push(pv > 0 ? '竖条' : '横条')
  } else {
    missing.push('pattern')
  }

  return {
    label,
    source: 'wardrobe',
    text,
    hex,
    fit_style: typeof row.fit_style === 'string' ? row.fit_style.trim() || null : null,
    fabric_weight: bulkField || null,
    garment_cm: {
      shoulder_cm: gShoulder,
      bust_cm: gBust,
      length_cm: gLength,
      waistband_cm: gWaistband,
    },
    ease,
    shoulder,
    waist,
    length,
    volume,
    pattern,
    measured,
    estimated,
    body_estimated: bodyEstimated,
    ease_src: easeSrc,
    shoulder_src: shoulderSrc,
    missing,
    fit_type: fitType,
    // 这件衣服的"实测覆盖率"：六个方向里有几个真的由填了数的格子算出来（10-19 第二阶段，
    // 打分侧按它打折——只量出一格的衣服不该和六格齐全的衣服拿一样的分）。
    // 10-19 第三阶段·模块一：版型估出来的那一维只按 **半格** 计 ⇒ 选一档版型买不到整格的分数。
    // 10-20 第五阶段·第一步：身体侧估出来的那一维同样半格；两侧都估这一轴只算 **一次** 半格
    //（`markBodyEstimated` 去重 ⇒ 0.5 不叠乘成 0.25，`13` §五 第 5 条）。
    coverage: r2(
      [
        ['shoulder', shoulder],
        ['waist', waist],
        ['ease', ease],
        ['length', length],
        ['volume', volume],
        ['pattern', pattern],
      ].reduce(
        (s, [k, v]) =>
          s +
          (v == null
            ? 0
            : bodyEstimated.includes(k)
              ? ESTIMATED_BODY_AXIS_WEIGHT
              : estimated.includes(k)
                ? ESTIMATED_AXIS_WEIGHT
                : 1),
        0,
      ) / 6,
    ),
    signals,
  }
}

module.exports = {
  FABRIC_WEIGHT_VALUES,
  FABRIC_BULK,
  isTopCategory,
  cm,
  describeTop,
}
