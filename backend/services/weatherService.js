/**
 * Open-Meteo 天气服务模块
 * 使用 Node.js 原生 fetch (v18+) 异步获取天气数据
 */
const { ownValue } = require('../utils/common')

// 城市名称 -> (纬度, 经度) 映射
const CITY_GEO = {
  北京: [39.9042, 116.4074],
  上海: [31.2304, 121.4737],
  广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579],
  杭州: [30.2741, 120.1551],
  成都: [30.5728, 104.0668],
  重庆: [29.563, 106.5516],
  武汉: [30.5928, 114.3055],
  西安: [34.3416, 108.9398],
  南京: [32.0603, 118.7969],
}

const API_URL = 'https://api.open-meteo.com/v1/forecast'

// 内存缓存: { location: { result, timestamp } }
const cache = new Map()
const CACHE_TTL = 600 * 1000 // 600 秒

/** 上游字段可能缺、可能是字符串、可能是 null：读得出有限数就用，读不出给 null（绝不静默变假值） */
function _readNumber(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

/**
 * 带 HTTP 状态码的天气错误
 * status 给路由用（404 城市没收录 / 502 上游数据不全 / 503 上游不可用），
 * isWeatherError 是给下面那个 catch 认出自己刚抛的错的标记，免得被改写成 503。
 */
function weatherError(message, status) {
  const err = new Error(message)
  err.status = status
  err.isWeatherError = true
  return err
}

// WMO 天气代码 -> 中文描述
const WMO_CONDITIONS = {
  0: '晴',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '中毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '密冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '大冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '中阵雨',
  82: '大阵雨',
  85: '小阵雪',
  86: '大阵雪',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  99: '雷暴伴大冰雹',
}

const WIND_DIR_TABLE = [
  '北',
  '北东北',
  '东北',
  '东东北',
  '东',
  '东东南',
  '东南',
  '南东南',
  '南',
  '南西南',
  '西南',
  '西西南',
  '西',
  '西西北',
  '西北',
  '北西北',
]

/** 查询城市天气（异步） */
async function getWeather(location) {
  const now = Date.now()
  const cached = cache.get(location)
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.result
  }

  // 城市表按用户传来的字符串查：`CITY_GEO['toString']` / `['constructor']` 会拿到
  // Object.prototype 上的函数，coords[0] 变 undefined，请求带着"latitude=undefined"发出去。
  // ownValue 只认这张表自己的键，认不到就走下面的明确报错分支
  const coords = ownValue(CITY_GEO, location)
  if (!coords) {
    // 取不到就如实报错。原来这里回 defaultWeather()（22°C / 湿度 60 / 风力 2 级），
    // 前端拿到假数照样生成穿衣策略 ⇒ 把"这个城市没收录"说成"今天体感 22 度"。
    const supported = Object.keys(CITY_GEO).join('、')
    throw weatherError(`暂不支持「${String(location).slice(0, 40)}」，可选城市：${supported}`, 404)
  }

  const params = new URLSearchParams({
    latitude: String(coords[0]),
    longitude: String(coords[1]),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m',
    timezone: 'Asia/Shanghai',
  })

  try {
    const url = `${API_URL}?${params.toString()}`
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`HTTP请求失败，状态码: ${response.status}`)
    const data = await response.json()
    const current = data.current || {}

    // 上游少回一个字段就当这次取数失败，不再 `|| 22` / `|| 60` 补一个假值。
    // temperature 与 apparent_temperature 尤其致命：穿衣策略整条按 feelsLike 分档，
    // 补 22 等于替用户决定"今天不用穿外套"。
    const temperature = _readNumber(current.temperature_2m)
    const feelsLike = _readNumber(current.apparent_temperature)
    const humidity = _readNumber(current.relative_humidity_2m)
    if (temperature === null || feelsLike === null) {
      throw weatherError('天气服务返回的数据不完整，请稍后再试', 502)
    }
    const weatherCode = _readNumber(current.weather_code)
    const windSpeed = _readNumber(current.wind_speed_10m)
    const windDeg = _readNumber(current.wind_direction_10m)

    const result = {
      temperature: Math.round(temperature * 10) / 10,
      feelsLike: Math.round(feelsLike * 10) / 10,
      condition: (weatherCode === null ? null : ownValue(WMO_CONDITIONS, weatherCode)) || '未知',
      // 湿度/风缺测只影响那一格显示，不改穿衣判断，所以留 null 让前端显示"—"
      humidity: humidity === null ? null : Math.round(humidity),
      windDir: windDeg === null ? '未知' : degToWindDir(windDeg),
      windScale: windSpeed === null ? null : windSpeedToScale(windSpeed),
    }

    cache.set(location, { result, timestamp: now })
    return result
  } catch (err) {
    // 自己抛的那两条带 status 的错误原样往上送，别把"502 数据不完整"洗成 500
    if (err && err.isWeatherError) throw err
    console.warn(`[天气] Open-Meteo API 请求失败: ${err.message}`)
    throw weatherError('天气服务暂时不可用，请稍后再试', 503)
  }
}

