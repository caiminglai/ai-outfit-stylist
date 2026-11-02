/**
 * 顾客临时会话数据路由模块
 * 对应 Python: app/routes/customer.py
 *
 * 前端 api.ts 期望的接口：
 * - POST   /customer/session              创建会话
 * - GET    /customer/session/:sessionId   获取会话
 * - PUT    /customer/session/:sessionId   更新会话
 * - POST   /customer/session/:sessionId/sync       同步到门店
 * - DELETE /customer/session/:sessionId             删除会话
 * - POST   /customer/session/:sessionId/recommend   获取推荐
 * - GET    /customer/privacy-notice                  隐私声明
 */
const express = require('express')
const crypto = require('crypto')
const db = require('../db/init')
const { sendSuccess, sendCreated, sendError } = require('../utils/response')
const { stripIdentityFields } = require('../utils/common')
const { buildRecommendation } = require('../services/recommendEngine')
const { writeRecommendationLog } = require('../services/profileArchive')

const router = express.Router()

const CUSTOMER_DATA_TTL = parseInt(process.env.CUSTOMER_DATA_TTL || '7200', 10)

/** 声明里写的有效期必须跟着 env 走，别让人改了配置文案还写着 2 小时 */
function formatTtlHours(seconds) {
  const s = Number(seconds) > 0 ? Number(seconds) : 7200
  if (s < 3600) return `${Math.round(s / 60)} 分钟`
  return `${+(s / 3600).toFixed(1)} 小时`
}

/** 隐私声明内容 */
const PRIVACY_NOTICE = {
  title: '门店数据隐私保护声明',
  content: [
    '您填写的画像仅用于生成本次搭配建议，保存在门店会话中，不做其他用途。',
    `会话有效期为 ${formatTtlHours(CUSTOMER_DATA_TTL)}，超时后未同步到门店的会话自动清除。`,
    '您可随时删除自己的数据，删除后不可恢复，已生成的建议记录一并删除。',
    '已同步给门店的建议记录只保留形象字段，不含昵称与手机号，仅用于持续完善形象建议，可随删除一并清除。',
    '推荐结果基于规则引擎生成，不涉及人脸识别等生物特征存储。',
  ],
  highlight: '我们尊重并保护您的个人隐私',
}

/** 生成会话 ID */
function generateSessionId() {
  if (crypto.randomUUID) {
    return 'sess_' + crypto.randomUUID().replace(/-/g, '')
  }
  // 安全 fallback：使用 crypto.randomBytes
  return 'sess_' + crypto.randomBytes(16).toString('hex')
}

/** 解析 profile_data */
function parseProfileData(val) {
  if (val == null) return {}
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return {}
  }
}

/**
 * 剥掉身份字段（隐私声明第 39 行：给门店的记录只留形象字段，不含昵称与手机号）
 * 实现在 utils/common.js：样本快照（profileArchive.writeRecommendationLog）与这里
 * 必须共用同一份名单和同一个递归下钻，两边各写一遍迟早对不上。
 */

/**
 * 过期会话就地清理：只删"还没同步进门店"的那一份，并连带删掉它的推荐样本。
 * 两条口径都是既有的：db/init.js 的定期清理写的就是 `synced = 0`，本文件同步那一处
 * 也明写着"synced=1 之后这一行不再被过期清理删掉"。原来这两个过期分支写的是无条件
 * DELETE ⇒ 顾客端多刷一次页面就能把门店那份记录（收付款/对账要靠它）就地删掉。
 * 会话行删了样本必须跟着删，否则 input_snapshot 变成无主数据长期留在库里。
 */
function dropExpiredSession(sessionId) {
  const delSession = db.prepare('DELETE FROM customer_sessions WHERE session_id = ? AND synced = 0')
  const delLogs = db.prepare('DELETE FROM recommendation_logs WHERE session_id = ?')
  return db.transaction(() => {
    const gone = delSession.run(sessionId)
    if (gone.changes > 0) delLogs.run(sessionId)
    return gone.changes
  })()
}

/**
 * 门店归属:按店名取 id,第一次出现的店名当场登记(店数不预设)
 * 没有店名时返回 null,这条数据就是"未归属",不影响功能
 */
