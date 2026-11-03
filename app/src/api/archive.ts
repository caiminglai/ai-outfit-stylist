// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝archive）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { CustomerProfile, ProfileTag, RuleBrowseItem, RuleBrowseQuery } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 长期档案 API(个人模式:越用越懂你) ============
/** 档案里的一条:后端把引擎字段名换成中文标签后连同值一起给出,前端不再维护第二套翻译 */
export type ProfileField = { key: string; label: string; value: string }

/** 读取本人长期档案(上次填的整份表单 + 身体面容 + 已存标签),档案用于表单预填,未填过返回 null */
export async function getProfileArchive(): Promise<{
  profile: CustomerProfile | null
  /** 同一份档案的中文清单,label 由后端给,前端不再维护第二套字段名翻译 */
  fields?: ProfileField[]
  tags?: ProfileTag[]
}> {
  const res = await fetchWithTimeout(`${BASE}/analysis/archive`, { headers: headers() })
  return unwrap(res)
}

/** 存草稿:填了一半没点生成也替他记住,返回本次写进身体/面容档案的字段数 */
export async function saveProfileArchive(profile: CustomerProfile): Promise<{
  body: number
  face: number
}> {
  const res = await fetchWithTimeout(`${BASE}/analysis/archive`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(profile),
  })
  return unwrap(res)
}

/** 删除本人档案、草稿、标签、归属本人的推荐样本与照片(含上传目录里的文件),返回各类被删条数 */
export async function deleteProfileArchive(): Promise<{
  body: number
  face: number
  draft: number
  tags: number
  feedback: number
  logs: number
  records: number
  tryon: number
  photos: number
  files: number
  files_failed?: number
}> {
  const res = await fetchWithTimeout(`${BASE}/analysis/archive`, {
    method: 'DELETE',
    headers: headers(),
  })
  return unwrap(res)
}

// ============ 规则浏览器 API(让普通人看懂规则引擎,无需登录) ============

/**
 * 浏览所有启用的规则(带中文解释)
 *
 * 让用户理解"我填的档案对应哪些规则条件",支持按类别/性别/场景筛选.
 * 后端 /api/rules/browse 调用 ruleExplainer.explainGroup 把规则条件
 * 翻译成中文人话,如 '性别:女' / '脸型 属于 圆脸、方脸'.
 *
 * @param query 筛选条件,可不传(返回所有启用的规则)
 */
export async function browseRules(
  query: RuleBrowseQuery = {},
): Promise<{ rules: RuleBrowseItem[]; total: number }> {
  const params = new URLSearchParams()
  if (query.mode) params.set('mode', query.mode)
  if (query.category) params.set('category', query.category)
  if (query.gender) params.set('gender', query.gender)
  if (query.scenario) params.set('scenario', query.scenario)
  const qs = params.toString()
  const url = `${BASE}/rules/browse${qs ? '?' + qs : ''}`
  const res = await fetchWithTimeout(url, { headers: headers() })
  return unwrap(res)
}
