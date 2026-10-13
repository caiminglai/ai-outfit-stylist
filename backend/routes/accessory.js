/**
 * 配饰柜路由模块
 * 对应 Python: app/routes/accessory.py
 *
 * 端点：CRUD + 缺口分析 + 购物评估 + 购物推荐
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const {
  getSessionId,
  parseJsonField,
  asText,
  asNumber,
  asFilters,
  firstBadScalar,
  tally,
  asId,
} = require('../utils/common')
const { countByBucket, accessoryGapBucket } = require('../services/categoryBuckets')
const { rateLimit } = require('../middleware/rateLimit')

const router = express.Router()

// 写操作限流：每分钟最多 30 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, message: '操作过于频繁，请稍后再试' })

/**
 * 直接绑进 user_accessories 的可空标量列。
 * 布尔开关（allergy_safe / is_favorite）先转 0/1、JSON 列表字段先 stringify，
 * 都不在这张表里——这里只列"原样绑"的那些，进门用 firstBadScalar 挡一次。
 */
const ACCESSORY_SCALARS = [
  'name',
  'brand',
  'category',
  'material',
  'metal_color',
  'gem_color',
  'shape',
  'length',
  'allergy_notes',
  'condition',
  'price',
  'image_url',
]

// ============================================================
// 辅助函数
// ============================================================

function normalizeItem(row) {
  if (!row) return null
  return {
    ...row,
    face_shape_fit: parseJsonField(row.face_shape_fit) || [],
    neck_length_fit: parseJsonField(row.neck_length_fit) || [],
    skin_tone_fit: parseJsonField(row.skin_tone_fit) || [],
    occasion_tags: parseJsonField(row.occasion_tags) || [],
    style_tags: parseJsonField(row.style_tags) || [],
    season_tags: parseJsonField(row.season_tags) || [],
    allergy_safe: row.allergy_safe ? true : false,
    is_favorite: !!row.is_favorite,
  }
}

// 配饰分类基础需求
// 科学依据：配饰搭配学理论（Accessory Coordination Theory）
// - 项链2条：日常锁骨链 + 正式款（首饰搭配学, 高桥盾《配饰美学》）
// - 耳饰2副：日常简约 + 正式款（面部美学, 配饰视觉平衡原则）
// - 戒指2枚：日常 + 个性款（手部美学比例研究）
// - 手链1条：手腕装饰平衡
// - 胸针1枚：提升正式场合精致度（Vogue配饰指南）
// 键＝缺口 type 去掉 category_ 前缀后的桶名（见 services/categoryBuckets.js 的 ACCESSORY_BUCKETS）。
// 原先写的是中文叶子名，而库里 category 什么写法都有（'耳钉'≠'耳饰'）⇒ 归桶前先按叶子名计数会漏。
const REQUIRED_CATEGORIES = {
  necklace: { min: 2, label: '项链', type: 'category_necklace' },
  earring: { min: 2, label: '耳饰', type: 'category_earring' },
  ring: { min: 2, label: '戒指', type: 'category_ring' },
  bracelet: { min: 1, label: '手链', type: 'category_bracelet' },
  brooch: { min: 1, label: '胸针', type: 'category_brooch' },
}

/** 配饰柜缺口分析
 * 返回格式与前端 AccessoryGapResult 类型完全匹配：
 *   gaps: [{ type, priority, message, suggestions }]
 *   stats: { total, by_category }
 *
 * 科学依据：
 * - 配饰搭配学理论：基础配饰包5大类
 * - 面型匹配理论（脸型与配饰协调，Proportion Theory）
 * - 肤色金属色匹配（色彩学冷暖色调理论）
 */
