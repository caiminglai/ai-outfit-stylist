/**
 * 肤色 → 色系／季型匹配层（11-03 从 profileEnricher.js 拆出，行为不变；原文 :312-461）。
 *
 * 职责：肤色词的适合色与避免色（§5）、冷暖×明度 → 四季型（§5.5）、四季×纯度 → 十二型（§5.55）。
 *
 * 三张表都按顾客在表单里打的自由文本查值 ⇒ 一律走 `utils/common.js` 的 `ownValue` 只认自有键：
 * 普通方括号查法遇到 'constructor'／'__proto__' 这类原型键会返回一个真值（函数或原型对象），
 * 把后面的判据全放过去，最后要么整段建议消失、要么当场抛成 500。这条在本文件里出现过三次，
 * 逐条写在对应函数注释里，⛔ 别改回方括号直查。
 *
 * 四季与十二型分成两个字段是有原因的：四季那批规则已经上线，十二型是后加的第三轴，
 * 没选纯度的人要照样拿到四季型并命中原有规则（见 computeColorSeason12）。
 */
const { ownValue } = require('../../utils/common')

// ============================================================
// 5. 肤色-色系匹配
// ============================================================

const SKIN_TONE_COLOR_MAP = {
  暖皮: {
    colors: '焦糖、砖红、橄榄绿、姜黄、珊瑚粉、奶油白、咖啡棕',
    avoid: '避免纯白、宝蓝、玫红等冷调高饱和色，容易显脸色发灰',
    reason: '暖调中饱和色与黄调皮肤呼应，能提气色而不打架',
  },
  冷皮: {
    colors: '宝蓝、纯白、玫红、薰衣草紫、冷灰、薄荷绿、正红',
    avoid: '避免橘色、土黄、驼色等暖调大地色，会让粉调皮肤发暗',
    reason: '冷调清晰色能衬托粉调肤色，对比越干净越显白',
  },
  自然: {
    colors: '豆沙粉、雾霾蓝、墨绿、米色、灰蓝等中等饱和度正色',
    avoid: '避免荧光色和整套暗沉黑灰',
    reason: '中性肤色容错高，避开冷暖两端的强对比即可',
  },
  白皙: {
    colors: '宝蓝、酒红、墨绿、樱花粉、薰衣草紫',
    avoid: '避免过于暗沉的灰褐色',
    reason: '白皙肤色能驾驭大部分高饱和色，冷色系尤其出彩',
  },
  自然白: {
    colors: '莫兰迪色系、大地色、雾霾蓝、豆沙粉',
    avoid: '避免过黄或过于鲜艳的橘色',
    reason: '自然白适合中等饱和度的柔和色系',
  },
  偏黄: {
    colors: '藏蓝、灰粉、薄荷绿、酒红、白色',
    avoid: '避免橘色、土黄、卡其色',
    reason: '冷色调能中和黄色调，提亮整体气色',
  },
  小麦色: {
    colors: '亮白、鹅黄、珊瑚色、宝蓝、橙色',
    avoid: '避免暗沉的褐色、深灰色',
    reason: '高饱和色能展现小麦色的健康活力',
  },
  古铜色: {
    colors: '白色、亮红、翠绿、金色、橙色',
    avoid: '避免暗沉色调',
    reason: '强对比色能突出古铜色的性感光泽',
  },
}

/**
 * 根据肤色返回适合/避免的颜色建议
 * @param {string} skinTone
 * @returns {{color_match: string, color_avoid: string, color_reason: string}}
 */
function computeColorMatch(skinTone) {
  // 肤色词来自表单/档案，只认表里自己的键：SKIN_TONE_COLOR_MAP['constructor'] 会返回
  // Object 构造器，guide.colors 变 undefined，"适合色/避免色"整段从响应里消失
  const guide = ownValue(SKIN_TONE_COLOR_MAP, skinTone) || SKIN_TONE_COLOR_MAP['自然白']
  return {
    color_match: guide.colors,
    color_avoid: guide.avoid,
    color_reason: guide.reason,
  }
}

// ============================================================
// 5.5 色彩四季型（Seasonal Color Analysis 的四季粗分）
// ============================================================

/** 表单里的肤色深浅是一个明度有序表:白皙最浅,古铜色最深 */
const DEPTH_LEVEL = {
  白皙: '浅',
  自然白: '浅',
  偏黄: '深',
  小麦色: '深',
  古铜色: '深',
}

