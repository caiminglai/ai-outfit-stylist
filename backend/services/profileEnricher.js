/**
 * 用户档案 enricher（算法计算层）
 *
 * 从 Python profile_enricher.py 翻译：
 *   - BMI 计算与分级
 *   - 体型自动分类（沙漏/梨形/苹果/直筒/倒三角）
 *   - 腰臀比、腿身比、肩宽比分析
 *   - 肤色-色系匹配
 *   - 脸型-发型/妆容/配饰映射
 *   - 体态问题-穿搭映射
 */

const { analyzeBazi, analyzeDay, parseBirthDate } = require('./baziWuxing')

// 简易内存缓存（避免重复计算相同 profile）
const _enrichCache = new Map()
const _CACHE_MAX = 200

/**
 * 将 profile 转为可哈希的缓存键
 * @param {object} profile
 * @returns {string}
 */
function _cacheKey(profile) {
  return JSON.stringify(profile)
}

/**
 * 安全转 number，失败返回 default
 * @param {*} val
 * @param {number} defaultVal
 * @returns {number}
 */
function _safeFloat(val, defaultVal = 0.0) {
  if (val === null || val === undefined) return defaultVal
  const num = Number(val)
  return isNaN(num) ? defaultVal : num
}

// ============================================================
// 1. BMI
// ============================================================

/**
 * 计算 BMI 及等级
 * @param {number} heightCm
 * @param {number} weightKg
 * @returns {{bmi: number, bmi_level: string, bmi_status: string}}
 */
function computeBmi(heightCm, weightKg) {
  const h = _safeFloat(heightCm) / 100
  const w = _safeFloat(weightKg)
  if (h <= 0 || w <= 0) {
    return { bmi: 22.0, bmi_level: '正常', bmi_status: 'good' }
  }
  const bmi = w / (h * h)
  if (bmi < 18.5) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '偏瘦', bmi_status: 'warning' }
  }
  if (bmi < 24) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '正常', bmi_status: 'good' }
  }
  if (bmi < 28) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '偏胖', bmi_status: 'warning' }
  }
  return { bmi: Math.round(bmi * 10) / 10, bmi_level: '肥胖', bmi_status: 'danger' }
}

// ============================================================
// 2. 体型分类（胸腰差 vs 臀腰差）
// ============================================================

/**
 * 根据胸围-腰围-臀围-肩宽自动判断体型
 * @param {number} bust
 * @param {number} waist
 * @param {number} hip
 * @param {number} shoulder
 * @returns {{body_shape?: string, body_shape_key?: string, body_shape_status?: string}}
 *   胸/腰/臀缺任一项 → {}；上身占优但没量肩宽 → 只给 body_shape_status:'unmeasured'
 */
function computeBodyShape(bust, waist, hip, shoulder) {
  const b = _safeFloat(bust)
  const w = _safeFloat(waist)
  const h = _safeFloat(hip)
  // 缺测不出分:原来这里拿 84/66/90 三个"标准身材"值兜底，量都没量就判出一个体型档
  if (b <= 0 || w <= 0 || h <= 0) return {}

  const bwDiff = b - w
  const whDiff = h - w

  if (Math.abs(bwDiff - whDiff) < 5 && bwDiff > 10) {
    return { body_shape: '沙漏型', body_shape_key: 'hourglass', body_shape_status: 'good' }
  }
  if (whDiff > bwDiff + 5) {
    return { body_shape: '梨形', body_shape_key: 'pear', body_shape_status: 'normal' }
  }
  if (bwDiff > whDiff + 5) {
    const s = _safeFloat(shoulder)
    // "上身占优"有两种成因：肩真的宽（倒三角）还是腰腹粗（苹果）。这根轴只有量了肩宽才分得开。
    // 原来这里靠 shoulder||38 编一个 38 出来判成苹果型，给客户贴一个没测过的体型标签。
    if (s <= 0) return { body_shape_status: 'unmeasured' }
    if (s > h * 0.45) {
      return {
        body_shape: '倒三角型',
        body_shape_key: 'inverted_triangle',
        body_shape_status: 'normal',
      }
    }
    return { body_shape: '苹果型', body_shape_key: 'apple', body_shape_status: 'warning' }
  }
  return { body_shape: '直筒型', body_shape_key: 'rectangle', body_shape_status: 'normal' }
}

