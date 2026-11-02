/**
 * Style AI 后端入口(Express)
 *
 * 从 Python Flask 迁移,保持 API 路由和响应格式一致
 */

require('dotenv').config()

const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const compression = require('compression')
const helmet = require('helmet')

// MIME类型映射(支持3D模型静态文件服务)
const MIME_TYPES = {
  '.pmx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.dds': 'image/vnd-ms.dds',
  '.tga': 'image/x-tga',
  '.bmp': 'image/bmp',
  '.sph': 'application/octet-stream',
  '.spa': 'application/octet-stream',
  '.x': 'application/octet-stream',
  '.obj': 'application/octet-stream',
}
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// 初始化数据库(模块加载时自动建表+种子数据+管理员)
const db = require('./db/init')

// 日志工具(同时写控制台 + 文件,按日期轮转,保留 7 天)
const { log: logMsg, error: logErr } = require('./utils/logger')

// 扫描时不入库的目录判定(zip备份/残缺模型/_bak_*),文件下发时同样拦掉
const { isSkippedPath, isDisabledPmxPath } = require('./utils/model-utils')

// 中间件
const { requestLogger } = require('./middleware/logger')
const { loginRequired, getSessionId, verifyAdminToken } = require('./middleware/auth')
// 限流走本仓统一工厂（内核仍是 express-rate-limit）。11-02 之前这里直接
// `require('express-rate-limit')`，于是同一台机器上有两套 429 实现：路由里那 23 道闸
// 回 `{success:false,error:{...},retry_after}`，总闸和 /uploads 闸回不带 `retry_after` 的
// 形状。合并成一套之后，前端只用信一个信封；`scripts/gen-openapi.js` 也才认得出
// "这道闸是限流"（库自己造出来的中间件在路由栈里是匿名函数，只有工厂会在上面挂
// `rateLimitProfile`）。行为差异见 `docs/形象设计模型-现状与路线.md` §61。
const { rateLimit } = require('./middleware/rateLimit')

// 路由
const authRoutes = require('./routes/auth')
const photosRoutes = require('./routes/photos')
const analysisRoutes = require('./routes/analysis')
const recommendRoutes = require('./routes/recommend')
const tryonRoutes = require('./routes/tryon')
const historyRoutes = require('./routes/history')
const modelsRoutes = require('./routes/models')
const adminRoutes = require('./routes/admin')
const customerRoutes = require('./routes/customer')
const inventoryRoutes = require('./routes/inventory')
const wardrobeRoutes = require('./routes/wardrobe')
const rulesRoutes = require('./routes/rules')
const cosmeticRoutes = require('./routes/cosmetic')
const accessoryRoutes = require('./routes/accessory')
const crossCabinetRoutes = require('./routes/crossCabinet')
const clothingRoutes = require('./routes/clothing')
const weatherRoutes = require('./routes/weather')
const horoscopeRoutes = require('./routes/horoscope')
const paymentRoutes = require('./routes/payment')
const creatorRoutes = require('./routes/creator')

const app = express()
// 只信任 Caddy 这一跳：不设的话 express-rate-limit 按 req.ip 计数会把全网访客算成
// Caddy 一个地址共用 100 次/15 分钟，且日志里一直刷 ERR_ERL_UNEXPECTED_X_FORWARDED_FOR。
// ⚠️ 反过来这也意味着**限流的准确性押在 Caddy 会清洗入站 X-Forwarded-For 这一条外部事实上**：
// 10-12 在服务器上真打两档伪造（单个 9.9.9.9、以及 1.1.1.1, 2.2.2.2），容器日志两次都记真实
// 对端 47.97.155.1，且 5000/8080 只绑 127.0.0.1 直连打不到 ⇒ 伪造不过去。
// 换反代（或前面再加一层 CDN/负载均衡）必须重测这条，否则所有 limiter 都能被随意换 IP 绕过。
app.set('trust proxy', 1)
const PORT = parseInt(process.env.PORT || '5000', 10)
// 默认只听回环(裸机开发时不暴露到局域网);容器内由 Dockerfile 的 ENV HOST=0.0.0.0 打开,
// 否则端口映射与 Caddy 反代都够不着。
const HOST = process.env.HOST || '127.0.0.1'

