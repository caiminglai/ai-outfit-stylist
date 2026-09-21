/**
 * 跨柜联动推荐路由模块
 * 对应 Python: app/routes/cross_cabinet.py
 *
 * 端点：跨柜推荐、季节性提醒、品牌偏好分析、三柜健康检查
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { getSessionId, parseJsonField, getCurrentSeason } = require('../utils/common')

const router = express.Router()

// ============================================================
// 辅助函数
// ============================================================

/** 跨柜联动推荐：针对场合统一推荐衣橱+化妆品+配饰 */
function crossCabinetRecommend(profile, sessionId, occasion) {
  // 查询三柜数据
  const wardrobeItems = db
    .prepare('SELECT * FROM user_wardrobe WHERE session_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(sessionId)

  const cosmetics = db
    .prepare(
      'SELECT * FROM user_cosmetics WHERE session_id = ? AND `condition` = ? ORDER BY created_at DESC LIMIT 20',
    )
    .all(sessionId, '在用')

  const accessories = db
    .prepare(
      'SELECT * FROM user_accessories WHERE session_id = ? AND `condition` = ? ORDER BY created_at DESC LIMIT 20',
    )
    .all(sessionId, '良好')

  // 简单匹配逻辑：根据肤色/脸型/场合筛选
  const skinTone = profile.skin_tone || '自然'
  const faceShape = profile.face_shape || '鹅蛋脸'
  const currentSeason = getCurrentSeason()

  // 场合风格映射
  const occasionStyles = {
    上班通勤: '商务休闲',
    约会: '优雅浪漫',
    派对: '时尚个性',
    面试: '正式专业',
    日常: '舒适简约',
    运动: '运动活力',
    婚礼: '正式典雅',
  }
  const occasionStyle = occasionStyles[occasion] || '百搭风格'

  // 衣橱推荐
  const outfitMatched = wardrobeItems
    .filter((item) => {
      const seasons = parseJsonField(item.season_tags) || []
      return seasons.length === 0 || seasons.includes(currentSeason)
    })
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      score: Math.round(60 + Math.random() * 40),
    }))

  const outfitCategories = [...new Set(wardrobeItems.map((i) => i.category))]
  const essentialTops = ['上衣', '衬衫', 'T恤', '外套']
  const essentialBottoms = ['裤子', '裙', '半身裙']
  const hasTop = outfitCategories.some((c) => essentialTops.some((t) => c && c.includes(t)))
  const hasBottom = outfitCategories.some((c) => essentialBottoms.some((b) => c && c.includes(b)))
  const outfitMissing = []
  if (!hasTop) outfitMissing.push('上衣')
  if (!hasBottom) outfitMissing.push('下装')

  // 化妆品推荐
  const makeupMatched = cosmetics
    .filter((item) => {
      const skinFit = parseJsonField(item.skin_tone_fit) || []
      return skinFit.length === 0 || skinFit.includes(skinTone)
    })
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      score: Math.round(60 + Math.random() * 40),
    }))

  const makeupCategories = [...new Set(cosmetics.map((i) => i.category))]
  const essentialMakeup = ['粉底', '口红', '眉笔', '眼影']
  const makeupMissing = essentialMakeup.filter(
    (e) => !makeupCategories.some((c) => c && c.includes(e)),
  )

  // 配饰推荐
  const accessoryMatched = accessories
    .filter((item) => {
      const faceFit = parseJsonField(item.face_shape_fit) || []
      return faceFit.length === 0 || faceFit.includes(faceShape)
    })
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      score: Math.round(60 + Math.random() * 40),
    }))

  const accessoryCategories = [...new Set(accessories.map((i) => i.category))]
  const essentialAccessories = ['项链', '耳环', '戒指', '手表']
  const accessoryMissing = essentialAccessories.filter(
    (e) => !accessoryCategories.some((c) => c && c.includes(e)),
  )

  // 跨柜建议
  const crossTips = []
  if (outfitMatched.length > 0 && makeupMatched.length > 0) {
    crossTips.push('妆容色调建议与服装主色调呼应，避免撞色')
  }
  if (outfitMatched.length > 0 && accessoryMatched.length > 0) {
    crossTips.push('配饰风格建议与服装场合保持一致')
  }
  if (makeupMatched.length > 0 && accessoryMatched.length > 0) {
    crossTips.push('金属色配饰可与暖色系妆容搭配')
  }
  if (outfitMissing.length > 0) {
    crossTips.push(`衣橱缺少${outfitMissing.join('、')}，影响整体搭配`)
  }

  return {
    occasion: occasion || profile.occasion || '日常',
    occasion_style: occasionStyle,
    outfit_advice: {
      style: occasionStyle,
      matched: outfitMatched,
      missing: outfitMissing,
      suggestion:
        outfitMissing.length > 0
          ? `建议补充${outfitMissing.join('、')}以完善该场合穿搭`
          : '衣橱搭配齐全，可根据个人喜好选择风格',
    },
    cosmetic_advice: {
      style: skinTone + '肤色',
      matched: makeupMatched,
      missing: makeupMissing,
      suggestion:
        makeupMissing.length > 0
          ? `建议补充${makeupMissing.join('、')}等基础化妆品`
          : '化妆品齐全，可根据场合调整妆容浓淡',
    },
    accessory_advice: {
      style: faceShape + '脸型',
      matched: accessoryMatched,
      missing: accessoryMissing,
      suggestion:
        accessoryMissing.length > 0
          ? `建议补充${accessoryMissing.join('、')}等百搭配饰`
          : '配饰充足，可尝试不同风格搭配',
    },
    cross_tips: crossTips,
    summary: {
      wardrobe_count: wardrobeItems.length,
      cosmetic_count: cosmetics.length,
      accessory_count: accessories.length,
    },
  }
}