// ============================================================
// 3. 腰臀比
// ============================================================

/**
 * @param {number} waist
 * @param {number} hip
 * @returns {{wh_ratio: number, wh_status: string}}
 */
/**
 * 腰臀比分档：**必须分性别**，男女的正常区间不重叠。
 * 口径来源（2026-10-06 现量核实）：
 *  - 正式出处（🟢 10-10 第二十一轮订正）：WHO《Waist circumference and waist-hip ratio: report of a WHO expert consultation, Geneva, 8-11 December 2008》，**2011 年出版**、ISBN 9789241501491、IRIS handle 10665/44583 ⇒ 元数据【官方原文·登记页】；旧注释那个文档号 WHO/NHD/08.06 (2008) 与官方出版记录**不符**，文档号已删。中心性肥胖阈值 女 ≥0.85、男 ≥0.90 出自该报告 Annex A1（转引 WHO 1999 代谢综合征定义）⇒ 数值本身仍是【二手·本机无原文】（报告 PDF 不在本机），对外不许写成"WHO 规定"。
 *    本节用"低于该阈值 = 腰线与臀部分得开"这一档，属**健康口径**，不是"好看"口径。
 *  - 美学侧 Singh 1993(JPSP 65:293)提出女 0.70 上下评分最高，但后续研究指出效应大部分被 BMI 混淆，
 *    因此这里**不**拿 0.70 当男性档位边界（男性正常区间多在 0.85~0.95，若共用 0.70 则男性永远拿不到"明显"）。
 * good/normal 两值即该性别的"明显上界 / 中等上界"，超出即 warning(模糊)。
 * @type {{女:{good:number,normal:number},男:{good:number,normal:number}}} */
const WHR_BANDS = {
  女: { good: 0.8, normal: 0.85 },
  男: { good: 0.9, normal: 0.95 },
}

/** 性别归一：规则与档案用中文，门店/外部数据可能给英文 */
function _normGender(gender) {
  const g = String(gender || '').trim().toLowerCase()
  if (['男', 'male', 'm', '1'].includes(g)) return '男'
  if (['女', 'female', 'f', '2', '0'].includes(g)) return '女'
  return null
}

/**
 * @param {number} waist
 * @param {number} hip
 * @param {string} [gender] 缺性别时**只出比值不出档位**（不猜，交给 UI 显示数字）
 * @returns {{wh_ratio: number, wh_status?: string}}
 */
function computeWhRatio(waist, hip, gender) {
  const w = _safeFloat(waist)
  const h = _safeFloat(hip)
  if (w <= 0 || h <= 0) return {} // 没量就不算，也不给兜底假数
  const ratio = Math.round((w / h) * 100) / 100
  const bands = WHR_BANDS[_normGender(gender)]
  if (!bands) return { wh_ratio: ratio }
  if (ratio < bands.good) return { wh_ratio: ratio, wh_status: 'good' }
  if (ratio < bands.normal) return { wh_ratio: ratio, wh_status: 'normal' }
  return { wh_ratio: ratio, wh_status: 'warning' }
}

// ============================================================
// 4. 腿身比 & 肩宽比
// ============================================================

