/**
 * 肤色取色数学层的行为钉（11-03 前端第一条测试）
 *
 * 为什么先测这份：它是前端唯一一处"算错了顾客报告就错"的纯函数，且规范
 * `docs/依据/18-肤色采集输入输出规范-20261021.md` §2.1／§2.2 给它写死了数值口径；
 * 而 §五a 明说过这里是"明知故开的第二份"（前端不能 require 后端），后端那条测试只钉得住
 * 后端自己 ⇒ 前端这份漂了没人响。那份对账落在 `backend/test/frontendConstantsParity.test.js`
 * （为什么不在这里做，见本文件末尾那条说明）。
 */
import { describe, it, expect } from 'vitest'
import {
  SKIN_CUT,
  rgbToLab,
  undertoneFromHue,
  sampleSkinFromImageData,
  facePriorBox,
} from './skinSample'

/** 造一块 w×h 的假取样框：data 是无压缩 RGBA */
function fakeImageData(w: number, h: number, pixels: number[][]) {
  const data = new Uint8ClampedArray(w * h * 4)
  pixels.forEach((p, i) => {
    if (i >= w * h) return
    data[i * 4] = p[0]
    data[i * 4 + 1] = p[1]
    data[i * 4 + 2] = p[2]
    data[i * 4 + 3] = p[3] === undefined ? 255 : p[3]
  })
  return { width: w, height: h, data } as unknown as ImageData
}

describe('rgbToLab：与后端 hexToLab 同一条 sRGB→CIELAB(D65)', () => {
  it('规范 §2.2 点名的反例 #E8C4B8 → L=81.89（比华裔 P95 还高 16 个点，所以深浅轴不吃照片 L）', () => {
    const lab = rgbToLab(0xe8, 0xc4, 0xb8)
    expect(Math.round(lab.L * 100) / 100).toBe(81.89)
  })

  it('黑／白／中性灰的 a、b 都接近 0，色相角不许被当成肤色', () => {
    for (const v of [0, 128, 255]) {
      const lab = rgbToLab(v, v, v)
      // ⚠️ 阈值取 1e-4 而不是 1e-9：`7.787*t+16/116` 那条线性近似段本身就带 1e-5 量级的舍入，
      // 中性灰的 a/b 实测约 1e-5，钉太紧会变成"测浮点噪声"的假红（11-03 现量：128 灰 a＝-1.00e-5）。
      expect(Math.abs(lab.a)).toBeLessThan(1e-4)
      expect(Math.abs(lab.b)).toBeLessThan(1e-4)
      expect(lab.C).toBeLessThan(1e-4)
    }
  })

  it('色相角归一到 0~360（ atan2 的负角要加回 360）', () => {
    for (const [r, g, b] of [
      [200, 160, 140],
      [120, 180, 200],
      [60, 40, 90],
    ]) {
      const h = rgbToLab(r, g, b).h
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })
})

describe('undertoneFromHue：三档词表＋闸门，⛔ 越界不许退成「自然」', () => {
  it('冷／自然／暖的边界逐字按 SKIN_CUT（≤52.86 冷，≥64.02 暖，中间自然）', () => {
    expect(undertoneFromHue(SKIN_CUT.cold)).toBe('冷皮')
    expect(undertoneFromHue(SKIN_CUT.cold + 0.01)).toBe('自然')
    expect(undertoneFromHue(SKIN_CUT.warm)).toBe('暖皮')
    expect(undertoneFromHue(SKIN_CUT.warm - 0.01)).toBe('自然')
  })

  it('出有效域（hueMin／hueMax）外一律 null，非有限数也 null', () => {
    expect(undertoneFromHue(SKIN_CUT.hueMin - 0.01)).toBeNull()
    expect(undertoneFromHue(SKIN_CUT.hueMax + 0.01)).toBeNull()
    expect(undertoneFromHue(Number.NaN)).toBeNull()
    expect(undertoneFromHue(Infinity)).toBeNull()
    expect(undertoneFromHue('58' as unknown as number)).toBe('自然') // 字符串数字照样能判
    expect(undertoneFromHue('abc' as unknown as number)).toBeNull()
  })
})

describe('sampleSkinFromImageData：三道闸门的"取不到就明说"话术', () => {
  it('一块合格的皮肤色（r>g>b、红蓝差在带内、C 与 h 都在有效域）⇒ ok，且回里没有 L', () => {
    // #E8C4B8 是中位数落点，多塞几像素让它取中位数而不是均值
    const px = Array.from({ length: 9 }, () => [0xe8, 0xc4, 0xb8, 255])
    const out = sampleSkinFromImageData(fakeImageData(3, 3, px))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sample.hex).toBe('#e8c4b8')
    expect(out.sample.samples).toBe(9)
    expect(['冷皮', '自然', '暖皮']).toContain(out.undertone)
    // 🔴 18 §2.4：本规范没有 skin_lab 这一格 ⇒ 结构里不许出现 L
    expect(Object.keys(out.sample).sort()).toEqual(['c', 'h', 'hex', 'samples'])
  })

  it('空框／像素不足 4 个 ⇒ 各自那句原因，不许回一个默认档', () => {
    const empty = sampleSkinFromImageData(fakeImageData(0, 0, []))
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.reason).toContain('空的')
    const few = sampleSkinFromImageData(fakeImageData(2, 2, [[200, 160, 140, 255]]))
    expect(few.ok).toBe(false)
    if (few.ok) return
    expect(few.reason).toContain('足够像素')
  })

  it('透明像素不参与：4 个不透明＋若干 a=0 仍按 4 个算', () => {
    const px = [
      [232, 196, 184, 255],
      [232, 196, 184, 255],
      [232, 196, 184, 255],
      [232, 196, 184, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [255, 255, 255, 0],
      [10, 200, 10, 0],
    ]
    const out = sampleSkinFromImageData(fakeImageData(4, 2, px))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.sample.samples).toBe(4)
  })

  it('r>g>b 不成立（挑一块蓝灰）⇒ 判"取到的不是皮肤色"', () => {
    const px = Array.from({ length: 4 }, () => [120, 140, 200, 255])
    const out = sampleSkinFromImageData(fakeImageData(2, 2, px))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('r>g>b')
  })

  it('红蓝差过曝（灰白一块，rb<8）⇒ 说过曝／反光，而不是给个档', () => {
    const px = Array.from({ length: 4 }, () => [250, 248, 246, 255])
    const out = sampleSkinFromImageData(fakeImageData(2, 2, px))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('过曝')
  })

  it('太艳（C 超上沿）⇒ 说"太艳"，避开口红腮红那句', () => {
    // 挑色要同时过前两道闸才轮得到 C 闸：r>g>b 且红蓝差 100 落在 8~110 带内，
    // 但 C*＝36.88 已经高出华裔 P95(25.15)＋5 的上沿 30.15 ⇒ 这才是"太艳"那条。
    const px = Array.from({ length: 4 }, () => [190, 120, 90, 255])
    const out = sampleSkinFromImageData(fakeImageData(2, 2, px))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('太艳')
  })
})