/** 季节性提醒 */
function seasonalReminder(profile, sessionId) {
  const currentSeason = getCurrentSeason()
  const reminders = []

  // 衣橱季节检查
  const wardrobeItems = db
    .prepare('SELECT * FROM user_wardrobe WHERE session_id = ?')
    .all(sessionId)
  const seasonItems = wardrobeItems.filter((item) => {
    const seasons = parseJsonField(item.season_tags) || []
    return seasons.includes(currentSeason)
  })

  if (seasonItems.length < 5) {
    reminders.push({
      cabinet: 'wardrobe',
      message: `${currentSeason}季衣物仅 ${seasonItems.length} 件，建议补充`,
      priority: 'medium',
    })
  }

  // 化妆品保质期检查
  const cosmetics = db
    .prepare('SELECT * FROM user_cosmetics WHERE session_id = ? AND `condition` = ?')
    .all(sessionId, '在用')
  const now = new Date()
  let expiringCount = 0
  for (const item of cosmetics) {
    if (item.opened_date && item.expiry_months) {
      const opened = new Date(item.opened_date)
      const expiryDate = new Date(opened)
      expiryDate.setMonth(expiryDate.getMonth() + item.expiry_months)
      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
      if (daysLeft <= 30) expiringCount++
    }
  }
  if (expiringCount > 0) {
    reminders.push({
      cabinet: 'cosmetic',
      message: `${expiringCount} 件化妆品即将过期，请及时更换`,
      priority: 'high',
    })
  }

  // 配饰状态检查
  const accessories = db
    .prepare('SELECT * FROM user_accessories WHERE session_id = ?')
    .all(sessionId)
  const goodAccessories = accessories.filter((a) => a.condition === '良好')
  if (goodAccessories.length < 3) {
    reminders.push({
      cabinet: 'accessory',
      message: `状态良好的配饰仅 ${goodAccessories.length} 件，建议补充`,
      priority: 'low',
    })
  }

  // 构建前端期望的结构
  const wardrobeTip =
    seasonItems.length < 5
      ? `${currentSeason}季衣物仅 ${seasonItems.length} 件，建议补充当季单品`
      : `当季衣物充足（${seasonItems.length} 件），注意搭配多样性`
  const cosmeticTip =
    expiringCount > 0
      ? `${expiringCount} 件化妆品即将过期，请及时更换`
      : `化妆品状态良好，注意防晒和补水`
  const accessoryTip =
    goodAccessories.length < 3
      ? `状态良好的配饰仅 ${goodAccessories.length} 件，建议补充`
      : `配饰数量充足（${goodAccessories.length} 件），可尝试新搭配`

  return {
    current_season: currentSeason,
    tips: {
      outfit: wardrobeTip,
      cosmetic: cosmeticTip,
      accessory: accessoryTip,
    },
    wardrobe: {
      total: wardrobeItems.length,
      season_items: seasonItems.length,
      need_attention: seasonItems.length < 5,
    },
    cosmetic: {
      total: cosmetics.length,
      tip: cosmeticTip,
    },
    accessory: {
      total: accessories.length,
      season_items: goodAccessories.length,
      need_attention: goodAccessories.length < 3,
    },
  }
}

