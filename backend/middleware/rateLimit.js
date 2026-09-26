/**
 * 简易内存速率限制中间件（无外部依赖）
 *
 * 用法：
 *   const { rateLimit } = require('../middleware/rateLimit')
 *   router.post('/login', rateLimit({ windowMs: 60000, max: 10 }), handler)
 *
 * 可选参数：
 *   windowMs  — 时间窗口（毫秒），默认 60 秒
 *   max       — 窗口内最大请求数，默认 20
 *   keyFn     — 自定义 key 函数，默认用 IP
 *   message   — 超限时的错误消息
 */
function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60 * 1000
  const max = options.max || 20
  const keyFn = options.keyFn || ((req) => req.ip || req.socket?.remoteAddress || 'unknown')
  const message = options.message || '请求过于频繁，请稍后再试'

  // Map<键, { count: 计数, resetTime: 重置时间 }>
  const buckets = new Map()

  // 定期清理过期条目（每 5 分钟）
  const cleanupInterval = setInterval(
    () => {
      const now = Date.now()
      for (const [key, bucket] of buckets) {
        if (now > bucket.resetTime) {
          buckets.delete(key)
        }
      }
    },
    5 * 60 * 1000,
  )
  // 允许进程在 interval 运行时也能正常退出
  cleanupInterval.unref()

  return (req, res, next) => {
    const key = keyFn(req)
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || now > bucket.resetTime) {
      bucket = { count: 0, resetTime: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count++

    // 设置 RateLimit 响应头
    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetTime / 1000))

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetTime - now) / 1000)
      res.setHeader('Retry-After', retryAfter)
      return res.status(429).json({
        success: false,
        error: message,
        retry_after: retryAfter,
      })
    }

    next()
  }
}

module.exports = { rateLimit }
