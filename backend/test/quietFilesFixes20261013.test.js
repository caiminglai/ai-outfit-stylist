/**
 * 2026-10-13 深夜轮（第四批：本轮唯一没被前几批碰过的安静文件）行为测试
 * ============================================================
 * 覆盖六处改动。每处都先复现"改之前会错成什么样"再断言改后的行为。
 * 这 6 个文件都按 mtime 现量确认 ≥3 小时没有别的会话在写，才动的。
 * 负向证据：把这 7 个源文件（含 db/init.js）换成 HEAD 的改前版本、在仓库外的副本里跑这 13 条，
 * 6 红 7 绿。红里那两条支付用例不是断言失败，是 5 秒超时到点 —— 改前那个 fetch 压根不 settle，
 * 这正是这条要修的东西本身。绿的 7 条全是"照旧/仍"型守卫。
 *
 *   1. middleware/upload.js —— 扩展名与 magic bytes 各查各的：一张 JPEG 改名 .png
 *                              两道都过，而五条上传线（photos/clothing/tryon/creator/payment）
 *                              落盘文件名用的就是 path.extname(originalname)
 *   2. utils/response.js —— `status >= 500` 一把抓：天气那条线分出的 502（上游数据不完整）
 *                              /503（上游连不上）全被打成 INTERNAL_ERROR，前端把 code 括在
 *                              文案后面，顾客看到"服务器内部错误"，其实是外部依赖没响应
 *   3. utils/logger.js —— JSON.stringify 在 writeToFile 的 try/catch 之外：BigInt 与
 *                              自引用对象同步抛 ⇒ 请求里 log() 一个这种值就把 handler 炸成 500
 *   4. middleware/auth.js —— 长度不等的签名靠 timingSafeEqual 抛 RangeError、再由最外层
 *                              catch 折成 false：结论对，但"拒绝"是异常兜出来的
 *   5. services/wechatPay.js + services/alipay.js —— 出网 fetch 没有 signal：
 *                              对端握手成功不回时 promise 永远不 settle，routes/payment.js 的
 *                              catch 等不到 reject ⇒ 下单请求一直挂着（天气线早就有 10 秒 timeout）
 *   6. db/init.js —— ICON_MAP[source] 顺原型链查表（source 是目录名切出来的一截）
 *
 * 库走 db/init 的内存替身；文件系统与控制台在本文件里全程被替身接管，
 * 测试不会往 backend/logs 写一行，也不会 unlink 任何一个真日志文件。
 *
 * 运行: node --test test/quietFilesFixes20261013.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const Database = require('better-sqlite3')

// ── 内存库替身（与 db/schema.sql 同源），支付/鉴权线 require db/init 时拿到的就是它 ──
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
memDb.pragma('foreign_keys = ON')
const dbInitPath = require.resolve('../db/init')
require.cache[dbInitPath] = {
  id: dbInitPath,
  filename: dbInitPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

// ============================================================
// 一、上传：扩展名必须和文件头是同一种格式
// ============================================================

const { validateImage } = require('../middleware/upload')
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(16, 3),
])
const f = (name, buf) => ({ originalname: name, mimetype: 'image/png', buffer: buf })

test('upload：内容与扩展名一致时照旧放行（jpg/jpeg/png/webp 四种写法）', () => {
  assert.equal(validateImage(f('a.png', PNG)).valid, true)
  assert.equal(validateImage(f('a.jpg', JPG)).valid, true)
  // 'jpeg' 与 'jpg' 是同一种格式的两个写法，不许被当成"对不上"误拒
  assert.equal(validateImage(f('a.jpeg', JPG)).valid, true)
  assert.equal(validateImage(f('a.webp', WEBP)).valid, true)
})

test('upload：JPEG 改名 .png 不再两道都过（改前 valid=true，落盘就是个 Content-Type 说谎的文件）', () => {
  const r = validateImage(f('a.png', JPG))
  assert.equal(r.valid, false, `改前这里返回 true：${JSON.stringify(r)}`)
  assert.match(r.error || '', /扩展名不符/)
  // 反方向同样拒：PNG 的内容写 .webp 的名字
  const r2 = validateImage(f('a.webp', PNG))
  assert.equal(r2.valid, false)
})

test('upload：未知扩展名与未知文件头各自的旧判据没被改坏', () => {
  assert.equal(validateImage(f('a.gif', PNG)).valid, false) // 扩展名白名单仍然先判
  assert.equal(validateImage(f('a.png', Buffer.alloc(12, 0))).valid, false) // 内容不是图片
  assert.equal(validateImage(null).valid, false)
  assert.equal(validateImage({ originalname: 'a.png' }).error, '无法读取文件内容')
})

// ============================================================
// 二、sendError：502/503/504 不再一律写成"我们坏了"
// ============================================================

const { sendError, sendSuccess } = require('../utils/response')

const capture = (status, code) => {
  let body = null
  const res = {
    status(s) {
      assert.equal(s, status, '状态码必须原样透出去，不许被降档')
      return this
    },
    json(b) {
      body = b
      return this
    },
  }
  sendError(res, '消息', status, code)
  return body
}

test('响应：502/503/504 的 code 说的是真故障方，500 仍然是 INTERNAL_ERROR', () => {
  assert.equal(capture(502).error.code, 'BAD_GATEWAY')
  assert.equal(capture(503).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(capture(504).error.code, 'GATEWAY_TIMEOUT')
  assert.equal(capture(500).error.code, 'INTERNAL_ERROR')
  // 429/413 这类没人替它编档位：413 落通用 ERROR，改前也是，别顺手改出口
  assert.equal(capture(429).error.code, 'RATE_LIMITED')
  assert.equal(capture(404).error.code, 'NOT_FOUND')
})

test('响应：调用方明确给的 code 永远优先于状态码推断', () => {
  assert.equal(capture(503, 'PAY_CHANNEL_CLOSED').error.code, 'PAY_CHANNEL_CLOSED')
  assert.equal(capture(502).error.message, '消息', 'message 仍是服务层给的那句原话')
})

test('响应：sendSuccess 的成功形状没被动到（前端 api.ts 读 success/data）', () => {
  let body = null
  const res = {
    status(s) {
      assert.equal(s, 200)
      return this
    },
    json(b) {
      body = b
      return this
    },
  }
  sendSuccess(res, { a: 1 }, 'ok')
  assert.deepEqual(body, { success: true, data: { a: 1 }, message: 'ok' })
})

// ============================================================
// 三、logger：一个序列化不了的日志值不许把请求炸成 500
// ============================================================

test('日志：BigInt / 自引用对象不再在请求路径里抛（且不落盘、不删真日志）', () => {
  const real = {
    append: fs.appendFileSync,
    unlink: fs.unlinkSync,
    readdir: fs.readdirSync,
    stat: fs.statSync,
    // 换掉 console 是为了拦住 logger 往 stdout 打的那几行——TAP 从第 0 列读 `ok`/`not ok`，
    // 测试中途冒出「探针 …」会污染解析。桩本身要读回原函数，所以下面 159-160 存真身、196-197 还原。
    // no-console 豁免：11-03 起 eslint.config.js 对 test/** 整目录关掉这条，这里不用再就地 disable
    log: console.log,
    error: console.error,
  }
  const written = []
  const wouldDelete = []
  try {
    fs.appendFileSync = (p, line) => written.push(String(line))
    fs.unlinkSync = (p) => wouldDelete.push(String(p))
    // 造一份"有 8 天前旧日志"的目录，验清理逻辑照跑，但删除动作被替身吃掉
    fs.readdirSync = () => ['server-2020-01-01.log', 'server-2026-10-13.log']
    fs.statSync = (p) => ({
      mtime: { getTime: () => (String(p).includes('2020') ? 0 : Date.now()) },
    })
    // no-console 豁免：11-03 起 eslint.config.js 对 test/** 整目录关掉这条，这里不用再就地 disable
    console.log = () => {}
    console.error = () => {}

    const logger = require('../utils/logger')
    const circ = {}
    circ.self = circ
    assert.doesNotThrow(() => logger.log('探针', { n: 10n }, circ))
    assert.doesNotThrow(() => logger.error('探针', { n: 10n }, circ, new Error('boom')))

    assert.equal(written.length, 2, '两次都该写文件')
    assert.match(written[0], /探针 \[object Object\] \[object Object\]/)
    assert.match(written[1], /\[ERROR\]/)
    assert.equal(wouldDelete.length, 1, '清理逻辑该认出那份 2020 的旧日志')
    assert.ok(wouldDelete[0].includes('server-2020-01-01.log'))
    assert.ok(!written.some((l) => l.includes('Do not JSON.stringify')))
  } finally {
    Object.assign(fs, {
      appendFileSync: real.append,
      unlinkSync: real.unlink,
      readdirSync: real.readdir,
      statSync: real.stat,
    })
    // no-console 豁免：11-03 起 eslint.config.js 对 test/** 整目录关掉这条，这里不用再就地 disable
    console.log = real.log
    console.error = real.error
  }
})

// ============================================================
// 四、admin token：长度不等的签名不再靠异常兜成 false
// ============================================================

process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret-for-quiet-batch'
const { generateAdminToken, verifyAdminToken } = require('../middleware/auth')

function tokenWithSignature(sig) {
  return Buffer.from(`admin:${Math.floor(Date.now() / 1000)}:${sig}`).toString('base64url')
}

test('鉴权：签名长度对不上时直接拒，不再让 timingSafeEqual 抛出去由大 catch 折', () => {
  const realEqual = crypto.timingSafeEqual
  const calls = []
  try {
    crypto.timingSafeEqual = (a, b) => {
      calls.push([a.length, b.length])
      return realEqual(a, b) // 长度不等时这一句就是抛 RangeError 的那条路
    }
    assert.equal(verifyAdminToken(tokenWithSignature('deadbeef')), false)
    assert.equal(calls.length, 0, `改前这里会带着一对不等长度被调用：${JSON.stringify(calls)}`)
  } finally {
    crypto.timingSafeEqual = realEqual
  }
})

test('鉴权：真签出的 token 仍然验得过，改签名字节仍然是拒（守卫两侧都要绿）', () => {
  memDb
    .prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)')
    .run('admin-quiet', 'x')
  assert.equal(verifyAdminToken(generateAdminToken('admin-quiet')), true)
  const t = generateAdminToken('admin-quiet')
  const raw = Buffer.from(t, 'base64url').toString('utf-8')
  const [user, ts, sig] = raw.split(':')
  // 改末位必须改成"另一个字符"：原来写 sig.replace(/.$/,'0')，签名末位本来就是 '0' 时
  // 改完等于没改（1/16 的概率），用例就成了时灵时不灵——10-13 合跑 57 条时就这样翻红过一次
  const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a')
  assert.notEqual(tampered, sig, '改位后必须真的不同')
  assert.equal(
    verifyAdminToken(Buffer.from(`${user}:${ts}:${tampered}`).toString('base64url')),
    false,
  )
  // 用户名里带冒号仍然是合法形状（历史 bug：parts.length!==3 直接拒）
  assert.equal(verifyAdminToken(generateAdminToken('a:b:c')), false) // 没有这个账号 ⇒ 拒，但不是被段数拒
})

// ============================================================
// 五、支付出网请求必须带 timeout
// ============================================================

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site3-pay-'))
const { privateKeyPem, publicKeyPem } = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  }
})()
const KEY_PATH = path.join(tmp, 'priv.pem')
const PUB_PATH = path.join(tmp, 'pub.pem')
fs.writeFileSync(KEY_PATH, privateKeyPem)
fs.writeFileSync(PUB_PATH, publicKeyPem)

Object.assign(process.env, {
  WXPAY_APPID: 'wx-appid',
  WXPAY_MCHID: '1900000109',
  WXPAY_SERIAL_NO: 'serial-1',
  WXPAY_APIV3_KEY: '01234567890123456789012345678901',
  WXPAY_PRIVATE_KEY_PATH: KEY_PATH,
  WXPAY_PUBLIC_KEY_PATH: PUB_PATH,
  WXPAY_PUBLIC_KEY_ID: 'PUBKEY_ID1',
  WXPAY_NOTIFY_URL: 'https://example.com/api/payment/notify-wx',
  ALIPAY_APP_ID: '2021000000000000',
  ALIPAY_PRIVATE_KEY_PATH: KEY_PATH,
  ALIPAY_PUBLIC_KEY_PATH: PUB_PATH,
  ALIPAY_NOTIFY_URL: 'https://example.com/api/payment/notify-ali',
})

const wxpay = require('../services/wechatPay')
const alipay = require('../services/alipay')

/** 用假 fetch 抓住 init：对端"连上了但永不回话"时，没有 signal 就永远不会 settle */
async function spyFetch(fn) {
  const realFetch = globalThis.fetch
  const realTimeout = AbortSignal.timeout
  const captured = { init: null, timeoutMs: [] }
  globalThis.fetch = (url, init) => {
    captured.init = init
    // 模拟挂死的上游：立刻把 signal 记下来，然后返回一个永不 resolve 的 promise；
    // timeout 一旦被 AbortSignal 触发，就把它转成 reject，好让调用方的 catch 走真路径
    return new Promise((resolve, reject) => {
      const sig = init && init.signal
      if (sig) sig.addEventListener('abort', () => reject(new Error('aborted-by-timeout')))
    })
  }
  AbortSignal.timeout = (ms) => {
    captured.timeoutMs.push(ms)
    return realTimeout.call(AbortSignal, 0) // 立即 aborted，测试不真等 10 秒
  }
  try {
    await fn()
    captured.result = 'resolved'
  } catch (e) {
    captured.result = e.message
  } finally {
    globalThis.fetch = realFetch
    AbortSignal.timeout = realTimeout
  }
  return captured
}

