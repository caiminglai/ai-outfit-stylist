/**
 * 色度学工装：把"这件上衣衬不衬这个人"拆成可复算的物理量。
 * 依据档位（2026-10-06 逐条核实，详见 docs/上衣量化依据与公式清单.md）：
 *   A 档（国标/国际标准）：sRGB→CIELAB(D65) 换算、色差公式 —— GB/T 7921-2008《均匀色空间和色差公式》、ISO/CIE 11664 色度学
 *   B 档（同行评议）：CIEDE2000 实现 Sharma et al. 2004 (DOI 10.1002/col.20070)；
 *                     Schloss & Palmer 2011 (DOI 10.3758/s13414-010-0027-0, PMC3037488) 全文里
 *                       有两句方向相反的结论，必须分清用哪一句：
 *                       ① "pair preference and harmony both increase as hue similarity increases"
 *                          —— 两块色当**一个整体**看时，越像越和谐；
 *                       ② "figural color preference ratings increase as hue contrast with the
 *                          background increases" —— **图形色衬背景色**时，色相差越大越被偏好。
 *                       上衣衬脸属于第②句（衣是图形色、脸是背景）⇒ 本模块按对比打分（10-08 改，
 *                       原来这里第①句的口径把 45% 权重加错了边，见 docs/依据/08 §8.2）。
 *                       第①句"越像越和谐"只适用于两件单品之间，走 outfitHarmony，不进这条分。
 *                     Gong & Lee 2019, Coloration Technology 135(4):292-304
 *                       (DOI 10.1111/cote.12405) 的和谐四规则是下一步要替换本条轴的东西，尚未实现。
 *                     衣装明度↓⇒面部肤色被评为更显白 Zhang et al. 2025, Coloration Technology 142(2):259-271 (DOI 10.1111/cote.12828)；
 *                     ITA° 分档切点 ⇒ 🟢 10-10 第二十一轮改口（旧写法把这四个切点归给 Osto et al. 2022, DOI 10.1111/php.13562 ＝张冠李戴，那篇证的是"ITA 六档与 Fitzpatrick 六型不可互换"，不含任何切点）。上四档逐字出处＝Saint-Léger 2015, Int J Cosmet Sci 37:259-265, DOI 10.1111/ics.12194 第 2 页「10–28°: Tan/Matt; 28–41°: Intermediate; 41–55°: Light; and >55°: Very Light」⇒【官方原文·本机 PDF】（docs/依据/papers/人类皮肤的颜色：富有成效的科学，却用词不合适.pdf，290,862 B／7 页／md5 d084391dc334e82404036678b5e71742，核对记 docs/依据/10 §2i③）。⛔ 三条限定：① brown/dark 两档本机原文里没有（该文只给到上四档；代码用的 −30 下界与通行 −3 不是同一个数，未裁）⇒【未核实】，属本工程自定；② 该文自己把切点指向 US FDA／Cosmetics Europe 指南 ⇒ 那一层仍【二手】；③ 概念起源 Chardon et al. 1991, DOI 10.1111/j.1467-2494.1991.tb00561.x 本机无原文 ⇒【B·DOI 已证·本机无原文】，不许说成"科学分档"。
 *   C 档（本工程自定，不是文献值）：色名→hex 词表、肤色档→Lab 锚点、下面的合成分权重。
 *     换掉 C 档那三样之前，本模块只能算"相对差异"，不能对外宣称"科学测色"。
 */

// ------------------------------------------------------------
// 1. 换算：sRGB hex → CIELAB(D65)
// ------------------------------------------------------------
const { ownValue } = require('../utils/common')

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
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
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

