// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝crossCabinet）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type {
  BrandPreference,
  CabinetHealth,
  CrossCabinetRecommendation,
  CustomerProfile,
  SeasonalReminder,
} from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 跨柜联动 API ============

export async function getCrossCabinetRecommend(
  occasion?: string,
  profile?: CustomerProfile,
): Promise<CrossCabinetRecommendation> {
  const params = new URLSearchParams()
  if (occasion) params.set('occasion', occasion)
  for (const key of [
    'skin_tone',
    'face_shape',
    'body_type',
    'preferred_style',
    'skin_type',
    'neck_length',
    'eye_shape',
  ] as const) {
    const value = profile?.[key]
    if (typeof value === 'string' && value) params.set(key, value)
  }
  const url = `${BASE}/cross-cabinet/recommend${params.toString() ? '?' + params.toString() : ''}`
  const res = await fetchWithTimeout(url, { headers: headers() })
  return unwrap(res)
}

export async function getSeasonalReminder(): Promise<SeasonalReminder> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/seasonal`, { headers: headers() })
  return unwrap(res)
}

export async function getBrandPreference(): Promise<BrandPreference> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/brands`, { headers: headers() })
  return unwrap(res)
}

export async function getCabinetHealth(): Promise<CabinetHealth> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/health`, { headers: headers() })
  return unwrap(res)
}
