/**
 * 认证路由的行为测试（2026-11-04 规范轮新建）
 *
 * 为什么现在补这一份：`routes/auth.js` 挂着 7 条端点，全仓测试面里只有
 * `test/auditFixes20261013.test.js` 用 `findRoute + 假 req/res` 点过 `/admin/accounts` 一条。
 * 其余六条的**入参形状、状态码、文案、以及"游客数据过户"那整段事务**从没进过任何断言。
 * 这一份不重复造轮子：429 的信封形状由 `test/rateLimitWindow.test.js` 钉（那是限流工厂的事），
 * 这里只钉 auth 自己那几条门的对错。
 *
 * 为什么要真发 HTTP：过户那段跑在 `db.transaction` 里、状态码由 `sendSuccess/sendError` 决定，
 * 拿假 req/res 只能验"函数返回了什么"，验不出"注册成功后游客那十几张表的行到底跟没跟人走"。
 * 所以按全屋现行那套路：内存库替身＋`app.listen(0)` 真发请求。⛔ 不开活库、⛔ 不打外网。
 *
 * ⚠️ 限流预算（写这份测试时踩到的第一件事，也是每条 test 起手那句 `await resetBuckets()` 的全部理由）：
 *   四条登录类端点各挂一个桶（guest/login/admin-login 各 10 次每 60 秒，register 只 5 次），
 *   桶按客户端 IP 计——本文件所有请求都出自 127.0.0.1，所以**整个文件共用同一格额度**。
 *   光 `/register` 的入参形状就有 4 档，加上边界与成功用例轻松超 5 次 ⇒ 从第 6 次起一律 429，
 *   测试会红成"路由错了"，其实是我把它的额度吃光了。所以每条 test 起手把桶清一次
 *   （走 express-rate-limit 公开的 `resetKey`，⛔ 不去改路由里的 max）。
 *   清桶只发生在**测试与测试之间**，任何一条 test 内部的连续请求都走真闸、没被绕过；
 *   闸本身照常验：⑲ 打满 register、⑳ 打满 guest，那两条起手清一次之后往后连打，⛔ 中途再清。
 *   依赖说明：`resetKey` 不在场时 helper 当场断言失败并说明原因，⛔ 让"额度没清"伪装成"接口坏了"。
 *
 * 钉二十件事（散在 18 条 test 里）：
 *  ① `/guest` ⇒ 200＋`session_id` 是能回查的 UUID＋`user_id` 是数字，库里真多一行；
 *  ② `/guest` 的 `nickname` 传对象／数组 ⇒ 落库 null；传数字／布尔 ⇒ 落库是它的字符串形式
 *     （`utils/common.js` 的 `asText` 只把非 string/number/boolean 折成空串，
 *     这是它的口径，测试照着它写死，⛔ 反过来为了测试好看去改 asText）；超长截到 40；
 *  ③ `/register` 手机号形状（缺／10 位／非 1 开头／数组）⇒ 400＋逐字「请输入正确的 11 位手机号」；
 *  ④ `/register` 密码长度（5 位与 65 位）⇒ 400＋逐字「密码长度需在 6-64 位之间」，6 位边界放行；
 *  ⑤ `/register` 重复手机号 ⇒ 409，⛔ 500（唯一约束那条路必须被前置查询挡住，不能靠 SQLite 抛）；
 *  ⑥ `/register` 成功 ⇒ 出账五格齐＋`merged` 为 null（没攒过东西就不该编出个空对象）＋
 *     密码哈希绝不出现在响应里；
 *  ⑦ `/register` 带着 `X-Session-Id` 注册 ⇒ 游客名下 `user_wardrobe` 那行**过户到新账号**（跟 session 与
 *     跟 user 两格都改），旧 `users` 行被删掉＝不留僵尸身份；
 *  ⑧ `/login` 三种失败（密码错／号不存在／手机号传数组）⇒ 全部同一个 401 同一句文案，
 *     ⛔ 把"这号没注册过"与"密码不对"分成两种回法＝给爆破手当枚举 oracle；
 *  ⑨ `/login` 号不存在时**照样走一次 bcrypt**（`DUMMY_HASH` 那条防时序泄漏的机关）：
 *     这里数的是 `bcryptjs.compareSync` 的真实调用次数与它拿到的哈希，⛔ 比耗时（CI 噪声下耗时无意义）；
 *     11-04 变异探针实测：把 `acc ? acc.password_hash : DUMMY_HASH` 改成 `acc && acc.password_hash`
 *     （＝摘掉机关）后本文件当场红在这一条，且红在第一句——号不存在那档从 401 变 500
 *     （compareSync 拿到 undefined 直接抛）⇒ 这条同时钉住了机关本身与它保住的那个状态码。
 *  ⑩ `/login` 带游客身份登录 ⇒ `profile_tags` 里同 `tag_key` 那条冲突行被**丢弃**、账号那份留下，
 *     而 `dropped` 如实报数（`MERGE_BY_USER_UNIQUE` 那段的唯一约束分支，不并就被外键挡住删不掉游客行）；
 *  ⑪ `/admin/login` 空密码 ⇒ 400「请输入密码」；错密码／不存在的账号名 ⇒ 同一句 401；
 *  ⑫ `/admin/login` 的 `username` 传数字 ⇒ 401，⛔ 500（`String()` 兜底那行注释说的就是这件事）；
 *  ⑬ `/admin/login` 成功 ⇒ 拿到 token＋`last_login_at` 被写上；
 *  ⑭ `/admin/verify` 三种输入（没带 Authorization／带假 token／带真 token）⇒ 永远 200，只报 `valid` 真假
 *     （这条是后台前端每次开页都打的探针，500 会让整个后台看起来是坏了）；
 *  ⑮ `/admin/accounts` 无 token ⇒ 401；假 token ⇒ 401「Token 无效或已过期」；真 token ⇒ 200，
 *     `total` 是真 `COUNT(*)`、`limit` 是 500，行里**没有 password_hash**；
 *  ⑯ `/admin/reset-password` 手机号形状 ⇒ 400、短密码 ⇒ 400、没注册过的号 ⇒ 404（三种失败各自的状态码与文案）；
 *  ⑰ `/admin/reset-password` 成功 ⇒ 旧密码从此登不进去、新密码能登进去，且会员的 `users` 行
 *     session_id／nickname 一字未动（"只换密码，数据一行不动"这句承诺）；
 *  ⑱ 四条端点各挂**独立**的限流实例，且额度就是源码里那四个数（10/10/10/5）；
 *  ⑲ `/register` 连打 6 次：前 5 次 200、第 6 次 429＋逐字「注册过于频繁，请稍后再试」＋带 retry_after；
 *  ⑳ `/guest` 打满自己的桶（11 次）后 `/login` 照样回 401、`/admin/login` 照样回 200
 *     （过去共用一个 loginLimiter ⇒ 游客连点几下就把正式登录与后台登录的额度吃掉）。
 *
 * 另外两件事不在路由里但缺了它跑不起来，写在 `起步` 那条里一起钉：
 * 管理员 token 是 HMAC，`SECRET_KEY` 缺失时 `generateAdminToken` 直接抛 ⇒ 测试必须自带密钥；
 * `middleware/auth.js` 读的是 `process.env.ADMIN_USERNAME`（⛔ 不是 server.js 那个 `ADMIN_USER`），默认 'admin'。
 *
 * ⚠️ 这里只证接口这一层的形状与库里的落点，不证真人在浏览器里登录后台的体验——那一次另记。
 * 运行: node --test test/authRoutes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

// 管理员 token 是 HMAC，密钥缺失时 generateAdminToken 直接抛 ⇒ 这条链路必须先有密钥
process.env.SECRET_KEY = 'auth-routes-test-secret'

const bcrypt = require('bcryptjs')
const { verifyAdminToken, generateAdminToken } = require('../middleware/auth')
const express = require('express')
const authRoutes = require('../routes/auth')

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)

let server
let base = ''
let testToken = ''

async function call(method, route, { body, headers } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
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

const post = (route, body, headers) => call('POST', route, { body, headers })
const get = (route, headers) => call('GET', route, { headers })

/**
 * 从路由栈上捞出各端点挂的限流中间件。
 * 认它不用函数名、也不用库的内部结构：本仓工厂在返回的中间件上挂了 `rateLimitProfile`
 * （`middleware/rateLimit.js` 写明那是给 `scripts/gen-openapi.js` 与后台读的身份标记），
 * 拿它当身份比按名字找稳——库把中间件包成匿名函数，`layer.name` 一律是 "<anonymous>"。
 */