// ===== 中间件 =====
app.use(compression())
app.use(
  express.json({
    limit: '10mb',
    // 微信支付回调要用原始字节验签：JSON.parse 之后再 stringify 无法逐字节还原。
    // 只在回调路径上留这份副本，免得每次 10MB 上传都多占一份内存。
    verify: (req, _res, buf) => {
      if (req.originalUrl.startsWith('/api/payment/notify')) req.rawBody = buf.toString('utf8')
    },
  }),
)
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// HTTP 安全头(helmet)
// 关闭 CSP,因为 3D 画廊(model-gallery.html)和前端 dist 都用了内联脚本/样式,
// 强制 CSP 会导致页面白屏.其他安全头(X-Content-Type-Options、X-Frame-Options 等)正常启用.
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
)

// 后台自带的请求都挂在公开前缀 /api 下（10-13 现量 admin 静态 JS：
// utils/admin-utils.js:9-11 的 RULES_API='/api/rules'、INV_API='/api/inventory'、
// MODELS_API='/api/models'；pages/admin-review.js:8-9,273 的 /api/creator、
// /api/payment、/api/auth）。后台一次开页就是十几条，和顾客共用同一个
// 100 次/15 分钟的桶 ⇒ 管理员多点几下把整台机器的额度吃掉，顾客侧表现为
// "请求过于频繁"。带有效管理员令牌的请求不占顾客的额度；
// 只在请求真带 Bearer 时才验签（一次 HMAC + 一次 SELECT），空手请求零开销。
function isAdminBearerRequest(req) {
  const authHeader = req.headers['authorization'] || ''
  if (!authHeader.startsWith('Bearer ')) return false
  return verifyAdminToken(authHeader.slice(7))
}

// 请求限流:公开 API 100 次/15 分钟,超出返回 429
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 每个 IP 最多 100 次请求
  standardHeaders: true, // 返回 RateLimit-* 头
  legacyHeaders: false, // 禁用 X-RateLimit-* 头
  // 展厅加载一个角色要拉 .pmx + 多张贴图，走的是同一个 /api 前缀；
  // 不豁免的话浏览几个模型就吃掉 100 次额度，前端表现为"无法加载人物模型"白屏。
  // 回调由微信服务器推送、查单是前端几秒一次的轮询，都不该被总闸掐掉（429 会让微信
  // 按失败重推）；这两条在 payment 路由内有各自的限流或本就靠验签把关。
  // /api/health 同理：它是给监控用的探针，本身不查库、无副作用。下面那道闸前面那句
  // "健康检查和静态文件不限流"的注释一直与代码不符：这道闸挂在 app.use('/api/') 上、
  // 健康路由在它后面注册，所以 /api/health 其实一直在吃额度
  // （10-13 现量：同一 IP 把桶打空后它回 429）。
  // 监控和顾客共享一个桶 ⇒ 顾客侧一繁忙，探针先被掐，看板上显示的就是"服务挂了"。
  // `/health`（不带 /api）本来就不在这道闸范围内，两条入口现在口径一致。
  // 判据读 originalUrl 而不是 req.path：这道闸挂在 `app.use('/api/')` 上，Express 会把
  // 挂载前缀从 req.url 里切掉 ⇒ 中间件里 req.path 只剩 '/health'（10-13 现量：写成
  // req.path === '/api/health' 时豁免整个不生效，第 101 条照样 429）。🔴 第十四阶段追加 `/api/models/list` 进同一条豁免（取证与代价账见 docs/依据/22-…md §十二.9a 与路线 §五十三.2）：展厅待机态一开屏就 fetch 它＝"打开首页就送一次额度"，国内移动网络与门店 WiFi 普遍共用出口 IP ⇒ 桶是十几个人共享的，撞空后 429 被 showApiError 变成整屏"无法加载人物模型"；它虽有 ETag＋no-cache（routes/models.js:145-146）但闸在路由前面 ⇒ 304 照样吃额度，条件请求省字节省不到这一格；豁免代价＝零（一条 SELECT COUNT 加一遍已启用列表，无用户输入、无副作用）。
  skip: (req) =>
    ['/api/health', '/api/models/list'].includes(req.originalUrl.split('?')[0]) ||
    req.originalUrl.startsWith('/api/models/file/') ||
    req.originalUrl.startsWith('/api/payment/notify') ||
    req.originalUrl.startsWith('/api/payment/order/') ||
    isAdminBearerRequest(req),
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: '请求过于频繁,请 15 分钟后再试' },
  },
})

