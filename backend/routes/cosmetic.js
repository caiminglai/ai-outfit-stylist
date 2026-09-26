/**
 * 化妆品柜路由模块
 * 对应 Python: app/routes/cosmetic.py
 *
 * 端点：CRUD + 保质期检查 + 缺口分析 + 购物评估 + 购物推荐
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { getSessionId, parseJsonField } = require('../utils/common')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 写操作限流：每分钟最多 30 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, message: '操作过于频繁，请稍后再试' })

// ============================================================
// 辅助函数
// ============================================================

/** 规范化化妆品记录 */
function normalizeItem(row) {
  if (!row) return null
  return {
    ...row,
    occasion_tags: parseJsonField(row.occasion_tags) || [],
    style_tags: parseJsonField(row.style_tags) || [],
    skin_tone_fit: parseJsonField(row.skin_tone_fit) || [],
    skin_type_fit: parseJsonField(row.skin_type_fit) || [],
    face_shape_fit: parseJsonField(row.face_shape_fit) || [],
    eye_shape_fit: parseJsonField(row.eye_shape_fit) || [],
    lip_shape_fit: parseJsonField(row.lip_shape_fit) || [],
    is_favorite: !!row.is_favorite,
  }
}

// 化妆品分类基础需求
// 科学依据：基础化妆包理论（Basic Makeup Kit Theory）
// - 底妆2件：日常+补妆（皮肤科医师推荐，Dr. Ellen Marmur, Mount Sinai）
// - 眼妆3件：眼影+眼线+睫毛膏（专业化妆师Bobbi Brown基础教程）
// - 唇妆3件：日常色+正式色+润唇（色彩学三色法则）
// - 腮红1件：提升气色（皮肤学面部红润度研究）
// - 修容1件：面部轮廓修饰（黄金比例面部美学, Marquardt Mask）
const REQUIRED_CATEGORIES = {
  底妆: { min: 2, label: '底妆产品', type: 'category_foundation' },
  眼妆: { min: 3, label: '眼妆产品', type: 'category_eye' },
  唇妆: { min: 3, label: '唇妆产品', type: 'category_lip' },
  腮红: { min: 1, label: '腮红产品', type: 'category_blush' },
  修容: { min: 1, label: '修容产品', type: 'category_contour' },
}

/** 保质期检查 */
function checkExpiry(sessionId) {
  const items = db
    .prepare('SELECT * FROM user_cosmetics WHERE session_id = ? ORDER BY created_at DESC')
    .all(sessionId)

  const now = new Date()
  const expired = []
  const expiringSoon = []
  const safe = []

  for (const item of items) {
    if (!item.opened_date || !item.expiry_months) {
      safe.push(item)
      continue
    }
    const opened = new Date(item.opened_date)
    const expiryDate = new Date(opened)
    expiryDate.setMonth(expiryDate.getMonth() + item.expiry_months)

    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
    if (daysLeft < 0) {
      expired.push({ ...item, days_left: daysLeft, status: '已过期' })
    } else if (daysLeft <= 30) {
      expiringSoon.push({ ...item, days_left: daysLeft, status: '即将过期' })
    } else {
      safe.push({ ...item, days_left: daysLeft, status: '安全期' })
    }
  }

  return {
    summary: {
      total: items.length,
      expired: expired.length,
      expiring_soon: expiringSoon.length,
      safe: safe.length,
    },
    expired,
    expiring_soon: expiringSoon,
    safe,
  }
}

/** 化妆品柜缺口分析
 * 返回格式与前端 CosmeticGapResult 类型完全匹配：
 *   gaps: [{ type, priority, message, suggestions }]
 *   stats: { total, by_category, expiring, expired }
 *
 * 科学依据：
 * - 基础化妆包理论：底妆2/眼妆3/唇妆3/腮红1/修容1
 * - 保质期预警：PAO（Period After Opening）标准（EU Cosmetics Regulation 1223/2009）
 */
