/**
 * 穿搭推荐引擎（主入口）
 * 从 Python app/services/recommend_engine.py + rule_engine.py 翻译
 *
 * 包含:
 * 1. getRecommendations: 旧版硬编码推荐(兼容)
 * 2. buildRecommendation: 规则引擎推荐主构建
 *
 * 10-29 拆分（行为不变，本文件 exports 面 20 键逐键不变）：
 *   色彩槽位 → ./recommend/colorSlots.js（取色／关系色展开／借色支路）
 *   规则匹配 → ./recommend/ruleMatcher.js（条件求值／matchRules／命中计数落库）
 *   排序     → ./recommend/ranker.js（RANK_* 常数／rankDims／rankAndTruncate）
 *
 * 11-03 大文件拆分轮（同样行为不变、20 键逐键不变，`test/splitReExportSurface.test.js` 钉住）：
 *   旧版硬编码推荐 → ./recommend/legacyRecs.js（getRecommendations 那一张兜底表）
 *   文案→身体维   → ./recommend/textBodyFit.js（ruleTextBodyFit）
 *   肤色取值口    → ./recommend/skinForColor.js（_skinForColor，18 号规范 §2.5 那唯一一处）
 *   衣橱候选      → ./recommend/wardrobeCandidates.js（buildRecommendation 的第 6 步整块，纯函数）
 */

const { enrichProfile, getBodyShapeOutfitAdvice, getFaceShapeGuide } = require('./profileEnricher')
const { explainMatchedRecommendation } = require('./ruleExplainer')
// 11-03 拆分轮：`colorMetrics` 那五个名字（colorFit／extractColors／skinToneToLab／skinUndertoneFromHue／
// synthesizeSkinLab）跟着 `_skinForColor`、`ruleTextBodyFit`、第 6 步一起搬进 ./recommend/ 下的三个模块，
// 本文件不再直接取色——⛔ 取色与肤色合成的口径只有一个来路，就是那三个模块。
const { asText } = require('../utils/common')
const { bodyDeviation } = require('./topFitBody')
const { generateWardrobeOutfits } = require('./wardrobeOutfitGenerator')
// 第十三阶段·第一步 §三：款式词／面料词 → 版型档的推断层（⛔ 值域与松量映射都在 topFitBody 那边，这里只认档）
// ⇒ 11-03 起这一层的消费者是 `./recommend/textBodyFit.js`（`inferFitType`／`inferFabricWeight` 在那边用）
const { topSpec } = require('./topFromBody')
// 10-20 第八阶段·一e：隐性偏好乘子（乘子本身在 recommend/ranker.js 里用；画像与乘子的口径全在 wearPreference.js 里）
// 参数一律从那一侧取，排序层不许自己另抄一份数（同一件事两层各持一份是本项目反复清扫的病灶）
// 🔴 10-21 第十一阶段·第一步（`docs/依据/19` §五）：进乘子的轴从两根升到四根
// （色族／版型／场合／温度档厚薄）＋复穿次数一条特判，所以这里多引两个常数与一个词表归一函数
// ——`normalizeWeatherLevel` 只认 weatherService 那五个词，⛔ 排序层不抄第二份阈值。
const {
  buildPreference,
  normalizeWeatherLevel,
  MIN_SAMPLES: PREF_MIN_SAMPLES,
  FACTOR_MIN: PREF_FACTOR_MIN,
  FACTOR_MAX: PREF_FACTOR_MAX,
  LIFT_TOP: PREF_LIFT_TOP,
  LIFT_SEEN: PREF_LIFT_SEEN,
  LIFT_UNSEEN: PREF_LIFT_UNSEEN,
  REPS_STEP: PREF_REPS_STEP,
  REPS_MAX: PREF_REPS_MAX,
  MULTIPLIER_AXES: PREF_MULTIPLIER_AXES,
} = require('./wearPreference')
// 10-21 第九阶段·第一步：协同过滤乘子（`docs/依据/17` §四）。与偏好乘子同层、同界、同样默认隐身：
// 库里 `item_feedback` 0 行 / 没身份 / 没体型 / `COLLAB_FILTER_ENABLED=0` ⇒ 每条恰好 ×1，名次一个字不变。
// ⛔ 它不进三维出账、不进回归自变量，只在总分末尾乘一刀（退出机制与措辞红线都在 §4.3/§4.4）。
const { buildCohortModel, COLLAB_CONFIG } = require('./collabFilter')
const { buildBreakdown } = require('./conflictBreakdown')
// 只取"库里这几行有没有"这个数，进 `_computed.ranking.collab.signals_in_db` 给报告与台账看
// （⛔ 它不参与任何决策：这一层读的是同组别人的分，不是"库里有多少行"）
const { countItemFeedback } = require('./itemFeedback')
// 10-29 拆分进来的三个子模块（各自文件头有职责与口径出处）
const {
  outfitColorParts,
  RELATIONAL_WORDS,
  relationalTargetsOf,
  relationalLedger,
  resolveRelationalSlots,
  firstSpecificColor,
  scoreTopColor,
} = require('./recommend/colorSlots')
const { CATEGORIES, matchRules, _flushHitCounts } = require('./recommend/ruleMatcher')
const {
  RANK_WEIGHTS,
  OCCASION_WEIGHTS,
  COLOR_BORROW_WEIGHT,
  RANK_RULE_REF,
  RANK_COVERAGE_FLOOR,
  RANK_ALGO_ABSENCE_PENALTY,
  RANK_TOP_N,
  RANK_MIN_ALGO_IN_TOP,
  rankDims,
  rankAndTruncate,
} = require('./recommend/ranker')
// 11-03 拆分轮：旧版硬编码推荐／文案→身体维／肤色取值口／衣橱候选那四段搬到 ./recommend/ 下四个模块
const { getRecommendations } = require('./recommend/legacyRecs')
const { ruleTextBodyFit } = require('./recommend/textBodyFit')
const { _skinForColor } = require('./recommend/skinForColor')
const { collectWardrobeTops } = require('./recommend/wardrobeCandidates')