const limiters = new Map()
for (const layer of authRoutes.stack) {
  const routePath = layer.route && layer.route.path
  if (!routePath) continue
  const mw = layer.route.stack.map((s) => s.handle).find((h) => h && h.rateLimitProfile)
  if (mw) limiters.set(routePath, mw)
}

// 本文件的请求都出自 127.0.0.1；`req.ip` 的确切写法取决于 Node 把这跳连成 v6 还是 v4 映射地址，
// 所以把几种可能都清一遍——清不到的那格是空操作，不会误伤别的桶。
const CLIENT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']

async function resetBuckets() {
  for (const [routePath, mw] of limiters) {
    assert.strictEqual(
      typeof mw.resetKey,
      'function',
      `express-rate-limit 的 ${routePath} 中间件上没有 resetKey 这个方法了——` +
        `这条测试依赖它清客户端桶，请先确认库升级后再改这里，⛔ 别把路由里的 max 改大了事`,
    )
    for (const key of CLIENT_KEYS) await mw.resetKey(key)
  }
}

const countAccounts = () => memDb.prepare('SELECT COUNT(*) n FROM user_accounts').get().n
const usersRow = (id) => memDb.prepare('SELECT 1 x FROM users WHERE id = ?').get(id)
const nicknameOf = (sid) =>
  memDb.prepare('SELECT nickname FROM users WHERE session_id = ?').get(sid).nickname

