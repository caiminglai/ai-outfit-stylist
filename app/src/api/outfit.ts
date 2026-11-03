// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝outfit）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { WardrobeOutfit } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 穿搭日记 API（`wardrobe_outfits`，2026-10-20 第八阶段·一d）============

/**
 * 日记的写入形状。
 * ⛔ 不用 `PutPayload<WardrobeOutfit>`：那会把 `id`/`session_id`/`user_id` 也摆进可选列，
 * 而这三格归后端定（身份只认请求头里的 session，见后端 `optionalUser`/`getCurrentUser`），
 * 前端发了也没用——留着只会让人以为"改个 user_id 就能冒充别人"。
 */
export interface OutfitDraft {
  name: string
  item_ids: number[]
  occasion?: string | null
  season?: string | null
  rating?: number | null
  notes?: string | null
  is_favorite?: boolean
  /**
   * 🔴 2026-10-21 第十一阶段·第一步（docs/依据/19 §三 第 5 条）：
   * 这三格沿用衣橱那三柜同一把尺子——**不传＝这一格不动，传 null＝清空**。
   * 所以"清空天气"必须是 `null`，⛔ 不许是不传，也不许是空串（空串会被后端 400 说破）。
   */
  wear_date?: string | null
  weather_level?: string | null
  feels_like_c?: number | null
}

/**
 * GET 的返回里带 `occasions`＝后端**当下真收**的场合词表（每次现从 `rule_conditions` 取）。
 * 下拉必须吃这个，不许在前端抄第二份词表：抄了就等于"改了规则侧忘了改这里"，
 * 而表外词会被后端 400（命不中任何规则 ⇒ 采了白采）。
 * 🔴 第十一阶段同理带出 `weather_levels`（五档词表，真相源在 `services/weatherService.js`），
 * 日记表单那五个档位按钮必须从这里拿（docs/依据/19 §三 第 1 条 ＋ §七 第 2 条）。
 */
export interface OutfitListResult {
  outfits: WardrobeOutfit[]
  count: number
  occasions: string[]
  weather_levels?: string[]
}

export async function listWardrobeOutfits(): Promise<OutfitListResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/outfits`, { headers: headers() })
  return unwrap(res)
}

export async function createWardrobeOutfit(draft: OutfitDraft): Promise<WardrobeOutfit> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/outfits`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(draft),
  })
  return unwrap(res)
}

/** 改一笔日记：字段级"不传＝这一格不动，传 null＝清空"（与三柜 PUT 同一把尺子） */
export async function updateWardrobeOutfit(
  id: number,
  patch: Partial<OutfitDraft> & { is_favorite?: boolean },
): Promise<WardrobeOutfit> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/outfits/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(patch),
  })
  return unwrap(res)
}

/** 删一笔日记：后端只删搭配这一行，不会动衣柜里的衣物 */
export async function deleteWardrobeOutfit(id: number): Promise<{ deleted: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/outfits/${id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  return unwrap(res)
}
