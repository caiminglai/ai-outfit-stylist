/**
 * 共享工具函数
 * 消除 routes 中 generateUUID / uploads 目录检查的重复代码
 */
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { beijingMonth } = require('./beijingTime')

/** 生成 UUID v4 */
function generateUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.randomBytes(1)[0] & 0x0f
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** uploads 目录路径 */
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')

/** 确保 uploads 目录存在 */
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

// 模块加载时自动创建
ensureUploadDir()

/**
 * 解析分页参数
 * @param {object} query - req.query
 * @returns {{page: number, limit: number, offset: number, paginated: boolean}}
 */
function parsePagination(query) {
  const q = query || {}
  // 页码必须封顶：offset = (page-1)*limit 要作为整数绑进 LIMIT/OFFSET，而 SQLite 的整数是 i64。
  // 实测（2026-10-12，:memory: 上跑的）`?page=99999999999999999999` ⇒ parseInt 得 1e20（浮点）
  // ⇒ offset=2e21 ⇒ better-sqlite3 绑参当场抛 `datatype mismatch` ⇒ 一个"页码写得离谱"回 500。
  // 取 1e6 页上限 ⇒ 最大 offset = (1e6-1)*100 ≈ 1e8，仍在 i64 内、也远大于任何真实数据深度；
  // 再靠后的页码就如实给空页，而不是抛错。正常翻页（page 从 1 往上）行为一点没动。
  const MAX_PAGE = 1000000
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(q.page, 10) || 1))
  // 这里不能写 `parseInt(q.limit,10) || 20`：limit=0 会被当成"没传"直接变 20，
  // 后面那层 Math.max(1, …) 下限就永远轮不到了。
  const rawLimit = parseInt(q.limit, 10)
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(100, Math.max(1, rawLimit))
  const offset = (page - 1) * limit
  const paginated = q.page !== undefined || q.limit !== undefined
  return { page, limit, offset, paginated }
}

module.exports = {
  generateUUID,
  UPLOAD_DIR,
  ensureUploadDir,
  parsePagination,
  getSessionId,
  parseJsonField,
  parseIdList,
  asText,
  asNumber,
  asId,
  asFilters,
  stripIdentityFields,
  ownValue,
  toEnabledBit,
  firstBadScalar,
  tally,
  getCurrentSeason,
  normalizeItem,
  projectWardrobeForEngine,
}

// ============================================================
// 以下函数供各路由模块共享使用，消除重复定义
// ============================================================

/**
 * 从请求头获取 Session ID（X-Session-Id），也支持请求体中的 session_id
 *
 * 两条来源都要过 asText：脚本把 session_id 写成 {"a":1} 或 ["x"] 时，原来这里
 * 原样返回对象/数组，调用方紧接着 `db.prepare('... WHERE session_id = ?').get(sid)`
 * ⇒ better-sqlite3 绑参 RangeError/TypeError ⇒ 认证类接口回 500。
 * 非文本一律当"没带 id"（返回 null），由 loginRequired 回 401。
 */
function getSessionId(req) {
  const sid = req.headers['x-session-id']
  if (sid && String(sid).trim()) return String(sid).trim()
  const body = req.body || {}
  return asText(body.session_id) || null
}

/**
 * 解析标签类 JSON 字段，**保证返回数组**（空值返回 []）。
 *
 * 库里这些列（style_tags / color_tags / season_tags / *_fit …）都是
 * JSON.stringify 出来的数组，但历史脏数据或脚本直写会留下三种非数组形状：
 * ① 裸字符串 '暖皮' ② JSON 数字 123 / 布尔 true ③ 对象。
 * 原来 `typeof val !== 'string' 就原样返回`：② 递出去的是数字 ⇒ 调用方
 * `seasons.includes(x)` 之后 `.map()`/`forEach` 当场 TypeError ⇒ 500；
 * ① 递出去的是字符串 ⇒ `'暖皮,冷皮'.includes('暖皮')` 为真 ⇒ 标签匹配悄悄退化成子串匹配。
 * 全仓调用点都写成 `parseJsonField(x) || []` 再按数组用，这里把契约收敛成"就是数组"。
 */
