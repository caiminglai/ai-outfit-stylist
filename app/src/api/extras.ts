// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝extras）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type {
  ClothingItem,
  EngineRecommendation,
  EnhancedText,
  HoroscopeData,
  TryonResult,
  WeatherData,
  WeatherProfile,
} from '../types'
import { BASE, fetchWithTimeout, getSessionId, headers, unwrap } from './core'

// ============ 天气查询 API ============

export async function getWeatherProfile(location: string): Promise<WeatherProfile> {
  const params = new URLSearchParams({ location })
  const res = await fetchWithTimeout(`${BASE}/weather/profile?${params.toString()}`, {
    headers: headers(),
  })
  return unwrap(res)
}

// ============ 衣服照片上传与识别 API ============

export async function uploadClothing(file: File): Promise<ClothingItem> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetchWithTimeout(`${BASE}/clothing/upload`, {
    method: 'POST',
    headers: { 'X-Session-Id': getSessionId() },
    body: formData,
  })
  return unwrap(res)
}

// ============ LLM 文案增强 API ============

export async function enhanceRecommendationText(
  recommendation: EngineRecommendation,
  weather?: WeatherData | null,
  mode: 'store' | 'personal' = 'personal',
): Promise<EnhancedText> {
  const res = await fetchWithTimeout(`${BASE}/recommend/enhance`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ recommendation, weather: weather || null, mode }),
  })
  return unwrap(res)
}

// ============ 星座运势 API ============

export async function getDailyHoroscope(zodiac: string): Promise<HoroscopeData> {
  const params = new URLSearchParams({ zodiac })
  const res = await fetchWithTimeout(`${BASE}/horoscope/daily?${params.toString()}`, {
    headers: headers(),
  })
  return unwrap(res)
}

// ============ 虚拟试穿 API ============

export async function directTryon(
  personImage: File,
  garmentImage: File,
  category: string = 'top',
): Promise<TryonResult> {
  const formData = new FormData()
  formData.append('person_image', personImage)
  formData.append('garment_image', garmentImage)
  formData.append('category', category)
  const res = await fetchWithTimeout(
    `${BASE}/tryon/direct`,
    {
      method: 'POST',
      headers: { 'X-Session-Id': getSessionId() },
      body: formData,
    },
    30000,
  )
  return unwrap(res)
}
