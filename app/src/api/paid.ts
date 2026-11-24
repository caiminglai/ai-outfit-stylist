// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝paid）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { CustomerProfile, EngineRecommendation } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'
import { getCustomerSessionId } from './customer'

// ============ 收款与交付 API（第十二阶段·第一步，docs/依据/20 §四/§八）============
// 两条请求走的是**同一个端点** `GET /api/payment/my`：带 `report=` 才是领取那一路。
// ⛔ 不新增 Header、⛔ 不换鉴权：沿用上面 headers() 那把 X-Session-Id。

/** 已领报告的一行（回执里的数，⛔ 前端不推算） */
export interface PaidReportRow {
  out_trade_no: string
  /**
   * 🔴 第十四阶段·第一步 C1：凭证流那一路的 `out_trade_no` 是内部幂等键 `DEPOSIT-<id>`，
   * **不是平台单号** ⇒ 这一行为 false 时前端不许显示"订单 xxxx"。老响应没这个键 ⇒ 可选。
   */
  is_platform_order_no?: boolean
  /** `'online_order'`／`'manual_deposit'`；老响应没这个键时按在线单处理 */
  source?: string
  deposit_id?: number | null
  amount: number | null
  channel: string
  /** 东八区显示串（后端 toBeijing 转过）；库里那列本身是 UTC */
  paid_at: string | null
  log_id: number
  report_no: number
  basis_log_id: number | null
  granted_at: string | null
}

/** 权益读数：它只用来显示"还能领几份"，硬约束是一笔一报（按幂等键判） */
export interface PaymentEntitlement {
  granted: number
  used: number
  left: number
  paid_orders: number
  paid_amount: number
  pending_orders: number
  pending_amount: number
  closed_orders: number
  proof_approved: number
  proof_amount: number
  reports: PaidReportRow[]
  claimable: Array<{
    out_trade_no: string
    amount: number
    channel: string
    paid_at: string | null
  }>
  /** 🔴 C1：人工确认后到账、还没领过的那几笔（领取方式＝`?proof=<deposit_id>`） */
  claimable_proofs?: Array<{
    deposit_id: number
    amount: number
    paid_at: string | null
  }>
}

/** `GET /api/payment/my` 的只读支：凭证那八个键原样平铺（没有凭证时全为 null）+ 这三键 */
export interface MyPaymentInfo {
  id: number | null
  channel: string | null
  amount: number | null
  proof_url: string | null
  status: string | null
  admin_note: string | null
  created_at: string | null
  approved_at: string | null
  entitlement: PaymentEntitlement
  orders: Array<{
    out_trade_no: string
    status: string
    amount: number
    paid_at: string | null
    created_at_beijing: string | null
  }>
  time_axis?: string
}

/** 领取／复读回来的报告体（`report` 就是引擎那份结果，多一个 paid_report 回执块） */
export interface PaidReportPayload {
  report: EngineRecommendation
  profile: CustomerProfile | null
  mode: 'store' | 'personal'
  log_id: number
  fresh: boolean
}

export async function getPaymentEntitlement(): Promise<MyPaymentInfo> {
  const res = await fetchWithTimeout(`${BASE}/payment/my`, { headers: headers() })
  return unwrap<MyPaymentInfo>(res)
}

/**
 * 领取（或复读）这一笔已付订单对应的深度细账。
 * 这一支会在后端跑整趟推荐引擎，所以超时给到 30 秒；另有 10 次/分的服务端限流，
 * 被限流时 unwrap() 会把后端那句"领取过于频繁"原话带回（不是笼统的 429）。
 * `&session=` 带的是门店快速模式那次的会话号：那行填表记录没有 user_id，
 * 后端只有拿到这个号才认得出"哪次填表算的"（⛔ 不带就退回只按人查，个人模式照常）。
 */
export async function claimPaidReport(
  target: { outTradeNo: string } | { depositId: number },
): Promise<PaidReportPayload> {
  const basis = getCustomerSessionId()
  // 🔴 C1：两条到账来路共用同一个口，只是入参不同——在线单给 `report=`，人工凭证给 `proof=`
  const key =
    'outTradeNo' in target
      ? `report=${encodeURIComponent(target.outTradeNo)}`
      : `proof=${encodeURIComponent(String(target.depositId))}`
  const query = key + (basis ? `&session=${encodeURIComponent(basis)}` : '')
  const res = await fetchWithTimeout(`${BASE}/payment/my?${query}`, { headers: headers() }, 30000)
  return unwrap<PaidReportPayload>(res)
}
