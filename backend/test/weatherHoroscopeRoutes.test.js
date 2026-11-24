/**
 * 天气／星座运势两条路由的行为测试（2026-11-04 改进轮）
 *
 * 为什么现在补这两个文件：全仓 68 份测试文件里，`routes/weather.js` 与 `routes/horoscope.js`
 * 是**仅剩的两份零路由级点名**的路由文件（现量：`grep -rn "routes/weather\|routes/horoscope"
 * test/*.test.js | grep -v weatherHoroscopeRoutes` 回 0 行）。服务层早有 `test/weatherService.test.js`
 * （7 条）与 `test/logicFixes20261013.test.js`（星座取模那 2 条），钉的是"取数与折算对不对"；
 * 这两条**路由**自己那几道门——参数形状、状态码透传、Set 转数组、文案逐字——一条都没验过。
 * 拆开看正好互补：服务层绿不等于路由把服务层的好意图原样送到顾客手上。
 *
 * 为什么要真发 HTTP：这两处的判据全在 `res.status(...)` 那一步（404 会不会被洗成 500、
 * 502 那句"请改用手工选择天气档"到底有没有出门、`allowed_seasons` 出账是 Set 还是数组）。
 * 源码级钉桩读字符串看不出这些，所以按 `test/phase13CollectionRoutes.test.js` 那一套路：
 * 内存库替身＋临时实例（`app.listen(0)`）真发请求。⛔ 不打外网、⛔ 不开活库。
 *
 * 钉十七件事（①~⑩ 天气，⑪~⑰ 星座；十七件事坐在 15 条 test 里——⑦⑧⑨ 是 `/profile`
 * 那一条路由的三档，⑥ 一条里连着比"不带 status／空文案／503"三种上游错误）：
 *  ① 缺 `location`（不带／空串／纯空格三种写法）⇒ 400，文案逐字「缺少 location 参数，请提供城市名称」；
 *  ② `?location[]=北京&location[]=上海` 这类数组查询串 ⇒ 仍走 ① 那条 400，⛔ 404／⛔ 502／⛔ 500，
 *     且上游一次都没被打到（改前 `.toString()` 会把"北京,上海"当城市名去查，报错说"暂不支持"，把人绕进去）；
 *  ③ 正常查询 ⇒ 200＋`data.location` 回显＋上游收到的是**去掉首尾空格**的原文；
 *  ④ 超长的 `location` ⇒ 上游只收到前 40 字（城市名当短文本读，⛔ 拿它当自由文本往下塞）；
 *  ⑤ 名单外的城市 ⇒ 404＋「暂不支持」＋把可选城市念全，⛔ 500（服务层的 `err.status` 必须透传，
 *     前端 `setError(e.message)` 才会显示"城市没收录"而不是含糊的服务器坏了）；
 *  ⑥ 上游抛**不带 status** 的错 ⇒ 500；抛空 `message` 的错 ⇒ 兜底文案「天气查询失败」；
 *  ⑦ `/profile` 同样缺 `location` ⇒ 400；
 *  ⑧ `/profile` 拿到 `feelsLike: null` ⇒ 502＋逐字「上游没有返回可用的体感温度，请改用手工选择天气档」
 *     ＋`error.code === 'BAD_GATEWAY'`（11-02 那道改动的全部意义：⛔ 把"没取到"说成"今天很冷"）；
 *  ⑨ `/profile` 正常 ⇒ `allowed_seasons` 出账是**数组**（Set 不能 JSON 化）、档位与文案与
 *     `services/weatherService.js` 那一份**同源**（这里现取现比，⛔ 在测试里抄一份阈值）；
 *  ⑩ `/profile` 的上游错误同样按 status 透传（⑤ 走的是缺测那一格，这里补"城市没收录"那一格）；
 *  ⑪ `/daily` 不带 `zodiac` ⇒ 200（⛔ 400）＋`available_signs` 12 条＋那句 hint；
 *  ⑫ `?zodiac[]=aries`／空串／纯空格 ⇒ 与 ⑪ 同一档，⛔ 500（改前 `.trim()` 遇到数组当场 TypeError）；
 *  ⑬ `?zodiac=constructor` ⇒ 400 且文案说"无效的星座标识"，⛔ 顺着原型链"通过"再在 service 里炸；
 *  ⑭ 大写标识与小写**出账逐字节相同**（路由自己 `.toLowerCase()`）；
 *  ⑮ 正常查询 ⇒ 七格齐、`zodiac_name` 是中文表里那一份；
 *  ⑯ 服务层抛错 ⇒ 500＋只出门那句「获取运势失败」，⛔ 把内部错误原样漏给顾客；
 *  ⑰ `/list` ⇒ 200＋12 行＋每行四格＋`date` 就是 `beijingDateStr()`（⛔ UTC 日期：
 *     容器没设 TZ，早上那 8 小时会回一个"昨天的日期"）。
 *
 * 天气不打外网：`getWeather` 在 require 路由**之前**包一层可换的替身（`routes/weather.js:11`
 * 是解构导入，晚一步就换不掉）；替身没装时**照送真服务**，⑤⑩ 那两条就靠这条真渠道跑
 * ——城市名单与错误分档仍是 `weatherService` 那一份真相源，这里只顶掉"上网取数"那一步，
 * 而名单外的城市在发出请求**之前**就抛，不会碰网。星座那条线同理，只在⑯临时抛一次。
 *
 * 活库隔离：这两条路由本身不查库，但仍按全屋口径把 `db/init` 换成内存替身，
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/weatherHoroscopeRoutes.test.js
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

const weatherService = require('../services/weatherService')
const horoscopeService = require('../services/horoscopeService')
const { beijingDateStr } = require('../utils/beijingTime')

// ---------- 替身：默认照送真服务，测试里按需临时顶掉 ----------
const realGetWeather = weatherService.getWeather
let weatherStub = null
weatherService.getWeather = (city) => (weatherStub ? weatherStub(city) : realGetWeather(city))

const realDaily = horoscopeService.getDailyHoroscope
let dailyStub = null
horoscopeService.getDailyHoroscope = (sign) => (dailyStub ? dailyStub(sign) : realDaily(sign))

const express = require('express')
const weatherRoutes = require('../routes/weather')
const horoscopeRoutes = require('../routes/horoscope')

const app = express()
app.use('/api/weather', weatherRoutes)
app.use('/api/horoscope', horoscopeRoutes)

let server
let base = ''

async function get(route) {
  const res = await fetch(`${base}${route}`)
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json || {} }
}

/** 上游收到过哪些参数（用来钉"数组查询串根本没被当成城市名"这类"没发生"的事） */
const upstream = { calls: [], location: [] }

