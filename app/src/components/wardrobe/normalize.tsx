// 11-03 大文件拆分轮：这一段从 WardrobeTab.tsx 逐字搬来（3 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：WardrobeTab.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import type {
  WardrobeGapResult,
  WardrobeGap,
  WardrobeStats,
  ShoppingWishlistItem,
} from '../../types'

/**
 * 缺口类型的中文兜底名。
 * category_* 类缺口后端直接带 label(上衣/下装…),走 gap.label 那条;
 * 季节、色彩这两类后端只给 type 不给 label,不映射的话胶囊 pill 会把英文码
 * 原样(如 'season_gap')糊在界面上——正是"后端说了、前端没读"这一族。
 */
export const WARDROBE_GAP_TYPE_LABELS: Record<string, string> = {
  season_gap: '季节缺口',
  color_diversity: '色彩多样性',
}

/** 规范化缺口数据，兼容后端新旧格式 */
export function normalizeGapResult(raw: Record<string, unknown> | null): WardrobeGapResult | null {
  if (!raw || typeof raw !== 'object') return null

  // 新格式：gaps 已是 [{ type, label?, priority, message, suggestions }]
  // 旧格式：gaps 是 [{ category, label, reason, ... }]
  const rawGaps = Array.isArray(raw.gaps) ? raw.gaps : []
  const gaps: WardrobeGap[] = rawGaps.map((g: Record<string, unknown>) => ({
    type: (g.type as string) ?? (g.category as string) ?? '未知类型',
    label: (g.label as string) ?? undefined,
    priority: (g.priority as 'high' | 'medium' | 'low') ?? 'medium',
    message: (g.message as string) ?? (g.reason as string) ?? '',
    suggestions: Array.isArray(g.suggestions) ? (g.suggestions as string[]) : [],
  }))

  // 规范化 stats
  const rawStats = (raw.stats as Record<string, unknown>) ?? {}
  const stats: WardrobeStats = {
    total: (rawStats.total as number) ?? 0,
    by_category: (rawStats.by_category as Record<string, number>) ?? {},
    by_season: (rawStats.by_season as Record<string, number>) ?? {},
    by_style: (rawStats.by_style as Record<string, number>) ?? {},
  }

  return { gaps, stats }
}

/** 规范化购物建议数组 */
export function normalizeSuggestions(raw: unknown): ShoppingWishlistItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item: Record<string, unknown>) => ({
    name: (item.name as string) ?? (item.label as string) ?? '未知商品',
    category: (item.category as string) ?? '',
    reason: (item.reason as string) ?? '',
    priority: (item.priority as 'high' | 'medium' | 'low') ?? 'medium',
  }))
}
