/**
 * 认证路由模块
 * 对应 Python: app/routes/auth.py
 */
const express = require('express')
const bcrypt = require('bcryptjs')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { generateUUID, asText } = require('../utils/common')
const {
  generateAdminToken,
  verifyAdminToken,
  adminLoginRequired,
  getSessionId,
} = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
// 日志走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，落盘的只有
// logs/server-*.log 这一份（别名与 server.js:42 保持一致，判据见 test/loggerDiscipline.test.js）
const { log: logMsg, error: logErr } = require('../utils/logger')

const router = express.Router()

// 登录类端点限流：每分钟最多 10 次
// 三个入口各用各的实例：rateLimit 的桶按实例内部 Map 计,过去 /guest、/login、/admin/login
// 共用同一个 loginLimiter ⇒ 同一个 IP 上"建游客会话"的次数会去吃"正式登录/管理员登录"的额度,
// 正常用户连点几下就被误锁。拆开各自 10 次,既保住防爆破,又不再互相顶包。
const guestLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '登录尝试过于频繁，请稍后再试',
})
const loginLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '登录尝试过于频繁，请稍后再试',
})
const adminLoginLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: '登录尝试过于频繁，请稍后再试',
})

// ============================================================
// 游客数据过户：注册/登录那一刻，把游客身份名下的记录改挂到账号身份上
// ============================================================

// 只按 session_id 归属的表（clothing_items 没有 user_id 列）
const MERGE_BY_SESSION = [
  ['user_wardrobe', true],
  ['wardrobe_outfits', true],
  ['shopping_wishlist', true],
  ['user_cosmetics', true],
  ['user_accessories', true],
  ['clothing_items', false],
  ['recommendation_logs', true],
]

// 按 user_id 归属、同一个人可以有多条的表
const MERGE_BY_USER = [
  'photos',
  'face_features',
  'recommendations',
  'tryon_results',
  'deposits',
  // 微信支付订单也按 user_id 归人:漏了它,游客期付的款过户后仍挂在旧游客身份下,
  // 账号侧查不到这笔单、对账断线,而且这行外键会挡在最下面的 DELETE FROM users 前
  'payment_orders',
  'creator_works',
  'upload_files',
]

// 按 user_id 归属、但带 UNIQUE 的表：账号那边已经有同一条时只能丢游客这条，
// 否则整笔过户会被唯一约束挡死（第二列是要一起比对的业务键，null = 只按 user_id 判重）
const MERGE_BY_USER_UNIQUE = [
  ['body_metrics', null],
  ['face_profiles', null],
  ['profile_tags', 'tag_key'],
  ['feedback_events', 'group_id'],
]

// 这些表把 session_id 当归属键。users.session_id 轮换时必须在同一事务里迁移，
// 否则新 session 登得上，却读不到原衣橱/照片/推荐记录。
// item_feedback 同时有 user_id 外键与 session_id；明确的游客→账号合并会同步重写 actor_key。
const SESSION_OWNED_TABLES = [
  'user_wardrobe',
  'wardrobe_outfits',
  'shopping_wishlist',
  'user_cosmetics',
  'user_accessories',
  'clothing_items',
  'recommendation_logs',
  'item_feedback',
]

/**
 * 原子轮换会员会话：users 换新 ID、session 归属数据跟随迁移。
 * 只有升级前的非 acct_ 旧 ID 需要墓碑；新会员旧 ID 会被自动补建闸门自然拒绝。
 * 登录与改密都复用这里，避免出现"密码已改但 session 未换"或反之的半状态。
 */
function rotateUserSession(userId, oldSessionId, newSessionId) {
  const rotate = db.transaction(() => {
    if (!oldSessionId.startsWith('acct_')) {
      db.prepare('INSERT OR IGNORE INTO revoked_sessions (session_id, user_id) VALUES (?, ?)').run(
        oldSessionId,
        userId,
      )
    }
    const changed = db
      .prepare(
        `UPDATE users
         SET session_id = ?, session_expires_at = datetime('now', '+30 days'),
             last_active_at = datetime('now')
         WHERE id = ? AND session_id = ?`,
      )
      .run(newSessionId, userId, oldSessionId)
    if (changed.changes !== 1) throw new Error('会话已被其他请求轮换，请重试')
    for (const table of SESSION_OWNED_TABLES) {
      if (table === 'item_feedback') {
        db.prepare(
          `UPDATE item_feedback SET session_id = ?, user_id = ?
           WHERE session_id = ? OR user_id = ?`,
        ).run(newSessionId, userId, oldSessionId, userId)
      } else {
        db.prepare(`UPDATE ${table} SET session_id = ? WHERE session_id = ?`).run(
          newSessionId,
          oldSessionId,
        )
      }
    }
  })
  rotate()
}