describe('facePriorBox：先验框（C 档手拍）必须夹在图内', () => {
  it('常规尺寸：边长＝min(w,h)×0.08、中心 (0.50w, 0.36h)', () => {
    const b = facePriorBox(1000, 800)
    expect(b.size).toBe(Math.ceil(800 * 0.08))
    expect(b.x).toBe(Math.round(1000 * 0.5) - Math.floor(b.size / 2))
    expect(b.y).toBe(Math.round(800 * 0.36) - Math.floor(b.size / 2))
  })

  it('极小图与非法尺寸都不许回 0 宽或越界', () => {
    for (const [w, h] of [
      [1, 1],
      [3, 2],
      [0, 0],
      [-5, -5],
      [Number.NaN, Number.NaN],
    ]) {
      const b = facePriorBox(w, h)
      expect(b.size).toBeGreaterThanOrEqual(1)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      const W = Math.max(1, Math.floor(Number(w) || 1))
      const H = Math.max(1, Math.floor(Number(h) || 1))
      expect(b.x + b.size).toBeLessThanOrEqual(W)
      expect(b.y + b.size).toBeLessThanOrEqual(H)
    }
  })
})

// 🔴 关于"前后端两份切点常数不许漂"（18 §五a 那条明知故开的第二份）：
// 这条对账不放在本文件里。原因量过：要读 `backend/services/colorMetrics.js` 就得 import
// `node:fs`，而 `tsconfig.app.json` 的 `types` 只有 `vite/client`（不含 node 类型）⇒
// 前端任何文件一 import node:fs，`npm run typecheck`（tsc -b --force）就报 TS2307（11-03 实测三处）。
// ⇒ 跨语言对账落在 `backend/test/frontendConstantsParity.test.js`：那边能 `require` 到后端真值，
// 比在这侧用正则抠后端源码更硬。本文件下面那段则把前端八个字面量原地钉死。

describe('SKIN_CUT：八个字面量逐字钉住（改数要同时改后端与规范 18 §2.2）', () => {
  it('冷暖切点＝华裔 h° 的 P25／P75', () => {
    expect(SKIN_CUT.cold).toBe(52.86)
    expect(SKIN_CUT.warm).toBe(64.02)
  })

  it('色相有效域＝P5−8 与 P95＋8（外扩 8 是 C 档手拍）', () => {
    expect(SKIN_CUT.hueMin).toBe(36.36)
    expect(SKIN_CUT.hueMax).toBe(78.05)
  })

  it('彩度有效域＝P5−5 与 P95＋5（外扩 5 是 C 档手拍）', () => {
    expect(SKIN_CUT.cMin).toBe(10.53)
    expect(SKIN_CUT.cMax).toBe(30.15)
  })

  it('sRGB 通道闸门 r−b ∈ [8, 110]（C 档手拍）', () => {
    expect(SKIN_CUT.rbMin).toBe(8)
    expect(SKIN_CUT.rbMax).toBe(110)
  })
})
