/**
 * 风格型与视觉比例档位层（11-03 从 profileEnricher.js 拆出，行为不变；拆前原文 463-557 行）。
 *
 * 职责：骨架量感×线条倾向 → Kibbe 方向五型（§5.56），比例状态码 → 规则条件用的中文档位（§5.6）。
 *
 * 两段的共同点是"把自报的表单值换算成档位"，所以住一个文件：
 *   · 5.56 那两张轴表加一张五型表，缺一轴不猜；
 *   · 5.6 那三张档位表把 short/normal/wide 这类引擎内部码翻成后台与顾客看得懂的字，
 *     规则条件里存的就是这些中文档位名 ⇒ 改名等于改规则库，⛔ 不许在这里单方面换词。
 *
 * 连续值 ↔ 离散档名的互转（frameSizeFromValue／lineQualityFromValue）也在这里，
 * 因为切点 33.33／66.67 与 FRAME_LEVEL／LINE_LEVEL 是同一件事的两半，分开放迟早对不上。
 */
const { ownValue } = require('../../utils/common')

// ============================================================
// 5.56 风格型（量感与线条，Kibbe 方向的五型简化）
// ============================================================

/** 骨架量感:表单值 → 轴位 */
const FRAME_LEVEL = { 小巧: '小', 适中: '中', 大气: '大' }

/** 身体线条倾向:表单值 → 轴位 */
const LINE_LEVEL = { 偏直线: '直', 均衡: '衡', 偏曲线: '曲' }

/**
 * 连续值 → 离散档名（风格型两轴的连续↔离散互转）。
 * frame_size_value / line_quality_value 都是 0~100。
 * 切点 33/67 是三等分（C 档手拍，后续可回归）。
 */
function frameSizeFromValue(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n < 33.33) return '小巧'
  if (n > 66.67) return '大气'
  return '适中'
}
function lineQualityFromValue(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n < 33.33) return '偏直线'
  if (n > 66.67) return '偏曲线'
  return '均衡'
}

/**
 * 骨架 × 线条 → 五型方向。取的是 Kibbe 里最好自报的两维(量感大小、曲直),
 * 只做到五型方向,不做十三型——十三型要看骨架长度与头身比的实测,表单收不到。
 *   小骨架直/衡 = 少女型(短巧利落) 小骨架曲 = 浪漫型(小巧但圆润)
 *   中骨架直/衡 = 优雅型(比例对称)  中骨架曲 = 浪漫型(曲线主导)
 *   大骨架直 = 戏剧型(长直棱角)     大骨架衡/曲 = 自然型(宽大松弛)
 */
const KIBBE_TABLE = {
  小: { 直: '少女型', 衡: '少女型', 曲: '浪漫型' },
  中: { 直: '优雅型', 衡: '优雅型', 曲: '浪漫型' },
  大: { 直: '戏剧型', 衡: '自然型', 曲: '自然型' },
}

/**
 * @param {string} frameSize 骨架量感(小巧/适中/大气)
 * @param {string} lineQuality 线条倾向(偏直线/均衡/偏曲线)
 * @returns {{kibbe_type?: string}} 两个轴缺一不猜
 */
function computeKibbeType(frameSize, lineQuality) {
  // 这两维是表单里的中文选项，也是"能一路走到双重索引"的输入：
  // 不做自有键检查时骨架填成 constructor 会让 KIBBE_TABLE[函数] 变 undefined，
  // 紧接着的 [线] 就是 Cannot read properties of undefined ⇒ 整条分析 500
  const frame = ownValue(FRAME_LEVEL, frameSize)
  const line = ownValue(LINE_LEVEL, lineQuality)
  if (!frame || !line) return {}
  return { kibbe_type: ownValue(KIBBE_TABLE, frame)?.[line] }
}

// ============================================================
// 5.6 视觉比例档位（60-30-10 规则的条件字段）
// ============================================================

/** 引擎内部状态码 → 后台与顾客看得懂的中文档位 */
const PROPORTION_LEVEL_LABELS = {
  leg_status: { short: '偏短', normal: '标准', long: '偏长' },
  shoulder_status: { narrow: '偏窄', normal: '标准', wide: '偏宽' },
  wh_status: { good: '明显', normal: '中等', warning: '模糊' },
}

/** 肩型是表单直接选的选项,没有肩宽 cm 时用它兜底(两个表单都只收了肩型) */
const SHOULDER_TYPE_LABELS = { 窄肩: '偏窄', 标准肩: '标准', 宽肩: '偏宽' }

/**
 * 把算出来的比例状态换算成规则条件用的中文字段
 * 腿身比要身高+腿长、腰线要腰围+臀围,没量就不猜;肩宽优先用实测、否则用选的肩型
 * @returns {{leg_proportion?: string, shoulder_frame?: string, waist_definition?: string}}
 */
function computeProportionLevels({ leg_status, shoulder_status, shoulder_type, wh_status }) {
  // 三个档位表都必须走 ownValue：computeProportionLevels 的入参是**整份用户档案**
  // （enrichProfile 里是 computeProportionLevels(p)），leg_status 这类字段
  // 客户端可以直接塞。原来用方括号取值，`leg_status:'constructor'` 会取到
  // Object 构造函数（真值 ⇒ 判据成立），把函数塞进 leg_proportion：
  // 规则按 '偏短/标准/偏长' 比对永远对不上，而 JSON.stringify 会把函数字段整个丢掉，
  // 存档里这条派生字段凭空消失。'__proto__' 同理取到 Object.prototype。
  const out = {}
  const legLabel = ownValue(PROPORTION_LEVEL_LABELS.leg_status, leg_status)
  if (legLabel) out.leg_proportion = legLabel
  const shoulderLabel = ownValue(PROPORTION_LEVEL_LABELS.shoulder_status, shoulder_status)
  const shoulderTypeLabel = ownValue(SHOULDER_TYPE_LABELS, shoulder_type)
  if (shoulderLabel) out.shoulder_frame = shoulderLabel
  else if (shoulderTypeLabel) out.shoulder_frame = shoulderTypeLabel
  const whLabel = ownValue(PROPORTION_LEVEL_LABELS.wh_status, wh_status)
  if (whLabel) out.waist_definition = whLabel
  return out
}

module.exports = {
  FRAME_LEVEL,
  LINE_LEVEL,
  KIBBE_TABLE,
  frameSizeFromValue,
  lineQualityFromValue,
  computeKibbeType,
  computeProportionLevels,
}
