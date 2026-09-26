/**
 * 完整形象指导（跨柜拼一套）
 *
 * 三柜各自排榜只能回答"这件合不合适"，回答不了"今天这身穿什么"。
 * 这个模块把三柜的候选拼成一套，并保证每条理由都来自柜子里真有的字段。
 *
 * 纯函数、不碰数据库：调用方把已打分的候选传进来。
 */

/** 衣橱品类词表：判定"能不能当上衣/下装/外套/一件成套"用 */
const TOP_WORDS = ['上衣', '衬衫', 'T恤', '针织', '毛衣', '卫衣', 'polo', 'POLO']
const BOTTOM_WORDS = ['裤子', '裤', '裙', '半身裙']
const DRESS_WORDS = ['连衣裙', '旗袍', '套装', '连体']
const OUTER_WORDS = ['外套', '大衣', '西装', '风衣', '夹克', '开衫']

/** 化妆品里"底妆 + 唇"是一套妆容的最小可见面 */
const BASE_WORDS = ['粉底', '气垫', '遮瑕', '素颜霜', '妆前']
const LIP_WORDS = ['口红', '唇釉', '唇泥', '唇蜜', '唇膏']

/** 配饰里最影响"这身看不看得出搭配"的两类 */
const NECK_WORDS = ['项链', '锁骨链', '毛衣链']
const EAR_WORDS = ['耳环', '耳钉', '耳坠', '耳饰']

/** 四季型 → 金属色：春秋属暖调戴金，夏冬属冷调戴银 */
const METAL_BY_SEASON = [
  { words: ['春', '秋'], metal: '金' },
  { words: ['夏', '冬'], metal: '银' },
]

function hitsWord(words, value) {
  if (!value) return false
  const s = String(value)
  return words.some((w) => s.includes(w))
}

/**
 * 该戴金还是戴银：优先用冷暖皮原值，没有就退到四季型/十二型算出来的结论
 * @param {object} profile 已合并档案的画像
 * @param {object} tags profile_tags 读出的结论（key → value）
 * @returns {{metal: string, basis: string}} metal 为空串表示没有可靠依据，不启用这一维
 */
function pickMetal(profile, tags = {}) {
  const tone = String(profile.skin_tone || '')
  if (tone.includes('暖')) return { metal: '金', basis: '按你的冷暖皮' }
  if (tone.includes('冷')) return { metal: '银', basis: '按你的冷暖皮' }

  const season = String(tags.color_season || tags.color_season_12 || '')
  for (const row of METAL_BY_SEASON) {
    if (hitsWord(row.words, season)) {
      return { metal: row.metal, basis: `按你算出的四季型(${season})` }
    }
  }
  return { metal: '', basis: '' }
}

/** 从候选里取该槽位的第一件（候选已按分数排好），已选过的名字不再重复占用 */
function pickBy(matched, words, excludeNames = []) {
  const taken = new Set(excludeNames.filter(Boolean))
  return matched.find((m) => !taken.has(m.name) && hitsWord(words, m.category)) || null
}

/**
 * 拼"今天这身"
 * @param {object} candidates { outfit, makeup, accessory }，各是已打分已排序的候选
 * @param {string} occasion 本次场合
 * @returns {{pieces: Array, complete: boolean, missing_parts: string[], note: string}}
 */
function buildFullLook({ outfit = [], makeup = [], accessory = [] }, occasion = '') {
  const pieces = []
  const missing = []

  const dress = pickBy(outfit, DRESS_WORDS)
  if (dress) {
    pieces.push(toPiece(dress, '一件成套'))
  } else {
    const top = pickBy(outfit, TOP_WORDS)
    const bottom = pickBy(outfit, BOTTOM_WORDS)
    if (top) pieces.push(toPiece(top, '上装'))
    if (bottom) pieces.push(toPiece(bottom, '下装'))
    if (!top) missing.push('上衣')
    if (!bottom) missing.push('下装')
  }
  const outer = pickBy(
    outfit,
    OUTER_WORDS,
    pieces.map((p) => p.name),
  )
  if (outer) pieces.push(toPiece(outer, '外搭'))

  const base = pickBy(makeup, BASE_WORDS)
  if (base) pieces.push(toPiece(base, '底妆'))
  else missing.push('底妆')
  const lip = pickBy(makeup, LIP_WORDS)
  if (lip) pieces.push(toPiece(lip, '唇色'))
  else missing.push('唇色')

  const necklace = pickBy(accessory, NECK_WORDS)
  const earring = pickBy(accessory, EAR_WORDS)
  const neckPiece = necklace || earring
  if (neckPiece) pieces.push(toPiece(neckPiece, necklace ? '颈饰' : '耳饰'))
  else missing.push('项链或耳环')

  return {
    pieces,
    occasion: occasion || '',
    complete: pieces.length >= 3,
    missing_parts: missing,
    note:
      pieces.length === 0
        ? '三柜里还没有可搭配的单品，先把衣服、化妆品、配饰存进柜子才能拼出"今天这身"'
        : missing.length > 0
          ? `这套还缺${missing.join('、')}，缺的原因是柜子里没有这一类`
          : '衣服 + 妆容 + 配饰已凑齐一套',
  }
}

/** 单件入选说明：理由只带它自己算出来的那些 */
function toPiece(item, slot) {
  return {
    slot,
    name: item.name,
    category: item.category || '',
    score: item.score,
    why: item.reasons || [],
  }
}

module.exports = {
  TOP_WORDS,
  BOTTOM_WORDS,
  DRESS_WORDS,
  OUTER_WORDS,
  BASE_WORDS,
  LIP_WORDS,
  hitsWord,
  pickMetal,
  buildFullLook,
}
