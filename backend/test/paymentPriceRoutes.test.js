/**
 * 收款标价两条端点的行为测试（2026-11-04 规范轮新建）
 *
 * 为什么补这两条：`routes/payment.js` 有 12 条端点，其中 10 条早被全屋点过名
 * （`test/mirrorDepositGuard.test.js`／`paymentDeliverables.test.js`／`routeIdParam20261014.test.js`
 * ／`routeLimiterCoverage.test.js`／`rateLimitWindow.test.js`／`phase14Experience.test.js` 六份，
 * 现量：`grep -rln "routes/payment" test/*.test.js`）。剩下 **GET/PUT `/admin/price`** 这一对
 * 在全仓零出现——而它俩恰好是"钱"的唯一写入口：站长在后台改一次标价，之后所有新单、
 * 对账单、放行阈值都跟着这个数走。改价的形状门与"只影响之后新建的订单"那句承诺，
 * 过去只坐在注释里，没有一条断言。
 *
 * 为什么要真发 HTTP：`adminLoginRequired` 与 `sendSuccess/sendError` 都在中间件那一层，
 * 直接调 handler 只会验出"业务函数返回了什么"，验不出守卫挡不挡、状态码对不对、
 * `app_settings` 那一行到底写成了整数还是浮点。按全屋现行套路：内存库替身＋`app.listen(0)` 真发请求。
 * ⛔ 不开活库、⛔ 不打外网（这两条端点全程只碰 SQLite，`alipay.yuanToFen` 是纯换算）。
 *
 * 钉十一件事：
 *  ① 两条端点都先过 `adminLoginRequired`：无 token ⇒ 401「未授权，请提供管理员 Token」，
 *     假 token ⇒ 401「Token 无效或已过期」，⛔ 让未登录者读到或改写标价；
 *  ② 后台账号被禁用后，签名仍然正确的旧 token 当场失效 ⇒ 401（`middleware/auth.js` 里那句
 *     "签名对只证明持密钥方签过，不证明这个账号还在"）；
 *  ③ `GET` 在库里没有那一行时 ⇒ `source: 'code'`＋`updated_at: null`＋出账三格自洽
 *     （⛔ 在测试里抄那份默认值：只验"兜底路径把兜底值如实报成兜底值"，数对不对由④现取现比）；
 *  ④ `GET` 在库里有那一行时 ⇒ `source: 'db'`，报出来的数**就是库里那一格**（分/元两格同源）；
 *  ⑤ 库里那一格坏掉时（空／非数字／0／负数）回落默认值，⛔ 报 500 或报出个 `NaN` 元；
 *  ⑥ 现状登记（不是背书）：库里那一格写成 `'99.9'` 时走的是 `parseInt` 的截断 ⇒ 99 分＝0.99 元，
 *     ⛔ 不是回落默认。这条把今天的行为钉住，将来谁改成回落或改成拒读，这里会红得有意义；
 *  ⑦ `PUT` 的形状门：空串／纯空格／字母／三位小数／负数／科学计数法／两个小数点／数组／`null`
 *     ⇒ 九种写法全部 400＋逐字「金额最多两位小数，例如 99 或 59.9」，且**库里一行都没被写**；
 *     11-04 变异探针实测：把那道正则从 `^\d+(\.\d{1,2})?$` 放宽成 `^\d+(\.\d+)?$`，
 *     本文件当场红在 ⑦⑧ 两条（`"99.999" 回了 200`）⇒ 形状门真在被盯着。
 *  ⑧ `PUT` 的区间门：`0`（含数字形态）与 `100000` ⇒ 400＋逐字「金额需在 0.01 ～ 99999.99 元之间」，
 *     而边界两头的 `0.01`／`99999.99` 放行（阈值的开闭必须用边界本身验，⛔ 拿中间数验一圈了事）；
 *  ⑨ 精度：`59.9` ⇒ 5990 分、`0.01` ⇒ 1 分（⛔ 浮点乘 100 ⇒ 5989.999999999999 / 1.0000000000000002）；
 *  ⑩ `PUT` 成功 ⇒ 出账两格＋库里那一格是**整数字符串**（`schema.sql` 注释写死了"避免用浮点存钱"）
 *     ＋再 `PUT` 一次只更新那一行、不新增（`ON CONFLICT` 那条 upsert）；
 *  ⑪ 改价不动已下的单：先把一条 `payment_orders` 的 `amount_fen` 写成 9900，改价成 5990 之后
 *     那一行仍是 9900（`routes/payment.js` 那句"每笔订单在下单那一刻就把金额写死在自己那行"）。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉，全程不打开 backend/db/styleai.db。
 * 运行: node --test test/paymentPriceRoutes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

// 管理员 token 是 HMAC：没密钥时 generateAdminToken 直接抛
process.env.SECRET_KEY = 'payment-price-test-secret'

const bcrypt = require('bcryptjs')
const { generateAdminToken, verifyAdminToken } = require('../middleware/auth')
const express = require('express')
const paymentRouter = require('../routes/payment')

const app = express()
app.use(express.json())
app.use('/api/payment', paymentRouter)

const db = memDb
const PRICE_KEY = 'payment_amount_fen'
let server
let base = ''
let adminToken = ''

/** 读库里那一格的原始值（不经过路由的兜底逻辑），用来验"到底写进去的是什么" */
const rawSetting = () => db.prepare('SELECT * FROM app_settings WHERE key = ?').get(PRICE_KEY)
const priceRowCount = () => db.prepare('SELECT COUNT(*) n FROM app_settings').get().n

