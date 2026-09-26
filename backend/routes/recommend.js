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
const { ACTION_LABELS } = require('../services/ruleExplainer')

// 推荐引擎限流：每分钟最多 20 次
const recommendLimiter = rateLimit({ windowMs: 60000, max: 20 })

const router = express.Router()

/** 规则引擎推荐（新版，无需登录；能识别出人时按人读写长期档案） */
router.post('/engine', recommendLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const profile = data.profile || {}
    const mode = data.mode || 'store'

    if (!profile || Object.keys(profile).length === 0) {
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
router.post('/feedback', (req, res) => {
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
router.post('/enhance', (req, res) => {
  try {
    const data = req.body || {}
    const recommendation = data.recommendation || {}
    const weather = data.weather || null
    const mode = data.mode || 'personal'

    if (!recommendation || Object.keys(recommendation).length === 0) {
      return sendError(res, '缺少 recommendation 数据', 400)
    }

    // 生成结构化文本（未配置 LLM 时降级）
    const text = generateStructuredText(recommendation, weather, mode)

    return sendSuccess(res, { text })
  } catch (err) {
    console.error('[推荐] 文案生成失败:', err)
    return sendError(res, '文案生成失败', 500)
  }
})

/**
 * 生成结构化推荐文案（LLM 降级版）
 */
function generateStructuredText(recommendation, weather, mode) {
  const lines = []

  // 标题
  if (mode === 'personal') {
    lines.push('# 个人专属穿搭推荐报告\n')
  } else {
    lines.push('# 门店穿搭推荐报告\n')
  }

  // 天气信息
  if (weather && weather.temp != null) {
    lines.push(`## 今日天气\n`)
    lines.push(`气温 ${weather.temp}°C，${weather.description || '天气良好'}。\n`)
  }

  // 各类别建议(引擎返回的顶层键是中文类别名,动作键是 action_type)
  const META_KEYS = ['group_id', 'group_name', 'priority', 'score', 'feedback', 'explanation']
  const categoryTitles = ['穿搭', '妆容', '发型', '配饰', '姿势']
  for (const cat of categoryTitles) {
    const items = recommendation[cat] || []
    if (items.length === 0) continue
    lines.push(`## ${cat}建议\n`)
    for (const item of items.slice(0, 3)) {
      lines.push(`### ${item.group_name || '推荐方案'}\n`)
      for (const [key, val] of Object.entries(item)) {
        if (META_KEYS.includes(key) || !val) continue
        lines.push(`- **${ACTION_LABELS[key] || key}**: ${val}`)
      }
      lines.push('')
    }
  }

  // 算法分析（个人模式）
  const analysis = recommendation.algorithm_analysis
  if (analysis?.sections?.length) {
    lines.push('## 深度分析报告\n')
    if (analysis.metrics?.length) {
      lines.push(`${analysis.metrics.join(' / ')}\n`)
    }
    for (const section of analysis.sections) {
      lines.push(`### ${section.title}\n`)
      for (const advice of section.advices) {
        lines.push(`- ${advice}`)
      }
      lines.push('')
    }
  }

  // 计算字段
  const computed = recommendation._computed
  if (computed) {
    lines.push('## 您的数据概览\n')
    if (computed.bmi) lines.push(`- BMI: ${computed.bmi}（${computed.bmi_level || '正常'}）`)
    if (computed.body_shape) lines.push(`- 体型: ${computed.body_shape}`)
    if (computed.wh_ratio)
      lines.push(`- 腰臀比: ${computed.wh_ratio}（${computed.wh_status || '正常'}）`)
    lines.push('')
  }

  lines.push('---')
  lines.push('*以上推荐基于您的个人数据生成，仅供参考。*')

  return lines.join('\n')
}

module.exports = router
