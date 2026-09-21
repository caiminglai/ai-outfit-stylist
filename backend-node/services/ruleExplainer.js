/**
 * 规则引擎可解释性模块
 *
 * 作用:把 rule_conditions 里的 field/operator/value(原始格式)
 *      翻译成普通人能看懂的中文,让用户理解"规则怎么匹配我的档案".
 *
 * 数据格式参考:
 *   rule_conditions.value 是 JSON 字符串,如 {"gender": "女"}
 *   field 有 25 种:gender/category/scenario/skin_tone/face_shape...
 *   operator 有 3 种:eq(等于)/in(属于)/ne(不等于)
 *   category 的值是英文:outfit/makeup/hairstyle/accessory/posture
 */

// ============================================================
// 1. 字段中文标签映射
// ============================================================

/**
 * 规则条件 field → 中文标签
 * 这些 field 对应顾客档案里的填写项
 */
const FIELD_LABELS = {
  gender: '性别',
  category: '推荐类别', // 内部字段,表示这条规则属于哪类推荐
  scenario: '场景',
  skin_tone: '肤色',
  face_shape: '脸型',
  region: '地区',
  body_type: '体型',
  bmi_level: 'BMI等级',
  preferred_style: '风格偏好',
  main_goal: '主要目标',
  posture: '体态',
  eye_size: '眼睛大小',
  nose_bridge: '鼻梁',
  lip_thickness: '唇厚',
  season: '季节',
  age_range: '年龄段',
  occasion: '场合',
  skin_type: '肤质',
  height_range: '身高范围',
  height_wish: '身高愿望',
  budget: '预算',
  neck_length: '颈长',
  shoulder_type: '肩型',
  skin_tone_detail: '肤色细分',
  allergy_metal: '过敏金属',
};

/**
 * category 字段的英文值 → 中文(用户可读)
 * category 是规则引擎内部用的分类标识,需要翻译给用户看
 */
const CATEGORY_VALUE_LABELS = {
  outfit: '穿搭',
  makeup: '妆容',
  hairstyle: '发型',
  accessory: '配饰',
  posture: '姿势',
};

/**
 * category 中文 → 英文(规则引擎内部标识)
 * 反向映射,用于 matchRules 把 rule_groups.category(中文) 转成 condition 检查用的英文值
 * 修复 bug:规则条件 category 值是英文(outfit),但 evalProfile.category 之前赋的是中文('穿搭'),
 *          导致 category 条件永远不匹配,规则引擎从未真正工作
 */
const CATEGORY_CN_TO_EN = {
  穿搭: 'outfit',
  妆容: 'makeup',
  发型: 'hairstyle',
  配饰: 'accessory',
  姿势: 'posture',
};

/**
 * operator → 中文连接词
 * eq 用冒号简洁表示,in/ne 用文字说明
 */
const OPERATOR_LABELS = {
  eq: '', // 用冒号格式: "性别:女"
  in: '属于',
  ne: '不等于',
};

// ============================================================
// 2. 解析 condition.value(JSON 字符串)
// ============================================================

/**
 * 解析规则条件的 value 字段
 * value 可能是:
 *   - JSON 字符串: '{"gender": "女"}' → 解析为对象
 *   - 普通字符串: 'all' → 直接返回
 *   - 其他: 尝试 JSON.parse,失败则返回原值
 * @param {string} rawValue
 * @returns {*}
 */
function parseConditionValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return rawValue;
  if (typeof rawValue !== 'string') return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * 从解析后的 value 中提取实际匹配值
 * value 格式有两种:
 *   - {"gender": "女"} → 提取 "女"
 *   - "女"(直接值) → 直接返回
 *   - ["女", "男"](数组) → 直接返回
 * @param {*} parsed - parseConditionValue 的返回值
 * @param {string} field - 当前条件的 field 名
 * @returns {*}
 */
function extractMatchValue(parsed, field) {
  // 对象格式: {"field": value}
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (field in parsed) {
      return parsed[field];
    }
    // 兜底:取第一个值
    const vals = Object.values(parsed);
    return vals.length > 0 ? vals[0] : parsed;
  }
  // 直接值或数组
  return parsed;
}

/**
 * 把单个匹配值翻译成中文(主要处理 category 的英文值)
 * @param {*} val
 * @returns {string}
 */
function translateValue(val) {
  if (val === 'all' || val === null || val === undefined) return '不限';
  if (typeof val === 'string') {
    // category 英文值翻译
    if (CATEGORY_VALUE_LABELS[val]) return CATEGORY_VALUE_LABELS[val];
    return val;
  }
  return String(val);
}