async function call(method, route, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = token === null ? '' : `Bearer ${token}`
  const res = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json || {} }
}

const getPrice = (token = adminToken) => call('GET', '/api/payment/admin/price', undefined, token)
const putPrice = (amount, token = adminToken) =>
  call('PUT', '/api/payment/admin/price', { amount }, token)

test('起步：临时实例＋一个可用的管理员身份', async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
  db.prepare('INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, 1)').run(
    'admin',
    bcrypt.hashSync('Adm1n-Pass-123', 10),
  )
  adminToken = generateAdminToken('admin')
  assert.strictEqual(verifyAdminToken(adminToken), true, '自己签的 token 当场就验不过')
  assert.strictEqual(priceRowCount(), 0, '内存库起手应该是干净的')
})

test('① 两条端点都先过守卫：没 token 与假 token 一律 401', async () => {
  // ⚠️ 这里绕开 getPrice()/putPrice() 直接调 call()：那两个助手的 `token = adminToken` 是
  // **默认参数**，传 `undefined` 等于没传⇒ 会被填成真 token，"不带令牌"这一档就测成了"带着令牌"。
  // 11-04 首跑就是这么把 401 读成 200 的，所以这一条要显式走 call()。
  const noToken = await call('GET', '/api/payment/admin/price', undefined, undefined)
  assert.strictEqual(noToken.status, 401)
  assert.strictEqual(noToken.body.error.message, '未授权，请提供管理员 Token')
  assert.strictEqual(
    JSON.stringify(noToken.body).includes('amount'),
    false,
    '未登录却读到了标价出账',
  )

  // 有 authorization 头但不是 `Bearer ` 起头（前端漏拼、或空串）：同样算没登录，⛔ 500
  const emptyHeader = await call('GET', '/api/payment/admin/price', undefined, null)
  assert.strictEqual(emptyHeader.status, 401, `空 Authorization 头回了 ${emptyHeader.status}`)

  const badToken = await getPrice('nope.nope.nope')
  assert.strictEqual(badToken.status, 401)
  assert.strictEqual(badToken.body.error.message, 'Token 无效或已过期')

  const noTokenPut = await call('PUT', '/api/payment/admin/price', { amount: '0.01' }, undefined)
  assert.strictEqual(noTokenPut.status, 401, '未登录也能改价')
  assert.strictEqual(noTokenPut.body.error.message, '未授权，请提供管理员 Token')
  const badTokenPut = await putPrice('0.01', 'nope.nope.nope')
  assert.strictEqual(badTokenPut.status, 401)
  assert.strictEqual(
    badTokenPut.body.error.message,
    'Token 无效或已过期',
    '两条端点的守卫文案不是同一份',
  )
  assert.strictEqual(priceRowCount(), 0, '被守卫挡下的 PUT 却还是把价写进了库')
})

