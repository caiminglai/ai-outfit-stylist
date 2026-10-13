/**
 * 2026-10-14 凌晨轮：路径 id 参数截断（`parseInt('12abc')` ⇒ 12）行为测试
 * ============================================================
 * 病灶：路由里读路径参数写成 `parseInt(req.params.id, 10)`。parseInt 会**截断**——
 * '12abc' 得到 12，于是「PUT /api/wardrobe/items/12abc」动的其实是 12 号那一行。
 * 这不是会 500 的错：10-13 实测 better-sqlite3 绑 NaN／undefined／'12abc' 都不抛，
 * SELECT 直接查无行。所以它只以两种形态现形——
 *   ① 读口：把另一行的数据当"你要的那行"发出去（creator 的公开详情还是匿名可达的）；
 *   ② 写口：改名／翻转／删除作用在别人那行上，而调用方看见的是「成功」。
 * 上一版到处写的 `if (isNaN(x))` 拦不住 ①②：'12abc' 截出来是 12，isNaN(12) 是 false。
 * 正解统一走 utils/common.js 的 asId()：只认整串十进制正整数，别的样子一律 null ⇒ 当场 400。
 *
 * 覆盖现量：backend/routes 里 `req.params.<数字参数>` 一共 32 处读法，本轮之后
 * asId 28 处 + inventory.js 的 asNumber 4 处（Number('12abc') 是 NaN，本来就不截断），
 * `parseInt(req.params` 归零。下面 28 个入口逐条断「400 ＋ 那一行整行快照没变」。
 *
 * 这些断言不是"写了就绿"：把 routes/ 换成 HEAD（ce81a88）的改前版本、在仓库外的副本里
 * 跑这同一份测试，红条数见本轮台账。
 *
 * 库走 db/init 的内存替身（与 db/schema.sql 同源），不碰 backend/db/styleai.db、不起真端口；
 * 鉴权与限流中间件被绕过（只调路由 stack 里最后一个业务 handler）。
 *
 * 运行: node --test test/routeIdParam20261014.test.js
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

const { asId } = require('../utils/common')
const accessoryRouter = require('../routes/accessory')
const analysisRouter = require('../routes/analysis')
const clothingRouter = require('../routes/clothing')
const cosmeticRouter = require('../routes/cosmetic')
const creatorRouter = require('../routes/creator')
const historyRouter = require('../routes/history')
const modelsRouter = require('../routes/models')
const paymentRouter = require('../routes/payment')
const photosRouter = require('../routes/photos')
const rulesRouter = require('../routes/rules')
const tryonRouter = require('../routes/tryon')
const wardrobeRouter = require('../routes/wardrobe')

/** 按 method+path 找路由 */
function findRoute(router, method, routePath) {
  for (const layer of router.stack) {
    const r = layer.route
    if (!r || !r.methods[method.toLowerCase()]) continue
    const p = r.path
    const hit = Array.isArray(p) ? p.includes(routePath) : p === routePath
    if (hit) return r
  }
  throw new Error(`找不到路由 ${method} ${routePath}`)
}

/** 只调最后一个 handler（业务本体） */
function call(route, opt = {}) {
  const { params = {}, query = {}, body = {}, headers = {}, user = null } = opt
  const handler = route.stack[route.stack.length - 1].handle
  const res = {
    statusCode: 200,
    body: null,
    status(c) {
      res.statusCode = c
      return res
    },
    json(b) {
      res.body = b
      return res
    },
  }
  handler({ params, query, body, headers, ip: '1.1.1.1', socket: {}, user }, res, () => {})
  return res
}

/** 定 id 插一行；先清同名 id，保证同一张表能反复喂不同 case */
function insert(table, id, cols) {
  memDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
  const all = { id, ...cols }
  const keys = Object.keys(all)
  memDb
    .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => all[k]))
  return all
}

const S = 'sid-asid-20261014'
const U = { id: 5, session_id: S }
const HS = { 'x-session-id': S }

/** 外键父行：schema 里 photos／creator_works／deposits／face_features 等都挂在 users(id) 上，
 *  PRAGMA foreign_keys=ON 下不先建 users 就插不进去（10-14 现量：FOREIGN KEY constraint failed）*/
insert('users', 5, { session_id: S, nickname: '用户五' })
insert('users', 7, { session_id: 'sid-asid-creator', nickname: '作者七' })
insert('photos', 12, { user_id: 5, url: '/uploads/asid-p12.jpg', type: 'face' })

