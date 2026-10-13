/**
 * 面容/身体分析路由模块
 * 对应 Python: app/routes/analysis.py
 */
const express = require('express')
const fs = require('fs')
const path = require('path')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
const {
  loadPrefill,
  describeProfile,
  loadTags,
  saveArchive,
  saveDraft,
} = require('../services/profileArchive')
const { clearFeedback } = require('../services/ruleFeedback')
const { UPLOAD_DIR, asId } = require('../utils/common')

const router = express.Router()

// AI 分析类端点限流：每分钟最多 5 次（消耗 DashScope 额度）
const aiLimiter = rateLimit({ windowMs: 60000, max: 5, message: '分析请求过于频繁，请稍后再试' })

// 草稿自动保存：前端已防抖，这一层只挡脚本刷库
const draftLimiter = rateLimit({ windowMs: 60000, max: 30, message: '保存太快了，稍一秒再存' })

/** 提交面部分析（能力未开放） */
router.post('/face', loginRequired, aiLimiter, (_req, res) => {
  return sendError(res, '照片自动识别肤色/脸型尚未开放，请在表单中选择肤色与脸型', 501)
})

/** 获取面部分析结果 */
router.get('/face/:photoId', loginRequired, (req, res) => {
  try {
    const photoId = asId(req.params.photoId)
    if (photoId === null) return sendError(res, 'photoId 必须是正整数', 400)

    const feature = db
      .prepare(
        'SELECT * FROM face_features WHERE photo_id = ? AND user_id = ? ORDER BY created_at DESC',
      )
      .get(photoId, req.user.id)

    if (!feature) {
      return sendError(res, '分析结果不存在', 404)
    }

    return sendSuccess(res, { feature })
  } catch (err) {
    console.error('[分析] 获取面部分析结果失败:', err)
    return sendError(res, '获取分析结果失败', 500)
  }
})

/** 校验数值参数，返回安全值或 null */
function safeNum(val, min, max) {
  const n = parseFloat(val)
  if (isNaN(n)) return null
  if (min !== undefined && n < min) return null
  if (max !== undefined && n > max) return null
  return n
}

/**
 * 校验分类文本参数，返回安全值或 null
 * neck_length / body_type 存的是"短/中/长"、"梨形/苹果形"这类选项，不是数字。
 * 拿 safeNum 校验会把用户选的"短"读成 NaN ⇒ NULL，等于把人填的分类档案悄悄清空；
 * 直接绑原值又会在收到对象/数组时被 better-sqlite3 挡成 TypeError ⇒ 500。
 * 与 profileArchive.cleanText 同一条尺子：只留 ≤40 字符的字符串。
 */
function cleanText(val) {
  if (typeof val !== 'string') return null
  const s = val.trim()
  if (!s || s.length > 40) return null
  return s
}

/** 提交身体指标 */
router.post('/body', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const body = req.body || {}

    const cleaned = {
      height_cm: safeNum(body.height_cm, 50, 300),
      weight_kg: safeNum(body.weight_kg, 20, 500),
      shoulder_width_cm: safeNum(body.shoulder_width_cm, 20, 100),
      waist_cm: safeNum(body.waist_cm, 30, 200),
      hip_cm: safeNum(body.hip_cm, 30, 200),
      bust_cm: safeNum(body.bust_cm, 30, 200),
      leg_length_ratio: safeNum(body.leg_length_ratio, 0.3, 0.8),
      neck_length: cleanText(body.neck_length),
      body_type: cleanText(body.body_type),
    }

    // 只写这次真的填了的列:没带或填歪的列保留档案原值,与长期档案"只增不清"一致。
    // 老逻辑无条件 UPDATE 全列 ⇒ 一次只发身高体重的局部提交,会把之前量好的三围、颈长清成 NULL。
    const columns = Object.keys(cleaned).filter((c) => cleaned[c] !== null)
    const existing = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(userId)

    if (existing) {
      if (columns.length > 0) {
        db.prepare(
          `UPDATE body_metrics SET ${columns.map((c) => `${c} = ?`).join(', ')},
           updated_at = datetime('now') WHERE user_id = ?`,
        ).run(...columns.map((c) => cleaned[c]), userId)
      }
    } else if (columns.length > 0) {
      db.prepare(
        `INSERT INTO body_metrics (user_id, ${columns.join(', ')})
         VALUES (?, ${columns.map(() => '?').join(', ')})`,
      ).run(userId, ...columns.map((c) => cleaned[c]))
    }

    // 回读整份现状:前端拿到的是"这次提交后库里到底是什么",而不是"这次发了什么"
    const metric = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(userId) || {}
    return sendSuccess(res, {
      height_cm: metric.height_cm ?? null,
      weight_kg: metric.weight_kg ?? null,
      body_type: metric.body_type ?? null,
      shoulder_width_cm: metric.shoulder_width_cm ?? null,
      waist_cm: metric.waist_cm ?? null,
      hip_cm: metric.hip_cm ?? null,
      leg_length_ratio: metric.leg_length_ratio ?? null,
      bust_cm: metric.bust_cm ?? null,
      neck_length: metric.neck_length ?? null,
    })
  } catch (err) {
    console.error('[分析] 保存身体指标失败:', err)
    return sendError(res, '保存失败', 500)
  }
})

