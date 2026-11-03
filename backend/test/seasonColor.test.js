const assert = require('node:assert')
const { test } = require('node:test')
const { getSeasonType, SEASONS, SOFT_SEASONS } = require('../services/seasonColor')

// —— 四季型映射（暖+亮=春，冷+亮=夏，暖+深=秋，冷+深=冬）——

test('春型：暖色相 + 高明度', () => {
  const r = getSeasonType({ skin_hue: 70, skin_lightness: 80 })
  assert.strictEqual(r.season, 'spring')
  assert.strictEqual(r.season_name, '春型')
  assert.strictEqual(r.warmth, 'warm')
  assert.strictEqual(r.depth, 'light')
})

test('夏型：冷色相 + 高明度', () => {
  const r = getSeasonType({ skin_hue: 45, skin_lightness: 70 })
  assert.strictEqual(r.season, 'summer')
  assert.strictEqual(r.season_name, '夏型')
})

test('秋型：暖色相 + 低明度', () => {
  const r = getSeasonType({ skin_hue: 68, skin_lightness: 30 })
  assert.strictEqual(r.season, 'autumn')
  assert.strictEqual(r.season_name, '秋型')
})

test('冬型：冷色相 + 低明度', () => {
  const r = getSeasonType({ skin_hue: 48, skin_lightness: 20 })
  assert.strictEqual(r.season, 'winter')
  assert.strictEqual(r.season_name, '冬型')
})

// —— 档名兜底（没有 hue/lightness 时）——

test('档名兜底：暖皮 + 白皙 ⇒ 春型', () => {
  const r = getSeasonType({ skin_tone: '暖皮', skin_tone_detail: '白皙' })
  assert.strictEqual(r.season, 'spring')
  assert.strictEqual(r.confidence < 0.9, true) // 不是双实测，置信度低
})

test('档名兜底：冷皮 + 小麦色 ⇒ 冬型', () => {
  const r = getSeasonType({ skin_tone: '冷皮', skin_tone_detail: '小麦色' })
  assert.strictEqual(r.season, 'winter')
})

// —— 中性冷暖（色相角落在 52.86~64.02 之间）⇒ 柔季型 ——

test('柔春型：中性偏暖 + 高明度', () => {
  const r = getSeasonType({ skin_hue: 60, skin_lightness: 70 })
  assert.ok(r.season_name.startsWith('柔'), r.season_name)
  assert.strictEqual(r.depth, 'light')
})

test('柔冬型：中性偏冷 + 低明度', () => {
  const r = getSeasonType({ skin_hue: 55, skin_lightness: 25 })
  assert.ok(r.season_name.startsWith('柔'), r.season_name)
  assert.strictEqual(r.depth, 'deep')
})

// —— 输入不完整 ——

test('缺冷暖轴 ⇒ 返回 null', () => {
  assert.strictEqual(getSeasonType({ skin_lightness: 70 }), null)
})

test('缺深浅轴 ⇒ 返回 null', () => {
  assert.strictEqual(getSeasonType({ skin_hue: 70 }), null)
})

test('两个轴都没有 ⇒ null', () => {
  assert.strictEqual(getSeasonType({}), null)
  assert.strictEqual(getSeasonType(null), null)
})

// —— 输出契约 ——

test('输出契约：必有 season/season_name/traits/palette/avoid/confidence/basis', () => {
  const r = getSeasonType({ skin_hue: 70, skin_lightness: 80 })
  for (const k of [
    'season',
    'season_name',
    'warmth',
    'depth',
    'traits',
    'palette',
    'avoid',
    'confidence',
    'basis',
  ]) {
    assert.ok(k in r, k)
  }
  assert.ok(Array.isArray(r.palette) && r.palette.length > 0)
  assert.ok(Array.isArray(r.avoid) && r.avoid.length > 0)
  // 色卡每项是 { name, hex }
  for (const c of [...r.palette, ...r.avoid]) {
    assert.ok(typeof c.name === 'string')
    assert.ok(c.hex === null || typeof c.hex === 'string')
  }
  assert.ok(typeof r.confidence === 'number' && r.confidence > 0 && r.confidence <= 1)
})

test('色卡里的颜色名必须在系统色表中存在', () => {
  const { COLOR_NAME_HEX } = require('../services/colorMetrics')
  for (const s of [
    SEASONS.spring,
    SEASONS.summer,
    SEASONS.autumn,
    SEASONS.winter,
    SOFT_SEASONS.spring,
    SOFT_SEASONS.summer,
    SOFT_SEASONS.autumn,
    SOFT_SEASONS.winter,
  ]) {
    for (const c of [...s.palette, ...s.avoid]) {
      assert.ok(c in COLOR_NAME_HEX, `${s.name} 的色卡颜色「${c}」不在 COLOR_NAME_HEX 中`)
    }
  }
})

// —— 置信度 ——

test('置信度：双实测 > 单实测 > 纯档名', () => {
  const both = getSeasonType({ skin_hue: 70, skin_lightness: 80 }).confidence
  const one = getSeasonType({ skin_hue: 70, skin_tone_detail: '白皙' }).confidence
  const none = getSeasonType({ skin_tone: '暖皮', skin_tone_detail: '白皙' }).confidence
  assert.ok(both > one && one > none, `${both} > ${one} > ${none}`)
})
