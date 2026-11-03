/**
 * 后端 API 客户端
 *
 * 支持的 API:
 * - 顾客临时会话(创建/推荐/同步/删除)
 * - 规则引擎推荐
 * - 规则反馈 / 人 × 衣服 评分（两张表，语义不同，见 postItemFeedback 上方注释）
 * - 个人衣橱管理(CRUD/缺口分析/购物建议)
 * - 个人化妆品柜管理(CRUD/缺口分析/保质期检查)
 * - 个人配饰柜管理(CRUD/缺口分析)
 * - 跨柜联动推荐(场合推荐/季节提醒/品牌偏好/健康检查)
 */

// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝core）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。

export const BASE = '/api'
const DEFAULT_TIMEOUT = 10000

/**
 * PUT 的入参形状：每一列都额外允许显式 null＝"把这列清空"。
 *
 * 后端三柜 PUT 的契约（2026-10-13 一轮统一到这个口径）是：这个字段不传＝这一列不动，
 * 传 null＝写成 NULL。而实体类型里的列长这样 `brand?: string`（只有"可能没给"，没有 null），
 * 直接拿 Partial<T> 当 PUT 入参就没法表达"清空"⇒ 编辑框里把品牌删掉点保存，
 * 请求里根本没有 brand 这一项，老值原封不动回来，界面看着像"改了没生效"。
 */
export type PutPayload<T> = { [K in keyof T]: T[K] | null }

/** 开发模式:提供更精确的错误提示 */
const _isDev = import.meta.env.DEV

/**
 * 游客 session 不再按时间轮换（2026-10-12 取消原来的 2 小时 TTL）
 * 原因：后端游客行从来不清理——`backend/db/init.js` 的 `cleanupExpiredSessions()` 只删
 * `customer_sessions`，`users` 里的游客行连 `expires` 列都没有。前端到点换一个新 sid，
 * 旧 sid 名下的衣橱/化妆柜/配饰柜就永久留在库里没人能删（"删除我的数据"按新身份清，够不到旧行），
 * 而用户看到的现象是"我存的东西莫名其妙没了"。轮换既换不来隐私，又把数据弄丢，所以取消。
 * 时间戳继续写，只当"上次什么时候开始用"的记录用；游客要清数据走删除接口或登出。
 */

/** localStorage 中存储 session 创建时间戳的 key */
const SESSION_TS_KEY = 'style_ai_session_ts'

/** 全局错误回调,组件层可注册监听 */
type GlobalErrorHandler = (message: string) => void
let _globalErrorHandler: GlobalErrorHandler | null = null

/** 注册全局网络错误处理器 */
export function setGlobalErrorHandler(handler: GlobalErrorHandler | null): void {
  _globalErrorHandler = handler
}

/**
 * 读游客 session 的创建时间戳
 * @returns 毫秒数；没写过、或被改成非数字（老版本只写过 sid）时返回 NaN
 */
function readSessionTs(): number {
  const raw = localStorage.getItem(SESSION_TS_KEY)
  if (raw === null) return NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : NaN
}

/**
 * 获取当前 Session ID(带 TTL 自动过期检查)
 * 每次 API 请求和页面初始化时调用,过期自动清除并重新生成
 */
export function getSessionId(): string {
  // 已登录：身份跟着账号走，不参与游客 2 小时轮换
  const account = getAccount()
  if (account) return account.sessionId

  let sid = localStorage.getItem('style_ai_session')
  const created = readSessionTs()

  // 检查 session 是否过期
  if (sid && !Number.isFinite(created)) {
    // 时间戳缺失或坏掉 ⇒ 补一个"从现在起算"的，sid 原样留着。
    // 原来这里到点就删 sid 重生成（2 小时 TTL），等于每两小时把游客数据清一次，见上面注释。
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()))
  }

  if (!sid) {
    // 使用密码学安全的随机数生成 Session ID
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    sid = 'sess_' + Array.from(arr, (b) => b.toString(36).padStart(2, '0')).join('')
    localStorage.setItem('style_ai_session', sid)
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()))
  }
  return sid
}

/**
 * 只取游客 id（已登录时也不返回账号 id）
 * 注册/登录要用它把游客期间攒的数据过户到账号上
 */
function getGuestSessionId(): string {
  return localStorage.getItem('style_ai_session') || ''
}

/**
 * 页面加载时修一次游客时间戳(老版本只写过 sid、没写时间戳，读出来是 NaN)
 * 原来这个函数到点会删 sid，和 getSessionId 一样已取消：删 sid 不等于删数据，
 * 只是把游客已经攒下的衣橱留在旧行上变成孤儿。入口调用点保持不变。
 */
export function clearExpiredSession(): void {
  const sid = localStorage.getItem('style_ai_session')
  if (!sid) return
  if (!Number.isFinite(readSessionTs())) {
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()))
  }
}

/** 正式账号(手机号 + 密码)登录态 */
export interface AccountInfo {
  phone: string
  sessionId: string
  nickname?: string | null
}

const ACCOUNT_KEY = 'style_ai_account'

export function getAccount(): AccountInfo | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AccountInfo
    return parsed && parsed.sessionId ? parsed : null
  } catch {
    return null
  }
}