/**
 * 腿身比分档。
 *
 * 口径:表单要求"腿长量髋骨到脚跟"（见 PersonalProfileForm 三围与腿长说明），
 * 对应人体测量学的髂嵴点高/髂前上棘点高÷身高,不是"会阴高÷身高"那一档。
 *
 * 依据档位（B-，见 services/evidenceLevels.js）：
 *  - GB/T 10000-**1988**《中国成年人人体尺寸》转录值（二手，正式引用需购 PDF 复核）：🔴 10-10 第二十/二十一轮现量——**现行 GB/T 10000-2023 表 1／表 6 里没有「髂前上棘点高」这一项**（腿长相关只有 会阴高／胫骨点高／大腿长／小腿长），而 1988 版官方不提供文本阅读、本机无原文 ⇒ 下面那对 54.0%/53.4% **永远停在【二手·1988 口径】**，不许挂"现行国标"（`docs/依据/10` §2j④）。
 *    髂前上棘点高÷身高 男 ≈54.0%、女 ≈53.4%，即本比例的**中枢约 0.54**；
 *    会阴高÷身高 男 46.0~48.2%、女 45.4~47.7%（若换成"会阴到脚跟"口径须用 0.46/0.48 切点）。🔴 同轮订正：现行 2023 版**会阴高 P50** 是 男 729/1 687＝**43.2%**、女 699/1 572＝**44.5%**，与本行那对 1988 转录值不同档 ⇒ 真要一条人群腿身参照，只用 2023 那对（`10` §2j④），本函数 0.52/0.56 仍是**产品参考线**、不是国标判据。
 *  - 国标只给尺寸分布，**不规定**腿长多少"好看"；上下限是产品假设，
 *    取 ±0.02 约对应分布的两端，不属于 A 档结论。
 *  - 传统的"3 腿长/2 上身"等说法（马氏躯干腿长指数派生）无同行评议支持。
 *
 * @param {number} legLength
 * @param {number} height
 * @returns {{leg_ratio?: number, leg_status?: string}} 缺身高或腿长时返回 {}，不编造
 */
function computeLegRatio(legLength, height) {
  const l = _safeFloat(legLength)
  const h = _safeFloat(height)
  if (l <= 0 || h <= 0) return {} // 没量就不算，也不给兜底假数
  const ratio = Math.round((l / h) * 100) / 100
  if (ratio < LEG_BANDS.short) {
    return { leg_ratio: ratio, leg_status: 'short' }
  }
  if (ratio > LEG_BANDS.long) {
    return { leg_ratio: ratio, leg_status: 'long' }
  }
  return { leg_ratio: ratio, leg_status: 'normal' }
}

/** 腿身比切点（髋骨到脚跟口径，中枢≈0.54） */
const LEG_BANDS = { short: 0.52, long: 0.56 }

/**
 * @param {number} shoulder
 * @param {number} height
 * @returns {{shoulder_ratio?: number, shoulder_status?: string}} 缺任一项返回 {}
 */
function computeShoulderRatio(shoulder, height) {
  const s = _safeFloat(shoulder)
  const h = _safeFloat(height)
  // 缺测不出分：原来这里用 38/162 两个假人量算出 23.5，再让"肩宽标准"这条结论凭空出现。
  // 现在没量肩宽或没量身高就整段不返回，前端与规则引擎都拿不到 shoulder_ratio / shoulder_status。
  if (s <= 0 || h <= 0) return {}
  const ratio = (s / h) * 100
  if (ratio > 24) {
    return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'wide' }
  }
  if (ratio < 21) {
    return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'narrow' }
  }
  return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'normal' }
}

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
  const guide = SKIN_TONE_COLOR_MAP[skinTone] || SKIN_TONE_COLOR_MAP['自然白']
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
  const words = [skinTone, skinToneDetail].filter((w) => typeof w === 'string' && w)
  const depthWord = words.find((w) => DEPTH_LEVEL[w])
  const depth = depthWord ? DEPTH_LEVEL[depthWord] : null
  const undertone =
    words.find((w) => COLOR_SEASON_TABLE[w]) || (depthWord ? UNDERTONE_FROM_DEPTH[depthWord] : null)
  if (!undertone || !depth) return {}
  const season = COLOR_SEASON_TABLE[undertone][depth]
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
  const row = COLOR_SEASON_12_TABLE[colorSeason]
  const chroma = CHROMA_LEVEL[colorChroma]
  if (!row || !chroma) return {}
  return { color_season_12: row[chroma] }
}

// ============================================================
// 5.56 风格型（量感与线条，Kibbe 方向的五型简化）
// ============================================================

/** 骨架量感:表单值 → 轴位 */
const FRAME_LEVEL = { 小巧: '小', 适中: '中', 大气: '大' }

