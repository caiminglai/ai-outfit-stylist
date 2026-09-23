/**
 * 穿搭推荐路由模块
 * 对应 Python: app/routes/recommend.py
 *
 * 支持两种模式：
 * 1. 旧版模式：基于 photo_id 获取面部分析后推荐
 * 2. 新版规则引擎模式：直接传入 profile，调用规则引擎推荐
 * 3. LLM 文案增强
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { loginRequired } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
const { getRecommendations, buildRecommendation } = require('../services/recommendEngine')
const { ACTION_LABELS } = require('../services/ruleExplainer')

// 推荐引擎限流：每分钟最多 20 次
const recommendLimiter = rateLimit({ windowMs: 60000, max: 20 })

const router = express.Router()

/** 旧版推荐（基于 photo_id + 场景） */
router.get('/', loginRequired, (req, res) => {
  try {
    const photoId = req.query.photo_id ? parseInt(req.query.photo_id, 10) : null
    const scenario = req.query.scenario || '通勤'

    const validScenarios = ['通勤', '约会', '面试', '休闲', '聚会']
    if (!validScenarios.includes(scenario)) {
      return sendError(res, `无效的场景值，可选: ${validScenarios.join(', ')}`, 400)
    }

    let skinTone = null
    let faceShape = null

    if (photoId) {
      const photo = db
        .prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?')
        .get(photoId, req.user.id)
      if (!photo) {
        return sendError(res, '照片不存在或不属于当前用户', 404)
      }

      const feature = db
        .prepare(
          'SELECT * FROM face_features WHERE photo_id = ? AND user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(photoId, req.user.id, 'done')

      if (feature) {
        skinTone = feature.skin_tone
        faceShape = feature.face_shape
      }
    }

    const recommendations = getRecommendations(skinTone, faceShape, scenario)

    // 保存推荐记录
    const result = db
      .prepare(
        'INSERT INTO recommendations (user_id, photo_id, scenario, result_json) VALUES (?, ?, ?, ?)',
      )
      .run(req.user.id, photoId, scenario, JSON.stringify(recommendations))

    return sendSuccess(
      res,
      {
        recommendation_id: result.lastInsertRowid,
        skin_tone: skinTone,
        face_shape: faceShape,
        scenario: scenario,
        recommendations: recommendations,
      },
      '获取推荐成功',
    )
  } catch (err) {
    console.error('[推荐] 获取失败:', err)
    return sendError(res, '获取推荐失败', 500)
  }
})

/** 规则引擎推荐（新版，无需登录） */
router.post('/engine', recommendLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const profile = data.profile || {}
    const mode = data.mode || 'store'

    if (!profile || Object.keys(profile).length === 0) {
      return sendError(res, '缺少 profile 数据', 400)
    }

    const result = buildRecommendation(profile, mode)

    return sendSuccess(
      res,
      {
        recommendation: result,
        mode: mode,
        privacy_notice: '推荐结果基于您填写的数据生成。',
      },
      '规则引擎推荐已生成',
    )
  } catch (err) {
    console.error('[推荐] 规则引擎失败:', err)
    return sendError(res, '推荐失败', 500)
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
  const META_KEYS = ['group_id', 'group_name', 'priority', 'score', 'explanation']
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