/**
 * bcrypt 哈希的形状。⛔ 把前缀写死成 `$2a$10$`（bcryptjs 现在出厂的是 `$2b$`），两头都错：
 * 正向断言"库里这一格确实是哈希"会假红，负向断言"响应里不许出现哈希"会**假绿**——
 * 本文件第一版就被后者放过一次：拿一个库里根本不会出现的字符串去比，永远为真。
 * 所以认形状用这条正则，比具体内容一律从库里现取现比。
 */
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/

test('起步：实例起得来、库里除了 admin 一行会员都没有、SECRET_KEY 在场', async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
  memDb
    .prepare('INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, 1)')
    .run('admin', bcrypt.hashSync('Adm1n-Pass-123', 10))
  assert.strictEqual(countAccounts(), 0)
  // 没设 SECRET_KEY 时这里不是"返回 false"而是抛 ⇒ 这条把"测试自带密钥"这层前置钉住
  assert.ok(generateAdminToken('admin').length > 20)
})

test('① /guest 出账与库里那一行对得上', async () => {
  await resetBuckets()
  const r = await post('/api/auth/guest', { nickname: '小路' })
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.success, true)
  const sid = r.body.data.session_id
  assert.match(sid, /^[0-9a-f-]{36}$/i, `session_id 不是 UUID 形状：${sid}`)
  assert.strictEqual(typeof r.body.data.user_id, 'number')
  assert.ok(usersRow(r.body.data.user_id), '响应给了 user_id，库里却没有这一行')
  assert.strictEqual(nicknameOf(sid), '小路')
})

test('② /guest 的 nickname 按 asText 的口径落库，⛔ 500', async () => {
  await resetBuckets()
  // 对象/数组 ⇒ 落 null（原样绑进 SQLite 会 RangeError ⇒ 500，和 10-13 那批 500 是同一种形状）
  for (const bad of [{ a: 1 }, ['上', '下']]) {
    const r = await post('/api/auth/guest', { nickname: bad })
    assert.strictEqual(r.status, 200, `nickname=${JSON.stringify(bad)} 时状态码漂了：${r.status}`)
    assert.strictEqual(
      nicknameOf(r.body.data.session_id),
      null,
      `${JSON.stringify(bad)} 没被兜成 null`,
    )
  }
  // 数字/布尔 ⇒ asText 认它们是文本，落的是字符串形式。这条把口径写死：将来改 asText 得一起想清楚
  for (const [v, want] of [
    [12, '12'],
    [true, 'true'],
  ]) {
    const r = await post('/api/auth/guest', { nickname: v })
    assert.strictEqual(
      nicknameOf(r.body.data.session_id),
      want,
      `nickname=${JSON.stringify(v)} 该落成 ${want}`,
    )
  }
  // 超长 ⇒ 截到 40（昵称是客户端随便写的，列不给它留无限长）
  const long = await post('/api/auth/guest', { nickname: 'x'.repeat(90) })
  assert.strictEqual(nicknameOf(long.body.data.session_id).length, 40)
})

