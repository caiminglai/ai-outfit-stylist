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
const { loadArchive, loadTags, mergeWithArchive } = require('../services/profileArchive')
const { pickMetal, buildFullLook } = require('../services/fullLookAdvisor')

const router = express.Router()

// ============================================================
// 辅助函数
// ============================================================

/** 条目标签是否命中档案值(双向包含,兼容"上班通勤"与标签"通勤") */
function tagHits(rawTags, value) {
  if (!value) return false
  const tags = parseJsonField(rawTags) || []
  if (!Array.isArray(tags)) return false
  return tags.some((t) => String(t).includes(value) || String(value).includes(String(t)))
}

/** 开封后是否仍在保质期内(未填开封日期视为正常) */
function withinExpiry(item) {
  if (!item.opened_date || !item.expiry_months) return true
  const opened = new Date(item.opened_date)
  if (Number.isNaN(opened.getTime())) return true
  const expiry = new Date(opened)
  expiry.setMonth(expiry.getMonth() + item.expiry_months)
  return expiry > new Date()
}

/** 有没有真算过保质期：没填开封日期时不能声称"在保质期内" */
function expiryLabel(item) {
  return item.opened_date && item.expiry_months ? '在保质期内' : '开封日期未填，按在用处理'
}

// 个人版表单存的是英文 value（app/src/components/CabinetConstants.ts），门店版和手填存中文。
// 两套词表在这里统一成中文，否则"缺什么"的判断对个人版用户永远报缺。
const CATEGORY_CN = {
  top: '上衣',
  bottom: '裤子',
  outerwear: '外套',
  dress: '连衣裙',
  shoes: '鞋',
  bag: '包',
  lipstick: '口红',
  eyeshadow: '眼影',
  foundation: '粉底',
  blush: '腮红',
  eyeliner: '眼线',
  mascara: '睫毛膏',
  eyebrow: '眉笔',
  concealer: '遮瑕',
  powder: '蜜粉',
  earring: '耳环',
  necklace: '项链',
  bracelet: '手链',
  ring: '戒指',
  hat: '帽子',
  scarf: '围巾',
  watch: '手表',
  glasses: '眼镜',
  belt: '腰带',
}

function cnCategory(raw) {
  const v = String(raw || '')
  return CATEGORY_CN[v] || v
}

/**
 * 确定性打分:命中权重占全部权重的比例换算到 40~100
 * 归一化是为了以后往维度表里加档案字段不会把分数顶到天花板、排序失去分辨力
 * 返回 { score, reasons } —— reasons 就是"这个分怎么来的"
 */
function scoreItem(dims) {
  const scored = dims.filter((d) => d.label)
  const totalWeight = scored.reduce((sum, d) => sum + d.weight, 0) || 1
  const hitDims = scored.filter((d) => d.hit)
  const hitWeight = hitDims.reduce((sum, d) => sum + d.weight, 0)
  return {
    score: Math.round(40 + (60 * hitWeight) / totalWeight),
    reasons: hitDims.map((d) => d.label),
  }
}

