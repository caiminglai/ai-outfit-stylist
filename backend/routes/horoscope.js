/**
 * 星座运势路由模块
 * 对应 Python: app/routes/horoscope.py
 */
const express = require('express')
const { sendSuccess, sendError } = require('../utils/response')
const { asText, ownValue } = require('../utils/common')
const { beijingDateStr } = require('../utils/beijingTime')
const {
  getDailyHoroscope,
  getAllHoroscopesBrief,
  ZODIAC_NAMES,
} = require('../services/horoscopeService')

const router = express.Router()

/** 获取指定星座今日运势 */
router.get('/daily', (req, res) => {
  try {
    // ?zodiac[]=aries 这类数组查询串过去会走到 .trim() ⇒ TypeError ⇒ 500，
    // asText 把非文本一律当"没填"，落回下面那个"可用星座"提示
    const zodiac = asText(req.query.zodiac).toLowerCase()

    if (!zodiac) {
      return sendSuccess(
        res,
        {
          available_signs: Object.keys(ZODIAC_NAMES),
          sign_names: ZODIAC_NAMES,
          hint: '请使用 ?zodiac=aries 查询指定星座运势',
        },
        '请指定星座参数',
      )
    }

    // ownValue 只认 12 个自有键：写成 ZODIAC_NAMES['constructor'] 会顺着原型链拿到函数，
    // 于是 ?zodiac=constructor 过去能"通过"这一关，再在 service 里当场抛成 500
    if (!ownValue(ZODIAC_NAMES, zodiac)) {
      return sendError(
        res,
        `无效的星座标识: ${zodiac}，可选: ${Object.keys(ZODIAC_NAMES).join(', ')}`,
        400,
      )
    }

    const result = getDailyHoroscope(zodiac)
    return sendSuccess(res, result)
  } catch (err) {
    console.error('[星座运势] 获取失败:', err)
    return sendError(res, '获取运势失败', 500)
  }
})

/** 获取所有 12 星座今日运势概要 */
router.get('/list', (req, res) => {
  try {
    const briefList = getAllHoroscopesBrief()
    return sendSuccess(
      res,
      {
        // 与 service 同一把尺子：toISOString() 是 UTC 日期，
        // 北京时间早上那 8 小时会给顾客回一个"昨天的日期"
        date: beijingDateStr(),
        horoscopes: briefList,
      },
      '获取运势列表成功',
    )
  } catch (err) {
    console.error('[星座运势] 获取列表失败:', err)
    return sendError(res, '获取运势列表失败', 500)
  }
})

module.exports = router