/**
 * 草稿里的删档墓碑不是普通业务字段：任一侧有墓碑，合并后都必须保留，
 * 否则历史 recommendation_logs 快照会重新成为预填来源。
 */
function isArchiveTombstone(row) {
  if (!row) return false
  try {
    return JSON.parse(row.form_json)?.__archive_deleted__ === true
  } catch {
    return false
  }
}

/**
 * 把游客身份的全部记录并进账号身份
 * @returns {{moved: object, dropped: number}|null} 没有可并的内容时返回 null
 */
function mergeGuestIntoAccount(guestSessionId, accountUserId, accountSessionId) {
  if (!guestSessionId || !accountUserId || guestSessionId === accountSessionId) return null
  const guest = db.prepare('SELECT id FROM users WHERE session_id = ?').get(guestSessionId)
  if (!guest || guest.id === accountUserId) return null
  // 只并游客。已绑定手机号的身份是别人的账号，绝不许并过来
  if (db.prepare('SELECT 1 FROM user_accounts WHERE user_id = ?').get(guest.id)) return null

  const moved = {}
  let dropped = 0

  const run = db.transaction(() => {
    for (const [table, extraKey] of MERGE_BY_USER_UNIQUE) {
      const dup = extraKey
        ? `DELETE FROM ${table} WHERE user_id = ? AND ${extraKey} IN (SELECT ${extraKey} FROM ${table} WHERE user_id = ?)`
        : `DELETE FROM ${table} WHERE user_id = ? AND EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?)`
      dropped += db.prepare(dup).run(guest.id, accountUserId).changes
      const r = db
        .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
        .run(accountUserId, guest.id)
      if (r.changes) moved[table] = r.changes
    }

    // 草稿每人一行，但不能走上面的“账号已有就丢游客”：游客可能刚删过档，
    // 它的墓碑必须覆盖账号旧草稿；反过来账号已有墓碑时也不能被游客普通草稿解除。
    const guestDraft = db
      .prepare('SELECT form_json FROM profile_drafts WHERE user_id = ?')
      .get(guest.id)
    const accountDraft = db
      .prepare('SELECT form_json FROM profile_drafts WHERE user_id = ?')
      .get(accountUserId)
    if (guestDraft) {
      if (!accountDraft) {
        const r = db
          .prepare('UPDATE profile_drafts SET user_id = ? WHERE user_id = ?')
          .run(accountUserId, guest.id)
        if (r.changes) moved.profile_drafts = r.changes
      } else {
        if (isArchiveTombstone(guestDraft) && !isArchiveTombstone(accountDraft)) {
          db.prepare(
            `UPDATE profile_drafts SET form_json = ?, updated_at = datetime('now')
             WHERE user_id = ?`,
          ).run(guestDraft.form_json, accountUserId)
          dropped += 1
        }
        dropped += db.prepare('DELETE FROM profile_drafts WHERE user_id = ?').run(guest.id).changes
      }
    }

    for (const [table, hasUserColumn] of MERGE_BY_SESSION) {
      if (table === 'item_feedback') continue
      const sql = hasUserColumn
        ? `UPDATE ${table} SET session_id = ?, user_id = ? WHERE session_id = ? OR user_id = ?`
        : `UPDATE ${table} SET session_id = ? WHERE session_id = ?`
      const r = hasUserColumn
        ? db.prepare(sql).run(accountSessionId, accountUserId, guestSessionId, guest.id)
        : db.prepare(sql).run(accountSessionId, guestSessionId)
      if (r.changes) moved[table] = r.changes
    }

    // item_feedback 的唯一键是 (actor_key, wardrobe_item_id)。游客与账号合并后，
    // 必须把唯一身份一并迁到账号，否则列表仍按 u<accountId> 查，游客期评分永远读不回。
    // 同一件衣服账号已有评分时保留账号那条；游客重复行先删，避免改键撞唯一约束。
    const accountActor = `u${accountUserId}`
    dropped += db
      .prepare(
        `DELETE FROM item_feedback AS guest
         WHERE (guest.user_id = ? OR guest.session_id = ?)
           AND EXISTS (
             SELECT 1 FROM item_feedback AS account
             WHERE account.actor_key = ?
               AND account.wardrobe_item_id = guest.wardrobe_item_id
               AND (account.user_id = ? OR account.session_id = ?)
           )`,
      )
      .run(guest.id, guestSessionId, accountActor, accountUserId, accountSessionId).changes
    const feedback = db
      .prepare(
        `UPDATE item_feedback SET actor_key = ?, session_id = ?, user_id = ?
         WHERE session_id = ? OR user_id = ?`,
      )
      .run(accountActor, accountSessionId, accountUserId, guestSessionId, guest.id)
    if (feedback.changes) moved.item_feedback = feedback.changes

    for (const table of MERGE_BY_USER) {
      const r = db
        .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
        .run(accountUserId, guest.id)
      if (r.changes) moved[table] = r.changes
    }

    // 删除也必须留在同一事务：若还有未纳入迁移的表引用游客，整笔注册/登录
    // 都失败回滚，而不是把数据迁一半后留个僵尸身份继续返回成功。
    db.prepare('DELETE FROM users WHERE id = ?').run(guest.id)
  })
  run()

  const total = Object.values(moved).reduce((a, b) => a + b, 0)
  if (!total && !dropped) return null
  return { moved, dropped }
}

