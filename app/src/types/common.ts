// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝通用外壳：API 响应包装／隐私声明／商品目录／风格诊断题）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。

// ============================================================
// 通用 API 响应包装
// ============================================================

/** 统一 API 响应格式 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data: T
  error?: { code: string; message: string }
  message?: string
}

/** 隐私声明 */
export interface PrivacyNoticeData {
  title: string
  content: string[]
  highlight: string
}

/** 库存商品 */
export interface InventoryProduct {
  id: number
  category_code: string
  category_name: string
  name: string
  brand?: string
  color?: string
  size?: string
  stock: number
  price?: number
  image_url?: string
  style_tags?: string[]
  color_tags?: string[]
  season_tags?: string[]
  description?: string
}

/** 风格诊断题目 */
export interface StyleOption {
  text: string
  scores: Record<string, number>
}

export interface StyleQuestion {
  id: string
  question: string
  options: StyleOption[]
}

export interface StyleDiagnosisResult {
  primary: string
  primary_name: string
  secondary: string | null
  secondary_name: string | null
  scores: Record<string, number>
  desc: string
}