/**
 * 构建完整的推荐结果
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @param {{sessionId?:string, userId?:number}|null} [identity] - 这个人的身份（第八阶段·一e）。
 *   只用来现算**隐性偏好画像**（穿搭日记 → ±5% 乘子）。⛔ 默认 null＝不查库、乘子恒为 1；
 *   传了身份但日记 0 行也一样是 1（「零样本零影响」那条断言，见 docs/依据/16 §五）。
 * @param {object} [opts] 第十二阶段·第一步（docs/依据/20 §五）的出账开关。⛔ 默认 {}＝与四参数时代逐字节相同，
 *   这条由 `recommendEngine.test.js` 里"默认路径逐字节不变"那一块锁住。两个键：
 *   `deep_analysis` 让 store 档也填 `algorithm_analysis`（**只放开出账，⛔ 绝不改 mode**：
 *     `matchRules` 按 mode 过滤规则（见上面 `:402` 那句 SQL），换模式＝换名单，那会让付费报告
 *     与顾客免费时看到的那 8 条对不上——那是假承诺，比少发一节严重得多）；
 *   `keep_ranked_out` 把被 Top N 截掉的那一尾投影进 `_computed.ranking.beyond_top_n`。
 * @returns {object} 按类别分组的推荐结果
 */
function buildRecommendation(
  profile,
  mode = 'store',
  incrementHitCount = true,
  identity = null,
  opts = {},
) {
  // 1. 画像增强:计算 BMI、体型、腰臀比、肤色匹配、脸型建议等
  const enriched = enrichProfile(profile)
  // 肤色进色彩维的唯一读数口（第十阶段·第一步，docs/依据/18 §2.5）：整次推荐只解一次，
  // 下面三处 colorFit 全用这一个值，⛔ 不许再在别处拼 skin_tone 字符串。
  const skinColor = _skinForColor(enriched, profile)
  // 身材偏差向量整次推荐只算一次(topFitBody 只吃连续量,不吃 body_type 这类离散标签)
  const bodyDev = bodyDeviation(enriched)

  const result = {
    穿搭: [],
    妆容: [],
    发型: [],
    配饰: [],
    姿势: [],
    衣橱搭配: [],
    _mode: mode,
    _computed: {},
    algorithm_analysis: null,
  }

  // 2. 填充 _computed(供前端展示数据概览)
  if (enriched.bmi) {
    result._computed.bmi = enriched.bmi
    result._computed.bmi_level = enriched.bmi_level
  }
  if (enriched.body_shape) {
    result._computed.body_shape = enriched.body_shape
    result._computed.body_shape_key = enriched.body_shape_key
  }
  if (enriched.wh_ratio) {
    result._computed.wh_ratio = enriched.wh_ratio
    result._computed.wh_status = enriched.wh_status
  }
  if (enriched.leg_ratio) {
    result._computed.leg_ratio = enriched.leg_ratio
  }
  if (enriched.shoulder_ratio) {
    result._computed.shoulder_ratio = enriched.shoulder_ratio
  }
  if (enriched.color_match) {
    result._computed.color_match = enriched.color_match
    result._computed.color_avoid = enriched.color_avoid
  }
  // 肤色那一维"是从哪来的"要能拆账（第十阶段·第一步，docs/依据/18 §2.4）。
  // ⛔ 这三格只拆账：不是置信度、不进任何公式、也⛔ 不进回归自变量（18 §三 第 8 条）。
  //    skin_source 只有 photo_sample / manual / null 三种取值——改前规范写的第四种
  //    'archive' 在引擎里判不出来（档案合并发生在 routes/recommend.js，到这儿已经分不开），
  //    这笔订正记在 18 §九。
  result._computed.skin_source = skinColor.source
  result._computed.skin_hue = skinColor.hue
  result._computed.skin_undertone = skinColor.undertone
  if (enriched.color_season) {
    result._computed.color_season = enriched.color_season
  }
  if (enriched.color_season_12) {
    result._computed.color_season_12 = enriched.color_season_12
  }
  if (enriched.kibbe_type) {
    result._computed.kibbe_type = enriched.kibbe_type
  }
  // 上衣身材分那一维的原始材料:这个人的实测数 + 每维想往哪修(+加 / −收,null=没量就不算)
  // 一维都拉不出来时不写这个键 ⇒ 前端显示"还打不了分",而不是拿 0 分当结论
  const hasDeviation =
    Object.values(bodyDev.want).some((v) => v != null) || bodyDev.ease_window != null
  if (hasDeviation) {
    const deviation = { want: bodyDev.want, notes: bodyDev.notes }
    for (const [k, v] of Object.entries(bodyDev.measure)) if (v != null) deviation[k] = v
    if (bodyDev.ease_window) deviation.ease_window_cm = bodyDev.ease_window
    if (enriched.wh_ratio) deviation.wh_ratio = enriched.wh_ratio
    result._computed.body_deviation = deviation
  }
  // 上衣处方:不读衣橱、不给购物建议,只按这个人的身材与肤色出"该选成什么样"
  // 六轴一个都算不出且肤色也认不出 ⇒ 这个键整块缺席(缺测不出处方)
  const spec = topSpec(enriched)
  if (spec) result.top_spec = spec
  // 八字五行(第二条判定依据);没填出生日期时整块缺席
  if (enriched.bazi) {
    result._computed.bazi = enriched.bazi
    result._computed.bazi_today = enriched.bazi_today
  }

  // 3. 填充 algorithm_analysis(个人模式的深度分析报告)
  //    🔴 第十二阶段·第一步（docs/依据/20 §五 第 1 条）：`opts.deep_analysis` 让门店档也出这一节，
  //    这是"付费那份细账"的主要内容物。⛔ 不改 mode：名单由 `matchRules` 按 mode 过滤规则决定，
  //    换 mode 就换了名单，付费报告就会与顾客免费时看到的那 8 条对不上。
  if (mode === 'personal' || opts.deep_analysis) {
    const sections = []
    const metrics = []

    // 数字摘要:身高+体重才有 BMI,三围才有体型/腰臀比
    if (Number.isInteger(enriched.age))
      metrics.push(`年龄 ${enriched.age}${enriched.age_range ? `(${enriched.age_range})` : ''}`)
    if (enriched.bmi) metrics.push(`BMI ${enriched.bmi}(${enriched.bmi_level})`)
    if (enriched.body_shape) metrics.push(`体型 ${enriched.body_shape}`)
    if (enriched.wh_ratio) metrics.push(`腰臀比 ${enriched.wh_ratio}`)
    if (enriched.leg_ratio) metrics.push(`腿身比 ${enriched.leg_ratio}`)
    if (enriched.shoulder_ratio) metrics.push(`肩宽比 ${enriched.shoulder_ratio}`)
    if (enriched.color_season) metrics.push(`色彩 ${enriched.color_season}`)
    if (enriched.color_season_12) metrics.push(`十二型 ${enriched.color_season_12}`)
    if (enriched.kibbe_type) metrics.push(`风格型 ${enriched.kibbe_type}`)
    if (enriched.bazi)
      metrics.push(
        `日主${enriched.bazi.day_master_element}·喜用${enriched.bazi.favorable.join('')}`,
      )

    // 体型分析
    if (enriched.body_shape_key) {
      const outfitAdvice = getBodyShapeOutfitAdvice(enriched.body_shape_key)
      sections.push({
        title: `体型分析:${enriched.body_shape}`,
        advices: [outfitAdvice],
      })
    }

    // 脸型分析
    if (enriched.face_shape) {
      const faceGuide = getFaceShapeGuide(enriched.face_shape)
      sections.push({
        title: `脸型分析:${enriched.face_shape}`,
        advices: [
          faceGuide.face_analysis,
          `发型建议:${faceGuide.hair_advice}`,
          `妆容建议:${faceGuide.makeup_advice}`,
          `修容建议:${faceGuide.contour_advice}`,
          `配饰建议:${faceGuide.accessory_advice}`,
        ],
      })
    }

    // 三庭五眼比例分析
    if (enriched.proportion_analysis) {
      sections.push({
        title: '三庭五眼比例',
        advices: [
          enriched.proportion_analysis,
          `发型建议:${enriched.proportion_hair}`,
          `妆容建议:${enriched.proportion_makeup}`,
          `修容建议:${enriched.proportion_contour}`,
          `配饰建议:${enriched.proportion_accessory}`,
        ].filter(Boolean),
      })
    }

    // 肤色配色建议
    if (enriched.color_match) {
      sections.push({
        title: '肤色配色建议',
        advices: [
          `适合色系:${enriched.color_match}`,
          enriched.color_avoid || '',
          enriched.color_reason || '',
        ].filter(Boolean),
      })
    }

    // 体态建议
    if (enriched.posture_advice) {
      sections.push({
        title: '体态建议',
        advices: [enriched.posture_advice],
      })
    }

    // 八字五行(第二条判定依据;没填出生日期时整块缺席)
    if (enriched.bazi) {
      const b = enriched.bazi
      let missingLine = ''
      if (b.missing.length) {
        const gap = b.missing.filter((e) => b.favorable.includes(e))
        missingLine =
          `命局所缺:${b.missing.join('、')}` +
          (gap.length
            ? `（其中${gap.join('、')}正是你的喜用，宜补）`
            : '（缺的不一定是喜用，补的是喜用）')
      }
      sections.push({
        title: `八字五行:日主${b.day_master}${b.day_master_element}(${b.strength})`,
        advices: [
          `四柱 ${b.pillars.join(' ')}（${b.precision}${b.precision === '三柱' ? '，未填时辰' : ''}）`,
          b.summary,
          `宜用颜色:${b.favorable_colors}`,
          `宜用方位:${b.favorable_direction}`,
          // 两条依据会打架(喜用色与肤色适配色不一定同),这里给出取舍口径
          '两条依据冲突时:大面积的外衣跟肤色与体型走,喜用色放在内搭、配饰、唇色、鞋袜这些小块面积上',
          missingLine,
        ].filter(Boolean),
      })
    }

    // 今日参考(日期依据:当日干支与个人喜用的生克)
    if (enriched.bazi_today) {
      sections.push({
        title: `今日参考:${enriched.bazi_today.ganzhi}日(${enriched.bazi_today.tone})`,
        advices: [enriched.bazi_today.note],
      })
    }

    if (sections.length > 0) {
      result.algorithm_analysis = { sections, metrics }
    }
  }

  // 4. 规则引擎匹配(使用增强后的 profile)
  // S5（10-19 蓝图短期项，10-23 落）：五个品类的命中在内存里攒着，全部评估完一次批量落库。
  // 改前每条命中各发一条独立 UPDATE、每次还重新 prepare ⇒ 一场 11~14 次写（蓝图 §3.4 结论二现量）。
  const hitCollector = []
  for (const cat of CATEGORIES) {
    const matched = matchRules(enriched, mode, cat, incrementHitCount, hitCollector)
    for (const m of matched) {
      const recommendation = {
        group_id: m.group_id,
        group_name: m.group_name,
        priority: m.priority,
        score: m.score,
        feedback: m.feedback,
        evidence_level: m.evidence_level ?? null,
      }
      Object.assign(recommendation, m.actions)
      // 注入可解释性说明:这条推荐命中了哪些条件(中文人话,供前端展示"为什么推荐")
      recommendation.explanation = explainMatchedRecommendation(m, m.condition_details)
      // 色度学贴合分:上衣结论里认得出色名 + 肤色档能给 Lab 锚点,两个都有才出分;
      // 缺任一侧就不写这个字段(空柜不编造)。权重是 C 档手拍值,见 colorMetrics.js 文件头。
      // 上衣字段在规则动作里叫 top_style,兜底硬编码那条叫 outfit_top,两个都认。
      const topText = recommendation.top_style || recommendation.outfit_top
      // 整身呼应（10-19 第一阶段·止血第 4 条建，10-20 第六阶段·第一步接线）：
      // 上衣/下装/鞋三处自由文本 ＋ 规则自带的 color_combo，逐槽 extractColors 切多色后
      // 两两 ΔE00 按面积加权 ⇒ 一个 0~100 的呼应分。色名认不出的那件、以及只有"深色/浅色"
      // 这种没有 hex 的明度档都被丢掉，凑不够两件就不出分（harmony=null ⇒ colorFit 退回纯
      // 对比侧，不拿假数据凑）。面积写法按穿着面积的上衣/下装为主、鞋占小头，combo 与三处
      // 重复的色不重复计权（口径见 outfitColorParts 的①~④）。
      // 面积是 C 档手拍值，与 60-30-10 那类面积律无关（§8.2 已撤回该律）。
      const harmonySlots = resolveRelationalSlots([
        { label: '上衣', text: topText, area: 0.4 },
        {
          label: '下装',
          text: recommendation.bottom_style || recommendation.outfit_bottom,
          area: 0.4,
        },
        { label: '鞋', text: recommendation.shoe_style || recommendation.outfit_shoe, area: 0.2 },
        // ↓ 这一条就是"接线"本身：库里 167 条结构化配色，改前完全不进分
        {
          label: '配色',
          text: recommendation.color_combo || recommendation.outfit_color,
          area: 0.4,
        },
      ])
      const harmonyParts = outfitColorParts(harmonySlots)
      const comboText = recommendation.color_combo || recommendation.outfit_color
      // §二·4：上衣那一格写的是"与鞋同色"这种关系时，展开出来的色走 scoreTopColor 的 relational 支路
      const topRelational = (harmonySlots.find((s) => s.label === '上衣') || {}).relational || null
      const scored = scoreTopColor(skinColor.lab, topText, harmonyParts, comboText, topRelational)
      const { fit, harmony } = scored
      if (fit) recommendation.color_fit = fit
      // 色彩这一维"是怎么来的"要能拆账：basis 区分实测色名／句内扫描／只有明度档，
      // color_parts 是实际参与呼应的件数（0~1 件时 harmony 本来就不出分）。
      recommendation.color_basis = fit ? fit.basis : null
      recommendation.color_parts = scored.color_parts
      // 🔴 §二·3 借色那一条的三笔出处。⛔ 对外措辞受 `21` §一·1 约束：不许写成"系统识别出你的
      //    上衣是驼色"，只能说"按整套搭配的配色串把驼色当上衣色算的（出处：本组配色第一色，权重已打折）"。
      //    §二·4 的关系色走同一个 `color_borrowed` 闸门（都不是这一格自己写的色），出处多一格 `relational_from`。
      recommendation.color_basis_source = scored.source
      if (scored.borrowed) {
        recommendation.color_borrowed = true
        recommendation.color_borrowed_from = scored.borrowed_from
        recommendation.color_borrowed_position = scored.borrowed_position
        recommendation.color_top_band = scored.top_band
        recommendation.color_relational_from = scored.relational_from
      }
      // §二·4 的收口账：哪一格只写了"跟谁同色"、色是从哪一格取来的。
      // 库里现在只有两行吃到这一条（id=1102／1224 的「同色西裤」），⛔ 它不改任何分数——
      // 被指格的色本来就已经在呼应里了，去重那条（口径④）会把展开的这份吃掉，
      // 所以它的唯一作用是让"上下同色"这种人话第一次有可拆的出处（现量见 21 §十二）。
      const relLedger = relationalLedger(harmonySlots)
      if (relLedger) recommendation.color_relational = relLedger
      // 呼应分单独留一份：报告要拆账、第二阶段重排要把它当独立一维用，不能只藏在总分里
      if (harmony) {
        recommendation.color_harmony = harmony.score
        recommendation.color_harmony_pairs = harmony.pairs.length
      }
      // 🔴 第十三阶段·第一步 §三·4：这一维**不再"整块缺席"**，但也不是"量出来了"。
      // 旧口径（10-19 第二阶段）：规则结论给的是"亮色上衣"这种自由文本，一格实测都取不到 ⇒ 身体维整块缺席。
      // 现口径：文案里认得出**恰好一个**版型档（修身／合身／宽松／廓形）时，走 `ruleTextBodyFit`
      //   复用现成的 `topFitBody`——松量按那一档的区间中值估、覆盖率按半格计，都是那一层原有的分支，
      //   ⛔ 排序层不另打折、⛔ 不复辟"从中文猜 cm"（10-19 第二阶段废除的那条）。
      // 认不出（0 档或"合身＋宽松"这种 ≥2 档冲突）⇒ 与改前逐条相同：整块缺席、吃算法缺席惩罚。
      const ruleFit = ruleTextBodyFit(topText, bodyDev)
      if (ruleFit) {
        recommendation.body_fit = ruleFit.body_fit
        recommendation.fit_type_inferred = ruleFit.fit_type
        recommendation.fabric_weight_inferred = ruleFit.fabric_weight
      }
      result[cat].push(recommendation)
    }
  }

  // 5. 兜底:规则引擎未命中时用旧版硬编码推荐
  const scenario = enriched.scenario || profile.scenario || '通勤'
  if (result['穿搭'].length === 0) {
    const fallback = getRecommendations(
      enriched.skin_tone || profile.skin_tone,
      enriched.face_shape || profile.face_shape,
      scenario,
    )
    for (const item of fallback) {
      const entry = {
        group_name: '默认推荐',
        priority: 0,
        score: 0,
        evidence_level: null, // 兜底条目没走规则库,档位留空(后台与前端显示"未标注")
        outfit_top: item.top_style,
        outfit_bottom: item.bottom_style,
        outfit_color: item.color_combo,
        outfit_reason: item.reason,
      }
      // 兜底那几条也只有自由文本 ⇒ 身材这一维同样缺席（口径与规则那一段一致，不再认字）
      const topText = entry.outfit_top
      // 兜底表本身带结构化配色 `color_combo`（'白+蓝' 这类 15 条），与规则那一段同一个口径进呼应
      // 兜底这 15 条写的是"白色衬衫"这种死文案，⛔ 没有一句关系色 ⇒ 这一层今天对它是个空转；
      // 接它只为"取色口径只有一处"，改文案时不必再来这里补一次线。
      const harmonySlots = resolveRelationalSlots([
        { label: '上衣', text: topText, area: 0.4 },
        { label: '下装', text: entry.outfit_bottom, area: 0.4 },
        { label: '配色', text: entry.outfit_color, area: 0.4 },
      ])
      const harmonyParts = outfitColorParts(harmonySlots)
      const topRelational = (harmonySlots.find((s) => s.label === '上衣') || {}).relational || null
      const scored = scoreTopColor(
        skinColor.lab,
        topText,
        harmonyParts,
        entry.outfit_color,
        topRelational,
      )
      const { fit, harmony } = scored
      if (fit) entry.color_fit = fit
      entry.color_basis = fit ? fit.basis : null
      entry.color_parts = scored.color_parts
      // 兜底那几条同样吃 §二·3 的借色口径（'深色西裤' 这类只有明度档的行就是靠这一条出色）
      entry.color_basis_source = scored.source
      if (scored.borrowed) {
        entry.color_borrowed = true
        entry.color_borrowed_from = scored.borrowed_from
        entry.color_borrowed_position = scored.borrowed_position
        entry.color_top_band = scored.top_band
        entry.color_relational_from = scored.relational_from
      }
      // §二·4 的收口账（与规则那一段同一个口径；兜底这 15 条今天没有一句关系色 ⇒ 回 null、不写这个字段）
      const relLedger = relationalLedger(harmonySlots)
      if (relLedger) entry.color_relational = relLedger
      if (harmony) {
        entry.color_harmony = harmony.score
        entry.color_harmony_pairs = harmony.pairs.length
      }
      result['穿搭'].push(entry)
    }
  }

  // 6. 衣橱里量过尺寸的上衣进候选集（10-19 第二阶段「通脉」；10-21 第九阶段·第一步放开门店模式）
  //    口径注释与实现全在 ./recommend/wardrobeCandidates.js（逐字搬走，一处未改）。
  const wardrobeTops = collectWardrobeTops(profile, { skinLab: skinColor.lab, bodyDev })

  // 7. 算法重排 + Top N（穿搭这一类；见本节开头"算法重排"）
  //    偏好画像整次推荐只现算一次（不在 rankDims 里逐条查库——那是 8×N 次 SELECT）。
  //    ⛔ 没有身份就压根不查：门店模式那条链路（routes/recommend.js）传的是 null，
  //    这一层对它完全透明，Top 8 与改前逐条相同。
  //    🔴 10-21 第十一阶段·第一步：第二参数＝**本次请求带来的天气档**（`19` §五 第 1 条）。
  //    它走的是 `profile` 透传那同一条路（与 `occasion` 一个来路：请求里给、只当这一屏的输入，
  //    ⛔ 不落库、⛔ 不进长期档案），表外值一律当没带（`normalizeWeatherLevel`）——
  //    没带就是"这一轴整块缺席"，⛔ 不许拿 22℃ 那种猜出来的档去乘分（硬规矩 2）。
  const requestWeatherLevel = normalizeWeatherLevel(enriched.weather_level)
  const pref =
    identity && (identity.sessionId || identity.userId)
      ? buildPreference(identity, requestWeatherLevel)
      : null
  // 协同过滤 cohort（`17` §4.1~4.2）：体型向量读 `bodyDeviation().person_cm` 那一份——
  // 实测优先、缺格由第五阶段的估算顶上，出处（measured/estimated）已经在那条链路里带着，
  // ⛔ 这一层不再自己猜第三个数。连身高都没有 ⇒ `buildCohortModel` 返回 null ⇒ 整层隐身。
  const pv = bodyDev.person_cm || {}
  const collabModel = buildCohortModel(
    identity && (identity.sessionId || identity.userId) ? identity : null,
    pv.height != null ? { height: pv.height, bust: pv.bust, shoulder: pv.shoulder } : null,
    asText(enriched.occasion) || null,
    // 🔴 10-21 第十一阶段：温度档同样喂给协同过滤的第二路（`19` §六）——
    // 没带 ⇒ 那一整路缺席（乘子恰好 1），⛔ 不替用户猜一档；星级那一路不受这一格影响。
    requestWeatherLevel,
  )
  result['穿搭'] = rankAndTruncate(result['穿搭'], wardrobeTops, pref, collabModel, scenario, opts)
  // 可解释穿搭评估：给前 N 条每条挂一个逐维度冲突拆解（色彩 + 廓形），
  // 不重新算分，只从 color_fit / body_fit 的子分里归因。⛔ 不影响名次。
  for (const rec of result['穿搭']) {
    const breakdown = buildBreakdown(rec)
    if (breakdown.length > 0) rec.conflict_breakdown = breakdown
  }

  // 衣橱搭配生成：从用户已有衣物中组合搭配方案（借鉴 AI衣橱）
  // ⛔ 不影响穿搭排序，只作为"你衣橱里能搭出什么"的补充输出
  if (Array.isArray(profile.wardrobe_items) && profile.wardrobe_items.length > 0) {
    result['衣橱搭配'] = generateWardrobeOutfits({
      wardrobe_items: profile.wardrobe_items,
      occasion: profile.occasion || profile.scenario,
      limit: 5,
    })
  }
  result._computed.ranking = {
    weights: RANK_WEIGHTS,
    occasion: scenario,
    occasion_weights: OCCASION_WEIGHTS[scenario] || null,
    rule_ref: RANK_RULE_REF,
    coverage_floor: RANK_COVERAGE_FLOOR,
    algo_absence_penalty: RANK_ALGO_ABSENCE_PENALTY,
    top_n: RANK_TOP_N,
    min_algo_in_top: RANK_MIN_ALGO_IN_TOP,
    algo: result['穿搭']._algo || null,
    candidates: result['穿搭'].length + (result['穿搭']._ranked_out || 0),
    ranked_out: result['穿搭']._ranked_out || 0,
    from_wardrobe: result['穿搭'].filter((e) => e.source === 'wardrobe').length,
    // 隐性偏好这一层出了账（第八阶段·一e）。⛔ 它不进上面那三个权重，是出完总分之后的一个界内乘子。
    preference: {
      enabled: !!pref,
      ready: !!(pref && pref.factor_ready),
      samples: pref ? pref.samples : 0,
      min_samples: PREF_MIN_SAMPLES,
      range: [PREF_FACTOR_MIN, PREF_FACTOR_MAX],
      lifts: {
        top: PREF_LIFT_TOP,
        seen: PREF_LIFT_SEEN,
        unseen: PREF_LIFT_UNSEEN,
        // 复穿这一条自己一对数（`19` §五 第 2 条）：`lift = min(max, step×ln(1+次数))`，⛔ 只加不减
        reps: { step: PREF_REPS_STEP, max: PREF_REPS_MAX },
      },
      axes: PREF_MULTIPLIER_AXES,
      // 本次请求带来的天气档（归一后；没带＝null＝`warmth` 这一轴整块缺席）。出账要能自证吃了哪一档。
      weather_level_used: pref ? (pref.weather_level_used ?? null) : null,
      // 复穿这一轴的规模（不 dump 整张 id→次数表：那是这个人的明细，出账只要两个数）
      reps: pref && pref.reps ? pref.reps : { counted_items: 0, max_reps: 0 },
      provenance: pref ? pref.provenance : '本次没有身份，不读日记 ⇒ 乘子恒为 1',
      // 前 N 条里实际被这一层动过的有几条（0 就是"这一层今天没参与"，报告里要能自证）
      touched_in_top: result['穿搭'].filter((e) => e.rank && e.rank.preference_factor !== 1).length,
      dims: pref ? pref.dims : null,
    },
    // 协同过滤这一层的账（第九阶段·第一步）。⛔ 对外只说"同组几人、均值几星"（§4.4 隐私红线），
    // 今天 `item_feedback` 全库 0 行 ⇒ 这里的 enabled 可以是 true 但 cohort 是 null、
    // touched_in_top 必然是 0——"上线即隐身"这条要能被读出来，不许藏。
    collab: {
      enabled: COLLAB_CONFIG.enabled,
      cohort: collabModel
        ? {
            size: collabModel.cohort_size,
            min_size: COLLAB_CONFIG.MIN_COHORT,
            global_mean: collabModel.global_mean,
            distance_max: COLLAB_CONFIG.DIST_MAX,
            k_prior: COLLAB_CONFIG.K_PRIOR,
            occasion_requested: collabModel.occasion_requested,
            // null ⇒ 这一屏凑不出同场合的分，退回"不分场合"，话术跟着改口（不许硬说"在这个场合"）
            occasion_used: collabModel.occasion_used,
            items_with_signals: collabModel.byItem.size,
          }
        : null,
      range: [COLLAB_CONFIG.FACTOR_MIN, COLLAB_CONFIG.FACTOR_MAX],
      signals_in_db: countItemFeedback(),
      // 🔴 第十一阶段第二路信号的账（`19` §六 第 6 条）：这一层被关掉、或"本次没带温度档／
      // 这一档凑不满同组日记"时必须是 `null`——"上线即隐身"要能被读出来，
      // ⛔ 不许拿星级样本数或日记总行数冒充它在工作。
      // 里面只出**聚合数**（几人、几套、全局几套），⛔ 永不出日记人、姓名、门店、时间戳（`19` §九）。
      diary_signal:
        collabModel && collabModel.diary
          ? {
              attribute: collabModel.diary.attribute,
              temperature_level: collabModel.diary.temperature_level,
              cohort_diary_sets: collabModel.diary.cohort_diary_sets,
              cohort_people: collabModel.diary.cohort_people,
              pool_diary_sets: collabModel.diary.pool_diary_sets,
              // null ⇒ 这一屏凑不出同场合的日记，退回"不分场合"，话术跟着改口
              occasion_used: collabModel.diary.occasion_used,
              // 三档里今天真的动了乘子（factor≠1）的有几档：0 就是"这一路也在隐身"
              bands_with_signal: [...collabModel.diary.byBand.values()].filter(
                (b) => b.factor !== 1,
              ).length,
            }
          : null,
      // 🔴 第十三阶段第三路信号的账（`21` §五 第 5 条）：形状与前一路同形、同样只出**聚合数**
      // （几人、几套、几个族），⛔ 永不出日记人、姓名、门店、时间戳。
      // 与 `diary_signal` 唯一差别：它**不等温度档**——`21` §五 点名的闸门只有那四个数，
      // 所以"这一屏没带天气"时这里仍然可能非 null，那是设计而不是漏。
      color_signal:
        collabModel && collabModel.color
          ? {
              attribute: collabModel.color.attribute,
              cohort_diary_sets: collabModel.color.cohort_diary_sets,
              cohort_people: collabModel.color.cohort_people,
              pool_diary_sets: collabModel.color.pool_diary_sets,
              occasion_used: collabModel.color.occasion_used,
              // 只数"这一池里真出现过的族"，里面今天真的动了乘子（factor≠1）的有几个：0 就是这一路也在隐身
              families_with_signal: [...collabModel.color.byFamily.values()].filter(
                (f) => f.factor !== 1,
              ).length,
            }
          : null,
      provenance: collabModel
        ? collabModel.provenance
        : COLLAB_CONFIG.enabled
          ? '没身份／没体型／库里没有可用的同组打分、本次也没有可组的温度档、日记里也没有可组的色族 ⇒ 乘子恒为 1'
          : 'COLLAB_FILTER_ENABLED=0 ⇒ 这一层整个关掉，乘子恒为 1',
      touched_in_top: result['穿搭'].filter((e) => e.rank && e.rank.collab_factor !== 1).length,
    },
    note:
      '综合分 = (w1·规则基础分 + w2·色彩贴合分 + w3·廓形贴合分) × 覆盖率折扣 × 算法缺席惩罚 × 偏好乘子 × 协同过滤乘子；' +
      '规则那一刀只决定谁进候选集，名次由这三个分量决定。' +
      '缺的分量按在场权重归一化并整体打折，绝不补 0 分也不补高分；' +
      '规则命中的条目若色彩与廓形任有一维没出分，综合分再乘 0.8（衣橱量出来的那几行不吃这条惩罚）。' +
      `前 ${RANK_TOP_N} 条里至少要留 ${RANK_MIN_ALGO_IN_TOP} 条是有算法分的，凑不出就不硬塞。` +
      `偏好乘子只在这个人自己记下满 ${PREF_MIN_SAMPLES} 套搭配后才生效，最多抬/压 ${Math.round(
        (PREF_FACTOR_MAX - 1) * 100,
      )}%，日记 0 条时恰好是 1。` +
      '它认的四根轴＝色族／版型／场合／温度档厚薄（厚薄那一轴只有本次请求带了天气档才吃，取不到值的候选对它逐条隐身），' +
      `外加"这件衣服你自己记进过几套日记"的复穿那一刀（幅度 = min(${PREF_REPS_MAX}, ${PREF_REPS_STEP}×ln(1+次数))，⛔ 只加不减）；` +
      '四根加起来仍受同一个上下界夹住——轴变多不会让上限变宽。' +
      `协同过滤乘子只在"体型相近的其他人"凑满 ${COLLAB_CONFIG.MIN_COHORT} 人时才生效（三路共用这一道人数闸），` +
      `最多抬/压 ${Math.round((COLLAB_CONFIG.FACTOR_MAX - 1) * 100)}%，` +
      '库里这一件没人打过星、别人的日记也没凑出可比的分布时恰好是 1（上线即隐身，不是待办没做完）。' +
      '这一层今天有三个信号：星级（比"这一件"）＋日记厚薄（比"这个温度档常穿哪一档厚薄"）＋日记色族' +
      '（比"常穿哪一族色"）；后两路⛔ 不比是不是同一件——两个人的"蓝衬衫"不是一个东西。' +
      '三个乘子各算各的、相乘之后只夹紧一次，任一路样本不足那一路恰好 1。' +
      '色族那一路读的是"同组人记的套数里有几套是这个族"这一份额，⛔ 不是那个人的喜好。' +
      '权重、惩罚系数、在场下限、偏好幅度与协同过滤那三个阈值全是 C 档手拍值（产品口径，标定中，未回归）。',
  }
  // 落选池全量拆账（第十二阶段·第一步·付费报告 A 节，docs/依据/20 §五 第 2 条）。
  // ⛔ 默认不写这个键——免费路径的响应必须与改前逐字节相同，"付费才有尾巴"才是真增量，
  // 而把尾巴偷偷塞进免费响应再宣称"这是付费内容"是假的（§一 那条「不裁剪免费响应」同源）。
  if (opts.keep_ranked_out && result['穿搭']._dropped) {
    result._computed.ranking.beyond_top_n = result['穿搭']._dropped
  }

  // S5 落库点②：五个品类的命中跨类合并，一场一次 UPDATE（改前 11~14 次）。
  if (incrementHitCount) _flushHitCounts(hitCollector)

  return result
}

