/**
 * 衣橱统计与缺口／购物评估的核心算法（11-03 拆分轮从 `routes/wardrobe.js` 逐字搬出）。
 *
 * 这一段只吃 sessionId 与 profile，不吃 req/res ⇒ 与 HTTP 层解耦；
 * 分类归桶仍引 `services/categoryBuckets`（中文自由标签→桶名那一步是缺口分析算得对的前提，
 * 2026-10-11 实测过不桶会恒报 0 件）。
 * ⛔ 函数体逐字未改；优先级排序那条 `??` 不能退回 `||` 的教训留在原注释里。
 */
const db = require('../../db/init')
const { parseJsonField, getCurrentSeason, tally } = require('../../utils/common')
const { countByBucket, wardrobeGapBuckets } = require('../categoryBuckets')

/** 规范化衣橱单品记录（解析 JSON 字段） */
function normalizeItem(row) {
  if (!row) return null
  return {
    ...row,
    color_tags: parseJsonField(row.color_tags) || [],
    style_tags: parseJsonField(row.style_tags) || [],
    season_tags: parseJsonField(row.season_tags) || [],
    occasion_tags: parseJsonField(row.occasion_tags) || [],
    fit_body_types: parseJsonField(row.fit_body_types) || [],
    fit_skin_tones: parseJsonField(row.fit_skin_tones) || [],
    is_favorite: !!row.is_favorite,
  }
}

/** 计算衣橱统计 */
function calculateStats(items) {
  const stats = {
    total: items.length,
    // 四个计数桶都按用户自填的分类/季节/颜色/风格当键 ⇒ 必须是空原型对象，
    // 否则有人把分类填成 __proto__ 或 constructor，这一件就从统计里消失或变成 NaN
    by_category: tally(),
    by_season: tally(),
    by_color: tally(),
    by_style: tally(),
  }
  for (const item of items) {
    // 分类统计
    const cat = item.category || '未分类'
    stats.by_category[cat] = (stats.by_category[cat] || 0) + 1

    // 季节统计
    const seasons = item.season_tags || []
    for (const s of seasons) {
      stats.by_season[s] = (stats.by_season[s] || 0) + 1
    }

    // 颜色统计
    const colors = item.color_tags || []
    const color = colors.length > 0 ? colors[0] : item.color || '未知'
    stats.by_color[color] = (stats.by_color[color] || 0) + 1

    // 风格统计
    const styles = item.style_tags || []
    for (const st of styles) {
      stats.by_style[st] = (stats.by_style[st] || 0) + 1
    }
  }
  return stats
}

/** 衣橱缺口分析核心逻辑
 * 返回格式与前端 WardrobeGapResult 类型完全匹配：
 *   gaps: [{ type, priority, message, suggestions }]
 *   stats: { total, by_category, by_season, by_style }
 *
 * 科学依据：
 * - 基础衣橱胶囊理论（Capsule Wardrobe Theory, Susie Faux 1985）：
 *   一套实用衣橱至少需要 5件上衣 + 3件下装 + 2件外套 + 3双鞋
 * - 季节适配：每个季节至少5件应季衣物（ seasonal dressing, OSHA 29 CFR 1910.132）
 */
function analyzeWardrobeGaps(profile, sessionId) {
  const items = db
    .prepare('SELECT * FROM user_wardrobe WHERE session_id = ? ORDER BY created_at DESC')
    .all(sessionId)

  const normalized = items.map(normalizeItem)
  const stats = calculateStats(normalized)
  const currentSeason = getCurrentSeason()
  // 库里的 category 是中文自由标签（'衬衫'/'连衣裙'）或表单英文 value（'top'），
  // 而下面的需求表用的是桶名 ⇒ 先归桶再计数，否则 by_category['top'] 恒 undefined，
  // 四类缺口永远报"仅0件、优先级 high"（2026-10-11 实测：衣橱有 4 件仍报 0 件）。
  const bucketCounts = countByBucket(stats.by_category, wardrobeGapBuckets)

  // 各类别基础需求（基于胶囊衣橱理论）
  const requiredCategories = {
    top: { min: 5, label: '上衣', type: 'category_top' },
    bottom: { min: 3, label: '下装', type: 'category_bottom' },
    outerwear: { min: 2, label: '外套', type: 'category_outerwear' },
    shoes: { min: 3, label: '鞋子', type: 'category_shoes' },
  }

  const gaps = []
  for (const [cat, req] of Object.entries(requiredCategories)) {
    const count = bucketCounts[cat] || 0
    if (count < req.min) {
      const shortage = req.min - count
      gaps.push({
        type: req.type,
        label: req.label,
        priority: count === 0 ? 'high' : 'medium',
        message: `${req.label}仅${count}件，推荐至少${req.min}件（胶囊衣橱理论）`,
        suggestions: [
          `建议购买${shortage}件${req.label}`,
          count === 0 ? '该类别为空，属于最高优先级' : `当前差${shortage}件达标`,
        ],
      })
    }
  }

  // 季节缺口
  const seasonCount = stats.by_season[currentSeason] || 0
  if (seasonCount < 5) {
    gaps.push({
      type: 'season_gap',
      priority: seasonCount === 0 ? 'high' : 'medium',
      message: `${currentSeason}季衣物仅${seasonCount}件，推荐至少5件`,
      suggestions: [
        `补充${5 - seasonCount}件${currentSeason}季衣物`,
        '优先选择百搭基础款，提高搭配灵活性',
      ],
    })
  }

  // 色彩缺口分析（色彩学原理：基础衣橱需要中性色+点缀色）
  const colorCount = Object.keys(stats.by_color || {}).length
  if (colorCount < 3) {
    gaps.push({
      type: 'color_diversity',
      priority: 'low',
      message: `衣橱仅有${colorCount}种颜色，建议至少3种以增加搭配多样性`,
      suggestions: [
        '基础中性色：黑/白/灰/藏青（占比60%）',
        '点缀色：根据肤色选择暖色或冷色（占比30%）',
        '流行色：当季流行色（占比10%）',
      ],
    })
  }

  return {
    current_season: currentSeason,
    total_items: normalized.length,
    stats: {
      total: stats.total,
      by_category: stats.by_category,
      by_season: stats.by_season,
      by_style: stats.by_style,
    },
    gaps,
    gap_count: gaps.length,
  }
}