/** 身体线条倾向:表单值 → 轴位 */
const LINE_LEVEL = { 偏直线: '直', 均衡: '衡', 偏曲线: '曲' }

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
  const frame = FRAME_LEVEL[frameSize]
  const line = LINE_LEVEL[lineQuality]
  if (!frame || !line) return {}
  return { kibbe_type: KIBBE_TABLE[frame][line] }
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
  const out = {}
  if (leg_status && PROPORTION_LEVEL_LABELS.leg_status[leg_status]) {
    out.leg_proportion = PROPORTION_LEVEL_LABELS.leg_status[leg_status]
  }
  if (shoulder_status && PROPORTION_LEVEL_LABELS.shoulder_status[shoulder_status]) {
    out.shoulder_frame = PROPORTION_LEVEL_LABELS.shoulder_status[shoulder_status]
  } else if (shoulder_type && SHOULDER_TYPE_LABELS[shoulder_type]) {
    out.shoulder_frame = SHOULDER_TYPE_LABELS[shoulder_type]
  }
  if (wh_status && PROPORTION_LEVEL_LABELS.wh_status[wh_status]) {
    out.waist_definition = PROPORTION_LEVEL_LABELS.wh_status[wh_status]
  }
  return out
}

// ============================================================
// 6. 体型-穿搭映射（文本建议）
// ============================================================

const BODY_SHAPE_OUTFIT = {
  hourglass: '收腰连衣裙、高腰阔腿裤+紧身针织衫，展现曲线美。',
  pear: '上身浅色亮色吸引视线上移，下身深色直筒/A字裙平衡比例。',
  apple: 'V领宽松上衣+直筒裤/裙，长度盖过臀部，避免收腰款。',
  rectangle: '荷叶边上衣、层叠穿搭、宽腰带营造腰线，直筒裙+短上衣。',
  inverted_triangle: '下身A字裙/阔腿裤增加量感，上身V领/方领收窄肩线。',
}

/**
 * @param {string} bodyShapeKey
 * @returns {string}
 */
function getBodyShapeOutfitAdvice(bodyShapeKey) {
  return BODY_SHAPE_OUTFIT[bodyShapeKey] || BODY_SHAPE_OUTFIT['hourglass']
}

// ============================================================
// 7. 脸型-发型/妆容/配饰映射
// ============================================================

const FACE_SHAPE_GUIDE = {
  鹅蛋脸: {
    analysis: '最标准脸型，比例协调，几乎适合所有发型和妆容。',
    hair: '中分长发、空气刘海、波浪卷发',
    makeup: '自然妆即可，重点突出五官优势',
    contour: '修容较轻，鼻梁两侧和发际线微扫即可',
    accessory: '几乎所有款式都适合',
  },
  圆脸: {
    analysis: '线条柔和缺乏棱角，需要增加面部立体感。',
    hair: '侧分长发、高马尾拉长脸型，避免齐刘海和短发波波头',
    makeup: '修容重点在两侧脸颊，高光提亮鼻梁和额头',
    contour: '两侧脸颊大面积阴影，太阳穴到下颌线连接扫阴影',
    accessory: '长款流苏耳坠纵向拉长，棱角分明的方形眼镜',
  },
  方脸: {
    analysis: '下颌角明显轮廓硬朗，需要柔化面部线条。',
    hair: '微卷长发、八字刘海修饰下颌，避免齐耳短发和中分',
    makeup: '修容重点在下颌角，腮红打在颧骨偏上位置',
    contour: '下颌角阴影柔化，额头两侧收窄',
    accessory: '圆润珍珠坠子耳环柔化下颌，圆框眼镜',
  },
  瓜子脸: {
    analysis: '上宽下窄下巴尖翘，很好看但额头不宜过亮。',
    hair: '空气刘海、中长发，避免过度贴头皮',
    makeup: '额头不宜过亮，下巴可用阴影稍微收敛',
    contour: '下巴阴影微收，额头高光提亮',
    accessory: '小巧精致耳钉，避免过长耳坠',
  },
  菱形脸: {
    analysis: '颧骨突出，额头和下巴偏窄，需平衡中部宽度。',
    hair: '齐刘海或侧分刘海遮盖额头，搭配蓬松长发平衡颧骨',
    makeup: '颧骨两侧用阴影色收敛，额头和下巴用高光提亮',
    contour: '颧骨两侧阴影收敛，额头和下巴高光',
    accessory: '长侧分刘海造型，上部有装饰的发饰',
  },
  心形脸: {
    analysis: '额头宽下巴尖，上重下轻，需要平衡上下比例。',
    hair: '侧分中长发，下摆微卷增加下半脸量感',
    makeup: '额头两侧阴影收敛，下巴高光提亮增加量感',
    contour: '额头两侧阴影，下巴高光提亮',
    accessory: '一字领横向拉宽额头，圆润耳环平衡下巴',
  },
  国字脸: {
    analysis: '轮廓方正硬朗，需大面积柔化线条。',
    hair: '大波浪卷发、长刘海，避免短发和露额发型',
    makeup: '大面积修容柔化下颌线和颧骨，柔和腮红增加女性化气质',
    contour: '全脸大面积修容柔化轮廓，重点在下颌',
    accessory: '圆润大圈耳环柔化硬朗感，波浪形项链',
  },
  长脸: {
    analysis: '脸型偏长、中庭留白多，核心是缩短脸长并增加两侧宽度。',
    hair: '空气刘海/齐刘海直接缩短上庭，两侧蓬松卷发或波浪增加横向宽度；避免中分贴头皮直发、高颅顶和超长直发',
    makeup: '腮红横向打在苹果肌并向两侧晕染拉宽视觉，眉形宜平直，避免高挑眉和中轴线纵向修容',
    contour: '发际线下缘与下巴下缘扫阴影各缩短一截，额头和下巴中央提亮改为横向晕染',
    accessory: '圆形大耳环、宽檐帽、choker 或短项链增加横向阻断；避免长款流苏耳坠和 V 领继续拉长',
  },
}

