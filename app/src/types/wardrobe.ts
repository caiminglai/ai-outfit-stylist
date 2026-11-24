// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝个人衣橱：单品／日记／缺口／统计）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。
import type { BodyFitAxis, TopDescriptor } from './scores'

// ============================================================
// 个人衣橱
// ============================================================

/** 个人衣橱单品 */
export interface WardrobeItem {
  id?: number
  name: string
  category: string
  sub_category?: string
  brand?: string
  color?: string
  size?: string
  price?: number
  image_url?: string
  /**
   * 吊牌条码／店内编号（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
   * ⛔ 不建唯一约束：同一件衣服可以有两件、游客还共用会话 ⇒ "扫重了"由录入框查重时提醒，
   *    写入口不拦。NULL／不填＝这件不是扫来的。
   */
  sku?: string | null
  style_tags?: string[]
  color_tags?: string[]
  season_tags?: string[]
  occasion_tags?: string[]
  /** 花纹（选填）：条纹那一维只认这一格里的 竖条/竖条纹/横条/横条纹，认不出就不算这一维 */
  pattern?: string
  /**
   * 版型（旧列，10-19 第三阶段起**退役为只读展示标签**：两档值域撑不起四档松量，
   * 评分不再认它）。表单不再产生这一列，历史行的值原样留着显示。
   */
  fit_style?: '合体' | '宽松'
  /**
   * 版型四档（10-19 第三阶段·模块一）：上衣/外套/连衣裙**必选**。
   * 没量 bust_cm 时后端按这一档的放松量区间中值估松量（services/topFitBody.js 的 FIT_TYPE_EASE），
   * 且估出来的那一维在覆盖率里只按半格计 ⇒ 分数照样被惩罚折过，选版型买不到整格分数。
   * 量了 bust_cm ⇒ 只认实测，这一档一个分都不影响。
   */
  fit_type?: '修身' | '合身' | '宽松' | '廓形'
  /** 面料厚薄（选填）：决定同一件上衣的体量感，值域与后端 FABRIC_WEIGHT_VALUES 一致 */
  fabric_weight?: '薄' | '中' | '厚'
  /**
   * 成衣实测尺寸（cm，选填）——上衣打分的那四格（10-19 第二阶段「最后一公里」）。
   * 平铺在身上量：肩宽＝两肩缝点直线距离，胸围＝袖窿下方一周最宽处，
   * 衣长＝肩颈点到下摆，腰头高＝腰缝/收口带自身的高度（没有腰头就填 0）。
   * ⛔ 没填＝null＝这一维不参与打分，系统不会再从商品名里猜。
   */
  shoulder_cm?: number | null
  bust_cm?: number | null
  length_cm?: number | null
  waistband_cm?: number | null
  body_type_fit?: string[]
  condition?: string
  is_favorite?: boolean
  notes?: string
  created_at?: string
  updated_at?: string
}

/**
 * 这个人的"身材偏差向量"（后端 bodyDeviation）。
 * 数字项 null＝没量；want 项 null＝这一维不参与打分（缺测不出分，权重按在场轴归一）
 * want 的符号约定：+ 想往外加/强调，− 想往里收，0 这一维不推拉
 */
export interface BodyDeviation {
  bmi?: number
  shoulder_ratio?: number
  /** 肩宽÷净腰围（站内自建比值；Pazhoohi 2023 的 SHR 是肩围÷臀围，量不到肩围） */
  shoulder_waist_ratio?: number
  leg_ratio?: number
  bust_waist_diff?: number
  hip_waist_diff?: number
  bust_hip_diff?: number
  /** 腰沟 = min(胸腰差, 臀腰差)；胸围没量时只用臀腰差（后端 notes 会标 partial） */
  waist_groove_cm?: number
  wh_ratio?: number
  /** 按 BMI 定的松量合适区间（Liu 2006 方向 + Sakata 2020 区间先验） */
  ease_window_cm?: [number, number] | number[]
  want: {
    shoulder: number | null
    waist: number | null
    length: number | null
    volume: number | null
    pattern: number | null
  }
  notes: string[]
}

/** 衣橱上衣按身材打分的结果（POST /api/wardrobe/top-fit） */
export interface TopFitResult {
  person_deviation: BodyDeviation
  ranked: Array<{
    id?: number
    name: string
    score: number
    axes: BodyFitAxis[]
    axes_present: string[]
    axes_missing: string[]
    top: TopDescriptor
  }>
  unscored: Array<{ id?: number; name: string; reason: string }>
  top_count: number
  note: string
}

export interface WardrobeOutfit {
  items: WardrobeItem[]
  score: number
  color_score: number
  occasion_score: number
  reason: string
}

/**
 * 穿搭日记（`wardrobe_outfits` 一行）。
 * 2026-10-20 第八阶段·一d 接通写口后补上 `is_favorite`（后端 PUT 认这一格），
 * `user_id`/`session_id` 只读：身份归后端按请求头定，前端不许发（见 api.ts 的 OutfitDraft）。
 * `rating` 是"这套整体满意"的一把星 1~5；审美/合身两把星在推荐卡的反馈链上（`feedback_events`），
 * 日记这一格只有一列（本轮零迁移，没给它加列）。
 */
export interface WardrobeOutfit {
  id?: number
  session_id?: string | null
  user_id?: number | null
  name: string
  item_ids: number[]
  occasion?: string
  season?: string
  rating?: number
  notes?: string
  is_favorite?: boolean
  created_at?: string
  /**
   * 🔴 2026-10-21 第十一阶段·第一步（docs/依据/19 §二）：这套是**哪天穿的**。
   * `null`＝没记（⛔ 不是"今天"，也不拿 `created_at` 顶替——补记昨天的穿搭会被 created_at 记成今天，
   * 那是假数据不是缺数据）。格式 `YYYY-MM-DD`，按东八区日历日校验。
   */
  wear_date?: string | null
  /** 那天手选的天气档，词表唯一真相源在后端 `services/weatherService.js`（随 GET 一起带回来） */
  weather_level?: string | null
  /** 那天的体感温度（℃）；没填＝null，⛔ 不许用 0 冒充"没填" */
  feels_like_c?: number | null
}

/** 购物心愿单 */
export interface ShoppingWishlistItem {
  id?: number
  category: string
  name: string
  reason: string
  priority: 'high' | 'medium' | 'low'
  estimated_price?: number
  is_purchased?: boolean
  created_at?: string
}

/** 衣橱缺口分析 */
export interface WardrobeGapResult {
  gaps: WardrobeGap[]
  stats: WardrobeStats
  color_analysis?: WardrobeColorAnalysis
}

export interface WardrobeGap {
  type: string
  /** 后端为 category_* 缺口附带中文名(上衣/下装…);季节、色彩这类没有,前端用 type→中文兜底表 */
  label?: string
  priority: 'high' | 'medium' | 'low'
  message: string
  suggestions: string[]
}

export interface WardrobeStats {
  total: number
  by_category: Record<string, number>
  by_season: Record<string, number>
  by_style: Record<string, number>
}

export interface WardrobeColorAnalysis {
  dominant_colors: string[]
  missing_colors: string[]
  color_distribution: Record<string, number>
}

/** 购物评估 */
export interface PurchaseEvaluation {
  worth_it: boolean
  score: number
  verdict: string
  reasons: string[]
  warnings: string[]
}