// 请求日志必须挂在限流闸**前面**：`rateLimit` 超限时是直接 `res.status(429).json(...)` 返回、
// 不再往下走，谁排在它后面谁就看不见 429。原先 logger 在 :127 那道闸之后，结果是
// "接口被总闸掐了"这件事在日志里一行都不留——现场只看到"登录失败"，谁都查不到是真因。
app.use(requestLogger)

// 健康检查和静态文件不限流,只对 /api/* 接口限流
app.use('/api/', apiLimiter)

// CORS 配置
const corsOriginsStr = process.env.CORS_ORIGINS || ''
let corsOrigins
if (corsOriginsStr) {
  corsOrigins = corsOriginsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
} else {
  // 开发环境默认允许本地地址
  corsOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
  ]
}

app.use(
  cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
  }),
)

// ===== 健康检查 =====
// 两个入口同一份逻辑：/api/health 给前端和管理后台用，/health 给容器与外部监控用。
// 以前只有 /api/health，监控要是少写 /api 打 /health，会落到下面的 SPA 兜底——
// 拿到 200 + index.html(text/html)，后端真炸了它也报"健康"，等于装了个假探针。
function healthHandler(req, res) {
  res.json({
    success: true,
    data: { status: '正常', service: 'Style AI 形象定制后端' },
  })
}
app.get('/api/health', healthHandler)
app.get('/health', healthHandler)

// ===== 静态文件服务(管理后台 CSS/JS)=====
app.use('/static', express.static(path.join(__dirname, 'static')))

// ===== 上传文件静态服务(带路径遍历防护)=====
// 本轮不加属主闸门，只上专用限流 + 访问留痕。判据(全仓 grep 的现量结果)：
// /uploads/<uuid>.<ext> 的合法消费方全是"浏览器自发请求"，自发请求带不了凭据头——
//   1) 本人图：TryonCard.tsx 的 <img src={result_url}>、后台 admin-review.js 的凭证图/封面
//      <img>，浏览器发这些请求时不会有 X-Session-Id / Authorization，按 photos.js 的
//      会话口径拦会把用户自己的图判成 401/403；
//   2) 跨用户公开图：creator 广场(app/public/creator.html)把已审核作品的 cover_url 当
//      CSS background 发给所有访客——这类文件本来就该匿名可读，属主校验会整页裂开。
// 真要收紧得让凭据能进 <img>：会话走短时效签名查询串或 cookie，那是 app/src 与鉴权链
// 的联动改造，不在本轮文件范围。uuid 文件名目前不可枚举，先按"拦洪水 + 留证据"做：
// 下面这道专用闸挡住伪造/爆破文件名的流量，留痕把"谁在取哪个文件、带没带会话"写进日志，
// 下一轮据这份日志决定闸门口径。
const uploadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 600, // 一个页面可能连拉十几张图，按正常使用峰值放余量
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: '文件请求过于频繁,请 15 分钟后再试' },
  },
})
app.get('/uploads/:filename', uploadsLimiter, (req, res) => {
  const safeName = path.basename(req.params.filename)
  if (safeName !== req.params.filename) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: '非法文件路径' } })
  }
  const filePath = path.join(__dirname, 'uploads', safeName)
  if (fs.existsSync(filePath)) {
    // 留痕（给下一轮属主闸门攒证据）：会话 id 只记前 8 位，日志里不落完整凭据
    const sid = (getSessionId(req) || '').slice(0, 8) || '-'
    logMsg(`[上传文件] GET /uploads/${safeName} ip=${req.ip} sid=${sid}`)
    res.sendFile(filePath)
  } else {
    // 不存在的文件名同样留痕：枚举探测全靠这行日志现形
    logErr(`[上传文件] MISS GET /uploads/${safeName} ip=${req.ip}`)
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } })
  }
})