function resolveStoreId(name) {
  const clean = String(name || '')
    .trim()
    .slice(0, 40)
  if (!clean) return null
  db.prepare('INSERT OR IGNORE INTO stores (name) VALUES (?)').run(clean)
  const row = db.prepare('SELECT id FROM stores WHERE name = ?').get(clean)
  return row ? row.id : null
}

// ============================================================
// 隐私声明
// ============================================================

router.get('/privacy-notice', (_req, res) => {
  return sendSuccess(res, PRIVACY_NOTICE)
})

// ============================================================
// 会话 CRUD（路径前缀 /session）
// ============================================================

/** 创建顾客会话 */
router.post('/session', (req, res) => {
  try {
    const sessionId = generateSessionId()
    const profileData = JSON.stringify(req.body?.profile_data || req.body || {})
    const storeId = resolveStoreId(req.body?.store)
    const expiresAt = new Date(Date.now() + CUSTOMER_DATA_TTL * 1000).toISOString()

    db.prepare(
      `INSERT INTO customer_sessions (session_id, store_id, profile_data, expires_at, synced)
       VALUES (?, ?, ?, ?, 0)`,
    ).run(sessionId, storeId, profileData, expiresAt)

    return sendCreated(
      res,
      {
        session_id: sessionId,
        store_id: storeId,
        expires_at: expiresAt,
        privacy_notice: PRIVACY_NOTICE.highlight,
        profile_data: parseProfileData(profileData),
      },
      `${req.baseUrl}/session/${sessionId}`,
      '顾客会话已创建',
    )
  } catch (err) {
    console.error('[顾客] 创建会话失败:', err)
    return sendError(res, '创建会话失败', 500)
  }
})

/** 获取顾客会话 */
router.get('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在或已过期', 404)
    }

    // 检查是否过期
    if (new Date(session.expires_at) < new Date()) {
      dropExpiredSession(sessionId)
      return sendError(res, '会话已过期', 404)
    }

    return sendSuccess(
      res,
      {
        session_id: session.session_id,
        expires_at: session.expires_at,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: !!session.synced,
        synced_at: session.synced_at || undefined,
        profile_data: parseProfileData(session.profile_data),
      },
      '获取会话成功',
    )
  } catch (err) {
    console.error('[顾客] 获取会话失败:', err)
    return sendError(res, '获取会话失败', 500)
  }
})

/** 更新顾客会话 */
router.put('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在或已过期', 404)
    }

    // 过期闸门：与 GET(:133)/recommend(:268) 同口径。
    // 原来这两条分支都漏了 ⇒ 拿一个过期会话的 id 反复 PUT，每轮都把 expires_at 重铸到未来，
    // 隐私声明第 37 行"超时后未同步到门店的会话自动清除"就等于没有；sync 同样能把过期画像永久固化进门店。
    if (new Date(session.expires_at) < new Date()) {
      // 已同步的行不在这里删：身份字段同步当场已剥掉，行本身要留给顾客自己走
      // DELETE /session/:id 才删得掉门店那条记录（db/init.js 的既有口径）。
      // 走 dropExpiredSession 而不是裸 DELETE：没同步的这份要连带把样本一起清掉。
      dropExpiredSession(sessionId)
      return sendError(res, '会话已过期', 404)
    }

    const profileData = JSON.stringify(req.body?.profile_data || req.body || {})
    const expiresAt = new Date(Date.now() + CUSTOMER_DATA_TTL * 1000).toISOString()

    db.prepare(
      'UPDATE customer_sessions SET profile_data = ?, expires_at = ? WHERE session_id = ?',
    ).run(profileData, expiresAt, sessionId)

    return sendSuccess(
      res,
      {
        session_id: sessionId,
        expires_at: expiresAt,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: !!session.synced,
        synced_at: session.synced_at || undefined,
        profile_data: parseProfileData(profileData),
      },
      '会话已更新',
    )
  } catch (err) {
    console.error('[顾客] 更新会话失败:', err)
    return sendError(res, '更新会话失败', 500)
  }
})

