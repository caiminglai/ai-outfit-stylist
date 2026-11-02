/**
 * 速率限制中间件（内核 = express-rate-limit，外层保留本仓历史签名）
 *
 * 用法（与改造前逐字相同，所以 12 个路由文件里的 23 处调用点一行都不用动）：
 *   const { rateLimit } = require('../middleware/rateLimit')
 *   router.post('/login', rateLimit({ windowMs: 60000, max: 10 }), handler)
 *
 * 接受的参数：
 *   windowMs  — 时间窗口（毫秒），默认 60 秒
 *   max       — 窗口内最大请求数，默认 20（express-rate-limit 里改名叫 limit，max 仍兼容）
 *   keyFn     — 自定义 key 函数，默认用 IP
 *   message   — 超限时的错误消息，可以是字符串，也可以是 sendError 那种
 *               { error: { code, message } } 结构
 *   standardHeaders / legacyHeaders / skip — 原样透传给 express-rate-limit
 *
 * 11-02 换成 express-rate-limit 内核，换掉的是"谁来实现窗口和桶"，不是"对外长什么样"：
 *   留住的对外契约（前端 app/src/api.ts、后台 static/*.js、以及 test/rateLimitWindow.test.js
 *   都读这些）：429 + {success:false,error:{code,message},retry_after} + X-RateLimit-Limit/
 *   Remaining/Reset 三个头 + Retry-After。
 *   换掉的：手写 Map 桶 + 5 分钟 setInterval 清扫 → 库的 MemoryStore（自带到期清理与
 *   resetKey/getKey）；手写"超限判定" → 库的 totalHits > limit，并顺手拿到 IETF
 *   RateLimit-* 标准头这个选项（standardHeaders: 'draft-6/7/8'），以后要切标准头只改一个参数。
 *
 * 两个已知差异，都在这里处理掉了：
 *   1) 库默认 keyGenerator 会把 IPv6 按 /56 网段合并计数，本仓历来是"一地址一桶"。
 *      ⇒ 这里传自己的 keyGenerator，走 keyFn 原值，计数口径与改造前一致。
 *   2) 库的默认 handler 用 res.send(message) 回一句纯文本，形状不是本仓的统一信封。
 *      ⇒ 这里传自定义 handler，信封和 retry_after 自己拼；Retry-After 头由库发（它发的是
 *      同一份 resetTime 换算的秒数，与改造前 Math.ceil((resetTime-now)/1000) 等价）。
 */
const { rateLimit: expressRateLimit } = require('express-rate-limit')

function rateLimit(options = {}) {
  // 不能写 `options.windowMs || 60000`：显式传 0（"每秒只准 0 次"这类封停用例）
  // 会被 || 当成没传，静默变成 20 次/60 秒——限制比配置的还松，且没有任何提示。
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : 60 * 1000
  const max = Number.isFinite(options.max) && options.max >= 0 ? options.max : 20
  const keyFn = options.keyFn || ((req) => req.ip || req.socket?.remoteAddress || 'unknown')

  const fallback = '请求过于频繁，请稍后再试'
  const msgOpt = options.message || fallback
  // 两种入参都归一成 { code, message }：直接塞 message 会让对象入参变成
  // data.error.error.message，调用方按统一形状读就永远读不到文案
  const limitCode =
    typeof msgOpt === 'string' ? 'RATE_LIMITED' : msgOpt.error?.code || 'RATE_LIMITED'
  const limitMessage = typeof msgOpt === 'string' ? msgOpt : msgOpt.error?.message || fallback

  // `rateLimitProfile` 只给 `scripts/gen-openapi.js` 与后台读，不参与任何判定：
  // express-rate-limit 返回的中间件在栈里是匿名函数（`layer.name==="<anonymous>"`），
  // 生成器光看名字认不出"这道闸是限流"，挂个属性当标记，比正则扫源码稳。
  const mw = expressRateLimit({
    windowMs,
    limit: max,
    // 默认仍发老头的形状（X-RateLimit-*），因为前端和后台脚本现在就读这三个名字；
    // 想要 IETF 标准头的调用点自己传 standardHeaders: true（server.js 的总闸就是这么写的）
    legacyHeaders: options.legacyHeaders !== false,
    standardHeaders: options.standardHeaders ?? false,
    statusCode: 429,
    // 键原样用 keyFn 的返回值：不继承库的 IPv6 /56 合并，保持"一地址一桶"
    keyGenerator: (req) => String(keyFn(req) ?? 'unknown'),
    skip: options.skip,
    // 超限时回本仓统一信封。库里发出来的 Retry-After 已经写好了，这里只补 body 里的秒数
    handler: (req, res) => {
      const info = req.rateLimit || {}
      const retryAfter = info.resetTime
        ? Math.max(0, Math.ceil((new Date(info.resetTime).getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000)
      return res.status(429).json({
        success: false,
        error: { code: limitCode, message: limitMessage },
        retry_after: retryAfter,
      })
    },
  })
  mw.rateLimitProfile = { windowMs, limit: max }
  return mw
}

module.exports = { rateLimit }
