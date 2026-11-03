/**
 * 用户档案 enricher（算法计算层·主入口）
 *
 * 11-03 拆分：本文件只剩「编排 + 再导出」，算法按职责搬进 ./enrich/ 五个模块。
 * 对外的 require 路径与导出表一行没改 ⇒ 消费方（recommendEngine.js、routes、test）照旧。
 *   · ./enrich/bodyMetrics.js 体型与比例：BMI、体型五分类＋差值、部位级标签、腰臀比、腿身比、肩宽比（原文 :37-310）
 *   · ./enrich/colorMatch.js  肤色→色系／季型：色系表、四季型、十二型（拆前原文 312-461 行）
 *   · ./enrich/styleType.js   风格型与视觉比例档位：Kibbe 五型、比例档位中文化（拆前原文 463-557 行）
 *   · ./enrich/adviceMaps.js  查表出话的四张文案：体型穿搭、脸型、三庭五眼、体态（拆前原文 559-774 行）
 *   · ./enrich/baziFields.js  生日派生：周岁／年龄段＋八字五行（拆前原文 790-850 行）
 * 8.5 那张 occasion→scenario 小表留在本文件：它只服务 enrichProfile 里那一行映射，没有算法，
 * 单独立一个文件只会让"改一个场景词要开两个文件"。
 *
 * 从 Python profile_enricher.py 翻译：
 *   - BMI 计算与分级
 *   - 体型自动分类（沙漏/梨形/苹果/直筒/倒三角）
 *   - 腰臀比、腿身比、肩宽比分析
 *   - 肤色-色系匹配
 *   - 脸型-发型/妆容/配饰映射
 *   - 体态问题-穿搭映射
 */

const { ownValue } = require('../utils/common')
const { beijingDateStr } = require('../utils/beijingTime')
const { normalizeBodyType } = require('./bodyTypes')
const { estimateBodyDims, estimateFromWaist } = require('./bodyDimEstimator')
const { getSeasonType, getSkinFiveDimensions } = require('./seasonColor')
const {
  _safeFloat,
  _normGender,
  computeBmi,
  computeBodyShape,
  computeBodyHighlights,
  computeWhRatio,
  computeLegRatio,
  computeShoulderRatio,
} = require('./enrich/bodyMetrics')
const {
  SKIN_TONE_COLOR_MAP,
  computeColorMatch,
  computeColorSeason,
  computeColorSeason12,
  CHROMA_LEVEL,
  COLOR_SEASON_12_TABLE,
} = require('./enrich/colorMatch')
const {
  FRAME_LEVEL,
  LINE_LEVEL,
  KIBBE_TABLE,
  frameSizeFromValue,
  lineQualityFromValue,
  computeKibbeType,
  computeProportionLevels,
} = require('./enrich/styleType')
const {
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  getFaceProportionGuide,
  getPostureAdvice,
  FACE_PROPORTION_GUIDE,
  EYE_SPACING_GUIDE,
} = require('./enrich/adviceMaps')
const { deriveAgeFields, computeBaziFields } = require('./enrich/baziFields')

// 简易内存缓存（避免重复计算相同 profile）
const _enrichCache = new Map()
const _CACHE_MAX = 200

/**
 * 将 profile 转为可哈希的缓存键
 * 键里必须带"北京的今天"：缓存值含 `bazi_today`（enrich/baziFields.js:77 那次 analyzeDay），
 * 原来只按 profile 取键又没有 TTL ⇒ 同一份档案第二天命中昨天的日柱，
 * 要等进程重启或挤出 200 条上限才自愈（2026-10-12 修）
 * @param {object} profile
 * @returns {string}
 */
function _cacheKey(profile) {
  return `${beijingDateStr()}|${JSON.stringify(profile)}`
}

// ============================================================
// 8.5. 前端 occasion → 规则引擎 scenario 值映射
// ============================================================

const OCCASION_TO_SCENARIO = {
  上班通勤: '通勤',
  约会聚会: '约会',
  校园日常: '校园日常',
  居家休闲: '居家休闲',
  商务正式: '商务正式',
  运动健身: '运动健身',
  婚礼宴会: '婚礼宴会',
}

// ============================================================
// 9. 主入口：enrichProfile
// ============================================================

/**
 * 对原始 profile 进行算法 enrich，增加计算字段
 * @param {object} profile - 顾客填写的原始数据
 * @returns {object} 原始数据 + 新增计算字段
 */