/** 只收到深浅没收到冷暖时,按深浅就近推冷暖(白皙偏粉调、偏黄小麦古铜偏黄调) */
const UNDERTONE_FROM_DEPTH = {
  白皙: '冷皮',
  自然白: '自然',
  偏黄: '暖皮',
  小麦色: '暖皮',
  古铜色: '暖皮',
}

/**
 * 冷暖 × 明度 → 四季型
 * 四季只用到这两根轴;十二型还要第三轴"纯度",由 5.55 单独派生。
 * 分成两个字段是为了让已上线的 20 组四季规则不受影响——四季档不管纯度,照样出建议。
 */
const COLOR_SEASON_TABLE = {
  暖皮: { 浅: '春型', 深: '秋型' },
  冷皮: { 浅: '夏型', 深: '冬型' },
  自然: { 浅: '夏型', 深: '秋型' },
}

/**
 * 推导色彩四季型
 * @param {string} skinTone 肤色(可能是"暖皮/冷皮/自然",也可能被上游别名成深浅词)
 * @param {string} skinToneDetail 肤色细分(白皙/自然白/偏黄/小麦色/古铜色)
 * @returns {{color_season?: string}} 两个轴都拿不到时不猜,返回空对象
 */
function computeColorSeason(skinTone, skinToneDetail) {
  // 三张表都按表单里的自由文本查：'constructor' 这类原型键在普通查法下是 truthy 的函数，
  // 会把 !depth / !undertone 两道闸门全部放过去，最后 KIBBE_TABLE[函数][函数] 当场抛 ⇒ 500
  const words = [skinTone, skinToneDetail].filter((w) => typeof w === 'string' && w)
  const depthWord = words.find((w) => ownValue(DEPTH_LEVEL, w))
  const depth = depthWord ? DEPTH_LEVEL[depthWord] : null
  const undertone =
    words.find((w) => ownValue(COLOR_SEASON_TABLE, w)) ||
    (depthWord ? ownValue(UNDERTONE_FROM_DEPTH, depthWord) : null)
  if (!undertone || !depth) return {}
  const season = ownValue(COLOR_SEASON_TABLE, undertone)?.[depth]
  return season ? { color_season: season } : {}
}

// ============================================================
// 5.55 色彩十二型（四季 × 纯度第三轴）
// ============================================================

/** 表单选的纯度档 → 轴位:净=高饱和清透最衬,柔=带灰雾感最衬,中=两者都不突出 */
const CHROMA_LEVEL = { 净亮: '净', 柔雾: '柔', 中间: '中' }

/**
 * 四季 × 纯度 → 十二型。每季三型的分工是"哪根轴最突出":
 *   净 → 该季里最清透的那型(亮春/浅夏/深秋/亮冬)
 *   柔 → 该季里最带灰的那型(浅春/柔夏/柔秋/深冬)
 *   中 → 该季的本调(暖春/冷夏/暖秋/冷冬)
 * 归属规则:春、秋按"暖"定,夏、冬按"冷"定,所以秋夏的柔档落在边界型上。
 * 冷+浅+净 归到浅夏是就近归属——真正的"净"会把这个方向推向春或冬,
 * 但三根自报轴分不出跨季边界,写死一个型比让人在春秋之间瞎猜更诚实。
 */
const COLOR_SEASON_12_TABLE = {
  春型: { 净: '亮春型', 中: '暖春型', 柔: '浅春型' },
  夏型: { 净: '浅夏型', 中: '冷夏型', 柔: '柔夏型' },
  秋型: { 净: '深秋型', 中: '暖秋型', 柔: '柔秋型' },
  冬型: { 净: '亮冬型', 中: '冷冬型', 柔: '深冬型' },
}

/**
 * @param {string} colorSeason 5.5 算出的四季型(没有就不猜十二型)
 * @param {string} colorChroma 表单选的纯度档(净亮/柔雾/中间)
 * @returns {{color_season_12?: string}}
 */
function computeColorSeason12(colorSeason, colorChroma) {
  const row = ownValue(COLOR_SEASON_12_TABLE, colorSeason)
  const chroma = ownValue(CHROMA_LEVEL, colorChroma)
  if (!row || !chroma) return {}
  return { color_season_12: row[chroma] }
}

module.exports = {
  SKIN_TONE_COLOR_MAP,
  computeColorMatch,
  computeColorSeason,
  computeColorSeason12,
  CHROMA_LEVEL,
  COLOR_SEASON_12_TABLE,
}
