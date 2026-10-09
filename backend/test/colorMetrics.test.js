/**
 * 色度学工装测试
 *
 * 为什么这样测：deltaE00 是 A/B 档公式（GB/T 7921-2008 / ISO-CIE 11664 + Sharma 2004），
 * 判对错的尺子必须是论文自己公布的 34 组标准样，不能拿"看着合理"当通过。
 * Sharma, Wu, Dalal (2004) "The CIEDE2000 Color-Difference Formula: Implementation Notes,
 * Supplementary Test Data, and Mathematical Observations", Color Res. Appl. 29(3):231-244,
 * DOI 10.1002/col.20070 —— 下列 SHARMA_PAIRS 逐字取自该论文的补充测试数据。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const {
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
} = require('../services/colorMetrics')

// ============================================================
// 1. CIEDE2000：论文 34 组标准样，容差 0.0005（论文给到 4 位小数）
// ============================================================
const SHARMA_PAIRS = [
  { l1: [50.0, 2.6772, -79.7751], l2: [50.0, 0.0, -82.7485], expect: 2.0425 },
  { l1: [50.0, 3.1571, -77.2803], l2: [50.0, 0.0, -82.7485], expect: 2.8615 },
  { l1: [50.0, 2.8361, -74.02], l2: [50.0, 0.0, -82.7485], expect: 3.4412 },
  { l1: [50.0, -1.3802, -84.2814], l2: [50.0, 0.0, -82.7485], expect: 1.0 },
  { l1: [50.0, -1.1848, -84.8006], l2: [50.0, 0.0, -82.7485], expect: 1.0 },
  { l1: [50.0, -0.9009, -85.5211], l2: [50.0, 0.0, -82.7485], expect: 1.0 },
  { l1: [50.0, 0.0, 0.0], l2: [50.0, -1.0, 2.0], expect: 2.3669 },
  { l1: [50.0, -1.0, 2.0], l2: [50.0, 0.0, 0.0], expect: 2.3669 },
  { l1: [50.0, 2.49, -0.001], l2: [50.0, -2.49, 0.0009], expect: 7.1792 },
  { l1: [50.0, 2.49, -0.001], l2: [50.0, -2.49, 0.001], expect: 7.1792 },
  { l1: [50.0, 2.49, -0.001], l2: [50.0, -2.49, 0.0011], expect: 7.2195 },
  { l1: [50.0, 2.49, -0.001], l2: [50.0, -2.49, 0.0012], expect: 7.2195 },
  { l1: [50.0, -0.001, 2.49], l2: [50.0, 0.0009, -2.49], expect: 4.8045 },
  { l1: [50.0, -0.001, 2.49], l2: [50.0, 0.001, -2.49], expect: 4.8045 },
  { l1: [50.0, -0.001, 2.49], l2: [50.0, 0.0011, -2.49], expect: 4.7461 },
  { l1: [50.0, 2.5, 0.0], l2: [50.0, 0.0, -2.5], expect: 4.3065 },
  { l1: [50.0, 2.5, 0.0], l2: [73.0, 25.0, -18.0], expect: 27.1492 },
  { l1: [50.0, 2.5, 0.0], l2: [61.0, -5.0, 29.0], expect: 22.8977 },
  { l1: [50.0, 2.5, 0.0], l2: [56.0, -27.0, -3.0], expect: 31.903 },
  { l1: [50.0, 2.5, 0.0], l2: [58.0, 24.0, 15.0], expect: 19.4535 },
  { l1: [50.0, 2.5, 0.0], l2: [50.0, 3.1736, 0.5854], expect: 1.0 },
  { l1: [50.0, 2.5, 0.0], l2: [50.0, 3.2972, 0.0], expect: 1.0 },
  { l1: [50.0, 2.5, 0.0], l2: [50.0, 1.8634, 0.5757], expect: 1.0 },
  { l1: [50.0, 2.5, 0.0], l2: [50.0, 3.2592, 0.335], expect: 1.0 },
  { l1: [60.2574, -34.0099, 36.2677], l2: [60.4626, -34.1751, 39.4387], expect: 1.2644 },
  { l1: [63.0109, -31.0961, -5.8663], l2: [62.8187, -29.7946, -4.0864], expect: 1.263 },
  { l1: [61.2901, 3.7196, -5.3901], l2: [61.4292, 2.248, -4.962], expect: 1.8731 },
  { l1: [35.0831, -44.1164, 3.7933], l2: [35.0232, -40.0716, 1.5901], expect: 1.8645 },
  { l1: [22.7233, 20.0904, -46.694], l2: [23.0331, 14.973, -42.5619], expect: 2.0373 },
  { l1: [36.4612, 47.858, 18.3852], l2: [36.2715, 50.5065, 21.2231], expect: 1.4146 },
  { l1: [90.8027, -2.0831, 1.441], l2: [91.1528, -1.6435, 0.0447], expect: 1.4441 },
  { l1: [90.9257, -0.5406, -0.9208], l2: [88.6381, -0.8985, -0.7239], expect: 1.5381 },
  { l1: [6.7747, -0.2908, -2.4247], l2: [5.8714, -0.0985, -2.2286], expect: 0.6377 },
  { l1: [2.0776, 0.0795, -1.135], l2: [0.9033, -0.0636, -0.5514], expect: 0.9082 },
]

const lab = (t) => ({ L: t[0], a: t[1], b: t[2] })

test('deltaE00: Sharma 2004 论文 34 组标准样全部对上（容差 0.0005）', () => {
  const bad = []
  SHARMA_PAIRS.forEach((p, i) => {
    const got = deltaE00(lab(p.l1), lab(p.l2))
    if (!(Math.abs(got - p.expect) < 0.0005)) bad.push(`#${i + 1} 期望 ${p.expect} 实得 ${got.toFixed(4)}`)
  })
  assert.deepStrictEqual(bad, [], `以下色差样本站不住:\n${bad.join('\n')}`)
  assert.strictEqual(SHARMA_PAIRS.length, 34, '样本数必须与论文一致，少一组就是抄漏了')
})

test('deltaE00: 同色为 0、对称、且不出现 NaN', () => {
  const red = hexToLab('#C8102E')
  assert.strictEqual(deltaE00(red, red), 0)
  const blue = hexToLab('#1F3A5F')
  assert.ok(Math.abs(deltaE00(red, blue) - deltaE00(blue, red)) < 1e-9)
  assert.ok(Number.isFinite(deltaE00(red, blue)))
})

// ============================================================
// 2. sRGB → CIELAB(D65)：用业界公开的锚定值校换算矩阵
// ============================================================
test('hexToLab: 三原色与白的 Lab 锚定值', () => {
  const near = (got, exp, tol = 0.3) => Math.abs(got - exp) <= tol
  const red = hexToLab('#FF0000')
  assert.ok(near(red.L, 53.23) && near(red.a, 80.11) && near(red.b, 67.22), `红: ${JSON.stringify(red)}`)
  const blue = hexToLab('#0000FF')
  assert.ok(near(blue.L, 32.3) && near(blue.a, 79.19) && near(blue.b, -107.86), `蓝: ${JSON.stringify(blue)}`)
  const white = hexToLab('#FFFFFF')
  assert.ok(near(white.L, 100) && near(white.a, 0) && near(white.b, 0), `白: ${JSON.stringify(white)}`)
  assert.strictEqual(hexToLab('#000000').L, 0)
})

test('hexToLab: 非法输入返回 null，不返回 NaN 对象', () => {
  assert.strictEqual(hexToLab('#GGGGGG'), null)
  assert.strictEqual(hexToLab('红'), null)
  assert.strictEqual(hexToLab(''), null)
  assert.strictEqual(hexToLab(undefined), null)
  assert.strictEqual(hexToLab('#FFF'), null) // 3 位缩写不支持，宁缺勿错
})

test('hueGap: 同色 0°、红青对顶接近 180°、且恒在 0~180', () => {
  const red = hexToLab('#C8102E')
  assert.strictEqual(Math.round(hueGap(red, red)), 0)
  const cyan = hexToLab('#2E8B8B')
  const g = hueGap(red, cyan)
  assert.ok(g >= 0 && g <= 180, `色相角差越界: ${g}`)
})

// ============================================================
// 3. ITA°（显白/肤色分档）
// ============================================================
test('individualTypologyAngle + itaClass: 肤色越深 ITA 越低', () => {
  const fair = individualTypologyAngle(SKIN_TONE_ANCHORS['白皙'])
  const bronze = individualTypologyAngle(SKIN_TONE_ANCHORS['古铜色'])
  assert.ok(fair > bronze, `白皙 ${fair} 应大于古铜 ${bronze}`)
  // 钉住单位：atan 出的是弧度，ITA° 必须是角度制（系数 180/π）。
  // (L−50)/b = 1 时 ITA° 恒等于 45，用它当尺子；曾经写成 100/π 会把角度压成 0.5565 倍。
  assert.ok(Math.abs(individualTypologyAngle({ L: 60, a: 0, b: 10 }) - 45) < 1e-9, 'ITA 弧度未换成角度')
  assert.ok(Math.abs(fair - 52.1) < 0.2, `白皙锚点 ITA 应≈52.1°，实测 ${fair}`)
  assert.strictEqual(itaClass(fair), 'light')
  assert.strictEqual(itaClass(null), null)
  assert.strictEqual(itaClass(60), 'very light')
  assert.strictEqual(itaClass(45), 'light')
  assert.strictEqual(itaClass(30), 'intermediate')
  assert.strictEqual(itaClass(15), 'tan')
  assert.strictEqual(itaClass(-10), 'brown')
  assert.strictEqual(itaClass(-40), 'dark')
})

// ============================================================
// 4. 色名/色值解析：认不出必须是 null（缺色不出分）
// ============================================================
test('resolveColor: 色名、带#与不带#的 hex、模糊文本', () => {
  assert.strictEqual(resolveColor('藏蓝'), '#1F3A5F')
  assert.strictEqual(resolveColor('#1F3A5F'), '#1F3A5F')
  assert.strictEqual(resolveColor('1f3a5f'), '#1F3A5F')
  assert.strictEqual(resolveColor('#1f3a5f'), '#1F3A5F', 'hex 一律归一成大写，前端拿到稳定值')
  assert.strictEqual(resolveColor('珊瑚粉针织衫'), '#F08A6E')
  assert.strictEqual(resolveColor('说不清的颜色'), null)
  assert.strictEqual(resolveColor(null), null)
})

test('resolveColor: 多色文本取句中最先出现的色名（不是词表里最先的那个）', () => {
  // 词表里"灰粉"排在"雾霾蓝"前面，但句子里"雾霾蓝"先出现 ⇒ 必须认雾霾蓝
  assert.strictEqual(resolveColor('雾霾蓝、灰粉、薰衣草紫衬衫或针织'), '#8FA9B8')
  assert.strictEqual(resolveColor('先说灰粉再说雾霾蓝'), '#D3AFAE')
  assert.strictEqual(colorFit('白皙', '雾霾蓝、灰粉衬衫').top_label, '雾霾蓝')
})

test('skinToneToLab: 8 个表单档位都能落到 Lab，垃圾值给 null', () => {
  Object.keys(SKIN_TONE_ANCHORS).forEach((k) => {
    assert.ok(skinToneToLab(k), `${k} 应有锚点`)
  })
  assert.strictEqual(skinToneToLab('透明人'), null)
  assert.strictEqual(skinToneToLab(''), null)
})

// ============================================================
// 5. colorFit：贴合分
// ============================================================
test('colorFit: 正常用例各项有界且在约定区间', () => {
  const r = colorFit('白皙', '藏蓝')
  assert.ok(r, '应返回结果')
  assert.ok(r.score >= 0 && r.score <= 100, `score 越界: ${r.score}`)
  ;[r.deltaE00, r.dHue, r.dL, r.brighten, r.chroma].forEach((v, i) => {
    assert.ok(Number.isFinite(v), `第 ${i} 项非有限数: ${v}`)
  })
  assert.ok(r.dHue >= 0 && r.dHue <= 180)
  assert.ok(r.brighten >= 0 && r.brighten <= 100)
  assert.ok(String(r.evidence).includes('GB/T 7921'), 'evidence 要写清档位来源')
})

test('colorFit: 深色上衣比浅色上衣更"显白"（Zhang 2025 的方向性断言）', () => {
  const dark = colorFit('白皙', '#111111')
  const light = colorFit('白皙', '#FFFFFF')
  assert.ok(dark.brighten > light.brighten, `黑 ${dark.brighten} 应大于白 ${light.brighten}`)
  assert.ok(dark.dL < light.dL)
})

test('colorFit: 任一侧取不到色就不出分（返回 null，不编造）', () => {
  assert.strictEqual(colorFit('白皙', '说不清的颜色'), null)
  assert.strictEqual(colorFit('透明人', '藏蓝'), null)
  assert.strictEqual(colorFit(null, null), null)
})

test('colorFit: 色相轴按"对比"给分，不吃"相似"（Schloss & Palmer 2011 图形色对背景那句）', () => {
  // 同一张脸，色相离肤色越远的上衣，hueContrast 分量越大（0.5 + Δhue/360）
  const near = colorFit('白皙', '#F5C9C2') // 与肤色色相接近的浅粉
  const far = colorFit('白皙', '雾霾蓝') // 色相角差最大的一档
  assert.ok(Math.abs(far.dHue) > Math.abs(near.dHue), `dHue 应 far>near: ${far.dHue} vs ${near.dHue}`)
  assert.ok(
    far.hueContrast > near.hueContrast,
    `对比分量应随色相差增大: far=${far.hueContrast} near=${near.hueContrast}`
  )
  // 旧口径（1 - Δhue/180）会让 far 的该分量趋近 0 并把总分压到 20 以下 ⇒ 反向钉住
  assert.ok(
    far.score > 40,
    `雾霾蓝配白皙不该再被"色相不相似"重罚（旧口径实测 19/100），现得 ${far.score}`
  )
  assert.ok(near.hueContrast >= 0.5 && near.hueContrast <= 1)
  assert.ok(far.hueContrast >= 0.5 && far.hueContrast <= 1)
})

test('colorFit: hueContrast 恒在 0.5~1.0，遍历 8 档肤色 × 全词表', () => {
  for (const skin of Object.keys(SKIN_TONE_ANCHORS)) {
    for (const name of Object.keys(COLOR_NAME_HEX)) {
      const r = colorFit(skin, name)
      assert.ok(r.hueContrast >= 0.5 && r.hueContrast <= 1.0, `${skin}×${name} hueContrast=${r.hueContrast}`)
      // 恒等式：hueContrast = 0.5 + Δhue/360（两位舍入内）
      const expect = 0.5 + r.dHue / 360
      assert.ok(
        Math.abs(r.hueContrast - expect) < 0.002,
        `${skin}×${name} 对比轴公式不符: ${r.hueContrast} vs ${expect}`
      )
    }
  }
})

test('colorFit: 肤色 8 档 × 词表全部色名，score 恒在 0~100 且无 NaN', () => {
  let n = 0
  for (const skin of Object.keys(SKIN_TONE_ANCHORS)) {
    for (const name of Object.keys(COLOR_NAME_HEX)) {
      const r = colorFit(skin, name)
      assert.ok(r, `${skin}×${name} 不该为 null`)
      assert.ok(Number.isFinite(r.score) && r.score >= 0 && r.score <= 100, `${skin}×${name} score=${r.score}`)
      assert.ok(Number.isFinite(r.deltaE00) && Number.isFinite(r.dHue))
      n++
    }
  }
  assert.ok(n >= 400, `遍历样本太少: ${n}`)
})

// ============================================================
// 6. outfitHarmony：整身配色
// ============================================================
test('outfitHarmony: 同色系高分、黑白撞色低分、少于 2 件不出分', () => {
  const same = outfitHarmony([
    { label: '上衣', color: '藏蓝', area: 0.6 },
    { label: '裤子', color: '藏青', area: 0.3 },
  ])
  const clash = outfitHarmony([
    { label: '上衣', color: '白色', area: 0.6 },
    { label: '裤子', color: '黑色', area: 0.3 },
  ])
  assert.ok(same && clash, '两组都应出分')
  assert.ok(same.score > clash.score, `同色系 ${same.score} 应高于黑白 ${clash.score}`)
  assert.strictEqual(same.pairs.length, 1)
  assert.strictEqual(outfitHarmony([{ label: '上衣', color: '藏蓝', area: 1 }]), null)
  assert.strictEqual(outfitHarmony([]), null)
  assert.strictEqual(outfitHarmony(null), null)
})

test('outfitHarmony: 面积权重参与打分（同样两件、面积悬殊时分数不同）', () => {
  const even = outfitHarmony([
    { label: 'a', color: '藏蓝', area: 0.5 },
    { label: 'b', color: '焦糖', area: 0.5 },
  ])
  assert.ok(even && Number.isFinite(even.score))
})