/** 一份够真的天气出账：字段名与 `weatherService` 的返回一致 */
function fakeWeather(feelsLike) {
  return {
    city: '北京',
    temperature: 6.4,
    feelsLike,
    humidity: 41,
    windSpeed: 12.1,
    windDirection: '西北',
    windScale: 3,
    weather: '晴',
    level: '偏凉',
  }
}

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}`
})

test.afterEach(() => {
  weatherStub = null
  dailyStub = null
  upstream.calls = []
  upstream.location = []
})

test.after(() => {
  server.close()
  memDb.close()
})

// ===================== 一、天气 routes/weather.js =====================

test('① 缺 location：不带／空串／纯空格三种写法都 400，文案逐字', async () => {
  for (const q of ['', '?location=', '?location=%20%20']) {
    const r = await get(`/api/weather/${q}`)
    assert.strictEqual(r.status, 400, `写法 ${JSON.stringify(q)} 应 400`)
    assert.strictEqual(r.body.success, false)
    assert.strictEqual(r.body.error.message, '缺少 location 参数，请提供城市名称')
    assert.strictEqual(r.body.error.code, 'BAD_REQUEST')
  }
  assert.strictEqual(upstream.calls.length, 0, '三种写法都不该打到上游')
})

test('② 数组查询串＝没填：400，⛔ 把"北京,上海"当城市名去打上游', async () => {
  // qs 把 `location[]=` 解成数组。以前这里 `.toString()` ⇒ "北京,上海" ⇒ 上游报"暂不支持该城市"，
  // 顾客看到的是一句与他输入无关的话。asText 把非文本一律当"没填"。
  weatherStub = async () => {
    upstream.calls.push('stub')
    return fakeWeather(20)
  }
  for (const q of ['?location[]=北京&location[]=上海', '?location=北京&location=上海']) {
    const r = await get(`/api/weather/${q}`)
    assert.strictEqual(r.status, 400, `${q} 应 400（改前这里 404）`)
    assert.strictEqual(r.body.error.message, '缺少 location 参数，请提供城市名称')
  }
  assert.strictEqual(upstream.calls.length, 0, '数组形状不许打到上游')
})

test('③ 正常查询：200＋回显 location＋上游收到去掉首尾空格的原文', async () => {
  weatherStub = async (city) => {
    upstream.calls.push('stub')
    upstream.location.push(city)
    return fakeWeather(3.2)
  }
  const r = await get('/api/weather/?location=%20%E5%8C%97%E4%BA%AC%20')
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.success, true)
  assert.strictEqual(r.body.data.location, '北京', '出账要带上用户查的是哪座城')
  assert.strictEqual(r.body.data.feelsLike, 3.2)
  assert.deepStrictEqual(upstream.location, ['北京'], '上游收到的是 trim 后的原文')
  assert.strictEqual(r.body.message, undefined, '成功侧信封是 {success,data}，无 message')
})

test('④ 超长 location：上游只收到前 40 字', async () => {
  weatherStub = async (city) => {
    upstream.location.push(city)
    return fakeWeather(20)
  }
  const long = '城'.repeat(60)
  const r = await get(`/api/weather/?location=${long}`)
  assert.strictEqual(r.status, 200)
  assert.strictEqual(upstream.location.length, 1)
  assert.strictEqual(upstream.location[0].length, 40, '城市名按短文本读，超长截到 40 字')
  assert.strictEqual(upstream.location[0], '城'.repeat(40))
})

test('⑤ 名单外的城市：404＋说清可选城市，走的是真服务那条渠道', async () => {
  // ⛔ 这里故意不装替身：`weatherService` 在城市表查不到时是**发请求之前**就抛，
  // 所以这条既验了真名单，也不会碰网。它验的是路由有没有把服务层的 404 原样送出去。
  const r = await get('/api/weather/?location=%E4%B8%8D%E5%AD%98%E5%9C%A8%E5%9F%8E')
  assert.strictEqual(r.status, 404, '改前：service 的 404 被这里当成 500 送出去')
  assert.strictEqual(r.body.error.code, 'NOT_FOUND')
  assert.match(r.body.error.message, /^暂不支持「不存在城」/)
  for (const city of weatherService.WEATHER_CITIES) {
    assert.ok(
      r.body.error.message.includes(city),
      `可选城市名单要念全，缺 ${city}（名单真相源＝weatherService.WEATHER_CITIES）`,
    )
  }
})

test('⑥ 上游抛错：不带 status ⇒ 500；空 message ⇒ 兜底那句', async () => {
  weatherStub = async () => {
    throw new Error('上游 HTTP 5xx')
  }
  const plain = await get('/api/weather/?location=北京')
  assert.strictEqual(plain.status, 500, '不带 status 的错只能算我们自己的 500')
  assert.strictEqual(plain.body.error.message, '上游 HTTP 5xx')
  assert.strictEqual(plain.body.error.code, 'INTERNAL_ERROR')

  weatherStub = async () => {
    throw new Error('')
  }
  const blank = await get('/api/weather/?location=北京')
  assert.strictEqual(blank.status, 500)
  assert.strictEqual(blank.body.error.message, '天气查询失败', '空文案要有兜底，⛔ 回一句空话')

  // 503（上游连不上）也照 status 走，⛔ 与 500 混成一档
  weatherStub = async () => {
    const e = new Error('天气服务暂时不可用')
    e.status = 503
    throw e
  }
  const unavailable = await get('/api/weather/?location=北京')
  assert.strictEqual(unavailable.status, 503)
  assert.strictEqual(unavailable.body.error.code, 'SERVICE_UNAVAILABLE')
})

test('⑦⑧⑨ /profile：缺参 400／缺测 502／正常档与真相源同源', async () => {
  // ⑦ 缺 location：与 GET / 同一句文案（同一把尺子读参数）
  const missing = await get('/api/weather/profile')
  assert.strictEqual(missing.status, 400)
  assert.strictEqual(missing.body.error.message, '缺少 location 参数，请提供城市名称')

  // ⑧ 上游没回可用体感温度 ⇒ 502 说破，⛔ 替用户编一个档位
  weatherStub = async () => {
    const w = fakeWeather(null)
    delete w.feelsLike
    return w
  }
  const noFeels = await get('/api/weather/profile?location=北京')
  assert.strictEqual(noFeels.status, 502)
  assert.strictEqual(noFeels.body.error.code, 'BAD_GATEWAY')
  assert.strictEqual(noFeels.body.error.message, '上游没有返回可用的体感温度，请改用手工选择天气档')
  assert.strictEqual(noFeels.body.success, false, '这一档不许半套出账')

  // ⑨ 正常出账：allowed_seasons 必须是数组（Set JSON 化会变成 {"0":"冬"}），
  // 档位与文案与 weatherService 那一份现取现比——⛔ 在本文件抄一份阈值
  weatherStub = async () => fakeWeather(1.0)
  const ok = await get('/api/weather/profile?location=北京')
  assert.strictEqual(ok.status, 200)
  const profile = ok.body.data.profile
  const truth = weatherService.buildTemperatureProfile(1.0)
  assert.ok(truth, '真相源本身要出得来，否则下面等于没比')
  assert.strictEqual(profile.level, truth.level)
  assert.strictEqual(profile.advice, truth.advice)
  assert.ok(Array.isArray(profile.allowed_seasons), '出账的 allowed_seasons 要能 JSON 化')
  assert.deepStrictEqual(profile.allowed_seasons, Array.from(truth.allowed_seasons))
  assert.ok(weatherService.WEATHER_LEVELS.includes(profile.level), '档位必须在五档词表内')
  assert.strictEqual(ok.body.data.weather.location, '北京', 'profile 出账带的是那一屏的天气')
  assert.strictEqual(ok.body.data.weather.feelsLike, 1.0)

  // 真相源不许被这次请求改写坏：Set 转数组发生在**返回值的副本**上
  const again = weatherService.buildTemperatureProfile(1.0)
  assert.ok(again.allowed_seasons instanceof Set, '⛔ 把共享策略表里的 Set 换成数组')
})

test('⑩ /profile 的上游错误同样按 status 透传', async () => {
  const r = await get('/api/weather/profile?location=%E4%B8%8D%E5%AD%98%E5%9C%A8%E5%9F%8E')
  assert.strictEqual(r.status, 404, '城市没收录在 profile 那侧也一样是 404，⛔ 500')
  assert.strictEqual(r.body.error.code, 'NOT_FOUND')
  assert.match(r.body.error.message, /^暂不支持「/)
})

// ===================== 二、星座运势 routes/horoscope.js =====================

test('⑪ /daily 不带参数：200＋12 条可选星座＋那句 hint', async () => {
  const r = await get('/api/horoscope/daily')
  assert.strictEqual(r.status, 200, '少参数是"提示怎么用"，不是"你错了"')
  assert.deepStrictEqual(
    r.body.data.available_signs,
    Object.keys(horoscopeService.ZODIAC_NAMES),
    '可选清单与真相源同源（前端那 12 个按钮照这一份渲染）',
  )
  assert.strictEqual(r.body.data.available_signs.length, 12)
  assert.deepStrictEqual(r.body.data.sign_names, horoscopeService.ZODIAC_NAMES)
  assert.strictEqual(r.body.data.hint, '请使用 ?zodiac=aries 查询指定星座运势')
  assert.strictEqual(r.body.message, '请指定星座参数')
})

test('⑫ 数组／空串／纯空格 zodiac：与⑪同一档，⛔ 500', async () => {
  for (const q of [
    '?zodiac[]=aries',
    '?zodiac=',
    '?zodiac=%20',
    '?zodiac[]=aries&zodiac[]=taurus',
  ]) {
    const r = await get(`/api/horoscope/daily${q}`)
    assert.strictEqual(
      r.status,
      200,
      `${q} 应落回"请指定星座参数"（改前 .trim() 遇数组 TypeError）`,
    )
    assert.strictEqual(r.body.message, '请指定星座参数')
    assert.strictEqual(r.body.data.hint, '请使用 ?zodiac=aries 查询指定星座运势')
  }
})

test('⑬ ?zodiac=constructor：400 说"无效的星座标识"，⛔ 顺原型链通过', async () => {
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await get(`/api/horoscope/daily?zodiac=${key}`)
    assert.strictEqual(r.status, 400, `${key} 不是星座，不许进 service`)
    // 文案里是**规范化后**的那份（路由先 toLowerCase 再查表）：`toString` 念成 `tostring`。
    // 实测读数，不是笔误——顾客照着这句改大写再试也不会被绕开；这里钉住它，⛔ 日后
    // 有人把这句换成"原始输入"却把大小写敏感的问题引进来。
    assert.ok(
      r.body.error.message.startsWith(`无效的星座标识: ${key.toLowerCase()}`),
      `文案要点名是哪个键，实测 ${JSON.stringify(r.body.error.message)}`,
    )
    assert.match(r.body.error.message, /可选: aries/, '顺手把可选值念全，省得顾客再猜一轮')
  }
})

test('⑭ 大小写：出账逐字节相同', async () => {
  const lower = await get('/api/horoscope/daily?zodiac=aries')
  const upper = await get('/api/horoscope/daily?zodiac=ARIES')
  const mixed = await get('/api/horoscope/daily?zodiac=%20Aries%20')
  for (const r of [lower, upper, mixed]) {
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.data.zodiac_sign, 'aries', '路由自己 lowercase＋service 再 trim')
  }
  assert.deepStrictEqual(upper.body.data, lower.body.data)
  assert.deepStrictEqual(mixed.body.data, lower.body.data)
})

test('⑮ 正常查询：七格齐＋中文名取自那张表', async () => {
  const r = await get('/api/horoscope/daily?zodiac=aries')
  assert.strictEqual(r.status, 200)
  assert.deepStrictEqual(Object.keys(r.body.data).sort(), [
    'lucky_color',
    'lucky_number',
    'mood',
    'suggestion',
    'summary',
    'zodiac_name',
    'zodiac_sign',
  ])
  assert.strictEqual(r.body.data.zodiac_name, horoscopeService.ZODIAC_NAMES.aries)
  assert.strictEqual(r.body.data.zodiac_name, '白羊座')
  const truth = realDaily('aries')
  assert.deepStrictEqual(r.body.data, truth, '路由出账与 service 逐字段相同，中间不许加工')
})

test('⑯ 服务层抛错：500＋只出门那句人话', async () => {
  dailyStub = () => {
    throw new Error('内部：某某字段 undefined 在第 37 行')
  }
  const r = await get('/api/horoscope/daily?zodiac=aries')
  assert.strictEqual(r.status, 500)
  assert.strictEqual(r.body.success, false)
  assert.strictEqual(r.body.error.message, '获取运势失败', '⛔ 把内部错误原样漏给顾客')
  assert.strictEqual(r.body.error.code, 'INTERNAL_ERROR')
})

test('⑰ /list：200＋12 行＋四格＋date 用北京时间', async () => {
  const r = await get('/api/horoscope/list')
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.message, '获取运势列表成功')
  assert.strictEqual(r.body.data.date, beijingDateStr(), '⛔ toISOString 的 UTC 日期：早上回昨天')
  const rows = r.body.data.horoscopes
  assert.strictEqual(rows.length, 12, '12 星座一行不许少')
  assert.deepStrictEqual(
    rows.map((one) => one.zodiac_sign),
    Object.keys(horoscopeService.ZODIAC_NAMES),
    '顺序就是那张表自己的顺序（前端照顺序渲染 12 个卡片）',
  )
  for (const one of rows) {
    assert.deepStrictEqual(Object.keys(one).sort(), [
      'lucky_color',
      'mood',
      'zodiac_name',
      'zodiac_sign',
    ])
  }
  // 概要里的每一行都要与逐条查询给同一份答案（同源，⛔ 两套文案）
  const detail = await get('/api/horoscope/daily?zodiac=leo')
  const brief = rows.find((one) => one.zodiac_sign === 'leo')
  assert.strictEqual(brief.mood, detail.body.data.mood)
  assert.strictEqual(brief.lucky_color, detail.body.data.lucky_color)
})
