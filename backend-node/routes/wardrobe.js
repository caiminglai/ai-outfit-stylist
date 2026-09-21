/**
 * 个人衣橱路由模块（AIWardrobe 模式）
 * 对应 Python: app/routes/wardrobe.py
 *
 * 功能：衣橱单品 CRUD、搭配组合、缺口分析、购物评估、购物推荐、衣橱匹配、心愿单、个人推荐
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { buildRecommendation } = require('../services/recommendEngine')
const { getSessionId, parseJsonField, getCurrentSeason } = require('../utils/common')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 写操作限流：每分钟最多 30 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, message: '操作过于频繁，请稍后再试' })

// ============================================================
// 辅助函数
// ============================================================

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
    by_category: {},
    by_season: {},
    by_color: {},
    by_style: {},
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

  // 各类别基础需求（基于胶囊衣橱理论）
  const requiredCategories = {
    top: { min: 5, label: '上衣', type: 'category_top' },
    bottom: { min: 3, label: '下装', type: 'category_bottom' },
    outerwear: { min: 2, label: '外套', type: 'category_outerwear' },
    shoes: { min: 3, label: '鞋子', type: 'category_shoes' },
  }

  const gaps = []
  for (const [cat, req] of Object.entries(requiredCategories)) {
    const count = stats.by_category[cat] || 0
    if (count < req.min) {
      const shortage = req.min - count
      gaps.push({
        type: req.type,
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
  // g.type 格式为 category_top / category_bottom 等，需匹配 candidate.category
  const matchingGap = gaps.gaps.find((g) => g.type === 'category_' + candidate.category)

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
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3))

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

// ============================================================
// 一、衣橱单品 CRUD
// ============================================================

/** 查询衣橱列表 */
router.get('/items', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 400)
    }

    const { category, season, occasion } = req.query
    let query = 'SELECT * FROM user_wardrobe WHERE session_id = ?'
    const params = [sessionId]

    if (category) {
      query += ' AND category = ?'
      params.push(category)
    }

    query += ' ORDER BY created_at DESC'
    const items = db.prepare(query).all(...params)
    let normalized = items.map(normalizeItem)

    // 按季节筛选（需在解析后进行）
    if (season) {
      normalized = normalized.filter((item) => {
        const seasons = item.season_tags || []
        return seasons.length === 0 || seasons.includes(season)
      })
    }

    // 按场合筛选
    if (occasion) {
      normalized = normalized.filter((item) => {
        const occasions = item.occasion_tags || []
        return occasions.length === 0 || occasions.includes(occasion)
      })
    }

    return sendSuccess(res, { items: normalized, count: normalized.length })
  } catch (err) {
    console.error('[衣橱] 查询失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 添加衣服到衣橱 */
router.post('/items', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    const name = (data.name || '').trim()
    const category = (data.category || '').trim()
    if (!name || !category) {
      return sendError(res, 'name 和 category 不能为空', 400)
    }

    const result = db
      .prepare(
        `INSERT INTO user_wardrobe
        (session_id, name, category, sub_category, color, color_tags, pattern,
         style_tags, season_tags, occasion_tags, fit_body_types, fit_skin_tones,
         \`condition\`, price, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        name,
        category,
        data.sub_category || null,
        data.color || null,
        JSON.stringify(data.color_tags || []),
        data.pattern || null,
        JSON.stringify(data.style_tags || []),
        JSON.stringify(data.season_tags || []),
        JSON.stringify(data.occasion_tags || []),
        JSON.stringify(data.fit_body_types || []),
        JSON.stringify(data.fit_skin_tones || []),
        data.condition || '良好',
        data.price || null,
        data.image_url || null,
      )

    const item = db.prepare('SELECT * FROM user_wardrobe WHERE id = ?').get(result.lastInsertRowid)
    return sendSuccess(res, normalizeItem(item))
  } catch (err) {
    console.error('[衣橱] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 获取单件衣服详情 */
router.get('/items/:itemId', (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId, 10)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    const item = db
      .prepare('SELECT * FROM user_wardrobe WHERE id = ? AND session_id = ?')
      .get(itemId, sid)
    if (!item) {
      return sendError(res, '衣服不存在', 404)
    }
    return sendSuccess(res, normalizeItem(item))
  } catch (err) {
    console.error('[衣橱] 获取失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 更新衣服信息 */
router.put('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId, 10)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    const data = req.body || {}

    // 允许更新的字段
    const allowed = {
      name: 'name',
      category: 'category',
      sub_category: 'sub_category',
      color: 'color',
      color_tags: 'color_tags',
      pattern: 'pattern',
      style_tags: 'style_tags',
      season_tags: 'season_tags',
      occasion_tags: 'occasion_tags',
      fit_body_types: 'fit_body_types',
      fit_skin_tones: 'fit_skin_tones',
      condition: '`condition`',
      price: 'price',
      image_url: 'image_url',
      is_favorite: 'is_favorite',
    }

    const updates = []
    const params = []
    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined && data[key] !== null) {
        // JSON 数组字段需要 stringify
        const val = [
          'color_tags',
          'style_tags',
          'season_tags',
          'occasion_tags',
          'fit_body_types',
          'fit_skin_tones',
        ].includes(key)
          ? JSON.stringify(data[key])
          : key === 'is_favorite'
            ? data[key]
              ? 1
              : 0
            : data[key]
        updates.push(`${col} = ?`)
        params.push(val)
      }
    }

    if (updates.length === 0) {
      return sendError(res, '没有需要更新的字段', 400)
    }

    updates.push("updated_at = datetime('now')")
    params.push(itemId)

    const result = db
      .prepare(`UPDATE user_wardrobe SET ${updates.join(', ')} WHERE id = ? AND session_id = ?`)
      .run(...params, sid)
    if (result.changes === 0) {
      return sendError(res, '衣服不存在', 404)
    }

    const item = db.prepare('SELECT * FROM user_wardrobe WHERE id = ?').get(itemId)
    return sendSuccess(res, normalizeItem(item))
  } catch (err) {
    console.error('[衣橱] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除衣服 */
router.delete('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId, 10)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    const result = db
      .prepare('DELETE FROM user_wardrobe WHERE id = ? AND session_id = ?')
      .run(itemId, sid)
    if (result.changes === 0) {
      return sendError(res, '衣服不存在', 404)
    }
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[衣橱] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

// ============================================================
// 二、搭配组合管理
// ============================================================

/** 查询所有搭配 */
router.get('/outfits', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 400)
    }

    const outfits = db
      .prepare('SELECT * FROM wardrobe_outfits WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId)

    // 解析 item_ids
    const normalized = outfits.map((o) => ({
      ...o,
      item_ids: parseJsonField(o.item_ids) || [],
      is_favorite: !!o.is_favorite,
    }))

    return sendSuccess(res, { outfits: normalized, count: normalized.length })
  } catch (err) {
    console.error('[衣橱] 查询搭配失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 创建一套搭配 */
router.post('/outfits', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    const name = (data.name || '').trim()
    const itemIds = data.item_ids || []
    if (!name || !itemIds.length) {
      return sendError(res, 'name 和 item_ids 不能为空', 400)
    }

    const result = db
      .prepare(
        `INSERT INTO wardrobe_outfits (session_id, name, item_ids, occasion, season, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        name,
        JSON.stringify(itemIds),
        data.occasion || null,
        data.season || null,
        data.notes || null,
      )

    const outfit = db
      .prepare('SELECT * FROM wardrobe_outfits WHERE id = ?')
      .get(result.lastInsertRowid)
    return sendSuccess(
      res,
      {
        ...outfit,
        item_ids: parseJsonField(outfit.item_ids) || [],
        is_favorite: !!outfit.is_favorite,
      },
      '搭配已创建',
    )
  } catch (err) {
    console.error('[衣橱] 创建搭配失败:', err)
    return sendError(res, '创建失败', 500)
  }
})

// ============================================================
// 三、衣橱缺口分析
// ============================================================

router.post('/gaps', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const profile = req.body?.profile || {}
    if (!profile || Object.keys(profile).length === 0) {
      return sendError(res, '缺少 profile', 400)
    }

    const result = analyzeWardrobeGaps(profile, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[衣橱] 缺口分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

// ============================================================
// 四、购物评估（值不值得买）
// ============================================================

router.post('/evaluate', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    const profile = data.profile || {}
    const candidate = data.candidate || {}
    if (!candidate || !candidate.name) {
      return sendError(res, '缺少 candidate 商品信息', 400)
    }

    const result = evaluatePurchase(profile, sessionId, candidate)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[衣橱] 购物评估失败:', err)
    return sendError(res, '评估失败', 500)
  }
})

// ============================================================
// 五、购物推荐（下次买什么）
// ============================================================

router.post('/suggest', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const profile = req.body?.profile || {}
    const suggestions = suggestNextPurchase(profile, sessionId)
    // 前端期望直接返回数组 ShoppingWishlistItem[]
    return sendSuccess(res, suggestions)
  } catch (err) {
    console.error('[衣橱] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

// ============================================================
// 六、衣橱匹配（从已有衣服中筛选）
// ============================================================

router.post('/match', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    const profile = data.profile || {}
    const matched = matchWardrobe(profile, sessionId, data.category, data.occasion)
    return sendSuccess(res, { items: matched, count: matched.length })
  } catch (err) {
    console.error('[衣橱] 匹配失败:', err)
    return sendError(res, '匹配失败', 500)
  }
})

// ============================================================
// 七、心愿单管理
// ============================================================

/** 查询购物心愿单 */
router.get('/wishlist', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 400)
    }

    const { status } = req.query
    let query = 'SELECT * FROM shopping_wishlist WHERE session_id = ?'
    const params = [sessionId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY created_at DESC'
    const wishes = db.prepare(query).all(...params)

    // 前端期望直接返回数组 ShoppingWishlistItem[]
    return sendSuccess(res, wishes)
  } catch (err) {
    console.error('[衣橱] 查询心愿单失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 添加购物心愿 */
router.post('/wishlist', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    // 前端 ShoppingWishlistItem 字段名为 name，兼容 item_name
    const itemName = (data.name || data.item_name || '').trim()
    if (!itemName) {
      return sendError(res, 'name 不能为空', 400)
    }

    const result = db
      .prepare(
        `INSERT INTO shopping_wishlist (session_id, item_name, category, color, reason, priority, gap_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        itemName,
        data.category || null,
        data.color || null,
        data.reason || null,
        data.priority || 'medium',
        data.gap_type || null,
      )

    const wish = db
      .prepare('SELECT * FROM shopping_wishlist WHERE id = ?')
      .get(result.lastInsertRowid)
    return sendSuccess(res, wish)
  } catch (err) {
    console.error('[衣橱] 添加心愿失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 更新心愿单状态 */
router.put('/wishlist/:wishId', (req, res) => {
  try {
    const wishId = parseInt(req.params.wishId, 10)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    const status = req.body?.status
    if (!status) {
      return sendError(res, '缺少 status', 400)
    }

    const result = db
      .prepare('UPDATE shopping_wishlist SET status = ? WHERE id = ? AND session_id = ?')
      .run(status, wishId, sid)
    if (result.changes === 0) {
      return sendError(res, '心愿不存在', 404)
    }

    const wish = db
      .prepare('SELECT * FROM shopping_wishlist WHERE id = ? AND session_id = ?')
      .get(wishId, sid)
    return sendSuccess(res, wish)
  } catch (err) {
    console.error('[衣橱] 更新心愿失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

// ============================================================
// 八、个人衣橱推荐（规则引擎 personal 模式）
// ============================================================

router.post('/recommend', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    const data = req.body || {}
    const profile = data.profile || {}

    if (!profile || Object.keys(profile).length === 0) {
      return sendError(res, '缺少 profile 数据', 400)
    }

    // 如果传了 session_id 但没传 wardrobe_items，自动从 DB 查询
    let wardrobeItems = data.wardrobe_items || []
    if (sessionId && wardrobeItems.length === 0) {
      try {
        const items = db.prepare('SELECT * FROM user_wardrobe WHERE session_id = ?').all(sessionId)
        wardrobeItems = items.map(normalizeItem).map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          color: i.color,
          style_tags: i.style_tags || [],
          season_tags: i.season_tags || [],
          occasion_tags: i.occasion_tags || [],
        }))
      } catch {
        wardrobeItems = []
      }
    }

    const profileWithWardrobe = { ...profile, wardrobe_items: wardrobeItems }

    // 调用规则引擎（personal 模式）
    const result = buildRecommendation(profileWithWardrobe, 'personal')

    // 同时生成衣橱缺口分析和购物推荐
    let gapResult = null
    let suggestions = null
    if (sessionId) {
      try {
        gapResult = analyzeWardrobeGaps(profile, sessionId)
        suggestions = suggestNextPurchase(profile, sessionId)
      } catch {
        // 不影响主流程
      }
    }

    return sendSuccess(
      res,
      {
        recommendation: result,
        mode: 'personal',
        wardrobe_count: wardrobeItems.length,
        gap_analysis: gapResult,
        shopping_suggestions: suggestions,
        privacy_notice: '您的数据仅在本设备处理，不会上传到任何服务器。',
      },
      '个人衣橱推荐已生成',
    )
  } catch (err) {
    console.error('[衣橱] 推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

// ============================================================
// 九、衣橱状态统计
// ============================================================

router.get('/status', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 400)
    }

    const items = db.prepare('SELECT * FROM user_wardrobe WHERE session_id = ?').all(sessionId)
    const normalized = items.map(normalizeItem)
    const stats = calculateStats(normalized)

    // 构建颜色分析
    const sortedColors = Object.entries(stats.by_color || {}).sort((a, b) => b[1] - a[1])
    const colorAnalysis = {
      dominant_colors: sortedColors.slice(0, 5).map(([c]) => c),
      missing_colors: [],
      color_distribution: stats.by_color || {},
    }

    return sendSuccess(
      res,
      {
        gaps: [],
        stats,
        color_analysis: colorAnalysis,
      },
      `衣橱共 ${stats.total} 件单品`,
    )
  } catch (err) {
    console.error('[衣橱] 获取状态失败:', err)
    return sendError(res, '获取衣橱状态失败', 500)
  }
})

module.exports = router
