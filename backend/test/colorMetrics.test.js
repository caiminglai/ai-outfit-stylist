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
  normalizeColorName,
  extractColors,
  colorFamily,
  lightnessBand,
  bandOfLab,
  skinToneToLab,
  skinUndertoneFromHue,
  synthesizeSkinLab,
  SKIN_HUE,
  colorFit,
  outfitHarmony,
  fusionGate,
  ACHROMATIC_C,
  FUSION_GATE,
  HARMONY_SHARE,
  WEIGHTS,
  COLOR_NAME_HEX,
  COLOR_SYNONYMS,
  COLOR_META_WORDS,
  COLOR_CRAFT_WORDS,
  COLOR_ALIAS_SCAN_TOKENS,
  COLOR_ANTI_SYNONYMS,
  COLOR_FAMILY_OVERRIDES,
  LIGHTNESS_BANDS,
  LIGHTNESS_TOKENS,
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
    if (!(Math.abs(got - p.expect) < 0.0005))
      bad.push(`#${i + 1} 期望 ${p.expect} 实得 ${got.toFixed(4)}`)
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
  assert.ok(
    near(red.L, 53.23) && near(red.a, 80.11) && near(red.b, 67.22),
    `红: ${JSON.stringify(red)}`,
  )
  const blue = hexToLab('#0000FF')
  assert.ok(
    near(blue.L, 32.3) && near(blue.a, 79.19) && near(blue.b, -107.86),
    `蓝: ${JSON.stringify(blue)}`,
  )
  const white = hexToLab('#FFFFFF')
  assert.ok(
    near(white.L, 100) && near(white.a, 0) && near(white.b, 0),
    `白: ${JSON.stringify(white)}`,
  )
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
  assert.ok(
    Math.abs(individualTypologyAngle({ L: 60, a: 0, b: 10 }) - 45) < 1e-9,
    'ITA 弧度未换成角度',
  )
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

test('原型链守卫：词表扩到 232 键后 constructor/__proto__ 这类键名仍取不到原型上的东西', () => {
  // 依据/14 §三 那条 ⛔：取色入口以前用 COLOR_NAME_HEX[s] 直接下标，s='constructor' 会拿到
  // Object 构造器 ⇒ 一路当"颜色"传下去，最后 hexToLab 认不出、分数无声消失。
  // 10-20 第六阶段·第一步补这条（建档时它只是规范里的一句话，盘上没有对应测试）。
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.strictEqual(resolveColor(key), null, `${key} 不该被认成颜色`)
    assert.strictEqual(normalizeColorName(key), null, `${key} 不该被归一成词表键`)
    assert.strictEqual(colorFit('白皙', key), null, `${key} 不该出一个贴合分`)
    // 守卫不能把所有输入一起判死：垃圾键混在正常色里时，正常那段仍要认出来
    const mixed = extractColors(`${key} + 藏蓝`)
    assert.strictEqual(mixed.length, 1, `${key} 那一段不该产出，只剩 藏蓝 一段`)
    assert.strictEqual(mixed[0].hex, '#1F3A5F')
  }
  // 尾缀写法也不许从原型上捞东西
  assert.strictEqual(resolveColor('constructor色'), null)
  assert.strictEqual(normalizeColorName('藏蓝'), '藏蓝')
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
  assert.ok(
    Math.abs(far.dHue) > Math.abs(near.dHue),
    `dHue 应 far>near: ${far.dHue} vs ${near.dHue}`,
  )
  assert.ok(
    far.hueContrast > near.hueContrast,
    `对比分量应随色相差增大: far=${far.hueContrast} near=${near.hueContrast}`,
  )
  // 旧口径（1 - Δhue/180）会让 far 的该分量趋近 0 并把总分压到 20 以下 ⇒ 反向钉住
  assert.ok(
    far.score > 40,
    `雾霾蓝配白皙不该再被"色相不相似"重罚（旧口径实测 19/100），现得 ${far.score}`,
  )
  assert.ok(near.hueContrast >= 0.5 && near.hueContrast <= 1)
  assert.ok(far.hueContrast >= 0.5 && far.hueContrast <= 1)
})

test('colorFit: hueContrast 恒在 0.5~1.0，遍历 8 档肤色 × 全词表', () => {
  let achromatic = 0
  for (const skin of Object.keys(SKIN_TONE_ANCHORS)) {
    for (const name of Object.keys(COLOR_NAME_HEX)) {
      const r = colorFit(skin, name)
      assert.ok(
        r.hueContrast >= 0.5 && r.hueContrast <= 1.0,
        `${skin}×${name} hueContrast=${r.hueContrast}`,
      )
      if (r.hue_applies === false) {
        // 10-19 改口径：上衣是黑白灰这类无彩色时，色相角是 atan2(0,0) 造出来的 0°（＝假正红），
        // 这一轴按"没有信息"记 0.5 且不参与总分，所以恒等式只对有色相的那批成立。
        // 名单不写死：10-20 第六阶段·第一步把词表从 58 扩到 232，写死"9 个"必然咬人
        // ⇒ 下面按 C < ACHROMATIC_C 现算，扩表时这条自动跟着重算。
        achromatic++
        assert.strictEqual(r.hueContrast, 0.5, `${skin}×${name} 无彩色侧不该拿到色相分，应钉在 0.5`)
        continue
      }
      // 恒等式：hueContrast = 0.5 + Δhue/360（两位舍入内）
      const expect = 0.5 + r.dHue / 360
      assert.ok(
        Math.abs(r.hueContrast - expect) < 0.002,
        `${skin}×${name} 对比轴公式不符: ${r.hueContrast} vs ${expect}`,
      )
    }
  }
  // 期望值从表里现算，不再写死 9×8=72（那是 58 键时代的读数）。
  const skinCount = Object.keys(SKIN_TONE_ANCHORS).length
  const achroNames = Object.keys(COLOR_NAME_HEX).filter((n) => {
    const lab = hexToLab(COLOR_NAME_HEX[n])
    return lab && lab.C < ACHROMATIC_C
  })
  // 肤色侧必须全部在这条线之上，否则"被剔色相的全在衣服侧"这句话就失效了。
  const skinBelow = Object.entries(SKIN_TONE_ANCHORS).filter(
    ([, v]) => Math.hypot(v.a, v.b) < ACHROMATIC_C,
  )
  assert.deepStrictEqual(
    skinBelow,
    [],
    '肤色锚点里有 C<ACHROMATIC_C 的档 ⇒ 剔色相会剔到脸侧，判据要重写',
  )
  assert.strictEqual(
    achromatic,
    achroNames.length * skinCount,
    `无彩色配对应按「现量 C<${ACHROMATIC_C} 的 ${achroNames.length} 色名 × ${skinCount} 档肤色」＝${
      achroNames.length * skinCount
    } 对，实际 ${achromatic}`,
  )
})

