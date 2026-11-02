/**
 * 限流工厂行为测试（middleware/rateLimit.js）
 *
 * 前台 /api 总闸用的是 express-rate-limit，而各业务路由（auth/clothing/cosmetic/…）和后台
 * `/admin/api` 用的是这个工厂——11-02 起它的内核也换成了 express-rate-limit，但对外契约
 * （窗口/桶/响应形状/响应头）是仓库自己定的：改坏了不会有任何现成测试报警，所以钉在这里。
 * 之前它只被路由"用着"，没被"钉着"：一旦有人把 message 的对象入参当字符串塞进响应，
 * 调用方按 {success,error:{code,message}} 读就永远读不到话（这正是本仓反复栽过的那个形状）。
 *
 * 换成库内核后测试跟着改了两处，都不是放宽断言：
 *   1) 库的计数要 await store.increment ⇒ run() 必须 async，同步读 res 会永远读到 null
 *      （这不是行为变了，是断言得等异步落定）。
 *   2) 库写响应头走 info.limit.toString() ⇒ 三个 X-RateLimit-* 是字符串。HTTP 线上本来就
 *      只有字符串，改造前手写版塞数字进 setHeader、Node 也一样转成字符串，所以用 Number()
 *      读回来比，比的是同一个值。
 *
 * 全部是纯内存跑，不连数据库、不起服务。
 * 运行: node --test test/rateLimitWindow.test.js
 */
const test = require('node:test')
const assert = require('node:assert')

const { rateLimit } = require('../middleware/rateLimit')
// 下面最后两条测试钉的是"内联调用"这个用法的前提，所以要直接拿库本体来量
// （本仓工厂没有 `store` 这个旋钮，注不进一只会抛错的桶）。
const { rateLimit: expressRateLimit } = require('express-rate-limit')

/** 假 req/res：只需要 keyFn 用的 ip 和 res 的 setHeader/status/json */
function fakeRes() {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) {
      res.headers[k] = v
    },
    status(c) {
      res.statusCode = c
      return res
    },
    json(b) {
      res.body = b
      return res
    },
  }
  return res
}

async function run(mw, ip, params = {}) {
  const res = fakeRes()
  let nextCalled = false
  await mw({ ip, socket: {}, params }, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

test('窗口内前 max 次放行，第 max+1 次给 429 且形状是 {success,error:{code,message}}', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2, message: '慢一点' })
  assert.strictEqual((await run(mw, '1.1.1.1')).nextCalled, true)
  assert.strictEqual((await run(mw, '1.1.1.1')).nextCalled, true)
  const third = await run(mw, '1.1.1.1')
  assert.strictEqual(third.nextCalled, false)
  assert.strictEqual(third.res.statusCode, 429)
  assert.strictEqual(third.res.body.success, false)
  assert.strictEqual(third.res.body.error.code, 'RATE_LIMITED')
  assert.strictEqual(third.res.body.error.message, '慢一点')
  assert.ok(Number.isFinite(third.res.body.retry_after))
})

test('message 传 {success,error:{code,message}} 对象时不会套成 error.error', async () => {
  const mw = rateLimit({
    windowMs: 60_000,
    max: 0,
    message: { success: false, error: { code: 'ADMIN_TOO_FREQUENT', message: '后台请求过于频繁' } },
  })
  const r = await run(mw, '2.2.2.2')
  assert.strictEqual(r.res.statusCode, 429)
  assert.strictEqual(r.res.body.error.code, 'ADMIN_TOO_FREQUENT')
  assert.strictEqual(r.res.body.error.message, '后台请求过于频繁')
  assert.strictEqual(r.res.body.error.error, undefined)
})

test('桶按 IP 分开：A 打满不影响 B，且响应头带着剩余额度', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 })
  assert.strictEqual((await run(mw, '3.3.3.3')).nextCalled, true)
  assert.strictEqual((await run(mw, '3.3.3.3')).res.statusCode, 429)
  const b = await run(mw, '4.4.4.4')
  assert.strictEqual(b.nextCalled, true)
  assert.strictEqual(Number(b.res.headers['X-RateLimit-Limit']), 1)
  assert.strictEqual(Number(b.res.headers['X-RateLimit-Remaining']), 0)
})

test('显式传 0 不会被 || 兜底成默认值（封停用例真能一枪不放开）', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 0 })
  const r = await run(mw, '5.5.5.5')
  assert.strictEqual(r.res.statusCode, 429)
  assert.strictEqual(r.nextCalled, false)
})

test('windowMs 传 0 或非法值回落到默认 60 秒，不会算出"立刻重置"', async () => {
  const mw = rateLimit({ windowMs: 0, max: 1 })
  assert.strictEqual((await run(mw, '6.6.6.6')).nextCalled, true)
  const second = await run(mw, '6.6.6.6')
  assert.strictEqual(second.res.statusCode, 429)
  // X-RateLimit-Reset 是 epoch 秒（改造前后同口径），不是"还剩几秒"
  assert.ok(Number(second.res.headers['X-RateLimit-Reset']) >= Math.ceil(Date.now() / 1000))
})