/**
 * 体感温度五档（2026-10-21 第十一阶段·第一步，`docs/依据/19` §三 第 1 条）
 * ============================================================
 * 这一份是**全仓唯一的天气档词表与切点**：话术（下面的 `buildTemperatureProfile`）、
 * 穿搭日记落库（`routes/wardrobe.js` 的 `weather_level`）、隐性偏好层（`wearPreference.js`
 * 的 `warmth` 轴）、协同过滤（`collabFilter.js` 的日记信号）都从这里取。
 * ⛔ 不许在任何别处抄第二份阈值——两层各算一遍算出两个答案是本项目反复清扫的病灶。
 *
 * 切点沿用 10-13 建档时那五刀（≤5 / ≤14 / ≤24 / ≤30 / 其余），⛔ 本轮一律不动：
 * 动了会让"报告里说的话"和"库里的档"两套并行。阈值本身是 **C 档产品口径（手拍，标定中）**，
 * 对外⛔ 不许称"科学/量化/气象标准"。
 */
const WEATHER_LEVELS = ['寒冷', '偏凉', '舒适', '偏热', '炎热']
const TEMPERATURE_CUTS = [5, 14, 24, 30]

/**
 * 体感温度 → 五档之一。
 * 读不出有限数就回 **null**（缺测不出档，硬规矩 2）：原来 `buildTemperatureProfile(null)`
 * 会因为 `null <= 5` 成立而回"寒冷"，把"上游没给温度"说成"今天很冷"——那是一条假数据。
 *
 * 🔴 10-22 实测补的第二道闸（`probe-level.cjs`，14 个入参逐档跑）：上一版只挡了 `undefined`
 * 和 NaN，**没挡住 `null`、空串、`[]`、布尔**——因为 `Number(null)=Number('')=Number(' ')=Number([])
 * =Number(true)=0`、`Number(false)=0`，全落进"≤5°C ⇒ 寒冷"那一档。而库里 `feels_like_c` 没填时
 * 就是 NULL（db/schema.sql 补列，DEFAULT NULL），`collabFilter.js:199` 与 `wearPreference.js:247`
 * 那两处"人没选档就按体感温度现推"的来路会把一条**什么都没填**的日记判成"寒冷天穿的"。
 * ⇒ 现在只认两种输入：真的是数、或非空的数字字符串；其余一律 null。
 * @param {number|string|null|undefined} feelsLike
 * @returns {string|null} `WEATHER_LEVELS` 之一，或 null
 */
function levelFromFeelsLike(feelsLike) {
  const n =
    typeof feelsLike === 'number'
      ? feelsLike
      : typeof feelsLike === 'string' && feelsLike.trim() !== ''
        ? Number(feelsLike)
        : NaN
  if (!Number.isFinite(n)) return null
  for (let i = 0; i < TEMPERATURE_CUTS.length; i++) {
    if (n <= TEMPERATURE_CUTS[i]) return WEATHER_LEVELS[i]
  }
  return WEATHER_LEVELS[WEATHER_LEVELS.length - 1]
}

/** 五档各自的穿衣策略文案（level 由 `levelFromFeelsLike` 定，⛔ 不在这里再判一次阈值） */
const TEMPERATURE_STRATEGY = {
  寒冷: {
    allowed_seasons: new Set(['冬']),
    advice: '气温极低，建议穿着厚羽绒服、保暖内衣、围巾手套等防寒装备',
  },
  偏凉: {
    allowed_seasons: new Set(['秋冬']),
    advice: '气温偏低，建议搭配风衣、薄毛衣、长裤，注意早晚温差',
  },
  舒适: {
    allowed_seasons: new Set(['春秋']),
    advice: '气温舒适，适合轻薄外套或长袖单衣，穿着自由度高',
  },
  偏热: {
    allowed_seasons: new Set(['春夏']),
    advice: '气温偏高，建议穿着透气短袖、薄款面料，注意防晒',
  },
  炎热: {
    allowed_seasons: new Set(['夏']),
    advice: '高温天气，建议穿着清凉透气的衣物，避免深色吸热面料',
  },
}

/**
 * 根据体感温度返回穿衣策略。
 * @returns {{level:string, allowed_seasons:Set<string>, advice:string}|null}
 *   温度读不出有限数 ⇒ **null**（调用方必须显式处理，⛔ 不许 `profile.level` 直接点下去）
 */
function buildTemperatureProfile(feelsLike) {
  const level = levelFromFeelsLike(feelsLike)
  if (!level) return null
  const strategy = ownValue(TEMPERATURE_STRATEGY, level)
  return { level, allowed_seasons: strategy.allowed_seasons, advice: strategy.advice }
}

/** 风向角度转 16 方位中文名 */
function degToWindDir(deg) {
  const index = Math.round(deg / 22.5) % 16
  return WIND_DIR_TABLE[index]
}

/** 风速 (km/h) 转风力等级 */
function windSpeedToScale(speed) {
  const scales = [
    [1, 0],
    [6, 1],
    [12, 2],
    [20, 3],
    [29, 4],
    [39, 5],
    [50, 6],
    [62, 7],
    [75, 8],
    [89, 9],
    [103, 10],
    [118, 11],
    [133, 12],
  ]
  for (const [threshold, level] of scales) {
    if (speed < threshold) return level
  }
  return 12
}

module.exports = {
  getWeather,
  buildTemperatureProfile,
  levelFromFeelsLike,
  WEATHER_LEVELS,
  TEMPERATURE_CUTS,
  // 🔴 10-21 第十三阶段·第一步 §四·1：城市白名单的**唯一真相源**（10 个，与上面 `CITY_GEO` 同源）。
  // 路由与前端都从这里取（`/api/recommend/weather-cities` 或前端读后端回显），⛔ 谁都不许抄第二份名单——
  // 抄了就会出现"前端能选、后端说暂不支持"那种两套口径。
  WEATHER_CITIES: Object.keys(CITY_GEO),
}