/** 跨柜联动推荐：针对场合统一推荐衣橱+化妆品+配饰 */
function crossCabinetRecommend(profile, sessionId, occasion, tags = {}) {
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

  // 匹配逻辑：根据肤色/脸型/场合筛选。没填就是不知道——空值不参与筛选，也不拿假默认值把单品筛掉
  const skinTone = profile.skin_tone || ''
  const faceShape = profile.face_shape || ''
  const currentSeason = getCurrentSeason()
  // 该配金还是银：优先冷暖皮，档案里没有就退到算出来的四季型/十二型
  const metal = pickMetal(profile, tags)
  // 场合只认一个值：头部显示的与打分用的必须是同一个
  const occ = occasion || profile.occasion || '日常'

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
  const occasionStyle = occasionStyles[occ] || '百搭风格'

  // 衣橱推荐
  const outfitMatched = wardrobeItems
    .filter((item) => {
      const seasons = parseJsonField(item.season_tags) || []
      return seasons.length === 0 || seasons.includes(currentSeason)
    })
    .map((item) => ({
      name: item.name,
      category: cnCategory(item.category),
      ...scoreItem([
        {
          label: `${currentSeason}季可穿`,
          weight: 20,
          hit: tagHits(item.season_tags, currentSeason),
        },
        { label: '适合该场合', weight: 20, hit: tagHits(item.occasion_tags, occ) },
        {
          label: '风格与你相符',
          weight: 15,
          hit: tagHits(item.style_tags, profile.preferred_style),
        },
        { label: '衬你的体型', weight: 15, hit: tagHits(item.fit_body_types, profile.body_type) },
        { label: '这个色衬你的肤色', weight: 10, hit: tagHits(item.fit_skin_tones, skinTone) },
      ]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const outfitCategories = [...new Set(wardrobeItems.map((i) => cnCategory(i.category)))]
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
      return !skinTone || skinFit.length === 0 || tagHits(item.skin_tone_fit, skinTone)
    })
    .map((item) => ({
      name: item.name,
      category: cnCategory(item.category),
      ...scoreItem([
        { label: '适配你的肤色', weight: 25, hit: tagHits(item.skin_tone_fit, skinTone) },
        { label: '适配你的肤质', weight: 15, hit: tagHits(item.skin_type_fit, profile.skin_type) },
        { label: '适合该场合', weight: 20, hit: tagHits(item.occasion_tags, occ) },
        { label: expiryLabel(item), weight: 15, hit: withinExpiry(item) },
        { label: '衬你的眼型', weight: 10, hit: tagHits(item.eye_shape_fit, profile.eye_shape) },
      ]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const makeupCategories = [...new Set(cosmetics.map((i) => cnCategory(i.category)))]
  const essentialMakeup = ['粉底', '口红', '眉笔', '眼影']
  const makeupMissing = essentialMakeup.filter(
    (e) => !makeupCategories.some((c) => c && c.includes(e)),
  )

  // 配饰推荐
  const accessoryMatched = accessories
    .filter((item) => {
      const faceFit = parseJsonField(item.face_shape_fit) || []
      return !faceShape || faceFit.length === 0 || tagHits(item.face_shape_fit, faceShape)
    })
    .map((item) => ({
      name: item.name,
      category: cnCategory(item.category),
      ...scoreItem([
        { label: '衬你的脸型', weight: 25, hit: tagHits(item.face_shape_fit, faceShape) },
        {
          label: '长度适合你的颈长',
          weight: 10,
          hit: tagHits(item.neck_length_fit, profile.neck_length),
        },
        { label: '适合该场合', weight: 20, hit: tagHits(item.occasion_tags, occ) },
        {
          label: metal.basis ? `${metal.metal}色衬你(${metal.basis})` : '',
          weight: 15,
          hit: Boolean(metal.metal) && String(item.metal_color || '').includes(metal.metal),
        },
        { label: '这个色衬你的肤色', weight: 15, hit: tagHits(item.skin_tone_fit, skinTone) },
        { label: '低致敏材质', weight: 10, hit: Boolean(item.allergy_safe) },
      ]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const accessoryCategories = [...new Set(accessories.map((i) => cnCategory(i.category)))]
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
  if (metal.metal) {
    crossTips.push(`配饰金属色取${metal.metal}色（${metal.basis}）`)
  }
  if (outfitMissing.length > 0) {
    crossTips.push(`衣橱缺少${outfitMissing.join('、')}，影响整体搭配`)
  }

  return {
    occasion: occ,
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
      style: skinTone ? `${skinTone}肤色` : '肤色未填',
      matched: makeupMatched,
      missing: makeupMissing,
      suggestion:
        makeupMissing.length > 0
          ? `建议补充${makeupMissing.join('、')}等基础化妆品`
          : '化妆品齐全，可根据场合调整妆容浓淡',
    },
    accessory_advice: {
      style: faceShape ? `${faceShape}脸型` : '脸型未填',
      matched: accessoryMatched,
      missing: accessoryMissing,
      suggestion:
        accessoryMissing.length > 0
          ? `建议补充${accessoryMissing.join('、')}等百搭配饰`
          : '配饰充足，可尝试不同风格搭配',
    },
    full_look: buildFullLook(
      { outfit: outfitMatched, makeup: makeupMatched, accessory: accessoryMatched },
      occ,
    ),
    metal: metal.metal ? { color: metal.metal, basis: metal.basis } : null,
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
      'SELECT brand, COUNT(*) as count FROM user_cosmetics WHERE session_id = ? AND brand IS NOT NULL AND length(brand) > 0 GROUP BY brand ORDER BY count DESC LIMIT 10',
    )
    .all(sessionId)
  const cosmeticBrands = cosmetics.map((r) => ({ brand: r.brand, count: r.count }))

  // 统计配饰品牌
  const accessories = db
    .prepare(
      'SELECT brand, COUNT(*) as count FROM user_accessories WHERE session_id = ? AND brand IS NOT NULL AND length(brand) > 0 GROUP BY brand ORDER BY count DESC LIMIT 10',
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
  const wardrobeCategories = [
    ...new Set(wardrobeItems.map((i) => cnCategory(i.category)).filter(Boolean)),
  ]
  wardrobeScore = Math.min(100, wardrobeItems.length * 5 + wardrobeCategories.length * 10)

  // 化妆品评分：基于数量和保质期
  const now = new Date()
  let safeCount = 0
  const cosmeticCategories = new Set()
  const expiredItems = []
  for (const item of cosmetics) {
    cosmeticCategories.add(cnCategory(item.category))
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
  const accessoryCategories = [
    ...new Set(accessories.map((a) => cnCategory(a.category)).filter(Boolean)),
  ]
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

    const given = {}
    for (const key of [
      'skin_tone',
      'face_shape',
      'occasion',
      'body_type',
      'preferred_style',
      'skin_type',
      'neck_length',
      'eye_shape',
    ]) {
      const value = req.query[key]
      if (typeof value === 'string' && value.trim()) given[key] = value.trim()
    }
    const occasion = req.query.occasion || null

    // 长期档案打底：只填过一次的肤色/体型/眼型不用每次重填
    const userId = req.user ? req.user.id : null
    const tagRows = loadTags(userId)
    const tags = {}
    for (const t of tagRows) tags[t.key] = t.value
    const merged = mergeWithArchive(given, loadArchive(userId))

    const result = crossCabinetRecommend(merged.profile, sessionId, occasion, tags)
    return sendSuccess(res, {
      ...result,
      archive: {
        // 本次沿用了档案里的哪些条件(中文名),供前端说明"没填也能算"
        used_fields: merged.used,
        // 档案里算出来的结论标签,金属色这类判断的依据就在这里
        tags: tagRows,
      },
    })
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
