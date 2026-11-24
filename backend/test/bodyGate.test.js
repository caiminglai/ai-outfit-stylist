/**
 * 入口闸门测试（middleware/bodyGate.js）——第 2 项「接口输入校验」的唯一新增层
 *
 * 这一层为什么不长成"再加一套校验库"：本仓的入参尺子早就在 utils/common.js 里
 * （asText / asNumber / asId / firstBadScalar），20 份路由文件全部 import 它，
 * 81 个写入口现量＝46 个已过守卫、25 个根本不读 body、
 * 「读 body ＋ 写库 ＋ 零守卫」的入口 **0 个**。所以缺的不是校验能力，
 * 是"同一个入口的字段清单只写一处"。本文件守的就是这一层。
 *
 * 前面全是纯函数：不连库、不起端口、不碰真请求。
 * 最后那节「栈形登记」要 require 路由文件，走 db/init 的内存库替身（与
 * auditFixes20261012.test.js 同一个手法），⛔ 不碰 backend/db/styleai.db。
 *
 * 运行: node --test test/bodyGate.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { gateBody, capJson, FORM_BLOB_LIMITS } = require('../middleware/bodyGate')

/** 喂一个假 req/res，跑中间件本身（不经 express 栈） */
function run(mw, body) {
  const sent = { status: null, json: null }
  let passed = false
  const res = {
    status(c) {
      sent.status = c
      return res
    },
    json(b) {
      sent.json = b
      return res
    },
  }
  mw({ body }, res, () => {
    passed = true
  })
  return { passed, sent, body }
}

test('scalars 里给了数组/对象 ⇒ 400 且点名是哪一格（沿用 firstBadScalar 那把尺子）', () => {
  const { passed, sent } = run(gateBody({ scalars: ['category', 'color'] }), {
    category: ['a', 'b'],
  })
  assert.strictEqual(passed, false, '不该放行')
  assert.strictEqual(sent.status, 400)
  assert.match(sent.json.error.message, /category/)
  assert.strictEqual(sent.json.error.code, 'BAD_REQUEST')
})

test('booleans 也拦：better-sqlite3 只认 number/string/bigint/buffer/null，true 绑进去就 TypeError', () => {
  const { passed, sent } = run(gateBody({ scalars: ['enabled_note'] }), { enabled_note: true })
  assert.strictEqual(passed, false)
  assert.strictEqual(sent.status, 400)
})

test('numbers：数字串折成数（与 asNumber 同口径），认不出的当"没填"折成 null，不编 0', () => {
  const req = { body: { price: '12.5', count: 'abc', missing_then_zero: 0 } }
  let passed = false
  gateBody({ numbers: ['price', 'count', 'missing_then_zero'] })(req, {}, () => {
    passed = true
  })
  assert.strictEqual(passed, true)
  assert.strictEqual(req.body.price, 12.5, '数字串要折成 number')
  assert.strictEqual(req.body.count, null, "认不出的要当没填，不许留 'abc' 进 SQL")
  assert.strictEqual(req.body.missing_then_zero, 0, '0 是真值，不能被当成"没填"抹掉')
})

test('没带的字段不无中生有：spec 里列了但 body 里没有 ⇒ 既不报错也不长出新键', () => {
  const { passed, body } = run(gateBody({ scalars: ['a'], numbers: ['b'] }), { c: 'x' })
  assert.strictEqual(passed, true)
  assert.deepStrictEqual(Object.keys(body), ['c'], '闸门不该往 body 里塞键')
})

test('scalars/numbers 之外的键一律不动：⛔ 不做白名单剔除（本仓没有 mass-assignment 现场，现量 `grep -rn "\\.\\.\\.req\\.body" routes/`＝0）', () => {
  const { body, passed } = run(gateBody({ scalars: ['a'] }), { a: '上衣', surprise: { deep: 1 } })
  assert.strictEqual(passed, true)
  assert.deepStrictEqual(body.surprise, { deep: 1 }, '没点名的键照原样交给下游')
})

test('body 整个缺席（multipart／无体请求）不许炸：|| {} 之后照常放行', () => {
  let passed = false
  gateBody({ scalars: ['a'] })({ body: undefined }, {}, () => {
    passed = true
  })
  assert.strictEqual(passed, true)
})

