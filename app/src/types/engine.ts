// 11-03 大文件拆分轮：本文件的类型声明从 src/types/index.ts 逐字搬来（领域＝推荐引擎主结果：EngineRecommendation／命理／深度分析／付费报告回执）。
// ⛔ 对外入口不变：消费方仍旧 import type { X } from '../types'，由 index.ts 那份 barrel 转发。
import type { InventoryProduct } from './common'
import type { RuleRecommendationItem, TopSpec } from './rules'
import type { ShoppingWishlistItem, WardrobeGapResult, WardrobeOutfit } from './wardrobe'

/**
 * 付费那份「深度细账」的回执（第十二阶段·第一步，`docs/依据/20` §三 E 节）。
 * 只有付费重放那一路会有这一块；免费路径的响应里这个键根本不出现。
 * 🔴 第十四阶段·第一步 C2：这里原来把价格写死成"99 元那份"——真价在 `app_settings.payment_amount_fen`
 * （`routes/payment.js:45-49` 现算），文案里那个数改一次价就变假话。⛔ 注释也不再写数。
 * ⛔ 前端不许据此"推算"任何没给的数——回执说什么就显示什么。
 */
export interface PaidReportReceipt {
  /** 🔴 C1：在线＝平台商户单号；人工凭证＝内部幂等键 `DEPOSIT-<id>`（⛔ 当单号展示） */
  out_trade_no: string
  amount_fen: number
  channel: 'wechat' | 'alipay' | 'manual'
  /** 到账事实来自哪张表：`online_order`＝`payment_orders`，`manual_deposit`＝已核凭证 */
  source?: 'online_order' | 'manual_deposit'
  deposit_id?: number | null
  /** 只有在线那一路 `out_trade_no` 真是平台单号；老数据没这个键时按在线单处理 */
  is_platform_order_no?: boolean
  /** 库里存的是 UTC 串，展示请用后端另给的 *_beijing 字段（权益接口里那一份） */
  paid_at: string | null
  granted_at: string
  report_no: number
  basis_log_id: number
  basis_input_at: string | null
  mode: 'store' | 'personal'
  /** 这份报告分几节交付：B 深度分析 / D 参数与口径 / E 回执 等，见规范 §三 */
  sections: string[]
}

/** 排在 Top 8 之外的那一尾（`_computed.ranking.beyond_top_n`，规范 §三 A 节） */
export interface BeyondTopN {
  count: number
  capped: boolean
  max: number
  rows: Array<{
    name: string
    source: string
    score: number | null
    present: string[]
    missing: string[]
    coverage: number | null
  }>
}

export interface EngineRecommendation {
  穿搭: RuleRecommendationItem[]
  妆容: RuleRecommendationItem[]
  发型: RuleRecommendationItem[]
  配饰: RuleRecommendationItem[]
  姿势: RuleRecommendationItem[]
  衣橱搭配?: WardrobeOutfit[]
  inventory?: {
    穿搭?: InventoryProduct[]
    妆容?: InventoryProduct[]
    发型?: InventoryProduct[]
    配饰?: InventoryProduct[]
    姿势?: InventoryProduct[]
  }
  // 个人模式扩展
  algorithm_analysis?: AlgorithmAnalysis
  /** 后端算出的派生字段(档案里没有的值);命理两块从这里取 */
  _computed?: {
    bazi?: BaziAnalysis
    bazi_today?: BaziDay
    favorable_element?: string
    unfavorable_element?: string
    /**
     * 这一轮色彩维吃的肤色从哪来（18 §2.4）：`photo_sample`＝这次角度真接管了色彩维／
     * `manual`＝只有档名／`null`＝肤色整格空着（色彩维必然缺席）。
     * ⛔ 只拆账，不是置信度、不进任何公式。
     * 🔴 落地实录订正：规范原写还有一种 `'archive'`，但路由在进引擎前已把档案并进 profile
     *（routes/recommend.js:152 mergeWithArchive），引擎内部分不出这一格是本次填的还是档案来的
     * ⇒ 这一档不实现，档案来的也记 `'manual'`。
     */
    skin_source?: 'photo_sample' | 'manual' | null
    /** 后端认下的那个色相角；没认 ⇒ null */
    skin_hue?: number | null
    /** 后端按同一把尺对那个角度现算的档名；角度越界 ⇒ null */
    skin_undertone?: '冷皮' | '自然' | '暖皮' | null
    [key: string]: unknown
  }
  wardrobe_gaps?: WardrobeGapResult
  wishlist?: ShoppingWishlistItem[]
  /** 上衣处方（身材+肤色）；六轴一个都算不出且肤色也认不出时整块缺席 */
  top_spec?: TopSpec
  /** 🔴 第十二阶段·第一步：只有付费领取那一路出现（`GET /api/payment/my?report=…`） */
  paid_report?: PaidReportReceipt
}

/** 八字五行分析(排盘来自 vendor/lunar,喜用神由本仓库算法推算) */
export interface BaziAnalysis {
  birthDate: string
  birthHour: string
  /** 四柱(填了时辰) / 三柱(时辰不清楚) */
  precision: '四柱' | '三柱'
  pillars: string[]
  day_master: string
  day_master_element: string
  strength: '身强' | '身弱' | '中和'
  /** 判定用的帮扶比值(含月支得令 +0.06),与 strength、后端 summary 同一口径、保留 3 位 */
  strength_ratio: number
  /** 冬月取火、夏月取水;为 null 表示本月不调候 */
  seasonal: string | null
  seasonal_applied: boolean
  scores: Record<string, number>
  missing: string[]
  strongest: string
  favorable: string[]
  unfavorable: string
  favorable_element: string
  unfavorable_element: string
  favorable_direction: string
  favorable_colors: string
  summary: string
}

/** 当日流日与个人喜用的关系 */
export interface BaziDay {
  date: string
  ganzhi: string
  element: string
  branch: string
  term: string
  tone: '顺' | '平' | '忌'
  note: string
  reason?: string
  colors?: string
}

/** 算法分析结果 */
export interface AlgorithmAnalysis {
  /** 分析板块:体型/脸型/肤色/体态/八字五行/今日参考,每个板块是一句话建议列表 */
  sections: { title: string; advices: string[] }[]
  /** 数字摘要,如 "BMI 21.5(正常)"、"体型 沙漏型" */
  metrics: string[]
}
