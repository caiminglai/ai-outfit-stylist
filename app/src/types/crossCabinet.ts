// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝跨柜联动：整套搭配／匹配结果／季节提醒／品牌偏好／柜体健康）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。
import type { ProfileTag } from './profile'

// ============================================================
// 跨柜联动推荐
// ============================================================

/** 跨柜联动推荐 */
export interface CrossCabinetRecommendation {
  occasion: string
  occasion_style: string
  outfit_advice: CabinetMatchResult
  cosmetic_advice: CabinetMatchResult
  accessory_advice: CabinetMatchResult
  cross_tips: string[]
  summary: {
    wardrobe_count: number
    cosmetic_count: number
    accessory_count: number
  }
  /** 三柜拼出来的一套（"今天这身"） */
  full_look?: FullLook
  /** 该配金还是银，没有可靠依据时后端不给这个字段 */
  metal?: { color: string; basis: string } | null
  /** 本次计算里长期档案的参与情况 */
  archive?: { used_fields: string[]; tags: ProfileTag[] }
}

/** 一套搭配里的单件 */
export interface FullLookPiece {
  /** 槽位：上装 / 下装 / 一件成套 / 外搭 / 底妆 / 唇色 / 颈饰 / 耳饰 */
  slot: string
  name: string
  category: string
  score?: number
  /** 这一件自己的入选依据 */
  why: string[]
}

/** 完整形象指导：三柜各出候选后拼成的一套 */
export interface FullLook {
  pieces: FullLookPiece[]
  occasion: string
  /** 件数够不够算一套 */
  complete: boolean
  /** 缺的是哪一类（柜子里没有这一类才会缺） */
  missing_parts: string[]
  note: string
}

/** 橱柜匹配项 */
export interface CabinetMatchedItem {
  name: string
  category?: string
  score?: number
  /** 得分依据,如 ['当季','场合匹配'] */
  reasons?: string[]
}

export interface CabinetMatchResult {
  style?: string
  matched: CabinetMatchedItem[]
  missing: string[]
  suggestion: string
}

/** 季节性提醒 */
export interface SeasonalReminder {
  current_season: string
  tips: {
    outfit: string
    cosmetic: string
    accessory: string
  }
  wardrobe: { total: number; season_items: number; need_attention: boolean }
  cosmetic: { total: number; tip: string }
  accessory: { total: number; season_items: number; need_attention: boolean }
}

/** 品牌偏好分析(后端实际返回结构) */
export interface BrandPreference {
  wardrobe_brands: BrandCount[]
  cosmetic_brands: BrandCount[]
  accessory_brands: BrandCount[]
  price_range: {
    wardrobe: { min: number; max: number; avg: number; count: number }
    cosmetic: { min: number; max: number; avg: number; count: number }
    accessory: { min: number; max: number; avg: number; count: number }
  }
  style_preferences: string[]
  summary: {
    wardrobe_count: number
    cosmetic_count: number
    accessory_count: number
  }
}

export interface BrandCount {
  brand: string
  count: number
}

/** 三柜健康检查(后端实际返回结构) */
export interface CabinetHealth {
  overall_score: number
  wardrobe_health: CabinetHealthDetail
  cosmetic_health: CabinetHealthDetail
  accessory_health: CabinetHealthDetail
  recommendations: string[]
}

export interface CabinetHealthDetail {
  score: number
  total: number
  categories: string[]
  missing_essentials: string[]
}