// ============================================================
// 3. 核心:explainCondition(单个条件 → 中文描述)
// ============================================================

/**
 * 把单条规则条件翻译成中文人话
 *
 * 示例:
 *   {field: 'gender', operator: 'eq', value: '{"gender":"女"}'}
 *   → '性别:女'
 *
 *   {field: 'face_shape', operator: 'in', value: '["圆脸","方脸"]'}
 *   → '脸型 属于 圆脸、方脸'
 *
 *   {field: 'skin_tone', operator: 'ne', value: '{"skin_tone":"暖皮"}'}
 *   → '肤色 不等于 暖皮'
 *
 * @param {{field: string, operator: string, value: string}} condition
 * @returns {string} 中文描述
 */
function explainCondition(condition) {
  const { field, operator, value } = condition;
  const fieldLabel = FIELD_LABELS[field] || field;
  const parsed = parseConditionValue(value);
  const matchVal = extractMatchValue(parsed, field);
  const opLabel = OPERATOR_LABELS[operator] || operator;

  // "all" 表示不限,特殊处理
  if (matchVal === 'all') {
    return `${fieldLabel}:不限`;
  }

  // eq: 简洁冒号格式 "性别:女"
  if (operator === 'eq') {
    return `${fieldLabel}:${translateValue(matchVal)}`;
  }

  // in: "脸型 属于 圆脸、方脸"
  if (operator === 'in') {
    let valList = matchVal;
    // value 可能是字符串形式的 JSON 数组
    if (typeof valList === 'string') {
      try {
        valList = JSON.parse(valList);
      } catch {
        valList = [valList];
      }
    }
    if (!Array.isArray(valList)) valList = [valList];
    const translated = valList.map((v) => translateValue(v)).join('、');
    return `${fieldLabel} ${opLabel} ${translated}`;
  }

  // ne: "肤色 不等于 暖皮"
  if (operator === 'ne') {
    return `${fieldLabel} ${opLabel} ${translateValue(matchVal)}`;
  }

  // 兜底
  return `${fieldLabel} ${opLabel} ${translateValue(matchVal)}`;
}

// ============================================================
// 4. 规则组概览解释
// ============================================================

/**
 * 判断某个 field 是否为用户可见的档案字段
 * (category 是内部字段,其他都是用户填写的档案字段)
 * @param {string} field
 * @returns {boolean}
 */
function isUserFacingField(field) {
  return field !== 'category';
}

/**
 * 生成规则组的人话概览
 * 用于规则浏览器展示"这条规则是干什么的"
 *
 * @param {object} group - rule_groups 记录
 * @param {Array} conditions - 该组的 rule_conditions 记录列表
 * @returns {{
 *   规则名称: string,
 *   推荐类别: string,
 *   适用场景: string|null,
 *   适用性别: string|null,
 *   匹配条件: string[],
 *   规则说明: string,
 *   优先级: number
 * }}
 */
function explainGroup(group, conditions) {
  // 过滤出用户可见的匹配条件(排除 category 内部字段)
  const userConditions = (conditions || []).filter((c) => isUserFacingField(c.field));

  return {
    规则名称: group.name || '',
    推荐类别: CATEGORY_VALUE_LABELS[group.category] || group.category || '',
    适用场景: group.scenario || null,
    适用性别: group.gender || null,
    匹配条件: userConditions.map((c) => explainCondition(c)),
    规则说明: group.description || '',
    优先级: group.priority || 0,
  };
}

/**
 * 生成推荐结果的单条解释
 * 用于推荐卡片展示"为什么推荐这个"
 *
 * @param {object} matched - matchRules 返回的单条命中结果
 * @param {Array} allConditions - 该规则组的所有条件(含命中和未命中)
 * @returns {{
 *   命中条件: string[],
 *   匹配分: number,
 *   优先级: number,
 *   规则说明: string
 * }}
 */
function explainMatchedRecommendation(matched, allConditions) {
  // 只展示命中的、用户可见的条件
  const hitUserConditions = (allConditions || []).filter(
    (c) => c.matched && isUserFacingField(c.field),
  );

  return {
    命中条件: hitUserConditions.map((c) => explainCondition(c)),
    匹配分: matched.score || 0,
    优先级: matched.priority || 0,
    规则说明: matched.group_name || '',
  };
}

module.exports = {
  FIELD_LABELS,
  CATEGORY_VALUE_LABELS,
  CATEGORY_CN_TO_EN,
  OPERATOR_LABELS,
  parseConditionValue,
  extractMatchValue,
  translateValue,
  explainCondition,
  explainGroup,
  explainMatchedRecommendation,
  isUserFacingField,
};
