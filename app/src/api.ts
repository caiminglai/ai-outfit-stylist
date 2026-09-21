/**
 * 后端 API 客户端
 *
 * 支持的 API:
 * - 顾客临时会话(创建/推荐/同步/删除)
 * - 规则引擎推荐
 * - 个人衣橱管理(CRUD/缺口分析/购物评估/心愿单)
 * - 个人化妆品柜管理(CRUD/缺口分析/购物评估/保质期检查)
 * - 个人配饰柜管理(CRUD/缺口分析/购物评估)
 * - 跨柜联动推荐(场合推荐/季节提醒/品牌偏好/健康检查)
 */
import type {
  AccessoryGapResult,
  AccessoryItem,
  BrandPreference, CabinetHealth,
  ClothingItem,
  CosmeticGapResult,
  CosmeticItem,
  CrossCabinetRecommendation,
  CustomerProfile, CustomerSession, EngineRecommendation,
  EnhancedText,
  HoroscopeData, HoroscopeListData,
  PrivacyNoticeData,
  PurchaseEvaluation,
  RuleBrowseItem, RuleBrowseQuery,
  SeasonalReminder,
  ShoppingWishlistItem,
  TryonResult,
  WardrobeGapResult,
  WardrobeItem,
  WeatherData, WeatherProfile
} from './types';

const BASE = '/api';
const DEFAULT_TIMEOUT = 10000;

/** 开发模式:提供更精确的错误提示 */
const _isDev = import.meta.env.DEV;

/** Session 过期时间:2 小时(毫秒) */
const SESSION_TTL = 2 * 60 * 60 * 1000;

/** localStorage 中存储 session 创建时间戳的 key */
const SESSION_TS_KEY = 'style_ai_session_ts';

/** 全局错误回调,组件层可注册监听 */
type GlobalErrorHandler = (message: string) => void;
let _globalErrorHandler: GlobalErrorHandler | null = null;

/** 注册全局网络错误处理器 */
export function setGlobalErrorHandler(handler: GlobalErrorHandler | null): void {
  _globalErrorHandler = handler;
}

/**
 * 获取当前 Session ID(带 TTL 自动过期检查)
 * 每次 API 请求和页面初始化时调用,过期自动清除并重新生成
 */
export function getSessionId(): string {
  let sid = localStorage.getItem('style_ai_session');
  const ts = localStorage.getItem(SESSION_TS_KEY);

  // 检查 session 是否过期
  if (sid && ts) {
    if (Date.now() - Number(ts) > SESSION_TTL) {
      // 过期则清除,重新生成
      localStorage.removeItem('style_ai_session');
      localStorage.removeItem(SESSION_TS_KEY);
      sid = '';
    }
  }

  if (!sid) {
    // 使用密码学安全的随机数生成 Session ID
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    sid = 'sess_' + Array.from(arr, b => b.toString(36).padStart(2, '0')).join('');
    localStorage.setItem('style_ai_session', sid);
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()));
  }
  return sid;
}

/**
 * 页面加载时主动清理过期 Session(防止长时间停留不操作导致旧 session 残留)
 * 在 App 入口调用一次即可
 */
export function clearExpiredSession(): void {
  const sid = localStorage.getItem('style_ai_session');
  const ts = localStorage.getItem(SESSION_TS_KEY);
  if (sid && ts && Date.now() - Number(ts) > SESSION_TTL) {
    localStorage.removeItem('style_ai_session');
    localStorage.removeItem(SESSION_TS_KEY);
  }
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Session-Id': getSessionId() };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      const msg = _isDev
        ? '请求超时 — 后端服务可能卡住或未响应,请查看终端日志'
        : '请求超时,请检查网络连接';
      _globalErrorHandler?.(msg);
      throw new Error(msg);
    }
    // 网络错误(后端未启动 / 端口错误 / CORS 等)
    const msg = _isDev
      ? '无法连接后端服务 — 请确认后端是否已启动,查看终端是否有报错'
      : '网络连接失败,请检查网络后重试';
    _globalErrorHandler?.(msg);
    throw new Error(msg);
  } finally {
    clearTimeout(timer);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg: string;
    if (res.status === 401) msg = '登录已过期,请刷新页面';
    else if (res.status === 404) msg = '请求的资源不存在,请检查 API 路径是否正确';
    else if (res.status === 429) msg = '请求过于频繁,请稍后再试';
    else if (res.status >= 500) {
      msg = _isDev
        ? `后端服务内部错误 (HTTP ${res.status}),请查看终端日志`
        : '服务异常,请稍后重试';
    }
    else msg = `请求异常 (HTTP ${res.status}),请查看终端日志`;
    _globalErrorHandler?.(msg);
    throw new Error(msg);
  }
  let json: { success: boolean; data: T; error?: { code: string; message: string; }; };
  try { json = await res.json(); } catch (parseErr) {
    if (_isDev) console.error('[API] JSON 解析失败:', parseErr);
    const msg = _isDev
      ? '后端返回非 JSON 数据,可能是服务崩溃或返回了 HTML 错误页,请查��终端日志'
      : '响应数据格式异常';
    _globalErrorHandler?.(msg);
    throw new Error(msg);
  }
  if (!json.success) {
    const msg = json.error?.message || (_isDev ? '操作失败(后端 success=false),请查看终端日志' : '请求失败');
    _globalErrorHandler?.(msg);
    throw new Error(msg);
  }
  return json.data;
}