/** 同步顾客数据到门店（标记 synced） */
router.post('/session/:sessionId/sync', (req, res) => {
  try {
    const { sessionId } = req.params
    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在', 404)
    }

    // 过期就不许再同步进门店：synced=1 之后这一行不再被过期清理删掉，
    // 少了这道闸门，过期会话的原文画像能永久留在门店
    if (new Date(session.expires_at) < new Date()) {
      return sendError(res, '会话已过期', 404)
    }

    const syncedAt = new Date().toISOString()
    // 隐私声明说"门店留存的记录不含昵称等身份信息"。写进 recommendation_logs 的快照
    // 早就剥掉了这两项（services/profileArchive.js:374-375），但这条会话行是另一份原文，
    // 且 synced=1 之后不再被过期清理删掉，手机号就这样长期留在库里——同步当场一并剥掉。
    const storedProfile = stripIdentityFields(parseProfileData(session.profile_data))
    db.prepare(
      'UPDATE customer_sessions SET synced = 1, synced_at = ?, profile_data = ? WHERE session_id = ?',
    ).run(syncedAt, JSON.stringify(storedProfile), sessionId)

    return sendSuccess(
      res,
      {
        session_id: sessionId,
        expires_at: session.expires_at,
        privacy_notice: PRIVACY_NOTICE.highlight,
        synced: true,
        synced_at: syncedAt,
        profile_data: storedProfile,
      },
      '数据已同步到门店',
    )
  } catch (err) {
    console.error('[顾客] 同步失败:', err)
    return sendError(res, '同步失败', 500)
  }
})

/** 删除顾客会话 */
router.delete('/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params
    const delSession = db.prepare('DELETE FROM customer_sessions WHERE session_id = ?')
    const delLogs = db.prepare('DELETE FROM recommendation_logs WHERE session_id = ?')
    // 删会话必须连带删日志,否则画像快照会留在库里。
    // ★ 日志要无条件删：过期时 GET 会先把会话行删掉（本文件 141 行），等顾客/门店再发
    // DELETE 时 deleted.changes=0 ⇒ 原来这句 if 直接跳过，那份 input_snapshot 就永久留下了
    // （10-13 现量：过期 GET 之后库里剩 1 条无主日志）。两边都删不到才算"会话不存在"。
    const result = db.transaction(() => {
      const deleted = delSession.run(sessionId)
      const logs = delLogs.run(sessionId)
      return { changes: deleted.changes + logs.changes }
    })()
    if (result.changes === 0) {
      return sendError(res, '会话不存在', 404)
    }
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    console.error('[顾客] 删除失败:', err)
    return sendError(res, '删除失败', 500)
  }
})

/** 获取顾客推荐（基于会话中的 profile_data） */
router.post('/session/:sessionId/recommend', (req, res) => {
  try {
    const { sessionId } = req.params
    const mode = req.body?.mode || 'store'

    const session = db
      .prepare('SELECT * FROM customer_sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) {
      return sendError(res, '会话不存在或已过期', 404)
    }

    // 检查是否过期
    if (new Date(session.expires_at) < new Date()) {
      dropExpiredSession(sessionId)
      return sendError(res, '会话已过期', 404)
    }

    const profile = parseProfileData(session.profile_data)
    // 第三参数不动（默认写命中次数），第四参数带上这条会话 ⇒ 隐性偏好乘子生效（日记 0 条时恰好是 1）。
    // 这里只有 session 一档身份（customer_sessions 表没有 user_id 列，现量 db/schema.sql:269-278），
    // 而日记的归属口径是 session∪user 并集，按 session 查得到的那部分照样算。
    const recommendation = buildRecommendation(profile, mode, true, { sessionId })

    // 保存推荐日志（与个人模式走同一条写入路径,归属沿用会话登记的那家店）
    const logId = writeRecommendationLog({
      sessionId,
      storeId: session.store_id,
      mode,
      profile,
      result: recommendation,
    })

    return sendSuccess(
      res,
      {
        recommendation,
        mode,
        log_id: logId,
        privacy_notice: PRIVACY_NOTICE.highlight,
      },
      '推荐已生成',
    )
  } catch (err) {
    console.error('[顾客] 推荐失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

module.exports = router
