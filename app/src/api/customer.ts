// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝customer）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { CustomerProfile, CustomerSession, EngineRecommendation } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 顾客隐私数据 API(门店模式) ============

const STORE_KEY = 'style_ai_store'

/**
 * 门店名：地址栏带 ?store=店名 时记一次,之后这台设备就一直归属这家店
 * 每家店用自己的链接(或二维码)打开展厅即可,数据按店分开
 */
function getStoreName(): string {
  const fromUrl = new URLSearchParams(location.search).get('store')?.trim()
  if (fromUrl) localStorage.setItem(STORE_KEY, fromUrl.slice(0, 40))
  return localStorage.getItem(STORE_KEY) || ''
}

/**
 * 门店快速模式这一次填表所属的会话号（`customer_sessions.session_id`，形如 `sess_…`）。
 * 10-21 第十二阶段·第一步：领取付费细账时要把它一起交给后端。
 * 原因在库里：门店那条 `recommendation_logs` 行的 `user_id` 恒为 NULL
 * （`customer_sessions` 压根没有这一列，`backend/db/schema.sql:269`），
 * 只按人查依据永远查不到 ⇒ 付了钱的门店顾客一律撞 409「找不到你的填表记录」。
 * ⛔ 不进长期档案、⛔ 不当身份用：它只是"这一屏的数据来自哪次填表"的回指，
 * 后端按 `user_id = 我 OR session_id = 这个号` 取最新一条（`services/paidReport.js` 的 `findBasis`）。
 */
const CUSTOMER_SESSION_KEY = 'style_ai_customer_session'

export function getCustomerSessionId(): string {
  return localStorage.getItem(CUSTOMER_SESSION_KEY) || ''
}

export async function createCustomerSession(
  profileData: CustomerProfile,
): Promise<CustomerSession> {
  const res = await fetchWithTimeout(`${BASE}/customer/session`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile_data: profileData, store: getStoreName() }),
  })
  const session = await unwrap<CustomerSession>(res)
  // 记一次门店会话号：只给「我的报告」领取时回指用，见 getCustomerSessionId 注释
  if (session.session_id) localStorage.setItem(CUSTOMER_SESSION_KEY, session.session_id)
  return session
}

export async function syncCustomerToCloud(
  sessionId: string,
): Promise<CustomerSession & { synced_at: string }> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}/sync`, {
    method: 'POST',
    headers: headers(),
  })
  return unwrap(res)
}

export async function deleteCustomerSession(sessionId: string): Promise<{ deleted: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}`, {
    method: 'DELETE',
    headers: headers(),
  })
  const out = await unwrap<{ deleted: boolean }>(res)
  // 这次删的正是一直记着的那个号 ⇒ 回指跟着没，留着只会让领取时查一条已不存在的会话
  if (getCustomerSessionId() === sessionId) localStorage.removeItem(CUSTOMER_SESSION_KEY)
  return out
}

export async function getCustomerRecommendation(
  sessionId: string,
  mode: 'store' | 'personal' = 'store',
): Promise<{
  recommendation: EngineRecommendation
  mode: string
  log_id: number
  privacy_notice: string
}> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}/recommend`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ mode }),
  })
  return unwrap(res)
}