// ============ 顾客隐私数据 API(门店模式) ============

export async function createCustomerSession(profileData: CustomerProfile): Promise<CustomerSession> {
  const res = await fetchWithTimeout(`${BASE}/customer/session`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile_data: profileData }),
  });
  return unwrap(res);
}

/** @unused 待实现:获取已有会话 */
export async function getCustomerSession(sessionId: string): Promise<CustomerSession> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}`, { headers: headers() });
  return unwrap(res);
}

/** @unused 待实现:更新会话画像 */
export async function updateCustomerSession(sessionId: string, profileData: Partial<CustomerProfile>): Promise<CustomerSession> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}`, {
    method: 'PUT', headers: headers(),
    body: JSON.stringify({ profile_data: profileData }),
  });
  return unwrap(res);
}

export async function syncCustomerToCloud(sessionId: string): Promise<CustomerSession & { synced_at: string; }> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}/sync`, {
    method: 'POST', headers: headers(),
  });
  return unwrap(res);
}

export async function deleteCustomerSession(sessionId: string): Promise<{ deleted: boolean; }> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}`, {
    method: 'DELETE', headers: headers(),
  });
  return unwrap(res);
}

export async function getCustomerRecommendation(sessionId: string, mode: 'store' | 'personal' = 'store'): Promise<{
  recommendation: EngineRecommendation;
  mode: string;
  log_id: number;
  privacy_notice: string;
}> {
  const res = await fetchWithTimeout(`${BASE}/customer/session/${sessionId}/recommend`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ mode }),
  });
  return unwrap(res);
}

/** @unused 待实现:隐私声明页 */
export async function getPrivacyNotice(): Promise<PrivacyNoticeData> {
  const res = await fetchWithTimeout(`${BASE}/customer/privacy-notice`, { headers: headers() });
  return unwrap(res);
}

// ============ 规则引擎推荐 API(通用) ============

export async function getEngineRecommendation(profile: CustomerProfile, mode: 'store' | 'personal' = 'store'): Promise<{
  recommendation: EngineRecommendation;
  mode: string;
  privacy_notice: string;
}> {
  const res = await fetchWithTimeout(`${BASE}/recommend/engine`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile, mode }),
  });
  return unwrap(res);
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
export async function browseRules(query: RuleBrowseQuery = {}): Promise<{ rules: RuleBrowseItem[]; total: number; }> {
  const params = new URLSearchParams();
  if (query.mode) params.set('mode', query.mode);
  if (query.category) params.set('category', query.category);
  if (query.gender) params.set('gender', query.gender);
  if (query.scenario) params.set('scenario', query.scenario);
  const qs = params.toString();
  const url = `${BASE}/rules/browse${qs ? '?' + qs : ''}`;
  const res = await fetchWithTimeout(url, { headers: headers() });
  return unwrap(res);
}

// ============ 个人衣橱 API ============

export async function listWardrobeItems(): Promise<WardrobeItem[]> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items`, { headers: headers() });
  const data = await unwrap<{ items: WardrobeItem[]; count: number; }>(res);
  return data.items ?? [];
}

export async function addWardrobeItem(item: Partial<WardrobeItem>): Promise<WardrobeItem> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(item),
  });
  return unwrap(res);
}

/** @unused 待实现:编辑衣橱单品 */
export async function updateWardrobeItem(id: number, item: Partial<WardrobeItem>): Promise<WardrobeItem> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items/${id}`, {
    method: 'PUT', headers: headers(),
    body: JSON.stringify(item),
  });
  return unwrap(res);
}