test('colorFit: ΔE00 同色糊合闸门（10-19 第二阶段改切点 15~30）压住贴脸与近脸两撮，仍不新增第四轴', () => {
  // 现量（10-19 第二阶段复量）：8 档肤色 × 58 色名 = 464 对里
  // ΔE00<15 的 50 对（10.8%）吃满惩罚、15~30 的 259 对（55.8%）走线性、≥30 的 155 对（33.4%）不动。
  // 改前切点是 6/15 ⇒ 只有 50 对受影响、且真实推荐里 ΔE00<15 的 0 条（闸门空转），
  // 判据与出处见 colorMetrics.js 的 FUSION_GATE 注释。
  const fused = colorFit('偏黄', '大地色') // ΔE00 1.4 ⇒ 吃满惩罚
  const near = colorFit('白皙', '桃红') // ΔE00 20.8 ⇒ 落在线性区（改前这条完全不受影响）
  const far = colorFit('偏黄', '藏蓝') // ΔE00 41.7 ⇒ 远离肤色，闸门 1.0
  assert.strictEqual(fused.fusion_gate, FUSION_GATE.min, `最糊的一对闸门应 ${FUSION_GATE.min}`)
  assert.strictEqual(far.fusion_gate, 1, '远离肤色的上衣不该被闸门压分')
  assert.ok(
    near.fusion_gate > FUSION_GATE.min && near.fusion_gate < 1,
    `近脸那撮必须落进线性区（改前它 gate=1，闸门在真实数据里一次不触发）：实际 ${near.fusion_gate}`,
  )
  assert.strictEqual(FUSION_GATE.lo, 15, '第二阶段定的切点：lo=15')
  assert.strictEqual(FUSION_GATE.hi, 30, '第二阶段定的切点：hi=30')
  // 闸门是乘数不是加法轴：除回 gate 就该等于三轴加权和（权重表一个字没多）
  const skin = skinToneToLab('偏黄')
  const skinC = Math.hypot(skin.a, skin.b)
  const chromaMatch = 1 - Math.min(1, Math.abs(fused.chroma - skinC) / 60)
  const manual =
    100 *
    (WEIGHTS.hueContrast * fused.hueContrast +
      WEIGHTS.brighten * (fused.brighten / 100) + // 返回值取整到百分位，容差留 1 分
      WEIGHTS.chromaMatch * chromaMatch)
  assert.ok(
    Math.abs(fused.contrast_score / fused.fusion_gate - manual) < 1,
    `闸门应能整笔拆回：${fused.contrast_score / fused.fusion_gate} vs ${manual}`,
  )
  assert.strictEqual(Object.keys(WEIGHTS).length, 3, 'WEIGHTS 仍是三轴')
  // 闸门函数本身边界：lo 以下钉住、hi 以上不动、中间线性
  assert.strictEqual(fusionGate(0), FUSION_GATE.min)
  assert.strictEqual(fusionGate(FUSION_GATE.hi), 1)
  assert.ok(
    Math.abs(fusionGate(22.5) - (FUSION_GATE.min + 0.5 * (1 - FUSION_GATE.min))) < 1e-9,
    '15~30 的中点应取到惩罚区间的中点',
  )
  assert.strictEqual(fusionGate(NaN), 1, 'ΔE00 算不出时闸门不许参与打分')
  assert.strictEqual(
    ACHROMATIC_C,
    5,
    '无彩色线挪动要同步词表 C<5 现量名单（10-20 词表 232 键＝36 个，名单见模块 ACHROMATIC_C 注释）',
  )
})

test('colorFit: 呼应分按 30% 份额进总分，两个分量各自可拆回账', () => {
  const noH = colorFit('白皙', '藏蓝')
  const withH = colorFit('白皙', '藏蓝', { harmony: 100 })
  const zeroH = colorFit('白皙', '藏蓝', { harmony: 0 })
  assert.strictEqual(noH.harmony_score, null, '不传呼应时这一维当缺数据，不当 0 分')
  assert.strictEqual(
    noH.score,
    Math.round(noH.contrast_score),
    '不传呼应时总分＝对比侧取整，行为与改前一致',
  )
  // contrast_score 是回给报告看的 0.1 精度值，总分用未取整的那份算 ⇒ 允许 1 分出入
  assert.ok(
    Math.abs(withH.score - (withH.contrast_score * 0.7 + 100 * HARMONY_SHARE)) <= 1,
    `呼应 100 时总分应落在 ${withH.contrast_score * 0.7 + 30} 上下，实际 ${withH.score}`,
  )
  assert.ok(
    Math.abs(zeroH.score - zeroH.contrast_score * 0.7) <= 1,
    `呼应 0 时总分应是对比侧的 70%，实际 ${zeroH.score} vs ${zeroH.contrast_score}`,
  )
  assert.ok(zeroH.score < noH.score, '整身打架要比分不出来时低——呼应侧确实在决定分数')
  assert.strictEqual(HARMONY_SHARE, 0.3, '份额改了要同步这条断言与文件头口径')
  // 非法值不许当 0 用（0 是"整身打架"，缺数据是"算不出"，两者不能混）
  const bad = colorFit('白皙', '藏蓝', { harmony: NaN })
  assert.strictEqual(bad.harmony_score, null, 'NaN 当缺测')
})

