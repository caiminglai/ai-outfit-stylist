/**
 * 个人衣橱路由模块（AIWardrobe 模式）
 * 对应 Python: app/routes/wardrobe.py
 *
 * 功能：衣橱单品 CRUD、搭配组合、缺口分析、购物评估、购物推荐、衣橱匹配、心愿单、个人推荐
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { buildRecommendation, recommendationBodyDeviation } = require('../services/recommendEngine')
const {
  topFitBody,
  isTopCategory,
  FIT_TYPE_VALUES,
  FABRIC_WEIGHT_VALUES,
} = require('../services/topFitBody')
const {
  getSessionId,
  parseJsonField,
  getCurrentSeason,
  asText,
  asNumber,
  asFilters,
  firstBadScalar,
  tally,
  asId,
  projectWardrobeForEngine,
} = require('../utils/common')
const { countByBucket, wardrobeGapBuckets } = require('../services/categoryBuckets')
const { rateLimit } = require('../middleware/rateLimit')
// 10-20 第八阶段·一c：日记要写 user_id（游客也有行，认不到就 NULL），星级尺子从反馈那一层引
const { optionalUser, getCurrentUser } = require('../middleware/auth')
const { SCORE_MIN, SCORE_MAX } = require('../services/ruleFeedback')
// 10-21 第九阶段·第一步：场合词表搬到 utils 当唯一真相源（日记与新那张 item_feedback 共用）
const { occasionValues } = require('../utils/occasionVocab')
// 10-21 第十一阶段·第一步：日记三格（穿着日期／体感温度／天气档）的校验与词表同源件
const { WEATHER_LEVELS } = require('../services/weatherService')
const { readOutfitWeather, readOutfitWeatherPatch } = require('../utils/outfitWeather')

const router = express.Router()

// 写操作限流：每分钟最多 30 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, message: '操作过于频繁，请稍后再试' })
// 六个吃 CPU 的分析口（/gaps /evaluate /suggest /match /recommend /top-fit）。
// 原来只有全局 100 次/15 分钟那道共享 IP 闸兜着，而它按 IP 分桶——出口是 CGNAT，
// 一个 IP 后面是一片人，一个人连点分析就能把整栋楼挤出额度（2026-10-12 补）。
// 单独一个桶，是为了不和写入口的 30 次共用：加满 30 件衣服不该让人下一步分析被拦。
const analysisLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: '分析请求过于频繁，请稍后再试',
})

/**
 * 原样绑进 user_wardrobe 的可空标量列。
 * JSON 列表字段先 stringify、fit_style/fabric_weight 走 sanitizeEnum、is_favorite 转 0/1，
 * 都不会绑崩；只有这些"直接进 SQL 参数"的字段需要进门挡一次类型。
 */
const WARDROBE_SCALARS = [
  'name',
  'category',
  'sub_category',
  'color',
  'pattern',
  'condition',
  'price',
  'image_url',
  'sku',
  'shoulder_cm',
  'bust_cm',
  'length_cm',
  'waistband_cm',
]

/**
 * 成衣实测尺寸四格（2026-10-19 第二阶段「最后一公里」新增的列）。
 *
 * 上衣修形向量现在**只从这四格 + 两个真字段（color/fabric_weight）算**
 * （`services/topFitBody.js` 的 `describeTop`）：成品肩宽、成品胸围、衣长、腰头高，
 * 减去人体净尺寸就是"这件往哪个方向修、修多少"。
 * 改前这几维靠认中文商品名（"宽松""落肩""oversize"）—— 同一件衣服换个写法差两三十分，是伪量化。
 *
 * 口径：单位 cm；没填 = NULL = 这一维不进分（docs/依据/README.md:64「缺测不出分」（硬规矩 2））。
 * ⚠️ `waistband_cm` 的 0 是一个真实结论（"这件没有腰头/收口"），所以它的下限是 0；
 *    其余三格的 0 只能当"没量"，不允许当 0cm 的成衣。
 * 区间只挡明显敲错的数（把 39 敲成 390），不参与打分。
 */
const GARMENT_MEASURES = [
  { key: 'shoulder_cm', label: '衣服肩宽', min: 15, max: 70 },
  { key: 'bust_cm', label: '衣服胸围', min: 50, max: 160 },
  { key: 'length_cm', label: '衣服衣长', min: 25, max: 160 },
  { key: 'waistband_cm', label: '腰头/收口高', min: 0, max: 60 },
]

/** 四格实测尺寸的进门校验：没填放行，填了不是数或敲飞了 ⇒ 一句人话 + 400，不静默抹成 NULL */
function measureError(data) {
  for (const m of GARMENT_MEASURES) {
    const raw = data[m.key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = asNumber(raw, NaN)
    if (!Number.isFinite(n))
      return `${m.label}只能填数字（单位 cm），收到的是「${String(raw).slice(0, 20)}」`
    if (n < m.min || n > m.max) {
      return `${m.label}只能填 ${m.min}~${m.max} cm（单位是厘米，收到的是 ${n}）`
    }
  }
  return null
}

/** 落库存值：空 = NULL（没量），填了的数收成一位小数，免得界面出现 39.000000001 */
function measureValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = asNumber(raw, null)
  return n === null ? null : Math.round(n * 10) / 10
}

