/**
 * 穿搭推荐路由模块
 * 对应 Python: app/routes/recommend.py
 *
 * 1. 规则引擎推荐：POST /engine（能识别出人时按人读写长期档案）
 * 2. 规则反馈：POST /feedback（有用/不准）
 * 3. LLM 文案增强：POST /enhance
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { asText } = require('../utils/common')
const { optionalUser, getSessionId } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
const { buildRecommendation } = require('../services/recommendEngine')
const {
  loadArchive,
  mergeWithArchive,
  saveArchive,
  saveTags,
  writeRecommendationLog,
} = require('../services/profileArchive')
const { SIGNALS, recordFeedback } = require('../services/ruleFeedback')
const { generateStructuredText } = require('../services/recommendReportText')

// 推荐引擎限流：每分钟最多 20 次
const recommendLimiter = rateLimit({ windowMs: 60000, max: 20 })
// 另两条 POST 原来一道专用闸都没有，只靠全局 100 次/15 分钟那道按 IP 的共享闸
// （出口是 CGNAT，一个 IP 后面一片人）。这里各给一个桶，额度比引擎宽、
// 但不再和 /engine 共用计数——点反馈不该把重新推荐的额度提前吃掉（2026-10-12 补）。
const feedbackLimiter = rateLimit({
  windowMs: 60000,
  max: 60,
  message: '操作过于频繁，请稍后再试',
})
const enhanceLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: '文案生成过于频繁，请稍后再试',
})

const router = express.Router()

/**
 * 推荐模式取值表。
 * 库里 rule_groups.mode 实测只有 store／personal 两种（seed 264 组：store 102／personal 162），
 * 后台标签表也是这两档（static/admin/admin-utils.js:75），前端类型同样锁死
 * （app/src/api.ts:361 `'store' | 'personal'`）。原来这里是 `asText(data.mode) || 'store'`：
 * 任意长串都能一路写进 recommendation_logs.mode，再由 routes/history.js:27 当作
 * `scenario` 原样回吐到"我的历史"里 ⇒ 一条脏数据就是一个用户看得见的假场景名。
 * 认不到就当没填的两档之一，不再往库里写第三种值。
 */
const RECOMMEND_MODES = ['store', 'personal']

/**
 * 把请求里的 mode 收敛到枚举内。
 * @param {*} raw 请求原值
 * @param {string} fallback 没带或带空串时的默认档
 * @returns {{ok: true, mode: string} | {ok: false, error: string}}
 */
function normalizeMode(raw, fallback) {
  // 没带／空串＝按默认档；对象、数组这类非文本先当"没填"处理会静默换档，
  // 与仓内新口径（firstBadScalar：类型不对就 400，别替调用方猜）不一致 ⇒ 一并打回。
  if (raw === undefined || raw === null) return { ok: true, mode: fallback }
  if (typeof raw !== 'string') {
    return { ok: false, error: `mode 只能是 ${RECOMMEND_MODES.join(' / ')}` }
  }
  const v = asText(raw)
  if (!v) return { ok: true, mode: fallback }
  if (!RECOMMEND_MODES.includes(v)) {
    return { ok: false, error: `mode 只能是 ${RECOMMEND_MODES.join(' / ')}` }
  }
  return { ok: true, mode: v }
}

