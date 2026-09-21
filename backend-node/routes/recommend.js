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

  // 穿搭建议
  const outfit = recommendation.outfit || []
  if (outfit.length > 0) {
    lines.push('## 穿搭建议\n')
    for (const item of outfit.slice(0, 3)) {
      lines.push(`### ${item.group_name || '推荐方案'}\n`)
      if (item.outfit_top) lines.push(`- **上衣**: ${item.outfit_top}`)
      if (item.outfit_bottom) lines.push(`- **下装**: ${item.outfit_bottom}`)
      if (item.outfit_color) lines.push(`- **配色**: ${item.outfit_color}`)
      if (item.outfit_reason) lines.push(`- **理由**: ${item.outfit_reason}`)
      lines.push('')
    }
  }

  // 妆容建议
  const makeup = recommendation.makeup || []
  if (makeup.length > 0) {
    lines.push('## 妆容建议\n')
    for (const item of makeup.slice(0, 2)) {
      lines.push(`### ${item.group_name || '妆容方案'}\n`)
      if (item.makeup_foundation) lines.push(`- **底妆**: ${item.makeup_foundation}`)
      if (item.makeup_eye) lines.push(`- **眼妆**: ${item.makeup_eye}`)
      if (item.makeup_lip) lines.push(`- **唇妆**: ${item.makeup_lip}`)
      if (item.makeup_reason) lines.push(`- **理由**: ${item.makeup_reason}`)
      lines.push('')
    }
  }

  // 发型建议
  const hairstyle = recommendation.hairstyle || []
  if (hairstyle.length > 0) {
    lines.push('## 发型建议\n')
    for (const item of hairstyle.slice(0, 2)) {
      lines.push(`### ${item.group_name || '发型方案'}\n`)
      if (item.hairstyle_style) lines.push(`- **发型**: ${item.hairstyle_style}`)
      if (item.hairstyle_reason) lines.push(`- **理由**: ${item.hairstyle_reason}`)
      lines.push('')
    }
  }

  // 配饰建议
  const accessory = recommendation.accessory || []
  if (accessory.length > 0) {
    lines.push('## 配饰建议\n')
    for (const item of accessory.slice(0, 2)) {
      lines.push(`### ${item.group_name || '配饰方案'}\n`)
      if (item.accessory_style) lines.push(`- **配饰**: ${item.accessory_style}`)
      if (item.accessory_reason) lines.push(`- **理由**: ${item.accessory_reason}`)
      lines.push('')
    }
  }

  // 算法分析（个人模式）
  const analysis = recommendation.algorithm_analysis
  if (analysis) {
    lines.push('## 深度分析报告\n')

    if (analysis.body_analysis && analysis.body_analysis.advices) {
      lines.push(`### ${analysis.body_analysis.title || '体型分析'}\n`)
      for (const advice of analysis.body_analysis.advices) {
        lines.push(`- ${advice}`)
      }
      lines.push('')
    }

    if (analysis.face_analysis && analysis.face_analysis.advices) {
      lines.push(`### ${analysis.face_analysis.title || '脸型分析'}\n`)
      for (const advice of analysis.face_analysis.advices) {
        lines.push(`- ${advice}`)
      }
      lines.push('')
    }

    if (analysis.optimization && analysis.optimization.advices) {
      lines.push(`### ${analysis.optimization.title || '视觉优化'}\n`)
      for (const advice of analysis.optimization.advices) {
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