/**
 * 一条入口 = 一个 case。坏值一律写成 `<这一行的 id>abc`：改前 parseInt 会把它截成同一个 id，
 * 于是这条坏 URL 真打到这一行上；表里另有别的行时（models id 12）截断命中正是它。
 * table+id 用来取"整行快照"，snapId 只在这行的主键与路由读的那个号不同时才给（analysis）。
 */
const CASES = [
  // ---- models：后台写口三条 ----
  {
    t: 'models POST /admin/:id/toggle：12abc 不翻 12 号的开关',
    router: modelsRouter,
    method: 'post',
    path: '/admin/:id/toggle',
    table: 'model_configs',
    id: 12,
    seed: () =>
      insert('model_configs', 12, { name: '模型十二', folder: 'f12', file: 'm12.glb', enabled: 1 }),
  },
  {
    t: 'models PUT /admin/:id：12abc 不改 12 号的名字',
    router: modelsRouter,
    method: 'put',
    path: '/admin/:id',
    table: 'model_configs',
    id: 12,
    body: { name: '被截断改的名' },
    seed: () =>
      insert('model_configs', 12, { name: '模型十二', folder: 'f12', file: 'm12.glb', enabled: 1 }),
  },
  {
    t: 'models DELETE /admin/:id：12abc 不删 12 号',
    router: modelsRouter,
    method: 'delete',
    path: '/admin/:id',
    table: 'model_configs',
    id: 12,
    seed: () => insert('model_configs', 12, { name: '模型十二', folder: 'f12', file: 'm12.glb' }),
  },
  // ---- rules：后台四口 ----
  {
    t: 'rules GET /groups/:id：7abc 不把 7 号规则组当详情发出去',
    router: rulesRouter,
    method: 'get',
    path: '/groups/:id',
    table: 'rule_groups',
    id: 7,
    seed: () => insert('rule_groups', 7, { name: '规则组七', category: 'fashion', enabled: 1 }),
  },
  {
    t: 'rules PUT /groups/:id：7abc 不改 7 号',
    router: rulesRouter,
    method: 'put',
    path: '/groups/:id',
    table: 'rule_groups',
    id: 7,
    body: { name: '被截断改的名' },
    seed: () => insert('rule_groups', 7, { name: '规则组七', category: 'fashion' }),
  },
  {
    t: 'rules DELETE /groups/:id：7abc 不删 7 号',
    router: rulesRouter,
    method: 'delete',
    path: '/groups/:id',
    table: 'rule_groups',
    id: 7,
    seed: () => insert('rule_groups', 7, { name: '规则组七', category: 'fashion' }),
  },
  {
    t: 'rules POST /groups/:id/toggle：7abc 不翻 7 号',
    router: rulesRouter,
    method: 'post',
    path: '/groups/:id/toggle',
    table: 'rule_groups',
    id: 7,
    seed: () => insert('rule_groups', 7, { name: '规则组七', category: 'fashion', enabled: 1 }),
  },
  // ---- wardrobe：顾客四口 ----
  {
    t: 'wardrobe GET /items/:itemId：12abc 不把另一件上衣当 12 号回出',
    router: wardrobeRouter,
    method: 'get',
    path: '/items/:itemId',
    table: 'user_wardrobe',
    id: 12,
    headers: HS,
    seed: () => insert('user_wardrobe', 12, { session_id: S, name: '上衣十二', category: '上衣' }),
  },
  {
    t: 'wardrobe PUT /items/:itemId：12abc 不改 12 号',
    router: wardrobeRouter,
    method: 'put',
    path: '/items/:itemId',
    table: 'user_wardrobe',
    id: 12,
    headers: HS,
    body: { name: '被截断改的名' },
    seed: () => insert('user_wardrobe', 12, { session_id: S, name: '上衣十二', category: '上衣' }),
  },
  {
    t: 'wardrobe DELETE /items/:itemId：12abc 不删 12 号',
    router: wardrobeRouter,
    method: 'delete',
    path: '/items/:itemId',
    table: 'user_wardrobe',
    id: 12,
    headers: HS,
    seed: () => insert('user_wardrobe', 12, { session_id: S, name: '上衣十二', category: '上衣' }),
  },
  {
    t: 'wardrobe PUT /wishlist/:wishId：3abc 不改 3 号心愿',
    router: wardrobeRouter,
    method: 'put',
    path: '/wishlist/:wishId',
    table: 'shopping_wishlist',
    id: 3,
    headers: HS,
    body: { status: 'bought' },
    seed: () =>
      insert('shopping_wishlist', 3, { session_id: S, item_name: '心愿三', status: 'wish' }),
  },
  // ---- accessory / cosmetic：cosmetic 与 accessory 的 DELETE 改前整句没有守卫 ----
  {
    t: 'accessory GET /items/:itemId：12abc 不把 12 号配饰回出',
    router: accessoryRouter,
    method: 'get',
    path: '/items/:itemId',
    table: 'user_accessories',
    id: 12,
    headers: HS,
    seed: () =>
      insert('user_accessories', 12, { session_id: S, name: '配饰十二', category: '项链' }),
  },
  {
    t: 'accessory PUT /items/:itemId：12abc 不改 12 号',
    router: accessoryRouter,
    method: 'put',
    path: '/items/:itemId',
    table: 'user_accessories',
    id: 12,
    headers: HS,
    body: { name: '被截断改的名' },
    seed: () =>
      insert('user_accessories', 12, { session_id: S, name: '配饰十二', category: '项链' }),
  },
  {
    t: 'accessory DELETE /items/:itemId：12abc 不删 12 号（改前这条整句没有守卫）',
    router: accessoryRouter,
    method: 'delete',
    path: '/items/:itemId',
    table: 'user_accessories',
    id: 12,
    headers: HS,
    seed: () =>
      insert('user_accessories', 12, { session_id: S, name: '配饰十二', category: '项链' }),
  },
  {
    t: 'cosmetic GET /items/:itemId：12abc 不把 12 号化妆品回出',
    router: cosmeticRouter,
    method: 'get',
    path: '/items/:itemId',
    table: 'user_cosmetics',
    id: 12,
    headers: HS,
    seed: () => insert('user_cosmetics', 12, { session_id: S, name: '口红十二', category: '口红' }),
  },
  {
    t: 'cosmetic PUT /items/:itemId：12abc 不改 12 号的余量',
    router: cosmeticRouter,
    method: 'put',
    path: '/items/:itemId',
    table: 'user_cosmetics',
    id: 12,
    headers: HS,
    body: { remaining: 50 },
    seed: () =>
      insert('user_cosmetics', 12, {
        session_id: S,
        name: '口红十二',
        category: '口红',
        remaining: 80,
      }),
  },
  {
    t: 'cosmetic DELETE /items/:itemId：12abc 不删 12 号（改前这条整句没有守卫）',
    router: cosmeticRouter,
    method: 'delete',
    path: '/items/:itemId',
    table: 'user_cosmetics',
    id: 12,
    headers: HS,
    seed: () => insert('user_cosmetics', 12, { session_id: S, name: '口红十二', category: '口红' }),
  },
  // ---- history / photos / tryon / clothing / analysis ----
  {
    t: 'history GET /:id：9abc 不把 9 号记录当详情发出去',
    router: historyRouter,
    method: 'get',
    path: '/:id',
    table: 'recommendation_logs',
    id: 9,
    user: U,
    seed: () => insert('recommendation_logs', 9, { session_id: S, user_id: 5, mode: 'personal' }),
  },
  {
    t: 'history DELETE /:id：9abc 不删 9 号',
    router: historyRouter,
    method: 'delete',
    path: '/:id',
    table: 'recommendation_logs',
    id: 9,
    user: U,
    seed: () => insert('recommendation_logs', 9, { session_id: S, user_id: 5, mode: 'personal' }),
  },
  {
    t: 'photos DELETE /:id：2abc 不删 2 号照片（改前还会连着 unlink 那张图）',
    router: photosRouter,
    method: 'delete',
    path: '/:id',
    table: 'photos',
    id: 2,
    user: U,
    seed: () => insert('photos', 2, { user_id: 5, url: '/uploads/asid-p2.jpg', type: 'face' }),
  },
  {
    t: 'tryon GET /:id：4abc 不把 4 号试穿结果回出',
    router: tryonRouter,
    method: 'get',
    path: '/:id',
    table: 'tryon_results',
    id: 4,
    user: U,
    seed: () => insert('tryon_results', 4, { user_id: 5, status: 'done' }),
  },
  {
    t: 'clothing DELETE /:id：6abc 不删 6 号',
    router: clothingRouter,
    method: 'delete',
    path: '/:id',
    table: 'clothing_items',
    id: 6,
    user: U,
    seed: () =>
      insert('clothing_items', 6, {
        session_id: S,
        filename: 'asid-c6.jpg',
        image_url: '/uploads/asid-c6.jpg',
      }),
  },
  {
    t: 'analysis GET /face/:photoId：12abc 不把 12 号照片的脸部档案回出',
    router: analysisRouter,
    method: 'get',
    path: '/face/:photoId',
    param: 'photoId',
    table: 'face_features',
    // 这一条按 photo_id 取行，主键另给：坏 URL 截成 12 就会命中 photo_id=12 那份档案
    id: 31,
    badVal: '12abc',
    user: U,
    seed: () => insert('face_features', 31, { user_id: 5, photo_id: 12, skin_tone: '暖皮' }),
  },
  // ---- creator：含匿名可达的公开详情 ----
  {
    t: 'creator GET /works/:id：3abc 不把 3 号作品当详情发出去（这条匿名可达）',
    router: creatorRouter,
    method: 'get',
    path: '/works/:id',
    table: 'creator_works',
    id: 3,
    seed: () =>
      insert('creator_works', 3, {
        user_id: 7,
        share_code: 'ABC3',
        type: 'outfit',
        title: '作品三',
        status: 'approved',
      }),
  },
  {
    t: 'creator POST /works/:id/view：3abc 不给 3 号加热度',
    router: creatorRouter,
    method: 'post',
    path: '/works/:id/view',
    table: 'creator_works',
    id: 3,
    seed: () =>
      insert('creator_works', 3, {
        user_id: 7,
        share_code: 'ABC3',
        type: 'outfit',
        title: '作品三',
        status: 'approved',
        heat: 0,
        share_views: 0,
      }),
  },
  {
    t: 'creator POST /admin/:id/review：3abc 不改判 3 号',
    router: creatorRouter,
    method: 'post',
    path: '/admin/:id/review',
    table: 'creator_works',
    id: 3,
    body: { status: 'rejected' },
    seed: () =>
      insert('creator_works', 3, {
        user_id: 7,
        share_code: 'ABC3',
        type: 'outfit',
        title: '作品三',
        status: 'approved',
      }),
  },
  {
    t: 'creator POST /admin/:id/feature：3abc 不动 3 号的推荐位',
    router: creatorRouter,
    method: 'post',
    path: '/admin/:id/feature',
    table: 'creator_works',
    id: 3,
    body: { featured: 1 },
    seed: () =>
      insert('creator_works', 3, {
        user_id: 7,
        share_code: 'ABC3',
        type: 'outfit',
        title: '作品三',
        status: 'approved',
        featured: 0,
      }),
  },
  // ---- payment：钱的那张账 ----
  {
    t: 'payment POST /admin/:id/status：8abc 不改判 8 号充值凭证',
    router: paymentRouter,
    method: 'post',
    path: '/admin/:id/status',
    table: 'deposits',
    id: 8,
    body: { status: 'approved' },
    seed: () =>
      insert('deposits', 8, { user_id: 5, channel: 'wx', amount: 29.9, status: 'pending' }),
  },
]

