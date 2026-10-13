/**
 * 限流工厂行为测试（middleware/rateLimit.js）
 *
 * 前台 /api 总闸用的是 express-rate-limit，而各业务路由（auth/clothing/cosmetic/…）和后台
 * `/admin/api` 用的是这个手写工厂——它有自己的窗口、桶和响应形状，改坏不会有任何现成测试报警。
 * 之前它只被路由"用着"，没被"钉着"：一旦有人把 message 的对象入参当字符串塞进响应，
 * 调用方按 {success,error:{code,message}} 读就永远读不到话（这正是本仓反复栽过的那个形状）。
 *
 * 全部是纯内存跑，不连数据库、不起服务。
 * 运行: node --test test/rateLimitWindow.test.js
 */
const test = require('node:test')
const assert = require('node:assert')

const { rateLimit } = require('../middleware/rateLimit')

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

function run(mw, ip) {
  const res = fakeRes()
  let nextCalled = false
  mw({ ip, socket: {} }, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

test('窗口内前 max 次放行，第 max+1 次给 429 且形状是 {success,error:{code,message}}', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2, message: '慢一点' })
  assert.strictEqual(run(mw, '1.1.1.1').nextCalled, true)
  assert.strictEqual(run(mw, '1.1.1.1').nextCalled, true)
  const third = run(mw, '1.1.1.1')
  assert.strictEqual(third.nextCalled, false)
  assert.strictEqual(third.res.statusCode, 429)
  assert.strictEqual(third.res.body.success, false)
  assert.strictEqual(third.res.body.error.code, 'RATE_LIMITED')
  assert.strictEqual(third.res.body.error.message, '慢一点')
  assert.ok(Number.isFinite(third.res.body.retry_after))
})

test('message 传 {success,error:{code,message}} 对象时不会套成 error.error', () => {
  const mw = rateLimit({
    windowMs: 60_000,
    max: 0,
    message: { success: false, error: { code: 'ADMIN_TOO_FREQUENT', message: '后台请求过于频繁' } },
  })
  const r = run(mw, '2.2.2.2')
  assert.strictEqual(r.res.statusCode, 429)
  assert.strictEqual(r.res.body.error.code, 'ADMIN_TOO_FREQUENT')
  assert.strictEqual(r.res.body.error.message, '后台请求过于频繁')
  assert.strictEqual(r.res.body.error.error, undefined)
})

test('桶按 IP 分开：A 打满不影响 B，且响应头带着剩余额度', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 })
  assert.strictEqual(run(mw, '3.3.3.3').nextCalled, true)
  assert.strictEqual(run(mw, '3.3.3.3').res.statusCode, 429)
  const b = run(mw, '4.4.4.4')
  assert.strictEqual(b.nextCalled, true)
  assert.strictEqual(b.res.headers['X-RateLimit-Limit'], 1)
  assert.strictEqual(b.res.headers['X-RateLimit-Remaining'], 0)
})

test('显式传 0 不会被 || 兜底成默认值（封停用例真能一枪不放开）', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 0 })
  assert.strictEqual(run(mw, '5.5.5.5').res.statusCode, 429)
})

test('windowMs 传 0 或非法值回落到默认 60 秒，不会算出"立刻重置"', () => {
  const mw = rateLimit({ windowMs: 0, max: 1 })
  assert.strictEqual(run(mw, '6.6.6.6').nextCalled, true)
  const second = run(mw, '6.6.6.6')
  assert.strictEqual(second.res.statusCode, 429)
  assert.ok(second.res.headers['X-RateLimit-Reset'] >= Math.ceil(Date.now() / 1000))
})
