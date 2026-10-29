/**
 * 北京时间工具（utils/beijingTime.js）与两处协议字段
 * ============================================================
 * 站3 的容器没设 TZ（实测 `date` 回 UTC），所以任何直接读本地时间的"今天/这一秒"
 * 都不是顾客所在的那一天。这一轮把支付宝 timestamp、两渠道的商户单号、
 * 星座运势的"今天"、季节判定都接到这一把尺子上。
 *
 * 断言全部用固定 UTC 时刻，不依赖本机时区。
 * 运行: node --test test/beijingTime.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const {
  beijingParts,
  beijingDateStr,
  beijingStamp,
  beijingTimestamp,
  beijingMonth,
} = require('../utils/beijingTime')
const { getCurrentSeason } = require('../utils/common')
const { alipayTimestamp } = require('../services/alipay')

test('UTC 16:00 ⇒ 北京次日 00:00（跨日界那一档）', () => {
  const at = new Date('2026-10-11T16:00:00Z')
  assert.strictEqual(beijingDateStr(at), '2026-10-12')
  assert.strictEqual(beijingTimestamp(at), '2026-10-12 00:00:00')
  assert.strictEqual(beijingStamp(at), '20261012000000')
  assert.strictEqual(beijingMonth(at), 10)
  // 对照组：老写法拿 UTC 就是 10-11，这正是早上那 8 小时看错"今天"的成因
  assert.strictEqual(at.toISOString().split('T')[0], '2026-10-11')
})

test('UTC 上午 ⇒ 北京下午（同一日，不受容器时区影响）', () => {
  const at = new Date('2026-10-12T00:30:15Z')
  assert.strictEqual(beijingParts(at).hour, '08')
  assert.strictEqual(beijingTimestamp(at), '2026-10-12 08:30:15')
})

test('年末年初与月末的边界', () => {
  const at = new Date('2025-12-31T15:59:59Z') // 北京 2025-12-31 23:59:59
  assert.strictEqual(beijingTimestamp(at), '2025-12-31 23:59:59')
  const next = new Date('2025-12-31T16:00:00Z') // 北京 2026-01-01 00:00:00
  assert.strictEqual(beijingDateStr(next), '2026-01-01')
  assert.strictEqual(beijingMonth(next), 1)
})

test('支付宝 timestamp 就是这一把尺子（协议要求东八区）', () => {
  assert.strictEqual(alipayTimestamp(new Date('2026-10-11T16:00:00Z')), '2026-10-12 00:00:00')
})

test('季节判定按北京月份：UTC 还在 2/5 月的那一晚，北京已换季', () => {
  // 只断"按北京月份走"这件事
  assert.strictEqual(getCurrentSeason(new Date('2026-03-01T02:00:00Z')), '春') // 北京 03-01 10:00
  assert.strictEqual(getCurrentSeason(new Date('2026-02-28T17:00:00Z')), '春') // 北京已是 03-01 01:00
  assert.strictEqual(getCurrentSeason(new Date('2026-05-31T17:00:00Z')), '夏') // 北京已是 06-01 01:00
  assert.strictEqual(getCurrentSeason(new Date('2026-06-01T02:00:00Z')), '夏')
  assert.strictEqual(getCurrentSeason(new Date('2026-01-15T04:00:00Z')), '冬')
})
