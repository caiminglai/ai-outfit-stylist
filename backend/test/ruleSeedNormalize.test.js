/**
 * 种子规则入库前的归一化（db/applyRuleSeeds.js）
 * ============================================================
 * 10-12 第二十七轮修掉两处：
 *  1) 没写 weight 的种子条件原来存 3，而后台新增条件(routes/rules.js:89)、
 *     后台编辑器初值(admin-rules.js:430)、引擎取不到权重时(recommendEngine.js:302 的兜底 `: 1`)
 *     都是 1 ⇒ 同一句"这条条件没说权重"两条路径意思相反，走种子进来的规则天生重 3 倍。
 *  2) 字段表/动作表按 `TABLE[key]` 读 ⇒ key 写成 constructor/toString 会从原型上捞出真值，
 *     一条本该被判"无效"的规则就混进库了。现在走 ownValue。
 *
 * 全是纯函数检查，不连库。运行: node --test test/ruleSeedNormalize.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const { normalizeCondition, normalizeAction, validateGroup } = require('../db/applyRuleSeeds')

test('种子条件没声明 weight ⇒ 存 1（与后台/引擎同口径，不再是 3）', () => {
  const r = normalizeCondition({ field: 'skin_tone', operator: 'eq', value: '白皙' })
  assert.ok(!r.error, r.error)
  assert.strictEqual(r.weight, 1)
})

test('weight 写了就照写：0/负数/非法值才归 1', () => {
  assert.strictEqual(normalizeCondition({ field: 'skin_tone', value: '白皙', weight: 5 }).weight, 5)
  assert.strictEqual(
    normalizeCondition({ field: 'skin_tone', value: '白皙', weight: '2' }).weight,
    2,
  )
  for (const bad of [0, -3, 'x', null, undefined]) {
    assert.strictEqual(
      normalizeCondition({ field: 'skin_tone', value: '白皙', weight: bad }).weight,
      1,
      `weight=${String(bad)} 应归 1`,
    )
  }
})

test('条件字段查表只认自己的键：constructor / toString 一律判无效', () => {
  for (const field of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const r = normalizeCondition({ field, operator: 'eq', value: 'x' })
    assert.ok(r.error, `${field} 不该被当成合法字段`)
    assert.match(r.error, /条件字段无效/)
  }
})

test('动作类型查表同样只认自己的键', () => {
  for (const type of ['constructor', 'toString', 'valueOf']) {
    const r = normalizeAction({ type, content: '随便一句' }, 0)
    assert.ok(r.error, `${type} 不该有中文标签`)
    assert.match(r.error, /没有中文标签/)
  }
})

test('条件值给对象时只从对象自己的键取，取不到再退回首个自有值', () => {
  const r = normalizeCondition({
    field: 'skin_tone',
    operator: 'eq',
    value: { skin_tone: '暖色调' },
  })
  assert.ok(!r.error, r.error)
  assert.deepStrictEqual(JSON.parse(r.value), { skin_tone: '暖色调' })

  const protoOnly = normalizeCondition({ field: 'skin_tone', operator: 'eq', value: {} })
  assert.ok(!protoOnly.error, protoOnly.error)
  assert.deepStrictEqual(JSON.parse(protoOnly.value), { skin_tone: 'all' }, '空对象 ⇒ all')
})

test('validateGroup 的既有把关没被改坏（无条件/坏 category 仍拒）', () => {
  assert.deepStrictEqual(
    validateGroup({
      key: 'k',
      name: 'n',
      category: '穿搭',
      mode: 'all',
      conditions: [],
      actions: [],
    }),
    ['至少要有 1 条动作', '至少要有 1 条条件(无条件=所有人命中,会淹没现有规则)'],
  )
  assert.deepStrictEqual(validateGroup({ key: '', name: '', category: 'x', mode: 'y' }), [
    '缺少 key',
    '缺少 name',
    'category 只能是 穿搭/妆容/发型/配饰/姿势(当前: x)',
    'mode 只能是 all/store/personal(当前: y)',
    '至少要有 1 条动作',
    '至少要有 1 条条件(无条件=所有人命中,会淹没现有规则)',
  ])
})
