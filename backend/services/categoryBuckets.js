/**
 * 品类归桶：把"库里存的 category 到底是什么写法"这一层收口
 *
 * 现量（2026-10-11，本机库 backend/db/styleai.db）：同一列里三种写法并存——
 *   user_wardrobe.category = 外套/开衫/衬衫/裤子/连衣裙/未分类（中文自由标签）
 *   user_cosmetics.category = 口红/眼影/粉底（中文叶子）
 *   user_accessories.category = 手表/耳钉/项链（中文叶子）
 * 而 app/src/components/CabinetConstants.ts 的表单存的是英文 value（top/lipstick/earring）。
 * 三条缺口表各自又用了第四种写法（衣橱＝英文桶名，化妆＝中文聚合名 底妆/眼妆，
 * 配饰＝中文叶子名 项链/耳饰）⇒ 键对不上，`byCategory[cat]` 恒 0，
 * 缺口永远报"仅0件、优先级 high"，购物评估那句「填补了…的缺口」也永远不触发。
 *
 * 所以计数之前先过这一层：英文 value、中文标签、自由文本都翻成该表用的桶名。
 * 词表沿用 services/fullLookAdvisor.js 的 TOP/BOTTOM/DRESS/OUTER/BASE/LIP，避免两套口径。
 */
const {
  TOP_WORDS,
  BOTTOM_WORDS,
  DRESS_WORDS,
  OUTER_WORDS,
  BASE_WORDS,
  LIP_WORDS,
  hitsWord,
} = require('./fullLookAdvisor')
const { tally } = require('../utils/common')

/** 桶定义：en＝CabinetConstants 的 value，words＝中文标签/自由文本里出现过的说法 */
const WARDROBE_BUCKETS = {
  shoes: { en: ['shoes', 'sandals', 'boots'], words: ['鞋', '靴', '凉鞋', '拖鞋'] },
  outerwear: { en: ['outerwear', 'coat', 'jacket'], words: [...OUTER_WORDS] },
  dress: { en: ['dress', 'romper'], words: [...DRESS_WORDS] },
  bottom: { en: ['bottom', 'pants', 'trousers', 'skirt'], words: [...BOTTOM_WORDS] },
  top: { en: ['top', 'tshirt'], words: [...TOP_WORDS] },
  bag: { en: ['bag'], words: ['包', '背包', '手提包'] },
}

const COSMETIC_BUCKETS = {
  foundation: {
    en: ['foundation', 'concealer', 'powder', 'primer', 'bb'],
    words: [...BASE_WORDS, '粉底', '蜜粉', '散粉', '粉饼'],
  },
  eye: {
    en: ['eyeshadow', 'eyeliner', 'mascara', 'eyebrow'],
    words: ['眼影', '眼线', '睫毛', '眉笔', '眉粉', '卧蚕'],
  },
  lip: { en: ['lipstick', 'lipgloss', 'lipmud'], words: [...LIP_WORDS] },
  blush: { en: ['blush'], words: ['腮红', '胭脂'] },
  contour: { en: ['contour', 'bronzer', 'highlighter'], words: ['修容', '高光', '阴影'] },
}

const ACCESSORY_BUCKETS = {
  necklace: { en: ['necklace'], words: ['项链', '锁骨链', '毛衣链', '项圈'] },
  earring: { en: ['earring'], words: ['耳饰', '耳环', '耳钉', '耳坠', '耳夹'] },
  ring: { en: ['ring'], words: ['戒指', '指环', '戒圈'] },
  bracelet: { en: ['bracelet', 'bangle'], words: ['手链', '手镯', '手串'] },
  brooch: { en: ['brooch', 'pin'], words: ['胸针', '胸饰', '别针'] },
}

/**
 * 一个 category 落进哪个桶：先按英文 value 全等，再按中文词表包含。
 * 顺序＝表里写在前面的桶优先（衣橱：鞋→外套→连衣裙→下装→上衣→包），
 * 这样"开衫"归外套、"连衣裙"归裙而不是一头扎进上衣。
 * @param {Record<string,{en:string[],words:string[]}>} buckets
 * @param {string|null|undefined} raw - 库里的原值
 * @returns {string|null} 桶名，认不出来返回 null
 */
function bucketOf(buckets, raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const low = s.toLowerCase()
  for (const [name, def] of Object.entries(buckets)) {
    if (def.en.includes(low)) return name
  }
  for (const [name, def] of Object.entries(buckets)) {
    if (hitsWord(def.words, s)) return name
  }
  return null
}

/**
 * 衣橱缺口用的桶集合：连衣裙一件顶上下装，外套今天也当上衣算
 * （沿用 isTopCategory 与 crossCabinet.js:233 里 essentialTops 含"外套"的既有口径）
 * @param {string|null|undefined} raw
 * @returns {string[]} 可能为空（未分类）
 */
function wardrobeGapBuckets(raw) {
  const b = bucketOf(WARDROBE_BUCKETS, raw)
  if (b === 'dress') return ['top', 'bottom']
  if (b === 'outerwear') return ['outerwear', 'top']
  return b ? [b] : []
}

/** 化妆品缺口用的桶（一件只归一类） */
function cosmeticGapBucket(raw) {
  return bucketOf(COSMETIC_BUCKETS, raw)
}

/** 配饰缺口用的桶（一件只归一类） */
function accessoryGapBucket(raw) {
  return bucketOf(ACCESSORY_BUCKETS, raw)
}

/**
 * 把 `byCategory`（原始 category → 件数）重算成桶 → 件数。
 * 桶名由 bucketFn 决定：返回字符串计 1 次，返回数组则每个桶都计（连衣裙）。
 * @param {Record<string, number>} byCategory
 * @param {(raw:string)=>string|string[]|null} bucketFn
 * @returns {Record<string, number>}
 */
function countByBucket(byCategory, bucketFn) {
  // 空原型对象：调用方拿用户自填的 category 回来读 `bucketCounts[cat]`，
  // cat='constructor' 时在普通 {} 上会读到 Object 构造器（truthy），
  // 那句 `count < req.min` 就永远为假 ⇒ 这一类缺口再也不报
  const out = tally()
  for (const [raw, n] of Object.entries(byCategory)) {
    const b = bucketFn(raw)
    const list = Array.isArray(b) ? b : b ? [b] : []
    for (const name of list) out[name] = (out[name] || 0) + n
  }
  return out
}

module.exports = {
  bucketOf,
  countByBucket,
  wardrobeGapBuckets,
  cosmeticGapBucket,
  accessoryGapBucket,
}
