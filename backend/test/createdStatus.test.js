/**
 * 创建口状态码与 Location 的端到端测试（2026-11-02 规范轮·第二批 REST 的第一件）
 * ============================================================
 * 这一轮把 15 个「POST 真建了一条记录」的口从 200 改成 201（RFC 9110 §15.5.3），
 * 并把新资源可回读的那条路径放进 Location。改之前全仓 0 处 201，客户端只看状态码
 * 分不出"建好了"和"查了一下啥也没建"。
 *
 * 为什么单独起真端口、不用 test 里常见的假 res 双重：Location 是**响应头**，
 * 只有走完 express 的 res 才看得见。薄 mock 要么没 setHeader（一调就假 500），
 * 要么 setHeader 是空函数（存不下，读不到）。所以这里必须真发 HTTP。
 *
 * 钉四件事：
 *  ① 建记录的 POST 回 201；
 *  ② 有按 id 读回的 GET 的那些，Location 指的就是那条 GET，且照它真能 200 读回同一个 id
 *     —— 这是 Location 唯一的存在理由，指不到地方的 Location 比不给更糟；
 *  ③ 没有按 id GET 的（衣橱搭配日记/心愿单、库存两条、照片、衣服）不给 Location，但仍是 201；
 *     创作者作品也落这一档，但原因不一样——它**有** GET /works/:id，只是新建的那条 status='pending'，
 *     公开读口只放审核过的作品，照 Location 去读实测 404。这一条是本轮测出来的，不是先验的；
 *  ④ 信封一字没动：还是 { success: true, data }，原来 sendSuccess 第三参那句人话
 *     仍然在 body.message（前端 api.ts 的 unwrap 就是读这个）。
 *
 * 没覆盖到的三处以及原因：payment /order 与 /alipay/order 要出门连微信/支付宝网关；
 * clothing /upload 与 photos / 是 multipart，需要真图片字节，那两条的 201 已经钉在
 * test/engineFixes20261013.test.js（handler 级）里。这里不重复造轮子。
 *
 * 活库隔离：db/init 用内存库替身顶掉（与 test/wardrobeDiaryRoutes.test.js 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。不过 server.js 的全局闸，只挂各 router。
 * 运行: node --test test/createdStatus.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const express = require('express')
// 管理员 Token 走 SECRET_KEY 签名，没它 generateAdminToken 直接抛（与 quietFilesFixes 同一口径）
process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret-for-created-201'
const { generateAdminToken } = require('../middleware/auth')

const SESS = 'sess-created-201'
// 签名对只证明"持密钥方签过"，不证明账号还在：verifyAdminToken 还要 admin_users 里有这条
// 活着的行，所以这里既要造行、又要用同一个 username 去签（现量 auth.js:173 那句 SELECT）
memDb
  .prepare('INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, 1)')
  .run('created-201-tester', 'not-a-real-hash')
const ADMIN = `Bearer ${generateAdminToken('created-201-tester')}`

let server
let base = ''

test.before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/wardrobe', require('../routes/wardrobe'))
  app.use('/api/accessory', require('../routes/accessory'))
  app.use('/api/cosmetic', require('../routes/cosmetic'))
  app.use('/api/creator', require('../routes/creator'))
  app.use('/api/customer', require('../routes/customer'))
  app.use('/api/rules', require('../routes/rules'))
  app.use('/api/inventory', require('../routes/inventory'))
  await new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(() => {
  if (server) server.close()
})

/** 发一条 POST/GET，回 { status, body, location }；location 直接取响应头，不靠业务体猜 */
async function send(method, url, body, opt = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${base}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opt.session === null ? {} : { 'x-session-id': opt.session || SESS }),
      ...(opt.admin ? { authorization: ADMIN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 非 JSON 时保留原文，断言里能看见到底回了什么 */
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed, location: res.headers.get('location') }
}

// 衣橱/化妆柜/配饰柜三条 POST 走 loginRequired 之外的会话口径，先给用户占个位；
// creator /works 明确要 req.user.id，所以 users 里必须真有这一行
memDb.prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)').run('创建口测试者', SESS)
// 搭配日记要一条真实存在的衣物（item_ids 里的 id 会逐条验归属，空数组直接 400）
const WARDROBE_ITEM = memDb
  .prepare(`INSERT INTO user_wardrobe (session_id, name, category) VALUES (?, '打底衬衫', 'top')`)
  .run(SESS).lastInsertRowid
// 库存商品的 category_id 是 NOT NULL，先造一个分类供它指（分类自己那条另算一档）
const CATEGORY_ID = memDb
  .prepare(`INSERT INTO inventory_categories (name, code) VALUES ('预置分类', 'cat-preset-201')`)
  .run().lastInsertRowid

// ------------------------------------------------------------------
// 二档：201 + Location，且 Location 照得到人
// ------------------------------------------------------------------

