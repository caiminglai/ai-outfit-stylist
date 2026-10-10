/**
 * 规则依据分档（evidence_level）的唯一实现处。
 * 为什么要这个：站3 的 8 套体系硬度不一样，顾客端不能一律说"科学"。
 * 分档判据来自 2026-10-06 的四路核实（国标/ISO、实证论文、行业体系、AI 论文），
 * 逐条出处见 `docs/上衣量化依据与公式清单.md`。
 */

/** 档位定义：只有 A/B 两档允许出现"科学/量化/依据"类表述 */
const EVIDENCE_LEVELS = [
  {
    value: 'A',
    label: 'A 国标/国际标准',
    note: '现行国家或国际标准里能对上的量化口径：色差公式 GB/T 7921-2008、人体测量方法 GB/T 16160-2017。这些标准只给尺寸与测量口径，都不含"好不好看"的判据',
  },
  {
    value: 'B',
    label: 'B 学术实证',
    note: '有同行评议论文与可复算公式（如 Schloss & Palmer 色相相似-和谐回归、WHO 腰臀比阈值、CIEDE2000）',
  },
  {
    value: 'C',
    label: 'C 行业体系/经验',
    note: '商业体系或教材经验规则：四季·十二型色彩、Kibbe 风格型、场合着装、体型五分类。可做风格偏好，不能称客观规律',
  },
  {
    value: 'D',
    label: 'D 命理体系',
    note: '八字五行喜用神推出来的颜色/材质，与 A/B/C 不同源，单独一栏展示',
  },
]

/**
 * source_key / 规则 key → 档位。按前缀判，命中不了返回默认 C（未标注按 C 对待）。
 * 顺序有意义：更具体的前缀放前面。
 */
const KEY_PREFIX_TO_LEVEL = [
  ['wuxing', 'D'],
  ['proportion-shoulder', 'A'], // 肩宽/身高 21~24% 与人体尺寸国标的常见量级一致；两个百分位是转录值、无法证真，且缺测不许兜底编值（见 docs/依据/01、04）
  ['proportion-waist', 'B'], // 腰臀比：WHO 2011 报告阈值(健康口径) + Singh 1993(美学侧有 BMI 混淆争议)
  ['proportion-leg', 'B'], // 腿身比：算的是髋骨到脚跟/身高，不是马氏指数(马氏要坐高)；0.52/0.56 是产品参考线，Kiire 2016 与 Versluys 2018 方向不一致
  ['proportion', 'B'],
  ['color12', 'C'], // 十二季型：2011 韩国 n=200 研究显示各系统判型互不一致
  ['color', 'C'], // 四季色彩：同上
  ['metal', 'C'], // 金属色适配：查不到检验
  ['kibbe', 'C'], // Kibbe：查不到任何有效性/一致性检验
  ['dresscode', 'C'], // 场合着装：无国标，只有行业文本(Emily Post)
]

const DEFAULT_LEVEL = 'C'

/** @param {string|null|undefined} key rule_groups.source_key 或种子 key */
function evidenceOf(key) {
  const s = String(key || '')
  if (!s) return null // 后台手工建的规则：未标注
  for (const [prefix, level] of KEY_PREFIX_TO_LEVEL) {
    if (s.startsWith(prefix)) return level
  }
  return DEFAULT_LEVEL
}

const LABELS = Object.fromEntries(EVIDENCE_LEVELS.map((l) => [l.value, l.label]))
const NOTES = Object.fromEntries(EVIDENCE_LEVELS.map((l) => [l.value, l.note]))
const VALUES = EVIDENCE_LEVELS.map((l) => l.value)

/** 给前端/后台展示用的一行依据说明；未标注按 C 对待 */
function evidenceNote(level) {
  const v = VALUES.includes(level) ? level : DEFAULT_LEVEL
  return NOTES[v]
}

module.exports = { EVIDENCE_LEVELS, evidenceOf, LABELS, NOTES, VALUES, DEFAULT_LEVEL, evidenceNote }
