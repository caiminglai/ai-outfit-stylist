// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝wardrobe）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type {
  CustomerProfile,
  ShoppingWishlistItem,
  TopFitResult,
  WardrobeGapResult,
  WardrobeItem,
} from '../types'
import type { PutPayload } from './core'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 个人衣橱 API ============

export async function listWardrobeItems(): Promise<WardrobeItem[]> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items`, { headers: headers() })
  const data = await unwrap<{ items: WardrobeItem[]; count: number }>(res)
  return data.items ?? []
}

// 扫码查重的返回（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
// 两张表分开回，因为「这件我衣柜里有没有」和「这件在店里是什么」是两个问题：
// mine 命中 ⇒ 别再录一遍；store 命中 ⇒ 表单预填名称/品类/颜色/图/价。
export interface SkuLookup {
  sku: string
  in_wardrobe: boolean
  in_inventory: boolean
  mine: WardrobeItem[]
  store: Array<{
    id: number
    name: string | null
    sku: string | null
    category_code: string | null
    category_name: string | null
    style_tags: string[]
    color_tags: string[]
    season_tags: string[]
    fit_skin_tones: string[]
    price: number | null
    image_url: string | null
    stock: number | null
  }>
}

/** 按吊牌条码/店内编号查一次（扫码枪敲完自动回车走这条） */
export async function lookupWardrobeSku(sku: string): Promise<SkuLookup> {
  const url = `${BASE}/wardrobe/sku?sku=${encodeURIComponent(sku)}`
  const res = await fetchWithTimeout(url, { headers: headers() })
  return unwrap(res)
}

// item 用 PutPayload 而不是 Partial：三柜的表单把 POST/PUT 共用一份打包，空的可选列发
// null（PUT 那边 null 才表示"清空这列"）。POST 的写口对 null 与"没给"落库结果相同。
export async function addWardrobeItem(item: PutPayload<WardrobeItem>): Promise<WardrobeItem> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(item),
  })
  return unwrap(res)
}

/** 编辑衣橱单品(三柜「修改」入口已接) */
export async function updateWardrobeItem(
  id: number,
  item: PutPayload<WardrobeItem>,
): Promise<WardrobeItem> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(item),
  })
  return unwrap(res)
}

export async function deleteWardrobeItem(id: number): Promise<{ deleted: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items/${id}`, {
    method: 'DELETE',
    headers: headers(),
  })
  return unwrap(res)
}

export async function getWardrobeGaps(profile?: CustomerProfile): Promise<WardrobeGapResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/gaps`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}

export async function suggestPurchases(profile?: CustomerProfile): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/suggest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  })
  return unwrap(res)
}

/** 衣橱里的上衣按这个人的身材打分排序（不看脸；缺的尺寸不计入） */
export async function rankTopsByBody(profile: CustomerProfile): Promise<TopFitResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/top-fit`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile }),
  })
  return unwrap(res)
}

export async function getWardrobeStatus(): Promise<WardrobeGapResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/status`, { headers: headers() })
  return unwrap(res)
}