function analyzeCosmeticGaps(profile, sessionId) {
  const items = db
    .prepare('SELECT * FROM user_cosmetics WHERE session_id = ? AND `condition` != ?')
    .all(sessionId, '已淘汰')

  const byCategory = {}
  for (const item of items) {
    const cat = item.category || '未分类'
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }

  // 计算过期/即将过期
  const now = new Date()
  let expiring = 0
  let expired = 0
  for (const item of items) {
    if (item.opened_date && item.expiry_months) {
      const opened = new Date(item.opened_date)
      if (isNaN(opened.getTime())) continue
      const expiryDate = new Date(opened)
      expiryDate.setMonth(expiryDate.getMonth() + item.expiry_months)
      if (now > expiryDate) {
        expired++
      } else if (now >= new Date(expiryDate.getTime() - 30 * 24 * 60 * 60 * 1000)) {
        expiring++
      }
    }
  }

  const gaps = []
  for (const [cat, req] of Object.entries(REQUIRED_CATEGORIES)) {
    const count = byCategory[cat] || 0
    if (count < req.min) {
      const shortage = req.min - count
      gaps.push({
        type: req.type,
        priority: count === 0 ? 'high' : 'medium',
        message: `${req.label}仅${count}件，推荐至少${req.min}件`,
        suggestions: [
          `建议购买${shortage}件${req.label}`,
          count === 0 ? '该类别为空，属于最高优先级' : `当前差${shortage}件达标`,
        ],
      })
    }
  }

  // 过期品提醒
  if (expired > 0) {
    gaps.push({
      type: 'expired_products',
      priority: 'high',
      message: `${expired}件化妆品已过期，建议立即淘汰更换`,
      suggestions: ['过期化妆品可能滋生细菌，导致皮肤感染', '参考PAO标识（开封后保质期）及时更换'],
    })
  }

  // 即将过期提醒
  if (expiring > 0) {
    gaps.push({
      type: 'expiring_products',
      priority: 'medium',
      message: `${expiring}件化妆品即将过期（30天内）`,
      suggestions: ['优先使用即将过期的产品', '制定使用计划避免浪费'],
    })
  }

  // 肤色匹配缺口
  const skinTone = profile.skin_tone
  if (skinTone) {
    const matchedTone = items.filter((item) => {
      const fits = parseJsonField(item.skin_tone_fit) || []
      return fits.length === 0 || fits.includes(skinTone)
    }).length
    if (matchedTone < items.length / 2) {
      gaps.push({
        type: 'tone_mismatch',
        priority: 'low',
        message: `超过半数化妆品不适合${skinTone}肤色`,
        suggestions: [`${skinTone}色适合：暖皮选金棕色调，冷皮选粉紫色调`, '建议更换不匹配的产品'],
      })
    }
  }

  return {
    total_items: items.length,
    by_category: byCategory,
    stats: {
      total: items.length,
      by_category: byCategory,
      expiring,
      expired,
    },
    gaps,
    gap_count: gaps.length,
  }
}

/** 购物评估 */
function evaluateCosmeticPurchase(profile, sessionId, candidate) {
  const gaps = analyzeCosmeticGaps(profile, sessionId)
  // g.type 格式为 category_foundation / category_eye 等，需匹配 candidate.category
  const matchingGap = gaps.gaps.find((g) => g.type === 'category_' + candidate.category)

  let score = 50
  const reasons = []

  if (matchingGap) {
    score += 30
    reasons.push(`填补了${matchingGap.label}的缺口（+30分）`)
  }

  // 肤色匹配加分
  const skinTone = profile.skin_tone
  const candidateSkinFit = candidate.skin_tone_fit || []
  if (skinTone && candidateSkinFit.includes(skinTone)) {
    score += 20
    reasons.push(`适合${skinTone}肤色（+20分）`)
  }

  // 价格合理性
  if (candidate.price && candidate.price < 300) {
    score += 10
    reasons.push('价格合理（+10分）')
  }

  score = Math.min(score, 100)

  let verdict = '建议购买'
  if (score >= 80) verdict = '强烈推荐'
  else if (score >= 60) verdict = '建议购买'
  else if (score >= 40) verdict = '可以考虑'
  else verdict = '不建议购买'

  return { verdict, score, reasons, matching_gap: matchingGap || null, candidate }
}

