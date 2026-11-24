// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝accessory）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type {
  AccessoryGapResult,
  AccessoryItem,
  CustomerProfile,
  ShoppingWishlistItem,
} from '../types'
import type { PutPayload } from './core'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 个人配饰柜 API ============

export async function listAccessories(): Promise<AccessoryItem[]> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items`, { headers: headers() })
  const data = await unwrap<{ items: AccessoryItem[]; count: number }>(res)
  return data.items ?? []
}

export async function addAccessory(item: PutPayload<AccessoryItem>): Promise<AccessoryItem> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(item),
  })
  const data = await unwrap<{ item: AccessoryItem }>(res)
  return data.item
}

/** 编辑配饰(三柜「修改」入口已接) */
export async function updateAccessory(
  id: number,
  item: PutPayload<AccessoryItem>,
): Promise<AccessoryItem> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(item),
  })
  return unwrap(res)
}

export async function deleteAccessory(id: number): Promise<{ deleted: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items/${id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  return unwrap(res)
}

export async function getAccessoryGaps(profile?: CustomerProfile): Promise<AccessoryGapResult> {
  const res = await fetchWithTimeout(`${BASE}/accessory/gaps`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}

export async function suggestAccessories(
  profile?: CustomerProfile,
): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/accessory/suggest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}
