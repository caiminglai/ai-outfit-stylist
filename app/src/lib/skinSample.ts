/**
 * 肤色取色的数学层（第十阶段·第一步）——纯函数，不碰 DOM、不发请求。
 *
 * 唯一权威规范 = `docs/依据/18-肤色采集输入输出规范-20261021.md` §2.1（输入侧契约）
 * 与 §2.2（冷暖切点）。这里只负责「一块像素 → 一个色相角 → 一句档名」，
 * 界面在 `app/src/components/SkinSampler.tsx`。
 *
 * 🔴 三条刻在文件头的取舍：
 * 1. **照片不出设备**：本模块只吃 `ImageData`（调用方从本机 canvas 拿的），
 *    全程不 `fetch`、不 `toDataURL`、不进 `localStorage`（18 §三 第 3 条）。
 * 2. **只用色相角 h°，绝对明度一概不接**：Alipour 等 2026（DOI 10.1111/srt.70374）
 *    量到非受控成像下固定阈值 ITA 分型准确率 22.9% ＜ 基线 51.3%，
 *    `docs/依据/04` §1.3 据此立红线「绝不能用照片或自拍推肤色再算 ITA」。
 *    18 §2.2 那次自洽跑还实测了一块典型「亮皮肤」`#E8C4B8` → L=81.89，
 *    比华裔人群 P95＝65.87 还高 16 个点 ⇒ 照片里的 L 是曝光，不是肤色。
 *    ⛔ 所以这里算出了 L 也**不往外送**：送给后端的只有一个 `h`（18 §2.4）。
 * 3. **取不到就明说取不到**：闸门不过 ⇒ 回 `ok:false` 带一句原因，
 *    ⛔ 不退成「自然」、⛔ 不给默认值（全局硬规矩 2「缺测不出分」）。
 *
 * 换算数学与后端 `backend/services/colorMetrics.js:40 hexToLab()` 逐字同一条
 *（A 档：GB/T 7921-2008《均匀色空间和色差公式》／ISO/CIE 11664 sRGB→CIELAB D65）。
 * ⚠️ 前端不能 require 后端，所以这份是**明知故开的第二份**——漂移防线见 18 §五a：
 * 后端有一条测试逐字钉住那两处切点，改这里必须同时改 `colorMetrics.js` 与那条测试。
 */

/**
 * 冷暖切点＋有效域。前两个值＝华裔人群 h° 的 P25／P75（B 档汇编实测，`04` §1.4），
 * 🔴 但「用这两个分位当切点」这个动作本身是 C 档手拍 ⇒ ⛔ 对外不许称科学分档。
 * 权威出处：`backend/services/colorMetrics.js` 的 `SKIN_HUE`／`skinUndertoneFromHue()`；
 * 这里的副本只为让 UI 取样后当场能显示档名，不参与任何计分。
 */
export const SKIN_CUT = {
  /** h° ≤ 此值判冷皮（华裔 P25） */
  cold: 52.86,
  /** h° ≥ 此值判暖皮（华裔 P75） */
  warm: 64.02,
  /** 再往外就不认它是人脸皮肤色（华裔 P5 44.36 − 8，外扩 8 是 C 档手拍） */
  hueMin: 36.36,
  /** 同上（华裔 P95 70.05 ＋ 8）；余量包的是照片取色角度的人群散布，不是锚点（10-29 重锚定后偏黄 h65.42 已落回 P95 内，旧理由作废） */
  hueMax: 78.05,
  /** 彩度有效域（华裔 C* P5 15.53 − 5 ／ P95 25.15 ＋ 5，外扩 5 是 C 档手拍） */
  cMin: 10.53,
  cMax: 30.15,
  /** sRGB 通道相对关系闸门（C 档手拍）：皮肤必须 r>g>b 且 r−b 落在这个带里 */
  rbMin: 8,
  rbMax: 110,
} as const

/** 后端 `skin_tone` 那三档词表，⛔ 只这三个值——配饰/妆容两条 `includes()` 路只认档名（18 §六 第 6 条） */
export type SkinUndertone = '冷皮' | '自然' | '暖皮'

/** 一个取样结果：⚠️ 只有 hex／h／c／samples，🔴 没有 L（18 §2.4「本规范没有 skin_lab 这一格」） */
export interface SkinSample {
  /** '#rrggbb'，小写；只为拆账与复现，参与不了计算 */
  hex: string
  /** CIELAB 色相角（度，−180~180 归一到 0~360 前的原始值由 hexToLab 决定，这里恒 ≥ 0） */
  h: number
  /** C* 彩度 */
  c: number
  /** 这个颜色来自框内多少个像素 */
  samples: number
}

export type SkinSampleOutcome =
  { ok: true; sample: SkinSample; undertone: SkinUndertone } | { ok: false; reason: string }

/** sRGB 单通道 0~255 → 线性光（与后端 `_srgbToLin` 同一条） */
function _srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * 8bit RGB → CIELAB(D65)。逐字照后端 `hexToLab` 的矩阵与临界值。
 * 返回的 `L` 只用于内部（本模块其实用不上），⛔ 调用方拿不到它。
 */