test('③ /register 的手机号形状四档全给 400，文案逐字', async () => {
  await resetBuckets()
  for (const bad of [
    {},
    { phone: '1380013800' },
    { phone: '23800138000' },
    { phone: ['1', '2'] },
  ]) {
    const r = await post('/api/auth/register', { ...bad, password: 'abcdef' })
    assert.strictEqual(r.status, 400, `入参 ${JSON.stringify(bad)} 回了 ${r.status}`)
    assert.strictEqual(r.body.error.message, '请输入正确的 11 位手机号')
  }
})

test('④ /register 的密码长度：5 与 65 挡下、6 放行（边界就是那两个字面数）', async () => {
  await resetBuckets()
  const tooShort = await post('/api/auth/register', { phone: '13800138001', password: 'abcde' })
  assert.strictEqual(tooShort.status, 400)
  assert.strictEqual(tooShort.body.error.message, '密码长度需在 6-64 位之间')
  const tooLong = await post('/api/auth/register', {
    phone: '13800138001',
    password: 'x'.repeat(65),
  })
  assert.strictEqual(tooLong.status, 400)
  const ok6 = await post('/api/auth/register', { phone: '13800138001', password: 'abcdef' })
  assert.strictEqual(ok6.status, 200, `6 位密码被挡了：${JSON.stringify(ok6.body)}`)
})

test('⑤⑥ 重复手机号给 409；成功那次的出账里没有密码哈希、merged 是 null', async () => {
  await resetBuckets()
  const dup = await post('/api/auth/register', { phone: '13800138001', password: 'zzzzzz' })
  assert.strictEqual(dup.status, 409, `重复注册回了 ${dup.status}，⛔ 不能靠 SQLite 唯一约束抛 500`)
  assert.strictEqual(dup.body.error.message, '该手机号已注册，请直接登录')

  const guestSid = (await post('/api/auth/guest', { nickname: '过户前' })).body.data.session_id
  const fresh = await post(
    '/api/auth/register',
    { phone: '13800138002', password: 'abcdef', nickname: '  张三  ' },
    { 'x-session-id': guestSid },
  )
  assert.strictEqual(fresh.status, 200)
  const d = fresh.body.data
  assert.deepStrictEqual(
    Object.keys(d).sort(),
    ['merged', 'nickname', 'phone', 'session_id', 'user_id'],
    '出账形状变了',
  )
  assert.strictEqual(d.nickname, '张三', '昵称没剥首尾空格')
  assert.strictEqual(d.merged, null, '库里没东西可并就该报 null，不该编个空对象')
  // 哈希绝不出账：拿库里那一格的**真值**去比对，⛔ 拿一个写死的前缀去 includes（那样永远查不到）
  const freshHash = memDb
    .prepare('SELECT password_hash h FROM user_accounts WHERE phone = ?')
    .get('13800138002').h
  assert.ok(BCRYPT_RE.test(freshHash), `注册写进库的不是 bcrypt 哈希：${freshHash}`)
  assert.ok(!JSON.stringify(fresh.body).includes(freshHash), '响应里漏出了这一格的密码哈希')
})

test('⑦ 注册那一刻把游客名下的衣橱行过户到新账号，僵尸身份行删掉', async () => {
  await resetBuckets()
  const g = await post('/api/auth/guest', { nickname: '攒了一衣柜' })
  const guestSid = g.body.data.session_id
  const guestId = g.body.data.user_id
  memDb
    .prepare('INSERT INTO user_wardrobe (session_id, user_id, name, category) VALUES (?, ?, ?, ?)')
    .run(guestSid, guestId, '白衬衫', '上衣')

  const r = await post(
    '/api/auth/register',
    { phone: '13800138003', password: 'abcdef' },
    { 'x-session-id': guestSid },
  )
  assert.strictEqual(r.status, 200)
  const newId = r.body.data.user_id
  const newSid = r.body.data.session_id

  assert.strictEqual(r.body.data.merged.moved.user_wardrobe, 1, '过户没动 user_wardrobe')
  const w = memDb.prepare('SELECT * FROM user_wardrobe WHERE name = ?').get('白衬衫')
  assert.strictEqual(w.user_id, newId, '行还挂在游客身份下')
  assert.strictEqual(
    w.session_id,
    newSid,
    '行的 session_id 没跟着换 ⇒ 前端按 X-Session-Id 查就查不到它',
  )
  assert.ok(!usersRow(guestId), '游客那条 users 行没删掉 ⇒ 库里留了个僵尸身份')
})