/** 规则引擎推荐（新版，无需登录；能识别出人时按人读写长期档案） */
router.post('/engine', recommendLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const profile = data.profile
    // profile 必须是对象：传成数组/字符串时 Object.keys() 照样有长度，挡不住，
    // 一路带到引擎里按字段取值、往 SQL 里绑值才炸。入参形状不对就该 400。
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return sendError(res, '缺少 profile 数据', 400)
    }
    // mode 认不到就 400，不再原样往库里写（见上面 RECOMMEND_MODES 的说明）。
    // 前端 api.ts:361 把这两档写死在类型里，本仓没有第三种调用方。
    const normalizedMode = normalizeMode(data.mode, 'store')
    if (!normalizedMode.ok) return sendError(res, normalizedMode.error, 400)
    const mode = normalizedMode.mode

    if (Object.keys(profile).length === 0) {
      return sendError(res, '缺少 profile 数据', 400)
    }

    const user = optionalUser(req)
    const archive = loadArchive(user ? user.id : null)
    const { profile: merged, used } = mergeWithArchive(profile, archive)

    const result = buildRecommendation(merged, mode)

    let savedFields = 0
    let tags = []
    if (user) {
      const saved = saveArchive(user.id, profile)
      savedFields = saved.body + saved.face
      tags = saveTags(user.id, result)
      writeRecommendationLog({
        sessionId: getSessionId(req),
        userId: user.id,
        mode,
        profile: merged,
        result,
      })
    }

    return sendSuccess(
      res,
      {
        recommendation: result,
        mode: mode,
        privacy_notice: '推荐结果基于您填写的数据生成。',
        archive: {
          // 本次沿用了档案里的哪些条件(中文名),供前端说明"少填了也没关系"
          used_fields: used,
          saved_fields: savedFields,
          // 算完就存的结论标签,库里查得到同一份
          tags,
        },
      },
      '规则引擎推荐已生成',
    )
  } catch (err) {
    console.error('[推荐] 规则引擎失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

/** 规则反馈：一条建议到底准不准，点一次记一行，换主意覆盖旧的那行 */
router.post('/feedback', feedbackLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const groupId = Number.parseInt(data.group_id, 10)
    const signal = data.signal
    const category = typeof data.category === 'string' ? data.category.slice(0, 20) : null

    if (!Number.isInteger(groupId) || groupId <= 0) return sendError(res, '缺少有效的规则编号', 400)
    if (!SIGNALS.includes(signal))
      return sendError(res, `signal 只能是 ${SIGNALS.join(' / ')}`, 400)

    const user = optionalUser(req)
    if (!user) return sendError(res, '识别不出你是谁，无法记录反馈', 401)

    const stat = recordFeedback(user.id, groupId, category, signal)
    if (!stat) return sendError(res, '规则不存在', 404)
    return sendSuccess(res, stat, '反馈已记录')
  } catch (err) {
    console.error('[推荐] 反馈记录失败:', err)
    return sendError(res, '反馈记录失败', 500)
  }
})

/** LLM 文案增强（降级为规则版结构化文本） */
router.post('/enhance', enhanceLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const recommendation = data.recommendation || {}
    const weather = data.weather || null
    // 同一个 mode，这条口以前是 `data.mode || 'personal'` 直接进文案生成：
    // 前端传进来的东西越长，越容易把整段模板拼歪。收敛到同一张取值表。
    const normalizedMode = normalizeMode(data.mode, 'personal')
    if (!normalizedMode.ok) return sendError(res, normalizedMode.error, 400)
    const mode = normalizedMode.mode

    if (!recommendation || Object.keys(recommendation).length === 0) {
      return sendError(res, '缺少 recommendation 数据', 400)
    }

    // 生成结构化文本（未配置 LLM 时降级）
    const text = generateStructuredText(recommendation, weather, mode)

    return sendSuccess(res, { text })
  } catch (err) {
    // generateStructuredText 会逐层解引用 recommendation 的嵌套块(top_spec.fit.present 等)。
    // 调用方把某块传成非对象(如 {"top_spec":1})时那是 TypeError,本质是"入参结构不对",该 400,
    // 而不是被外层一律算成服务器故障 500。真正的内部异常仍归 500。
    if (err instanceof TypeError) {
      console.warn('[推荐] 文案生成入参结构不对:', err.message)
      return sendError(res, 'recommendation 结构不正确', 400)
    }
    console.error('[推荐] 文案生成失败:', err)
    return sendError(res, '文案生成失败', 500)
  }
})

module.exports = router
