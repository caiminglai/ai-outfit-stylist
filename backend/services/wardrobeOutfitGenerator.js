/**
 * 衣橱搭配生成器（借鉴 AI衣橱：用你已有的衣服搭，不是推你去买）
 * ============================================================
 * 从用户衣橱已有衣物中，按品类组合出完整搭配方案（上衣+下装，或连衣裙，+可选鞋/包），
 * 按色彩协调度与场合匹配度排序，返回最搭的 N 套。
 *
 * 打分维度：
 *   1. 色彩协调（60%）：同色系/邻近色 > 互补色 > 撞色；中性色百搭不扣分
 *   2. 场合匹配（40%）：物品的 occasion_tags 与目标场合交集越大分越高
 *
 * ⚠️ 档位诚实：
 *  - 这是**已有衣物的组合建议**，不是"最适合你的搭配"——体型适配仍由推荐引擎的
 *    topFitBody 负责，这里只解决"我有这些衣服，怎么搭"。
 *  - 色彩协调用色相差近似，不是严格的色彩学配色理论（C 档）。
 */

const { COLOR_NAME_HEX } = require('./colorMetrics')
const { hitsWord } = require('./fullLookAdvisor')

// 品类分组词表（与 categoryBuckets.js 同口径）
const BUCKET_WORDS = {
  top: ['上衣', 't恤', '衬衫', '针织', '卫衣', '毛衣', '背心', '吊带'],
  bottom: ['裤子', '裤', '裙', '半身裙', '牛仔裤', '短裤'],
  dress: ['连衣裙', '连体裤', '裙装'],
  outer: ['外套', '大衣', '风衣', '夹克', '开衫', '西装'],
  shoes: ['鞋', '靴', '凉鞋', '拖鞋', '运动鞋'],
  bag: ['包', '背包', '手提包', '斜挎包'],
}

const NEUTRAL_COLORS = ['黑', '白', '灰', '米', '驼', '杏', '咖', '棕', '银']

/** 从物品的 color 或 name 中提取 hex */
function getHex(item) {
  const color = String(item.color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  // 颜色名查色表
  if (COLOR_NAME_HEX[color]) return COLOR_NAME_HEX[color]
  // 从 name 里找色名
  const name = String(item.name || '')
  for (const [nameKey, hex] of Object.entries(COLOR_NAME_HEX)) {
    if (name.includes(nameKey)) return hex
  }
  return null
}

/** 判断是否中性色 */
function isNeutral(hex) {
  if (!hex) return true // 没颜色当中性（不扣分配色分）
  for (const word of NEUTRAL_COLORS) {
    for (const [name, h] of Object.entries(COLOR_NAME_HEX)) {
      if (h === hex && name.includes(word)) return true
    }
  }
  return false
}

/** hex → HSL，返回 {h, s, l}（h 是 0~360） */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      break
    case g:
      h = ((b - r) / d + 2) / 6
      break
    case b:
      h = ((r - g) / d + 4) / 6
      break
  }
  return { h: h * 360, s, l }
}

/**
 * 两件衣物的色彩协调分（0~100）
 * - 同色系（色相差 ≤30°）：90
 * - 邻近色（30~60°）：75
 * - 互补色（150~180°）：70
 * - 其他：50
 * - 任一件是中性色：85（百搭）
 */
function colorHarmonyScore(hex1, hex2) {
  if (isNeutral(hex1) || isNeutral(hex2)) return 85
  if (!hex1 || !hex2) return 60
  const h1 = hexToHsl(hex1).h
  const h2 = hexToHsl(hex2).h
  const diff = Math.abs(h1 - h2)
  const angle = Math.min(diff, 360 - diff)
  if (angle <= 30) return 90
  if (angle <= 60) return 75
  if (angle >= 150) return 70
  return 50
}