/** 购物评估核心逻辑 */
function evaluatePurchase(profile, sessionId, candidate) {
  const gaps = analyzeWardrobeGaps(profile, sessionId)
  // 缺口 type 是 category_<桶名>，candidate.category 却是库里那三种写法之一（'外套'/'outerwear'）
  // ⇒ 必须先归桶再比，否则中文类别一条也匹配不上，评估里那 +30 分形同虚设
  const candidateBuckets = wardrobeGapBuckets(candidate.category)
  const matchingGap = gaps.gaps.find(
    (g) => g.type.startsWith('category_') && candidateBuckets.includes(g.type.slice(9)),
  )

  let score = 50
  const reasons = []

  // 匹配缺口加分
  if (matchingGap) {
    score += 30
    reasons.push(`填补了${matchingGap.label}的缺口（+30分）`)
  }

  // 风格匹配加分
  const candidateStyles = candidate.style_tags || []
  if (candidateStyles.length > 0) {
    score += 10
    reasons.push('风格标签丰富（+10分）')
  }

  // 季节匹配加分
  const candidateSeasons = candidate.season_tags || []
  const currentSeason = getCurrentSeason()
  if (candidateSeasons.includes(currentSeason)) {
    score += 10
    reasons.push(`适合当前${currentSeason}季（+10分）`)
  }

  // 价格合理性
  if (candidate.price && candidate.price < 500) {
    score += 10
    reasons.push('价格合理（+10分）')
  }

  score = Math.min(score, 100)

  let verdict = '建议购买'
  if (score >= 80) verdict = '强烈推荐'
  else if (score >= 60) verdict = '建议购买'
  else if (score >= 40) verdict = '可以考虑'
  else verdict = '不建议购买'

  return {
    verdict,
    score,
    reasons,
    matching_gap: matchingGap || null,
    candidate,
  }
}

/** 购物推荐核心逻辑
 * 返回前端期望的 ShoppingWishlistItem[] 格式：{ name, category, reason, priority }
 */
function suggestNextPurchase(profile, sessionId) {
  const gaps = analyzeWardrobeGaps(profile, sessionId)
  const suggestions = []

  for (const gap of gaps.gaps) {
    suggestions.push({
      name: gap.message.split('，')[0] || gap.type, // 使用消息前半段作为名称
      category: gap.type.replace('category_', '').replace('_gap', ''),
      reason: gap.message,
      priority: gap.priority,
      suggestions: gap.suggestions,
    })
  }

  // 按优先级排序
  // ★ 必须用 ?? 不能用 ||：priorityOrder.high === 0，`0 || 3` 会把 high 打成 3，
  // 10-13 现量 high/medium/low 三条建议排完成了 medium,low,high —— 最要紧的缺口排到最后。
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))

  return suggestions
}

/** 衣橱匹配核心逻辑 */
function matchWardrobe(profile, sessionId, category, occasion) {
  let query = 'SELECT * FROM user_wardrobe WHERE session_id = ?'
  const params = [sessionId]

  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }

  query += ' ORDER BY created_at DESC'
  const items = db.prepare(query).all(...params)
  let normalized = items.map(normalizeItem)

  // 按场合筛选
  if (occasion) {
    normalized = normalized.filter((item) => {
      const occasions = item.occasion_tags || []
      return occasions.length === 0 || occasions.includes(occasion)
    })
  }

  // 按 profile 匹配度排序
  const skinTone = profile.skin_tone
  if (skinTone) {
    normalized.sort((a, b) => {
      const aMatch = (a.fit_skin_tones || []).includes(skinTone) ? 1 : 0
      const bMatch = (b.fit_skin_tones || []).includes(skinTone) ? 1 : 0
      return bMatch - aMatch
    })
  }

  return normalized
}

module.exports = {
  normalizeItem,
  calculateStats,
  analyzeWardrobeGaps,
  evaluatePurchase,
  suggestNextPurchase,
  matchWardrobe,
}