/**
 * 脸型同义词:表单/规则词表 与 建议表词表 用词不同
 * 不加这层会静默落到兜底的鹅蛋脸文案,查不到也不报错
 */
const FACE_SHAPE_ALIASES = {
  椭圆脸: '鹅蛋脸',
}

/**
 * 返回脸型对应的发型/妆容/修容/配饰建议
 * @param {string} faceShape
 * @returns {{face_analysis: string, hair_advice: string, makeup_advice: string, contour_advice: string, accessory_advice: string}}
 */
function getFaceShapeGuide(faceShape) {
  const key = FACE_SHAPE_ALIASES[faceShape] || faceShape
  const guide = FACE_SHAPE_GUIDE[key] || FACE_SHAPE_GUIDE['鹅蛋脸']
  return {
    face_analysis: guide.analysis,
    hair_advice: guide.hair,
    makeup_advice: guide.makeup,
    contour_advice: guide.contour,
    accessory_advice: guide.accessory,
  }
}

// ============================================================
// 7.5 三庭五眼比例（face_ratio + eye_spacing → 比例修正方案）
// ============================================================

/**
 * 比例原理：哪一庭留白多，就把视觉重心从那一段移开，并用阴影截断、用横向元素补宽。
 * 眼距走的是"五眼"：眉距与眼线起止点是唯一能改变眼距视觉的两个杠杆。
 */