test('② 禁用后台账号后，签名仍正确的旧 token 当场失效', async () => {
  db.prepare("UPDATE admin_users SET is_active = 0 WHERE username = 'admin'").run()
  const offed = await getPrice()
  assert.strictEqual(offed.status, 401, '账号禁用了，旧 token 还在读标价')
  db.prepare("UPDATE admin_users SET is_active = 1 WHERE username = 'admin'").run()
  assert.strictEqual((await getPrice()).status, 200, '解禁后应当立刻恢复可用')
})

test('③ 库里没有那一行时走代码兜底，出账三格自洽', async () => {
  const r = await getPrice()
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const d = r.body.data
  assert.deepStrictEqual(
    Object.keys(d).sort(),
    ['amount', 'amount_fen', 'default_amount', 'source', 'updated_at'],
    '出账形状变了',
  )
  assert.strictEqual(d.source, 'code')
  assert.strictEqual(d.updated_at, null)
  // 兜底路径的自证：元/分两格必须同源，且默认值就是它自己报的那个默认值。
  // ⛔ 这里不写"99"这个字面数：那份真相只在 routes/payment.js 的 PRICE 里，抄进测试就成两处。
  assert.strictEqual(d.amount_fen, d.amount * 100)
  assert.strictEqual(d.default_amount, d.amount)
  const baseline = d.amount_fen
  assert.ok(Number.isInteger(baseline) && baseline > 0, `兜底出来的价不是正整数分：${baseline}`)
})

test('④ 库里有那一行时以库为准：报出来的数就是库里那一格', async () => {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(PRICE_KEY, '12345')
  const r = await getPrice()
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.data.source, 'db')
  assert.strictEqual(r.body.data.amount_fen, 12345)
  assert.strictEqual(r.body.data.amount, 123.45)
  // 没写 updated_at ⇒ 列默认值填的是 datetime('now')，这一格只验"非空"，不验内容
  assert.ok(r.body.data.updated_at, 'source 已是 db，updated_at 却还是 null')
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(PRICE_KEY)
})

test('⑤ 库里那一格坏掉时回落代码兜底，⛔ 报 500 或报出个 NaN 元', async () => {
  for (const broken of ['', 'abc', '0', '-100']) {
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(PRICE_KEY, broken)
    const r = await getPrice()
    assert.strictEqual(r.status, 200, `坏值 ${JSON.stringify(broken)} 把接口打成了 ${r.status}`)
    const d = r.body.data
    assert.ok(
      Number.isInteger(d.amount_fen) && d.amount_fen > 0,
      `坏值 ${JSON.stringify(broken)} 漏出的价不是正整数分：${d.amount_fen}`,
    )
    assert.ok(d.amount > 0, `坏值 ${JSON.stringify(broken)} 报出的元价是 ${d.amount}`)
  }
  db.prepare('DELETE FROM app_settings').run()
})

test('⑥ 现状登记：库里写成小数串走的是截断而不是回落（钉住今天的行为，不是给它背书）', async () => {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(PRICE_KEY, '99.9')
  const r = await getPrice()
  assert.strictEqual(r.body.data.source, 'db', '写成 99.9 也算"库里有这一行"')
  // currentPriceFen 用 parseInt ⇒ '99.9' 截成 99 ⇒ 0.99 元。
  // 谁要把这里改成"回落默认"或"拒读"，这条会红——那时请连着对账口径一起定，⛔ 顺手改掉断言。
  assert.strictEqual(r.body.data.amount_fen, 99)
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(PRICE_KEY)
})