export async function deleteWardrobeItem(id: number): Promise<{ deleted: boolean; }> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/items/${id}`, {
    method: 'DELETE', headers: headers(),
  });
  return unwrap(res);
}

export async function getWardrobeGaps(profile?: CustomerProfile): Promise<WardrobeGapResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/gaps`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

/** @unused 待实现:购物评估 */
export async function evaluatePurchase(candidate: Record<string, unknown>, profile?: CustomerProfile): Promise<PurchaseEvaluation> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/evaluate`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ candidate, profile: profile || {} }),
  });
  return unwrap(res);
}

export async function suggestPurchases(profile?: CustomerProfile): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/suggest`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

/** @unused 待实现:衣橱页直接推荐 */
export async function getWardrobeRecommendation(profile: CustomerProfile): Promise<{
  recommendation: EngineRecommendation;
  mode: string;
  privacy_notice: string;
}> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/recommend`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile }),
  });
  return unwrap(res);
}

/** @unused 待实现:心愿单列表 */
export async function listWishlist(): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/wishlist`, { headers: headers() });
  return unwrap(res);
}

/** @unused 待实现:添加心愿单 */
export async function addToWishlist(item: Partial<ShoppingWishlistItem>): Promise<ShoppingWishlistItem> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/wishlist`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(item),
  });
  return unwrap(res);
}

export async function getWardrobeStatus(): Promise<WardrobeGapResult> {
  const res = await fetchWithTimeout(`${BASE}/wardrobe/status`, { headers: headers() });
  return unwrap(res);
}

// ============ 个人化妆品柜 API ============

export async function listCosmetics(): Promise<CosmeticItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items`, { headers: headers() });
  const data = await unwrap<{ items: CosmeticItem[]; count: number; }>(res);
  return data.items ?? [];
}

export async function addCosmetic(item: Partial<CosmeticItem>): Promise<CosmeticItem> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(item),
  });
  const data = await unwrap<{ item: CosmeticItem; }>(res);
  return data.item;
}

/** @unused 待实现:编辑化妆品 */
export async function updateCosmetic(id: number, item: Partial<CosmeticItem>): Promise<CosmeticItem> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items/${id}`, {
    method: 'PUT', headers: headers(),
    body: JSON.stringify(item),
  });
  return unwrap(res);
}

export async function deleteCosmetic(id: number): Promise<{ deleted: boolean; }> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/items/${id}`, {
    method: 'DELETE', headers: headers(),
  });
  return unwrap(res);
}

export async function getCosmeticExpiry(): Promise<CosmeticItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/expiry`, { headers: headers() });
  return unwrap(res);
}

export async function getCosmeticGaps(profile?: CustomerProfile): Promise<CosmeticGapResult> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/gaps`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

/** @unused 待实现:化妆品购物评估 */
export async function evaluateCosmeticPurchase(candidate: Record<string, unknown>, profile?: CustomerProfile): Promise<PurchaseEvaluation> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/evaluate`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ candidate, profile: profile || {} }),
  });
  return unwrap(res);
}

export async function suggestCosmetics(profile?: CustomerProfile): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/cosmetic/suggest`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

// ============ 个人配饰柜 API ============

export async function listAccessories(): Promise<AccessoryItem[]> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items`, { headers: headers() });
  const data = await unwrap<{ items: AccessoryItem[]; count: number; }>(res);
  return data.items ?? [];
}

export async function addAccessory(item: Partial<AccessoryItem>): Promise<AccessoryItem> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(item),
  });
  const data = await unwrap<{ item: AccessoryItem; }>(res);
  return data.item;
}

/** @unused 待实现:编辑配饰 */
export async function updateAccessory(id: number, item: Partial<AccessoryItem>): Promise<AccessoryItem> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items/${id}`, {
    method: 'PUT', headers: headers(),
    body: JSON.stringify(item),
  });
  return unwrap(res);
}

export async function deleteAccessory(id: number): Promise<{ deleted: boolean; }> {
  const res = await fetchWithTimeout(`${BASE}/accessory/items/${id}`, {
    method: 'DELETE', headers: headers(),
  });
  return unwrap(res);
}

export async function getAccessoryGaps(profile?: CustomerProfile): Promise<AccessoryGapResult> {
  const res = await fetchWithTimeout(`${BASE}/accessory/gaps`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

/** @unused 待实现:配饰购物评估 */
export async function evaluateAccessoryPurchase(candidate: Record<string, unknown>, profile?: CustomerProfile): Promise<PurchaseEvaluation> {
  const res = await fetchWithTimeout(`${BASE}/accessory/evaluate`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ candidate, profile: profile || {} }),
  });
  return unwrap(res);
}