const FACE_PROPORTION_GUIDE = {
  比例均衡: {
    analysis: '三庭接近 1:1:1、眼距约等于一眼宽，五官分布标准，造型原则是不破坏既有比例。',
    hair: '中分或斜分都可，刘海可随意；避免为修饰而过度遮额、过度垫颅顶',
    makeup: '修容只做轻微立体，重点在提亮而不是截断；腮红落在苹果肌原位',
    contour: '鼻梁与颧骨轻扫即可，不在发际线或下巴做截断',
    accessory: '耳饰项链按脸型与配色选，任何款式都不会先输在比例上',
  },
  上庭偏长: {
    analysis: '额头段留白多，视觉重心被顶高，核心是压低额头、把重心拉回眉眼。',
    hair: '刘海直接缩短上庭（空气刘海/法式刘海/眉上短刘海按风格选）；避免大光明、高颅顶与头顶过度蓬松',
    makeup: '眉位略上移并画平直眉，额头下缘扫阴影；眼妆强调在中位，把视线从额头接过来',
    contour: '发际线下缘与额头上下缘各扫一段阴影截短上庭，下巴只做轻提亮不再拉长',
    accessory: '帽檐、宽边帽、眉框镜架与横向耳饰都能填上庭留白；避免高髻和纵向长流苏',
  },
  中庭偏长: {
    analysis: '面中与鼻梁段偏长，成熟清瘦感强，核心是截断面中并把视觉拉向两侧。',
    hair: '鬓角与两侧做蓬松卷度，卷的位置落在面中高度；避免贴头皮直发继续拉长',
    makeup: '腮红横向打在苹果肌并向两侧晕染；眼线横向延长或略下垂；避免鼻梁中轴线的纵向高光带',
    contour: '鼻梁中段与鼻尖下缘扫阴影截短鼻长，额头与下巴提亮，不做中轴纵向修容',
    accessory: '圆润或横向耳饰、眉框眼镜、choker 都能在面中形成横向阻断；避免细长剑坠与深 V 领',
  },
  下庭偏长: {
    analysis: '下巴与下颌段留白多，显成熟显清瘦，核心是缩短下巴并补下庭横向量感。',
    hair: '发尾在下巴高度内扣或做波浪填留白；避免超长直顺发把视觉继续往下带',
    makeup: '唇形画满并外扩约 1mm、提亮唇峰以缩短下巴留白；腮红位置略低但保持横向',
    contour: '下巴下缘扫阴影截短，唇下与下巴中央的提亮改成横向晕染而非纵向一点',
    accessory: '短项链、choker、圆形耳饰增加下半横向量感；避免长坠和尖长耳线',
  },
}

const EYE_SPACING_GUIDE = {
  眼距偏宽: {
    analysis: '两眼间距大于一眼宽，稚气与疏朗感强，核心是把视觉重心往中间收。',
    hair: '中分或贴面侧分能压住两侧留白；避免过度蓬松外扩的发型',
    makeup: '眉头略向中间起笔、眼线内眼角前延一点点，鼻侧影顺带收窄山根；眼尾不必再横向拉长',
    contour: '山根两侧扫阴影收窄眼距，眼窝内侧加深外侧留亮',
    accessory: '鼻托明显或中梁较窄的镜框、贴鼻侧的细项链都有收拢效果',
  },
  眼距适中: {
    analysis: '眼距接近一眼宽，眉距与眼位无需校正。',
    hair: '无特别限制，按脸型选',
    makeup: '眉峰按标准位（鼻翼—瞳孔外缘延长线）画即可',
    contour: '山根不做收窄也不做加宽',
    accessory: '镜框中梁对齐眉眼宽度即可',
  },
  眼距偏窄: {
    analysis: '两眼间距小于一眼宽，紧凑成熟感强，核心是把视觉往两侧拉开。',
    hair: '侧分与太阳穴处的蓬松能撑开两侧；避免厚重齐刘海把五官压得更紧',
    makeup: '眉头略向外移、眼尾横向延长，内眼角少加深；提亮内眼角与眉间距',
    contour: '山根与内眼角不做收窄修容，眉间三角区提亮',
    accessory: '宽中梁或太阳穴处有装饰的镜框、横向耳饰都能拉开两侧',
  },
}

/**
 * 三庭 + 五眼合并成一份比例建议
 * @param {string|null} faceRatio 三庭比例（FACE_PROPORTION_GUIDE 的键）
 * @param {string|null} eyeSpacing 眼距（EYE_SPACING_GUIDE 的键）
 * @returns {{analysis: string, hair: string, makeup: string, contour: string, accessory: string}|null}
 */
function getFaceProportionGuide(faceRatio, eyeSpacing) {
  const upper = FACE_PROPORTION_GUIDE[faceRatio]
  const spacing = EYE_SPACING_GUIDE[eyeSpacing]
  if (!upper && !spacing) return null

  const join = (key) => [upper && upper[key], spacing && spacing[key]].filter(Boolean).join('；')
  return {
    analysis: join('analysis'),
    hair: join('hair'),
    makeup: join('makeup'),
    contour: join('contour'),
    accessory: join('accessory'),
  }
}