test('colorFit: 肤色 8 档 × 词表全部色名，score 恒在 0~100 且无 NaN', () => {
  let n = 0
  for (const skin of Object.keys(SKIN_TONE_ANCHORS)) {
    for (const name of Object.keys(COLOR_NAME_HEX)) {
      const r = colorFit(skin, name)
      assert.ok(r, `${skin}×${name} 不该为 null`)
      assert.ok(
        Number.isFinite(r.score) && r.score >= 0 && r.score <= 100,
        `${skin}×${name} score=${r.score}`,
      )
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

// ============================================================
// 7. 第六阶段·第一步：词表 58⇒232 与 L2~L5 四层
//    每段的期望值都来自 10-20 现量工装 `E:/website/站3产生临时文件/phase6-20261020/`：
//    synonym-check.cjs（别名三条不变量／禁并清单 ΔE00／明度档与色系分布）、
//    band-token-census.cjs（明度词频次）、band-bug-probe.cjs（L5 三条分支的实际回值）。
//    ⛔ 这张表和档位、权重一样是 C 档手拍，测试只锁"自洽与不回退"，不能拿来对外称"科学取色"。
// ============================================================

// 扩表前的 58 键逐键 hex（取自盘外备份 colorMetrics-before-lexicon.js，10-20 现量比对 0 键改动）
const COLOR_NAME_HEX_V1 = {
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

test('词表 L1：232 键、hex 格式合法、58 个老键一个没改（合并只增不改）', () => {
  const keys = Object.keys(COLOR_NAME_HEX)
  // 第六阶段指令要的是"200+"，现量 232（58 老键＋174 新键）
  assert.ok(keys.length >= 200, `词表 ${keys.length} 键，不足 200`)
  assert.strictEqual(keys.length, 232, '词表键数变了要同步模块注释与 依据/14 的读数')
  const bad = keys.filter((k) => !/^#[0-9A-F]{6}$/.test(COLOR_NAME_HEX[k]))
  assert.deepStrictEqual(bad, [], '有键的色值不是 #RRGGBB 大写六位')
  // 「只增不改」是这一轮对既有推荐唯一的兼容保证：老键 hex 变了＝改前取到的色值会变
  const changed = Object.keys(COLOR_NAME_HEX_V1).filter(
    (k) => COLOR_NAME_HEX[k] !== COLOR_NAME_HEX_V1[k],
  )
  assert.deepStrictEqual(changed, [], '老键的 hex 被动过，扩表必须是只增不改')
  const missing = Object.keys(COLOR_NAME_HEX_V1).filter((k) => !(k in COLOR_NAME_HEX))
  assert.deepStrictEqual(missing, [], '老键被删了一个')
  // 每个键都要能被自己的 resolveColor 取回（表内键＝精确命中，不该走任何兜底）
  const unresolvable = keys.filter((k) => resolveColor(k) !== COLOR_NAME_HEX[k])
  assert.deepStrictEqual(unresolvable, [], '有键取不到自己的色值')
})

test('词形归一 L2：五步链（精确／去尾色／补尾色／同义词／句内扫描）逐步都有样本', () => {
  assert.strictEqual(normalizeColorName('藏蓝'), '藏蓝', '① 精确命中')
  assert.strictEqual(normalizeColorName('藏蓝色'), '藏蓝', '② 去尾"色"')
  assert.strictEqual(
    normalizeColorName('大地'),
    '大地色',
    '③ 补尾"色"：现量 23 个键只能靠这一步认出（橘/驼/棕/米/杏…）',
  )
  assert.strictEqual(
    normalizeColorName('咖啡'),
    '咖啡棕',
    '④ 同义词：咖啡棕在表里，去/补"色"都够不着',
  )
  assert.strictEqual(normalizeColorName('驼色大衣'), '驼色', '⑤ 句内扫描：带款式词的文案')
  assert.strictEqual(normalizeColorName('雾霾蓝＋白色针织'), '雾霾蓝', '多色文案取句内最先那个')
  assert.strictEqual(normalizeColorName('今天天气不错'), null, '认不出就回 null，不许硬猜一个色')
  assert.strictEqual(normalizeColorName(''), null)
  assert.strictEqual(normalizeColorName(null), null)
  // 归一结果必须是表内键（下游 resolveColor 拿它索引才不会 undefined）
  for (const s of ['藏蓝色', '咖啡', '裸色', '绛色', '卡其布色', '上白下黑']) {
    const k = normalizeColorName(s)
    assert.ok(k && k in COLOR_NAME_HEX, `${s} ⇒ ${k} 不在词表里`)
  }
})

test('同义词库 L3：42 条别名满足三条不变量，且逐条归一到自己的规范键', () => {
  const aliases = Object.keys(COLOR_SYNONYMS)
  assert.strictEqual(aliases.length, 42, '别名条数变了要同步模块注释与 依据/14 §七')
  // 🔴 第十三阶段·第一步 §二·2：`COLOR_META_WORDS` 那三条别名（肤色/肉色/腮红）**照旧留在表里**
  // （手选色名那条路将来还在），但整段输入就是这个词时归一必须回 null——
  // "指人或脸上那件东西"的词不许折成一个衣服色。所以下面这条"逐条归一到规范键"的循环跳过它们，
  // 并当场断言它们被挡住了（挡在哪一条由旁边那块元词测试逐字盯）。
  assert.deepStrictEqual(
    [...COLOR_META_WORDS].sort(),
    ['腮红', '肤色', '肉色'].sort(),
    '元词名单变了：`colorMetrics.js` 的 §2e 注释与 依据/21 §二·2 的现量都要跟着改',
  )
  const metaAliases = aliases.filter((a) => COLOR_META_WORDS.includes(a))
  assert.deepStrictEqual(
    metaAliases.sort(),
    ['腮红', '肤色', '肉色'].sort(),
    '元词三条别名应当都在同义词表里（名单与表必须一起改，别只改一边）',
  )
  // (a) 不许与词表撞键：撞了就有两个真身，归一结果取决于枚举顺序
  assert.deepStrictEqual(
    aliases.filter((a) => a in COLOR_NAME_HEX),
    [],
    '有别名同时也是词表键',
  )
  // (b) 指向的规范键必须在表里且取得到 Lab
  const badTarget = aliases.filter((a) => {
    const t = COLOR_SYNONYMS[a]
    return !(t in COLOR_NAME_HEX) || !hexToLab(COLOR_NAME_HEX[t])
  })
  assert.deepStrictEqual(badTarget, [], '有别名指向不存在的规范键')
  // (c) 不许写"机械规则本来就能认出"的死别名（去/补"色"两步够得着的，同义词条目纯属多余）
  const mechanical = (s) => {
    if (s in COLOR_NAME_HEX) return s
    if (s.length > 1 && s.endsWith('色') && s.slice(0, -1) in COLOR_NAME_HEX) return s.slice(0, -1)
    if (`${s}色` in COLOR_NAME_HEX) return `${s}色`
    return null
  }
  assert.deepStrictEqual(
    aliases.filter((a) => mechanical(a) !== null),
    [],
    '有别名走前三步就能认出，这条同义词是死代码',
  )
  // 完整链必须落到目标规范键
  for (const a of aliases) {
    if (COLOR_META_WORDS.includes(a)) {
      assert.strictEqual(normalizeColorName(a), null, `${a} 是元词，不许归成 ${COLOR_SYNONYMS[a]}`)
      assert.strictEqual(resolveColor(a), null, `${a} 是元词，不许取到 hex`)
      continue
    }
    assert.strictEqual(normalizeColorName(a), COLOR_SYNONYMS[a], `${a} 没归到 ${COLOR_SYNONYMS[a]}`)
    assert.strictEqual(resolveColor(a), COLOR_NAME_HEX[COLOR_SYNONYMS[a]], `${a} 取到的 hex 不对`)
  }
})

test('禁并清单 L3 反向断言：口语混用但色差大到能改闸门档位的，谁也不许并成同一个键', () => {
  assert.ok(COLOR_ANTI_SYNONYMS.length >= 6, '禁并清单条数少于现量 7 对，检查是不是被误删')
  let floor = Infinity
  for (const p of COLOR_ANTI_SYNONYMS) {
    const ha = COLOR_NAME_HEX[p.a]
    const hb = COLOR_NAME_HEX[p.b]
    assert.ok(ha && hb, `${p.a}/${p.b} 有一个不在词表里，这条断言失去意义`)
    const dE = deltaE00(hexToLab(ha), hexToLab(hb))
    if (p.same) {
      // 藏青/藏蓝本来就是同一个 hex：这条是"允许同义"的正例，断言放过它
      assert.strictEqual(ha, hb, `${p.a}/${p.b} 标了 same 但色值不同`)
      assert.strictEqual(dE, 0)
      continue
    }
    assert.notStrictEqual(ha, hb, `${p.a}/${p.b} 不许并成同一个色值`)
    // 条线取 4 而不是 5：现量这批里最小的是 珊瑚粉↔珊瑚橘 4.07（synonym-check.cjs）
    assert.ok(dE >= 4, `${p.a}↔${p.b} ΔE00=${dE}，低于 4 说明这一对其实可以并，要重裁`)
    if (dE < floor) floor = dE
    assert.ok(Math.abs(dE - p.dE) < 0.15, `${p.a}↔${p.b} 注释写 ${p.dE}，实测 ${dE.toFixed(2)}`)
  }
  assert.ok(Math.abs(floor - 4.07) < 0.01, `ΔE00 最小值应仍是现量 4.07，实际 ${floor}`)
  // 产品指令里那句"驼色=卡其色=棕色"没有采纳，这三条互不归一就是它的守卫
  assert.strictEqual(normalizeColorName('驼色'), '驼色')
  assert.strictEqual(normalizeColorName('卡其'), '卡其')
  assert.strictEqual(normalizeColorName('棕色'), '棕色')
  assert.notStrictEqual(
    COLOR_NAME_HEX['驼色'],
    COLOR_NAME_HEX['棕色'],
    '驼色并到棕色＝把明度差 24 的两个色当成一个',
  )
})

test('色系软标签 L4：232 键全有族、覆写表逐条生效、无彩色侧与 C<5 现量口径一致', () => {
  const keys = Object.keys(COLOR_NAME_HEX)
  const noFamily = keys.filter((k) => !colorFamily(k))
  assert.deepStrictEqual(noFamily, [], '有键分不出色系（族字／覆写／HSL 兜底三道都没接住）')
  assert.strictEqual(
    keys.filter((k) => colorFamily(k) === '其他').length,
    0,
    '现量：232 键里 0 个落进"其他"，出现即说明 HSL 兜底带被改窄了',
  )
  // 覆写表：这几条是"族字会给错答案"的实测样本（卡其的"其"、藏青的"青"、牛油果的"果"…）
  const expectOverride = { 藏青: '蓝', 卡其: '棕', 牛油果: '绿', 勃艮第: '红', 绿松石: '青' }
  for (const [k, f] of Object.entries(expectOverride)) {
    assert.strictEqual(COLOR_FAMILY_OVERRIDES[k], f, `${k} 不在覆写表里，L4 判族会跟着变`)
    assert.strictEqual(colorFamily(k), f, `${k} 应判 ${f}`)
  }
  // 无彩色：C<ACHROMATIC_C 的键（10-20 现量 36 个）必须全部判成无彩色，否则"剔色相"和"分族"两套账打架
  const achro = keys.filter((k) => hexToLab(COLOR_NAME_HEX[k]).C < ACHROMATIC_C)
  assert.strictEqual(
    achro.length,
    36,
    `C<${ACHROMATIC_C} 的键数现量 36，变了要同步模块注释与 依据/14`,
  )
  assert.deepStrictEqual(
    achro.filter((k) => colorFamily(k) !== '无彩色'),
    [],
    '有无彩色键被判出了色相族',
  )
  // L4 只是标签，不许进分：色系相同的两件衣服，ΔE00 该是多少还是多少
  assert.ok(deltaE00(hexToLab(COLOR_NAME_HEX['藏蓝']), hexToLab(COLOR_NAME_HEX['宝蓝'])) > 10)
})

test('明度族 L5：档边界按语义切点（L≤35 深／L≥65 浅），且 lightnessBand 回的是档名不是原词', () => {
  assert.strictEqual(bandOfLab({ L: 35 }), '深')
  assert.strictEqual(bandOfLab({ L: 35.0001 }), '中')
  assert.strictEqual(bandOfLab({ L: 64.999 }), '中')
  assert.strictEqual(bandOfLab({ L: 65 }), '浅')
  assert.strictEqual(bandOfLab({ L: NaN }), null)
  assert.strictEqual(bandOfLab(null), null)
  // 现量分布（synonym-check.cjs）：深 33／中 88／浅 111 —— 偏浅 3.4 倍，"男深"能挑的色名少
  const dist = { 深: 0, 中: 0, 浅: 0 }
  for (const k of Object.keys(COLOR_NAME_HEX)) dist[bandOfLab(hexToLab(COLOR_NAME_HEX[k]))]++
  assert.strictEqual(dist['深'], 33, `深色档现量 33 键，实际 ${dist['深']}`)
  assert.strictEqual(dist['浅'], 111, `浅色档现量 111 键，实际 ${dist['浅']}`)
  // 10-20 修口回归：这一支改前回的是原词（'深色'），调用方索引 LIGHTNESS_BANDS 会取到 undefined
  assert.strictEqual(lightnessBand('深色上衣'), '深')
  assert.strictEqual(lightnessBand('深色系'), '深', '同位置撞车要取最长词，且回档名')
  assert.strictEqual(lightnessBand('亮色上衣'), '浅')
  assert.strictEqual(lightnessBand('浅色'), '浅')
  assert.strictEqual(lightnessBand('驼色大衣'), '中', '取到具体色时按 Lab 的 L 算，不看文案词')
  assert.strictEqual(lightnessBand('今天天气不错'), null)
  // 每张档都得有 brightenHint，否则 L5 分支拼不出分
  for (const b of ['深', '中', '浅']) {
    assert.ok(Number.isFinite(LIGHTNESS_BANDS[b].brightenHint), `${b} 档缺 brightenHint`)
  }
  assert.strictEqual(Object.keys(LIGHTNESS_TOKENS).length, 14, '明度词条数＝14，见模块 §2d')
  assert.deepStrictEqual(
    [...new Set(Object.values(LIGHTNESS_TOKENS))].sort(),
    ['中', '浅', '深'],
    '有明度词条指向了不存在的档',
  )
})

// ============================================================
// 12b. 元词黑名单（第十三阶段·第一步 §二·2，规范 docs/依据/21）
//      「肤色／肉色／腮红」指人或脸上那件东西，⛔ 永远不许被当成衣服的颜色供数（`21` §一·5）。
//      现量尺子＝盘外副本 `phase13-20261021/probe-metawords.cjs`＋`probe-metaslots.cjs`：
//      「肤色」全库造出 9 个 hex／9 行、「腮红」20 个／19 行、「肉色」0 行，
//      其中走同义词库直接命中的假色值**只有 id=302 那一条**。
// ============================================================
test('元词「肤色/肉色/腮红」不再被认成衣服的颜色（§二·2）', () => {
  // ① 整段就是元词（带不带尾缀「色」都算）⇒ 认不出，⛔ 不许折成 奶杏色
  for (const w of ['肤色', '肤色的', '肉色', '腮红', '腮红色']) {
    assert.strictEqual(normalizeColorName(w), null, `${w} 是元词，不该归出规范键`)
    assert.strictEqual(resolveColor(w), null, `${w} 是元词，不该取到 hex`)
    assert.deepStrictEqual(extractColors(w), [], `${w} 是元词，抽色该回空数组`)
  }
  // ② 库里那条逐字复现（id=302，改前它回 [奶杏色 #EFD9BC]）
  assert.deepStrictEqual(extractColors('发型改造需结合脸型、肤色、身高综合判断'), [])
  // ③ 元词**自己肚子里**的单字键也不许漏出来（打点成同长度占位就是为了这条）
  assert.deepStrictEqual(extractColors('淡腮红'), [], '「腮红」不能靠肚子上的 红 出色')
  assert.strictEqual(resolveColor('橘朵腮红'), null, '商品名里的「腮红」不是色名')
  // ④ 以元词开头的**真色名**必须原样保住：腮红粉 #E0A3AF 是表内键，不是元词
  assert.strictEqual(normalizeColorName('腮红粉'), '腮红粉')
  assert.strictEqual(resolveColor('腮红粉'), COLOR_NAME_HEX['腮红粉'])
  assert.strictEqual(
    resolveColor('自然杏色腮红轻扫苹果肌'),
    COLOR_NAME_HEX['杏色'],
    '挡元词不许顺手把句子里真写了的 杏色 也挡掉',
  )
  // ⑤ "谁在句子里出现得最早"这把尺子不能因为打点而移位
  assert.strictEqual(normalizeColorName('雾霾蓝、肤色'), '雾霾蓝')
  assert.strictEqual(
    normalizeColorName('肤色与雾霾蓝'),
    '雾霾蓝',
    '元词打点后句内扫描照样取到后面那个色',
  )
  // ⑥ ⚠️ 钉住**本轮做不到**的那一条（已列进 `21` §七 待裁：单字键长在多字词里要词边界判断）：
  // 元词挡掉了，它旁边的「粉调／白皙」照旧能被句内扫描取到 ⇒ 这不是认可，是留痕。
  assert.strictEqual(resolveColor('肤色的粉调'), COLOR_NAME_HEX['粉'])
  assert.strictEqual(resolveColor('白皙肤色'), COLOR_NAME_HEX['白'])
})

test('句内扫描纳入同义词别名＋工艺词降为弱色（§二·1）', () => {
  // ① 改前：句内扫描只翻 `COLOR_NAME_HEX` 的 232 个键，别名表那 42 个词在**整段就是它**时才起作用。
  //    所以 '裸色尖头高跟鞋' 改前回 null（'裸'/'色' 都不是键），改后必须靠别名扫出 奶杏色。
  const nude = extractColors('裸色尖头高跟鞋')
  assert.strictEqual(nude.length, 1, '句内别名扫描只认最早最长那一个，不许把 杏 也另算一份')
  assert.strictEqual(nude[0].label, '奶杏色')
  assert.strictEqual(nude[0].hex, COLOR_NAME_HEX['奶杏色'])
  assert.strictEqual(
    nude[0].basis,
    'synonym-in-text',
    '出处必须记成"句里扫到的别名"，不是"用户写的词"',
  )
  assert.strictEqual(nude[0].via, '裸色')
  assert.strictEqual(nude[0].is_specific, true, '裸色是个颜色，工艺词那条弱色规则不该连坐')
  // 整段就是别名那条来路不变（basis='synonym'），两种来路在前台是两句话
  assert.strictEqual(extractColors('裸色')[0].basis, 'synonym')

  // ② 工艺词＝面料处理方式，不是颜色：hex 照样取到（审计要看它凭什么认的），但标成弱色
  const craft = ['牛仔短裤', '迷彩工装裤']
  for (const c of craft) {
    const got = extractColors(c)
    assert.strictEqual(got.length, 1, `${c} 该扫到那一个工艺别名`)
    assert.strictEqual(got[0].craft_word, true, `${c} 没被认成工艺词`)
    assert.strictEqual(got[0].is_specific, false, `${c} 是弱色，⛔ 不进呼应、不进贴合分`)
    assert.ok(/^#[0-9A-F]{6}$/.test(got[0].hex), `${c} 弱色也要留 hex 供审计`)
  }
  // ③ 缺测不出分：整句只有工艺词 ⇒ 色彩这一维回 null，⛔ 不许拿 牛仔蓝 的 hex 喂 ΔE00
  assert.strictEqual(colorFit('白皙', '牛仔短裤', null), null)
  assert.strictEqual(colorFit('小麦色', '迷彩工装裤', null), null)
  // 只有明度词＋工艺词 ⇒ 走 L5 明度档（这条方向分是文案里真写了"深色"给的，不是牛仔给的）
  const banded = colorFit('白皙', '深色牛仔短裤', null)
  assert.ok(banded && banded.basis === 'lightness-band', '深色这档照样要出，score 不许变 null')
  assert.strictEqual(banded.top_hex, null)

  // ④ 工艺词不许压倒句子里真写了的颜色（取最早出现的那个：'蓝色牛仔外套' 蓝 在前）
  const both = extractColors('蓝色牛仔外套')
  assert.strictEqual(both[0].label, '蓝')
  assert.strictEqual(both[0].craft_word, false, '句子里有具体色 ⇒ 这条不是靠工艺词认出来的')
  assert.strictEqual(both[0].is_specific, true)
  // 表内真键 '水洗蓝' 比别名 '水洗' 长且同位置 ⇒ 最长优先，不许被误判成工艺词
  const washed = extractColors('水洗蓝牛仔裤')
  assert.strictEqual(washed[0].label, '水洗蓝')
  assert.strictEqual(washed[0].craft_word, false)

  // ⑤ 边界（`21` §十二 记这条与 §八·2 字面不同）：用户在衣橱里**手打**'牛仔'是在说颜色，
  //    走 basis='synonym' 那条来路，照常出分。只有"从自由文案里扫出来"的才降弱色。
  const handTyped = colorFit('白皙', '牛仔', null)
  assert.ok(handTyped && handTyped.top_hex === COLOR_NAME_HEX['牛仔蓝'], '手打的别名照旧认成具体色')
  assert.strictEqual(extractColors('牛仔')[0].is_specific, true)

  // ⑥ 两张名单的不变量：句内扫的别名⛔ 不许是规范键（否则与第 1 步重复），且每条都指向真键；
  //    工艺词必须真在扫描名单里（名单里写了扫不到的词＝这条守卫是死代码）
  assert.ok(
    COLOR_ALIAS_SCAN_TOKENS.length >= 40,
    `别名扫描表只剩 ${COLOR_ALIAS_SCAN_TOKENS.length} 条`,
  )
  assert.deepStrictEqual(
    COLOR_ALIAS_SCAN_TOKENS.filter((a) => a in COLOR_NAME_HEX),
    [],
    '有别名本身是规范键',
  )
  assert.deepStrictEqual(
    COLOR_ALIAS_SCAN_TOKENS.filter((a) => !(COLOR_SYNONYMS[a] in COLOR_NAME_HEX)),
    [],
    '有别名指向不存在的键',
  )
  assert.deepStrictEqual(
    COLOR_CRAFT_WORDS.filter((w) => !COLOR_ALIAS_SCAN_TOKENS.includes(w)),
    [],
    '工艺词表里有句内扫描根本碰不到的词',
  )
  // ⑦ 元词那三个仍在别名表里（第 ② 步靠同义词归一），但**扫不到**：打点在第 5 步之前
  for (const w of COLOR_META_WORDS) assert.ok(COLOR_ALIAS_SCAN_TOKENS.includes(w))
  assert.strictEqual(normalizeColorName('肤色与雾霾蓝'), '雾霾蓝', '元词挡住了，句子里的真色照样取')
})

test('抽色 extractColors：一条文案多个色全列出来，只有明度词的那条打 is_specific=false', () => {
  const multi = extractColors('雾霾蓝＋白色针织')
  assert.strictEqual(multi.length, 2, '两个并列色都该被认出来')
  assert.deepStrictEqual(
    multi.map((x) => x.label),
    ['雾霾蓝', '白色'],
  )
  assert.ok(multi.every((x) => x.is_specific && /^#[0-9A-F]{6}$/.test(x.hex)))
  assert.deepStrictEqual(
    multi.map((x) => x.family),
    ['蓝', '无彩色'],
  )
  // 重复色按 hex 去重（同一件写了两次不给两次面积）
  assert.strictEqual(extractColors('白色 + 白色').length, 1)
  // 分隔符形态：+ ＋ 、 , ， ; ； / ／ 空格 和 与 或
  assert.ok(extractColors('上白、下黑').length >= 2, '顿号没切开')
  assert.ok(extractColors('深蓝/藏青/牛仔蓝').length >= 2, '斜杠没切开')
  // 只有明度词：认得档，但⛔ 不许给它编 hex
  const band = extractColors('深色上衣显气场')
  assert.strictEqual(band.length, 1)
  assert.strictEqual(band[0].is_specific, false)
  assert.strictEqual(band[0].hex, null)
  assert.strictEqual(band[0].band, '深')
  assert.strictEqual(band[0].basis, 'lightness-band')
  // 认不出就回空数组，由调用方决定"这一条没有色彩维"
  assert.deepStrictEqual(extractColors(''), [])
  assert.deepStrictEqual(extractColors(null), [])
  assert.deepStrictEqual(extractColors('今天天气不错'), [])
  // 已知短板（现量，非回归）：'上白下黑' 这种"上下式"没有分隔符，只认得句内最先的 白
  assert.deepStrictEqual(
    extractColors('上白下黑').map((x) => x.label),
    ['白'],
  )
})

test('colorFit L5 分支：只有明度词时给得出方向分、但不伪造 ΔE00；{L,a,b} 对象入口本轮真的通了', () => {
  const deep = colorFit('白皙', '深色上衣')
  const light = colorFit('白皙', '浅色上衣')
  assert.ok(deep && light, '明度档文案不该返回 null（Zhang 2025 那条明度方向本来就不需要具体色相）')
  assert.strictEqual(deep.basis, 'lightness-band')
  assert.strictEqual(deep.deltaE00, null, '没有两个 Lab 可差，不许伪造 ΔE00')
  assert.strictEqual(deep.top_hex, null)
  assert.strictEqual(deep.fusion_gate, 1, '闸门没有输入可比，按不动分记账')
  assert.strictEqual(deep.hue_applies, false, '色相轴这一维是"没信息"，不是"对比为 0"')
  assert.strictEqual(deep.hueContrast, 0.5, '无信息按最小值记账')
  assert.ok(deep.score > light.score, `深色 ${deep.score} 应比浅色 ${light.score} 更"显白"`)
  // 具体色那条路径不受影响：basis 区分得开
  const spec = colorFit('白皙', '藏蓝')
  assert.strictEqual(spec.basis, 'table-key')
  assert.ok(Number.isFinite(spec.deltaE00))
  // {L,a,b} 入口：改前注释说支持、实际 String() 成 '[object Object]' 直接 null（本轮修）
  const asLab = colorFit('白皙', { L: 60, a: 10, b: 20 })
  assert.ok(asLab, '{L,a,b} 对象应当能算分')
  assert.strictEqual(asLab.basis, 'lab-object')
  assert.strictEqual(asLab.top_hex, null, '对象入口没有 hex，不许倒推一个')
  // 共享常量不许被写脏：肤色锚点表本来没有 C 字段
  const anchor = SKIN_TONE_ANCHORS['白皙']
  assert.ok(!('C' in anchor), 'colorFit 往 SKIN_TONE_ANCHORS 里写了 C，会污染后续每次取色')
})

// ============================================================
// 28. 认不出色 ⇒ 返回 null，⛔ 不许抛（10-20 第六阶段·第一步补的**契约回归测试**）
//   钉的是规范 `docs/依据/14` §三/§五那条"缺色不出分"：''／null／'乱写的词'／'#ZZZ123'／
//   全角 hex／数字／对象／数组／{L:NaN} 这类入参，colorFit 一律回 null，调用方 `if (fit)` 跳过这一维。
//   ⚠️ 诚实记一句：这条**不是修缺陷**——现量证明改前也回 null（`_resolveDetailed` 认不出时回的是
//   `none` 那个对象，不是 null，所以不会抛）。我一度判成"模块抛 TypeError 会把推荐炸成 500"，
//   那把抛错其实是我自己的探针在 null 返回值上读 `.basis` 读出来的，账在 `14` §9.7。
// ============================================================
test('认不出的入参一律回 null，不抛（含全角 hex）', () => {
  const bad = [
    '',
    ' ',
    null,
    undefined,
    '乱写的词',
    '#ZZZ123',
    'rgb(1,2,3)',
    '#１Ｆ３Ａ５Ｆ',
    '１Ｆ３Ａ５Ｆ',
    123,
    {},
    [],
    { L: NaN, a: 0, b: 0 },
  ]
  for (const v of bad) {
    let r
    assert.doesNotThrow(
      () => {
        r = colorFit('小麦色', v)
      },
      `colorFit 遇到认不出的入参抛了：${JSON.stringify(v)}`,
    )
    assert.strictEqual(r, null, `应回 null：${JSON.stringify(v)}`)
  }
  // 半角同一条 hex 必须照常出分（证明这不是"整条路径都断了"）
  const ok = colorFit('小麦色', '#1F3A5F')
  assert.ok(ok, '#1F3A5F 应当出分')
  assert.strictEqual(ok.basis, 'hex')
  // 只有明度词的入参仍走 L5，不受这条闸门影响
  const band = colorFit('小麦色', '深色')
  assert.ok(band, '"深色"应走明度档口径')
  assert.strictEqual(band.basis, 'lightness-band')
})

// ============================================================
// 第十阶段·第一步（10-21）：肤色色相角 → 冷暖档（docs/依据/18 §2.2）
// 这两个常数（52.86／64.02）前端 app/src/lib/skinSample.ts 里有一份**预览用副本**，
// 那条副本只决定"用户点确认前看到什么字"，权威口径在这里 ⇒ 改这两个数必须
// 同时改前端那份与本文件下面这两条断言，18 §六 第 4 条登记的就是这笔债。
// ============================================================

test('skinUndertoneFromHue: 华裔 P25/P75 两个切点各自钉住', () => {
  assert.strictEqual(SKIN_HUE.cold, 52.86)
  assert.strictEqual(SKIN_HUE.warm, 64.02)
  assert.strictEqual(SKIN_HUE.min, 36.36)
  assert.strictEqual(SKIN_HUE.max, 78.05)
  assert.strictEqual(skinUndertoneFromHue(49.76), '冷皮') // 冷皮锚点自己的 h
  assert.strictEqual(skinUndertoneFromHue(52.86), '冷皮') // 恰在 P25 ⇒ 含边界
  assert.strictEqual(skinUndertoneFromHue(60.26), '自然') // 白皙锚点 60.26
  assert.strictEqual(skinUndertoneFromHue(64.02), '暖皮') // 恰在 P75 ⇒ 含边界
  assert.strictEqual(skinUndertoneFromHue(74.36), '暖皮') // 偏黄锚点 74.36（在 P95 之外、闸内）
})

test('skinUndertoneFromHue: 过不了 h 闸或非有限数一律回 null（缺测不出档）', () => {
  const bad = [NaN, Infinity, -Infinity, 'x', null, undefined, {}, [], '', 0, 35.9, 78.1, 120, 360]
  for (const v of bad) {
    assert.strictEqual(
      skinUndertoneFromHue(v),
      null,
      `应回 null 却出了档名：${JSON.stringify(v) ?? String(v)}`,
    )
  }
  // 边界另一侧：闸的上下沿本身必须认（min/max 是"含"的，收窄一档就会把站内已有锚点判成皮肤外）
  assert.ok(skinUndertoneFromHue(SKIN_HUE.min))
  assert.ok(skinUndertoneFromHue(SKIN_HUE.max))
})

test('skinUndertoneFromHue: 8 个手拍锚点按自己的 h° 过线必须自洽（1 冷／3 自然／4 暖）', () => {
  const got = { 冷皮: [], 自然: [], 暖皮: [] }
  for (const [name, v] of Object.entries(SKIN_TONE_ANCHORS)) {
    const h = (Math.atan2(v.b, v.a) * 180) / Math.PI
    const tone = skinUndertoneFromHue(h)
    assert.ok(tone, `${name} 锚点 h=${h.toFixed(2)} 竟然过不了闸`)
    got[tone].push(name)
  }
  assert.deepStrictEqual(got['冷皮'], ['冷皮'])
  assert.deepStrictEqual(got['自然'].sort(), ['自然', '自然白', '白皙'].sort())
  assert.deepStrictEqual(got['暖皮'].sort(), ['偏黄', '小麦色', '暖皮', '古铜色'].sort())
})

// ============================================================
// 10-21 第十阶段·第一步：合成 Lab 的**唯一实现处**（18 §2.5）
// 改前引擎的 `_skinForColor` 与上衣处方的 `colorSpec` 各拼一份算术，实测两边给的数一样、
// 但 `colorSpec` 那份**根本不看 `skin_hue`**（盘外 `api-diff.cjs` case A/B 的
// `top_spec.skin_lab` 逐字相同）。现在两边 require 同一个函数，下面第一条就是那条口径的执法者。
// ============================================================

test('synthesizeSkinLab: 照片只贡献角度 ⇒ L 与 C 逐字等于锚点、h 等于传进来的角', () => {
  const before = JSON.stringify(SKIN_TONE_ANCHORS)
  const anchor = SKIN_TONE_ANCHORS['白皙']
  const C = Math.hypot(anchor.a, anchor.b)
  const got = synthesizeSkinLab('白皙', 70)
  assert.ok(got, '白皙 + 70° 竟然合成不出 Lab')
  assert.strictEqual(got.lab.L, anchor.L, '明度被照片改掉了＝让曝光冒充肤色')
  assert.ok(Math.abs(got.lab.C - C) < 1e-9, `彩度没按锚点算：${got.lab.C} vs ${C}`)
  assert.ok(
    Math.abs(Math.hypot(got.lab.a, got.lab.b) - C) < 1e-9,
    'a/b 换算时彩度漂了＝不是"只换角度"',
  )
  assert.ok(
    Math.abs((Math.atan2(got.lab.b, got.lab.a) * 180) / Math.PI - 70) < 1e-9,
    'h 不是传进来的角',
  )
  assert.strictEqual(got.undertone, '暖皮')
  // ⛔ SKIN_TONE_ANCHORS 是模块级共享常量，写一次污染之后每一次取色
  assert.strictEqual(JSON.stringify(SKIN_TONE_ANCHORS), before, '锚点表被写改了')
})

test('synthesizeSkinLab: 档名认不出或角度过不了闸一律 null（缺测不编一个肤色）', () => {
  assert.strictEqual(synthesizeSkinLab(null, 60), null)
  assert.strictEqual(synthesizeSkinLab(undefined, 60), null)
  assert.strictEqual(synthesizeSkinLab('没这个档的口音', 60), null)
  for (const v of ['x', {}, [], null, undefined, NaN, Infinity, 36.35, 78.06, 90, 0, '30']) {
    assert.strictEqual(synthesizeSkinLab('白皙', v), null, `角度 ${String(v)} 竟然出了 Lab`)
  }
  // 闸的两侧边界含端点都要认（与 skinUndertoneFromHue 同一条闸，⛔ 不许这里再收窄）
  assert.ok(synthesizeSkinLab('白皙', SKIN_HUE.min))
  assert.ok(synthesizeSkinLab('白皙', SKIN_HUE.max))
})
