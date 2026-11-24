/**
 * 天气服务（services/weatherService.js）
 * ============================================================
 * 10-12 第二十七轮改的口径：取不到就明确报错，不再编一份"22°C / 湿度 60 / 风力 2 级"。
 * 原先两处静默兜底（城市没收录、上游请求失败）都回 defaultWeather()，
 * 前端拿到假数照样生成穿衣策略 ⇒ 把"没查到"说成"今天体感 22 度"。
 *
 * 这份测试全程不联网：fetch 由测试自己换成桩。
 * 运行: node --test test/weatherService.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const {
  getWeather,
  buildTemperatureProfile,
  levelFromFeelsLike,
  WEATHER_LEVELS,
} = require('../services/weatherService')

const realFetch = globalThis.fetch

/** 造一个只回指定 current 字段的假上游 */
function stubFetch(current, opts = {}) {
  globalThis.fetch = async () => {
    if (opts.networkError) throw new Error('stub: 网络断了')
    if (opts.httpStatus && opts.httpStatus >= 400) {
      return { ok: false, status: opts.httpStatus }
    }
    return { ok: true, status: 200, json: async () => ({ current }) }
  }
}

const 完整 = {
  temperature_2m: 5.2,
  apparent_temperature: 2.1,
  relative_humidity_2m: '71',
  weather_code: 3,
  wind_speed_10m: 12,
  wind_direction_10m: 180,
}

test('城市没收录 ⇒ 抛 404 并说清可选城市，不发请求也不回假天气', async () => {
  let called = 0
  globalThis.fetch = async () => {
    called += 1
    return { ok: true, status: 200, json: async () => ({ current: 完整 }) }
  }
  try {
    const err = await getWeather('镇安县').then(
      () => null,
      (e) => e,
    )
    assert.ok(err, '必须抛错，不能再返回一个天气对象')
    assert.strictEqual(err.status, 404)
    assert.match(err.message, /暂不支持/)
    assert.match(err.message, /北京/)
    assert.strictEqual(called, 0, '查不到城市就不该去打上游')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('上游正常 ⇒ 出实测数（字符串湿度要转成数，温度只取整到 1 位）', async () => {
  stubFetch(完整)
  try {
    const w = await getWeather('北京')
    assert.strictEqual(w.temperature, 5.2)
    assert.strictEqual(w.feelsLike, 2.1)
    assert.strictEqual(w.humidity, 71)
    assert.strictEqual(w.condition, '阴')
    assert.strictEqual(w.windDir, '南')
    assert.ok(Number.isInteger(w.windScale))
  } finally {
    globalThis.fetch = realFetch
  }
})

test('上游少回气温/体感 ⇒ 抛 502，不再补 22 这个假想值', async () => {
  stubFetch({ relative_humidity_2m: 40, weather_code: 1 })
  try {
    const err = await getWeather('上海').then(
      () => null,
      (e) => e,
    )
    assert.ok(err, '缺气温必须报错')
    assert.strictEqual(err.status, 502)
    assert.match(err.message, /不完整/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('湿度/风缺测 ⇒ 那两格是 null，不编 60% 与 2 级，穿衣策略照出', async () => {
  stubFetch({ temperature_2m: 30, apparent_temperature: 33, weather_code: 0 })
  try {
    const w = await getWeather('广州')
    assert.strictEqual(w.humidity, null)
    assert.strictEqual(w.windScale, null)
    assert.strictEqual(w.windDir, '未知')
    assert.strictEqual(w.condition, '晴')
    const p = buildTemperatureProfile(w.feelsLike)
    assert.ok(p.level, '穿衣档位照常给（这条只依赖体感温度）')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('上游连不上/HTTP 5xx ⇒ 503，说"暂时不可用"而不是假装晴天', async () => {
  stubFetch(null, { networkError: true })
  try {
    const err = await getWeather('成都').then(
      () => null,
      (e) => e,
    )
    assert.strictEqual(err.status, 503)
    assert.match(err.message, /暂时不可用/)
  } finally {
    globalThis.fetch = realFetch
  }

  stubFetch(null, { httpStatus: 500 })
  try {
    const err = await getWeather('重庆').then(
      () => null,
      (e) => e,
    )
    assert.strictEqual(err.status, 503)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('取失败不写缓存：下一次仍然会打上游', async () => {
  let called = 0
  globalThis.fetch = async () => {
    called += 1
    throw new Error('stub: 又断了')
  }
  try {
    await assert.rejects(getWeather('武汉'))
    await assert.rejects(getWeather('武汉'))
    assert.strictEqual(called, 2)
  } finally {
    globalThis.fetch = realFetch
  }
})

// ============================================================
// 10-22 第十三阶段·第一步：档位折算的值域闸（`21` §四·1 接线时实测出来的短板）
// 改前 `Number(null)`／`Number('')`／`Number([])`／`Number(false)` 全是 0，一律落进
// "≤5°C ⇒ 寒冷"。而 `feels_like_c` 没填时库里就是 NULL ⇒ `collabFilter.js:199` 与
// `wearPreference.js:247` 那两处"人没选档就现推"会把一条什么都没填的日记判成"寒冷天穿的"。
// ⛔ 真 0°C 不许跟着一起被抹成没填——那是数值，不是缺测。
// ============================================================

test('levelFromFeelsLike：⛔ 空值／非数值一律不出档（只有真是数或数字字符串才折）', () => {
  const 应回null = [null, undefined, '', '   ', NaN, true, false, [], {}, [3], { 值: 3 }]
  for (const v of 应回null) {
    assert.strictEqual(
      levelFromFeelsLike(v),
      null,
      `「${String(v)}」不是温度读数，不许退成任何一档（退档＝编造天气）`,
    )
  }
  // 五档本身照旧（四刀 [5,14,24,30]，边界值归低档）
  const 档位表 = [
    [-30, '寒冷'],
    [5, '寒冷'],
    [5.1, '偏凉'],
    [14, '偏凉'],
    [20, '舒适'],
    [30, '偏热'],
    [30.5, '炎热'],
    ['2.1', '寒冷'],
    [0, '寒冷'],
  ]
  for (const [input, want] of 档位表) {
    assert.strictEqual(levelFromFeelsLike(input), want, `${String(input)}°C 该是「${want}」`)
    assert.ok(WEATHER_LEVELS.includes(want))
  }
  // 上面那句"退档＝编造天气"在 buildTemperatureProfile 那一层同样成立
  assert.strictEqual(levelFromFeelsLike(null), null, '给 buildTemperatureProfile 传的也是同一个闸')
})
