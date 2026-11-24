/**
 * 衣橱这一族接口的两道限流闸（11-03 拆分轮从 `routes/wardrobe.js` 逐字搬出）。
 *
 * 为什么单独一个文件：搭配日记那一段拆成 `routes/wardrobeOutfit.js` 之后也要挂
 * `writeLimiter`，而限流器**必须是同一个实例**——各写一份 `rateLimit({max:30})`
 * 就是两个独立计数器，同一个人在两处各能写 30 次，闸等于虚设。
 * ⚠️ 这两个实例还被 `scripts/gen-openapi.js` 读（中间件对象上带 `rateLimitProfile`，
 *    接口说明书里"这条接口吃哪道闸"就是从它取的）；搬走后函数对象没变 ⇒ 产物逐字节不变，
 *    这也是本轮拆分能不能算"行为零变化"的判据之一。
 */
const { rateLimit } = require('./rateLimit')

// 写操作限流：每分钟最多 30 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, message: '操作过于频繁，请稍后再试' })
// 六个吃 CPU 的分析口（/gaps /evaluate /suggest /match /recommend /top-fit）。
// 原来只有全局 100 次/15 分钟那道共享 IP 闸兜着，而它按 IP 分桶——出口是 CGNAT，
// 一个 IP 后面是一片人，一个人连点分析就能把整栋楼挤出额度（2026-10-12 补）。
// 单独一个桶，是为了不和写入口的 30 次共用：加满 30 件衣服不该让人下一步分析被拦。
const analysisLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: '分析请求过于频繁，请稍后再试',
})

module.exports = { writeLimiter, analysisLimiter }