// ------------------------------------------------------------
// 2. C 档：色名 → 代表色值（本工程标定，不是文献值）
//    词表按 db/seed/rules-aesthetic*.json 与 rules.json 里真出现过的色名收口
// ------------------------------------------------------------
const COLOR_NAME_HEX = {
  正红: '#C8102E',
  橘红: '#E4552B',
  砖红: '#A6412C',
  土红: '#9C4A38',
  酒红: '#6E1E2B',
  玫红: '#C73E6B',
  桃红: '#E27A8C',
  珊瑚粉: '#F08A6E',
  蜜桃色: '#F4A98B',
  蜜桃: '#F4A98B',
  雪粉: '#F6D7DA',
  樱花粉: '#F7C6D0',
  灰粉: '#D3AFAE',
  豆沙粉: '#B07C78',
  粉彩: '#F2D8D8',
  鹅黄色: '#F5E1A4',
  鹅黄: '#F5E1A4',
  姜黄色: '#C89A2B',
  姜黄: '#C89A2B',
  土黄: '#B8963F',
  奶橘: '#F6C79A',
  暖橘: '#E2823C',
  橘色: '#E8762C',
  焦糖: '#A9682F',
  驼色: '#B4915F',
  暖驼: '#A97F4F',
  浅驼: '#CBAE85',
  咖啡棕: '#5B3A24',
  棕色: '#7B4F2A',
  大地色: '#9C7A50',
  奶油白: '#F5EFE0',
  米白: '#F2EDE3',
  奶杏色: '#EFD9BC',
  白色: '#FFFFFF',
  黑色: '#111111',
  墨黑: '#0B0B0B',
  浅灰: '#D3D6D8',
  中灰: '#8C9196',
  冷灰: '#9AA3A8',
  枪灰: '#4A4F54',
  银灰: '#C4C9CC',
  藏蓝: '#1F3A5F',
  藏青: '#1F3A5F',
  宝蓝: '#1149A6',
  蓝灰: '#6E8095',
  雾霾蓝: '#8FA9B8',
  霾蓝: '#8FA9B8',
  紫蓝: '#4A4E9B',
  灰紫: '#8E82A0',
  薰衣草紫: '#B7A6D6',
  墨绿: '#1E3B31',
  橄榄绿: '#6B7A3A',
  榄绿: '#6B7A3A',
  薄荷绿: '#A7D8C4',
  青碧: '#2E8B8B',
  金色: '#C9A227',
  银色: '#C0C4C8',
  荧光色: '#D6FF3F',
}

/**
 * 从一段结论文本里挑"最先出现在句子里"的色名（不是词表里最先的那个）。
 * 例：'雾霾蓝、灰粉、薰衣草紫衬衫' ⇒ 雾霾蓝；'基础色上衣（白/黑/灰/藏蓝/米色）' ⇒ 藏蓝
 *（词表里没有'白色'这种'白/'的裸字，认不出就返回 null，不硬凑）。
 * @returns {string|null}
 */
function _firstColorNameIn(s) {
  const text = String(s || '')
  let best = null
  let at = Infinity
  for (const k of Object.keys(COLOR_NAME_HEX)) {
    const i = text.indexOf(k)
    if (i >= 0 && i < at) {
      at = i
      best = k
    }
  }
  return best
}

/** 接受 '#hex' / 'hex' / 色名；识别不了返回 null（调用方必须"缺色不出分"，不许猜） */
function resolveColor(input) {
  if (!input) return null
  const s = String(input).trim()
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
    const hex = `#${s.replace(/^#/, '').toUpperCase()}` // 统一大写，前端拿到的是稳定值
    return hexToLab(hex) ? hex : null
  }
  // 词表只认自己的色名：写成 COLOR_NAME_HEX[s] 时 s='constructor' 会返回 Object 构造器，
  // 这个"颜色"再往下走就成了函数而不是 '#RRGGBB'，最后 hexToLab 认不出、分数无声消失
  const named = ownValue(COLOR_NAME_HEX, s)
  if (named) return named
  const hit = _firstColorNameIn(s)
  return hit ? COLOR_NAME_HEX[hit] : null
}

