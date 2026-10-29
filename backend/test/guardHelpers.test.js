/**
 * 入参守卫层测试（utils/common.js）
 *
 * 这一层存在的唯一理由是 better-sqlite3 绑参只认 number/string/bigint/buffer/null：
 * 请求体里塞进 []、{}、'abc' 时，绑参当场 TypeError/RangeError，
 * 接口就把"你这次填错了"回成 500 服务内部错误。216 条规则测试都在算结论，
 * 没有人守这批闸门，所以它们被改坏时没人报警——这个文件补上。
 *
 * 全部是纯函数，不连数据库、不碰请求。
 * 运行: node --test test/guardHelpers.test.js
 */
const test = require('node:test')
const assert = require('node:assert')

const {
  asText,
  asNumber,
  ownValue,
  toEnabledBit,
  parseJsonField,
  parsePagination,
  getSessionId,
  normalizeItem,
  firstBadScalar,
  tally,
} = require('../utils/common')

test('asText: 数组/对象/null 一律当"没填"，数字与布尔转成文本', () => {
  assert.strictEqual(asText('  女  '), '女')
  assert.strictEqual(asText(['a']), '')
  assert.strictEqual(asText({ a: 1 }), '')
  assert.strictEqual(asText(null), '')
  assert.strictEqual(asText(undefined), '')
  assert.strictEqual(asText(12), '12')
  assert.strictEqual(asText(true), 'true')
})

test('asNumber: 认不出的值回默认值，绝不让 NaN 进 SQL', () => {
  assert.strictEqual(asNumber('60', null), 60)
  assert.strictEqual(asNumber(60.5, null), 60.5)
  assert.strictEqual(asNumber('abc', null), null)
  assert.strictEqual(asNumber(NaN, null), null)
  assert.strictEqual(asNumber(Infinity, null), null)
  assert.strictEqual(asNumber([], 0), 0)
  assert.strictEqual(asNumber({}, 0), 0)
  assert.strictEqual(asNumber('', 0), 0)
})

test('ownValue: 只认自有属性，原型键一律查不到', () => {
  const table = { 通勤: ['上班通勤'], length: 3 }
  assert.deepStrictEqual(ownValue(table, '通勤'), ['上班通勤'])
  assert.strictEqual(ownValue(table, 'constructor'), undefined)
  assert.strictEqual(ownValue(table, 'toString'), undefined)
  assert.strictEqual(ownValue(table, '__proto__'), undefined)
  assert.strictEqual(ownValue(table, 'hasOwnProperty'), undefined)
  // 数字键与查不到 key 的表
  assert.strictEqual(ownValue({ 0: 'zero' }, 0), 'zero')
  assert.strictEqual(ownValue(null, 'a'), undefined)
})

test('toEnabledBit: POST 与 PUT 共用一把口径，0/"0"/false/"false" 都算停用', () => {
  assert.strictEqual(toEnabledBit(false, 1), 0)
  assert.strictEqual(toEnabledBit(0, 1), 0)
  assert.strictEqual(toEnabledBit('0', 1), 0)
  assert.strictEqual(toEnabledBit('false', 1), 0)
  assert.strictEqual(toEnabledBit(true, 1), 1)
  assert.strictEqual(toEnabledBit('true', 1), 1)
  // 没带（undefined/null）→ 沿用 fallback，PUT 靠这条不再把下架商品重新上架
  assert.strictEqual(toEnabledBit(undefined, 0), 0)
  assert.strictEqual(toEnabledBit(undefined, 1), 1)
  assert.strictEqual(toEnabledBit(null, 0), 0)
})

test('parseJsonField: 任何形状出来都是数组', () => {
  assert.deepStrictEqual(parseJsonField('["a","b"]'), ['a', 'b'])
  assert.deepStrictEqual(parseJsonField(['a']), ['a'])
  assert.deepStrictEqual(parseJsonField(null), [])
  assert.deepStrictEqual(parseJsonField(undefined), [])
  assert.deepStrictEqual(parseJsonField(''), [])
  // 原来这两条会把数字/布尔原样递出去，调用方 .map() 当场 TypeError
  assert.deepStrictEqual(parseJsonField('123'), [])
  assert.deepStrictEqual(parseJsonField('true'), [])
  // 裸标签文本当一条标签：原来返回字符串，'暖皮,冷皮'.includes('暖') 会退化成子串匹配
  assert.deepStrictEqual(parseJsonField('暖皮'), ['暖皮'])
  assert.deepStrictEqual(parseJsonField({ a: 1 }), [])
})

