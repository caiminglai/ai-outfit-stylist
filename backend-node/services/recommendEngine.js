/**
 * 穿搭推荐引擎
 * 从 Python app/services/recommend_engine.py + rule_engine.py 翻译
 *
 * 包含:
 * 1. getRecommendations: 旧版硬编码推荐(兼容)
 * 2. buildRecommendation: 规则引擎推荐(基础版,完整版待 Phase 3.5 实现)
 */

const db = require('../db/init');
const {
  enrichProfile,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  computeColorMatch,
} = require('./profileEnricher');
const { explainMatchedRecommendation, CATEGORY_CN_TO_EN } = require('./ruleExplainer');

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
  };

  return defaults[scenario] || defaults['休闲'];
}

// ============================================================
// 规则引擎推荐(基础版)
// 从 Python app/services/rule_engine.py build_recommendation() 翻译
// 完整版(含 enrich_profile / algorithm_analysis)待 Phase 3.5 实现
// ============================================================

// 推荐类别常量
const CATEGORIES = ['穿搭', '妆容', '发型', '配饰'];

/**
 * 解析规则条件的 value(JSON 字符串)
 */
function parseConditionValue(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * 检查单个条件是否命中
 */
function checkSingleCondition(condition, profile) {
  const parsed = parseConditionValue(condition.value);
  const field = condition.field;
  const operator = condition.operator;

  const profileVal = profile[field];

  // 从 parsed 中取出匹配值
  let condVal;
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && field in parsed) {
    condVal = parsed[field];
  } else {
    condVal = parsed;
  }

  // "all" 表示不限,始终命中
  if (condVal === 'all') return true;

  // profile 中该字段为空时,只有 "all" 才能命中
  if (profileVal === null || profileVal === undefined) return false;

  if (operator === 'eq') {
    return String(profileVal) === String(condVal);
  } else if (operator === 'in') {
    let valList = condVal;
    if (typeof valList === 'string') {
      try {
        valList = JSON.parse(valList);
      } catch {
        valList = [valList];
      }
    }
    if (!Array.isArray(valList)) valList = [valList];
    return valList.some((v) => String(v) === String(profileVal));
  } else if (operator === 'ne') {
    return String(profileVal) !== String(condVal);
  }

  return false;
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
    return [true, 0, []];
  }

  let scoredWeight = 0;
  let allMatched = true;
  const details = [];

  for (const cond of conditions) {
    const matched = checkSingleCondition(cond, profile);
    if (matched) {
      scoredWeight += cond.weight || 1;
    } else {
      allMatched = false;
    }
    details.push({
      field: cond.field,
      operator: cond.operator,
      value: cond.value,
      matched,
    });
  }

  return [allMatched, scoredWeight, details];
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
  let query = 'SELECT * FROM rule_groups WHERE enabled = 1 AND mode = ?';
  const params = [mode];

  // 按 gender 筛选
  const gender = profile.gender;
  if (gender) {
    query += ' AND (gender = ? OR gender IS NULL)';
    params.push(gender);
  }

  // 按 scenario 筛选
  const scenario = profile.scenario;
  if (scenario) {
    query += ' AND (scenario = ? OR scenario IS NULL)';
    params.push(scenario);
  }

  // 按 category 筛选
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  const groups = db.prepare(query).all(...params);

  if (groups.length === 0) return [];

  // 批量加载所有相关 conditions 和 actions(避免 N+1 查询)
  const groupIds = groups.map((g) => g.id);
  const placeholders = groupIds.map(() => '?').join(',');
  const allConditions = db
    .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${placeholders})`)
    .all(...groupIds);
  const allActions = db
    .prepare(`SELECT * FROM rule_actions WHERE group_id IN (${placeholders}) ORDER BY sort_order`)
    .all(...groupIds);

  // 按 group_id 分组
  const conditionsByGroup = {};
  for (const c of allConditions) {
    ; (conditionsByGroup[c.group_id] ||= []).push(c);
  }
  const actionsByGroup = {};
  for (const a of allActions) {
    ; (actionsByGroup[a.group_id] ||= []).push(a);
  }

  // 逐组评估
  const matched = [];
  for (const group of groups) {
    const conditions = conditionsByGroup[group.id] || [];

    // 把 rule_groups.category(中文) 转成英文,与规则条件 category 值(outfit)对齐
    // 修复 bug:之前赋中文 '穿搭' 导致 category 条件永远不匹配,规则引擎从未真正工作
    const evalProfile = { ...profile, category: CATEGORY_CN_TO_EN[group.category] || group.category };
    const [hit, score, conditionDetails] = evaluateGroup(group, conditions, evalProfile);

    if (hit) {
      // 使用预加载的 actions
      const actions = {};
      for (const action of actionsByGroup[group.id] || []) {
        actions[action.action_type] = action.content;
      }

      matched.push({
        group_id: group.id,
        group_name: group.name,
        category: group.category,
        scenario: group.scenario,
        priority: group.priority || 0,
        score,
        actions,
        // 命中条件详情(含每个条件的命中状态,供生成可解释性说明)
        condition_details: conditionDetails,
      });

      // 累加命中次数
      if (incrementHitCount) {
        try {
          db.prepare('UPDATE rule_groups SET hit_count = hit_count + 1 WHERE id = ?').run(group.id);
        } catch {
          // 不影响主流程
        }
      }
    }
  }

  // 排序:priority 降序,score 降序
  matched.sort((a, b) => b.priority - a.priority || b.score - a.score);

  return matched;
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
  const enriched = enrichProfile(profile);

  const result = {
    穿搭: [],
    妆容: [],
    发型: [],
    配饰: [],
    _mode: mode,
    _computed: {},
    algorithm_analysis: null,
  };

  // 2. 填充 _computed(供前端展示数据概览)
  if (enriched.bmi) {
    result._computed.bmi = enriched.bmi;
    result._computed.bmi_level = enriched.bmi_level;
  }
  if (enriched.body_shape) {
    result._computed.body_shape = enriched.body_shape;
    result._computed.body_shape_key = enriched.body_shape_key;
  }
  if (enriched.wh_ratio) {
    result._computed.wh_ratio = enriched.wh_ratio;
    result._computed.wh_status = enriched.wh_status;
  }
  if (enriched.leg_ratio) {
    result._computed.leg_ratio = enriched.leg_ratio;
  }
  if (enriched.shoulder_ratio) {
    result._computed.shoulder_ratio = enriched.shoulder_ratio;
  }
  if (enriched.color_match) {
    result._computed.color_match = enriched.color_match;
    result._computed.color_avoid = enriched.color_avoid;
  }

  // 3. 填充 algorithm_analysis(个人模式的深度分析报告)
  if (mode === 'personal') {
    const advices = [];

    // 体型分析
    if (enriched.body_shape_key) {
      const outfitAdvice = getBodyShapeOutfitAdvice(enriched.body_shape_key);
      advices.push({
        title: `体型分析:${enriched.body_shape}`,
        advices: [outfitAdvice],
      });
    }

    // 脸型分析
    if (enriched.face_shape) {
      const faceGuide = getFaceShapeGuide(enriched.face_shape);
      advices.push({
        title: `脸型分析:${enriched.face_shape}`,
        advices: [
          faceGuide.face_analysis,
          `发型建议:${faceGuide.hair_advice}`,
          `妆容建议:${faceGuide.makeup_advice}`,
          `修容建议:${faceGuide.contour_advice}`,
        ],
      });
    }

    // 肤色配色建议
    if (enriched.color_match) {
      advices.push({
        title: '肤色配色建议',
        advices: [
          `适合色系:${enriched.color_match}`,
          enriched.color_avoid || '',
          enriched.color_reason || '',
        ].filter(Boolean),
      });
    }

    // 体态建议
    if (enriched.posture_advice) {
      advices.push({
        title: '体态建议',
        advices: [enriched.posture_advice],
      });
    }

    if (advices.length > 0) {
      result.algorithm_analysis = {
        body_analysis: advices.find((a) => a.title.includes('体型')) || null,
        face_analysis: advices.find((a) => a.title.includes('脸型')) || null,
        optimization:
          advices.find((a) => a.title.includes('肤色') || a.title.includes('体态')) || null,
      };
    }
  }

  // 4. 规则引擎匹配(使用增强后的 profile)
  for (const cat of CATEGORIES) {
    const matched = matchRules(enriched, mode, cat, incrementHitCount);
    for (const m of matched) {
      const recommendation = {
        group_id: m.group_id,
        group_name: m.group_name,
        priority: m.priority,
        score: m.score,
      };
      Object.assign(recommendation, m.actions);
      // 注入可解释性说明:这条推荐命中了哪些条件(中文人话,供前端展示"为什么推荐")
      recommendation.explanation = explainMatchedRecommendation(m, m.condition_details);
      result[cat].push(recommendation);
    }
  }

  // 5. 兜底:规则引擎未命中时用旧版硬编码推荐
  if (result['穿搭'].length === 0) {
    const scenario = enriched.scenario || profile.scenario || '通勤';
    const fallback = getRecommendations(
      enriched.skin_tone || profile.skin_tone,
      enriched.face_shape || profile.face_shape,
      scenario,
    );
    for (const item of fallback) {
      result['穿搭'].push({
        group_name: '默认推荐',
        priority: 0,
        score: 0,
        outfit_top: item.top_style,
        outfit_bottom: item.bottom_style,
        outfit_color: item.color_combo,
        outfit_reason: item.reason,
      });
    }
  }

  return result;
}

module.exports = { getRecommendations, buildRecommendation };
