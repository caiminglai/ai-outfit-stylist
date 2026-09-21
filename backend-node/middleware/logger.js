/**
 * 请求日志中间件 - 同时输出到控制台和日志文件(按日期轮转)
 */

const { log } = require('../utils/logger')

function requestLogger(req, res, next) {
  const start = Date.now()
  const { method, originalUrl, ip } = req

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const tag = status >= 400 ? 'WARN' : 'INFO'
    log(`[${tag}] ${method} ${originalUrl} ${status} ${duration}ms (${ip})`)
  })

  next()
}

module.exports = { requestLogger }
