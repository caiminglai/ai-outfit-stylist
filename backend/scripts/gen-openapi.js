/**
 * OpenAPI 3.0 说明书生成器（11-02 规范整改轮新增）
 * =================================================
 * 判据来自他那句「不要重复造轮子」：接口清单**不手写第二份**，而是从 Express 自己的路由栈里
 * 抽出来。仓库里早就有同一招——`routes/admin.js` 的「接口路由」页就是走 `app._router.stack`
 * 拿清单的，只是它只取了路径。这里在同一条路上多取三样：鉴权闸、限流闸、请求字段。
 *
 * 用法：
 *   node scripts/gen-openapi.js            生成并写入 docs/api/openapi.json
 *   node scripts/gen-openapi.js --check    只比对不写盘，有漂移就 rc=1（CI 用这条）
 *
 * 三条硬约束（都是"为什么它敢当门禁"的前提）：
 *   1) **不新增依赖**：起实例用的工装与 `test/healthRateLimitExempt.test.js` 同一套
 *      （PORT=0 ＋ 把 `db/init` 换成内存库），YAML 不碰、JSON 直接 stringify。
 *   2) **零运行时副作用**：`app.server.close()` 立刻关掉临时端口；库是内存库，⛔ 不碰
 *      `backend/db/styleai.db` 那份被 skip-worktree 钉过的活库。
 *   3) **可重算**：输出里不写时间戳，排序全固定 ⇒ 同一条命令跑两次字节相同，`--check` 才有意义。
 *
 * 哪些字段是"抽出来的"、哪些是"猜的"，逐条写明，别把启发式当契约：
 *   - 路径／方法／路径参数＝Express 内部事实，硬。
 *   - 鉴权＝中间件函数的**名字**（`loginRequired`／`adminLoginRequired`），改名会瞎，故有测试钉住。
 *   - 限流＝本仓工厂在中间件上挂的 `rateLimitProfile` 属性（见 `middleware/rateLimit.js`），硬。
 *     三道来源都认：路由自带的（`router.post('/login', loginLimiter, h)`）、子 router 里按前缀挂的
 *     （`routes/admin.js:31` 的 `router.use('/api', adminApiLimiter)`）、顶层总闸
 *     （`app.use('/api/', apiLimiter)`）。`x-rate-limit.scope` 写清是哪一层。
 *     ⚠️ 一条路由可能同时吃两道闸（自带的 10 次/分 ＋ 总闸 100 次/15 分），这里只记**最贴身**
 *     的那一道，别读成"这条路由只过这一关"。前提：server.js 的两道闸也走工厂——11-02 之前它
 *     直接 `require('express-rate-limit')`，库造的中间件是匿名函数且不带这个属性，顶层闸就全瞎。
 *   - 请求字段＝从处理函数字符串里正则扫 `req.body.x`／`const {a,b} = req.body`／`req.query.x`，
 *     是启发式：动态取键（`req.body[key]`）取不到，条件分支里的会多报。所以每个操作都带
 *     `x-fields-confidence: heuristic` 标记，读的人知道该去对代码。
 *   - 状态码＝扫 `sendCreated(`→201、`sendSuccess(`→200、`res.status(204)`→204、
 *     `sendError(..., <三位数>)` 收进 4xx/5xx，同样是启发式，但每条都有对应的测试兜着。
 *   - 摘要（summary）＝从路由源文件里那条注册语句**正上方的注释**取（本仓注释密度高，这条最省事
 *     也最不容易漂），没有注释就退回 `METHOD /path`。
 */
const fs = require('fs')
const path = require('path')

const BACKEND = path.join(__dirname, '..')
const OUT_FILE = path.join(BACKEND, '..', 'docs', 'api', 'openapi.json')
const CHECK = process.argv.includes('--check')

// ── 1. 起一个不落盘的实例（与 test/healthRateLimitExempt.test.js 同一套工装）────────────
process.env.PORT = '0'
const Database = require('better-sqlite3')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(BACKEND, 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}
const app = require('../server')
try {
  app.server.close()
} catch {
  /* server.js 在端口还没起来时就没有 server 可关，忽略 */
}