// ===== 3D 展厅页面 =====
app.get(['/gallery', '/gallery/'], (req, res) => {
  const galleryPath = path.join(__dirname, '..', 'app', 'public', 'model-gallery.html')
  if (fs.existsSync(galleryPath)) {
    res.sendFile(galleryPath)
  } else {
    res.status(404).send('<h1>model-gallery.html 未找到</h1>')
  }
})

// ===== 3D 模型文件静态服务(带路径遍历防护 + 预压缩支持)=====
const modelsDir = path.join(__dirname, '..', 'models')
if (fs.existsSync(modelsDir)) {
  app.use(
    '/models',
    (req, res, next) => {
      // ★ 尾部分隔符必须先砍：禁用判据只看 .pmx 结尾，`/models/<目录>/<文件>.pmx%2F`（编码尾斜杠）会让
      // isDisabledPmxPath 回 false，而 send 把 %2F 解回 `/` 后 path.join 收掉斜杠照样发出整份文件。
      // 10-13 现量（临时目录造禁用模型）：修复前 `%2F`=200/4096、`.pmx.gz%2F`=200/2048，修复后全部 404。
      // 裸尾斜杠本来就被 express.static 自己挡成 404，但同一个判据两边都要闭合，见 routes/models.js 同款。
      const decoded = decodeURIComponent(req.path).replace(/[/\\]+$/, '')
      if (decoded.includes('..') || /[\\]/.test(req.path)) {
        return res
          .status(400)
          .json({ success: false, error: { code: 'BAD_REQUEST', message: '非法路径' } })
      }
      // 扫描时不入库的目录一律不下发:express.static 会把 models/ 下任何文件直接送出去;禁用模型也堵这条口(与 /api/models/file/* 共用同一份禁用集,只堵一条等于没堵)
      if (isSkippedPath(decoded) || isDisabledPmxPath(decoded)) {
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } })
      }
      next()
    },
    (req, res, next) => {
      const acceptEncoding = req.headers['accept-encoding'] || ''
      if (!acceptEncoding.includes('gzip')) return next()
      const filePath = path.join(modelsDir, decodeURIComponent(req.path))
      const gzPath = filePath + '.gz'
      if (!fs.existsSync(gzPath)) return next()
      let srcStat = null
      let gzStat = null
      try {
        srcStat = fs.statSync(filePath)
        gzStat = fs.statSync(gzPath)
      } catch {
        return next()
      }
      // 只在下发"不比源文件旧的 .gz"。纹理/模型改了但预压缩没重跑时，.gz 是旧字节，
      // 而这条响应带 max-age=7d ⇒ 浏览器会抱着旧内容整周，且没有任何入口能刷新它。
      // 判旧就 fall through 走下面的 express.static，它按源文件出 ETag/Last-Modified。
      if (gzStat.mtimeMs < srcStat.mtimeMs) return next()
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Content-Type', getContentType(filePath))
      res.setHeader('Access-Control-Allow-Origin', '*') // 与下面 express.static 的 setHeaders 同口径
      // 校验值一律按**源文件**给：客户端要判的是"我请求的那份内容变了没"，
      // 若按 .gz 的 mtime，重新压缩一次就会让所有缓存键集体失效（或反过来长期不失效）。
      res.setHeader('Last-Modified', srcStat.mtime.toUTCString())
      res.setHeader('Vary', 'Accept-Encoding') // 同一 URL 现在会按编码给两种字节
      res.setHeader('Cache-Control', 'public, max-age=604800')
      // cacheControl/lastModified 交给 send 关掉：它会按 .gz 自己再写一遍这两个头
      return res.sendFile(gzPath, { cacheControl: false, lastModified: false })
    },
    express.static(modelsDir, {
      maxAge: '7d',
      setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
      },
    }),
  )
}

