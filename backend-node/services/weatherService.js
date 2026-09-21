/**
 * Open-Meteo 天气服务模块
 * 使用 Node.js 原生 fetch (v18+) 异步获取天气数据
 */

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

  const coords = CITY_GEO[location]
  if (!coords) {
    console.warn(`[天气] 不支持的城市: ${location}，返回默认值`)
    return defaultWeather()
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

    const temperature = parseFloat(current.temperature_2m || 22)
    const feelsLike = parseFloat(current.apparent_temperature || 22)
    const humidity = parseInt(current.relative_humidity_2m || 60, 10)
    const weatherCode = parseInt(current.weather_code || 0, 10)
    const windSpeed = parseFloat(current.wind_speed_10m || 0)
    const windDeg = parseFloat(current.wind_direction_10m || 0)

    const result = {
      temperature,
      feelsLike,
      condition: WMO_CONDITIONS[weatherCode] || '未知',
      humidity,
      windDir: degToWindDir(windDeg),
      windScale: windSpeedToScale(windSpeed),
    }

    cache.set(location, { result, timestamp: now })
    return result
  } catch (err) {
    console.warn(`[天气] Open-Meteo API 请求失败: ${err.message}，返回默认值`)
    return defaultWeather()
  }
}

/** 根据体感温度返回穿衣策略 */
function buildTemperatureProfile(feelsLike) {
  if (feelsLike <= 5) {
    return {
      level: '寒冷',
      allowed_seasons: new Set(['冬']),
      advice: '气温极低，建议穿着厚羽绒服、保暖内衣、围巾手套等防寒装备',
    }
  } else if (feelsLike <= 14) {
    return {
      level: '偏凉',
      allowed_seasons: new Set(['秋冬']),
      advice: '气温偏低，建议搭配风衣、薄毛衣、长裤，注意早晚温差',
    }
  } else if (feelsLike <= 24) {
    return {
      level: '舒适',
      allowed_seasons: new Set(['春秋']),
      advice: '气温舒适，适合轻薄外套或长袖单衣，穿着自由度高',
    }
  } else if (feelsLike <= 30) {
    return {
      level: '偏热',
      allowed_seasons: new Set(['春夏']),
      advice: '气温偏高，建议穿着透气短袖、薄款面料，注意防晒',
    }
  } else {
    return {
      level: '炎热',
      allowed_seasons: new Set(['夏']),
      advice: '高温天气，建议穿着清凉透气的衣物，避免深色吸热面料',
    }
  }
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

/** 默认天气数据 */
function defaultWeather() {
  return {
    temperature: 22,
    feelsLike: 22,
    condition: '未知',
    humidity: 60,
    windDir: '未知',
    windScale: 2,
  }
}

module.exports = { getWeather, buildTemperatureProfile }