test('objects：profile 传来字符串 ⇒ 400 点名；传来对象或干脆没带都放行', () => {
  const bad = run(gateBody({ objects: ['profile'] }), { profile: '上衣' })
  assert.strictEqual(bad.passed, false)
  assert.strictEqual(bad.sent.status, 400)
  assert.match(bad.sent.json.error.message, /profile/)
  assert.strictEqual(
    run(gateBody({ objects: ['profile'] }), { profile: { height: 165 } }).passed,
    true,
  )
  assert.strictEqual(
    run(gateBody({ objects: ['profile'] }), { other: 1 }).passed,
    true,
    '没带＝这层不管，存在性归 handler 自己那句',
  )
  assert.strictEqual(
    run(gateBody({ objects: ['profile'] }), { profile: ['a'] }).passed,
    false,
    '数组不算对象',
  )
  assert.strictEqual(
    run(gateBody({ objects: ['profile'] }), { profile: null }).passed,
    true,
    'null 按"没带"走',
  )
})

test('arrays：wardrobe_items 传来对象 ⇒ 400；空数组放行（"这次没买过衣服"是合法状态）', () => {
  assert.strictEqual(
    run(gateBody({ arrays: ['wardrobe_items'] }), { wardrobe_items: {} }).passed,
    false,
  )
  assert.strictEqual(
    run(gateBody({ arrays: ['wardrobe_items'] }), { wardrobe_items: [] }).passed,
    true,
  )
  assert.strictEqual(run(gateBody({ arrays: ['answers'] }), { answers: ['a'] }).passed, true)
})

test('capJson：键数与序列化字节双上限，超了说不放行；正常小对象照过', () => {
  const big = {}
  for (let i = 0; i < 5000; i++) big['k' + i] = 'v'
  assert.strictEqual(capJson(big, { maxKeys: 200, maxBytes: 64 * 1024 }).ok, false)
  assert.strictEqual(capJson({ a: 1 }, { maxKeys: 200, maxBytes: 64 * 1024 }).ok, true)
  // 字节超但键数没超，也要拦得住（顾客会话那种一坨长文本画像）
  const fat = { blob: 'x'.repeat(200 * 1024) }
  assert.strictEqual(capJson(fat, { maxKeys: 200, maxBytes: 64 * 1024 }).ok, false)
})

test('capJson：循环引用序列化不了 ⇒ 说不放行，而不是把异常抛给调用方', () => {
  const circ = {}
  circ.self = circ
  assert.strictEqual(capJson(circ, { maxKeys: 10, maxBytes: 1024 }).ok, false)
})

// ============================================================
// 栈形登记：13 个写入口确实挂着闸门，且挂在业务 handler 之前
// ------------------------------------------------------------
// 这一节验的不是闸门的逻辑（前面纯函数那几节已经验完了），是「有没有挂上」。
// 新增一个读 body 的写入口而忘了登记这张表 ⇒ 下面那条「表里的入口数与
// 代码里 gateBody 的实际挂载数对得上」会先红，再顺着 stack 找是谁。
// ============================================================
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

const REGISTRY = [
  ['wardrobe', 'post', '/gaps', { objects: ['profile'] }],
  ['wardrobe', 'post', '/evaluate', { objects: ['profile', 'candidate'] }],
  ['wardrobe', 'post', '/suggest', { objects: ['profile'] }],
  ['wardrobe', 'post', '/match', { objects: ['profile'] }],
  ['wardrobe', 'post', '/recommend', { objects: ['profile'], arrays: ['wardrobe_items'] }],
  ['accessory', 'post', '/gaps', { objects: ['profile'] }],
  ['accessory', 'post', '/evaluate', { objects: ['profile', 'candidate'] }],
  ['accessory', 'post', '/suggest', { objects: ['profile'] }],
  ['cosmetic', 'post', '/gaps', { objects: ['profile'] }],
  ['cosmetic', 'post', '/evaluate', { objects: ['profile', 'candidate'] }],
  ['cosmetic', 'post', '/suggest', { objects: ['profile'] }],
  ['recommend', 'post', '/enhance', { objects: ['recommendation', 'weather'] }],
  ['analysis', 'post', '/style-diagnose', { objects: ['answers'] }],
]

const routers = {}
for (const [name] of REGISTRY) routers[name] = require('../routes/' + name)

/** 在这一条 route 的 handler 链里找闸门层，返回它和它的下标 */
function findGate(router, method, p) {
  for (const layer of router.stack) {
    if (!layer.route || layer.route.path !== p) continue
    if (!layer.route.methods[method]) continue
    const chain = layer.route.stack
    for (let i = 0; i < chain.length; i++) {
      if (chain[i].handle && chain[i].handle.bodyGateSpec) {
        return { index: i, spec: chain[i].handle.bodyGateSpec, chainLength: chain.length }
      }
    }
    return { index: -1, spec: null, chainLength: chain.length }
  }
  return { index: -2, spec: null, chainLength: 0 }
}