/** 把衣橱物品按品类分组 */
function bucketItems(items) {
  const buckets = { top: [], bottom: [], dress: [], outer: [], shoes: [], bag: [] }
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue
    const cat = String(item.category || item.sub_category || '')
    for (const [bucket, words] of Object.entries(BUCKET_WORDS)) {
      if (words.some((w) => cat.toLowerCase().includes(w.toLowerCase())) || hitsWord(words, cat)) {
        buckets[bucket].push(item)
        break
      }
    }
  }
  return buckets
}

/** 场合匹配分（0~100）：物品标签与目标场合的交集比例 */
function occasionScore(item, occasion) {
  if (!occasion) return 50 // 没指定场合，中性分
  const tags = Array.isArray(item.occasion_tags) ? item.occasion_tags : []
  if (tags.length === 0) return 50 // 没标场合，不扣分
  const hit = tags.some((t) => String(t).includes(String(occasion)))
  return hit ? 90 : 30
}

/**
 * 从衣橱生成搭配方案
 * @param {{wardrobe_items:Array, occasion?:string, limit?:number}} input
 * @returns {Array<{items:Array, score:number, color_score:number, occasion_score:number, reason:string}>}
 */
function generateWardrobeOutfits(input) {
  const { wardrobe_items, occasion, limit = 5 } = input || {}
  if (!Array.isArray(wardrobe_items) || wardrobe_items.length === 0) return []

  const buckets = bucketItems(wardrobe_items)
  const outfits = []

  // 组合1：上衣 + 下装
  for (const top of buckets.top) {
    for (const bottom of buckets.bottom) {
      const topHex = getHex(top)
      const bottomHex = getHex(bottom)
      const cScore = colorHarmonyScore(topHex, bottomHex)
      const oScore = (occasionScore(top, occasion) + occasionScore(bottom, occasion)) / 2
      const score = Math.round(cScore * 0.6 + oScore * 0.4)
      outfits.push({
        items: [top, bottom],
        score,
        color_score: cScore,
        occasion_score: Math.round(oScore),
        reason: `${top.name || '上衣'} + ${bottom.name || '下装'}，${cScore >= 80 ? '色彩协调' : '搭配一般'}${oScore >= 80 ? '，场合匹配' : ''}`,
      })
    }
  }

  // 组合2：连衣裙（单件成搭配）
  for (const dress of buckets.dress) {
    const oScore = occasionScore(dress, occasion)
    const score = Math.round(75 * 0.6 + oScore * 0.4) // 连衣裙默认色彩分 75（单件无配色问题）
    outfits.push({
      items: [dress],
      score,
      color_score: 75,
      occasion_score: oScore,
      reason: `${dress.name || '连衣裙'}，单件成搭${oScore >= 80 ? '，场合匹配' : ''}`,
    })
  }

  // 组合3：上衣+下装+外套（如果有外套）
  for (const top of buckets.top) {
    for (const bottom of buckets.bottom) {
      for (const outer of buckets.outer) {
        const topHex = getHex(top)
        const bottomHex = getHex(bottom)
        const outerHex = getHex(outer)
        const c1 = colorHarmonyScore(topHex, bottomHex)
        const c2 = colorHarmonyScore(outerHex, topHex)
        const cScore = (c1 + c2) / 2
        const oScore =
          (occasionScore(top, occasion) +
            occasionScore(bottom, occasion) +
            occasionScore(outer, occasion)) /
          3
        const score = Math.round(cScore * 0.6 + oScore * 0.4)
        outfits.push({
          items: [top, bottom, outer],
          score,
          color_score: Math.round(cScore),
          occasion_score: Math.round(oScore),
          reason: `${outer.name || '外套'} + ${top.name || '上衣'} + ${bottom.name || '下装'}`,
        })
      }
    }
  }

  // 按总分降序，取前 N 套
  outfits.sort((a, b) => b.score - a.score)
  return outfits.slice(0, limit)
}

module.exports = {
  generateWardrobeOutfits,
  bucketItems,
  colorHarmonyScore,
  getHex,
}