function parseJsonField(val) {
  if (val === null || val === undefined) return []
  let v = val
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    try {
      v = JSON.parse(s)
    } catch {
      return [s] // 不是 JSON：当一条标签文本，别让字符串去冒充数组
    }
  }
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.trim() ? [v.trim()] : []
  return [] // 对象/数字/布尔：这不是标签列表，按空处理比抛错好
}

/**
 * 解析"id 列表"类 JSON 字段（今天就是 `wardrobe_outfits.item_ids` 那一列），
 * **保证返回去重后的正整数数组**。
 *
 * 与 `parseJsonField` 的差别是**口径**不是形状：那一支要的是标签字符串，原样交给调用方；
 * 这一支要的是能进 `WHERE id IN (…)` 的数，所以脏元素（0／负数／'abc'/对象）必须在这里丢掉，
 * ⛔ 不许原样递出去当 id 用（那等于把"这件不属于任何人"的假行喂给查询）。
 * 🔴 唯一真相源：`services/wearPreference.js`（读这个人自己的日记）与
 * `services/collabFilter.js`（读别人的日记）都从这里取，⛔ 不许再写第三份。
 */
function parseIdList(val) {
  const out = []
  const seen = new Set()
  for (const x of parseJsonField(val)) {
    const n = Number(x)
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * 把请求里的字段读成文本：数组/对象/null 一律当成"没填"，返回空串。
 * 为什么要这一层：`(data.name || '').trim()` 在 name 传成 ["a"] 时是
 * `["a"].trim` ⇒ TypeError ⇒ 整条路由回 500，而这本该是 400「字段没填对」。
 * @param {*} v - req.body / req.query 里的任意值
 * @returns {string} 去空白后的字符串，非文本类型返回 ''
 */
function asText(v) {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * 列表接口的筛选参数：一次把指定几键过成文本，非文本（数组/对象）当"没这个筛选"。
 * 10-13 现量的 500 面：`?category[]=上衣&category[]=裤子` 被 Express 解析成数组，
 * 路由 `if (category) params.push(category)` 判真后原样绑进 SQLite ⇒ RangeError ⇒ 列表页 500。
 * 后端有 8 处以上是同一个形状，统一走这里而不是各写各的，口径才不会飘。
 * @param {object} query - req.query
 * @param {string[]} keys - 要收的筛选键名
 * @returns {Record<string, string>} 每个键对应 asText 后的值（缺键/非文本 ⇒ ''）
 */
function asFilters(query, keys) {
  const src = query || {}
  const out = {}
  for (const k of keys) out[k] = asText(src[k])
  return out
}

/**
 * 把请求里的数字字段读成数字，读不出来就退回默认值。
 * 与 asText 同一个理由：better-sqlite3 只接受 number/string/bigint/buffer/null，
 * 前端（或脚本）塞进 []、{}、'abc' 时，绑参当场 TypeError ⇒ 入参错回成 500。
 * @param {*} v - 请求里的原值
 * @param {number|null} fallback - 认不出来时的返回值（传 null 表示"这一列就留空"）
 * @returns {number|null}
 */
function asNumber(v, fallback = null) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

/**
 * 把请求里的 enabled 读成库里的 0/1（同一张表的 POST 与 PUT 必须走同一个口径）。
 * 后台复选框给布尔 true/false，脚本可能给 0/'0'/'false'，"这次没带"给 undefined。
 * 原来各处写成 `enabled !== false ? 1 : 0`：传 0 会被当成"启用"，
 * 于是"新建就停用"这条根本做不到，而同一个 0 走另一处更新又能存成 0——两个入口结果相反。
 * @param {*} value 请求里的原值
 * @param {0|1|null} fallback 没带（undefined/null）时沿用谁：POST 传 1，PUT 传库里的旧值
 * @returns {0|1}
 */
function toEnabledBit(value, fallback) {
  const v = value === undefined || value === null ? fallback : value
  if (v === undefined || v === null) return 1
  if (v === false || v === 0 || v === '0' || v === 'false') return 0
  return 1
}

/**
 * 按键取对象"自有属性"的值，取不到返回 undefined（不沿原型链找）。
 * 这些查表的键来自请求体里的自由文本，直接写 `TABLE[key]` 时
 * key = 'constructor' / 'toString' / '__proto__' 会拿到 Object.prototype 上的函数，
 * 调用方接着把它当数组展开（`...aliases`）或当列表遍历就 TypeError ⇒ 入参错回成 500。
 * @param {object} table - 常量映射表
 * @param {*} key - 任意键（只有字符串自有键才认）
 */
function ownValue(table, key) {
  if (table === null || table === undefined) return undefined
  // 只认字符串/数字键：对象当键会被 hasOwnProperty 隐式转成 '[object Object]'，
  // 万一表里真有这么个键（JSON 反序列化出来的），就会返回一条毫不相干的值。
  if (typeof key !== 'string' && typeof key !== 'number') return undefined
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

/**
 * 部分更新/新建时，检查"直接绑进 SQLite 的可空标量列"里有没有根本绑不进去的类型。
 * 实测本机 better-sqlite3 只认 number / string / bigint / buffer / null：
 * 传 true 报 `TypeError: SQLite3 can only bind numbers...`，传 [] 或 {} 报
 * `RangeError: Too few parameter values were provided`——两种都让一个纯粹的下笔错误
 * 从路由的 catch 里出来成 500。NaN/Infinity 是能绑的（Number 类型），但 asNumber 已经
 * 把非有限数挡掉了，所以这里只挡布尔和对象/数组。
 * @param {object} body - req.body
 * @param {string[]} fields - 要检查的字段名（布尔开关类字段别放进来，它们会先转成 0/1）
 * @returns {string|null} 第一个不合法的字段名；全部合法返回 null
 */
function firstBadScalar(body, fields) {
  const src = body || {}
  for (const f of fields) {
    const v = src[f]
    if (v === undefined || v === null) continue
    if (typeof v === 'string' || typeof v === 'number') continue
    return f
  }
  return null
}

/**
 * 按"用户自己填的文本"计数时用的空对象。
 * 普通 {} 带原型链，键一旦是 __proto__ / constructor 这类名字就出事：
 * ① `map['__proto__'] = (map['__proto__'] || 0) + 1` 读到 Object.prototype（truthy），
 *    写回去被引擎静默忽略 ⇒ 这一件从统计里凭空消失；
 * ② `map['constructor'] = (map['constructor'] || 0) + 1` 读到函数 ⇒ 函数+1 = NaN，
 *    统计里冒出一个 NaN，JSON 出去是 null。
 * Object.create(null) 两条都不成立，Object.entries / for...in / JSON 都照常工作。
 * @returns {object} 没有原型的空对象
 */
function tally() {
  return Object.create(null)
}

/**
 * 获取当前季节（按北京时间的月份，不按容器时区）
 * 容器没设 TZ ⇒ getMonth() 读的是 UTC，3/6/9/12 月头 8 小时会算成上一季。
 * @param {Date} [at] 只在测试里传固定时刻
 */
function getCurrentSeason(at) {
  const m = beijingMonth(at)
  if (m >= 3 && m <= 5) return '春'
  if (m >= 6 && m <= 8) return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

/**
 * 样本/快照里不许留下的身份字段。名单一次定死，两条出口共用：
 *   - routes/customer.js 入库 profile_data 之前
 *   - services/profileArchive.js 写 recommendation_logs.input_snapshot 之前
 * 只删顶层两项是不够的：手机号写成 `contact.phone` 这种嵌套位置就绕过去了。
 */
const IDENTITY_KEYS = [
  'nickname',
  'phone',
  'mobile',
  'tel',
  'email',
  'id_card',
  'idcard',
  'wechat',
  'wechat_id',
  'qq',
  'real_name',
  'avatar_url',
]

/**
 * 递归剥掉身份字段（对象、数组都下钻），给"长期留存但不含身份"的快照用。
 * 用 Object.fromEntries 而不是 out[k]=v：键名撞上 __proto__ 时赋值会改原型，
 * fromEntries 走的是普通属性创建，畸形请求体塞 {"__proto__":{...}} 也只当个普通键。
 */
function stripIdentityFields(val, depth = 0) {
  if (depth > 8) return null // 防御性封顶：递归深度不该由请求体说了算
  if (Array.isArray(val)) return val.map((v) => stripIdentityFields(v, depth + 1))
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val)
        .filter(([k]) => !IDENTITY_KEYS.includes(String(k).toLowerCase()))
        .map(([k, v]) => [k, stripIdentityFields(v, depth + 1)]),
    )
  }
  return val
}

/**
 * 规整化数据行：解析 JSON 标签字段
 * @param {object} row - 数据库行
 * @param {string[]} tagFields - 需要 JSON.parse 的字段名列表
 */
function normalizeItem(row, tagFields) {
  const defaults = [
    'style_tags',
    'color_tags',
    'season_tags',
    'occasion_tags',
    'fit_skin_tones',
    'fit_face_shapes',
    'fit_body_types',
    'skin_tone_fit',
    'skin_type_fit',
    'face_shape_fit',
    'eye_shape_fit',
    'lip_shape_fit',
    'neck_length_fit',
  ]
  // 🔴 10-22 第十三阶段·一f：只认"真的是数组"的那一份词表。
  // `routes/recommend.js` 原来写 `rows.map(normalizeItem)`，`Array.map` 把**下标**当第二个参数喂进来，
  // 下标 ≥1 是truthy 数字 ⇒ `for (const f of 1)` 当场 `TypeError: fields is not iterable`。
  // 这里再加一道形状闸门：⛔ 不许把非数组（数字/字符串/对象）当词表用，一律回默认表。
  const fields = Array.isArray(tagFields) ? tagFields : defaults
  const item = { ...row }
  for (const f of fields) {
    // 只处理这一行真有的列，不给响应凭空加字段
    if (!(f in item)) continue
    // 统一过 parseJsonField：NULL → []，裸字符串 → ['值']，
    // 原来解析失败时"保持原始值"会把字符串交给前端当数组用（.map 当场报错）。
    item[f] = parseJsonField(item[f])
  }
  return item
}

/**
 * 读路由参数里的数字 id，只认「整串十进制正整数」，别的样子一律 null。
 * 原来各处写 `parseInt(req.params.id, 10)`：`12abc` 会被截成 **12**，于是
 * `PUT /api/wardrobe/items/12abc` 动的其实是 12 号那条——参数写错的人看见了「成功」，
 * 而另一条数据被改了。10-13 实测 better-sqlite3 绑 NaN／12abc 都不抛（SELECT 回 undefined），
 * 所以这条 bug 不会以 500 现形，只会安静地作用在别的行上。
 * 截出来的数字本身合法（0 与超安全整数范围的除外）时返回 number，否则 null，由调用方回 400。
 * @param {*} raw - req.params 里的原值（Express 给字符串）
 * @returns {number|null}
 */
function asId(raw) {
  const s = asText(raw).trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  // id 从 1 起（INTEGER PRIMARY KEY 自增），0 与超出安全整数范围的都不认
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * 把一行衣橱（已过 `normalizeItem`）投影成**推荐引擎要的 `wardrobe_items` 那份形状**。
 *
 * 2026-10-21 第九阶段·第一步从 `routes/wardrobe.js` 的那段行内 map 搬过来当唯一真相源
 * （`docs/依据/17-协同过滤输入输出规范-20261021.md` §五 第 2 条：`/api/recommend/engine`
 * 也要注入衣橱行，两处各抄一份字段清单，迟早出现"一边带 fit_type、另一边漏"的假象）。
 *
 * 每一格为什么在名单里（原注释逐字搬过来，⛔ 别删）：
 *  - `fit_style`/`fabric_weight`：展示标签（fit_style 10-19 第三阶段起不进任何算式，两档值域撑不起四档松量）
 *  - `fit_type`：量不了尺寸的人只靠这一格让松量估得出来（10-19 第三阶段·模块一）。
 *    ⛔ 这一列必须在投影里，漏了它引擎就永远读不到版型 ⇒ 兜底估算整条断线。
 *  - 四格成品实测尺寸：引擎的 bodyFit 现在只认这几个数（10-19 第二阶段「最后一公里」）。
 * @param {object} i 一行衣橱（normalizeItem 之后）
 * @returns {object} 引擎直接能用的那一格
 */
function projectWardrobeForEngine(i) {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    color: i.color,
    pattern: i.pattern,
    fit_style: i.fit_style,
    fabric_weight: i.fabric_weight,
    fit_type: i.fit_type,
    shoulder_cm: i.shoulder_cm,
    bust_cm: i.bust_cm,
    length_cm: i.length_cm,
    waistband_cm: i.waistband_cm,
    style_tags: i.style_tags || [],
    season_tags: i.season_tags || [],
    occasion_tags: i.occasion_tags || [],
  }
}
