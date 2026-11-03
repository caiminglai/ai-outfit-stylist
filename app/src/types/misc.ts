// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝天气／衣服照片识别／LLM 文案／星座运势／虚拟试穿）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

// ============================================================
// 天气数据
// ============================================================

/** 天气数据 */
export interface WeatherData {
  temperature: number
  feelsLike: number
  condition: string
  humidity: number
  windDir: string
  windScale: number
  location: string
}

/** 温度穿衣策略 */
export interface TemperatureProfile {
  level: string
  allowed_seasons: string[]
  advice: string
}

/** 天气 + 穿衣策略组合 */
export interface WeatherProfile {
  weather: WeatherData
  profile: TemperatureProfile
}

// ============================================================
// 衣服照片 AI 识别
// ============================================================

/** 衣服语义识别结果 */
export interface ClothingSemantics {
  category: string
  color: string
  style: string[]
  season: string[]
  usage: string[]
  item_name: string
}

/** 衣橱上传单品(含图片和AI识别结果) */
export interface ClothingItem {
  clothing_id: number
  filename: string
  image_url: string
  semantics: ClothingSemantics
}

// ============================================================
// LLM 文案增强
// ============================================================

/** LLM 文案增强响应 */
export interface EnhancedText {
  text: string
}

// ============================================================
// 星座运势
// ============================================================

/** 单个星座运势 */
export interface HoroscopeData {
  zodiac_sign: string
  zodiac_name: string
  mood: string
  lucky_color: string
  lucky_number: number
  summary: string
  suggestion: string
}

/** 运势概要列表项 */
export interface HoroscopeBrief {
  zodiac_sign: string
  zodiac_name: string
  mood: string
  lucky_color: string
}

/** 运势列表响应 */
export interface HoroscopeListData {
  date: string
  horoscopes: HoroscopeBrief[]
}

// ============================================================
// 虚拟试穿
// ============================================================

/** 虚拟试穿结果 */
export interface TryonResult {
  result_url: string
  category: string
  person_image: string
  garment_image: string
  /** true = 未接入试穿模型，result_url 就是原图 */
  degraded?: boolean
  /** false = 图已生成但这次没进历史记录（后端落库失败，见 routes/tryon.js） */
  saved?: boolean
}