/** 心愿单与搭配两张表的原样标量列 */
const WISHLIST_SCALARS = ['category', 'color', 'reason', 'priority', 'gap_type']
// 2026-10-21 第十一阶段·第一步（docs/依据/19 §四）：日记加了三格，一并进这道"只能是文本或数字"的闸，
// 否则 `{"wear_date":{}}` 这种载荷会原样进 TEXT 列（值的形状由 utils/outfitWeather 再判一道）。
const OUTFIT_SCALARS = ['occasion', 'season', 'notes', 'wear_date', 'weather_level', 'feels_like_c']

/**
 * 穿搭日记（`wardrobe_outfits`）的场合值域＝**规则库在用的那一组词**，每次现从库里取。
 *
 * 为什么不在这里抄一份常量表：`rule_conditions` 里 `field='occasion'` 的 `value` 存的是 JSON 串
 * （现量 10-20 本机库：`"上班通勤" / "约会聚会" / "婚礼宴会" / "运动健身" / "居家休闲"` 五个词），
 * 规则命中的就是那个串。日记若收了表外的词，采下来也命不中任何一条规则 ⇒ 白采（这正是
 * docs/依据/16 §〇 说的"造了新词规则侧命不上"）。抄第二份值表还会留下"改了那边忘了这边"。
 *
 * 🔴 2026-10-21 第九阶段·第一步：函数体搬到 `utils/occasionVocab.js`（同名同口径），
 * 因为 `item_feedback`（`docs/依据/17` §二）也要收同一组词当值域——两处各抄一份就是两个真相源。
 * 这里留一个同名薄壳，本文件其余 6 个调用点一个字不改。
 * ⚠️ 取不到词时**只许留空**，不收自由文本——宁缺不猜，缺测不出分那条。
 */
function outfitOccasionValues() {
  return occasionValues()
}

/**
 * 搭配表（穿搭日记）的归属过滤条件——**读／改／删三处共用同一把尺子**（10-20 第八阶段·一c）。
 *
 * 为什么要 `session_id OR user_id` 两条口径：历史行 `user_id` 全 NULL（老 INSERT 没写这一列），
 * 从本轮起新行带 `user_id`；只按 session 取 ⇒ 换设备/清 session 就看不见自己前面记的，
 * 只按 user 取 ⇒ 把游客期（NULL）的整段扔掉。⛔ 三处不许各写各的 WHERE：
 * GET 看得见、PUT 回 404（或反过来）就是"两层各算一遍算出两个答案"那一类病灶。
 *
 * ⚠️ 传入的 user 只准来自 `getCurrentUser`（只读），不准用 `optionalUser`——
 * 后者会给认不到的 session **造一行 users**，读接口与"这条不是你的"的判定都不该有写库副作用。
 */
function outfitOwnershipFilter(user) {
  return user
    ? { sql: ' AND (session_id = ? OR user_id = ?)', args: (sessionId) => [sessionId, user.id] }
    : { sql: ' AND session_id = ?', args: (sessionId) => [sessionId] }
}

/** 日记星级进门校验：1~5 整数或空；越界说破（与反馈两把星同一把尺子，上下界从 ruleFeedback 引） */
function ratingError(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
    return `评分只能是 ${SCORE_MIN}~${SCORE_MAX} 的整数星级，收到的是「${String(raw).slice(0, 12)}」`
  }
  return null
}