// ── 2. 挂载前缀：把 Express 给中间件层编的正则还原成路径 ────────────────────────────
// `app.use('/api/auth', r)` 的 layer.regexp.source ＝ `^\/api\/auth\/?(?=\/|$)`，
// 去掉转义后从第一个 `/?` 处截断即得 `/api/auth`。⛔ 别照抄 `routes/admin.js` 里那句
// `/^\^\\\/([^?\\]+)/`——它在第二个 `/` 前就停了，`/api/auth` 会被读成 `/api`，
// 于是「接口路由」页把 `/api/auth/guest` 印成 `/api/guest`（本轮实测，见该文件的修正）。
function mountOf(layer) {
  const src = layer.regexp && layer.regexp.source
  if (!src) return null
  const unescaped = src.slice(1).replace(/\\(.)/g, '$1')
  const cut = unescaped.indexOf('/?')
  if (cut < 0) return null
  return unescaped.slice(0, cut) || '/'
}

// ── 3. 从 server.js 源码里认"哪个挂载点对应哪个路由文件"，再回头取注释当摘要 ──────────
const serverPath = path.join(BACKEND, 'server.js')
const serverSrc = fs.readFileSync(serverPath, 'utf-8')
const varToFile = {}
for (const m of serverSrc.matchAll(/const\s+(\w+)\s*=\s*require\('\.\/([\w/.-]+)'\)/g)) {
  varToFile[m[1]] = path.join(BACKEND, m[2] + '.js')
}
const mountToFile = {}
for (const m of serverSrc.matchAll(/app\.use\('([^']+)'[^)]*?(\w+Routes)\)/g)) {
  if (varToFile[m[2]]) mountToFile[m[1]] = varToFile[m[2]]
}

const fileCache = new Map()
function sourceOf(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '')
  }
  return fileCache.get(file)
}

// banner 行（`// ===== 一、衣橱单品 CRUD =====`、整行只有 = - * 的分隔线）不算摘要
const isBanner = (t) => /^[-=*·—\s]*$/.test(t) || (t.match(/[-=*]/g) || []).length > t.length * 0.4

/** 把一行注释（`// x`、`/** x *\/`、`* x`）洗成正文；不是注释或只是分隔线就回 null */
function commentText(raw) {
  const t = raw.trim()
  if (!t) return null
  let text = null
  if (t.startsWith('//')) text = t.replace(/^\/\/+\s*/, '')
  else if (t.startsWith('/*')) text = t.replace(/^\/\*+\s*/, '').replace(/\s*\*+\/$/, '')
  else if (t.startsWith('*')) text = t.replace(/^\*+\s?/, '')
  if (text === null) return null
  text = text.trim()
  if (!text || isBanner(text)) return null
  // `@param`/`@returns` 这类 JSDoc 标签是给程序员看的，不是接口摘要
  if (/^@[a-z]/.test(text)) return null
  return text
}

/**
 * 取一条注册语句**正上方**的注释当摘要。三种形态都要认（本轮实测：`routes/auth.js`
 * 用的是单行 `/** 游客登录 *\/`，`routes/wardrobe.js` 用的是 `// 一、…` 块注释，
 * 第一版只认 `//` 导致 150 个操作全退回 `METHOD /path`）：
 *   `// xxx`            连续行注释（中间的隔线行跳过，继续往上找）
 *   `/** xxx *\/`        单行 JSDoc
 *   `/**` … `*\/`        多行 JSDoc（逐行剥 `*`）
 * 撞到空行接着往上，撞到代码就停。
 */
function commentAbove(file, method, routePath) {
  if (!file) return null
  const lines = sourceOf(file).split('\n')
  const esc = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 顶层路由写在 server.js 里是 `app.get('/health'…`，router 文件里是 `router.post('…'`
  const re = new RegExp(
    `\\b(?:router|app)\\s*\\.\\s*${method.toLowerCase()}\\s*\\(\\s*['"\`]${esc}['"\`]`,
  )
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    const block = []
    for (let j = i - 1; j >= 0 && block.length < 6; j--) {
      const raw = lines[j]
      if (!raw.trim()) continue
      const text = commentText(raw)
      if (text === null) {
        // 空注释行（只有隔线/只有 * ）跳过；真代码行就到此为止
        const t = raw.trim()
        const stillComment =
          t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || /^@/.test(t)
        if (stillComment) continue
        break
      }
      block.unshift(text)
    }
    return block.length ? block.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200) : null
  }
  return null
}

