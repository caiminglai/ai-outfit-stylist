/**
 * 规则匹配层（10-29 从 recommendEngine.js 拆出，行为不变；原文 :462-802）。
 * 职责：条件求值（checkSingleCondition／evaluateGroup）、命中名单（matchRules）、
 * 命中计数落库（_flushHitCounts——这一层是 recommend/ 里唯一碰库的，写入口就这一条）。
 */
const db = require('../../db/init')
const { BODY_TYPE_ALIASES } = require('../bodyTypes')
const { CATEGORY_CN_TO_EN } = require('../ruleExplainer')
const { asText, ownValue } = require('../../utils/common')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { warn: logWarn } = require('../../utils/logger')

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
 *
 * body_type 同一种病:库里 {"body_type":"苹果形"} 4 条(组 199/200/206/207)与引擎出的
 * 「苹果型」差一个字,从写下起一次没命中过(10-19 现量,判据见 services/bodyTypes.js 文件头)。
 * 归档词表在 bodyTypes.js,这里把规则侧的存值也归一到那张表——两侧同一把尺子,
 * 迁移脚本(db/migrate_body_type_wording.js)跑与不跑都不再决定这 4 组规则生不生效。
 */
const COND_VALUE_ALIASES = {
  category: { pose: 'posture' },
  scenario: SCENARIO_ALIAS_TO_CANON,
  body_type: BODY_TYPE_ALIASES,
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

  // 区间算子（连续值匹配）：profileVal 和 condVal 都转成数字再比
  if (operator === 'gt' || operator === 'lt' || operator === 'gte' || operator === 'lte') {
    const pv = Number(profileVal)
    const cv = Number(condVal)
    if (!Number.isFinite(pv) || !Number.isFinite(cv)) return false
    if (operator === 'gt') return pv > cv
    if (operator === 'lt') return pv < cv
    if (operator === 'gte') return pv >= cv
    return pv <= cv
  }
  if (operator === 'between') {
    const pv = Number(profileVal)
    if (!Number.isFinite(pv)) return false
    let lo, hi
    if (Array.isArray(condVal)) {
      ;[lo, hi] = condVal
    } else if (condVal && typeof condVal === 'object') {
      lo = ownValue(condVal, 'min')
      hi = ownValue(condVal, 'max')
    } else if (typeof condVal === 'string') {
      // 兼容 "18.5,24" 写法
      const parts = condVal.split(/[,，~]/).map((s) => s.trim())
      lo = parts[0]
      hi = parts[1]
    }
    const loN = Number(lo)
    const hiN = Number(hi)
    if (!Number.isFinite(loN) || !Number.isFinite(hiN)) return false
    return pv >= loN && pv <= hiN
  }

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
 * S5（10-19 蓝图短期项，10-23 落）：把一批命中规则组的计数一次写库。
 * 改前每条命中各发一条 `UPDATE … WHERE id = ?` 并重新 prepare，一场 11~14 次写（§3.4 结论二）。
 * 统计列写失败⛔ 不许影响推荐本体——catch 后 warn，与改前同一把尺子。
 * ⛔ 别把它扩成"定时队列"：现在同请求内落库，比蓝图允许的分钟级延迟更强一致，
 *    测试里断言的"领取重放不抬计数"（incrementHitCount=false 那一路）也因此照旧成立。
 * @param {number[]} ids
 * @returns {number} 实际写库的组数
 */
function _flushHitCounts(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const uniq = [...new Set(ids)]
  try {
    db.prepare(
      `UPDATE rule_groups SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id IN (${uniq
        .map(() => '?')
        .join(',')})`,
    ).run(...uniq)
    return uniq.length
  } catch (err) {
    logWarn(`[推荐引擎] 批量命中计数写入失败（${uniq.length} 组）: ${err.message}`)
    return 0
  }
}

/**
 * 匹配规则并打分
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {string|null} category - 推荐类别
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @param {Array<number>=} hitCollector - S5（10-23）：给了就把命中 id 攒进去、由调用方一次批量落库；
 *                                       不给（外部四参直调、喂源码工装）就本批就地一次写。
 * @returns {Array} 命中的规则组列表
 */
function matchRules(
  profile,
  mode = 'store',
  category = null,
  incrementHitCount = true,
  hitCollector = null,
) {
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
  // S5（10-19 蓝图短期项，10-23 落）：命中先记在内存里，评估完一次批量落库。
  // 改前每命中一条就同步 UPDATE 一次且每次重新 prepare，一场 11~14 次写（§3.4 结论二现量）。
  const hitIds = []
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

      // 累加命中次数（S5，10-23 落）：这里不再逐条 UPDATE——先攒进 hitIds，
      // 出循环后按"有没有 collector"决定本批就地一次写、还是交给 buildRecommendation 跨品类合并写。
      if (incrementHitCount) hitIds.push(group.id)
    }
  }

  // 排序:priority 降序,score 降序,最后按 id 升序兜底。
  // 前两级之后还剩多少并列，10-13 现量线上：enabled=1 的组里 priority=25 就有 79 组、
  // priority=5 有 76 组，而同一个 mode+category+priority 键下最多 68 组同分 ⇒
  // 只排两级时，并列的先后完全由 SELECT 的返回序决定（这条 SQL 没有 ORDER BY），
  // 而报告端只取前 3 条 ⇒ 重建一次库、top3 可能整体换人。id 兜底把顺序定死成建规先后。
  matched.sort((a, b) => b.priority - a.priority || b.score - a.score || a.group_id - b.group_id)

  // S5 落库点①：无人代收时本批一次写完（净效果与改前逐条写相同：每条命中 hit_count+1）。
  if (incrementHitCount) {
    if (Array.isArray(hitCollector)) hitCollector.push(...hitIds)
    else _flushHitCounts(hitIds)
  }

  return matched
}

module.exports = {
  CATEGORIES,
  matchRules,
  _flushHitCounts,
}