/** 落库值：空＝NULL（没打），越界＝NULL（进门已被 ratingError 拦掉，这里只是兜底不写脏数） */
function ratingValue(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX ? n : null
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 版型与面料厚薄两档只认死值，认不到就当没填（缺测不编造，见 docs/依据/08 §10.1）。
 * 值域按 Sakata/Kim/Takatera 2020 实测的两种剪裁走向 + 常用厚薄三档。
 *
 * ⚠️ 10-19 第三阶段起有**两个**版型列，别混：
 *   · `fit_style`（合体/宽松）——老的展示标签，不再进任何算式（值域两档撑不起四档松量）。
 *   · `fit_type`（修身/合身/宽松/廓形）——评分唯一认的版型列，值表就是
 *     `services/topFitBody.js` 的 `FIT_TYPE_VALUES`（引它，不在这儿抄第二遍）。
 * 后端**不强制必填**（库里存量行没有这一列，硬拦会把老数据的 PUT 全打回）；
 * "必填"这条闸门落在前端表单（WardrobeTab 的 fitTypeError），后端只拦畸形值。
 */
const FIT_STYLE_VALUES = ['合体', '宽松']
// 🔴 10-21 第十一阶段·第一步：厚薄三档的值表搬到 `services/topFitBody.js` 当唯一真相源
// （`FABRIC_WEIGHT_VALUES`），因为偏好层的 `warmth` 轴也要认这三个词。
// 原来在这里抄一份＝两处各写一遍，改了录入校验忘了算分侧正是本项目反复清扫的病灶。

function sanitizeEnum(val, allowedVals) {
  const v = typeof val === 'string' ? val.trim() : ''
  return allowedVals.includes(v) ? v : null
}

/**
 * 枚举列的进门校验：没填 / 填空 / 值在表内 → 放行（这列留 NULL，缺测不编造）；
 * 填了却不认识 → 回一句人话，由调用方转 400。
 * 原来只有 sanitizeEnum 一层：PUT 传 fit_style='紧身' 被静默归成 NULL，把用户已填好的
 * '合体' 抹掉，而前端只看 HTTP 200 就弹「已保存修改」（10-13 现量）。
 * 前端两个下拉的取值与下面两张值表逐字一致 ⇒ 拦 400 只挡畸形请求，挡不到真实用户。
 */
function enumError(value, allowedVals, label) {
  if (value === undefined || value === null) return null
  const v = asText(value)
  if (v === '' || allowedVals.includes(v)) return null
  return `${label} 只能是 ${allowedVals.join('/')}，收到的是「${v.slice(0, 20)}」`
}

/** 三格枚举轴一起查（版型两列＋面料厚薄），返回第一条错误话术（没有则 null） */
function volumeAxisError(data) {
  return (
    enumError(data.fit_style, FIT_STYLE_VALUES, 'fit_style') ||
    enumError(data.fit_type, FIT_TYPE_VALUES, 'fit_type') ||
    enumError(data.fabric_weight, FABRIC_WEIGHT_VALUES, 'fabric_weight')
  )
}

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

    // 三个筛选项都过 asFilters：数组型查询串（?category[]=上衣）原样绑进 SQLite 会 500，
    // 非文本当"没这个筛选"
    const { category, season, occasion } = asFilters(req.query, ['category', 'season', 'occasion'])
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
    const name = asText(data.name)
    const category = asText(data.category)
    if (!name || !category) {
      return sendError(res, 'name 和 category 不能为空', 400)
    }

    const bad = firstBadScalar(data, WARDROBE_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    // 版型/厚薄填了却不认识 ⇒ 说破，别再经 sanitizeEnum 归成 NULL 假装"没填"（见 enumError）
    const axisErr = volumeAxisError(data)
    if (axisErr) return sendError(res, axisErr, 400)
    // 四格实测尺寸同理：敲了个不是数的东西要 400，不能悄悄落成 NULL
    const measureErr = measureError(data)
    if (measureErr) return sendError(res, measureErr, 400)

    const result = db
      .prepare(
        `INSERT INTO user_wardrobe
        (session_id, name, category, sub_category, color, color_tags, pattern,
         fit_style, fabric_weight,
         shoulder_cm, bust_cm, length_cm, waistband_cm, fit_type,
         style_tags, season_tags, occasion_tags, fit_body_types, fit_skin_tones,
         \`condition\`, price, image_url, sku)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        name,
        category,
        data.sub_category || null,
        data.color || null,
        JSON.stringify(data.color_tags || []),
        data.pattern || null,
        sanitizeEnum(data.fit_style, FIT_STYLE_VALUES),
        sanitizeEnum(data.fabric_weight, FABRIC_WEIGHT_VALUES),
        measureValue(data.shoulder_cm),
        measureValue(data.bust_cm),
        measureValue(data.length_cm),
        measureValue(data.waistband_cm),
        sanitizeEnum(data.fit_type, FIT_TYPE_VALUES),
        JSON.stringify(data.style_tags || []),
        JSON.stringify(data.season_tags || []),
        JSON.stringify(data.occasion_tags || []),
        JSON.stringify(data.fit_body_types || []),
        JSON.stringify(data.fit_skin_tones || []),
        data.condition || '良好',
        // 0 元是真实价格（自制/赠品），`|| null` 会把它记成"没填" ⇒ 跨柜价格区间少算一件
        asNumber(data.price, null),
        // 照片地址（第五阶段·第一步「拍照只存图」前端开始写这一格）：原来 `data.image_url || null`
        // 会把 {} / [] 这类真值原样绑进 SQLite ⇒ RangeError ⇒ 整条 500（与 sku 同一个洞）。
        // asText 之后空串落 NULL＝这件没拍照。
        asText(data.image_url) || null,
        // 扫码录入那一格：空串＝没扫＝落 NULL（与四格实测尺寸同一口径，不拿 '' 冒充有值）
        asText(data.sku) || null,
      )

    const item = db.prepare('SELECT * FROM user_wardrobe WHERE id = ?').get(result.lastInsertRowid)
    return sendCreated(res, normalizeItem(item), `${req.baseUrl}/items/${item.id}`)
  } catch (err) {
    console.error('[衣橱] 添加失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/**
 * 扫码查重（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
 *
 * 一次扫描要同时问两张表，因为"这件我有没有"和"这件是什么"是两个问题：
 *   ① `user_wardrobe` 同 session_id + 同 sku ⇒ 有了就别再录一遍（返回 `in_wardrobe` 让前端说破）；
 *   ② `inventory_products` 同 sku 且上架 ⇒ 把名称/品类/颜色/图/价带进表单，店员不用从头敲。
 *
 * ⚠️ ② 现在**不分店**：`inventory_products` 没有 `store_id` 这一列（全仓 ALTER/CREATE 现量 0 处），
 *    多家店共用一张库存表时这里会把别店的同款也带出来 ⇒ 要不要按分店记账等拍板（本轮台账登记）。
 * ⛔ sku 两格都不建唯一索引（同一人可以有两件同款、游客还共用会话）⇒ "扫重了"只在读这一侧提醒，
 *    写入口一律不拦；真正防止重复靠调用方先看 `in_wardrobe`。
 */
router.get('/sku', (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 X-Session-Id', 400)
    // asText：数字条码(6901234567890)转文本、数组/对象当"没带参数"、顺带去首尾空格
    //（扫码枪有时会附一个空格或换行，不去就查不到自己刚录的那格）。
    const sku = asText(req.query.sku)
    if (!sku) return sendError(res, 'sku 不能为空', 400)

    const mine = db
      .prepare(
        'SELECT * FROM user_wardrobe WHERE session_id = ? AND sku = ? ORDER BY created_at DESC',
      )
      .all(sessionId, sku)
      .map(normalizeItem)

    const INVENTORY_JSON = ['style_tags', 'color_tags', 'season_tags', 'fit_skin_tones']
    const store = db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.style_tags, p.color_tags, p.season_tags,
                p.fit_skin_tones, p.price, p.image_url, p.stock,
                c.code AS category_code, c.name AS category_name
           FROM inventory_products p
           LEFT JOIN inventory_categories c ON p.category_id = c.id
          WHERE p.sku = ? AND p.enabled = 1
          ORDER BY p.created_at DESC
          LIMIT 20`,
      )
      .all(sku)
      .map((p) => {
        const obj = { ...p }
        for (const field of INVENTORY_JSON) obj[field] = parseJsonField(p[field]) || []
        return obj
      })

    return sendSuccess(res, {
      sku,
      mine,
      store,
      in_wardrobe: mine.length > 0,
      in_inventory: store.length > 0,
    })
  } catch (err) {
    console.error('[衣橱] 扫码查重失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 获取单件衣服详情 */
router.get('/items/:itemId', (req, res) => {
  try {
    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
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
    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    const data = req.body || {}

    // 与 POST 同一把闸门：下面按 allowed 原样绑值，类型写错该 400 而不是 500
    const bad = firstBadScalar(data, WARDROBE_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    // 版型/厚薄同样先验值：认不出来就 400，不许静默把已有的好值抹成 NULL
    const axisErr = volumeAxisError(data)
    if (axisErr) return sendError(res, axisErr, 400)
    const measureErr = measureError(data)
    if (measureErr) return sendError(res, measureErr, 400)

    // 允许更新的字段
    const allowed = {
      name: 'name',
      category: 'category',
      sub_category: 'sub_category',
      color: 'color',
      color_tags: 'color_tags',
      pattern: 'pattern',
      fit_style: 'fit_style',
      fabric_weight: 'fabric_weight',
      shoulder_cm: 'shoulder_cm',
      bust_cm: 'bust_cm',
      length_cm: 'length_cm',
      waistband_cm: 'waistband_cm',
      fit_type: 'fit_type',
      style_tags: 'style_tags',
      season_tags: 'season_tags',
      occasion_tags: 'occasion_tags',
      fit_body_types: 'fit_body_types',
      fit_skin_tones: 'fit_skin_tones',
      condition: '`condition`',
      price: 'price',
      image_url: 'image_url',
      sku: 'sku',
      is_favorite: 'is_favorite',
    }

    const jsonListKeys = [
      'color_tags',
      'style_tags',
      'season_tags',
      'occasion_tags',
      'fit_body_types',
      'fit_skin_tones',
    ]

    const updates = []
    const params = []
    for (const [key, col] of Object.entries(allowed)) {
      // undefined = 这次没动这一格；null = 用户明确要清空。
      // 原来把 null 也当"没动"跳过去：前端清掉一个选填项后 PUT 不带它 ⇒ 库里旧值留着，
      // 界面按表单显示"已空"，两边各说各话（WardrobeTab 的 buildPayload 同一处修法）。
      if (data[key] !== undefined) {
        const raw = data[key]
        let val
        if (raw === null) {
          // 显式清空：JSON 列表列也存 NULL，不存字符串 'null'（那会被 parseJsonField 读回 null，
          // 但按文本比对的老代码会当它有值）
          val = null
        } else if (jsonListKeys.includes(key)) {
          val = JSON.stringify(raw)
        } else if (key === 'is_favorite') {
          val = raw ? 1 : 0
        } else if (key === 'fit_style') {
          val = sanitizeEnum(raw, FIT_STYLE_VALUES)
        } else if (key === 'fit_type') {
          // 版型（评分认的那一列）：认不到值域就落成 NULL＝不估，绝不"就近归档"成某一档
          val = sanitizeEnum(raw, FIT_TYPE_VALUES)
        } else if (key === 'fabric_weight') {
          val = sanitizeEnum(raw, FABRIC_WEIGHT_VALUES)
        } else if (key === 'price') {
          // 0 元是真实价格，'1,200' 这类脏值归 NULL：与 POST、配饰/化妆柜、inventory 同一把尺子
          val = asNumber(raw, null)
        } else if (GARMENT_MEASURES.some((m) => m.key === key)) {
          // 实测尺寸与 POST 同一个口径：空串按"清空"落 NULL，脏值已在进门处 400 掉了
          val = measureValue(raw)
        } else if (key === 'sku') {
          // 与 POST 同一口径：空串/纯空格＝清掉这一格（这件不再是扫码来的），数字条码转文本
          val = asText(raw) || null
        } else if (key === 'image_url') {
          // 与 POST 同一口径：非文本归 NULL、空串＝摘掉这张图（"不挂这张"按钮走的就是这里）
          val = asText(raw) || null
        } else {
          val = raw
        }
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
    const itemId = asId(req.params.itemId)
    if (itemId === null) return sendError(res, 'itemId 必须是正整数', 400)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)

    // item_ids 是指向 user_wardrobe.id 的真引用（POST /outfits 逐条验过归属，存的是整数数组），
    // 但删衣服原来只删这一行 ⇒ 本人搭配里留下指向空行的 id，GET /outfits 把这些洞原样发出去。
    // 同一个事务里把这个 id 从本人所有搭配剔掉；剔完一件不剩的搭配没有存在意义
    // （POST 要求至少一件、且 name 与 item_ids 同时非空），连行一起删。
    const removeItem = db.transaction(() => {
      const result = db
        .prepare('DELETE FROM user_wardrobe WHERE id = ? AND session_id = ?')
        .run(itemId, sid)
      if (result.changes === 0) return null
      let scrubbed = 0
      let emptied = 0
      const outfits = db
        .prepare('SELECT id, item_ids FROM wardrobe_outfits WHERE session_id = ?')
        .all(sid)
      for (const o of outfits) {
        const ids = parseJsonField(o.item_ids)
        if (!Array.isArray(ids) || !ids.some((x) => Number(x) === itemId)) continue
        const rest = ids.filter((x) => Number(x) !== itemId)
        if (rest.length === 0) {
          db.prepare('DELETE FROM wardrobe_outfits WHERE id = ?').run(o.id)
          emptied += 1
        } else {
          db.prepare('UPDATE wardrobe_outfits SET item_ids = ? WHERE id = ?').run(
            JSON.stringify(rest),
            o.id,
          )
          scrubbed += 1
        }
      }
      return { scrubbed, emptied }
    })

    const dependents = removeItem()
    if (!dependents) return sendError(res, '衣服不存在', 404)
    return sendSuccess(res, { deleted: true, ...dependents })
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

    // 🔴 10-20 第八阶段·一c：归属口径抽成 `outfitOwnershipFilter`，与下面的 PUT/DELETE 共用一把尺子
    // （为什么是「session 或 user」两条口径取并集、以及这里为什么用 `getCurrentUser` 不用
    //   `optionalUser`，都写在那个小头的注释里，不在三处各讲一遍）。
    const own = outfitOwnershipFilter(getCurrentUser(req))
    const outfits = db
      .prepare(`SELECT * FROM wardrobe_outfits WHERE 1 = 1${own.sql} ORDER BY created_at DESC`)
      .all(...own.args(sessionId))

    // 解析 item_ids
    const normalized = outfits.map((o) => ({
      ...o,
      item_ids: parseJsonField(o.item_ids) || [],
      is_favorite: !!o.is_favorite,
    }))

    // 🔴 10-20 第八阶段·一d：把这一轮 POST/PUT 实际认的场合词表一起带出去。
    // 前端下拉必须**与闸门同源**：抄第二份词表＝"改了那边忘了这边"（本轮清扫的那类病灶），
    // 而词表在库里，只有后端每次现取才保证"下拉里出现的一定收、收不了的一定不出现"。
    const occasions = outfitOccasionValues()

    return sendSuccess(res, {
      outfits: normalized,
      count: normalized.length,
      occasions,
      // 🔴 10-21 第十一阶段·第一步：天气档的词表也**与闸门同源**带出去（同一句理由见上面 occasions）。
      // 前端那五个按钮必须从这里拿，⛔ 不许在 `app/src` 里抄第二份"寒冷/偏凉/…"——
      // 阈值与档位唯一的真相源在 `services/weatherService.js`（docs/依据/19 §三 第 1 条）。
      weather_levels: WEATHER_LEVELS,
    })
  } catch (err) {
    console.error('[衣橱] 查询搭配失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/** 创建一套搭配 */
router.post('/outfits', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    const name = asText(data.name)
    // item_ids 是指向 user_wardrobe.id 的真引用，原来只判 `!itemIds.length`：
    // ① 传字符串 "123" 也有 .length ⇒ 整串 JSON 进库，前端解析出来是一堆单字符；
    // ② 传别人的 ID 照样入库 ⇒ 一套搭配里能挂进陌生人的单品（GET 按 session 取，
    //    但 admin 源码/导出看得到，且后续按 ID 取详情的口子不认归属）；
    // ③ 不带体积上限 ⇒ 一份 10MB 数组直接进 TEXT 列。
    // 三样一起收：必须是数组、元素必须是正整数、去重后≤50 件、且都属于当前会话。
    if (!Array.isArray(data.item_ids) || data.item_ids.length === 0) {
      return sendError(res, 'name 和 item_ids 不能为空', 400)
    }
    if (data.item_ids.length > 50) {
      return sendError(res, '一套搭配最多 50 件单品', 400)
    }
    const itemIds = []
    for (const raw of data.item_ids) {
      const n = asNumber(raw, NaN)
      if (!Number.isInteger(n) || n <= 0) {
        return sendError(res, 'item_ids 只能是衣物 ID 整数', 400)
      }
      if (!itemIds.includes(n)) itemIds.push(n)
    }
    if (!name) {
      return sendError(res, 'name 和 item_ids 不能为空', 400)
    }

    const owned = db
      .prepare('SELECT id FROM user_wardrobe WHERE session_id = ?')
      .all(sessionId)
      .map((r) => r.id)
    const ownedSet = new Set(owned)
    const foreign = itemIds.filter((id) => !ownedSet.has(id))
    if (foreign.length > 0) {
      return sendError(res, `搭配里有不属于当前会话的衣物：${foreign.join(', ')}`, 400)
    }

    const bad = firstBadScalar(data, OUTFIT_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    // 🔴 10-20 第八阶段·一c 三件补齐（规范 docs/依据/16 §四）：
    // ① 场合只收规则库在用的那组词（表外词命不中任何规则 ⇒ 采了白采，所以拦成 400 而不是落成 NULL）；
    // ② 星级 1~5 复用反馈那一层的尺子（SCORE_MIN/SCORE_MAX），越界说破；
    // ③ user_id 由 optionalUser 取——**不信前端传来的 user_id**，游客也给他一行（auth.js 的 ensureGuestUser）。
    const occasions = outfitOccasionValues()
    if (data.occasion !== undefined && data.occasion !== null && asText(data.occasion) !== '') {
      if (occasions.length === 0) {
        return sendError(res, '场合词表还没建好，这一格先留空', 400)
      }
      const oErr = enumError(data.occasion, occasions, 'occasion')
      if (oErr) return sendError(res, oErr, 400)
    }
    const rErr = ratingError(data.rating)
    if (rErr) return sendError(res, rErr, 400)
    // 🔴 10-21 第十一阶段·第一步（docs/依据/19 §三）：三格全可选，给不出合法值就 400 说破，
    // ⛔ 不许静默落 NULL"当没事发生"、⛔ 不许拿 created_at 顶替 wear_date、⛔ 两格不自洽不许各留一半。
    const w = readOutfitWeather(data)
    if (!w.ok) return sendError(res, w.error, 400)
    const user = optionalUser(req)

    const result = db
      .prepare(
        `INSERT INTO wardrobe_outfits (session_id, user_id, name, item_ids, occasion, season, rating, notes,
         wear_date, feels_like_c, weather_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        user ? user.id : null,
        name,
        JSON.stringify(itemIds),
        sanitizeEnum(data.occasion, occasions),
        data.season || null,
        ratingValue(data.rating),
        data.notes || null,
        w.fields.wear_date,
        w.fields.feels_like_c,
        w.fields.weather_level,
      )

    const outfit = db
      .prepare('SELECT * FROM wardrobe_outfits WHERE id = ?')
      .get(result.lastInsertRowid)
    return sendCreated(
      res,
      {
        ...outfit,
        item_ids: parseJsonField(outfit.item_ids) || [],
        is_favorite: !!outfit.is_favorite,
      },
      null,
      '搭配已创建',
    )
  } catch (err) {
    console.error('[衣橱] 创建搭配失败:', err)
    return sendError(res, '创建失败', 500)
  }
})

/**
 * 更新一套搭配（10-20 第八阶段·一c，规范 docs/依据/16 §四）。
 *
 * 三条口径与衣橱单品 PUT 完全对齐，不另起尺子：
 * · **字段级 `undefined＝不动／null＝清空`**（L730 那条修法）；
 * · **越权回 404 不回 403**——403 会告诉脚本"这一行存在、只是不是你的"，等于把 ID 空间白送；
 * · 值域闸门与 POST 同一把（场合表外词 400、星级越界 400），拦在进门而不是静默抹成 NULL，
 *   否则"用户改错了 ⇒ 旧值被抹掉 ⇒ 前端只看 200 弹已保存"这一课会在这里重演。
 *
 * `name`/`item_ids` 两列在 DDL 里是 NOT NULL（schema.sql:389-390），所以这两格**不接受清空**：
 * 传 null 会撞约束、报成 500，所以显式 400 说破（其余五格可空，NULL 就是"没填"）。
 */
router.put('/outfits/:outfitId', writeLimiter, (req, res) => {
  try {
    const outfitId = asId(req.params.outfitId)
    if (outfitId === null) return sendError(res, 'outfitId 必须是正整数', 400)
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 Session ID', 400)
    const data = req.body || {}

    const own = outfitOwnershipFilter(getCurrentUser(req))
    const existing = db
      .prepare(`SELECT * FROM wardrobe_outfits WHERE id = ?${own.sql}`)
      .get(outfitId, ...own.args(sessionId))
    if (!existing) return sendError(res, '搭配不存在', 404)

    const bad = firstBadScalar(data, OUTFIT_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    const occasions = outfitOccasionValues()
    if (data.occasion !== undefined && asText(data.occasion) !== '') {
      if (occasions.length === 0) {
        return sendError(res, '场合词表还没建好，这一格先留空', 400)
      }
      const oErr = enumError(data.occasion, occasions, 'occasion')
      if (oErr) return sendError(res, oErr, 400)
    }
    const rErr = ratingError(data.rating)
    if (rErr) return sendError(res, rErr, 400)
    // 🔴 10-21 第十一阶段·第一步：三格按"提到过的才动"半更，一致性闸门在**合并后**判
    // （只改温度不改档的那一次请求，必须拿库里现存的档一起来比，否则闸门被绕过一半）
    const wp = readOutfitWeatherPatch(data, existing)
    if (!wp.ok) return sendError(res, wp.error, 400)

    const updates = []
    const params = []
    const put = (col, val) => {
      updates.push(`${col} = ?`)
      params.push(val)
    }

    if (data.name !== undefined) {
      const n = asText(data.name)
      if (!n) return sendError(res, 'name 不能为空（这一列在库里就是必填）', 400)
      put('name', n)
    }
    if (data.item_ids !== undefined) {
      // 与 POST 同一套三件校验：数组、正整数、去重后≤50、且都属于当前会话
      if (!Array.isArray(data.item_ids) || data.item_ids.length === 0) {
        return sendError(res, 'item_ids 不能为空（这一列在库里就是必填）', 400)
      }
      if (data.item_ids.length > 50) return sendError(res, '一套搭配最多 50 件单品', 400)
      const ids = []
      for (const raw of data.item_ids) {
        const n = asNumber(raw, NaN)
        if (!Number.isInteger(n) || n <= 0)
          return sendError(res, 'item_ids 只能是衣物 ID 整数', 400)
        if (!ids.includes(n)) ids.push(n)
      }
      const ownedSet = new Set(
        db
          .prepare('SELECT id FROM user_wardrobe WHERE session_id = ?')
          .all(sessionId)
          .map((r) => r.id),
      )
      const foreign = ids.filter((id) => !ownedSet.has(id))
      if (foreign.length > 0) {
        return sendError(res, `搭配里有不属于当前会话的衣物：${foreign.join(', ')}`, 400)
      }
      put('item_ids', JSON.stringify(ids))
    }
    if (data.occasion !== undefined) put('occasion', sanitizeEnum(data.occasion, occasions))
    if (data.season !== undefined) put('season', asText(data.season) || null)
    if (data.notes !== undefined) put('notes', asText(data.notes) || null)
    if (data.rating !== undefined) put('rating', ratingValue(data.rating))
    if (data.is_favorite !== undefined) put('is_favorite', data.is_favorite ? 1 : 0)
    for (const [col, val] of wp.patch) put(col, val)

    if (updates.length === 0) return sendError(res, '没有需要更新的字段', 400)

    const result = db
      .prepare(`UPDATE wardrobe_outfits SET ${updates.join(', ')} WHERE id = ?${own.sql}`)
      .run(...params, outfitId, ...own.args(sessionId))
    if (result.changes === 0) return sendError(res, '搭配不存在', 404)

    const outfit = db.prepare('SELECT * FROM wardrobe_outfits WHERE id = ?').get(outfitId)
    return sendSuccess(res, {
      ...outfit,
      item_ids: parseJsonField(outfit.item_ids) || [],
      is_favorite: !!outfit.is_favorite,
    })
  } catch (err) {
    console.error('[衣橱] 更新搭配失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

/**
 * 删除一套搭配（10-20 第八阶段·一c）。
 * ⛔ 只删 `wardrobe_outfits` 这一行，**绝不动 `user_wardrobe` 里的衣物**——
 * 搭配是"这几件这么穿"的一条记法，衣物本身是资产；反过来删衣物会连带剔搭配（见 DELETE /items/:itemId）。
 * 归属与越权口径与 PUT 一致：404 不 403。
 */
router.delete('/outfits/:outfitId', writeLimiter, (req, res) => {
  try {
    const outfitId = asId(req.params.outfitId)
    if (outfitId === null) return sendError(res, 'outfitId 必须是正整数', 400)
    const sessionId = getSessionId(req)
    if (!sessionId) return sendError(res, '缺少 Session ID', 400)

    const own = outfitOwnershipFilter(getCurrentUser(req))
    const result = db
      .prepare(`DELETE FROM wardrobe_outfits WHERE id = ?${own.sql}`)
      .run(outfitId, ...own.args(sessionId))
    if (result.changes === 0) return sendError(res, '搭配不存在', 404)
    return sendSuccess(res, { deleted: true, id: outfitId })
  } catch (err) {
    console.error('[衣橱] 删除搭配失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

// ============================================================
// 三、衣橱缺口分析
// ============================================================

router.post('/gaps', analysisLimiter, (req, res) => {
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

router.post('/evaluate', analysisLimiter, (req, res) => {
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

router.post('/suggest', analysisLimiter, (req, res) => {
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

router.post('/match', analysisLimiter, (req, res) => {
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

    // 同 /items：数组型查询串绑进 SQLite 会 500，非文本当"没这个筛选"
    const { status } = asFilters(req.query, ['status'])
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
router.post('/wishlist', writeLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 session_id', 400)
    }

    const data = req.body || {}
    // 前端 ShoppingWishlistItem 字段名为 name，兼容 item_name
    const itemName = asText(data.name) || asText(data.item_name)
    if (!itemName) {
      return sendError(res, 'name 不能为空', 400)
    }

    const bad = firstBadScalar(data, WISHLIST_SCALARS)
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

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
    return sendCreated(res, wish)
  } catch (err) {
    console.error('[衣橱] 添加心愿失败:', err)
    return sendError(res, '添加失败', 500)
  }
})

/** 更新心愿单状态 */
router.put('/wishlist/:wishId', writeLimiter, (req, res) => {
  try {
    const wishId = asId(req.params.wishId)
    if (wishId === null) return sendError(res, 'wishId 必须是正整数', 400)
    const sid = getSessionId(req)
    if (!sid) return sendError(res, '缺少 Session ID', 400)
    // status 给成数组/对象时过去会绑进 SQL ⇒ "can only bind..." ⇒ 500（2026-10-11 实测）
    const status = asText(req.body?.status)
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

router.post('/recommend', analysisLimiter, (req, res) => {
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
        // 字段清单搬到 `utils/common.js` 的 `projectWardrobeForEngine`（10-21 第九阶段·第一步）：
        // `/api/recommend/engine` 现在也要注入衣橱行，两处各抄一份迟早打架（见 17 §五 第 2 条）。
        wardrobeItems = items.map(normalizeItem).map(projectWardrobeForEngine)
      } catch {
        wardrobeItems = []
      }
    }

    const profileWithWardrobe = { ...profile, wardrobe_items: wardrobeItems }

    // 调用规则引擎（personal 模式）
    // 第四参数＝这个人的身份，只用来现算隐性偏好乘子（穿搭日记 → ±5%，日记 0 条时恰好是 1）。
    // ⛔ 只准用 getCurrentUser（读）；optionalUser 会写一行游客 users，排序层不该顺手建档。
    const prefWho = { sessionId, userId: (getCurrentUser(req) || {}).id || null }
    const result = buildRecommendation(profileWithWardrobe, 'personal', true, prefWho)

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
        privacy_notice: '衣橱数据仅用于生成您自己的搭配建议，保存在您的账号下，可随时删除。',
      },
      '个人衣橱推荐已生成',
    )
  } catch (err) {
    console.error('[衣橱] 推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

// ============================================================
// 九、衣橱上衣按身材打分（不看脸；docs/依据/08 §5 的偏差向量匹配）
// ============================================================

/** 算 bodyFit 要用的上衣字段：只有真字段（四格实测尺寸 + fit_type 版型档 + color/fabric_weight/pattern 三格自填值）。
 *  自由文本（name/sub_category/style_tags）只带过来当标签显示，不再参与算分（10-19 废除中文猜测）。
 *  ⚠️ `fit_type` 必须在场（10-19 第三阶段补）：漏了这一列，"没量尺寸、只选了版型"的那件上衣
 *  在这个面板里就永远估不出松量 ⇒ 模块一的兜底在这条读路径上是断的（19:5x 真浏览器点验时现量到）。 */
function toTopDescriptor(row) {
  return {
    id: row.id,
    name: row.name,
    sub_category: row.sub_category,
    category: row.category,
    color: row.color,
    pattern: row.pattern,
    fit_style: row.fit_style,
    fit_type: row.fit_type,
    fabric_weight: row.fabric_weight,
    shoulder_cm: row.shoulder_cm,
    bust_cm: row.bust_cm,
    length_cm: row.length_cm,
    waistband_cm: row.waistband_cm,
    style_tags: row.style_tags || [],
  }
}

router.post('/top-fit', analysisLimiter, (req, res) => {
  try {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      return sendError(res, '缺少 X-Session-Id', 400)
    }
    const profile = (req.body || {}).profile || {}

    // 现量：活库 category 是中文自由标签 ⇒ 判定交给 isTopCategory，SQL 里写死英文键会一条不中
    const rows = db
      .prepare('SELECT * FROM user_wardrobe WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId)
      .filter((r) => isTopCategory(r.category))
    const tops = rows.map((r) => toTopDescriptor(normalizeItem(r)))

    const dev = recommendationBodyDeviation(profile)
    // 摊平成和报告页 _computed.body_deviation 一个形状，前端只用一套键
    const devFlat = { want: dev.want, notes: dev.notes }
    for (const [k, v] of Object.entries(dev.measure)) if (v != null) devFlat[k] = v
    if (dev.ease_window) devFlat.ease_window_cm = dev.ease_window
    const scored = tops.map((t) => topFitBody(null, t, dev))
    const ranked = []
    const unscored = []
    tops.forEach((t, i) => {
      const r = scored[i]
      if (!r) {
        unscored.push({
          id: t.id,
          name: t.name,
          reason:
            '这件上衣的肩宽/胸围/衣长/腰头高四格一个都没量（或你自己的净尺寸没量）⇒ 算不出任何一维，不打分',
        })
        return
      }
      ranked.push({
        id: t.id,
        name: t.name,
        score: r.score,
        coverage: r.coverage,
        measured: r.measured,
        axes: r.axes,
        axes_present: r.axes_present,
        axes_missing: r.axes_missing,
        top: {
          label: r.top.label,
          signals: r.top.signals,
          garment_cm: r.top.garment_cm,
          fit_style: r.top.fit_style,
          fabric_weight: r.top.fabric_weight,
        },
      })
    })
    ranked.sort((a, b) => b.score - a.score)

    return sendSuccess(
      res,
      {
        person_deviation: devFlat,
        ranked,
        unscored,
        top_count: tops.length,
        note: '这一分只比"这件上衣往哪修"和"你的比例偏差"对不对得上，缺的轴不计入；权重是手拍的标定值，不是判定',
      },
      '上衣身材适配排序已生成',
    )
  } catch (err) {
    console.error('[衣橱] 上衣打分失败:', err)
    return sendError(res, '打分失败', 500)
  }
})

// ============================================================
// 十、衣橱状态统计
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