/** 游客登录 */
router.post('/guest', guestLimiter, (req, res) => {
  try {
    const sessionId = generateUUID()
    // nickname 是客户端随便写的：对象/数组/布尔原样绑进 SQLite 会当场抛 ⇒ 变 500。
    // 与 /register 同一口径，只收文本并截到 40
    const nickname = asText(req.body?.nickname).slice(0, 40) || null

    const result = db
      .prepare(
        `INSERT INTO users (session_id, nickname, session_expires_at)
         VALUES (?, ?, datetime('now', '+30 days'))`,
      )
      .run(sessionId, nickname)

    return sendSuccess(res, { session_id: sessionId, user_id: result.lastInsertRowid })
  } catch (err) {
    logErr('[认证] 游客登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 正式账号：手机号 + 密码 */
const PHONE_RE = /^1[3-9]\d{9}$/
const registerLimiter = rateLimit({
  windowMs: 60000,
  max: 5,
  message: '注册过于频繁，请稍后再试',
})
// 手机号不存在时也走一次 bcrypt，让两种失败耗时一致，防止按响应时间枚举手机号
const DUMMY_HASH = bcrypt.hashSync('invalid-placeholder-password', 10)

/** 注册：新建一条 users 身份并绑定手机号密码，游客期间攒的数据当场过户过来 */
router.post('/register', registerLimiter, (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')
    const nickname =
      String(req.body?.nickname || '')
        .trim()
        .slice(0, 40) || null

    if (!PHONE_RE.test(phone)) return sendError(res, '请输入正确的 11 位手机号', 400)
    if (password.length < 6 || password.length > 64) {
      return sendError(res, '密码长度需在 6-64 位之间', 400)
    }
    if (db.prepare('SELECT 1 FROM user_accounts WHERE phone = ?').get(phone)) {
      return sendError(res, '该手机号已注册，请直接登录', 409)
    }

    const sessionId = `acct_${generateUUID()}`
    const hash = bcrypt.hashSync(password, 10)
    // 账户创建与游客过户同生共死：任何一步失败都不得留下“注册成功”的半状态，
    // 也不能把失败吞掉后给前端一把登录不了的新 session。
    const register = db.transaction(() => {
      const u = db
        .prepare(
          `INSERT INTO users (session_id, nickname, session_expires_at)
           VALUES (?, ?, datetime('now', '+30 days'))`,
        )
        .run(sessionId, nickname)
      const userId = Number(u.lastInsertRowid)
      db.prepare(`INSERT INTO user_accounts (phone, password_hash, user_id) VALUES (?, ?, ?)`).run(
        phone,
        hash,
        userId,
      )
      const merged = mergeGuestIntoAccount(getSessionId(req), userId, sessionId)
      return { userId, merged }
    })
    const { userId, merged } = register()

    return sendSuccess(
      res,
      { session_id: sessionId, user_id: userId, phone, nickname, merged },
      '注册成功',
    )
  } catch (err) {
    logErr('[认证] 注册失败:', err)
    return sendError(res, '注册失败', 500)
  }
})

/** 登录：校验密码后原子轮换 session，前端之后照旧走 X-Session-Id */
router.post('/login', loginLimiter, (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')

    if (!PHONE_RE.test(phone) || !password) return sendError(res, '手机号或密码错误', 401)

    const acc = db
      .prepare(
        `SELECT a.user_id, a.password_hash, u.session_id, u.nickname
         FROM user_accounts a JOIN users u ON u.id = a.user_id
         WHERE a.phone = ?`,
      )
      .get(phone)

    if (!bcrypt.compareSync(password, acc ? acc.password_hash : DUMMY_HASH)) {
      return sendError(res, '手机号或密码错误', 401)
    }
    if (!acc) return sendError(res, '手机号或密码错误', 401)

    const sessionId = `acct_${generateUUID()}`
    // 会话轮换与游客过户必须一起提交；失败时旧 session 和数据均保持原样。
    const login = db.transaction(() => {
      rotateUserSession(acc.user_id, acc.session_id, sessionId)
      return mergeGuestIntoAccount(getSessionId(req), acc.user_id, sessionId)
    })
    const merged = login()

    return sendSuccess(res, {
      session_id: sessionId,
      user_id: acc.user_id,
      phone,
      nickname: acc.nickname,
      merged,
    })
  } catch (err) {
    logErr('[认证] 登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 管理员登录 */
router.post('/admin/login', adminLoginLimiter, (req, res) => {
  try {
    // 与 register/login 同一把尺子:先 String() 兜住,否则 username 传成数字时
    // (123 || 'admin') 是 123 ⇒ 123.trim ⇒ TypeError ⇒ 入参错被读成 500
    const username = String(req.body?.username ?? 'admin').trim() || 'admin'
    const password = String(req.body?.password ?? '')

    if (!password) {
      return sendError(res, '请输入密码', 400)
    }

    const admin = db
      .prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1')
      .get(username)

    if (!admin) {
      return sendError(res, '账号或密码错误', 401)
    }

    if (!bcrypt.compareSync(password, admin.password_hash)) {
      return sendError(res, '账号或密码错误', 401)
    }

    // 更新最后登录时间
    db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).run(admin.id)

    const token = generateAdminToken(admin.username)
    return sendSuccess(res, { token })
  } catch (err) {
    logErr('[认证] 管理员登录失败:', err)
    return sendError(res, '登录失败', 500)
  }
})

/** 验证管理员 Token */
router.get('/admin/verify', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || ''
    if (!authHeader.startsWith('Bearer ')) {
      return sendSuccess(res, { valid: false })
    }

    const token = authHeader.slice(7)
    const valid = verifyAdminToken(token)
    return sendSuccess(res, { valid })
  } catch {
    return sendSuccess(res, { valid: false })
  }
})

/**
 * 会员账号列表：后台重置密码的入口，只出身份和手机号，密码哈希绝不出库
 * total 是真 COUNT(*)，accounts 是被 ACCOUNTS_LIST_LIMIT 截过的最近 500 条；
 * 原来 total 直接取 rows.length，等于把「接口上限」冒充成「账号总数」。
 */
const ACCOUNTS_LIST_LIMIT = 500
router.get('/admin/accounts', adminLoginRequired, (req, res) => {
  try {
    const totalRow = db.prepare('SELECT COUNT(*) AS n FROM user_accounts').get()
    const rows = db
      .prepare(
        `SELECT a.user_id, a.phone, a.created_at, u.nickname
         FROM user_accounts a JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC
         LIMIT ${ACCOUNTS_LIST_LIMIT}`,
      )
      .all()
    return sendSuccess(res, {
      total: totalRow ? totalRow.n : 0,
      limit: ACCOUNTS_LIST_LIMIT,
      accounts: rows.map((r) => ({
        user_id: r.user_id,
        phone: r.phone,
        nickname: r.nickname,
        created_at: r.created_at,
      })),
    })
  } catch (err) {
    logErr('[认证] 读取会员列表失败:', err)
    return sendError(res, '读取失败', 500)
  }
})

/** 管理员重置会员密码：没接短信/邮件通道时的找回通道，只换密码并轮换会话，业务数据不动 */
router.post('/admin/reset-password', adminLoginRequired, (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim()
    const newPassword = String(req.body?.new_password || '')

    if (!PHONE_RE.test(phone)) return sendError(res, '请输入正确的 11 位手机号', 400)
    if (newPassword.length < 6 || newPassword.length > 64) {
      return sendError(res, '新密码长度需在 6-64 位之间', 400)
    }

    const acc = db
      .prepare(
        `SELECT a.user_id, u.session_id
         FROM user_accounts a JOIN users u ON u.id = a.user_id
         WHERE a.phone = ?`,
      )
      .get(phone)
    if (!acc) return sendError(res, '该手机号没有注册过账号', 404)

    const newSessionId = `acct_${generateUUID()}`
    const passwordHash = bcrypt.hashSync(newPassword, 10)
    const reset = db.transaction(() => {
      db.prepare('UPDATE user_accounts SET password_hash = ? WHERE phone = ?').run(
        passwordHash,
        phone,
      )
      rotateUserSession(acc.user_id, acc.session_id, newSessionId)
    })
    reset()
    logMsg(`[认证] 管理员已重置手机号 ${phone.slice(0, 3)}****${phone.slice(-4)} 的密码`)
    return sendSuccess(res, { phone }, '密码已重置，请把新密码交给本人')
  } catch (err) {
    logErr('[认证] 重置密码失败:', err)
    return sendError(res, '重置失败', 500)
  }
})

module.exports = router