test('⑧⑨ 登录三种失败同一句 401，号不存在时照样真比一次 bcrypt', async () => {
  await resetBuckets()
  const storedHash = memDb
    .prepare('SELECT password_hash h FROM user_accounts WHERE phone = ?')
    .get('13800138001').h
  assert.ok(BCRYPT_RE.test(storedHash), `库里这一格不是 bcrypt 哈希：${storedHash}`)

  const wrongPw = await post('/api/auth/login', { phone: '13800138001', password: 'nope-nope' })
  const unknown = await post('/api/auth/login', { phone: '13900139009', password: 'abcdef' })
  const asArray = await post('/api/auth/login', { phone: ['138', '0013'], password: 'abcdef' })
  for (const r of [wrongPw, unknown, asArray]) {
    assert.strictEqual(r.status, 401, `失败档没归一到 401：${r.status}`)
    assert.strictEqual(r.body.error.message, '手机号或密码错误')
  }

  // DUMMY_HASH 那条机关：号不存在时也必须真比对一次，否则"响应快一倍"就成了
  // "这号注册过吗"的免费 oracle。耗时在 CI 上量不出来，所以这里数调用次数与它拿到的哈希。
  const realCompare = bcrypt.compareSync
  const seen = []
  bcrypt.compareSync = (pw, hash) => {
    seen.push({ pw, hash })
    return realCompare(pw, hash)
  }
  try {
    await post('/api/auth/login', { phone: '13900139009', password: 'abcdef' })
    await post('/api/auth/login', { phone: '13800138001', password: 'nope-nope' })
  } finally {
    bcrypt.compareSync = realCompare
  }
  assert.strictEqual(seen.length, 2, `两次登录只发生 ${seen.length} 次比较，另一格被短路了`)
  assert.ok(BCRYPT_RE.test(seen[0].hash), '号不存在时连个像样的占位哈希都没拿到')
  assert.notStrictEqual(seen[0].hash, storedHash, '号不存在时把占位哈希换成了真哈希 ⇒ 白跑一次查库')
  assert.strictEqual(seen[1].hash, storedHash, '号存在时该拿库里那一格的哈希来比')
})

test('⑩ 登录时 profile_tags 撞唯一键：丢游客那条、留账号那条，dropped 如实报数', async () => {
  await resetBuckets()
  const acc = memDb
    .prepare('SELECT user_id id FROM user_accounts WHERE phone = ?')
    .get('13800138001')
  memDb
    .prepare('INSERT INTO profile_tags (user_id, tag_key, tag_value) VALUES (?, ?, ?)')
    .run(acc.id, 'color_season', '夏季型')

  const g = await post('/api/auth/guest', {})
  const guestSid = g.body.data.session_id
  const guestId = g.body.data.user_id
  memDb
    .prepare('INSERT INTO profile_tags (user_id, tag_key, tag_value) VALUES (?, ?, ?)')
    .run(guestId, 'color_season', '春季型')
  memDb
    .prepare('INSERT INTO profile_tags (user_id, tag_key, tag_value) VALUES (?, ?, ?)')
    .run(guestId, 'bmi_level', '正常')

  const r = await post(
    '/api/auth/login',
    { phone: '13800138001', password: 'abcdef' },
    { 'x-session-id': guestSid },
  )
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  const m = r.body.data.merged
  assert.strictEqual(m.dropped, 1, `同键冲突该丢 1 条，实报 ${m.dropped}`)
  assert.strictEqual(m.moved.profile_tags, 1, '另一条不冲突的标签该并过来')

  const rows = memDb
    .prepare('SELECT tag_key, tag_value FROM profile_tags WHERE user_id = ? ORDER BY tag_key')
    .all(acc.id)
  assert.deepStrictEqual(
    rows,
    [
      { tag_key: 'bmi_level', tag_value: '正常' },
      { tag_key: 'color_season', tag_value: '夏季型' },
    ],
    '账号原有那条被游客那条覆盖了 ⇒ 唯一约束分支写反了（口径：账号这份优先）',
  )
  assert.ok(!usersRow(guestId), '并完之后游客行没删干净')
})