// ------------------------------------------------------------
// 3. C 档：肤色档 → 代表 CIELAB（表单只有 8 个中文档，没有实测色值）
//    ⚠️ 这些是内部标定值，不是文献值。正式对外要换成色卡/测色仪实测的 L*a*b*。
// ------------------------------------------------------------
const SKIN_TONE_ANCHORS = {
  白皙: { L: 68, a: 8, b: 14 },
  自然白: { L: 63, a: 9, b: 17 },
  冷皮: { L: 62, a: 11, b: 13 },
  自然: { L: 57, a: 10, b: 19 },
  暖皮: { L: 55, a: 9, b: 22 },
  偏黄: { L: 54, a: 7, b: 25 },
  小麦色: { L: 46, a: 8, b: 24 },
  古铜色: { L: 38, a: 7, b: 22 },
}

/** 肤色档 → Lab；拿不到返回 null */
function skinToneToLab(skinTone) {
  if (!skinTone) return null
  const s = String(skinTone).trim()
  const direct = ownValue(SKIN_TONE_ANCHORS, s)
  if (direct) return direct
  const hit = Object.keys(SKIN_TONE_ANCHORS).find((k) => s.includes(k))
  if (hit) return SKIN_TONE_ANCHORS[hit]
  const lab = hexToLab(resolveColor(s))
  return lab || null
}

// ------------------------------------------------------------
// 4. 上衣 × 人 的贴合分（合成分权重＝C 档手拍值，等 F7 的标注回归出来后替换）
// ------------------------------------------------------------
const _clamp01 = (v) => Math.max(0, Math.min(1, v))
/** 从"珊瑚粉、蜜桃色针织衫"这类结论文本里认第一个出现的色名（认不出返回 null） */
const _matchedColorName = (input) => {
  const s = String(input || '')
  if (ownValue(COLOR_NAME_HEX, s)) return s
  return _firstColorNameIn(s)
}
const WEIGHTS = { hueContrast: 0.45, brighten: 0.35, chromaMatch: 0.2 } // 手拍，未回归（C 档）

/**
 * @param {object|string} skin 肤色档中文名、'#hex' 或 {L,a,b}
 * @param {string} topColor   上衣色：'#hex' 或色名
 * @returns {null|{score:number, deltaE00:number, dHue:number, hueContrast:number, dL:number, brighten:number, chroma:number, evidence:string}}
 *          任一侧色取不到 ⇒ 返回 null（不编造分数）
 */
function colorFit(skin, topColor) {
  const rawSkin = skin && typeof skin === 'object' && 'L' in skin ? skin : skinToneToLab(skin)
  const topHex = resolveColor(topColor)
  if (!rawSkin || !topHex) return null
  // 肤色锚点表只存 L/a/b，这里补齐 C，避免 NaN 一路传到 score
  const skinLab = { ...rawSkin, C: Math.hypot(rawSkin.a, rawSkin.b) }
  // top 侧同一条闸门补齐：resolveColor 目前只回 '#RRGGBB'，但函数签名允许调用方
  // 直接把 {L,a,b} 递进来（top 侧走 hexToLab 之外的那条分支）。缺 C 一律按 a/b 现算，
  // 算不出来就整条不给分，并且**不改调用方传进来的对象**——
  // SKIN_TONE_ANCHORS 是模块级共享常量，往里写 C 会污染后续每一次取色。
  // 10-13 实测：改前 colorFit({L:60}, '#FFCC00') 回 score=NaN（a/b 缺 ⇒ skinLab.C NaN），
  // 改后回 null；传 '#FFCC00' 正常出分 26、chroma 85.3。
  const topLabRaw = typeof topHex === 'string' ? hexToLab(topHex) : topHex
  if (!topLabRaw || !isFinite(topLabRaw.L)) return null
  const topC = isFinite(topLabRaw.C) ? topLabRaw.C : Math.hypot(topLabRaw.a, topLabRaw.b)
  if (!isFinite(topC) || !isFinite(skinLab.L) || !isFinite(skinLab.C)) return null
  const topLab = { ...topLabRaw, C: topC }

  const dE = deltaE00(skinLab, topLab)
  const dHue = hueGap(skinLab, topLab)
  const dL = topLab.L - skinLab.L
  const dC = topLab.C - skinLab.C
  const hueContrast = 0.5 + _clamp01(dHue / 360) // Schloss & Palmer 第②句：图形色(衣)对背景(脸)，色相差越大越被偏好
  const brighten = _clamp01((skinLab.L - topLab.L) / 40) // Zhang 2025：衣装越暗，脸越显白
  const chromaMatch = 1 - _clamp01(Math.abs(dC) / 60)
  const score = Math.round(
    100 *
      (WEIGHTS.hueContrast * hueContrast +
        WEIGHTS.brighten * brighten +
        WEIGHTS.chromaMatch * chromaMatch),
  )
  return {
    score,
    top_hex: topHex,
    top_label: _matchedColorName(topColor) || String(topColor).slice(0, 12),
    deltaE00: Math.round(dE * 10) / 10,
    dHue: Math.round(dHue * 10) / 10,
    // 对比轴归一后的贡献值 0.5~1.0（Δhue 0°→0.5，180°→1.0）。
    // 区间只有一半宽度是文档 §8.2 定下的写法：它保证"色相无 separation"不至于被判成 0 分。
    hueContrast: Math.round(hueContrast * 1000) / 1000,
    dL: Math.round(dL * 10) / 10,
    brighten: Math.round(brighten * 100),
    chroma: Math.round(topLab.C * 10) / 10,
    evidence:
      'A 色差公式(GB/T 7921 / ISO-CIE 11664) + B 色相对比与明度效应(Schloss & Palmer 2011 图形色-背景那句 + Zhang 2025, DOI 见文件头) + C 合成分权重(手拍)',
  }
}

