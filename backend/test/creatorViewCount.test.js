/**
 * 创作者作品浏览计数测试（审计第 5 条）
 *
 * GET /works/:id 原来顺手写库（heat +1 / share_views + ref命中），GET 有副作用
 * 会被预取、爬虫、重试把计数灌大。本轮把写挪到 POST /works/:id/view，
 * GET 保持只读且响应形状不变。
 *
 * db/init 用内存库替身（schema.sql 同源），不碰活库。
 * 运行: node --test test/creatorViewCount.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

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

const creatorRouter = require('../routes/creator')

// 夹具：一个作者 + 一条已过审作品（heat=5、share_views=2、share_code=abcd1234）
memDb
  .prepare(
    `INSERT INTO users (id, session_id, nickname) VALUES (1, 'sess_creator_fixture', '小美')`,
  )
  .run()
memDb
  .prepare(
    `INSERT INTO creator_works
     (id, user_id, share_code, type, title, payload, status, heat, share_views)
     VALUES (1, 1, 'abcd1234', 'outfit', '初秋通勤搭配', '{"items":[]}', 'approved', 5, 2)`,
  )
  .run()

function findRoute(method, routePath) {
  for (const layer of creatorRouter.stack) {
    const r = layer.route
    if (r && r.path === routePath && r.methods[method.toLowerCase()]) return r
  }
  return null
}

/** 直接调路由上的业务 handler（最后一个 Layer），不经过 express 本体 */
function callHandler(route, { params = {}, query = {}, body = {}, headers = {} }) {
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
  handler({ params, query, body, headers, ip: '1.1.1.1', socket: {} }, res, () => {})
  return res
}

const heatOf = (id) =>
  memDb.prepare('SELECT heat, share_views FROM creator_works WHERE id = ?').get(id)

test('GET /works/:id 只读：响应形状不变，但库里计数一字不动', () => {
  const route = findRoute('get', '/works/:id')
  assert.ok(route)
  const before = heatOf(1)
  const res = callHandler(route, { params: { id: '1' }, query: { ref: 'abcd1234' } })

  assert.strictEqual(res.statusCode, 200)
  assert.strictEqual(res.body.success, true)
  // 形状保持：heat / share_views 字段仍在，值就是库里的原值（不再 +1 冒充刚看过的）
  assert.ok('heat' in res.body.data && 'share_views' in res.body.data)
  assert.strictEqual(res.body.data.heat, 5)
  assert.strictEqual(res.body.data.share_views, 2)
  assert.strictEqual(res.body.data.author_name, '小美')
  assert.deepEqual(heatOf(1), before, 'GET 之后库必须无变化')
})

test('POST /works/:id/view 才写计数：ref 命中分享码时 heat 与 share_views 同涨', () => {
  const route = findRoute('post', '/works/:id/view')
  assert.ok(route, '本轮新增的 POST 计数路由必须存在')
  const res = callHandler(route, { params: { id: '1' }, body: { ref: 'abcd1234' } })
  assert.strictEqual(res.body.success, true)
  assert.strictEqual(res.body.data.heat, 6)
  assert.strictEqual(res.body.data.share_views, 3)
  assert.deepEqual(heatOf(1), { heat: 6, share_views: 3 })
})

test('POST /works/:id/view 不带 ref（或 ref 对不上）只涨 heat，不记分享带量', () => {
  const route = findRoute('post', '/works/:id/view')
  callHandler(route, { params: { id: '1' }, body: { ref: 'deadbeef' } })
  assert.deepEqual(heatOf(1), { heat: 7, share_views: 3 })
})

test('未过审 / 不存在的作品：GET 与 POST view 都回 404 且计数不动', () => {
  memDb
    .prepare(
      `INSERT INTO creator_works
       (id, user_id, share_code, type, title, payload, status, heat, share_views)
       VALUES (2, 1, 'ffff0000', 'outfit', '待审核', '{}', 'pending', 0, 0)`,
    )
    .run()
  const getRoute = findRoute('get', '/works/:id')
  const postRoute = findRoute('post', '/works/:id/view')
  for (const [route, id] of [
    [getRoute, '2'],
    [postRoute, '2'],
    [getRoute, '999'],
    [postRoute, '999'],
  ]) {
    const res = callHandler(route, { params: { id }, body: {}, query: {} })
    assert.strictEqual(res.statusCode, 404, `${route.stack.length} handler id=${id} 应 404`)
    assert.strictEqual(res.body.success, false)
    assert.strictEqual(res.body.error.code, 'NOT_FOUND')
  }
  assert.deepEqual(heatOf(1), { heat: 7, share_views: 3 }, '404 分支不能碰第 1 条的计数')
  assert.deepEqual(heatOf(2), { heat: 0, share_views: 0 }, '未过审的计数必须原地不动')
})

test('ID 非数字：GET 与 POST view 都回 400，不再走到写', () => {
  for (const route of [findRoute('get', '/works/:id'), findRoute('post', '/works/:id/view')]) {
    const res = callHandler(route, { params: { id: 'abc' }, body: {}, query: {} })
    assert.strictEqual(res.statusCode, 400)
    assert.strictEqual(res.body.error.code, 'BAD_REQUEST')
  }
})