// ===== 挂载 API 路由 =====
app.use('/api/auth', authRoutes)
app.use('/api/photos', photosRoutes)
app.use('/api/analysis', analysisRoutes)
app.use('/api/recommend', recommendRoutes)
app.use('/api/tryon', tryonRoutes)
app.use('/api/history', historyRoutes)
app.use('/api/models', modelsRoutes)
app.use('/api/customer', customerRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/wardrobe', loginRequired, wardrobeRoutes)
app.use('/api/rules', rulesRoutes)
app.use('/api/cosmetic', loginRequired, cosmeticRoutes)
app.use('/api/accessory', loginRequired, accessoryRoutes)
app.use('/api/cross-cabinet', loginRequired, crossCabinetRoutes)
app.use('/api/clothing', loginRequired, clothingRoutes)
app.use('/api/weather', weatherRoutes)
app.use('/api/horoscope', horoscopeRoutes)
app.use('/api/payment', paymentRoutes)
app.use('/api/creator', creatorRoutes)
// 管理后台 API
app.use('/admin', adminRoutes)

// ===== /api 命名空间兜底：没匹配上的接口一律给统一 JSON 404 =====
// 挂在所有 /api/* 路由之后，只吃"前面没人接"的请求。不加这段时 Express 的默认 404 页
// (text/html) 会直接顶上来，调用方按 {success,error:{code,message}} 读就永远读不到话，
// 前端只能瞎猜状态码——这条跟下面全局错误处理器是同一套口径。
// 必须排在 SPA 兜底前面，否则 /api 的错路径会被 index.html 伪装成 200。
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `接口不存在: ${req.method} /api${req.path === '/' ? '' : req.path}`,
    },
  })
})

// /admin 命名空间同理：后台页面的 fetchJSON/apiCall 见到 text/html 会直接抛"服务器返回了非JSON响应"，
// 打错一个后台接口就整块面板空白、只有一句看不懂的话。给它同一份 JSON 404。
// 排在 adminRoutes 之后，只吃前面没人接的请求，不影响 /admin 与 /admin/login 两个页面。
app.use('/admin', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `后台接口不存在: ${req.method} /admin${req.path === '/' ? '' : req.path}`,
    },
  })
})

// ===== 前端静态文件服务(esbuild 构建产物)=====
const frontendDist = path.join(__dirname, '..', 'app', 'dist')
if (fs.existsSync(frontendDist)) {
  // serve 静态资源。🔴 第十四阶段：/assets 是 vite 的内容哈希产物（如 CabinetManager-CEKUQ9l7.js），文件名即版本 ⇒ 钉一年 immutable。10-22 现量：改前它回 `Cache-Control: public, max-age=0`，弱 ETag 让回访走 304（0 字节）而不是重下 222,777 B，省的是每个资产一次往返——首页入口 5 个资产＝5 次，手机 4G 上一次往返就够看见差别。/three 不是哈希名（vite 把 app/public/three 原样拷过来），只给 1 小时：升级 three 时不会把旧字节钉一年。取证与账见 docs/依据/22-…md §十二.9b。
  const assetCache = { maxAge: '1y', immutable: true }
  app.use('/assets', express.static(path.join(frontendDist, 'assets'), assetCache))
  // 展厅 importmap 里的 /three/** 由 vite 从 app/public/three 拷进 dist/three，必须显式挂载；漏挂载时它会落到下面的 SPA 兜底，被当成 index.html(text/html) 返回，浏览器直接拒绝执行模块链。
  app.use('/three', express.static(path.join(frontendDist, 'three'), { maxAge: '1h' }))
  // 域名根目录的裸文件（favicon、微信业务域名校验文件 WW_verify_xxx.txt 等）必须先于 SPA 兜底命中，
  // 否则会被 index.html 顶替成 200 + text/html，平台侧静默校验失败。index:false 让 / 仍走下面的兜底。
  app.use(express.static(frontendDist, { index: false }))
  // SPA 回退:所有非 API 路由返回 index.html
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/uploads/') ||
      req.path.startsWith('/static/') ||
      req.path.startsWith('/three/') ||
      req.path.startsWith('/models/')
    ) {
      return next()
    }
    // 带扩展名却没被上面的静态命中 = 文件确实不存在，给真 404，不能伪装成首页
    if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) return next()
    const indexPath = path.join(frontendDist, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })
  logMsg('[前端] 静态文件服务已启用:', frontendDist)
} else {
  logMsg('[前端] dist 目录不存在,请先运行构建: node build-esbuild.cjs')
}

