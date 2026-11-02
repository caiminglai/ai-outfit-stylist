/**
 * 限流路由覆盖测试：payment 两条 notify 与 wardrobe 各写入口
 *
 * 背景（2026-10 审计）：① server.js 的全局 apiLimiter 豁免了 /api/payment/notify*，
 * 而两条回调路由自己没挂任何闸 ⇒ 伪造回调可以无限锤验签；② wardrobe 的写入口只给
 * items 三条挂了 writeLimiter，/outfits、/wishlist 的 POST/PUT 漏了。
 * 这里不重测限流工厂本身（那是 rateLimitWindow.test.js 的活），只钉"闸挂没挂、挂在哪"。
 *
 * 用 require.cache 把 db/init 换成内存库（schema.sql 同源），测试全程不碰活库。
 * 运行: node --test test/routeLimiterCoverage.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

// ── 内存库替身：必须在 require 任何 routes 之前装好 ──
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const paymentRouter = require('../routes/payment')
const wardrobeRouter = require('../routes/wardrobe')
const recommendRouter = require('../routes/recommend')

/** 按 method+path 找到 router.stack 里的 Route（Express 内部结构，够用且不碰公开 API） */
function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    const r = layer.route
    if (r && r.path === routePath && r.methods[method.toLowerCase()]) return r
  }
  return null
}

/** 只驱动限流中间件本身：假 req/res + next 计数，绝不落到真业务 handler
 *  必须 await：11-02 起工厂内核是 express-rate-limit，它先 `await store.increment(key)`
 *  再决定放行/拦，同步读 res 只会读到 null（手写桶是同步的，所以改造前不用等）。*/