const rowOf = (c) =>
  JSON.stringify(memDb.prepare(`SELECT * FROM ${c.table} WHERE id = ?`).get(c.id))

for (const c of CASES) {
  test(c.t, () => {
    c.seed()
    const param = c.param || c.path.match(/:(\w+)/)[1]
    const before = rowOf(c)
    assert.notEqual(before, undefined, `${c.table}#${c.id} 没种进去，这条断言是空的`)
    const res = call(findRoute(c.router, c.method, c.path), {
      params: { [param]: c.badVal || `${c.id}abc` },
      body: c.body || {},
      headers: c.headers || {},
      user: c.user || null,
    })
    assert.equal(
      res.statusCode,
      400,
      `坏 id 该 400，实际 ${res.statusCode}：${JSON.stringify(res.body)}`,
    )
    // clothing.js / tryon.js 这两条本轮之前就有更严的正则守卫，文案是「无效的ID」；
    // 其余入口走本轮新加的 asId 守卫，文案「xxx 必须是正整数」。两条都算拦住。
    assert.match(String(res.body.error && res.body.error.message), /必须是正整数|无效的ID/)
    assert.equal(rowOf(c), before, `${c.param || param}="${c.id}abc" 不许碰到 ${c.table}#${c.id}`)
  })
}

// ============================================================
// 一、asId 本身：只认整串十进制正整数
// ============================================================