test('超限响应带 Retry-After 头（库发头部、工厂只拼 body，两边秒数同源）', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 })
  await run(mw, '7.7.7.7')
  const over = await run(mw, '7.7.7.7')
  assert.strictEqual(over.res.statusCode, 429)
  assert.ok(Number.isFinite(Number(over.res.headers['Retry-After'])))
  assert.ok(Number(over.res.headers['Retry-After']) <= 60)
  assert.strictEqual(over.res.body.retry_after, Number(over.res.headers['Retry-After']))
})

test('keyFn 自定义键生效：同一 IP 的不同资源各算各的桶', async () => {
  const mw = rateLimit({
    windowMs: 60_000,
    max: 1,
    keyFn: (req) => `${req.ip}|${req.params.id}`,
  })
  // 同 IP + 同 params.id ⇒ 第二次撞桶；同 IP 换 params.id ⇒ 另一只桶
  const x1 = await run(mw, '8.8.8.8', { id: 'x' })
  const x2 = await run(mw, '8.8.8.8', { id: 'x' })
  const y1 = await run(mw, '8.8.8.8', { id: 'y' })
  assert.strictEqual(x1.nextCalled, true)
  assert.strictEqual(x2.res.statusCode, 429)
  assert.strictEqual(y1.nextCalled, true, '同 IP 换资源 id 就该是另一个桶')
})

test('standardHeaders 透传后拿到 IETF 的 RateLimit-* 标准头', async () => {
  const mw = rateLimit({ windowMs: 60_000, max: 3, standardHeaders: true, legacyHeaders: false })
  const r = await run(mw, '9.9.9.9')
  assert.ok(r.res.headers['RateLimit-Limit'] !== undefined || r.res.headers['RateLimit-Policy'])
  assert.strictEqual(r.res.headers['X-RateLimit-Limit'], undefined)
})

test('内核确实是 express-rate-limit：工厂返回值带库才有的 resetKey/getKey', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 })
  assert.strictEqual(typeof mw.resetKey, 'function')
  assert.strictEqual(typeof mw.getKey, 'function')
})

// ------------------------------------------------------------------
// 两条"内联调用"前提（11-02 规范轮换库内核之后才冒出来的）
// ------------------------------------------------------------------
// `routes/payment.js` 的 `GET /api/payment/my?report=`／`?proof=` 这一支，是在 handler **内部**
// 直接 `reportLimiter(req, res, () => { 业务 })`——因为限流只该管这一支。第三个参数在库眼里就是 `next`。
// 库的最外层包了一个 `handleAsyncErrors`（尺子＝`node_modules/express-rate-limit/dist/index.cjs:871-877`：
// `await Promise.resolve(fn(request, response, next)).catch(next)` ＋ 外层 `catch { next(error) }`），
// 于是"中间件里任何异常"——**包括你亲手传进去的那个 next 自己抛的**——都改走 `next(error)`。
// ⇒ 那个回调必须接第一个参数。不接的话两件事静默发生，一条测试都不会红：
//   ① 限流器一坏（store 抛／keyGenerator 抛）就照常把报告发出去＝失败开放；
//   ② 业务一抛，库把同一个回调再调一次（这次带 err）＝`claimReport` 那条写库逻辑跑两遍。
// 假 req 一律带自定义 keyGenerator：库的默认 keyGenerator 会先跑 trustProxy 那套校验，
// 而本仓工厂从来自己给 keyGenerator（见 middleware/rateLimit.js 头注差异 ①），口径一致才叫前提。

test('store 抛错（同步／异步都试）走的是 next(err)，promise 永不 reject', async () => {
  for (const kind of ['sync', 'async']) {
    const badStore = {
      init() {},
      increment() {
        if (kind === 'sync') throw new Error(`boom-${kind}`)
        return Promise.reject(new Error(`boom-${kind}`))
      },
      decrement() {},
      resetKey() {},
    }
    const mw = expressRateLimit({
      windowMs: 1000,
      limit: 5,
      store: badStore,
      keyGenerator: () => `premise-store-${kind}`,
    })
    const seen = []
    let rejected = null
    try {
      await mw({ ip: '8.8.8.8', socket: {}, params: {} }, fakeRes(), (err) => {
        seen.push(err || 'next() 没带错误')
      })
    } catch (e) {
      rejected = e
    }
    assert.strictEqual(
      rejected,
      null,
      `${kind}：库不该把错误抛成 rejected promise（Express 4 不等返回值，那样就成进程级 unhandled rejection）`,
    )
    assert.strictEqual(seen.length, 1, `${kind}：next 应该被调用一次`)
    assert.ok(seen[0] instanceof Error, `${kind}：错误是走 next(err) 送进来的，不是被吞掉`)
    assert.strictEqual(seen[0].message, `boom-${kind}`)
  }
})

test('业务回调自己抛异常时，同一个回调会被库再调一次（这就是"必须接 err"的第二半）', async () => {
  const mw = expressRateLimit({
    windowMs: 60_000,
    limit: 10,
    keyGenerator: () => 'premise-double-run',
  })
  const seen = []
  await mw({ ip: '7.7.7.7', socket: {}, params: {} }, fakeRes(), (err) => {
    seen.push(err ? `第二次：err=${err.message}` : '第一次：无 err，跑业务')
    if (!err) throw new Error('业务里抛的')
  })
  assert.deepEqual(
    seen,
    ['第一次：无 err，跑业务', '第二次：err=业务里抛的'],
    '回调被调两次＝业务跑了两遍；接住第二个参数就能把它挡在门外',
  )
})