/**
 * 单独取这个人的"身材偏差向量"（供衣橱按身材排序等入口复用，与 buildRecommendation 里同一套口径）。
 * 只读 profile、不写库；没量到任何尺寸 ⇒ want 全为 null，调用方据此判"这个人还打不了分"。
 * @param {object} profile
 * @returns {{measure:object, want:object, ease_window:number[]|null, notes:string[]}}
 */
function recommendationBodyDeviation(profile) {
  return bodyDeviation(enrichProfile(profile || {}))
}

module.exports = {
  getRecommendations,
  buildRecommendation,
  recommendationBodyDeviation,
  // 重排的可调参数＋一个综合分函数：文档、后台、测试都从这里取数，别处不再抄一份
  RANK_WEIGHTS,
  RANK_RULE_REF,
  RANK_COVERAGE_FLOOR,
  RANK_ALGO_ABSENCE_PENALTY,
  RANK_TOP_N,
  RANK_MIN_ALGO_IN_TOP,
  rankDims,
  // 第十三阶段·一 色彩轴的四处理论上唯一的取色口径，出给单测与报告拆账（⛔ 别处不许再抄一份）：
  // `outfitColorParts` 四槽取色、`resolveRelationalSlots`/`relationalTargetsOf` 关系色展开（§二·4）、
  // `firstSpecificColor` 借来的那个色、`scoreTopColor` 贴合分＋借色／关系色两条支路
  COLOR_BORROW_WEIGHT,
  RELATIONAL_WORDS,
  outfitColorParts,
  resolveRelationalSlots,
  relationalTargetsOf,
  relationalLedger,
  firstSpecificColor,
  scoreTopColor,
  // §三·4 版型推断层接到身体维的那唯一一处（测试与工装都从这里取，⛔ 别处不许再造一条尺子）
  ruleTextBodyFit,
  // 名单装配（排序＋强制在场＋截断）：单独出给测试与后台拆账用，
  // 不在这一层挂任何写库动作，纯函数可以脱离数据库直接验（本项目 D5 那条债的还法之一）
  rankAndTruncate,
}
