/**
 * `/api/health` 的限流豁免（2026-10-13 深夜轮收尾）
 * ==================================================
 * server.js 里那句"健康检查和静态文件不限流"是假的：apiLimiter 挂在 `app.use('/api/', ...)`，
 * 而健康路由在它**后面**注册，所以 `/api/health` 一直和顾客共用同一个 100 次/15 分钟桶。
 * 现量（10-13 本机起实例，同一 IP 先打空总闸）：桶空后 `/api/health` 回 429，
 * 监控探针因此在顾客侧一繁忙时就报"服务挂了"。`/health` 不在 /api 前缀下，本来就没这问题，
 * 两条入口口径必须一致。
 *
 * 这道豁免只在真实 HTTP 请求里才成立（skip 判据读 req.path），所以起临时实例：
 * PORT=0 + db/init 内存替身，测完关端口。
 * 运行: node --test test/healthRateLimitExempt.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

process.env.PORT = '0'

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

const app = require('../server')
const server = app.server

const BASE = 100 // apiLimiter 的 max
let baseUrl = null

/** 一条不存在的 /api 路径：吃额度、无副作用，路由尾部那条 JSON 404 兜底接住它 */
const BURNER = '/api/__rate_limit_probe__'

test('准备：起临时实例并确认总闸额度是 100', async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const first = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(first.status, 404, '兜底 404 才说明这条路径只吃额度、不碰业务')
  const limit = first.headers.get('ratelimit-limit')
  assert.strictEqual(Number(limit), BASE, '本文件按 max=100 设计，闸值漂了要一起改')
})

test('把桶打空：第 101 条普通接口 429，同一时刻 /api/health 仍然 200', async () => {
  // 上面已经吃掉了 1 次额度
  for (let i = 0; i < BASE - 1; i++) {
    const r = await fetch(`${baseUrl}${BURNER}`)
    assert.strictEqual(r.status, 404, `第 ${i + 2} 条还在额度内`)
  }
  const spent = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(spent.status, 429, '闸门本身得先成立，否则下面"豁免"是空话')
  const body = await spent.json()
  assert.strictEqual(body.error.code, 'TOO_MANY_REQUESTS')
  // 11-02 起总闸也走 `middleware/rateLimit.js` 工厂（以前 server.js 直接 require
  // express-rate-limit，同一台机器上两套 429 实现：路由里那 23 道闸回带 `retry_after`
  // 的信封，总闸和 /uploads 闸回不带的那一种）。前端只用信一个形状，所以这条必须钉住。
  assert.strictEqual(typeof body.retry_after, 'number', '总闸的 429 也要带 retry_after 秒数')
  assert.ok(body.retry_after >= 0 && body.retry_after <= 900, 'retry_after 应落在 15 分钟窗口内')
  assert.strictEqual(body.error.message, '请求过于频繁,请 15 分钟后再试', '文案不能被工厂换掉')

  const health = await fetch(`${baseUrl}/api/health`)
  assert.strictEqual(health.status, 200, '修复前这里是 429：探针被顾客流量掐死')
  const j = await health.json()
  assert.strictEqual(j.data.status, '正常')

  // 带查询串的写法同样豁免（判据切过 '?' 再比），有的探针会自己加时间戳
  const withQuery = await fetch(`${baseUrl}/api/health?ts=1`)
  assert.strictEqual(withQuery.status, 200)
  await withQuery.json()

  // `/health`（不带 /api）走的是另一条路，两条入口回同一份内容
  const alt = await fetch(`${baseUrl}/health`)
  assert.strictEqual(alt.status, 200)
  assert.deepStrictEqual((await alt.json()).data, j.data)
})

test('豁免只给健康口：紧接着的普通接口照旧 429，闸没有被顺手放宽', async () => {
  const still = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(still.status, 429, '/api/health 不该把整条 /api 的额度一起放掉')
})

test('收尾：关端口', async () => {
  await new Promise((resolve) => server.close(resolve))
})