export function rgbToLab(
  r: number,
  g: number,
  b: number,
): { L: number; a: number; b: number; C: number; h: number } {
  const R = _srgbToLinear(r)
  const G = _srgbToLinear(g)
  const B = _srgbToLinear(b)
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X / 0.95047)
  const fy = f(Y / 1.0)
  const fz = f(Z / 1.08883)
  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const bb = 200 * (fy - fz)
  let h = (Math.atan2(bb, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L, a, b: bb, C: Math.hypot(a, bb), h }
}

/** 一个色相角 → 三档词表。越界／非有限 ⇒ null（⛔ 不退成「自然」）。 */
export function undertoneFromHue(hue: number): SkinUndertone | null {
  const h = Number(hue)
  if (!Number.isFinite(h)) return null
  if (h < SKIN_CUT.hueMin || h > SKIN_CUT.hueMax) return null
  if (h <= SKIN_CUT.cold) return '冷皮'
  if (h >= SKIN_CUT.warm) return '暖皮'
  return '自然'
}

function _toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
}

/** 通道中位数（18 §2.1「各通道分别取中位数」；⛔ 不是均值——一根发丝就能把均值拖走） */
function _median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 把一块 `ImageData` 收成「一个候选皮肤色」并过三道有效性闸门。
 *
 * @param data `ctx.getImageData(...)` 的原样返回，尺寸即取样框
 * @returns `ok:false` 时 `reason` 是要直接显示给用户的话术，⛔ 调用方不得自行兜底
 */
export function sampleSkinFromImageData(data: ImageData): SkinSampleOutcome {
  const { width, height, data: px } = data
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, reason: '这块区域是空的，请把方框往脸颊中间挪一挪' }
  }
  const total = width * height
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (let i = 0; i < total; i++) {
    // getImageData 是无压缩 RGBA；透明像素（a=0）不参与，否则会平白拉低中位数
    if (px[i * 4 + 3] === 0) continue
    rs.push(px[i * 4])
    gs.push(px[i * 4 + 1])
    bs.push(px[i * 4 + 2])
  }
  if (rs.length < 4) {
    return { ok: false, reason: '这块取不到足够像素，请把方框往脸颊中间挪一挪或换一张清楚的照片' }
  }
  const r = _median(rs)
  const g = _median(gs)
  const b = _median(bs)
  if (!(r > g && g > b)) {
    return {
      ok: false,
      reason:
        '这块取到的不是皮肤色（正常皮肤是 r>g>b）。请把方框挪到脸颊中间，避开眼睛、头发和阴影',
    }
  }
  const rb = r - b
  if (rb < SKIN_CUT.rbMin || rb > SKIN_CUT.rbMax) {
    return {
      ok: false,
      reason:
        rb < SKIN_CUT.rbMin
          ? '这块的红蓝差太小，接近灰白（可能是过曝或屏幕反光），换一张自然光下的照片'
          : '这块的红蓝差太大，不像皮肤色。请把方框往脸颊中间挪一挪',
    }
  }
  const lab = rgbToLab(r, g, b)
  if (!Number.isFinite(lab.C) || !Number.isFinite(lab.h)) {
    return { ok: false, reason: '这块算不出颜色，请重新选一张照片' }
  }
  if (lab.C < SKIN_CUT.cMin || lab.C > SKIN_CUT.cMax) {
    return {
      ok: false,
      reason:
        lab.C < SKIN_CUT.cMin
          ? '这块太灰了，不像皮肤（可能是黑白照或光线太暗）。换一张光好的彩色照片'
          : '这块太艳了，不像皮肤色。请把方框往脸颊中间挪一挪，避开口红和腮红',
    }
  }
  const undertone = undertoneFromHue(lab.h)
  if (!undertone) {
    return {
      ok: false,
      reason: '这块的颜色偏出人群皮肤色范围了，请把方框往脸颊中间挪一挪或换一张光好的照片',
    }
  }
  const sample: SkinSample = {
    hex: `#${_toHex(r)}${_toHex(g)}${_toHex(b)}`,
    h: Math.round(lab.h * 100) / 100,
    c: Math.round(lab.C * 100) / 100,
    samples: rs.length,
  }
  return { ok: true, sample, undertone }
}

/**
 * 面部先验框（C 档手拍，⛔ 不是人脸检测结果；18 §六 第 2 条已登记这条偏差）。
 * 边长＝`min(w,h)×0.08`，中心＝`(0.50w, 0.36h)`——自拍头肩构图里脸颊大概在这儿。
 * 回的是整数像素盒，已夹在图内；越界成 0 宽时调用方按「取不到」处理。
 */
export function facePriorBox(
  width: number,
  height: number,
): { x: number; y: number; size: number } {
  const w = Math.max(1, Math.floor(Number(width) || 1))
  const h = Math.max(1, Math.floor(Number(height) || 1))
  const size = Math.max(1, Math.ceil(Math.min(w, h) * 0.08))
  const cx = Math.round(w * 0.5)
  const cy = Math.round(h * 0.36)
  const half = Math.floor(size / 2)
  const x = Math.min(Math.max(0, cx - half), Math.max(0, w - size))
  const y = Math.min(Math.max(0, cy - half), Math.max(0, h - size))
  return { x, y, size }
}