// ── 4. 走栈 ────────────────────────────────────────────────────────────────────────
const AUTH_NAMES = { loginRequired: 'SessionHeader', adminLoginRequired: 'AdminBearer' }
const entries = []

function handlerName(h) {
  return (h && h.name) || ''
}

function collectFromStack(routeStack) {
  const names = routeStack.map((h) => handlerName(h.handle))
  const srcs = routeStack.map((h) => String(h.handle)).join('\n')
  const security = []
  for (const n of names) {
    const s = AUTH_NAMES[n]
    if (s && !security.includes(s)) security.push(s)
  }
  // 路由自己挂的闸（`app.get('/uploads/:f', uploadsLimiter, …)`、`router.post('/login',
  // loginLimiter, …)`）只出现在这一层，不在顶层栈 ⇒ 从 route.stack 上取 profile。
  // 多条闸同挂一条路由时取第一条（本仓没有这种路由，真出现要改的是代码不是这里）。
  const profiles = routeStack.map((h) => h.handle && h.handle.rateLimitProfile).filter(Boolean)
  return { names, srcs, security, profile: profiles[0] || null }
}

/** 一条栈里"整段前缀级"的闸：`router.use('/api', adminApiLimiter)`（routes/admin.js:31）这种
 *  既不在任何 route.stack 上、也不在顶层，只能按它自己的挂载点认，并连**绝对前缀**一起记下
 *  ——不带前缀就会把这道闸错记到 /admin 那三页 HTML 头上。 */
function prefixLimiters(stack, prefix) {
  return stack
    .filter((l) => !l.route && l.handle && l.handle.rateLimitProfile)
    .map((l) => ({ abs: prefix + (mountOf(l) || ''), profile: l.handle.rateLimitProfile }))
}

function walk(stack, prefix, inherited) {
  const limiters = (inherited.limiters || []).concat(prefixLimiters(stack, prefix))
  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route
      const paths = Array.isArray(route.path) ? route.path : [route.path]
      const methods = Object.keys(route.methods).filter((m) => m !== '_all')
      const { names, srcs, security, profile } = collectFromStack(route.stack)
      const paramNames = (layer.keys || []).map((k) => k.name)
      for (const p of paths) {
        for (const m of methods) {
          entries.push({
            method: m.toUpperCase(),
            rawPath: prefix + p,
            paramNames,
            security: security.concat(inherited.security),
            srcs,
            names,
            prefix,
            routeLimiter: profile,
            limiters,
          })
        }
      }
      continue
    }
    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const mount = mountOf(layer)
      const nextPrefix = mount && mount !== '/' ? mount : prefix
      const inheritName = AUTH_NAMES[handlerName(layer.handle)]
      walk(layer.handle.stack, nextPrefix, {
        security: (inheritName ? securityOf(inherited, inheritName) : inherited.security).slice(),
        limiters,
      })
      // 挂载点自己可能就是鉴权闸（`app.use('/api/wardrobe', loginRequired, router)`）
      continue
    }
    if (AUTH_NAMES[layer.name] && layer.handle && !layer.route) {
      inherited.security.push(AUTH_NAMES[layer.name])
    }
  }
}

function securityOf(inherited, name) {
  return inherited.security.includes(name) ? inherited.security : inherited.security.concat(name)
}

// 顶层要按顺序走：`app.use('/api/wardrobe', loginRequired, wardrobeRoutes)` 这种
// 鉴权闸在挂载点上一层，走子 router 之前先把它记进 inherited
const topStack = app._router.stack
const ordered = []
{
  let pendingSecurity = []
  for (const layer of topStack) {
    if (AUTH_NAMES[layer.name] && !layer.route) {
      pendingSecurity = [AUTH_NAMES[layer.name]]
      continue
    }
    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const mount = mountOf(layer) || '/'
      ordered.push({ layer, prefix: mount === '/' ? '' : mount, security: pendingSecurity })
      continue
    }
    if (layer.route) ordered.push({ layer, prefix: '', security: [] })
  }
}
for (const item of ordered) {
  walk(
    item.layer.route ? [item.layer] : item.layer.handle.stack,
    item.prefix,
    { security: item.security },
    true,
  )
}

