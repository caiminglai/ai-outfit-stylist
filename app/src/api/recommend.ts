// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝recommend）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { CustomerProfile, EngineRecommendation, ProfileTag, RankScore } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 规则引擎推荐 API(通用) ============

export async function getEngineRecommendation(
  profile: CustomerProfile,
  mode: 'store' | 'personal' = 'store',
  /** 🔴 10-21 第十三阶段·第一步 §四·1（「推荐时现取天气一起带上」）：可选城市。
   *  白名单只认后端 `weatherService` 那一份（前端从 `/weather` 那条既有链路的城市表取），
   *  ⛔ 不许在前端抄第二份名单。没带 ⇒ 请求与改前逐字节相同；带了且取到了 ⇒ 只当**这一屏**排序的输入，
   *  ⛔ 不落库、⛔ 不进长期档案。⛔ 不做 IP／定位自动猜城（`19` §一 已裁）。 */
  city?: string,
): Promise<{
  recommendation: EngineRecommendation
  mode: string
  privacy_notice: string
  /** 'live'＝本次真的按体感温度折了天气档；'failed'＝名单外或上游没取到，名单照出 */
  weather_source?: 'live' | 'failed'
  /** 'failed' 时后端给的那句人话（含可选城市名单回显） */
  weather_notice?: string
  /** 本次与长期档案的交互:used_fields=从档案补进来的字段中文名,saved_fields=本次存进档案的字段数,tags=算完落库的标签 */
  archive?: { used_fields: string[]; saved_fields: number; tags?: ProfileTag[] }
}> {
  const res = await fetchWithTimeout(`${BASE}/recommend/engine`, {
    method: 'POST',
    headers: headers(),
    // 不带 city 时这个键**根本不写进 body**（⛔ 写 `city: undefined`——JSON.stringify 会丢掉它，
    // 但显式不拼更稳，也不会让"改前逐字节相同"这条回归锚依赖序列化行为）
    body: JSON.stringify(city ? { profile, mode, city } : { profile, mode }),
  })
  return unwrap(res)
}

// ============ 规则反馈 API(点一次记一行,换主意覆盖旧的那行) ============

/**
 * 10-19 第三阶段·模块三：反馈从"两个按钮"升级成"两个按钮 + 两把星 + 一份打分快照"。
 * 快照（`rank`）传的是这张卡片自己的 `item.rank`（后端 rankDims 的出账结构原样带回来），
 * 它是回归的自变量：**今天的公式配不上昨天的评价**，所以现在不快照就再也补不回来。
 * ⛔ 星级与快照都不给 ⇒ 后端把那几格当"这次没动"，老行为一个字节不变。
 */
export type FeedbackExtras = {
  /** 审美星级 1~5（这套搭配好不好看）；undefined＝不改，null＝清空 */
  aesthetic_score?: number | null
  /** 合身星级 1~5（上衣穿在身上合不合身）；undefined＝不改，null＝清空 */
  fit_score?: number | null
  /** 这条评价具体落在衣橱哪件上（卡片来自衣柜行才有） */
  wardrobe_item_id?: number | null
  /** 打分那一刻的综合分与三维分 */
  rank?: RankScore | null
}

/**
 * 这条建议准不准:useful=有用 / inaccurate=不准 / rated=只打了两把星、没点按钮
 * （`rated` 是 10-20 第八阶段·一b 加的,与后端 services/ruleFeedback.js 的 SIGNALS 一字一样）
 */
export async function postRuleFeedback(
  groupId: number,
  category: string,
  signal: 'useful' | 'inaccurate' | 'rated',
  extras: FeedbackExtras = {},
): Promise<{
  group_id: number
  signal: string
  feedback_up: number
  feedback_down: number
  aesthetic_score?: number | null
  fit_score?: number | null
}> {
  const res = await fetchWithTimeout(`${BASE}/recommend/feedback`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ group_id: groupId, category, signal, ...extras }),
  })
  return unwrap(res)
}

/**
 * 🔴 10-22 第十四阶段·第一步 X4「最后一颗星也可以抹掉」：撤掉自己在这条规则上的整行反馈。
 *
 * 为什么要有它：POST 那一路把"只打星、没表态"那一档要求**至少一把星**（后端 :303 防空壳行），
 * 于是用户把最后一颗星也点掉时，前端无论怎么送都是 400——星能打上、抹不掉，只能改成别的数。
 * 撤销改走这个口：`deleted:1` 表示真删了一行，`deleted:0` 表示本来就没评过（幂等，重复点不报错）。
 * ⛔ 不要在 POST 里送"两把星全 null"来实现撤销。
 * 路径按 `docs/依据/22` §五 定的是 `/feedback/group`（与衣橱那条 `/feedback/item` 成对）。
 */