const withLocation = [
  {
    name: '衣橱单品 POST /api/wardrobe/items',
    post: ['/api/wardrobe/items', { name: '白衬衫', category: '上衣' }],
    idPath: 'data.id',
  },
  {
    name: '配饰 POST /api/accessory/items',
    post: ['/api/accessory/items', { name: '银项链', category: '项链' }],
    idPath: 'data.item.id',
  },
  {
    name: '化妆品 POST /api/cosmetic/items',
    post: ['/api/cosmetic/items', { name: '口红', category: '口红' }],
    idPath: 'data.item.id',
  },
  {
    name: '规则组 POST /api/rules/groups（管理员）',
    post: [
      '/api/rules/groups',
      {
        name: '测试-创建口',
        mode: 'store',
        category: '穿搭',
        conditions: [{ field: 'gender', operator: 'eq', value: '女' }],
        actions: [{ action_type: 'top_style', content: '简洁利落的衬衫' }],
      },
    ],
    idPath: 'data.id',
    admin: true,
  },
]

for (const c of withLocation) {
  test(`${c.name}：201 + Location 指得到那条按 id 读回的 GET`, async () => {
    const created = await send('POST', c.post[0], c.post[1], { admin: !!c.admin })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.success, true, '信封形状一字没动')

    const id = c.idPath
      .split('.')
      .reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), created.body)
    assert.ok(Number.isInteger(Number(id)) && Number(id) > 0, `建出来的 id 要能拿到：${id}`)

    assert.ok(created.location, '这条有按 id 的 GET ⇒ 必须带 Location')
    // Location 是绝对 URL（host 由 req.get('host') 组），尾段就是那条 GET 的路径
    const u = new URL(created.location)
    assert.equal(`${u.pathname}`, `${c.post[0]}/${id}`, `Location 指错了：${created.location}`)

    // 照 Location 真发一次 GET：指不到地方的 Location 在这里当场露形
    const readBack = await send('GET', created.location, undefined, { admin: !!c.admin })
    assert.equal(
      readBack.status,
      200,
      `${created.location} 读不回来：${JSON.stringify(readBack.body)}`,
    )

    if (c.message) assert.equal(created.body.message, c.message, '原来那句人话要还在 body.message')
  })
}

// ------------------------------------------------------------------
// 三档：201 但不给 Location（没有按 id 读回的 GET）
// ------------------------------------------------------------------

const withoutLocation = [
  {
    name: '搭配日记 POST /api/wardrobe/outfits',
    post: ['/api/wardrobe/outfits', { name: '今天这一身', item_ids: [Number(WARDROBE_ITEM)] }],
    message: '搭配已创建',
  },
  {
    name: '心愿单 POST /api/wardrobe/wishlist',
    post: ['/api/wardrobe/wishlist', { name: '想要的那件大衣' }],
  },
  {
    // 实测过才这么定的：给这条挂上 Location 后，照它 GET 回的是 404「作品不存在或未通过审核」，
    // 因为新建的这条 status='pending'，而公开的 GET /api/creator/works/:id 只放审核过的作品。
    // ⇒ 创建成功是真的（201 照给），可寻址是假的（Location 不给），作者查进度走 GET /creator/my。
    name: '创作者作品 POST /api/creator/works（待审核，公开读口还不认它）',
    post: ['/api/creator/works', { type: 'outfit', title: '通勤三件套' }],
    message: '已提交，等待审核',
  },
  {
    name: '库存商品 POST /api/inventory/products（管理员）',
    post: ['/api/inventory/products', { name: '测试商品', category_id: Number(CATEGORY_ID) }],
    admin: true,
  },
  {
    name: '库存分类 POST /api/inventory/categories（管理员）',
    post: ['/api/inventory/categories', { name: '测试分类', code: 'cat-created-201' }],
    admin: true,
  },
]

for (const c of withoutLocation) {
  test(`${c.name}：201，但没有按 id 的 GET ⇒ 不硬造 Location`, async () => {
    const created = await send('POST', c.post[0], c.post[1], { admin: !!c.admin })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.location, null, `这一条没有可回读的 GET，不该发 Location`)
    if (c.message) assert.equal(created.body.message, c.message)
  })
}

// ------------------------------------------------------------------
// 四档：建失败的还是 400，不许被 201 带跑
// ------------------------------------------------------------------

test('入参不合法的创建口仍然 400，且不带 Location（201 只给真建出来的那一次）', async () => {
  const bad = await send('POST', '/api/wardrobe/items', { category: '上衣' })
  assert.equal(bad.status, 400, JSON.stringify(bad.body))
  assert.equal(bad.location, null)
  assert.equal(bad.body.success, false)
  assert.ok(bad.body.error.code, '错误信封的 code 要在')
})

test('顾客会话 POST /api/customer/session：201 + Location 指到 /session/<新 sessionId>', async () => {
  // 这一条的"主键"是服务端生成的 session_id，不是自增 id，Location 要跟着它走
  const created = await send(
    'POST',
    '/api/customer/session',
    { store: 'default' },
    { session: null },
  )
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const sid = created.body.data.session_id
  assert.ok(sid, `响应里要带回 session_id：${JSON.stringify(created.body.data)}`)
  assert.ok(created.location && created.location.endsWith(`/session/${sid}`), created.location)
  const readBack = await send('GET', created.location, undefined, { session: null })
  assert.equal(readBack.status, 200, JSON.stringify(readBack.body))
  assert.equal(readBack.body.data.session_id, sid)
})
