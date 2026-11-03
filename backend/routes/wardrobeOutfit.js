/**
 * 衣橱「搭配组合管理」（穿搭日记）这一组接口（11-03 拆分轮从 `routes/wardrobe.js`
 * 的「二、搭配组合管理」整段逐字搬出，注册语句原样、处理函数体原样）。
 *
 * 前缀不变：本文件由 `routes/wardrobe.js` 用**不带路径**的 `router.use(outfitRoutes)`
 * 挂回原位置，所以对外的 URL、限流、鉴权与 `docs/api/openapi.json` 一个字都没动
 * （判据＝`npm run openapi:check` 拆分前后必须继续 rc=0）。
 *
 * 归属口径（session∪user 并集）与值表都在 `services/wardrobe/` 那一层，本文件只做 HTTP 形状；
 * 读／改／删三处共用 `outfitOwnershipFilter` 那条老规矩在这里仍然成立。
 */
const express = require('express')
const db = require('../db/init')
const { error: logErr } = require('../utils/logger')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const {
  getSessionId,
  parseJsonField,
  asText,
  asNumber,
  firstBadScalar,
  asId,
} = require('../utils/common')
// 10-20 第八阶段·一c：日记要写 user_id（游客也有行，认不到就 NULL），星级尺子从反馈那一层引
const { optionalUser, getCurrentUser } = require('../middleware/auth')
const { writeLimiter } = require('../middleware/wardrobeLimiters')
// 10-21 第十一阶段·第一步：日记三格（穿着日期／体感温度／天气档）的校验与词表同源件
const { WEATHER_LEVELS } = require('../services/weatherService')
const { readOutfitWeather, readOutfitWeatherPatch } = require('../utils/outfitWeather')
const {
  OUTFIT_SCALARS,
  outfitOccasionValues,
  outfitOwnershipFilter,
  ratingError,
  ratingValue,
  sanitizeEnum,
  enumError,
} = require('../services/wardrobe/entryChecks')

const router = express.Router()

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
    logErr('[衣橱] 查询搭配失败:', err)
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
    logErr('[衣橱] 创建搭配失败:', err)
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
    logErr('[衣橱] 更新搭配失败:', err)
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
    logErr('[衣橱] 删除搭配失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