/** 品牌偏好分析 */
function analyzeBrandPreference(sessionId) {
  // 统计衣橱品牌（衣橱表没有 brand 字段，按 category 统计风格）
  const wardrobeItems = db
    .prepare('SELECT * FROM user_wardrobe WHERE session_id = ?')
    .all(sessionId)

  // 统计化妆品品牌
  const cosmetics = db
    .prepare(
      'SELECT brand, COUNT(*) as count FROM user_cosmetics WHERE session_id = ? AND brand IS NOT NULL AND brand != "" GROUP BY brand ORDER BY count DESC LIMIT 10',
    )
    .all(sessionId)
  const cosmeticBrands = cosmetics.map((r) => ({ brand: r.brand, count: r.count }))

  // 统计配饰品牌
  const accessories = db
    .prepare(
      'SELECT brand, COUNT(*) as count FROM user_accessories WHERE session_id = ? AND brand IS NOT NULL AND brand != "" GROUP BY brand ORDER BY count DESC LIMIT 10',
    )
    .all(sessionId)
  const accessoryBrands = accessories.map((r) => ({ brand: r.brand, count: r.count }))

  // 衣橱按 category 作为"品牌"统计
  const wardrobeBrandMap = {}
  for (const item of wardrobeItems) {
    const cat = item.category || '未分类'
    wardrobeBrandMap[cat] = (wardrobeBrandMap[cat] || 0) + 1
  }
  const wardrobeBrands = Object.entries(wardrobeBrandMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([brand, count]) => ({ brand, count }))

  // 价格区间统计
  const priceRange = (items, priceField) => {
    const prices = items.map((i) => i[priceField]).filter((p) => p != null && p > 0)
    if (prices.length === 0) return { min: 0, max: 0, avg: 0, count: 0 }
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
      count: prices.length,
    }
  }

  // 风格偏好（从衣橱标签中提取）
  const styleSet = new Set()
  for (const item of wardrobeItems) {
    const tags = parseJsonField(item.style_tags) || parseJsonField(item.season_tags) || []
    if (Array.isArray(tags)) tags.forEach((t) => styleSet.add(t))
  }

  return {
    wardrobe_brands: wardrobeBrands,
    cosmetic_brands: cosmeticBrands,
    accessory_brands: accessoryBrands,
    price_range: {
      wardrobe: priceRange(wardrobeItems, 'price'),
      cosmetic: priceRange(cosmetics, 'price'),
      accessory: priceRange(accessories, 'price'),
    },
    style_preferences: [...styleSet].slice(0, 10),
    summary: {
      wardrobe_count: wardrobeItems.length,
      cosmetic_count: cosmetics.reduce((sum, r) => sum + r.count, 0),
      accessory_count: accessories.reduce((sum, r) => sum + r.count, 0),
    },
  }
}