export async function deleteRuleFeedback(groupId: number): Promise<{
  group_id: number
  deleted: number
}> {
  const res = await fetchWithTimeout(
    `${BASE}/recommend/feedback/group?group_id=${encodeURIComponent(String(groupId))}`,
    { method: 'DELETE', headers: headers() },
  )
  return unwrap(res)
}

// ============ 人 × 衣服 评分 API（10-21 第九阶段·第一步） ============

/**
 * 这条口**不是** `postRuleFeedback` 的另一种写法，两张表语义不同（`docs/依据/17` §二）：
 * - `feedback_events`＝**这条规则准不准**（人×规则，会回写规则的好评差评数）；
 * - `item_feedback` ＝**这件衣服你穿得怎么样**（人×衣服，⛔ 不回写规则计数）。
 *
 * 为什么非要另开一张：衣橱那一路的候选 `group_id` 是 null，而 `feedback_events` 建表时写了
 * `group_id NOT NULL`＋`UNIQUE(user_id, group_id)`（`backend/db/schema.sql:301/:320`），
 * 收不下它——前端那句 `item.group_id > 0` 因此连评分控件都不渲染，量过尺寸的衣服反而不能打分。
 * 星级与 `undefined＝不动／null＝清空` 的契约原样继承上面那把尺子，不在这里另起一套。
 */
export type ItemFeedbackExtras = {
  /** 审美星级 1~5（这件好不好看）；不给键＝不改，null＝清空 */
  aesthetic_score?: number | null
  /** 合身星级 1~5（这件上身合不合身）；不给键＝不改，null＝清空 */
  fit_score?: number | null
  /** 这次打分算在哪个场合（只认规则库在用的那五个词，表外词后端 400） */
  occasion?: string | null
  /** 打分那一刻的排序分快照（二维：color/body），回归样本的自变量 */
  rank?: RankScore | null
}

/** 库里这一件上已经存的分（GET 回填用；`rank_snapshot` 是后端内部字段，这里不取） */
export type ItemFeedbackRow = {
  wardrobe_item_id: number
  aesthetic_score: number | null
  fit_score: number | null
  occasion: string | null
  signal: string | null
  updated_at: string
}

export async function postItemFeedback(
  wardrobeItemId: number,
  extras: ItemFeedbackExtras = {},
): Promise<{
  wardrobe_item_id: number
  actor_key: string
  aesthetic_score: number | null
  fit_score: number | null
  occasion: string | null
  signal: string | null
  has_snapshot: boolean
}> {
  const res = await fetchWithTimeout(`${BASE}/recommend/feedback/item`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ wardrobe_item_id: wardrobeItemId, ...extras }),
  })
  return unwrap(res)
}

/**
 * 读回自己在这些件上已有的星（回填那两把星，⛔ 拿不到别人的分）。
 * ids 为空就不发请求：后端拿到空列表也是空，白挨一次限流。
 */
export async function getItemFeedback(ids: number[]): Promise<{ items: ItemFeedbackRow[] }> {
  if (!ids.length) return { items: [] }
  const res = await fetchWithTimeout(`${BASE}/recommend/feedback/items?ids=${ids.join(',')}`, {
    headers: headers(),
  })
  return unwrap(res)
}

/**
 * 🔴 10-21 第十三阶段·第一步 §四·2「衣橱的星可以撤」：撤掉自己在某一件上的评分。
 * 后端三条口径（`docs/依据/21` §四·2）：只按 `actor_key` 删自己的行；不是你的衣服／不存在 ⇒ 404；
 * 本来就没评过 ⇒ 200 带 `deleted:0`（幂等，重复点不报错）。
 * ⛔ 这一条不动 `feedback_events`、不回滚规则的好评差评数——那是"这条规则准不准"，另一层语义。
 */
export async function deleteItemFeedback(wardrobeItemId: number): Promise<{
  wardrobe_item_id: number
  deleted: number
}> {
  const res = await fetchWithTimeout(
    `${BASE}/recommend/feedback/item?wardrobe_item_id=${encodeURIComponent(String(wardrobeItemId))}`,
    { method: 'DELETE', headers: headers() },
  )
  return unwrap(res)
}
