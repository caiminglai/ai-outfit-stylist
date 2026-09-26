/**
 * 天气路由模块
 * 对应 Python: app/routes/weather.py
 */
const express = require('express')
const { sendSuccess, sendError } = require('../utils/response')
const { getWeather, buildTemperatureProfile } = require('../services/weatherService')

const router = express.Router()

/** 查询城市天气 */
router.get('/', async (req, res) => {
  try {
    const location = (req.query.location || '').toString().trim()
    if (!location) {
      return sendError(res, '缺少 location 参数，请提供城市名称', 400)
    }

    const weather = await getWeather(location)
    return sendSuccess(res, { ...weather, location })
  } catch (err) {
    console.error('[天气] 查询失败:', err.message)
    return sendError(res, '天气查询失败', 500)
  }
})

/** 查询城市天气并返回温度穿衣策略 */
router.get('/profile', async (req, res) => {
  try {
    const location = (req.query.location || '').toString().trim()
    if (!location) {
      return sendError(res, '缺少 location 参数，请提供城市名称', 400)
    }

    const weather = await getWeather(location)
    const profile = buildTemperatureProfile(weather.feelsLike)
    // set 转 list 以便 JSON 序列化
    profile.allowed_seasons = Array.from(profile.allowed_seasons)

    return sendSuccess(res, { weather: { ...weather, location }, profile })
  } catch (err) {
    console.error('[天气] 穿衣策略查询失败:', err.message)
    return sendError(res, '天气查询失败', 500)
  }
})

module.exports = router