test('parsePagination: limit=0 是真的 0，不再被 || 20 顶掉', () => {
  assert.deepStrictEqual(parsePagination({ limit: '0' }), {
    page: 1,
    limit: 1,
    offset: 0,
    paginated: true,
  })
  assert.deepStrictEqual(parsePagination({ limit: '500' }), {
    page: 1,
    limit: 100,
    offset: 0,
    paginated: true,
  })
  assert.deepStrictEqual(parsePagination({ page: '3', limit: '10' }), {
    page: 3,
    limit: 10,
    offset: 20,
    paginated: true,
  })
  // 没传分页 ⇒ 维持默认 20，且 paginated=false（调用方据此不分页）
  assert.deepStrictEqual(parsePagination({}), { page: 1, limit: 20, offset: 0, paginated: false })
  assert.deepStrictEqual(parsePagination(), { page: 1, limit: 20, offset: 0, paginated: false })
})

test('getSessionId: 请求体里的对象/数组冒充 session_id 时当"没带"，不带进 SQL', () => {
  assert.strictEqual(getSessionId({ headers: {}, body: { session_id: { a: 1 } } }), null)
  assert.strictEqual(getSessionId({ headers: {}, body: { session_id: ['a'] } }), null)
  assert.strictEqual(getSessionId({ headers: {}, body: {} }), null)
  assert.strictEqual(getSessionId({ headers: {}, body: { session_id: 'sess_1' } }), 'sess_1')
  // 头优先于体
  assert.strictEqual(
    getSessionId({ headers: { 'x-session-id': ' hdr ' }, body: { session_id: 'other' } }),
    'hdr',
  )
  // 数字 id 也认（原来 body 分支直接原样返回，能过 auth 的字符串判断却被绑参拒）
  assert.strictEqual(getSessionId({ headers: {}, body: { session_id: 42 } }), '42')
})

test('normalizeItem: 标签列出来就是数组，NULL 也是数组，行里没这列不凭空加', () => {
  const out = normalizeItem({
    id: 1,
    style_tags: '["简约"]',
    color_tags: null,
    neck_length_fit: '暖皮',
  })
  assert.deepStrictEqual(out.style_tags, ['简约'])
  assert.deepStrictEqual(out.color_tags, [])
  assert.deepStrictEqual(out.neck_length_fit, ['暖皮'])
  assert.strictEqual(out.id, 1)
  // 这张表没有 skin_type_fit 这一列 ⇒ 响应里也不该冒出来一个 key
  assert.ok(!('skin_type_fit' in out))
  assert.ok(!('face_shape_fit' in out))
  // 不改动传进来的行对象（调用方还要用原始行）
  const row = { style_tags: '["a"]' }
  normalizeItem(row)
  assert.strictEqual(row.style_tags, '["a"]')
})

test('firstBadScalar: 只放行能绑进 SQLite 的类型，布尔/数组/对象报出字段名', () => {
  // 文本与数字都能绑 ⇒ 全合法时返回 null
  assert.strictEqual(firstBadScalar({ brand: 'A', price: 12 }, ['brand', 'price']), null)
  // 没带（undefined）与显式 null 都不算错，交给"这一列留空"
  assert.strictEqual(firstBadScalar({ brand: undefined, price: null }, ['brand', 'price']), null)
  // better-sqlite3 实测不认布尔：TypeError "can only bind numbers, strings, bigints, buffers, and null"
  assert.strictEqual(firstBadScalar({ price: true }, ['price']), 'price')
  // 实测不认数组/对象：RangeError "Too few parameter values were provided"
  assert.strictEqual(firstBadScalar({ brand: ['a'] }, ['brand']), 'brand')
  assert.strictEqual(firstBadScalar({ brand: { a: 1 } }, ['brand']), 'brand')
  // NaN/Infinity 是 number，能绑（asNumber 那一层已经把非有限数挡成默认值了）
  assert.strictEqual(firstBadScalar({ price: NaN }, ['price']), null)
  // 按传入顺序报第一个，且 body 为空不炸
  assert.strictEqual(firstBadScalar({ brand: {}, price: [] }, ['brand', 'price']), 'brand')
  assert.strictEqual(firstBadScalar(null, ['brand']), null)
})

test('tally: 用户自填的文本当键也不会丢计数或冒出 NaN', () => {
  const m = tally()
  // 普通 {} 上这两笔都会出事：__proto__ 那笔写进去被引擎静默忽略（件数凭空消失），
  // constructor 那笔读到原型函数、函数+1 得 NaN
  m['__proto__'] = (m['__proto__'] || 0) + 1
  m['constructor'] = (m['constructor'] || 0) + 1
  m['外套'] = (m['外套'] || 0) + 1
  assert.strictEqual(m['__proto__'], 1)
  assert.strictEqual(m['constructor'], 1)
  assert.strictEqual(m['外套'], 1)
  // Object.entries / JSON 都照常，调用方统计口径不变（三笔都在，没有 NaN、没有丢）
  assert.strictEqual(Object.keys(m).length, 3)
  assert.strictEqual(JSON.stringify(m.外套), '1')
  // 没命中的键仍然是 undefined，不会像普通 {} 那样冒出一个函数
  assert.strictEqual(m['toString'], undefined)
})