function analyzeAccessoryGaps(profile, sessionId) {
  const items = db
    // `condition` 为空（没填 / PUT 传 null 清成 NULL）的必须算在柜内：
    // SQLite 里 `NULL != '已淘汰'` 的回值是 NULL 而不是 true ⇒ 原写法把这些行整条筛掉，
    // 10-13 现量：插一条 condition=NULL 的配饰，列表能看到、缺口分析里 0 件。
    .prepare(
      'SELECT * FROM user_accessories WHERE session_id = ? AND (`condition` IS NULL OR `condition` != ?)',
    )
    .all(sessionId, '已淘汰')

  const byCategory = tally()
  for (const item of items) {
    const cat = item.category || '未分类'
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }

  const gaps = []
  // 同 cosmetic/wardrobe：库里的 category（'耳钉'/'手表'）与这张表的键不是一套写法，
  // 先归桶再计数，否则 byCategory['耳饰'] 对 '耳钉' 恒不命中 ⇒ 缺口永远报 0 件
  const bucketCounts = countByBucket(byCategory, accessoryGapBucket)
  for (const [cat, req] of Object.entries(REQUIRED_CATEGORIES)) {
    const count = bucketCounts[cat] || 0
    if (count < req.min) {
      const shortage = req.min - count
      gaps.push({
        type: req.type,
        label: req.label,
        priority: count === 0 ? 'high' : 'medium',
        message: `${req.label}仅${count}件，推荐至少${req.min}件`,
        suggestions: [
          `建议购买${shortage}件${req.label}`,
          count === 0 ? '该类别为空，属于最高优先级' : `当前差${shortage}件达标`,
        ],
      })
    }
  }

  // 脸型匹配缺口分析
  const faceShape = profile.face_shape
  if (faceShape) {
    const matchedFace = items.filter((item) => {
      const fits = parseJsonField(item.face_shape_fit) || []
      return fits.length === 0 || fits.includes(faceShape)
    }).length
    if (matchedFace < items.length / 2 && items.length > 0) {
      gaps.push({
        type: 'face_shape_mismatch',
        priority: 'low',
        message: `超过半数配饰不适合${faceShape}脸型`,
        suggestions: [
          `${faceShape}适合：圆脸选长线条耳饰，方脸选圆润款，心形脸选下宽款`,
          '参考面部比例理论选择配饰形状',
        ],
      })
    }
  }

  // 肤色金属色匹配
  const skinTone = profile.skin_tone
  if (skinTone && items.length > 0) {
    const warmSafe = items.filter((item) => {
      const fits = parseJsonField(item.skin_tone_fit) || []
      return fits.length === 0 || fits.includes(skinTone)
    }).length
    if (warmSafe < items.length / 2) {
      gaps.push({
        type: 'tone_mismatch',
        priority: 'low',
        message: `超过半数配饰不适合${skinTone}肤色`,
        suggestions: [
          '暖皮适合金色/玫瑰金，冷皮适合银色/白金',
          '过敏体质建议选择防过敏材质（钛钢/医疗钢）',
        ],
      })
    }
  }

  return {
    total_items: items.length,
    by_category: byCategory,
    stats: {
      total: items.length,
      by_category: byCategory,
    },
    gaps,
    gap_count: gaps.length,
  }
}

/** 购物评估 */
function evaluateAccessoryPurchase(profile, sessionId, candidate) {
  const gaps = analyzeAccessoryGaps(profile, sessionId)
  // 同衣橱：candidate.category 是叶子标签或表单英文 value，先归桶再和 category_xxx 比
  const candidateBucket = accessoryGapBucket(candidate.category)
  const matchingGap = candidateBucket
    ? gaps.gaps.find((g) => g.type === 'category_' + candidateBucket)
    : undefined

  let score = 50
  const reasons = []

  if (matchingGap) {
    score += 30
    reasons.push(`填补了${matchingGap.label}的缺口（+30分）`)
  }

  // 脸型匹配加分
  const faceShape = profile.face_shape
  const candidateFaceFit = candidate.face_shape_fit || []
  if (faceShape && candidateFaceFit.includes(faceShape)) {
    score += 20
    reasons.push(`适合${faceShape}脸型（+20分）`)
  }

  // 肤色匹配加分
  const skinTone = profile.skin_tone
  const candidateSkinFit = candidate.skin_tone_fit || []
  if (skinTone && candidateSkinFit.includes(skinTone)) {
    score += 10
    reasons.push(`适合${skinTone}肤色（+10分）`)
  }

  // 过敏安全加分
  if (candidate.allergy_safe) {
    score += 10
    reasons.push('防过敏材质（+10分）')
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
function suggestAccessoryPurchases(profile, sessionId) {
  const gaps = analyzeAccessoryGaps(profile, sessionId)
  const suggestions = gaps.gaps.map((gap) => ({
    name: gap.message.split('，')[0] || gap.type,
    category: gap.type.replace('category_', ''),
    reason: gap.message,
    priority: gap.priority,
    suggestions: gap.suggestions,
  }))

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  // 必须用 ??：priorityOrder.high === 0，`0 || 3` 会把 high 打成 3（与衣橱柜同一处修法）
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))

  return { suggestions, total_suggestions: suggestions.length }
}