/**
 * 面积权重取值口径：正数照用，**0 也照用**（0 表示这件不占面积，比如只当存在不算比重的配饰），
 * 只有 NaN／负数／没填才回退成 1（等同"未知，按平均一件算"）。
 * 原来两处写成 `Number(p.area) || 1`，`||` 会把合法的 0 一起吞掉 ⇒ 明确写 0 的单品
 * 被当成和平均一件一样重，加权结果和调用方给的面积比例相反。
 * @param {*} v parts 里的 area 原值
 * @returns {number}
 */
function areaWeight(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

/**
 * 整身配色和谐度：两两 ΔE00 按面积乘积加权（60-30-10 那类比例在这里体现为面积权重）
 * @param {Array<{label:string,color:string,area:number}>} parts 面积和不必为 1，会自动归一
 * @returns {null|{score:number, pairs:Array}}
 */
function outfitHarmony(parts) {
  const list = (parts || [])
    .map((p) => ({ ...p, lab: hexToLab(resolveColor(p.color)), weight: areaWeight(p.area) }))
    .filter((p) => p.lab)
  if (list.length < 2) return null
  let total = list.reduce((s, p) => s + p.weight, 0)
  // 全 0（调用方把所有件都标成不占面积）⇒ 归一化会 0/0，退化成等权
  if (!(total > 0)) {
    list.forEach((p) => {
      p.weight = 1
    })
    total = list.length
  }
  const pairs = []
  let num = 0
  let den = 0
  let simSum = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const w = (list[i].weight / total) * (list[j].weight / total)
      const sim = 100 - Math.min(deltaE00(list[i].lab, list[j].lab), 100)
      num += w * sim
      den += w
      simSum += sim
      pairs.push({
        a: list[i].label,
        b: list[j].label,
        deltaE00: Math.round(deltaE00(list[i].lab, list[j].lab) * 10) / 10,
      })
    }
  }
  // 只剩一对且它权重为 0（另一件面积是 0）时 den 也是 0 ⇒ 同样按等权均值出分，不给 NaN
  const value = den > 0 ? num / den : simSum / pairs.length
  return { score: Math.round(value * 10) / 10, pairs }
}

module.exports = {
  hexToLab,
  deltaE00,
  hueGap,
  individualTypologyAngle,
  itaClass,
  resolveColor,
  skinToneToLab,
  colorFit,
  outfitHarmony,
  COLOR_NAME_HEX,
  SKIN_TONE_ANCHORS,
}