/** 获取身体指标 */
router.get('/body', loginRequired, (req, res) => {
  try {
    const metric = db.prepare('SELECT * FROM body_metrics WHERE user_id = ?').get(req.user.id)
    return sendSuccess(res, { metric: metric || null })
  } catch (err) {
    console.error('[分析] 获取身体指标失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 获取长期档案（上次填的整份表单打底 + 草稿覆盖 + 身体面容档案收尾 + 已算出的标签，字段名与推荐表单一致，供前端预填） */
router.get('/archive', loginRequired, (req, res) => {
  try {
    const profile = loadPrefill(req.user.id)
    return sendSuccess(res, {
      profile,
      fields: describeProfile(profile),
      tags: loadTags(req.user.id),
    })
  } catch (err) {
    console.error('[分析] 获取长期档案失败:', err)
    return sendError(res, '获取失败', 500)
  }
})

/** 存草稿：填了一半没点生成也替他记住，身体面容照旧写进档案列，整份表单写进草稿表 */
router.put('/archive', loginRequired, draftLimiter, (req, res) => {
  try {
    const form = req.body || {}
    if (typeof form !== 'object' || Array.isArray(form)) {
      return sendError(res, '参数格式不对', 400)
    }
    const saved = saveArchive(req.user.id, form)
    const draft = saveDraft(req.user.id, form)
    return sendSuccess(res, saved, draft ? '已保存' : '没有新内容要保存')
  } catch (err) {
    console.error('[分析] 保存草稿失败:', err)
    return sendError(res, '保存失败', 500)
  }
})

/**
 * 删除我的全部数据：档案 + 草稿 + 标签 + 反馈 + 样本 + 照片 + 试穿结果 + 衣橱/化妆柜/配饰柜/搭配/心愿单
 * + 创作者作品 + 脸型特征 + 衣物条目（含磁盘文件），一并清掉。
 * 唯独不动 deposits / payment_orders：那是收付款凭证，出纠纷时要靠它对账，不归"清除个人数据"管。
 */
router.delete('/archive', loginRequired, (req, res) => {
  try {
    const userId = req.user.id
    const sessionId = req.user.session_id

    // 文件清单必须在删行之前取：行一旦删掉就再也不知道文件叫什么
    // 衣橱/化妆柜/配饰柜的图片与作品封面同样是用户上传，只删行会把这些文件永久留在盘上
    //
    // ★ 这三张柜表两把钥匙都在：session_id 可空、user_id 也可空，而三柜的 POST 只写 session_id
    // （10-13 现量：登录后加一件衣服 ⇒ user_id 一直是 NULL）。只按 user_id 删就是"删我的全部数据"
    // 删不掉柜子里的东西，用户按了按钮、接口回 200、盘上的上传照片和行都还在。
    // 两把钥匙并起来删才对得上"全部"，session_id 与 users.session_id 一一对应，不会错删别人。
    const bothKeys = (table) => `DELETE FROM ${table} WHERE user_id = ? OR session_id = ?`
    // 每条 SQL 配好自己的绑参：单键只绑 user_id，三柜要 [user_id, session_id]
    const fileSelects = [
      { sql: 'SELECT url AS url FROM photos WHERE user_id = ?', args: [userId] },
      { sql: 'SELECT result_url AS url FROM tryon_results WHERE user_id = ?', args: [userId] },
      {
        sql: 'SELECT image_url AS url FROM user_wardrobe WHERE user_id = ? OR session_id = ?',
        args: [userId, sessionId],
      },
      {
        sql: 'SELECT image_url AS url FROM user_cosmetics WHERE user_id = ? OR session_id = ?',
        args: [userId, sessionId],
      },
      {
        sql: 'SELECT image_url AS url FROM user_accessories WHERE user_id = ? OR session_id = ?',
        args: [userId, sessionId],
      },
      { sql: 'SELECT cover_url AS url FROM creator_works WHERE user_id = ?', args: [userId] },
      // clothing_items 只认 session_id，没有 user_id 列
      {
        sql: 'SELECT image_url AS url FROM clothing_items WHERE session_id = ?',
        args: [sessionId],
      },
    ]
    const fileUrls = [
      ...new Set(
        fileSelects.flatMap(({ sql, args }) =>
          db
            .prepare(sql)
            .all(...args)
            .map((row) => row.url),
        ),
      ),
    ].filter((url) => typeof url === 'string' && url.startsWith('/uploads/'))

    const delBody = db.prepare('DELETE FROM body_metrics WHERE user_id = ?')
    const delFace = db.prepare('DELETE FROM face_profiles WHERE user_id = ?')
    const delFaceFeatures = db.prepare('DELETE FROM face_features WHERE user_id = ?')
    const delDraft = db.prepare('DELETE FROM profile_drafts WHERE user_id = ?')
    const delTags = db.prepare('DELETE FROM profile_tags WHERE user_id = ?')
    const delRecords = db.prepare('DELETE FROM recommendations WHERE user_id = ?')
    const delTryon = db.prepare('DELETE FROM tryon_results WHERE user_id = ?')
    const delPhotos = db.prepare('DELETE FROM photos WHERE user_id = ?')
    const delWorks = db.prepare('DELETE FROM creator_works WHERE user_id = ?')
    // 三柜 + 搭配 + 心愿单 + 推荐日志：两把钥匙都可能挂着我的行（见上面的 ★），
    // 原来这六张只按 user_id 删 ⇒ 点「删除我的全部数据」后柜里的东西一条都没少
    const delLogs = db.prepare(bothKeys('recommendation_logs'))
    const delWardrobe = db.prepare(bothKeys('user_wardrobe'))
    const delCosmetics = db.prepare(bothKeys('user_cosmetics'))
    const delAccessories = db.prepare(bothKeys('user_accessories'))
    const delOutfits = db.prepare(bothKeys('wardrobe_outfits'))
    const delWishlist = db.prepare(bothKeys('shopping_wishlist'))
    // clothing_items 只认 session_id，没有 user_id 列
    const delClothing = db.prepare('DELETE FROM clothing_items WHERE session_id = ?')
    const removed = db.transaction(() => ({
      body: delBody.run(userId).changes,
      face: delFace.run(userId).changes,
      // face_features 外键引用 photos.id，必须排在清照片之前
      face_features: delFaceFeatures.run(userId).changes,
      draft: delDraft.run(userId).changes,
      tags: delTags.run(userId).changes,
      // 反馈要连带把规则的计数改回来，不能只删行
      feedback: clearFeedback(userId),
      logs: delLogs.run(userId, sessionId).changes,
      // recommendations 与 tryon_results 都外键引用 photos，删除必须排在清照片之前
      records: delRecords.run(userId).changes,
      tryon: delTryon.run(userId).changes,
      photos: delPhotos.run(userId).changes,
      wardrobe: delWardrobe.run(userId, sessionId).changes,
      cosmetics: delCosmetics.run(userId, sessionId).changes,
      accessories: delAccessories.run(userId, sessionId).changes,
      outfits: delOutfits.run(userId, sessionId).changes,
      wishlist: delWishlist.run(userId, sessionId).changes,
      works: delWorks.run(userId).changes,
      clothing: delClothing.run(sessionId).changes,
    }))()

    // 磁盘文件放在事务之后：删掉的文件回滚不了，先保证库里的账对上
    let files = 0
    let filesFailed = 0
    for (const url of fileUrls) {
      const filepath = path.join(UPLOAD_DIR, path.basename(url))
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
          files += 1
        }
      } catch (err) {
        filesFailed += 1
        console.warn('[档案] 删除照片文件失败:', err.message)
      }
    }

    return sendSuccess(
      res,
      filesFailed > 0 ? { ...removed, files, files_failed: filesFailed } : { ...removed, files },
      '您的档案与相关记录已删除',
    )
  } catch (err) {
    console.error('[分析] 删除长期档案失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

module.exports = router
