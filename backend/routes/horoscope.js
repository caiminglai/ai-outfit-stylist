/**
 * 星座运势路由模块
 * 对应 Python: app/routes/horoscope.py
 */
const express = require('express')
const { sendSuccess, sendError } = require('../utils/response')
const {
  getDailyHoroscope,
  getAllHoroscopesBrief,
  ZODIAC_NAMES,
} = require('../services/horoscopeService')

const router = express.Router()

/** 获取指定星座今日运势 */
router.get('/daily', (req, res) => {
  try {
    const zodiac = (req.query.zodiac || '').trim().toLowerCase()

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

    if (!ZODIAC_NAMES[zodiac]) {
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
        date: new Date().toISOString().split('T')[0],
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