test('栈形登记：13 个入口逐个挂着 gateBody，且不在链尾（后面必须有业务 handler）', () => {
  for (const [name, method, p, expect] of REGISTRY) {
    const gate = findGate(routers[name], method, p)
    assert.ok(gate.index >= 0, name + ' ' + method + ' ' + p + ' 的 handler 链里找不到 gateBody 层')
    assert.ok(gate.index < gate.chainLength - 1, name + ' ' + p + ' 闸门成了链上最后一层')
    assert.deepStrictEqual(
      gate.spec.objects || [],
      expect.objects || [],
      name + ' ' + p + ' objects 不符',
    )
    assert.deepStrictEqual(
      gate.spec.arrays || [],
      expect.arrays || [],
      name + ' ' + p + ' arrays 不符',
    )
  }
})

test('栈形登记：代码里 gateBody 的挂载点数量与这张表一致（新入口没登记就红）', () => {
  const dir = path.join(__dirname, '..', 'routes')
  let wired = 0
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf-8')
    // 用字符类写这几条正则，不用反斜杠：这个文件里的正则会长期留在源码里，
    // 少一处 "\\(" 就少一处"被哪个工具吃了一遍转义"的现场
    wired += (src.match(/gateBody[(][{]/g) || []).length
  }
  assert.strictEqual(wired, REGISTRY.length, 'routes/ 里 gateBody({...}) 的出现数与登记表不等')
})

test('整坨落库的每一处都先过体积闸：裸 JSON.stringify(req.body…) 一律不许出现', () => {
  const dir = path.join(__dirname, '..', 'routes')
  // 把整个请求体序列化进库的现场共三处，各自认自己的尺子：
  //   customer.js 两处（profile_data）与 analysis.js 一处（草稿格）走 bodyGate 的 capJson；
  //   creator.js 那一处（payload）早就自己数过字符数（PAYLOAD_MAX_CHARS），不是裸序列化，
  //   本轮不动它——但它也算"整坨落库"，所以列进来一起守，谁把那道字符闸删了就红。
  const GUARD = {
    'customer.js': 'capJson[(]',
    'analysis.js': 'capJson[(]',
    'creator.js': 'PAYLOAD_MAX_CHARS',
  }
  const offenders = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf-8')
    if (!/JSON[.]stringify[(]req[.]body/.test(src)) continue
    const guard = GUARD[f]
    if (!guard || !new RegExp(guard).test(src)) offenders.push(f)
  }
  assert.deepStrictEqual(offenders, [], '这些路由把整个 req.body 序列化进库却没先过体积闸')
  const capSites = ['customer.js', 'analysis.js']
    .map((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8')
      return (src.match(/capJson[(]/g) || []).length
    })
    .reduce((a, b) => a + b, 0)
  assert.strictEqual(capSites, 3, 'capJson 的落库点应该正好三处（顾客会话两处、草稿一处）')
})

test('栈形登记：每个入口挂的那一层实例本身真会回 400 并点名（不是只挂了个空壳）', () => {
  for (const [name, method, p, expect] of REGISTRY) {
    const gate = findGate(routers[name], method, p)
    assert.ok(gate.index >= 0, name + ' ' + p + ' 找不到闸门层')
    const layer = routers[name].stack.find(
      (l) => l.route && l.route.path === p && l.route.methods[method],
    ).route.stack[gate.index]
    for (const kind of ['objects', 'arrays']) {
      for (const field of expect[kind] || []) {
        // 这一格传成"不是它该有的形状"：对象格给字符串、列表格给对象
        const dirty = { [field]: kind === 'objects' ? 'not-an-object' : { a: 1 } }
        const out = run(layer.handle, dirty)
        assert.strictEqual(out.passed, false, name + ' ' + p + ' 的 ' + field + ' 脏数据竟然放行了')
        assert.strictEqual(out.sent.status, 400, name + ' ' + p + ' 的 ' + field + ' 没回 400')
        const msg = String(out.sent.json.error.message)
        assert.ok(msg.includes(field), name + ' ' + p + ' 的 400 话术没点名是哪一格：' + msg)
      }
    }
    // 全空的身体（这一格压根没带）闸门放行，存在性检查照旧归各入口自己
    assert.strictEqual(run(layer.handle, {}).passed, true, name + ' ' + p + ' 不许拦"没带"')
  }
})

test('FORM_BLOB_LIMITS：三处整坨共用同一份上限，且远小于 express.json 的 10mb', () => {
  assert.ok(FORM_BLOB_LIMITS.maxKeys > 0 && FORM_BLOB_LIMITS.maxBytes > 0)
  assert.ok(FORM_BLOB_LIMITS.maxBytes < 1024 * 1024, '整坨上限必须远小于全局 10mb 粗闸')
})
