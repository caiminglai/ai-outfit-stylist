// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝个人配饰柜）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

// ============================================================
// 个人配饰柜
// ============================================================

/** 配饰单品 */
export interface AccessoryItem {
  id?: number
  name: string
  brand?: string
  category: string
  sub_category?: string
  material?: string
  metal_color?: string
  gemstone?: string
  face_shape_fit?: string[]
  neck_length_fit?: string[]
  skin_tone_fit?: string[]
  occasion_tags?: string[]
  style_tags?: string[]
  season_tags?: string[]
  allergy_safe?: boolean
  condition?: string
  price?: number
  image_url?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/** 配饰缺口分析 */
export interface AccessoryGapResult {
  gaps: AccessoryGap[]
  stats: AccessoryStats
  face_shape_advice?: FaceShapeAdvice
  metal_color_advice?: MetalColorAdvice
}

export interface AccessoryGap {
  type: string
  /** 后端为 category_* 缺口附带中文名(项链/耳饰…);脸型、金属色这类没有,前端用 type→中文兜底表 */
  label?: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface AccessoryStats {
  total: number
  by_category: Record<string, number>
}

export interface FaceShapeAdvice {
  face_shape: string
  mismatches: number
  recommendations: string[]
}

export interface MetalColorAdvice {
  skin_tone: string
  recommended: string
  avoid: string
}
