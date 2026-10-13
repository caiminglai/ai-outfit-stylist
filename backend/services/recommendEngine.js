/**
 * 穿搭推荐引擎
 * 从 Python app/services/recommend_engine.py + rule_engine.py 翻译
 *
 * 包含:
 * 1. getRecommendations: 旧版硬编码推荐(兼容)
 * 2. buildRecommendation: 规则引擎推荐(基础版,完整版待 Phase 3.5 实现)
 */

const db = require('../db/init')
const {
  enrichProfile,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  computeColorMatch,
} = require('./profileEnricher')
const { explainMatchedRecommendation, CATEGORY_CN_TO_EN } = require('./ruleExplainer')
const { colorFit } = require('./colorMetrics')
const { asText, ownValue } = require('../utils/common')
const { topFitBody, bodyDeviation } = require('./topFitBody')
const { topSpec } = require('./topFromBody')

/**
 * 获取穿搭推荐
 * @param {string|null} skinTone - 肤色
 * @param {string|null} faceShape - 脸型
 * @param {string} scenario - 场景
 * @returns {Array} 推荐结果列表
 */
function getRecommendations(skinTone, faceShape, scenario) {
  const defaults = {
    通勤: [
      {
        top_style: '白色衬衫',
        bottom_style: '深色西裤',
        color_combo: '白+蓝',
        reason: '简洁干练,职场必备',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '针织开衫',
        bottom_style: '直筒裤',
        color_combo: '米+灰',
        reason: '温柔知性,通勤百搭',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '西装外套',
        bottom_style: '铅笔裙',
        color_combo: '黑+灰',
        reason: '专业大气,会议首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    约会: [
      {
        top_style: 'V领碎花裙',
        bottom_style: '',
        color_combo: '浅粉+白',
        reason: '甜美浪漫,约会首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身针织衫',
        bottom_style: 'A字裙',
        color_combo: '白+杏',
        reason: '优雅温柔,展现气质',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    面试: [
      {
        top_style: '翻领大衣',
        bottom_style: '西裤',
        color_combo: '灰+黑',
        reason: '专业稳重,面试首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '衬衫',
        bottom_style: '直筒裙',
        color_combo: '白+深蓝',
        reason: '简洁大方,给人信赖感',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    休闲: [
      {
        top_style: '圆领T恤',
        bottom_style: '牛仔裤',
        color_combo: '白+蓝',
        reason: '舒适百搭,日常首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '卫衣',
        bottom_style: '运动裤',
        color_combo: '灰+黑',
        reason: '休闲舒适,轻松自在',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    聚会: [
      {
        top_style: '亮片上衣',
        bottom_style: '高腰裙',
        color_combo: '金+黑',
        reason: '闪耀吸睛,聚会焦点',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身连衣裙',
        bottom_style: '',
        color_combo: '酒红+黑',
        reason: '优雅大气,派对首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
  }

  // scenario 来自请求体（buildRecommendation 里是 profile.scenario），
  // 写 defaults[scenario] 时 scenario='constructor' 会拿到 Object 构造函数，
  // 调用方 `for (const item of fallback)` 立刻 TypeError ⇒ 推荐接口回 500。
  const fallbackList = ownValue(defaults, asText(scenario)) || ownValue(defaults, '休闲')
  return fallbackList
}

// ============================================================
// 规则引擎推荐(基础版)
// 从 Python app/services/rule_engine.py build_recommendation() 翻译
// 完整版(含 enrich_profile / algorithm_analysis)待 Phase 3.5 实现
// ============================================================

// 推荐类别常量
const CATEGORIES = ['穿搭', '妆容', '发型', '配饰', '姿势']

/**
 * 解析规则条件的 value(JSON 字符串)
 */
function parseConditionValue(rawValue) {
  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

/**
 * 场合别名 → 规范场合
 * 库里有 9 组 personal 规则把 scenario 写成表单原始选项(上班通勤/约会聚会/派对),
 * 而运行时 profile.scenario 已被 profileEnricher 的 OCCASION_TO_SCENARIO 归一成 通勤/约会/聚会,
 * 导致这些规则从写下起永远命中不了。SQL 预筛和条件评估都按这张表放宽一次。
 */
const SCENARIO_ALIASES = {
  通勤: ['上班通勤'],
  约会: ['约会聚会'],
  聚会: ['派对'],
}

// 反转成 别名 → 规范值,给下面的条件值归一用
const SCENARIO_ALIAS_TO_CANON = {}
for (const [canon, list] of Object.entries(SCENARIO_ALIASES)) {
  for (const alias of list) SCENARIO_ALIAS_TO_CANON[alias] = canon
}

/**
 * 条件值别名 → 规范值
 * 种子数据里"姿势"类规则的条件值有两种写法:
 * store 模式 8 组写 posture、personal 模式 8 组写 pose,
 * 而 matchRules 用 CATEGORY_CN_TO_EN 把中文类别统一翻成 posture,
 * 导致 pose 那 8 组(拍照姿势)永远匹配不上。这里做一次归一。
 */
const COND_VALUE_ALIASES = {
  category: { pose: 'posture' },
  scenario: SCENARIO_ALIAS_TO_CANON,
}

/** 检查单个条件是否命中 */
function checkSingleCondition(condition, profile) {
  const parsed = parseConditionValue(condition.value)
  const field = condition.field
  const operator = condition.operator

  // 两处取值都不许顺原型链：condition.field 是库里的自由 TEXT，
  // 一行写成 'constructor' 时 `profile['constructor']` 拿到的是 Object 函数而不是"没填"，
  // 后面所有 String() 比较都拿它当档案值；`field in parsed` 同样会把继承键当成条件值。
  // ownValue 认不出继承键 ⇒ 一律当缺测，与"这个字段顾客没填"同一口径。
  const profileVal = ownValue(profile, field)

  // 从 parsed 中取出匹配值
  let condVal
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    ownValue(parsed, field) !== undefined
  ) {
    condVal = ownValue(parsed, field)
  } else {
    condVal = parsed
  }

  // 别名归一(pose → posture 等)
  const alias = ownValue(COND_VALUE_ALIASES, field)
  if (alias && typeof condVal === 'string') {
    const mapped = ownValue(alias, condVal)
    if (mapped) condVal = mapped
  }

  // "all" 表示不限,始终命中
  if (condVal === 'all') return true

  // profile 中该字段为空时,只有 "all" 才能命中。
  // 空串（表单留空、门店端没录）也必须算空：否则 ne 条件的 `'' !== '无'` 恒真，
  // 库里 allergy_metal ne "无" 这一条会给"没填过敏史"的人当成"有过敏"，凭空推无镍饰品。
  if (profileVal === null || profileVal === undefined) return false
  if (typeof profileVal === 'string' && profileVal.trim() === '') return false

  if (operator === 'eq') {
    return String(profileVal) === String(condVal)
  } else if (operator === 'in') {
    let valList = condVal
    if (typeof valList === 'string') {
      try {
        valList = JSON.parse(valList)
      } catch {
        valList = [valList]
      }
    }
    if (!Array.isArray(valList)) valList = [valList]
    // 兼容逗号/顿号分隔的字符串写法(如 "小麦色,古铜色")
    valList = valList
      .flatMap((v) => (typeof v === 'string' ? v.split(/[、,，]/) : [v]))
      .map((v) => String(v).trim())
      .filter(Boolean)
    return valList.some((v) => String(v) === String(profileVal))
  } else if (operator === 'ne') {
    return String(profileVal) !== String(condVal)
  }

  return false
}

/**
 * 评估一个规则组是否全部命中
 * 返回 [是否命中, 总分, 条件详情列表]
 *   条件详情: { field, operator, value, matched, explanation }
 *   matched=true 表示该条件命中,false 表示未命中
 *   explanation 是 ruleExplainer 翻译的中文描述
 */
function evaluateGroup(group, conditions, profile) {
  if (!conditions || conditions.length === 0) {
    return [true, 0, []]
  }

  let scoredWeight = 0
  let allMatched = true
  const details = []

  for (const cond of conditions) {
    const matched = checkSingleCondition(cond, profile)
    if (matched) {
      // 权重必须收成一个数。weight 列是自由 TEXT：原来 `cond.weight || 1` 只挡 falsy，
      // 'abc' 是 truthy 就一路加进 scoredWeight ⇒ NaN，比较器 `b.score - a.score` 回 NaN
      // （排序退化成"按数据库返回序"），而 JSON.stringify 把 NaN 打成 null，
      // 顾客报告里的"匹配分"直接变 null。另外 weight=0 是合法的"不计分软信号"，
      // 原来被 `|| 1` 抬成 1 分。0 合法 ⇒ 判据只能是"是不是有限数"，不能是 truthy。
      const w = Number(cond.weight)
      scoredWeight += Number.isFinite(w) && w >= 0 ? w : 1
    } else {
      allMatched = false
    }
    details.push({
      field: cond.field,
      operator: cond.operator,
      value: cond.value,
      matched,
    })
  }

  return [allMatched, scoredWeight, details]
}

/**
 * 匹配规则并打分
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {string|null} category - 推荐类别
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @returns {Array} 命中的规则组列表
 */
function matchRules(profile, mode = 'store', category = null, incrementHitCount = true) {
  // 构建查询
  // mode='all' 表示门店与个人通用(第二批色彩/比例类规则不分两套口径)
  let query = "SELECT * FROM rule_groups WHERE enabled = 1 AND (mode = ? OR mode = 'all')"
  // mode / gender / scenario 都是从请求体一路传下来的自由值：对象、数组绑进 SQL
  // 是 RangeError/TypeError ⇒ 整个推荐接口回 500，而它本该只是"这个筛选项没匹配上"。
  // 统一过 asText（非文本当没填），认不出的值仍按原口径只命中 mode='all' 的规则。
  const params = [asText(mode) || 'store']

  // 按 gender 筛选
  const gender = asText(profile.gender)
  if (gender) {
    query += ' AND (gender = ? OR gender IS NULL)'
    params.push(gender)
  }

  // 按 scenario 筛选(姿势类按拍照场景分档,优先用 photo_scene)
  const scenarioRaw =
    category === '姿势'
      ? asText(profile.photo_scene) || asText(profile.scenario)
      : asText(profile.scenario)
  // 先归一成规范值，再拿它去预筛。原来这里直接用原始值：
  // 顾客传 scenario='上班通勤' 时 aliases=SCENARIO_ALIASES['上班通勤']=undefined ⇒ 只放进
  // scenario='上班通勤' 那 3 组（10-13 现量线上：group.scenario 写成别名的共 10 行，
  // 上班通勤 3／约会聚会 4／派对 3），而这 3 组的条件值同样写 '上班通勤'，
  // 到 checkSingleCondition 里被归成 '通勤' 再和 profile 的 '上班通勤' 比 ⇒ 不等，
  // 于是这一路一条都不命中，整屏退回硬编码的"休闲"套。归一放在入口，两侧才是同一把尺子。
  const scenarioKey = ownValue(SCENARIO_ALIAS_TO_CANON, scenarioRaw) || scenarioRaw
  if (scenarioKey) {
    // 别名一起放行:老规则里把场合写成表单原始选项的,归一后会对不上 SQL 预筛
    // ownValue：scenarioKey 是自由文本，'toString' 这类原型键会查出函数，
    // 下一行的 `...aliases` 展开函数直接 TypeError ⇒ 推荐接口 500。
    const aliases = ownValue(SCENARIO_ALIASES, scenarioKey) || []
    query += ` AND (scenario IS NULL OR scenario = ?${' OR scenario = ?'.repeat(aliases.length)})`
    params.push(scenarioKey, ...aliases)
  }

  // 按 category 筛选
  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }

  const groups = db.prepare(query).all(...params)

  if (groups.length === 0) return []

  // 批量加载所有相关 conditions 和 actions(避免 N+1 查询)
  const groupIds = groups.map((g) => g.id)
  const placeholders = groupIds.map(() => '?').join(',')
  const allConditions = db
    .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${placeholders})`)
    .all(...groupIds)
  const allActions = db
    .prepare(`SELECT * FROM rule_actions WHERE group_id IN (${placeholders}) ORDER BY sort_order`)
    .all(...groupIds)

  // 按 group_id 分组
  const conditionsByGroup = {}
  for (const c of allConditions) {
    ;(conditionsByGroup[c.group_id] ||= []).push(c)
  }
  const actionsByGroup = {}
  for (const a of allActions) {
    ;(actionsByGroup[a.group_id] ||= []).push(a)
  }

  // 逐组评估
  const matched = []
  for (const group of groups) {
    const conditions = conditionsByGroup[group.id] || []

    // 把 rule_groups.category(中文) 转成英文,与规则条件 category 值(outfit)对齐
    // 修复 bug:之前赋中文 '穿搭' 导致 category 条件永远不匹配,规则引擎从未真正工作
    // scenario 同样用 scenarioKey,保证 SQL 预筛与条件评估用同一个口径(姿势类走 photo_scene)
    const evalProfile = {
      ...profile,
      scenario: scenarioKey,
      category: ownValue(CATEGORY_CN_TO_EN, group.category) || group.category,
    }
    const [hit, score, conditionDetails] = evaluateGroup(group, conditions, evalProfile)

    if (hit) {
      // 使用预加载的 actions
      // 必须用无原型对象：action_type 是库里的自由 TEXT，一行 'x' 写成 __proto__ 时，
      // `actions['__proto__'] = content` 改的是原型而不是自有键 ⇒ 这条动作文案静默消失，
      // 推荐结果和文字报告里都少一项，且不报错、日志无痕。
      const actions = Object.create(null)
      for (const action of actionsByGroup[group.id] || []) {
        actions[action.action_type] = action.content
      }

      // 顾客反馈微调:一条好评 +1、一条不准 -1,最多影响 ±3 分
      // 没收到反馈的规则 feedback=0,分数与排序跟改动前完全一样
      const feedback = Math.max(
        -3,
        Math.min(3, (group.feedback_up || 0) - (group.feedback_down || 0)),
      )

      matched.push({
        group_id: group.id,
        group_name: group.name,
        category: group.category,
        scenario: group.scenario,
        priority: group.priority || 0,
        score: score + feedback,
        feedback,
        // 依据分档 A/B/C/D；NULL＝未标注，展示端按 C 对待（见 services/evidenceLevels.js）
        evidence_level: group.evidence_level ?? null,
        actions,
        // 命中条件详情(含每个条件的命中状态,供生成可解释性说明)
        condition_details: conditionDetails,
      })

      // 累加命中次数
      if (incrementHitCount) {
        try {
          db.prepare(
            "UPDATE rule_groups SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id = ?",
          ).run(group.id)
        } catch (err) {
          console.warn(`[推荐引擎] 规则组 ${group.id} 命中次数写入失败: ${err.message}`)
        }
      }
    }
  }

  // 排序:priority 降序,score 降序,最后按 id 升序兜底。
  // 前两级之后还剩多少并列，10-13 现量线上：enabled=1 的组里 priority=25 就有 79 组、
  // priority=5 有 76 组，而同一个 mode+category+priority 键下最多 68 组同分 ⇒
  // 只排两级时，并列的先后完全由 SELECT 的返回序决定（这条 SQL 没有 ORDER BY），
  // 而报告端只取前 3 条 ⇒ 重建一次库、top3 可能整体换人。id 兜底把顺序定死成建规先后。
  matched.sort((a, b) => b.priority - a.priority || b.score - a.score || a.group_id - b.group_id)

  return matched
}

/**
 * 构建完整的推荐结果
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @returns {object} 按类别分组的推荐结果
 */
function buildRecommendation(profile, mode = 'store', incrementHitCount = true) {
  // 1. 画像增强:计算 BMI、体型、腰臀比、肤色匹配、脸型建议等
  const enriched = enrichProfile(profile)
  // 身材偏差向量整次推荐只算一次(topFitBody 只吃连续量,不吃 body_type 这类离散标签)
  const bodyDev = bodyDeviation(enriched)

  const result = {
    穿搭: [],
    妆容: [],
    发型: [],
    配饰: [],
    姿势: [],
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
  if (mode === 'personal') {
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
  for (const cat of CATEGORIES) {
    const matched = matchRules(enriched, mode, cat, incrementHitCount)
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
      const fit = colorFit(enriched.skin_tone_detail || enriched.skin_tone, topText)
      if (fit) recommendation.color_fit = fit
      // 身材贴合分:这一维不看脸,量的是"这件上衣往哪修"和"这个人的比例偏差"对不对得上。
      // 一维都凑不齐(没量尺寸 或 句子认不出任何版型/肩线/长短/色信号)就不写这个字段。
      const bf = topFitBody(null, topText, bodyDev)
      if (bf) {
        // person 里那份是这个人自己的数,整份报告只留一份(见 _computed.body_deviation),
        // 每条推荐再带一遍会让 payload 白白翻一倍
        delete bf.person
        recommendation.body_fit = bf
      }
      result[cat].push(recommendation)
    }
  }

  // 5. 兜底:规则引擎未命中时用旧版硬编码推荐
  if (result['穿搭'].length === 0) {
    const scenario = enriched.scenario || profile.scenario || '通勤'
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
      // 兜底那几条同样是上衣结论,身材这一维照算(色彩那一维按原口径不算:兜底没有肤色依据)
      const bf = topFitBody(null, entry.outfit_top, bodyDev)
      if (bf) {
        delete bf.person
        entry.body_fit = bf
      }
      result['穿搭'].push(entry)
    }
  }

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

module.exports = { getRecommendations, buildRecommendation, recommendationBodyDeviation }