// ===== 全局错误处理 =====
const isDev = process.env.NODE_ENV !== 'production'
// 分档原则：能把"调用方的请求写错了"和"后端自己炸了"分开说。
// 改之前不管什么错都一律 500 + INTERNAL_ERROR，结果这三类全被当成服务器故障：
//   1) URIError —— URL 里畸形百分号编码(%zz、%E0%A4%A)，Express 解参数时就抛，路由里的 try 根本接不到；
//   2) entity.parse.failed —— 请求体不是合法 JSON，body-parser 在任何路由之前就抛；
//   3) entity.too.large —— 请求体超过上面 express.json 的 10mb 上限，body-parser 自带 413 也被抹成 500。
// 其余带 4xx status 的错(res.sendFile 的 403/404 等)也照原档位放行，不再一律升成 500。
app.use((err, req, res, _next) => {
  logErr('[错误]', err.message)
  if (isDev) logErr('[错误堆栈]', err.stack)

  const rawStatus = Number(err.status || err.statusCode || 0)
  let status = 500
  let code = 'INTERNAL_ERROR'
  let message = isDev ? err.message : '服务内部错误'

  if (err instanceof URIError) {
    status = 400
    code = 'BAD_REQUEST'
    message = 'URL 里有非法的百分号编码'
  } else if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    status = 400
    code = 'BAD_REQUEST'
    message = '请求体不是合法的 JSON'
  } else if (err.type === 'entity.too.large') {
    status = 413
    code = 'PAYLOAD_TOO_LARGE'
    message = '请求体超过 10MB 上限'
  } else if (typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    // multer 的体积/字段超限只带 code，不带 status ⇒ 原来一律落到 500 INTERNAL_ERROR，
    // 顾客传一张 12MB 的照片看到的是"服务内部错误"，其实该说"这张太大了"。
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    code = err.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST'
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? '图片超过 10MB 上限'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? '上传的表单字段名不对，或该字段带的文件数超过上限'
          : '上传的文件数量或字段不符合要求'
  } else if (err.uploadRejected === true) {
    // multer 的 fileFilter 拒的是"这类文件不收"，"仅支持 jpg, jpeg, png, webp"这句是给用户
    // 照着改的 ⇒ 生产也得给原话。放到下面那条 4xx 分支会被 isDev 拦掉、糊成"请求参数有误"。
    status = 400
    code = 'BAD_REQUEST'
    message = err.message
  } else if (rawStatus >= 400 && rawStatus < 500) {
    status = rawStatus
    code = rawStatus === 404 ? 'NOT_FOUND' : rawStatus === 403 ? 'FORBIDDEN' : 'BAD_REQUEST'
    message = isDev ? err.message : rawStatus === 404 ? '请求的资源不存在' : '请求参数有误'
  }

  const body = { success: false, error: { code, message } }
  // 堆栈只在开发期、且只在真是后端故障时给——4xx 的堆栈是 body-parser 内部的，看了也帮不上
  if (isDev && status >= 500) body.error.stack = err.stack?.split('\n').slice(0, 5)
  res.status(status).json(body)
})

