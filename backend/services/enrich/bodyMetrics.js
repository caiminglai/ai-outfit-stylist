/**
 * 体型与比例计算层（11-03 从 profileEnricher.js 拆出，行为不变；原文 :37-310）。
 *
 * 职责：BMI 接口、体型五分类＋连续差值、部位级标签（椰子胸那一套）、腰臀比、腿身比、肩宽比。
 *
 * 两个小工具 `_safeFloat`／`_normGender` 也住本模块，并随本模块导出给主入口用——
 * 它们是"没量到就返回默认值／不猜"这条口径的执行处，⛔ 别处不许再抄第二份。
 *
 * 全站共同的一条口径：**缺测不出分**。这几段原来都拿假人常量兜底
 * （22.0 的 BMI、84/66/90 的三围、38/162 的肩高手高、"没选性别也当女的"），
 * 改后一律返回空对象或只出比值不出档位，理由逐条写在各段注释里，别改回去。
 */
const { bmiValue, healthBand } = require('../bmi')
const { BODY_TYPE_BY_KEY } = require('../bodyTypes')

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
 * 计算 BMI 及等级（算式与档位表都在 services/bmi.js，这里只做接口）
 * @param {number} heightCm
 * @param {number} weightKg
 * @returns {{bmi?: number, bmi_level?: string, bmi_status?: string}}
 *   身高或体重缺测 → {}（不给档位，下游按"没算出"处理）
 */
function computeBmi(heightCm, weightKg) {
  // 缺测不出分:原来这里量不到就返回一个 22.0/'正常'，
  // 等于给每个没填身高体重的人贴了一个"身材正常"的标签，
  // 而 22.0 是 18.5~24 这一档的中位假想值，不是任何人的实测值。
  const band = healthBand(bmiValue(heightCm, weightKg))
  return band || {}
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

  // 连续比值输出（供区间算子匹配，替代离散 5 分类）
  const continuous = {
    bust_waist_diff: bwDiff,
    waist_hip_diff: whDiff,
    shoulder_hip_ratio: shoulder && h > 0 ? shoulder / h : null,
  }

  if (Math.abs(bwDiff - whDiff) < 5 && bwDiff > 10) {
    return {
      body_shape: BODY_TYPE_BY_KEY.hourglass,
      body_shape_key: 'hourglass',
      body_shape_status: 'good',
      ...continuous,
    }
  }
  if (whDiff > bwDiff + 5) {
    return {
      body_shape: BODY_TYPE_BY_KEY.pear,
      body_shape_key: 'pear',
      body_shape_status: 'normal',
      ...continuous,
    }
  }
  if (bwDiff > whDiff + 5) {
    const s = _safeFloat(shoulder)
    // "上身占优"有两种成因：肩真的宽（倒三角）还是腰腹粗（苹果）。这根轴只有量了肩宽才分得开。
    // 原来这里靠 shoulder||38 编一个 38 出来判成苹果型，给客户贴一个没测过的体型标签。
    if (s <= 0) return { body_shape_status: 'unmeasured', ...continuous }
    if (s > h * 0.45) {
      return {
        body_shape: BODY_TYPE_BY_KEY.inverted_triangle,
        body_shape_key: 'inverted_triangle',
        body_shape_status: 'normal',
        ...continuous,
      }
    }
    return {
      body_shape: BODY_TYPE_BY_KEY.apple,
      body_shape_key: 'apple',
      body_shape_status: 'warning',
      ...continuous,
    }
  }
  return {
    body_shape: BODY_TYPE_BY_KEY.rectangle,
    body_shape_key: 'rectangle',
    body_shape_status: 'normal',
    ...continuous,
  }
}

/**
 * 四大身材标准·部位级标签（借鉴美沁雅「椰子胸/沙漏腰/母贝臀/酒杯腿」命名体系）
 * ============================================================
 * 与整体体型（沙漏/梨/苹果...）互补——整体标签说"你是什么形"，部位标签说"你哪个部位
 * 有优势"。阈值基于苏南青年女性样本均值（胸腰差 17.86、腰臀差 23.97）与常见审美线。
 *
 * ⚠️ 档位诚实：
 *  - 这是**审美标签**不是健康指标，阈值是产品参考线（C 档），不是医学结论。
 *  - 没量到对应围度/腿长 ⇒ 该部位不出标签，⛔ 不编。
 *
 * @param {{bust_waist_diff?:number, waist_hip_diff?:number, leg_ratio?:number}} dims
 * @returns {{highlights:string[], details:Object<string,{value:number, label:string}>}}
 */
function computeBodyHighlights(dims) {
  const d = dims || {}
  const highlights = []
  const details = {}

  // 椰子胸：胸腰差 ≥ 18（苏南样本均值 17.86，达到或超过算"胸线优势"）
  if (typeof d.bust_waist_diff === 'number' && d.bust_waist_diff >= 18) {
    highlights.push('椰子胸')
    details['椰子胸'] = {
      value: d.bust_waist_diff,
      label: `胸腰差 ${d.bust_waist_diff}cm，胸线优势`,
    }
  }

  // 沙漏腰：胸腰差 ≥ 15 且腰臀差 ≥ 18（上下都分得开，腰细）
  if (
    typeof d.bust_waist_diff === 'number' &&
    typeof d.waist_hip_diff === 'number' &&
    d.bust_waist_diff >= 15 &&
    d.waist_hip_diff >= 18
  ) {
    highlights.push('沙漏腰')
    details['沙漏腰'] = {
      value: d.bust_waist_diff + d.waist_hip_diff,
      label: `胸腰差 ${d.bust_waist_diff}cm、腰臀差 ${d.waist_hip_diff}cm，腰线分明`,
    }
  }

  // 母贝臀：腰臀差 ≥ 20（苏南样本均值 23.97，达到或超过算"臀线优势"）
  if (typeof d.waist_hip_diff === 'number' && d.waist_hip_diff >= 20) {
    highlights.push('母贝臀')
    details['母贝臀'] = { value: d.waist_hip_diff, label: `腰臀差 ${d.waist_hip_diff}cm，臀线优势` }
  }

  // 酒杯腿：腿身比 ≥ 0.56（腿长）
  if (typeof d.leg_ratio === 'number' && d.leg_ratio >= 0.56) {
    highlights.push('酒杯腿')
    details['酒杯腿'] = {
      value: d.leg_ratio,
      label: `腿身比 ${(d.leg_ratio * 100).toFixed(1)}%，腿部优势`,
    }
  }

  return { highlights, details }
}

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
  const g = String(gender || '')
    .trim()
    .toLowerCase()
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
  // 先按对外的精度取整，再比切点：原来用原始值比 21/24、只在输出时取整，
  // 于是肩宽比 24.03 这条会同时给出两个说法——这里报"偏宽"（shoulder_status:'wide'）、
  // 而 topFitBody 的参考带 [21,24] 拿到的是取整后的 24.0，判"带内不推拉"。
  // 全站这条口径已由 services/bmi.js（先取整再分档）与条纹闸门（读 measure.bmi）立过。
  const ratio = Math.round((s / h) * 1000) / 10
  if (ratio > 24) {
    return { shoulder_ratio: ratio, shoulder_status: 'wide' }
  }
  if (ratio < 21) {
    return { shoulder_ratio: ratio, shoulder_status: 'narrow' }
  }
  return { shoulder_ratio: ratio, shoulder_status: 'normal' }
}

module.exports = {
  _safeFloat,
  _normGender,
  computeBmi,
  computeBodyShape,
  computeBodyHighlights,
  computeWhRatio,
  computeLegRatio,
  computeShoulderRatio,
}