// ============================================================
// 8. 体态问题-穿搭映射
// ============================================================

const POSTURE_ADVICE = {
  圆肩: '多做扩胸运动，穿搭选择背部有支撑的上衣，避免圆领紧身款。',
  驼背: '靠墙站立练习，选择有领设计的上衣引导视线上移。',
  骨盆前倾: '加强核心训练，避免长期穿高跟鞋，选择平底鞋为主。',
  高低肩: '检查背包习惯，穿搭选择对称领口，避免单肩设计。',
}

/**
 * @param {string|null} posture
 * @returns {string|null}
 */
function getPostureAdvice(posture) {
  if (!posture || posture === '无') return null
  return POSTURE_ADVICE[posture] || null
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
// 8.6. 八字五行（第二条判定依据：风水八字 + 日期）
// ============================================================

/** 年龄段档位，和规则里 age_range 条件用的是同一套值 */
const AGE_BANDS = [
  [18, 25, '18-25'],
  [26, 35, '26-35'],
  [36, 45, '36-45'],
  [46, 120, '46+'],
]

/**
 * 由出生日期算周岁与年龄段
 * 拿 age_range 当条件的规则有 12 条，生日一填就不必再让人点一遍年龄段；
 * 生日没填时返回空对象，表单上那份手选的 age_range 照常生效。
 * @param {string} birthDate 'YYYY-MM-DD'
 * @returns {object} { age, age_range? }
 */
function deriveAgeFields(birthDate) {
  const b = parseBirthDate(birthDate)
  if (!b) return {}
  const now = new Date()
  let age = now.getFullYear() - b.y
  const reached = now.getMonth() + 1 > b.m || (now.getMonth() + 1 === b.m && now.getDate() >= b.d)
  if (!reached) age -= 1
  const out = { age }
  const band = AGE_BANDS.find(([lo, hi]) => age >= lo && age <= hi)
  if (band) out.age_range = band[2]
  return out
}

/**
 * 由出生日期与时辰档派生五行字段
 * 没填或填错返回空对象——宁可不给这条依据，也不能往 profile 里塞 undefined，
 * 引擎是严格 AND，多一个空字段就多一批永远命中不了的规则。
 * @param {string} birthDate 'YYYY-MM-DD'
 * @param {string} birthHour '子时'…'亥时' | '不清楚'
 * @returns {object} 可 Object.assign 进 profile 的字段包
 */
function computeBaziFields(birthDate, birthHour) {
  if (!birthDate) return {}
  const a = analyzeBazi(birthDate, birthHour || '不清楚')
  if (!a) return {}
  return {
    // 规则条件用的三个标量（in/eq 只能比单值，所以喜用只取主气那一行）
    day_master_element: a.day_master_element,
    favorable_element: a.favorable_element,
    unfavorable_element: a.unfavorable_element,
    // 报告页展示用
    bazi: a,
    bazi_today: analyzeDay(a),
  }
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
  if (!p.skin_tone && p.skin_tone_detail) {
    p.skin_tone = p.skin_tone_detail
  }
  if (!p.scenario && p.occasion) {
    p.scenario = OCCASION_TO_SCENARIO[p.occasion] || p.occasion
  }
  if (!p.nose_bridge && p.nose_height) {
    p.nose_bridge = p.nose_height
  }
  // 只填了具体身高没选区间时换算一次,否则按区间分档的规则(3 组)对这类人永远轮不到
  if (!p.height_range && p.height) {
    const h = _safeFloat(p.height)
    if (h > 0) {
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
  Object.assign(p, computeKibbeType(p.frame_size, p.line_quality))
  // 6.75 周岁与年龄段(生日填了就以生日算,盖掉表单上手选的档位)
  Object.assign(p, deriveAgeFields(p.birth_date))
  // 6.8 八字五行(第二条判定依据;没填出生日期就整块缺席,不影响第一批那 20 条四季型规则)
  Object.assign(p, computeBaziFields(p.birth_date, p.birth_hour))

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

module.exports = {
  enrichProfile,
  computeBmi,
  computeBodyShape,
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