// 顶层鉴权闸要跟着它后面那个 router（上面 pendingSecurity 已处理），但 walk 里
// 还会遇到 `app.use('/api/x', loginRequired, router)` 形态：Express 把 loginRequired
// 与 router 摊成两个平级 layer，前者的 regexp 与后者同前缀 ⇒ 用前缀表补一次
const prefixAuth = {}
for (let i = 0; i < topStack.length; i++) {
  const l = topStack[i]
  const auth = AUTH_NAMES[l.name]
  if (!auth || l.route) continue
  const mount = mountOf(l)
  if (mount && mount !== '/') prefixAuth[mount] = auth
}
for (const e of entries) {
  const auth = prefixAuth[e.prefix]
  if (auth && !e.security.includes(auth)) e.security.unshift(auth)
}

// ── 5. 限流：本仓工厂在中间件上挂了 rateLimitProfile（见 middleware/rateLimit.js）────
const limiters = []
for (const layer of topStack) {
  const prof = layer.handle && layer.handle.rateLimitProfile
  if (prof && layer.regexp) limiters.push({ regexp: layer.regexp, ...prof })
}
function limiterFor(fullPath) {
  for (const l of limiters) {
    if (l.regexp.test(fullPath)) return l
  }
  return null
}

// ── 6. 字段抽取（启发式，输出里标 x-fields-confidence）──────────────────────────────
function grabFields(src) {
  const body = new Set()
  const query = new Set()
  for (const m of src.matchAll(/req\.body\s*(?:\?\.)?\s*\.\s*([A-Za-z_$][\w$]*)/g)) body.add(m[1])
  for (const m of src.matchAll(/req\.body\s*(?:\?\.)?\s*\[\s*['"]([\w-]+)['"]\s*\]/g))
    body.add(m[1])
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.body/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece
        .split(/[:=]/)[0]
        .trim()
        .replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) body.add(name)
    }
  }
  for (const m of src.matchAll(/req\.query\s*(?:\?\.)?\s*\.\s*([A-Za-z_$][\w$]*)/g)) query.add(m[1])
  for (const m of src.matchAll(/req\.query\s*\[\s*['"]([\w-]+)['"]\s*\]/g)) query.add(m[1])
  // `const { page, size } = req.query` 这种解构取参（本仓 recommend/history 在用）
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.query/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece
        .split(/[:=]/)[0]
        .trim()
        .replace(/^\.\.\./, '')
      // `const { page: p } = req.query` 报的是入参名 page，不是内部别名 p
      if (/^[A-Za-z_$][\w$]*$/.test(name)) query.add(name)
    }
  }
  // 分页参数由 `utils/common.js` 的 parsePagination 统一收（它固定读 page/limit），
  // 所以只要处理函数里出现过这个调用，就给这两条入参——参数名不会写在 handler 源码里，
  // 靠扫 `req.query.x` 是扫不出来的。
  if (/(?:^|[^\w.$])parsePagination\s*\(/.test(src)) {
    query.add('page')
    query.add('limit')
  }
  return { body: [...body].sort(), query: [...query].sort() }
}

function grabStatuses(src, security) {
  const ok = new Set()
  const err = new Set()
  if (/sendCreated\s*\(/.test(src)) ok.add(201)
  if (/sendSuccess\s*\(/.test(src)) ok.add(200)
  if (/\.status\(\s*204\s*\)|sendNoContent\s*\(/.test(src)) ok.add(204)
  if (!ok.size) ok.add(200)
  for (const m of src.matchAll(/sendError\s*\([^)]*,\s*(4\d\d|5\d\d)\s*\)/g)) err.add(Number(m[1]))
  for (const m of src.matchAll(/\.status\(\s*(4\d\d|5\d\d)\s*\)/g)) err.add(Number(m[1]))
  if (security.includes('SessionHeader') || security.includes('AdminBearer')) err.add(401)
  if (!err.size) err.add(400)
  return { ok: [...ok].sort(), err: [...err].sort() }
}

// ── 7. 组装 OpenAPI ────────────────────────────────────────────────────────────────
const openapi = '3.0.3'
const paths = {}
const tagSet = new Set()
let skipped = 0

/** `/api/wardrobe/items` → `wardrobe`；`/admin/api/stats` → `admin-api`；`/admin/login` → `admin`；`/health` → `app` */
function tagFor(p) {
  const seg = p.split('/').filter(Boolean)
  if (!seg.length) return 'app'
  if (seg[0] === 'api') return seg[1] || 'api'
  if (seg[0] === 'admin') return seg[1] === 'api' ? 'admin-api' : 'admin'
  return seg[0]
}

// 同一个路径常写成"POST 带注释、GET 紧跟其后复用同一逻辑"（`routes/accessory.js`
// 的 /gaps、/suggest 就是这样：注释 `/** 配饰柜缺口分析（支持 POST 和 GET） */` 只挂在
// POST 上）。所以先按路径收一遍注释，本方法没有就退到同路径兄弟方法的，仍比硬拼
// `GET /api/accessory/gaps` 好读。退来的那条打 `x-summary-inherited: true` 说明来源。
const commentByPath = new Map()
for (const e of entries) {
  const file = mountToFile[e.prefix] || (e.prefix === '' ? serverPath : null)
  const sub = e.rawPath.slice(e.prefix.length) || '/'
  const own = commentAbove(file, e.method, sub)
  if (own) commentByPath.set(e.rawPath + '#' + e.method, own)
  if (own && !commentByPath.has(e.rawPath + '#*')) commentByPath.set(e.rawPath + '#*', own)
}

for (const e of entries) {
  let p = e.rawPath
  if (p === '*' || p.includes('*')) {
    skipped++
    continue // SPA 兜底 `app.get('*')`：不是数据接口，进表会让工具误以为有个名叫 * 的参数
  }
  p = p.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}').replace(/\/+$/, '') || '/'
  const keys = (e.rawPath.match(/:([A-Za-z_$][\w$]*)/g) || []).map((s) => s.slice(1))
  const own = commentByPath.get(e.rawPath + '#' + e.method)
  const inherited = own ? null : commentByPath.get(e.rawPath + '#*')
  const comment = own || inherited
  const fields = grabFields(e.srcs)
  const statuses = grabStatuses(e.srcs, e.security)
  // 一条路由可能同时被两道闸管（路由自带的 10 次/分 ＋ 顶层 /api 总闸 100 次/15 分）。
  // 这里记**最贴身的那一道**（最紧的通常就是自带的那条），并标 `x-rate-limit-scope`
  // 说明它从哪一层来：route＝注册语句自带，prefix＝子 router 里 `router.use('/api', 闸)`，
  // global＝顶层 `app.use('/api/', apiLimiter)`。别把它读成"这条路由只吃这一道闸"。
  const underPrefix = (e.limiters || []).find(
    (l) => l.abs && (e.rawPath === l.abs || e.rawPath.startsWith(l.abs + '/')),
  )
  const limiter =
    (e.routeLimiter ? { ...e.routeLimiter, scope: 'route' } : null) ||
    (underPrefix ? { ...underPrefix.profile, scope: 'prefix' } : null) ||
    (() => {
      const g = limiterFor(e.rawPath.replace(/:[^/]+/g, 'x'))
      return g ? { windowMs: g.windowMs, limit: g.limit, scope: 'global' } : null
    })()
  const multipart = e.names.includes('multerMiddleware')
  // tag 按**最终对外路径**归族，不按挂载点字符串拼接：`/admin` 下既有后台页面也有
  // `/admin/api/*`，混成一个 tag 就看不出哪些是数据接口（上一版拼出 `admin/`、`root/`
  // 这种带斜杠的半成品名，OpenAPI 工具会原样显示）。
  const tag = tagFor(p)

  tagSet.add(tag)
  paths[p] = paths[p] || {}
  const op = {
    tags: [tag],
    summary: (comment || `${e.method} ${p}`).slice(0, 120),
    description: comment && comment.length > 60 ? comment : undefined,
    operationId: `${e.method.toLowerCase()}_${p.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    security: e.security.length ? e.security.map((s) => ({ [s]: [] })) : undefined,
    parameters: [
      ...keys.map((k) => ({
        name: k,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...fields.query.map((q) => ({
        name: q,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      })),
    ],
    'x-fields-confidence': 'heuristic',
    responses: {},
  }
  if (op.parameters.length === 0) delete op.parameters
  if (inherited)
    op['x-summary-inherited'] = `同路径的 ${e.method === 'GET' ? 'POST' : 'GET'} 分支注释`
  if (['POST', 'PUT', 'PATCH'].includes(e.method)) {
    op.requestBody = {
      required: false,
      content: {
        [multipart ? 'multipart/form-data' : 'application/json']: {
          schema: {
            type: 'object',
            properties: Object.fromEntries(fields.body.map((b) => [b, {}])),
          },
        },
      },
    }
  }
  for (const s of statuses.ok) {
    op.responses[String(s)] = {
      description:
        s === 201
          ? '创建成功（`data` 为新资源；带 `Location` 的条目见 `x-location`）'
          : s === 204
            ? '成功且无表示体'
            : '成功，统一信封 `{success:true,data}`',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
    }
  }
  for (const s of statuses.err) {
    op.responses[String(s)] = {
      description: s === 429 ? '超过限流窗口' : s === 401 ? '缺凭证或凭证无效' : `错误 ${s}`,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    }
  }
  if (limiter) {
    op['x-rate-limit'] = { window_ms: limiter.windowMs, max: limiter.limit, scope: limiter.scope }
    if (!op.responses['429']) {
      op.responses['429'] = {
        description: '超过限流窗口',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      }
    }
  }
  paths[p][e.method.toLowerCase()] = op
}

const spec = {
  openapi,
  info: {
    title: 'Style AI（站3）后端接口',
    version: require(path.join(BACKEND, 'package.json')).version,
    description: [
      '本文件由 `backend/scripts/gen-openapi.js` 从 Express 的路由栈现场生成，⛔ 不要手改。',
      '改任何路由后跑 `npm run openapi` 重新生成；CI 里 `npm run openapi:check` 会拦"改了代码没重生成"。',
      '字段与状态码是源码启发式（带 `x-fields-confidence:heuristic`），路径与方法、鉴权与限流闸是运行时事实。',
      '鉴权两种：`X-Session-Id` 头（顾客/游客，`middleware/auth.js` 的 `loginRequired`）与',
      '`Authorization: Bearer <token>`（后台，`adminLoginRequired`，Token 由 `/api/auth/admin/login` 发）。',
    ].join('\n'),
    license: undefined,
  },
  servers: [
    {
      url: 'http://127.0.0.1:5000',
      description: '本机（Docker style-ai-local 或 node server.js）',
    },
    { url: 'https://style.sparklove.cn', description: '线上（Caddy 反代，⚠️ 需他确认域名）' },
  ],
  tags: [...tagSet].sort().map((t) => ({ name: t })),
  paths,
  components: {
    securitySchemes: {
      SessionHeader: { type: 'apiKey', in: 'header', name: 'X-Session-Id' },
      AdminBearer: { type: 'http', scheme: 'bearer' },
    },
    schemas: {
      Success: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { type: 'object', description: '各接口自己的载荷' },
          message: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
          retry_after: { type: 'integer', description: '仅 429：窗口剩余秒数' },
        },
      },
    },
  },
}

const text = JSON.stringify(spec, null, 2) + '\n'

// 给测试用：`test/openapiSpec.test.js` require 本文件拿 spec/text 做结构断言。
// ⚠️ 三件事必须分开：①被测试 require 时**只交数据**，绝不写盘、绝不 `process.exit()`
//    （那会把整个 `node --test` 进程带走，其余用例一条都跑不到）；②`--check` 只比对；
//    ③只有直接执行且不带 `--check` 才写 `docs/api/openapi.json`。
module.exports = { spec, text, entries, outFile: OUT_FILE }

if (require.main !== module) {
  memDb.close()
} else if (CHECK) {
  const cur = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf-8') : ''
  if (cur === text) {
    console.log(`OPENAPI OK  ${Object.keys(paths).length} 条路径（跳过 ${skipped} 条非数据路由）`)
    process.exit(0)
  }
  console.error(
    'OPENAPI DRIFT：docs/api/openapi.json 与代码不一致。' +
      `（现文件 ${Buffer.byteLength(cur)} B，重新生成 ${Buffer.byteLength(text)} B）\n` +
      '修法：在 backend/ 里跑 `npm run openapi` 再把产物一起提交。',
  )
  process.exit(1)
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, text, 'utf-8')
  console.log(
    `WROTE ${path.relative(path.join(BACKEND, '..'), OUT_FILE)}  ` +
      `paths=${Object.keys(paths).length} ops=${entries.length - skipped} tags=${spec.tags.length} ` +
      `bytes=${Buffer.byteLength(text)}`,
  )
  memDb.close()
  process.exit(0)
}
