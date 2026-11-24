// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝个人化妆品柜）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

// ============================================================
// 个人化妆品柜
// ============================================================

/** 化妆品单品 */
export interface CosmeticItem {
  id?: number
  name: string
  brand?: string
  category: string
  sub_category?: string
  color_name?: string
  color_tone?: '冷' | '暖' | '中性'
  color_family?: string
  finish?: string
  skin_tone_fit?: string[]
  skin_type_fit?: string[]
  occasion_tags?: string[]
  style_tags?: string[]
  coverage?: string
  opened_date?: string
  expiry_months?: number
  remaining?: number
  condition?: string
  price?: number
  image_url?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/** 化妆品缺口分析 */
export interface CosmeticGapResult {
  gaps: CosmeticGap[]
  stats: CosmeticStats
  color_match?: CosmeticColorMatch
}

export interface CosmeticGap {
  type: string
  /** 同 WardrobeGap:category_* 带中文名,过期/肤色这类靠前端兜底表 */
  label?: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface CosmeticStats {
  total: number
  by_category: Record<string, number>
  expiring: number
  expired: number
}

export interface CosmeticColorMatch {
  skin_tone: string
  mismatches: number
  recommendations: string[]
}
