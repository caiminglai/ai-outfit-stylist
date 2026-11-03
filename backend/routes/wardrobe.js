/**
 * 个人衣橱路由模块（AIWardrobe 模式）
 * 对应 Python: app/routes/wardrobe.py
 *
 * 功能：衣橱单品 CRUD、搭配组合、缺口分析、购物评估、购物推荐、衣橱匹配、心愿单、个人推荐
 */
const express = require('express')
const db = require('../db/init')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr } = require('../utils/logger')
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
  asText,
  asNumber,
  asFilters,
  firstBadScalar,
  asId,
  projectWardrobeForEngine,
} = require('../utils/common')
const { gateBody } = require('../middleware/bodyGate')
// 个人推荐那条排序口要认当前用户：只准用 getCurrentUser（读），⛔ 不用 optionalUser（会给游客建档）
const { getCurrentUser } = require('../middleware/auth')
// 11-03 拆分轮：进门校验与值表在 `services/wardrobe/entryChecks.js`，
// 统计／缺口／评估算法在 `services/wardrobe/analysis.js`（函数体逐字搬走，一处没改）
const {
  WARDROBE_SCALARS,
  GARMENT_MEASURES,
  measureError,
  measureValue,
  WISHLIST_SCALARS,
  FIT_STYLE_VALUES,
  sanitizeEnum,
  volumeAxisError,
} = require('../services/wardrobe/entryChecks')
const {
  normalizeItem,
  calculateStats,
  analyzeWardrobeGaps,
  evaluatePurchase,
  suggestNextPurchase,
  matchWardrobe,
} = require('../services/wardrobe/analysis')

// 两道限流闸的定义在 `middleware/wardrobeLimiters.js`：拆出去的那一段要用**同一个实例**，
// 各写一份就是两个计数器，闸等于虚设
const { writeLimiter, analysisLimiter } = require('../middleware/wardrobeLimiters')
// 「二、搭配组合管理」的注册语句在 `routes/wardrobeOutfit.js`，不带路径地挂回原位置
// ⇒ URL 前缀、栈顺序、限流与鉴权都不变（`npm run openapi:check` rc=0 就是这条的判据）
const outfitRoutes = require('./wardrobeOutfit')

const router = express.Router()

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
    logErr('[衣橱] 查询失败:', err)
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
    logErr('[衣橱] 添加失败:', err)
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
    logErr('[衣橱] 扫码查重失败:', err)
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
    logErr('[衣橱] 获取失败:', err)
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
    logErr('[衣橱] 更新失败:', err)
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
    logErr('[衣橱] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})
// ============================================================
// 二、搭配组合管理（注册语句在 `routes/wardrobeOutfit.js`，11-03 拆出）
// ⚠️ 这里必须保持「不带路径的 use」：前缀与栈顺序都因此不变，接口说明书才不会漂
// ============================================================

router.use(outfitRoutes)

// ============================================================
// 三、衣橱缺口分析
// ============================================================

router.post('/gaps', analysisLimiter, gateBody({ objects: ['profile'] }), (req, res) => {
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
    logErr('[衣橱] 缺口分析失败:', err)
    return sendError(res, '分析失败', 500)
  }
})

// ============================================================
// 四、购物评估（值不值得买）
// ============================================================

router.post(
  '/evaluate',
  analysisLimiter,
  gateBody({ objects: ['profile', 'candidate'] }),
  (req, res) => {
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
      logErr('[衣橱] 购物评估失败:', err)
      return sendError(res, '评估失败', 500)
    }
  },
)

// ============================================================
// 五、购物推荐（下次买什么）
// ============================================================

router.post('/suggest', analysisLimiter, gateBody({ objects: ['profile'] }), (req, res) => {
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
    logErr('[衣橱] 购物推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

// ============================================================
// 六、衣橱匹配（从已有衣服中筛选）
// ============================================================

router.post('/match', analysisLimiter, gateBody({ objects: ['profile'] }), (req, res) => {
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
    logErr('[衣橱] 匹配失败:', err)
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
    logErr('[衣橱] 查询心愿单失败:', err)
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
    logErr('[衣橱] 添加心愿失败:', err)
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
    logErr('[衣橱] 更新心愿失败:', err)
    return sendError(res, '更新失败', 500)
  }
})

// ============================================================
// 八、个人衣橱推荐（规则引擎 personal 模式）
// ============================================================

router.post(
  '/recommend',
  analysisLimiter,
  gateBody({ objects: ['profile'], arrays: ['wardrobe_items'] }),
  (req, res) => {
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
          const items = db
            .prepare('SELECT * FROM user_wardrobe WHERE session_id = ?')
            .all(sessionId)
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
      logErr('[衣橱] 推荐失败:', err)
      return sendError(res, '推荐失败', 500)
    }
  },
)

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
    logErr('[衣橱] 上衣打分失败:', err)
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
    logErr('[衣橱] 获取状态失败:', err)
    return sendError(res, '获取衣橱状态失败', 500)
  }
})

module.exports = router
