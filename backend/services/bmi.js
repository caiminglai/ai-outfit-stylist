/**
 * BMI 单一口径
 * ============================================================
 * 公式 BMI = 体重(kg) ÷ 身高(m)²（GB/T 31901-2024 附录 A 表 A.2 脚注同式）。
 *
 * 为什么单独一个文件：这条算式原先在三个地方各写一遍
 * （profileEnricher.computeBmi / topFitBody / fitSize），三处对"量不到"和
 * 取整时点的处理慢慢就漂了。算法只留一份，档位词表也留在这里，两处口径互相看得见。
 *
 * 两套档位并存是刻意的，不是没对齐：
 *  - HEALTH_BANDS 四档（偏瘦/正常/偏胖/肥胖）是**站内规则词表**，
 *    `rule_conditions` 里 `bmi_level` 只认这四个值（见 db/add-rules.js 与线上库），
 *    动它等于改规则匹配面 ⇒ 不许与另一套合并。
 *  - GB_BANDS 三档（偏瘦/正常/偏胖）是**国标用词**，出处 GB/T 31901-2024 附录 A 表 A.2，
 *    逐字「偏瘦 BMI＜18.5」「正常 18.5≤BMI<24」「偏胖 BMI≥24」。
 *    ⚠️ 该版 2026-12-01 才实施 ⇒ 现在只当内部口径，对外要带日期限定（`docs/依据/10` §2f）。
 */

// 切点两套共用同一对数：18.5 与 24；第四档 28 是站内自己按 WS/T 428 那一类健康口径加的分界
const HEALTH_BANDS = [
  { level: '偏瘦', status: 'warning', lo: 0, hi: 18.5 },
  { level: '正常', status: 'good', lo: 18.5, hi: 24 },
  { level: '偏胖', status: 'warning', lo: 24, hi: 28 },
  { level: '肥胖', status: 'danger', lo: 28, hi: Infinity },
]

const GB_BANDS = [
  { cn: '偏瘦', lo: 0, hi: 18.5 },
  { cn: '正常', lo: 18.5, hi: 24 },
  { cn: '偏胖', lo: 24, hi: Infinity },
]

/**
 * 由身高体重算 BMI
 * @param {number|string} heightCm
 * @param {number|string} weightKg
 * @returns {number|null} 身高或体重缺测/非法 ⇒ null（**不返回任何假想值**）
 */
function bmiValue(heightCm, weightKg) {
  const h = Number(heightCm) / 100
  const w = Number(weightKg)
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return null
  return w / (h * h)
}

/**
 * 站内四档（写进规则匹配面的那一套）
 * @param {number|null} bmi
 * @returns {{bmi: number, bmi_level: string, bmi_status: string} | null}
 */
function healthBand(bmi) {
  const b = Number(bmi)
  if (!Number.isFinite(b) || b <= 0) return null
  // 先取整再切档：原来档位取原始值、显示取一位小数，两者会在切点 0.05 以内打架
  // （18.45～18.49 的人报告上印的是「BMI 18.5 · 偏瘦」，而 18.5 正是「正常」的入口，
  // 顾客照着印出来的数自己一查就是另一档）。规则匹配面 bmi_level 的取值集合不变，
  // 只有这 0.05 宽的边缘会从下一档挪到与显示值一致的那一档。
  const rounded = Math.round(b * 10) / 10
  const band =
    HEALTH_BANDS.find((x) => rounded >= x.lo && rounded < x.hi) ||
    HEALTH_BANDS[HEALTH_BANDS.length - 1]
  return { bmi: rounded, bmi_level: band.level, bmi_status: band.status }
}

/**
 * 国标三档（对外文案与报告用的那一套）
 * @param {number|null} bmi
 * @returns {{cn: string, band: [number, number|null]} | null}
 */
function gbBand(bmi) {
  const b = Number(bmi)
  if (!Number.isFinite(b) || b <= 0) return null
  // 与 healthBand 同一把尺：先四舍五入到一位小数再切档，否则「国标：偏瘦」会印在
  // 一个显示成 18.5 的数字旁边，两套档位对同一个人都能给出不止一种说法。
  const rounded = Math.round(b * 10) / 10
  const band =
    GB_BANDS.find((x) => rounded >= x.lo && rounded < x.hi) || GB_BANDS[GB_BANDS.length - 1]
  return { cn: band.cn, band: [band.lo, band.hi === Infinity ? null : band.hi] }
}

module.exports = { bmiValue, healthBand, gbBand, HEALTH_BANDS, GB_BANDS }
