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
const rateLimit = require('express-rate-limit')

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
const { isSkippedPath } = require('./utils/model-utils')

// 中间件
const { requestLogger } = require('./middleware/logger')
const { loginRequired } = require('./middleware/auth')

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
  skip: (req) =>
    req.originalUrl.startsWith('/api/models/file/') ||
    req.originalUrl.startsWith('/api/payment/notify') ||
    req.originalUrl.startsWith('/api/payment/order/'),
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: '请求过于频繁,请 15 分钟后再试' },
  },
})

// 健康检查和静态文件不限流,只对 /api/* 接口限流
app.use('/api/', apiLimiter)

app.use(requestLogger)

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
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: { status: '正常', service: 'Style AI 形象定制后端' },
  })
})

// ===== 静态文件服务(管理后台 CSS/JS)=====
app.use('/static', express.static(path.join(__dirname, 'static')))

// ===== 上传文件静态服务(带路径遍历防护)=====
app.get('/uploads/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename)
  if (safeName !== req.params.filename) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: '非法文件路径' } })
  }
  const filePath = path.join(__dirname, 'uploads', safeName)
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath)
  } else {
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
      const decoded = decodeURIComponent(req.path)
      if (decoded.includes('..') || /[\\]/.test(req.path)) {
        return res
          .status(400)
          .json({ success: false, error: { code: 'BAD_REQUEST', message: '非法路径' } })
      }
      // 扫描时不入库的目录一律不下发:express.static 会把 models/ 下任何文件直接送出去
      if (isSkippedPath(decoded)) {
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } })
      }
      next()
    },
    (req, res, next) => {
      const acceptEncoding = req.headers['accept-encoding'] || ''
      if (acceptEncoding.includes('gzip')) {
        const filePath = path.join(modelsDir, decodeURIComponent(req.path))
        const gzPath = filePath + '.gz'
        if (fs.existsSync(gzPath)) {
          res.setHeader('Content-Encoding', 'gzip')
          res.setHeader('Content-Type', getContentType(filePath))
          res.setHeader('Cache-Control', 'public, max-age=604800')
          return res.sendFile(gzPath)
        }
      }
      next()
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

// ===== 前端静态文件服务(esbuild 构建产物)=====
const frontendDist = path.join(__dirname, '..', 'app', 'dist')
if (fs.existsSync(frontendDist)) {
  // serve 静态资源
  app.use('/assets', express.static(path.join(frontendDist, 'assets')))
  // 展厅 importmap 里的 /three/** 由 vite 从 app/public/three 拷进 dist/three，必须显式挂载；
  // 漏挂载时它会落到下面的 SPA 兜底，被当成 index.html(text/html) 返回，浏览器直接拒绝执行模块链。
  app.use('/three', express.static(path.join(frontendDist, 'three')))
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
app.use((err, req, res, _next) => {
  logErr('[错误]', err.message)
  if (isDev) logErr('[错误堆栈]', err.stack)
  const body = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isDev ? err.message : '服务内部错误',
    },
  }
  // 开发模式额外返回堆栈,方便调试
  if (isDev) body.error.stack = err.stack?.split('\n').slice(0, 5)
  res.status(500).json(body)
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