// ============================================================
// CRUD
// ============================================================

/** 查询配饰列表 */
router.get('/items', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    // 过 asText：`?category[]=耳饰` 会被 Express 解析成数组，原样绑参 ⇒ better-sqlite3 抛
    // RangeError ⇒ 列表页 500。非文本当"没有这个筛选"，而不是当"筛选空字符串"（那会永远查不到）。
    const category = asText(req.query.category)
    const condition = asText(req.query.condition)
    let query = 'SELECT * FROM user_accessories WHERE session_id = ?'
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
    console.error('[配饰] 查询失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 添加配饰 */
router.post('/items', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const name = asText(data.name)
    const category = asText(data.category)
    if (!name || !category) return sendError(res, 'name 和 category 为必填字段', 400)

    // 下面这些列是原样绑进去的可空标量：传成布尔/对象/数组时 better-sqlite3 当场抛，
    // 路由的 catch 会把一个"字段类型写错"回成 500。⇒ 进门先挡成 400
    const bad = firstBadScalar(data, ACCESSORY_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    const result = db
      .prepare(
        `INSERT INTO user_accessories
        (session_id, name, brand, category, material, metal_color, gem_color,
         shape, length, face_shape_fit, neck_length_fit, skin_tone_fit,
         allergy_safe, allergy_notes, occasion_tags, style_tags, season_tags,
         \`condition\`, price, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        name,
        data.brand || null,
        category,
        data.material || null,
        data.metal_color || null,
        data.gem_color || null,
        data.shape || null,
        data.length || null,
        JSON.stringify(data.face_shape_fit || []),
        JSON.stringify(data.neck_length_fit || []),
        JSON.stringify(data.skin_tone_fit || []),
        data.allergy_safe ? 1 : 0,
        data.allergy_notes || null,
        JSON.stringify(data.occasion_tags || []),
        JSON.stringify(data.style_tags || []),
        JSON.stringify(data.season_tags || []),
        data.condition || '良好',
        // 0 元是真实价格（赠品/自制），`|| null` 会把它记成"没填"⇒ 统计里凭空少一件有价物
        asNumber(data.price, null),
        data.image_url || null,
      )

    const item = db
      .prepare('SELECT * FROM user_accessories WHERE id = ?')
      .get(result.lastInsertRowid)
    return sendSuccess(res, { item: normalizeItem(item) })
  } catch (err) {
    console.error('[配饰] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 获取单个配饰 */
router.get('/items/:itemId', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
    const item = db
      .prepare('SELECT * FROM user_accessories WHERE id = ? AND session_id = ?')
      .get(itemId, sessionId)
    if (!item) return sendError(res, '配饰不存在', 404)

    return sendSuccess(res, { item: normalizeItem(item) })
  } catch (err) {
    console.error('[配饰] 查询失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 更新配饰 */
router.put('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
    const data = req.body || {}

    // 与 POST 同一把闸门：下面按 allowedFields 原样绑值，类型写错就该 400 而不是 500
    const bad = firstBadScalar(data, ACCESSORY_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    const jsonFields = [
      'face_shape_fit',
      'neck_length_fit',
      'skin_tone_fit',
      'occasion_tags',
      'style_tags',
      'season_tags',
    ]
    const allowedFields = [
      'name',
      'brand',
      'category',
      'material',
      'metal_color',
      'gem_color',
      'shape',
      'length',
      'face_shape_fit',
      'neck_length_fit',
      'skin_tone_fit',
      'allergy_safe',
      'allergy_notes',
      'occasion_tags',
      'style_tags',
      'season_tags',
      'condition',
      'price',
      'image_url',
      'is_favorite',
    ]

    const updates = []
    const params = []
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        let val = data[key]
        if (jsonFields.includes(key)) val = JSON.stringify(val || [])
        if (key === 'allergy_safe' || key === 'is_favorite') val = val ? 1 : 0
        // price 列是 REAL：与 POST 同一把尺子过 asNumber，0 保住、'1,200' 这类脏值归 NULL，
        // 不再让字符串躺在数值列里（crossCabinet 的 priceRange 一算就废）
        if (key === 'price') val = asNumber(val, null)
        const col = key === 'condition' ? '`condition`' : key
        updates.push(`${col} = ?`)
        params.push(val)
      }
    }

    if (updates.length === 0) return sendError(res, '没有需要更新的字段', 400)

    updates.push("updated_at = datetime('now')")
    params.push(itemId, sessionId)

    const result = db
      .prepare(`UPDATE user_accessories SET ${updates.join(', ')} WHERE id = ? AND session_id = ?`)
      .run(...params)
    if (result.changes === 0) return sendError(res, '配饰不存在', 404)

    const item = db.prepare('SELECT * FROM user_accessories WHERE id = ?').get(itemId)
    return sendSuccess(res, normalizeItem(item))
  } catch (err) {
    console.error('[配饰] 更新失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/** 删除配饰 */
router.delete('/items/:itemId', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
    const result = db
      .prepare('DELETE FROM user_accessories WHERE id = ? AND session_id = ?')
      .run(itemId, sessionId)
    if (result.changes === 0) return sendError(res, '配饰不存在', 404)

    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[配饰] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

// ============================================================
// 业务接口
// ============================================================

/** 配饰柜缺口分析（支持 POST 和 GET） */
router.post('/gaps', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const data = req.body || {}
    const profile = data.profile || {}
    const result = analyzeAccessoryGaps(profile, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[配饰] 缺口分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

router.get('/gaps', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    // 这四格会被当成档案值去和 fit_* 列表做 includes 比对：`?face_shape[]=鹅蛋脸` 传进来
    // 是个数组，判真后 includes 永远不命中 ⇒ 缺口分析平白多报一条"脸型不匹配"。
    // 过 asText 后非文本＝没填＝用默认值，与 POST 的档案口径一致。
    const q = asFilters(req.query, ['face_shape', 'skin_tone', 'neck_length', 'occasion'])
    const profile = {
      face_shape: q.face_shape || '鹅蛋脸',
      skin_tone: q.skin_tone || '自然',
      neck_length: q.neck_length || '中',
      occasion: q.occasion || '上班通勤',
    }
    const result = analyzeAccessoryGaps(profile, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[配饰] 缺口分析失败:', err)
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
      face_shape: data.face_shape || '鹅蛋脸',
      skin_tone: data.skin_tone || '自然',
    }
    const result = evaluateAccessoryPurchase(profile, sessionId, candidate)
    return sendSuccess(res, result, result.verdict)
  } catch (err) {
    console.error('[配饰] 购物评估失败:', err)
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
    const result = suggestAccessoryPurchases(profile, sessionId)
    return sendSuccess(res, result.suggestions)
  } catch (err) {
    console.error('[配饰] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

router.get('/suggest', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    // 过 asFilters：`?skin_tone[]=白皮` 这类数组查询串当"没填"，回落默认值。
    // 不归一的话数组会原样进 profile，下游 `profile.skin_tone === '白皮'` 恒 false ⇒ 推荐悄悄变味。
    const q = asFilters(req.query, ['face_shape', 'skin_tone', 'occasion'])
    const profile = {
      face_shape: q.face_shape || '鹅蛋脸',
      skin_tone: q.skin_tone || '自然',
      occasion: q.occasion || '上班通勤',
    }
    const result = suggestAccessoryPurchases(profile, sessionId)
    return sendSuccess(res, result.suggestions)
  } catch (err) {
    console.error('[配饰] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

module.exports = router