// ===== 进程级错误处理 =====
let fatalErrorCount = 0
process.on('uncaughtException', (err) => {
  logErr('[致命错误] uncaughtException:', err.message)
  logErr(err.stack)
  fatalErrorCount++
  // 连续异常过多,强制退出让进程管理器重启
  if (fatalErrorCount > 3) {
    logErr('[致命错误] 连续异常超过3次,强制退出')
    process.exit(1)
  }
  // 尝试优雅关闭(给现有请求 5 秒完成)
  logMsg('[致命错误] 将在 5 秒后退出,等待进程管理器重启...')
  setTimeout(() => {
    server.close(() => process.exit(1))
  }, 5000)
})
process.on('unhandledRejection', (reason, promise) => {
  logErr('[未处理Promise] unhandledRejection:', reason?.stack || reason)
  // 记录后退出,让进程管理器重启
  process.exit(1)
})

// ===== 启动服务器 =====
const server = app.listen(PORT, HOST, () => {
  logMsg(`\n========================================`)
  logMsg(`  Style AI 后端 (Node.js)`)
  logMsg(`  运行地址: http://${HOST}:${PORT}`)
  logMsg(`  健康检查: http://${HOST}:${PORT}/api/health`)
  logMsg(`========================================\n`)
})

// 服务器错误处理
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logErr('[错误] 端口 ' + PORT + ' 已被占用,请先终止占用进程')
  } else {
    logErr('[服务器错误]', err.message)
  }
})

// ===== S6 滚动清理（10-19 蓝图短期项，10-23 落）=====
// 免费场推荐样本保留 90 天，付费报告行永久豁免（判据只有 services/paidReport.js 的 IS_REPORT 一把尺子）。
// 启动 10 秒后清一次、之后每 6 小时一次；两个计时器都 .unref()，⛔ 不许拖住优雅关闭或"只 require 不 listen"的测试。
// 清理失败不能带崩服务：吞掉并 warn 一行，下一轮定时再试。
const LOG_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000
function runLogPrune(tag) {
  try {
    const { pruneOldLogs } = require('./services/paidReport')
    const n = pruneOldLogs(90)
    if (n > 0) logMsg(`[清理] ${tag}：删除超过 90 天的推荐样本 ${n} 行（报告行豁免）`)
  } catch (err) {
    console.warn(`[清理] 推荐样本滚动清理失败（${tag}）:`, err.message)
  }
}
setTimeout(() => runLogPrune('启动首清'), 10000).unref()
setInterval(() => runLogPrune('定时'), LOG_PRUNE_EVERY_MS).unref()

// ===== 优雅关闭(SIGINT/SIGTERM)=====
// 收到 Ctrl+C 或 kill 信号时:停止接受新连接 → 等待已有请求完成 → WAL checkpoint(TRUNCATE) → 退出
let isShuttingDown = false
function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  logMsg(`\n[关闭] 收到 ${signal} 信号,开始优雅关闭...`)

  // 1. 停止接受新连接
  server.close((err) => {
    if (err) {
      logErr('[关闭] server.close 出错:', err.message)
    } else {
      logMsg('[关闭] HTTP 服务已停止接受新连接')
    }

    // 2. WAL checkpoint(TRUNCATE) 把 -wal 文件截断到 0
    try {
      db.stopWalCheckpointTimer()
    } catch (e) {
      logErr('[关闭] WAL checkpoint 失败:', e.message)
    }

    // 3. 关闭数据库连接
    try {
      db.close()
      logMsg('[关闭] 数据库连接已关闭')
    } catch (e) {
      logErr('[关闭] 数据库关闭失败:', e.message)
    }

    logMsg('[关闭] 完成,进程退出')
    process.exit(0)
  })

  // 兜底:5 秒后强制退出(防止 server.close 卡死)
  setTimeout(() => {
    logErr('[关闭] 5 秒超时,强制退出')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

module.exports = app
// 导出 listen 实例：测试用 PORT=0 起临时端口后要能把它关掉，否则 open handle 挂着不退
module.exports.server = server
