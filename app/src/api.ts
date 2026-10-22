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
import type {
  AccessoryGapResult,
  AccessoryItem,
  BrandPreference,
  CabinetHealth,
  ClothingItem,
  CosmeticGapResult,
  CosmeticItem,
  CrossCabinetRecommendation,
  CustomerProfile,
  CustomerSession,
  EngineRecommendation,
  EnhancedText,
  HoroscopeData,
  ProfileTag,
  RankScore,
  RuleBrowseItem,
  RuleBrowseQuery,
  SeasonalReminder,
  ShoppingWishlistItem,
  TopFitResult,
  TryonResult,
  WardrobeGapResult,
  WardrobeItem,
  WardrobeOutfit,
  WeatherData,
  WeatherProfile,
} from './types'

const BASE = '/api'
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

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() }
}

async function fetchWithTimeout(
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

async function unwrap<T>(res: Response): Promise<T> {
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

// ============ 跨柜联动 API ============

export async function getCrossCabinetRecommend(
  occasion?: string,
  profile?: CustomerProfile,
): Promise<CrossCabinetRecommendation> {
  const params = new URLSearchParams()
  if (occasion) params.set('occasion', occasion)
  for (const key of [
    'skin_tone',
    'face_shape',
    'body_type',
    'preferred_style',
    'skin_type',
    'neck_length',
    'eye_shape',
  ] as const) {
    const value = profile?.[key]
    if (typeof value === 'string' && value) params.set(key, value)
  }
  const url = `${BASE}/cross-cabinet/recommend${params.toString() ? '?' + params.toString() : ''}`
  const res = await fetchWithTimeout(url, { headers: headers() })
  return unwrap(res)
}

export async function getSeasonalReminder(): Promise<SeasonalReminder> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/seasonal`, { headers: headers() })
  return unwrap(res)
}

export async function getBrandPreference(): Promise<BrandPreference> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/brands`, { headers: headers() })
  return unwrap(res)
}

export async function getCabinetHealth(): Promise<CabinetHealth> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/health`, { headers: headers() })
  return unwrap(res)
}

// ============ 天气查询 API ============

export async function getWeatherProfile(location: string): Promise<WeatherProfile> {
  const params = new URLSearchParams({ location })
  const res = await fetchWithTimeout(`${BASE}/weather/profile?${params.toString()}`, {
    headers: headers(),
  })
  return unwrap(res)
}

// ============ 衣服照片上传与识别 API ============

export async function uploadClothing(file: File): Promise<ClothingItem> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetchWithTimeout(`${BASE}/clothing/upload`, {
    method: 'POST',
    headers: { 'X-Session-Id': getSessionId() },
    body: formData,
  })
  return unwrap(res)
}

// ============ LLM 文案增强 API ============

export async function enhanceRecommendationText(
  recommendation: EngineRecommendation,
  weather?: WeatherData | null,
  mode: 'store' | 'personal' = 'personal',
): Promise<EnhancedText> {
  const res = await fetchWithTimeout(`${BASE}/recommend/enhance`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ recommendation, weather: weather || null, mode }),
  })
  return unwrap(res)
}

// ============ 星座运势 API ============

export async function getDailyHoroscope(zodiac: string): Promise<HoroscopeData> {
  const params = new URLSearchParams({ zodiac })
  const res = await fetchWithTimeout(`${BASE}/horoscope/daily?${params.toString()}`, {
    headers: headers(),
  })
  return unwrap(res)
}

// ============ 虚拟试穿 API ============

export async function directTryon(
  personImage: File,
  garmentImage: File,
  category: string = 'top',
): Promise<TryonResult> {
  const formData = new FormData()
  formData.append('person_image', personImage)
  formData.append('garment_image', garmentImage)
  formData.append('category', category)
  const res = await fetchWithTimeout(
    `${BASE}/tryon/direct`,
    {
      method: 'POST',
      headers: { 'X-Session-Id': getSessionId() },
      body: formData,
    },
    30000,
  )
  return unwrap(res)
}

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