/** 购物推荐
 * 返回前端期望的 ShoppingWishlistItem[] 格式：{ name, category, reason, priority }
 */
function suggestCosmeticPurchases(profile, sessionId) {
  const gaps = analyzeCosmeticGaps(profile, sessionId)
  const suggestions = gaps.gaps.map((gap) => ({
    name: gap.message.split('，')[0] || gap.type,
    category: gap.type.replace('category_', ''),
    reason: gap.message,
    priority: gap.priority,
    suggestions: gap.suggestions,
  }))

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3))

  return { suggestions, total_suggestions: suggestions.length }
}

// ============================================================
// CRUD
// ============================================================

/** 查询化妆品列表 */
router.get('/items', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const { category, condition } = req.query
    let query = 'SELECT * FROM user_cosmetics WHERE session_id = ?'
    const params = [sessionId]

    if (category) {
      query += ' AND category = ?'
      params.push(category)
    }
    if (condition) {
      query += ' AND `condition` = ?'
      params.push(condition)
    }

    query += ' ORDER BY created_at DESC'
    const items = db.prepare(query).all(...params)
    const normalized = items.map(normalizeItem)

    return sendSuccess(res, { items: normalized, count: normalized.length })
  } catch (err) {
    console.error('[化妆品] 查询失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 添加化妆品 */
router.post('/items', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const name = (data.name || '').trim()
    const category = (data.category || '').trim()
    if (!name || !category) return sendError(res, 'name 和 category 为必填字段', 400)

    const result = db
      .prepare(
        `INSERT INTO user_cosmetics
        (session_id, name, brand, category, sub_category, color_name, color_tone,
         color_family, finish, skin_tone_fit, skin_type_fit, face_shape_fit,
         eye_shape_fit, lip_shape_fit, occasion_tags, style_tags, coverage,
         opened_date, expiry_months, remaining, \`condition\`, price, image_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        name,
        data.brand || null,
        category,
        data.sub_category || null,
        data.color_name || null,
        data.color_tone || null,
        data.color_family || null,
        data.finish || null,
        JSON.stringify(data.skin_tone_fit || []),
        JSON.stringify(data.skin_type_fit || []),
        JSON.stringify(data.face_shape_fit || []),
        JSON.stringify(data.eye_shape_fit || []),
        JSON.stringify(data.lip_shape_fit || []),
        JSON.stringify(data.occasion_tags || []),
        JSON.stringify(data.style_tags || []),
        data.coverage || null,
        data.opened_date || null,
        data.expiry_months || null,
        data.remaining ?? 100,
        data.condition || '在用',
        data.price || null,
        data.image_url || null,
        data.notes || null,
      )

    const item = db.prepare('SELECT * FROM user_cosmetics WHERE id = ?').get(result.lastInsertRowid)
    return sendSuccess(res, { item: normalizeItem(item) })
  } catch (err) {
    console.error('[化妆品] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 获取单个化妆品 */
router.get('/items/:itemId', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = parseInt(req.params.itemId, 10)
    const item = db
      .prepare('SELECT * FROM user_cosmetics WHERE id = ? AND session_id = ?')
      .get(itemId, sessionId)
    if (!item) return sendError(res, '化妆品不存在', 404)

    return sendSuccess(res, { item: normalizeItem(item) })
  } catch (err) {
    console.error('[化妆品] 查询失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 更新化妆品 */
router.put('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = parseInt(req.params.itemId, 10)
    const data = req.body || {}

    // 允许更新的字段映射
    const jsonFields = [
      'skin_tone_fit',
      'skin_type_fit',
      'face_shape_fit',
      'eye_shape_fit',
      'lip_shape_fit',
      'occasion_tags',
      'style_tags',
    ]
    const allowedFields = [
      'name',
      'brand',
      'category',
      'sub_category',
      'color_name',
      'color_tone',
      'color_family',
      'finish',
      'skin_tone_fit',
      'skin_type_fit',
      'face_shape_fit',
      'eye_shape_fit',
      'lip_shape_fit',
      'occasion_tags',
      'style_tags',
      'coverage',
      'opened_date',
      'expiry_months',
      'remaining',
      'condition',
      'price',
      'image_url',
      'notes',
      'is_favorite',
    ]

    const updates = []
    const params = []
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        let val = data[key]
        if (jsonFields.includes(key)) val = JSON.stringify(val || [])
        if (key === 'is_favorite') val = val ? 1 : 0
        const col = key === 'condition' ? '`condition`' : key
        updates.push(`${col} = ?`)
        params.push(val)
      }
    }

    if (updates.length === 0) return sendError(res, '没有需要更新的字段', 400)

    updates.push("updated_at = datetime('now')")
    params.push(itemId, sessionId)

    const result = db
      .prepare(`UPDATE user_cosmetics SET ${updates.join(', ')} WHERE id = ? AND session_id = ?`)
      .run(...params)
    if (result.changes === 0) return sendError(res, '化妆品不存在', 404)

    const item = db.prepare('SELECT * FROM user_cosmetics WHERE id = ?').get(itemId)
    return sendSuccess(res, normalizeItem(item))
  } catch (err) {
    console.error('[化妆品] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除化妆品 */
router.delete('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = parseInt(req.params.itemId, 10)
    const result = db
      .prepare('DELETE FROM user_cosmetics WHERE id = ? AND session_id = ?')
      .run(itemId, sessionId)
    if (result.changes === 0) return sendError(res, '化妆品不存在', 404)

    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[化妆品] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

// ============================================================
// 业务接口
// ============================================================

/** 保质期检查
 * 返回前端期望的 CosmeticItem[] 格式（仅返回过期和即将过期的产品）
 * 科学依据：PAO (Period After Opening) 标准 — EU Cosmetics Regulation 1223/2009
 * - 唇膏 PAO: 12-18个月
 * - 睫毛膏 PAO: 3-6个月（易滋生细菌）
 * - 粉底 PAO: 12-24个月
 * - 眼线液 PAO: 3-6个月
 */
router.get('/expiry', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const result = checkExpiry(sessionId)
    // 合并 expired + expiring_soon，并规范化每条记录
    const items = [...result.expired, ...result.expiring_soon].map((item) => ({
      ...normalizeItem(item),
      days_left: item.days_left,
      status: item.status,
    }))
    return sendSuccess(res, items)
  } catch (err) {
    console.error('[化妆品] 保质期检查失败:', err)
    return sendError(res, '检查失败', 500)
  }
})

/** 化妆品柜缺口分析（支持 POST 和 GET） */
router.post('/gaps', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const profile = data.profile || {}
    const result = analyzeCosmeticGaps(profile, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[化妆品] 缺口分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

router.get('/gaps', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const profile = {
      skin_tone: req.query.skin_tone || '自然',
      occasion: req.query.occasion || '上班通勤',
      face_shape: req.query.face_shape || '鹅蛋脸',
    }
    const result = analyzeCosmeticGaps(profile, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[化妆品] 缺口分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

/** 购物评估 */
router.post('/evaluate', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const candidate = data.candidate || {}
    if (!candidate || !candidate.name) return sendError(res, 'candidate 为必填字段', 400)

    // 前端发送 { candidate, profile } 嵌套结构
    const profile = data.profile || {
      skin_tone: data.skin_tone || '自然',
      occasion: data.occasion || '上班通勤',
    }
    const result = evaluateCosmeticPurchase(profile, sessionId, candidate)
    return sendSuccess(res, result, result.verdict)
  } catch (err) {
    console.error('[化妆品] 购物评估失败:', err)
    return sendError(res, '评估失败', 500)
  }
})

/** 购物推荐（支持 POST 和 GET） */
router.post('/suggest', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const profile = data.profile || {}
    const result = suggestCosmeticPurchases(profile, sessionId)
    return sendSuccess(res, result.suggestions)
  } catch (err) {
    console.error('[化妆品] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

router.get('/suggest', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const profile = {
      skin_tone: req.query.skin_tone || '自然',
      occasion: req.query.occasion || '上班通勤',
    }
    const result = suggestCosmeticPurchases(profile, sessionId)
    return sendSuccess(res, result.suggestions)
  } catch (err) {
    console.error('[化妆品] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

module.exports = router