test('微信下单：fetch 带上 signal，挂死的上游变 502 而不是永远不回话', async () => {
  const c = await spyFetch(() =>
    wxpay.nativeOrder({ outTradeNo: 'S3TEST', amountFen: 2990, description: '测试' }),
  )
  assert.ok(c.init && c.init.signal instanceof AbortSignal, '没传 signal ⇒ 上游挂死就永远等')
  assert.deepEqual(c.timeoutMs, [10000], '档位必须是 10 秒')
  assert.equal(c.result, 'aborted-by-timeout')
})

test('支付宝查单：同一把尺子（10 秒 signal），改前是永不 settle', async () => {
  const c = await spyFetch(() => alipay.queryOrderByOutTradeNo('A3TEST'))
  assert.ok(c.init && c.init.signal instanceof AbortSignal)
  assert.deepEqual(c.timeoutMs, [10000])
})

test('支付：两条线的配置齐备性判定没被改坏（缺任一必需项就是未配置）', () => {
  assert.equal(wxpay.isConfigured(), true)
  assert.equal(alipay.isConfigured(), true)
  const saved = process.env.WXPAY_MCHID
  process.env.WXPAY_MCHID = ''
  assert.deepEqual(wxpay.missingConfig(), ['WXPAY_MCHID'])
  assert.equal(wxpay.isConfigured(), false)
  process.env.WXPAY_MCHID = saved
})

// ============================================================
// 六、金额仍然按整数分走（这条是"别改坏"守卫，不是新行为）
// ============================================================

test('金额：元→分用 round，99.9 这类浮点不会掉成 9989', () => {
  assert.equal(wxpay.yuanToFen(99.9), 9990)
  assert.equal(wxpay.yuanToFen(0.1), 10)
  assert.equal(alipay.yuanToFen(99.9), 9990)
  assert.equal(alipay.fenToYuan(9990), '99.90')
})

// 收尾：删掉我自己造的临时钥匙目录（不碰仓库里任何文件）。
// 必须挂在 after 上——node:test 是先把整个文件求值完再跑用例，写在文件末尾会先于用例执行，
// 钥匙目录被提前删掉的话 isConfigured() 直接假、fetch 也根本发不出去（10-13 实测踩过）。
const { after } = require('node:test')
after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 留给系统临时目录自己清 */
  }
})