async function runMiddleware(mw, ip) {
  let nextCalled = false
  const res = {
    statusCode: null,
    body: null,
    headers: {},
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
  await mw({ ip, socket: {}, headers: {} }, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

test('payment 两条 notify 都挂在同一个专用限流实例上（各自不再裸奔）', () => {
  const wx = findRoute(paymentRouter, 'post', '/notify')
  const ali = findRoute(paymentRouter, 'post', '/notify/alipay')
  assert.ok(wx && ali, '两条回调路由必须存在')
  assert.strictEqual(wx.stack.length, 2, 'notify 前必须有 limiter，再是业务 handler')
  assert.strictEqual(ali.stack.length, 2)
  assert.strictEqual(
    wx.stack[0].handle,
    ali.stack[0].handle,
    '两条回调共用同一个 notifyLimiter（独立桶、共享额度，与查单/凭证桶分开）',
  )
})

test('notifyLimiter 额度 300/15 分钟：前 300 次放行，第 301 次才 429', async () => {
  const limiter = findRoute(paymentRouter, 'post', '/notify').stack[0].handle
  for (let i = 1; i <= 300; i++) {
    const r = await runMiddleware(limiter, '8.8.8.8')
    assert.strictEqual(r.nextCalled, true, `第 ${i} 次不该被拦，渠道重推不能被掐`)
  }
  const blocked = await runMiddleware(limiter, '8.8.8.8')
  assert.strictEqual(blocked.nextCalled, false)
  assert.strictEqual(blocked.res.statusCode, 429)
  // 只吃验签这条 IP 的桶，不影响别的来源
  assert.strictEqual((await runMiddleware(limiter, '8.8.4.4')).nextCalled, true)
})

test('wardrobe 六个写入口共用 writeLimiter（含本轮补上的 outfits/wishlist）', async () => {
  const writeRoutes = [
    ['post', '/items'],
    ['put', '/items/:itemId'],
    ['delete', '/items/:itemId'],
    ['post', '/outfits'],
    ['post', '/wishlist'],
    ['put', '/wishlist/:wishId'],
  ]
  let shared = null
  for (const [method, p] of writeRoutes) {
    const route = findRoute(wardrobeRouter, method, p)
    assert.ok(route, `${method.toUpperCase()} ${p} 必须存在`)
    assert.strictEqual(route.stack.length, 2, `${method.toUpperCase()} ${p} 缺少 writeLimiter`)
    if (shared === null) shared = route.stack[0].handle
    else assert.strictEqual(route.stack[0].handle, shared, `${p} 用的必须是同一个 writeLimiter`)
  }
  for (let i = 1; i <= 30; i++)
    assert.strictEqual((await runMiddleware(shared, '7.7.7.7')).nextCalled, true)
  assert.strictEqual((await runMiddleware(shared, '7.7.7.7')).res.statusCode, 429)
})

test('wardrobe 读接口没被误挂写限流（GET 一律单层 handler）', () => {
  for (const p of ['/items', '/items/:itemId', '/outfits', '/wishlist', '/status']) {
    const route = findRoute(wardrobeRouter, 'get', p)
    assert.ok(route, `GET ${p} 必须存在`)
    assert.strictEqual(route.stack.length, 1, `GET ${p} 不该挂 writeLimiter`)
  }
})

test('payment 原有各闸位置不动：查单/凭证限流仍在，notify 之外路由不受本轮影响', () => {
  // /order/:id 有 orderQueryLimiter + loginRequired（顺序本身由工厂测试保证，这里只钉存在性）
  // /order/:id 有 loginRequired + orderQueryLimiter + handler
  assert.strictEqual(findRoute(paymentRouter, 'get', '/order/:outTradeNo').stack.length, 3)
  // /deposit 是 loginRequired + depositLimiter + multer + handler
  assert.strictEqual(findRoute(paymentRouter, 'post', '/deposit').stack.length, 4)
  assert.strictEqual(findRoute(paymentRouter, 'get', '/qrcodes').stack.length, 1)
})

// 吃 CPU 的分析口（2026-10-12 补）：这八条 POST 原来一道专用闸都没有，只有全局
// 100 次/15 分钟那道按 IP 的共享闸兜着，而本机出口是 CGNAT——一个 IP 后面是一片人，
// 一个人连点"帮我配一套"就能把整栋楼的 /api 额度吃光（这轮真踩过，见记忆）。
// 单独开桶、不与写入口共用：加满 30 件衣服不该让下一步分析被拦。
test('wardrobe 六个分析口共用 analysisLimiter，且不与 writeLimiter 同实例', async () => {
  const analysisRoutes = [
    ['post', '/gaps'],
    ['post', '/evaluate'],
    ['post', '/suggest'],
    ['post', '/match'],
    ['post', '/recommend'],
    ['post', '/top-fit'],
  ]
  let shared = null
  for (const [method, p] of analysisRoutes) {
    const route = findRoute(wardrobeRouter, method, p)
    assert.ok(route, `${method.toUpperCase()} ${p} 必须存在`)
    assert.strictEqual(route.stack.length, 2, `${method.toUpperCase()} ${p} 缺少 analysisLimiter`)
    if (shared === null) shared = route.stack[0].handle
    else assert.strictEqual(route.stack[0].handle, shared, `${p} 用的必须是同一个 analysisLimiter`)
  }
  const writeRoute = findRoute(wardrobeRouter, 'post', '/items')
  assert.notStrictEqual(
    writeRoute.stack[0].handle,
    shared,
    '写入口与分析口分桶：20 次/分钟不该吃掉 30 次/分钟的写额度',
  )
  for (let i = 1; i <= 20; i++)
    assert.strictEqual(
      (await runMiddleware(shared, '6.6.6.6')).nextCalled,
      true,
      `第 ${i} 次不该被拦`,
    )
  assert.strictEqual((await runMiddleware(shared, '6.6.6.6')).res.statusCode, 429)
})

test('recommend 的 /feedback 与 /enhance 各挂上自己的桶，不吃 /engine 的额度', async () => {
  const engine = findRoute(recommendRouter, 'post', '/engine')
  const feedback = findRoute(recommendRouter, 'post', '/feedback')
  const enhance = findRoute(recommendRouter, 'post', '/enhance')
  for (const [name, route] of [
    ['engine', engine],
    ['feedback', feedback],
    ['enhance', enhance],
  ]) {
    assert.ok(route, `POST /${name} 必须存在`)
    assert.strictEqual(route.stack.length, 2, `POST /${name} 缺少限流`)
  }
  const handles = [engine, feedback, enhance].map((r) => r.stack[0].handle)
  assert.strictEqual(new Set(handles).size, 3, '三条口各自一个桶，谁也不该吃掉谁的额度')
  for (let i = 1; i <= 60; i++)
    assert.strictEqual(
      (await runMiddleware(feedback.stack[0].handle, '5.5.5.5')).nextCalled,
      true,
      `反馈第 ${i} 次不该被拦`,
    )
  assert.strictEqual((await runMiddleware(feedback.stack[0].handle, '5.5.5.5')).res.statusCode, 429)
  assert.strictEqual((await runMiddleware(enhance.stack[0].handle, '5.5.5.5')).nextCalled, true)
})
