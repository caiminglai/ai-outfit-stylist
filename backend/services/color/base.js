/**
 * 色度学换算底座：sRGB hex → CIELAB(D65)、CIEDE2000、色相角差、ITA° 分档，加上无彩色判定线 ACHROMATIC_C。
 * 11-03 大文件拆分轮从 services/colorMetrics.js（1563 行）切出，代码与注释逐字搬动，行为零变化。
 * ACHROMATIC_C 原来坐在 §4 里，但它那条注释解释的是本模块的 _hueAngle（atan2(0,0)＝正红那条假轴）⇒ 随常量一起搬到这里。
 * 依据档位与逐条出处仍写在对外入口 services/colorMetrics.js 的头部注释里（本目录不是入口，别处只 require 那一个文件）。
 */

// ------------------------------------------------------------
// 1. 换算：sRGB hex → CIELAB(D65)
// ------------------------------------------------------------

const _srgbToLin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** '#RRGGBB' / 'RRGGBB' → {L,a,b,C,h}；解析失败返回 null */
function hexToLab(hex) {
  const m = String(hex || '')
    .trim()
    .replace(/^#/, '')
    .match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
  if (!m) return null
  const [R, G, B] = [m[1], m[2], m[3]].map((h) => _srgbToLin(parseInt(h, 16)))
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X / 0.95047)
  const fy = f(Y / 1.0)
  const fz = f(Z / 1.08883)
  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const b = 200 * (fy - fz)
  return { L, a, b, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI }
}

/** 色相对比角 Δh（0~180，越小越"同族"）；只给 {L,a,b} 没有 h 也能算 */
const _hueAngle = (lab) => (Math.atan2(lab.b, lab.a) * 180) / Math.PI
function hueGap(lab1, lab2) {
  const d = Math.abs(_hueAngle(lab1) - _hueAngle(lab2)) % 360
  return d > 180 ? 360 - d : d
}

/** CIEDE2000 色差（Sharma 2004 的标准系数，kL=kC=kH=1）
 *  注意：CIE 色相角约定为 [0,360)，atan2 直接回负值会把 H̄'、T、RT 全带歪，
 *  必须 _hue360 归一后再进平均色相分支。 */
const _hue360 = (deg) => {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

function deltaE00(l1, l2) {
  const { L: L1, a: a1, b: b1 } = l1
  const { L: L2, a: a2, b: b2 } = l2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))))
  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = _hue360((Math.atan2(b1, a1p) * 180) / Math.PI)
  const h2p = _hue360((Math.atan2(b2, a2p) * 180) / Math.PI)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= 180) dhp = diff
    else if (diff > 180) dhp = diff - 360
    else dhp = diff + 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp
  if (C1p * C2p === 0) hbp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180)
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const RT = -RC * Math.sin((2 * dTh * Math.PI) / 180)
  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  )
}

/** ITA°（肤色专用；灰色/无彩色上无意义）。⛔ 只能吃色卡比对值或测色仪读数：非受控照片推肤色不可靠，见 Alipour, Burke & Courtney 2026, Skin Res Technol 32(8), DOI 10.1111/srt.70374【二手·官方 XML 原件 10-10 已删，本机仅存本站转出全文】⇒ 这条限制不许因为切点升档而松动，也不许拿它做对外话术。切点出处见本文件头（上四档＝Saint-Léger 2015 p2【官方原文·本机】；brown/dark【未核实】）。*/
function individualTypologyAngle(lab) {
  if (!lab || lab.b === 0) return null
  // atan 返回弧度，ITA° 定义是角度制 ⇒ 换算系数是 180/π
  return (Math.atan((lab.L - 50) / lab.b) * 180) / Math.PI
}
const itaClass = (v) =>
  v === null
    ? null
    : v > 55
      ? 'very light'
      : v > 41
        ? 'light'
        : v > 28
          ? 'intermediate'
          : v > 10
            ? 'tan'
            : v >= -30
              ? 'brown'
              : 'dark'

/**
 * 无彩色判定线（10-19 现量，判据见下）。
 * COLOR_NAME_HEX 58 个色名里 C<5 的正好 9 个：白、黑、墨黑、浅灰、中灰、冷灰、枪灰、银灰、银色
 * ——全是本来就没有色相的那一批；往上第一个是 米白 C5.4（带暖调的白，该留在有色相侧）。
 * 肤色侧 8 档锚点最低的是 白皙 C16.1，全部远在条线之上 ⇒ 这条线只裁得到衣服侧。
 *
 * **10-20 第六阶段·第一步复量（词表 58⇒232 键之后，同一把尺子）：**
 * C<5 的键从 9 个涨到 **36 个**，全是本来就没有色相的那一批：
 * 白色/黑色/墨黑/浅灰/中灰/冷灰/枪灰/银灰/银色/纯白/本白/珍珠白/云白/骨白/暖白/冷白/粉白/银白/
 * 炭灰/烟灰/石灰/水泥灰/雾灰/雾霾灰/中性灰/深灰/铁灰/石墨色/炭黑/哑光黑/乌黑/莫兰迪/银/灰/白/黑。
 * 条线上方最近的两名换人了：**象牙白 C5.2、蛋壳色 C5.2**（原读数"第一个是米白 C5.4"作废——
 * 米白 C5.4 还在，只是排到第三，同档还有 陨石灰 5.4、大象灰 5.4）。
 * 肤色侧一个键没动，最低仍 白皙 C16.1 ⇒ "这条线只裁得到衣服侧"仍然成立。
 * ⇒ 条线本身**没挪**（仍 5），挪的是名单长度；`test/colorMetrics.test.js` 里那处写死的 9×8=72
 *   已改成"按 C<ACHROMATIC_C 现算 × 肤色档数"，以后再扩表不咬测试。
 *
 * 为什么要裁：`_hueAngle` 是 atan2(b,a)，无彩色 a=b=0 ⇒ atan2(0,0)=0 度＝正红。
 * 于是"黑上衣"对谁都被算成色相角 0°，hueContrast 这一轴拿到的是一个**假数**，
 * 而它占总分 45%。10-19 接入 ΔE00 时发现这条假轴一直在给无彩色上衣发色相分。
 */
const ACHROMATIC_C = 5

module.exports = {
  hexToLab,
  hueGap,
  deltaE00,
  individualTypologyAngle,
  itaClass,
  ACHROMATIC_C,
}