test('⑪⑫ 管理员登录：空密码 400、错密码与不存在的号同一句 401、数字用户名不炸 500', async () => {
  await resetBuckets()
  const empty = await post('/api/auth/admin/login', { password: '' })
  assert.strictEqual(empty.status, 400)
  assert.strictEqual(empty.body.error.message, '请输入密码')

  const wrong = await post('/api/auth/admin/login', { password: 'nope-nope-nope' })
  const ghost = await post('/api/auth/admin/login', {
    username: 'nobody',
    password: 'Adm1n-Pass-123',
  })
  const numeric = await post('/api/auth/admin/login', { username: 123, password: 'Adm1n-Pass-123' })
  for (const r of [wrong, ghost, numeric]) {
    assert.strictEqual(r.status, 401, `状态码漂了：${r.status} ⇒ ${JSON.stringify(r.body)}`)
    assert.strictEqual(r.body.error.message, '账号或密码错误')
  }
})

test('⑬ 管理员登录成功：拿到 token，last_login_at 被写上', async () => {
  await resetBuckets()
  const r = await post('/api/auth/admin/login', { password: 'Adm1n-Pass-123' })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  testToken = r.body.data.token
  assert.ok(typeof testToken === 'string' && testToken.length > 20)
  const row = memDb
    .prepare('SELECT last_login_at t FROM admin_users WHERE username = ?')
    .get('admin')
  assert.ok(row.t, '登录成功却没记 last_login_at')
})

test('⑭ /admin/verify 三种输入都回 200，只在 valid 里说真假', async () => {
  const bare = await get('/api/auth/admin/verify')
  assert.strictEqual(bare.status, 200)
  assert.strictEqual(bare.body.data.valid, false, '没带 Authorization 时该报 false，⛔ 401')

  const fake = await get('/api/auth/admin/verify', { authorization: 'Bearer ZZzz-not-a-token' })
  assert.strictEqual(fake.status, 200)
  assert.strictEqual(fake.body.data.valid, false)

  assert.ok(testToken, '上一条 test 没把 token 传下来')
  const real = await get('/api/auth/admin/verify', { authorization: `Bearer ${testToken}` })
  assert.strictEqual(real.status, 200)
  assert.strictEqual(real.body.data.valid, true)
})

test('⑮ /admin/accounts：守卫先挡 401，真 token 才出账，且绝不出 password_hash', async () => {
  const noHeader = await get('/api/auth/admin/accounts')
  assert.strictEqual(noHeader.status, 401)
  assert.strictEqual(noHeader.body.error.message, '未授权，请提供管理员 Token')

  const badToken = await get('/api/auth/admin/accounts', { authorization: 'Bearer nope.nope.nope' })
  assert.strictEqual(badToken.status, 401)
  assert.strictEqual(badToken.body.error.message, 'Token 无效或已过期')

  const ok = await get('/api/auth/admin/accounts', { authorization: `Bearer ${testToken}` })
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body))
  const d = ok.body.data
  assert.strictEqual(d.limit, 500)
  assert.strictEqual(
    d.total,
    countAccounts(),
    'total 又变成截过的那份行数了（真 COUNT(*) 与列表上限必须分开报）',
  )
  assert.strictEqual(d.accounts.length, d.total)
  assert.ok(
    !JSON.stringify(ok.body).includes('password_hash'),
    '出账里出现了 password_hash 这个键名',
  )
  assert.deepStrictEqual(
    Object.keys(d.accounts[0]).sort(),
    ['created_at', 'nickname', 'phone', 'user_id'],
    '会员列表的出账形状变了',
  )
})