function enrichProfile(profile) {
  // 检查缓存
  const key = _cacheKey(profile)
  if (_enrichCache.has(key)) {
    return { ..._enrichCache.get(key) }
  }

  const p = { ...profile }

  // 0. 字段映射：将前端字段名映射到规则引擎条件字段名
  if (!p.body_type && p.body_type_detail) {
    p.body_type = p.body_type_detail
  }
  // 0.1 体型词形归一（10-19 第一阶段·止血第 1 条）。老档案与老表单存的是「苹果形」，
  // 引擎判定与规则库存值认的是「苹果型」——严格 AND 下这一字之差＝那 4 组 store 穿搭规则
  // 对这个顾客根本不存在（现量 10-19：rule_conditions 里 {"body_type":"苹果形"} 4 条，
  // 一次没命中过；判据见 bodyTypes.js 文件头）。
  // 认不出的取值原样留着：「标准」这类老自填值翻成五档之一＝编造体型，宁可让它继续不命中。
  // 引擎侧归一 + 规则侧归一（recommendEngine.COND_VALUE_ALIASES）两道一起上，
  // 是为了让"迁移脚本跑没跑"不再决定规则生不生效——服务器那份运行库被 skip-worktree 钉住，
  // 发布窗口里漏跑一次迁移只该留下后台的老名字，不该再静默吃掉一整组规则。
  const normalizedBodyType = normalizeBodyType(p.body_type)
  if (normalizedBodyType && normalizedBodyType !== p.body_type) p.body_type = normalizedBodyType
  if (!p.skin_tone && p.skin_tone_detail) {
    p.skin_tone = p.skin_tone_detail
  }
  // skin_lightness 兜底：用户没拖深浅滑块时，从深浅档名推导一个连续值，
  // 保证肤色深度规则（skin_lightness 区间匹配）总有值可吃，⛔ 不编"没填=50"。
  // 映射：白皙→85, 自然白→65, 偏黄→45, 小麦色→30, 古铜色→15（C 档手拍，对应 L* P5~P95 的 0~100）
  if (
    (p.skin_lightness === undefined || p.skin_lightness === null || p.skin_lightness === '') &&
    p.skin_tone_detail
  ) {
    const depthMap = { 白皙: 85, 自然白: 65, 偏黄: 45, 小麦色: 30, 古铜色: 15 }
    p.skin_lightness = depthMap[p.skin_tone_detail]
  }
  // 0.45 四季色彩体系：冷暖轴（色相角/冷暖档）+ 深浅轴（明度/深浅档）⇒ 春/夏/秋/冬
  //       ⛔ 不喂规则匹配——这只是给用户看的"季型"标签和推荐色卡，不影响推荐排序。
  const season = getSeasonType({
    skin_hue: p.skin_hue,
    skin_lightness: p.skin_lightness,
    skin_tone: p.skin_tone,
    skin_tone_detail: p.skin_tone_detail,
  })
  if (season) p.season_type = season
  // 0.46 五维肤色框架（借鉴 HBN 蓝皮书：黑/黄/红/白/青）
  const fiveDims = getSkinFiveDimensions({
    skin_hue: p.skin_hue,
    skin_lightness: p.skin_lightness,
    skin_tone: p.skin_tone,
    skin_tone_detail: p.skin_tone_detail,
  })
  if (fiveDims) p.skin_five_dimensions = fiveDims
  if (!p.scenario && p.occasion) {
    p.scenario = ownValue(OCCASION_TO_SCENARIO, p.occasion) || p.occasion
  }
  if (!p.nose_bridge && p.nose_height) {
    p.nose_bridge = p.nose_height
  }
  // 0.5 性别归一：规则条件与尺码表用的都是「男/女」，而 users.gender 里确实躺着
  // 英文和数字（db/migrate_en_to_cn.js:215-222 就是为这批数据写的）。原来 _normGender
  // 只在腰臀比那一处调用、结果从不写回 p.gender ⇒ 'male'／'M'／'1' 这类档案在
  // 每一条带 gender 的规则和 fitSize 的 SIZE_STEPS.scope 上整类静默失配
  // （引擎是严格 AND，条件对不上就等于这条规则对他不存在）。
  // 认不出来的取值保持原样：宁可少归一，也不把顾客真填过的内容覆盖成 null。
  const normalizedGender = _normGender(p.gender)
  if (normalizedGender && normalizedGender !== p.gender) p.gender = normalizedGender
  // 只填了具体身高没选区间时换算一次,否则按区间分档的规则对这类人永远轮不到
  if (!p.height_range && p.height) {
    const h = _safeFloat(p.height)
    if (h > 0) {
      // 145cm 会被归进 '150-160'，这是**故意的**：档位词表由规则条件决定，
      // 派生字段的取值不许在规则里另抄一份（docs/形象设计模型-现状与路线.md:85）。
      // 下面那三档之外没有更低档可归 ⇒ 与其新造一个谁也命中不到的 '<150'
      // 让人直接掉出所有身高规则，不如并进最近的 150-160 至少还能命中。
      // 四档 150-160／160-170／170-180／180+ 现在都有规则接得住：前三档是
      // db/add-rules.js 那批老规则（163/164/165 组，无 source_key），
      // 170-180 这一档 10-13 才补进 db/seed/rules-aesthetic.json
      //（height-f-170-180／height-m-170-180，由 applyRuleSeeds 按 key 增量插）。
      // 谁再漏一档，test/aestheticRules.test.js 的反向断言会红：算得出的取值必须有规则命中。
      p.height_range = h < 160 ? '150-160' : h < 170 ? '160-170' : h < 180 ? '170-180' : '180+'
    }
  }

  const { height, weight, bust, waist, hip, shoulder, leg_length, skin_tone, face_shape, posture } =
    p

  // 1. BMI
  if (height && weight) {
    Object.assign(p, computeBmi(height, weight))
  }

  // 2. 体型（若已手动填写则保留，否则自动计算）
  if (bust && waist && hip) {
    const computed = computeBodyShape(bust, waist, hip, shoulder)
    if (!p.body_type && computed.body_shape) {
      p.body_type = computed.body_shape
    }
    Object.assign(p, computed)
  }

  // 3. 腰臀比
  if (waist && hip) {
    Object.assign(p, computeWhRatio(waist, hip, p.gender))
  }

  // 4. 腿身比
  if (leg_length && height) {
    Object.assign(p, computeLegRatio(leg_length, height))
  }

  // 4.5 四大身材标准·部位级标签（椰子胸/沙漏腰/母贝臀/酒杯腿）
  //     只在量到对应围度/腿长时出，⛔ 不编标签
  const bodyHighlights = computeBodyHighlights({
    bust_waist_diff: p.bust_waist_diff,
    waist_hip_diff: p.waist_hip_diff,
    leg_ratio: p.leg_ratio,
  })
  if (bodyHighlights.highlights.length > 0) {
    p.body_highlights = bodyHighlights.highlights
    p.body_highlights_details = bodyHighlights.details
  }

  // 5. 肩宽比
  if (shoulder && height) {
    Object.assign(p, computeShoulderRatio(shoulder, height))
  }

  // 5.5 比例档位中文化(60-30-10 那批规则的条件字段)
  Object.assign(p, computeProportionLevels(p))

  // 6. 肤色-色系
  if (skin_tone) {
    Object.assign(p, computeColorMatch(skin_tone))
  }
  // 6.5 色彩四季型(冷暖×明度两个轴都拿到才算,缺一不猜)
  Object.assign(p, computeColorSeason(p.skin_tone, p.skin_tone_detail))
  // 6.6 色彩十二型(四季×纯度第三轴;没选纯度就停在四季,四季那批规则照常命中)
  Object.assign(p, computeColorSeason12(p.color_season, p.color_chroma))
  // 6.7 风格型(骨架量感×线条倾向,两轴都选了才算)
  //    连续值优先：用户拖了滑块(frame_size_value/line_quality_value)就从连续值推导离散档名，
  //    保证既有规则(frame_size eq '大气')照常命中，同时把连续值也挂到 profile 上供区间算子匹配。
  if (
    p.frame_size_value !== undefined &&
    p.frame_size_value !== null &&
    p.frame_size_value !== ''
  ) {
    p.frame_size = frameSizeFromValue(p.frame_size_value)
  }
  if (
    p.line_quality_value !== undefined &&
    p.line_quality_value !== null &&
    p.line_quality_value !== ''
  ) {
    p.line_quality = lineQualityFromValue(p.line_quality_value)
  }
  Object.assign(p, computeKibbeType(p.frame_size, p.line_quality))
  // 6.75 周岁与年龄段(生日填了就以生日算,盖掉表单上手选的档位)
  Object.assign(p, deriveAgeFields(p.birth_date))
  // 6.8 八字五行(第二条判定依据;没填出生日期就整块缺席,不影响第一批那 20 条四季型规则)
  Object.assign(p, computeBaziFields(p.birth_date, p.birth_hour))
  // 6.9 智能估算净胸围/净肩宽(第五阶段·第一步「只填身高体重」)。
  //     🔴 只挂**独立的 body_est 通道**，⛔ 绝不改写 p.bust / p.shoulder
  //     （docs/依据/13-体型估算输入输出规范-20261020.md §五 第 7 条：档案里那两格
  //     "用户没填就是没填"这件事必须一直成立，否则他下次填了实测值没人知道哪个是真的）。
  //     ⛔ 也不喂 computeBodyShape（enrich/bodyMetrics.js:60 那段用的是量到的 bust/waist/hip）、
  //     不喂规则条件字段
  //     （引擎是严格 AND，估算值一进 profile.bust 就会命中一堆本该"没量⇒不命中"的规则）。
  //     这份数唯一的出口是 topFitBody 的 person_cm.bust/shoulder（合身层拿成衣实测做减法的那两个原值）。
  //     输入不合格 ⇒ estimateBodyDims 返回 null ⇒ 这一格就是 null，不给默认值。
  p.body_est = estimateBodyDims({
    gender: p.gender,
    height: p.height,
    weight: p.weight,
    age: p.age,
  })
  // 6.9.1 腰围回归估算胸围/臀围（苏南 18~24 岁女性研究，B=0.59W+45.37／H=0.55W+53.96）。
  //       与上面身高体重估算合并到同一通道：
  //         · bust_cm 优先用腰围回归（同一人的腰围推导比人群幂律更准）
  //         · shoulder_cm 只用身高体重（回归方程给不出肩宽）
  //         · hip_cm 只用腰围回归（身高体重幂律给不出臀围）
  //       同样 ⛔ 不改写 p.bust／p.hip、⛔ 不喂 computeBodyShape／规则匹配。
  const waistEst = estimateFromWaist({
    gender: p.gender,
    waist: p.waist,
    age: p.age,
  })
  if (waistEst) {
    if (!p.body_est) p.body_est = { estimated: true }
    // bust：腰围回归优先于身高体重幂律
    if (waistEst.bust_cm != null) {
      p.body_est.bust_cm = waistEst.bust_cm
      p.body_est.bust_from = 'waist_regression'
    } else if (p.body_est.bust_cm != null) {
      p.body_est.bust_from = 'height_weight'
    }
    // hip：只能从腰围回归来
    if (waistEst.hip_cm != null) {
      p.body_est.hip_cm = waistEst.hip_cm
      p.body_est.hip_from = 'waist_regression'
    }
    if (p.body_est.shoulder_cm != null) p.body_est.shoulder_from = 'height_weight'
    // 把腰围回归的 basis 与 flags 带出去（topFitBody 的 notes 要用）
    p.body_est.waist_basis = waistEst.basis
    if (waistEst.flags && waistEst.flags.length) {
      p.body_est.waist_flags = waistEst.flags
    }
  } else if (p.body_est) {
    if (p.body_est.bust_cm != null) p.body_est.bust_from = 'height_weight'
    if (p.body_est.shoulder_cm != null) p.body_est.shoulder_from = 'height_weight'
  }

  // 7. 脸型-全维度建议
  if (face_shape) {
    Object.assign(p, getFaceShapeGuide(face_shape))
  }

  // 7.5 三庭五眼比例-修正方案
  const proportion = getFaceProportionGuide(p.face_ratio, p.eye_spacing)
  if (proportion) {
    p.proportion_analysis = proportion.analysis
    p.proportion_hair = proportion.hair
    p.proportion_makeup = proportion.makeup
    p.proportion_contour = proportion.contour
    p.proportion_accessory = proportion.accessory
  }

  // 8. 体态建议
  const postureText = getPostureAdvice(posture)
  if (postureText) {
    p.posture_advice = postureText
  }

  // 写入缓存
  if (_enrichCache.size >= _CACHE_MAX) {
    // 删除最早的条目
    const firstKey = _enrichCache.keys().next().value
    _enrichCache.delete(firstKey)
  }
  _enrichCache.set(key, { ...p })

  return p
}

// ============================================================
// 再导出表：11-03 拆分前后逐项相同，⛔ 别在这里删名字。
// 消费方按名字解构（recommendEngine.js 与 test/ 下 6 份），少一个就是 undefined
// ⇒ 那条条件在严格 AND 引擎里静默失配，测试不红、线上不报，只是没人命中。
// ============================================================

module.exports = {
  enrichProfile,
  computeBmi,
  computeBodyShape,
  computeBodyHighlights,
  computeWhRatio,
  computeLegRatio,
  computeShoulderRatio,
  computeColorMatch,
  computeColorSeason,
  computeColorSeason12,
  computeKibbeType,
  computeBaziFields,
  CHROMA_LEVEL,
  FRAME_LEVEL,
  LINE_LEVEL,
  COLOR_SEASON_12_TABLE,
  KIBBE_TABLE,
  computeProportionLevels,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  getFaceProportionGuide,
  FACE_PROPORTION_GUIDE,
  EYE_SPACING_GUIDE,
  getPostureAdvice,
  OCCASION_TO_SCENARIO,
  SKIN_TONE_COLOR_MAP,
}