test('⑦ PUT 的形状门：九种写法全挡下，且库里一行都没被写', async () => {
  const cases = ['', '   ', 'abc', '99.999', '-1', '1e3', '0.1.2', ['9', '9'], null]
  for (const bad of cases) {
    const r = await putPrice(bad)
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)} 回了 ${r.status}`)
    assert.strictEqual(
      r.body.error.message,
      '金额最多两位小数，例如 99 或 59.9',
      `${JSON.stringify(bad)} 的文案不是形状门那句`,
    )
  }
  assert.strictEqual(priceRowCount(), 0, '被挡下的 PUT 仍然写了库')
})

test('⑧ 区间门：0 与 100000 挡下，0.01 与 99999.99 放行（边界必须用边界本身验）', async () => {
  for (const out of ['0', 0, '100000', '100000.00']) {
    const r = await putPrice(out)
    assert.strictEqual(r.status, 400, `${JSON.stringify(out)} 该被区间门挡下，实回 ${r.status}`)
    assert.strictEqual(r.body.error.message, '金额需在 0.01 ～ 99999.99 元之间')
  }
  assert.strictEqual(priceRowCount(), 0, '区间门挡下的 PUT 仍然写了库')

  const min = await putPrice('0.01')
  assert.strictEqual(min.status, 200, JSON.stringify(min.body))
  assert.strictEqual(min.body.data.amount_fen, 1)
  const max = await putPrice('99999.99')
  assert.strictEqual(max.status, 200)
  assert.strictEqual(max.body.data.amount_fen, 9999999)
  db.prepare('DELETE FROM app_settings').run()
})

test('⑨ 精度：换算成分是整数，⛔ 浮点乘 100', async () => {
  for (const [yuan, fen] of [
    ['59.9', 5990],
    ['0.01', 1],
    ['99', 9900],
    [99, 9900],
    ['123.45', 12345],
  ]) {
    const r = await putPrice(yuan)
    assert.strictEqual(r.status, 200, `${JSON.stringify(yuan)} 被挡了：${JSON.stringify(r.body)}`)
    assert.strictEqual(
      r.body.data.amount_fen,
      fen,
      `${JSON.stringify(yuan)} 换算成了 ${r.body.data.amount_fen} 分`,
    )
  }
  db.prepare('DELETE FROM app_settings').run()
})

test('⑩ 写进库的是整数字符串，重复 PUT 只更新那一行', async () => {
  const r = await putPrice('188.00')
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.deepStrictEqual(r.body.data, { amount: 188, amount_fen: 18800 })
  assert.strictEqual(r.body.message, '收款金额已更新')

  const row = rawSetting()
  assert.ok(row, 'PUT 报成功，库里却没有那一格')
  assert.strictEqual(typeof row.value, 'string', '价格列现在不是文本了（当初就是为避开浮点定的）')
  assert.match(row.value, /^\d+$/, `库里存的是 ${row.value}，不是整数字符串`)
  assert.ok(row.updated_at, '改价没写 updated_at')

  await putPrice('77.70')
  assert.strictEqual(priceRowCount(), 1, '第二次 PUT 新增了一行而不是覆盖 ⇒ upsert 那条没生效')
  assert.strictEqual(rawSetting().value, '7770')
  const again = await getPrice()
  assert.strictEqual(again.body.data.source, 'db')
  assert.strictEqual(again.body.data.amount_fen, 7770, 'PUT 写进去的价，GET 没照实读回来')
})

test('⑪ 改价不动已经下过的单：金额在下单那一刻写死在自己那行', async () => {
  const userId = Number(
    db.prepare('INSERT INTO users (session_id, nickname) VALUES (?, ?)').run('sid-price', '老单')
      .lastInsertRowid,
  )
  db.prepare(
    `INSERT INTO payment_orders (out_trade_no, user_id, description, amount_fen, status)
     VALUES ('NO-FIXED-1', ?, '形象定制服务费', 9900, 'created')`,
  ).run(userId)

  const r = await putPrice('59.90')
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.strictEqual(r.body.data.amount_fen, 5990)

  const order = db
    .prepare('SELECT amount_fen FROM payment_orders WHERE out_trade_no = ?')
    .get('NO-FIXED-1')
  assert.strictEqual(
    order.amount_fen,
    9900,
    '改价把已下单那笔的金额也改了 ⇒ 付 99 的单会被按 59.9 对账/放行',
  )
  // 而新读出来的"当前标价"确实变了：老单不动、新单跟着走，这才是那句承诺的两面
  assert.strictEqual((await getPrice()).body.data.amount_fen, 5990)
})

test('收尾：关掉临时实例（本文件全程只开 :memory:，活库没被 require 过）', async () => {
  await new Promise((resolve) => server.close(resolve))
})