test('⑯⑰ 重置密码：三种失败各自归位，成功后旧密码登不进去而会员数据一行没动', async () => {
  await resetBuckets()
  const hdr = { authorization: `Bearer ${testToken}` }
  const badPhone = await post(
    '/api/auth/admin/reset-password',
    { phone: '138', new_password: 'abcdef' },
    hdr,
  )
  assert.strictEqual(badPhone.status, 400)
  assert.strictEqual(badPhone.body.error.message, '请输入正确的 11 位手机号')

  const shortPw = await post(
    '/api/auth/admin/reset-password',
    { phone: '13800138001', new_password: 'abcde' },
    hdr,
  )
  assert.strictEqual(shortPw.status, 400)
  assert.strictEqual(shortPw.body.error.message, '新密码长度需在 6-64 位之间')

  const ghost = await post(
    '/api/auth/admin/reset-password',
    { phone: '13700137000', new_password: 'abcdef' },
    hdr,
  )
  assert.strictEqual(ghost.status, 404, `没注册过的号该 404，实回 ${ghost.status}`)

  const read = () =>
    memDb
      .prepare(
        `SELECT u.session_id s, u.nickname n
         FROM user_accounts a JOIN users u ON u.id = a.user_id WHERE a.phone = ?`,
      )
      .get('13800138001')
  const before = read()
  const done = await post(
    '/api/auth/admin/reset-password',
    { phone: '13800138001', new_password: 'brand-new-pw' },
    hdr,
  )
  assert.strictEqual(done.status, 200, JSON.stringify(done.body))
  assert.strictEqual(done.body.data.phone, '13800138001')
  assert.deepStrictEqual(read(), before, '"只换密码、会员数据不动"这句承诺被破了')

  const oldPw = await post('/api/auth/login', { phone: '13800138001', password: 'abcdef' })
  assert.strictEqual(oldPw.status, 401, '旧密码还能登录 ⇒ 哈希没被换掉')
  const newPw = await post('/api/auth/login', { phone: '13800138001', password: 'brand-new-pw' })
  assert.strictEqual(newPw.status, 200, JSON.stringify(newPw.body))
})

test('⑱ 四条端点各挂独立的限流实例，额度就是源码里那四个数', () => {
  assert.deepStrictEqual(
    [...limiters.keys()].sort(),
    ['/admin/login', '/guest', '/login', '/register'],
    `从路由栈捞到的限流实例不对：${JSON.stringify([...limiters.keys()])}`,
  )
  const limits = Object.fromEntries(
    [...limiters].map(([routePath, mw]) => [routePath, mw.rateLimitProfile.limit]),
  )
  assert.deepStrictEqual(limits, {
    '/guest': 10,
    '/login': 10,
    '/admin/login': 10,
    '/register': 5,
  })
  // 共用一个实例时这里只会数出 1
  assert.strictEqual(new Set([...limiters.values()]).size, 4, '四个端点共用了同一个限流实例')
})

test('⑲ /register 连打 6 次：前 5 次放行、第 6 次撞自己的桶，文案是注册那句', async () => {
  await resetBuckets()
  const statuses = []
  for (let i = 1; i <= 6; i++) {
    const r = await post('/api/auth/register', {
      phone: `138001380${20 + i}`,
      password: 'abcdef',
    })
    statuses.push(r.status)
    if (i === 6) {
      assert.strictEqual(r.status, 429, `第 6 次注册没被挡住：${JSON.stringify(statuses)}`)
      assert.strictEqual(r.body.error.message, '注册过于频繁，请稍后再试')
      assert.strictEqual(r.body.error.code, 'RATE_LIMITED')
      assert.ok(Number.isInteger(r.body.retry_after), '429 没带 retry_after 秒数')
    }
  }
  assert.deepStrictEqual(
    statuses.slice(0, 5),
    [200, 200, 200, 200, 200],
    `前 5 次该放行：${statuses}`,
  )
})

test('⑳ /guest 打满自己的桶不影响 /login 与 /admin/login：桶与桶不互相顶包', async () => {
  await resetBuckets()
  let last = null
  for (let i = 0; i < 11; i++) last = await post('/api/auth/guest', {})
  assert.strictEqual(last.status, 429, `第 11 次游客登录没被自己的桶挡住：${last.status}`)
  assert.strictEqual(last.body.error.message, '登录尝试过于频繁，请稍后再试')

  const login = await post('/api/auth/login', { phone: '13800138001', password: 'nope-nope' })
  assert.strictEqual(login.status, 401, `/guest 吃掉了 /login 的额度：${login.status}`)

  const admin = await post('/api/auth/admin/login', { password: 'Adm1n-Pass-123' })
  assert.strictEqual(admin.status, 200, `/guest 吃掉了 /admin/login 的额度：${admin.status}`)
})

test('收尾：token 过了 HMAC 校验才算真验过签名；禁用账号后旧 token 当场失效', async () => {
  assert.strictEqual(verifyAdminToken(testToken), true)
  memDb.prepare("UPDATE admin_users SET is_active = 0 WHERE username = 'admin'").run()
  assert.strictEqual(verifyAdminToken(testToken), false, '禁用管理员后旧 token 仍可用')
  memDb.prepare("UPDATE admin_users SET is_active = 1 WHERE username = 'admin'").run()
  await new Promise((resolve) => server.close(resolve))
})