test('asId：截断形／非正整数／超安全整数范围一律 null', () => {
  // 下面每一条改前都会被 parseInt 静默接受
  assert.equal(asId('12abc'), null)
  assert.equal(asId('abc12'), null)
  assert.equal(asId('12.7'), null)
  assert.equal(asId('0'), null)
  assert.equal(asId('-3'), null)
  assert.equal(asId('1e3'), null)
  assert.equal(asId('0x10'), null)
  assert.equal(asId('99999999999999999999'), null, '超出 Number.MAX_SAFE_INTEGER')
  // 非文本当"没带 id"
  assert.equal(asId(null), null)
  assert.equal(asId(undefined), null)
  assert.equal(asId({ a: 1 }), null)
  assert.equal(asId(['3']), null)
})

test('asId：正常 id 照旧读得进来（不许把合法请求一起挡掉）', () => {
  assert.equal(asId('12'), 12)
  assert.equal(asId(' 7 '), 7, 'URL 解码后的首尾空格仍属合法')
  assert.equal(asId(12), 12)
  assert.equal(asId('1'), 1)
})

// ============================================================
// 二、正向对照：加了守卫之后，合法 URL 的行为没变
// ============================================================

test('正向对照：数字 id 仍照常翻转、改名、回数据', () => {
  insert('model_configs', 21, { name: '模型二一', folder: 'f21', file: 'm21.glb', enabled: 1 })
  const t1 = call(findRoute(modelsRouter, 'post', '/admin/:id/toggle'), { params: { id: '21' } })
  assert.equal(t1.statusCode, 200, JSON.stringify(t1.body))
  assert.equal(memDb.prepare('SELECT enabled FROM model_configs WHERE id = 21').get().enabled, 0)

  insert('user_wardrobe', 22, { session_id: S, name: '上衣二二', category: '上衣' })
  const p1 = call(findRoute(wardrobeRouter, 'put', '/items/:itemId'), {
    params: { itemId: '22' },
    headers: HS,
    body: { name: '改名成功' },
  })
  assert.equal(p1.statusCode, 200, JSON.stringify(p1.body))
  assert.equal(memDb.prepare('SELECT name FROM user_wardrobe WHERE id = 22').get().name, '改名成功')

  insert('user_accessories', 23, { session_id: S, name: '配饰二三', category: '项链' })
  const g1 = call(findRoute(accessoryRouter, 'get', '/items/:itemId'), {
    params: { itemId: '23' },
    headers: HS,
  })
  assert.equal(g1.statusCode, 200, JSON.stringify(g1.body))
  assert.equal(g1.body.data.item.name, '配饰二三')
})

