/**
 * 后端 API 客户端
 *
 * 支持的 API:
 * - 顾客临时会话(创建/推荐/同步/删除)
 * - 规则引擎推荐
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
  RuleBrowseItem,
  RuleBrowseQuery,
  SeasonalReminder,
  ShoppingWishlistItem,
  TopFitResult,
  TryonResult,
  WardrobeGapResult,
  WardrobeItem,
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

export async function createCustomerSession(
  profileData: CustomerProfile,
): Promise<CustomerSession> {
  const res = await fetchWithTimeout(`${BASE}/customer/session`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile_data: profileData, store: getStoreName() }),
  })
  return unwrap(res)
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
  return unwrap(res)
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
): Promise<{
  recommendation: EngineRecommendation
  mode: string
  privacy_notice: string
  /** 本次与长期档案的交互:used_fields=从档案补进来的字段中文名,saved_fields=本次存进档案的字段数,tags=算完落库的标签 */
  archive?: { used_fields: string[]; saved_fields: number; tags?: ProfileTag[] }
}> {
  const res = await fetchWithTimeout(`${BASE}/recommend/engine`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ profile, mode }),
  })
  return unwrap(res)
}

// ============ 规则反馈 API(点一次记一行,换主意覆盖旧的那行) ============

/** 这条建议准不准:useful=有用 / inaccurate=不准 */
export async function postRuleFeedback(
  groupId: number,
  category: string,
  signal: 'useful' | 'inaccurate',
): Promise<{ group_id: number; signal: string; feedback_up: number; feedback_down: number }> {
  const res = await fetchWithTimeout(`${BASE}/recommend/feedback`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ group_id: groupId, category, signal }),
  })
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