export function setAccount(account: AccountInfo | null): void {
  if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  else localStorage.removeItem(ACCOUNT_KEY)
}

/** 游客数据过户结果：moved = 每张表跟过来的条数，dropped = 因账号已有同类记录而被丢掉的条数 */
interface GuestMergeResult {
  moved: Record<string, number>
  dropped: number
}

/** 注册/登录响应 = 账号信息 + 本次过户结果 */
interface AuthResult extends AccountInfo {
  merged: GuestMergeResult | null
}

async function authRequest(path: string, body: Record<string, string>): Promise<AuthResult> {
  const res = await fetchWithTimeout(
    `${BASE}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': getGuestSessionId() },
      body: JSON.stringify(body),
    },
    15000,
  )
  // 走 unwrap：注册/登录同样会撞 429（loginLimiter）与后端 HTML 错误页，
  // 原来这里自己 res.json() + 一句"请求失败"，超时限制和后端原话都被丢掉
  const data = await unwrap<{
    phone?: string
    session_id?: string
    nickname?: string | null
    merged?: GuestMergeResult | null
  }>(res)
  const account: AccountInfo = {
    phone: data.phone || '',
    sessionId: data.session_id || '',
    nickname: data.nickname ?? null,
  }
  setAccount(account)
  return { ...account, merged: data.merged ?? null }
}

export function registerAccount(
  phone: string,
  password: string,
  nickname?: string,
): Promise<AuthResult> {
  return authRequest(
    '/auth/register',
    nickname ? { phone, password, nickname } : { phone, password },
  )
}

export function loginAccount(phone: string, password: string): Promise<AuthResult> {
  return authRequest('/auth/login', { phone, password })
}

export function logoutAccount(): void {
  setAccount(null)
}

export function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      const msg = _isDev
        ? '请求超时 — 后端服务可能卡住或未响应,请查看终端日志'
        : '请求超时,请检查网络连接'
      _globalErrorHandler?.(msg)
      throw new Error(msg)
    }
    // 网络错误(后端未启动 / 端口错误 / CORS 等)
    const msg = _isDev
      ? '无法连接后端服务 — 请确认后端是否已启动,查看终端是否有报错'
      : '网络连接失败,请检查网络后重试'
    _globalErrorHandler?.(msg)
    throw new Error(msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // 后端失败体一律是 sendError 的 {success:false, error:{code,message}}；限流闸(rateLimit)还额外带
    // retry_after 和 Retry-After 头。那句话说的是"为什么被拒"，本来就是写给人看的。
    // 旧代码只看状态码、把后端原话整份丢掉 ⇒ 429 吞掉"15 分钟"、400 的校验提示糊成
    // "请求异常 (HTTP 400)"，用户照着假提示能排半天错。所以先读后端的话，读不到才兜底。
    let serverMsg = ''
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string }
      serverMsg = (body?.error?.message || body?.message || '').trim()
    } catch {
      /* 失败体不是 JSON(Express 默认 HTML 页 / 空体) ⇒ 走下面的状态码兜底 */
    }

    let fallback: string
    if (res.status === 401) fallback = '登录已过期,请刷新页面'
    else if (res.status === 404) fallback = '请求的资源不存在,请检查 API 路径是否正确'
    else if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter >= 60
            ? `${Math.ceil(retryAfter / 60)} 分钟`
            : `${retryAfter} 秒`
          : '稍后'
      fallback = `请求过于频繁,请 ${wait}后再试`
    } else if (res.status >= 500) {
      fallback = _isDev
        ? `后端服务内部错误 (HTTP ${res.status}),请查看终端日志`
        : '服务异常,请稍后重试'
    } else fallback = `请求异常 (HTTP ${res.status}),请查看终端日志`

    // 开发期把状态码缀在后面好对终端日志；生产只显示后端那句原话
    const msg = serverMsg ? (_isDev ? `${serverMsg} (HTTP ${res.status})` : serverMsg) : fallback
    _globalErrorHandler?.(msg)
    throw new Error(msg)
  }
  let json: { success: boolean; data: T; error?: { code: string; message: string } }
  try {
    json = await res.json()
  } catch (parseErr) {
    if (_isDev) console.error('[API] JSON 解析失败:', parseErr)
    const msg = _isDev
      ? '后端返回非 JSON 数据,可能是服务崩溃或返回了 HTML 错误页,请查看终端日志'
      : '响应数据格式异常'
    _globalErrorHandler?.(msg)
    throw new Error(msg)
  }
  if (!json.success) {
    // 2xx 却 success=false 是后端自己发的软失败，同样带 error.code/message ⇒ 别糊成一句"请求失败"
    const serverMsg = json.error?.message?.trim() || ''
    const codeHint = json.error?.code ? `(${json.error.code})` : ''
    const msg =
      serverMsg ||
      (_isDev
        ? `操作失败${codeHint || '(后端 success=false)'},请查看终端日志`
        : `请求失败${codeHint},请稍后重试`)
    _globalErrorHandler?.(msg)
    throw new Error(msg)
  }
  return json.data
}