test('边界：0／负数／空串同样 400，且不碰已有的 1 号行', () => {
  insert('model_configs', 1, { name: '模型一', folder: 'f1', file: 'm1.glb', enabled: 1 })
  for (const bad of ['0', '-1', '']) {
    const res = call(findRoute(modelsRouter, 'post', '/admin/:id/toggle'), { params: { id: bad } })
    assert.equal(res.statusCode, 400, `id="${bad}" 该 400，实际 ${res.statusCode}`)
  }
  assert.equal(memDb.prepare('SELECT enabled FROM model_configs WHERE id = 1').get().enabled, 1)
})

// ============================================================
// 三、这一类 bug 的关闭闸：路由不再用会截断的 parseInt 读路径参数
// ============================================================

test('闸门：backend/routes 里 parseInt(req.params…) 归零，asId 读法 28 处', () => {
  const dir = path.join(__dirname, '..', 'routes')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
  const hits = []
  let asIdCount = 0
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')
    src.split('\n').forEach((l, i) => {
      if (/parseInt\(req\.params\./.test(l)) hits.push(`${f}:${i + 1}`)
      if (/asId\(req\.params\./.test(l)) asIdCount++
    })
  }
  assert.deepEqual(hits, [], `这些路径参数还在用会截断的 parseInt：${hits.join(', ')}`)
  // 现量 28＝accessory3＋analysis1＋clothing1＋cosmetic3＋creator4＋history2＋models3
  //        ＋payment1＋photos1＋rules4＋tryon1＋wardrobe4。新增数字型路径参数要同步这个数。
  assert.equal(asIdCount, 28, `asId 读法数变了（现量 ${asIdCount}）`)
})
