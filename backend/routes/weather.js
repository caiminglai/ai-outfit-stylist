/**
 * 天气路由模块
 * 对应 Python: app/routes/weather.py
 */
const express = require('express')
const { sendSuccess, sendError } = require('../utils/response')
const { asText } = require('../utils/common')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { warn: logWarn } = require('../utils/logger')
const { getWeather, buildTemperatureProfile } = require('../services/weatherService')

const router = express.Router()

/**
 * 城市名只当短文本读：`?location[]=` 这类数组查询串过去靠 .toString() 变成"北京,上海"，
 * 那本来就不是城市名，报"暂不支持该城市"会把人绕进去。
 * asText 把非文本当没填，直接走下面那条 400。
 */
function readLocation(req) {
  return asText(req.query.location).slice(0, 40)
}

/** 查询城市天气 */
router.get('/', async (req, res) => {
  try {
    const location = readLocation(req)
    if (!location) {
      return sendError(res, '缺少 location 参数，请提供城市名称', 400)
    }

    const weather = await getWeather(location)
    return sendSuccess(res, { ...weather, location })
  } catch (err) {
    // 服务层把"取不到"分成了 404/502/503 三种，这里照状态码送出去并带上原因，
    // 前端那行 setError(e.message) 才会显示"城市没收录"而不是含糊的 500
    const status = Number.isInteger(err.status) ? err.status : 500
    logWarn('[天气] 查询失败:', err.message)
    return sendError(res, err.message || '天气查询失败', status)
  }
})

/** 查询城市天气并返回温度穿衣策略 */
router.get('/profile', async (req, res) => {
  try {
    const location = readLocation(req)
    if (!location) {
      return sendError(res, '缺少 location 参数，请提供城市名称', 400)
    }

    const weather = await getWeather(location)
    const profile = buildTemperatureProfile(weather.feelsLike)
    // 2026-10-21 第十一阶段·第一步：`buildTemperatureProfile` 不再替"没有温度"编一个档位
    // （改前 `null <= 5` 成立 ⇒ 上游缺字段会回"寒冷"，把"没取到"说成"今天很冷"）。
    // 这里照 502 说破：日记表单拿到这句会提示用户改手选，⛔ 不许前端自己补一个档。
    if (!profile) {
      logWarn('[天气] 上游未返回可用体感温度:', JSON.stringify(weather.feelsLike))
      return sendError(res, '上游没有返回可用的体感温度，请改用手工选择天气档', 502)
    }
    // set 转 list 以便 JSON 序列化
    profile.allowed_seasons = Array.from(profile.allowed_seasons)

    return sendSuccess(res, { weather: { ...weather, location }, profile })
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500
    logWarn('[天气] 穿衣策略查询失败:', err.message)
    return sendError(res, err.message || '天气查询失败', status)
  }
})

module.exports = router