export async function suggestAccessories(profile?: CustomerProfile): Promise<ShoppingWishlistItem[]> {
  const res = await fetchWithTimeout(`${BASE}/accessory/suggest`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ profile: profile || {} }),
  });
  return unwrap(res);
}

// ============ 跨柜联动 API ============

export async function getCrossCabinetRecommend(occasion?: string, profile?: CustomerProfile): Promise<CrossCabinetRecommendation> {
  const params = new URLSearchParams();
  if (occasion) params.set('occasion', occasion);
  const url = `${BASE}/cross-cabinet/recommend${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetchWithTimeout(url, { headers: headers() });
  return unwrap(res);
}

export async function getSeasonalReminder(profile?: CustomerProfile): Promise<SeasonalReminder> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/seasonal`, { headers: headers() });
  return unwrap(res);
}

export async function getBrandPreference(): Promise<BrandPreference> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/brands`, { headers: headers() });
  return unwrap(res);
}

export async function getCabinetHealth(): Promise<CabinetHealth> {
  const res = await fetchWithTimeout(`${BASE}/cross-cabinet/health`, { headers: headers() });
  return unwrap(res);
}

// ============ 天气查询 API ============

/** @unused 待实现:天气查询(已用 getWeatherProfile 替代) */
export async function getWeather(location: string): Promise<WeatherData> {
  const params = new URLSearchParams({ location });
  const res = await fetchWithTimeout(`${BASE}/weather?${params.toString()}`, { headers: headers() });
  return unwrap(res);
}

export async function getWeatherProfile(location: string): Promise<WeatherProfile> {
  const params = new URLSearchParams({ location });
  const res = await fetchWithTimeout(`${BASE}/weather/profile?${params.toString()}`, { headers: headers() });
  return unwrap(res);
}

// ============ 衣服照片上传与识别 API ============

export async function uploadClothing(file: File): Promise<ClothingItem> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetchWithTimeout(`${BASE}/clothing/upload`, {
    method: 'POST',
    headers: { 'X-Session-Id': getSessionId() },
    body: formData,
  });
  return unwrap(res);
}

/** @unused 待实现:衣服列表 */
export async function listClothing(): Promise<ClothingItem[]> {
  const res = await fetchWithTimeout(`${BASE}/clothing/list`, { headers: headers() });
  const data = await unwrap<{ items: ClothingItem[]; }>(res);
  return data.items ?? [];
}

/** @unused 待实现:删除衣服 */
export async function deleteClothing(itemId: number): Promise<{ deleted: boolean; }> {
  const res = await fetchWithTimeout(`${BASE}/clothing/${itemId}`, {
    method: 'DELETE', headers: headers(),
  });
  return unwrap(res);
}

// ============ LLM 文案增强 API ============

export async function enhanceRecommendationText(
  recommendation: EngineRecommendation,
  weather?: WeatherData | null,
  mode: 'store' | 'personal' = 'personal'
): Promise<EnhancedText> {
  const res = await fetchWithTimeout(`${BASE}/recommend/enhance`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ recommendation, weather: weather || null, mode }),
  });
  return unwrap(res);
}

// ============ 星座运势 API ============

export async function getDailyHoroscope(zodiac: string): Promise<HoroscopeData> {
  const params = new URLSearchParams({ zodiac });
  const res = await fetchWithTimeout(`${BASE}/horoscope/daily?${params.toString()}`, { headers: headers() });
  return unwrap(res);
}

/** @unused 待实现:星座列表 */
export async function getHoroscopeList(): Promise<HoroscopeListData> {
  const res = await fetchWithTimeout(`${BASE}/horoscope/list`, { headers: headers() });
  return unwrap(res);
}

// ============ 虚拟试穿 API ============

export async function directTryon(
  personImage: File,
  garmentImage: File,
  category: string = 'top'
): Promise<TryonResult> {
  const formData = new FormData();
  formData.append('person_image', personImage);
  formData.append('garment_image', garmentImage);
  formData.append('category', category);
  const res = await fetchWithTimeout(`${BASE}/tryon/direct`, {
    method: 'POST',
    headers: { 'X-Session-Id': getSessionId() },
    body: formData,
  }, 30000);
  return unwrap(res);
}
