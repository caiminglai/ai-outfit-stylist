// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝cosmetic）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type {
  CosmeticGapResult,
  CosmeticItem,
  CustomerProfile,
  ShoppingWishlistItem,
} from '../types'
import type { PutPayload } from './core'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 个人化妆品柜 API ============

export async function listCosmetics(): Promise<CosmeticItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items`, { headers: headers() })
  const data = await unwrap<{ items: CosmeticItem[]; count: number }>(res)
  return data.items ?? []
}

export async function addCosmetic(item: PutPayload<CosmeticItem>): Promise<CosmeticItem> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(item),
  })
  const data = await unwrap<{ item: CosmeticItem }>(res)
  return data.item
}

/** 编辑化妆品(三柜「修改」入口已接) */
export async function updateCosmetic(
  id: number,
  item: PutPayload<CosmeticItem>,
): Promise<CosmeticItem> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(item),
  })
  return unwrap(res)
}

export async function deleteCosmetic(id: number): Promise<{ deleted: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items/${id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  return unwrap(res)
}

export async function getCosmeticExpiry(): Promise<CosmeticItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/expiry`, { headers: headers() })
  return unwrap(res)
}

export async function getCosmeticGaps(profile?: CustomerProfile): Promise<CosmeticGapResult> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/gaps`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}

export async function suggestCosmetics(profile?: CustomerProfile): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/suggest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}