/** 三柜整体健康检查 */
function cabinetHealthCheck(profile, sessionId) {
  const wardrobeItems = db
    .prepare('SELECT * FROM user_wardrobe WHERE session_id = ?')
    .all(sessionId)
  const cosmetics = db.prepare('SELECT * FROM user_cosmetics WHERE session_id = ?').all(sessionId)
  const accessories = db
    .prepare('SELECT * FROM user_accessories WHERE session_id = ?')
    .all(sessionId)

  // 各柜评分（0-100）
  let wardrobeScore = 0
  let cosmeticScore = 0
  let accessoryScore = 0

  // 衣橱评分：基于数量和多样性
  const wardrobeCategories = [...new Set(wardrobeItems.map((i) => i.category).filter(Boolean))]
  wardrobeScore = Math.min(100, wardrobeItems.length * 5 + wardrobeCategories.length * 10)

  // 化妆品评分：基于数量和保质期
  const now = new Date()
  let safeCount = 0
  const cosmeticCategories = new Set()
  const expiredItems = []
  for (const item of cosmetics) {
    cosmeticCategories.add(item.category)
    if (item.condition === '已淘汰') continue
    if (item.opened_date && item.expiry_months) {
      const opened = new Date(item.opened_date)
      const expiryDate = new Date(opened)
      expiryDate.setMonth(expiryDate.getMonth() + item.expiry_months)
      if (expiryDate > now) {
        safeCount++
      } else {
        expiredItems.push(item.name || '未命名')
      }
    } else {
      safeCount++
    }
  }
  cosmeticScore = Math.min(100, safeCount * 10 + (cosmetics.length > 0 ? 30 : 0))

  // 配饰评分：基于数量和状态
  const goodAccessories = accessories.filter((a) => a.condition === '良好')
  const accessoryCategories = [...new Set(accessories.map((a) => a.category).filter(Boolean))]
  accessoryScore = Math.min(100, goodAccessories.length * 15 + (accessories.length > 0 ? 20 : 0))

  const overallScore = Math.round((wardrobeScore + cosmeticScore + accessoryScore) / 3)

  // 各柜必备品检查
  const wardrobeEssentials = ['上衣', '裤', '外套', '鞋']
  const wardrobeMissing = wardrobeEssentials.filter(
    (e) => !wardrobeCategories.some((c) => c && c.includes(e)),
  )
  const cosmeticEssentials = ['粉底', '口红', '眉笔']
  const cosmeticMissing = cosmeticEssentials.filter(
    (e) => ![...cosmeticCategories].some((c) => c && c.includes(e)),
  )
  const accessoryEssentials = ['项链', '耳环']
  const accessoryMissing = accessoryEssentials.filter(
    (e) => !accessoryCategories.some((c) => c && c.includes(e)),
  )

  // 建议
  const recommendations = []
  if (wardrobeScore < 50) recommendations.push('衣橱单品不足，建议补充基础款')
  if (cosmeticScore < 50) recommendations.push('化妆品柜需要补充或清理过期产品')
  if (accessoryScore < 50) recommendations.push('配饰柜数量偏少，建议增加百搭款')
  if (expiredItems.length > 0)
    recommendations.push(`${expiredItems.length} 件化妆品已过期，建议及时清理`)
  if (recommendations.length === 0) recommendations.push('三柜状态良好，继续保持！')

  return {
    overall_score: overallScore,
    wardrobe_health: {
      score: wardrobeScore,
      total: wardrobeItems.length,
      categories: wardrobeCategories,
      missing_essentials: wardrobeMissing,
    },
    cosmetic_health: {
      score: cosmeticScore,
      total: cosmetics.length,
      categories: [...cosmeticCategories].filter(Boolean),
      missing_essentials: cosmeticMissing,
    },
    accessory_health: {
      score: accessoryScore,
      total: accessories.length,
      categories: accessoryCategories,
      missing_essentials: accessoryMissing,
    },
    recommendations,
  }
}

// ============================================================
// 路由
// ============================================================

/** 跨柜联动推荐 */
router.get('/recommend', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const profile = {
      skin_tone: req.query.skin_tone || '自然',
      face_shape: req.query.face_shape || '鹅蛋脸',
      occasion: req.query.occasion || '上班通勤',
      body_type: req.query.body_type || '',
    }
    const occasion = req.query.occasion || ''
    const result = crossCabinetRecommend(profile, sessionId, occasion || null)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[跨柜] 推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

/** 季节性提醒 */
router.get('/seasonal', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const result = seasonalReminder({}, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[跨柜] 季节提醒失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 品牌偏好分析 */
router.get('/brands', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const result = analyzeBrandPreference(sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[跨柜] 品牌分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

/** 三柜整体健康检查 */
router.get('/health', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)

    const result = cabinetHealthCheck({}, sessionId)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[跨柜] 健康检查失败:', err)
    return sendError(res, '检查失败', 500)
  }
})

module.exports = router
