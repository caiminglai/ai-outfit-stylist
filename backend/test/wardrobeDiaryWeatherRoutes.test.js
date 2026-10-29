/**
 * 穿搭日记"哪天穿的＋那天多冷"三格的路由行为测试（2026-10-21 第十一阶段·第一步 一f）
 *
 * 规范出处：`docs/依据/19-穿搭日记与天气输入输出规范-20261021.md` §八里**数据来源＝端点**那几格
 * （一致性闸门 400／未来日期 400／非法格式 400／不填⇒NULL 且出账 null）。
 *
 * 为什么单独开一个文件而不并进 `wardrobeDiaryRoutes.test.js`：那四条路由挂的是
 * `routes/wardrobe.js` 里的 `writeLimiter`（windowMs 60000、max 30，按 IP 计），
 * 那个文件现量已经打到 ~21 条写请求，再塞 19 条就会从第 31 条起整片变 429——
 * 断言会从"闸门挡住了畸形值"悄悄换成"闸门挡住了我自己"。`node --test` 每个文件一个进程
 * ⇒ 新文件有自己的一整窗额度，两边都不受影响。
 *
 * 钉七件事（全是**行为**证据：起临时实例真发 HTTP，不是源码级钉桩）：
 *  ⑧ 三格真落库且原样出账（出账对不等于落库对，两样都看）；
 *  ⑨ 日期闸门：未来 400／口语格式 400／"2 月 30 日"这种格式对但日历上没有的 400／早于下限 400；
 *  ⑩ 一致性闸门：体感与档位各说一套 ⇒ 400 且文案说出"应该算"哪一档，两格谁也没被改写；
 *  ⑪ 只填一格合法（缺测那一维整块缺席），不填三格 ⇒ NULL 且出账 `null`（硬规矩 2）；
 *  ⑫ GET 出账带 `weather_levels`，内容与顺序都取自 `services/weatherService.js` 那一份（前端五个按钮同源）；
 *  ⑬ PUT 三态：没提＝不动／`null` 与空串＝清空／只改一格时闸门按**合并后**的行判；
 *  ⑭ 载荷形状畸形（对象／数组）不许进 TEXT 列，被拒时连 NULL 都不许被换成 "[object Object]"。
 *
 * ⛔ 表外档位（"很冷"）与体感量程外（±999℃）也在这里拦成 400：采了命不中任何算式＝白采。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 `test/wardrobeDiaryRoutes.test.js` 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/wardrobeDiaryWeatherRoutes.test.js
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
const wardrobeRoutes = require('../routes/wardrobe')
const { WEATHER_LEVELS } = require('../services/weatherService')
const app = express()
app.use(express.json())
app.use('/api/wardrobe', wardrobeRoutes)

const SESS = 'sess-diary-weather'
let server
let base = ''

async function call(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-session-id': SESS },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

/** 这一条会话里的一件自有衣物：`item_ids` 必须是自有 ID，否则先撞归属闸门、测不到天气这三格 */
let itemId = 0

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve)
  })
  base = `http://127.0.0.1:${server.address().port}/api/wardrobe`
  itemId = memDb
    .prepare(`INSERT INTO user_wardrobe (session_id, name, category) VALUES (?, '灰毛衣', 'top')`)
    .run(SESS).lastInsertRowid
})

test.after(() => {
  if (server) server.close()
})

/** 东八区的今天：与 `utils/outfitWeather.js` 同一把尺子（⛔ 不用 UTC，那是另一套日子） */
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

test('⑧ POST 三格真落库并原样出账（自洽的一条）', async () => {
  const r = await call('POST', '/outfits', {
    name: '降温那天',
    item_ids: [itemId],
    wear_date: '2026-10-18',
    feels_like_c: 3,
    weather_level: '寒冷',
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.wear_date, '2026-10-18')
  assert.equal(r.body.data.feels_like_c, 3)
  assert.equal(r.body.data.weather_level, '寒冷')
  const row = memDb
    .prepare('SELECT wear_date, feels_like_c, weather_level FROM wardrobe_outfits WHERE id = ?')
    .get(r.body.data.id)
  assert.equal(row.wear_date, '2026-10-18', '出账对不等于落库对，两样都要看')
  assert.equal(row.feels_like_c, 3)
  assert.equal(row.weather_level, '寒冷')
})

test('⑨ 日期闸门：未来／口语格式／日历上没有这天／早于下限，四条全 400 且一行不落', async () => {
  const before = memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits').get().n
  const future = await call('POST', '/outfits', {
    name: '记到明天',
    item_ids: [itemId],
    wear_date: '2099-01-01',
  })
  assert.equal(future.status, 400)
  assert.match(future.body.error.message, /不能是未来/)
  const spoken = await call('POST', '/outfits', {
    name: '日期写成口语',
    item_ids: [itemId],
    wear_date: '10月18号',
  })
  assert.equal(spoken.status, 400)
  assert.match(spoken.body.error.message, /YYYY-MM-DD/)
  // "2 月 30 日"格式对但日历上没有：`new Date(Date.UTC(2026,1,30))` 会顺延成 3 月 2 日，
  // 不逐字回读年月日就当合法收进库 ⇒ 偏好层日后按一个不存在的日子分组
  const fakeDay = await call('POST', '/outfits', {
    name: '日历上没有这天',
    item_ids: [itemId],
    wear_date: '2026-02-30',
  })
  assert.equal(fakeDay.status, 400)
  assert.match(fakeDay.body.error.message, /YYYY-MM-DD/)
  const tooEarly = await call('POST', '/outfits', {
    name: '键盘误触',
    item_ids: [itemId],
    wear_date: '1999-01-01',
  })
  assert.equal(tooEarly.status, 400)
  assert.match(tooEarly.body.error.message, /太早/)
  assert.equal(
    memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits').get().n,
    before,
    '四条畸形请求都不该落库',
  )
})

test('⑩ 一致性闸门：体感 30℃ 配「寒冷」⇒ 400 且文案说出该算哪档，两格都没被改写', async () => {
  // 19 §三 第 5 条：前端「取今天」与「手选档」两条路各填一半，就会造出这种永远学不出东西的行。
  // ⛔ 不许以"用户手选的档优先"名义静默改写任何一格 ⇒ 断言落在**库里那两行都没动**上。
  const bad = await call('POST', '/outfits', {
    name: '三十度写寒冷',
    item_ids: [itemId],
    wear_date: '2026-10-18',
    feels_like_c: 30,
    weather_level: '寒冷',
  })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error.message, /应该算/, '光说"不一致"没人能改，要报出按本系统口径是哪档')
  assert.match(bad.body.error.message, /偏热/, '30℃ 落在偏热带（切点 5/14/24/30 的右端点归偏热）')
  assert.equal(
    memDb.prepare('SELECT COUNT(*) AS n FROM wardrobe_outfits WHERE name = ?').get('三十度写寒冷')
      .n,
    0,
  )
  // 档位表外词：采了命不中任何算式＝白采 ⇒ 拦在写入口
  const badLevel = await call('POST', '/outfits', {
    name: '自己造一个档',
    item_ids: [itemId],
    weather_level: '很冷',
  })
  assert.equal(badLevel.status, 400)
  assert.match(badLevel.body.error.message, /weather_level 只能/)
  // 体感不是数字／超出量程：⛔ 空串不当 0℃（那是"今天 0 度"不是"没填"），0℃ 这条单独钉
  const badFeels = await call('POST', '/outfits', {
    name: '体感写成文字',
    item_ids: [itemId],
    feels_like_c: '零下',
  })
  assert.equal(badFeels.status, 400)
  assert.match(badFeels.body.error.message, /只能是一个数字/)
  const outOfRange = await call('POST', '/outfits', {
    name: '体感一千度',
    item_ids: [itemId],
    feels_like_c: 1000,
  })
  assert.equal(outOfRange.status, 400)
  assert.match(outOfRange.body.error.message, /要在 -60 ~ 60℃/)
})

test('⑪ 只填一格合法；三格都不填 ⇒ 库里 NULL 且出账 null（缺测不出分的读侧证据）', async () => {
  const oneCell = await call('POST', '/outfits', {
    name: '只填档位',
    item_ids: [itemId],
    weather_level: '舒适',
  })
  assert.equal(oneCell.status, 200)
  assert.equal(oneCell.body.data.feels_like_c, null, '没填体感＝NULL，⛔ 不许拿 0℃ 顶')
  assert.equal(oneCell.body.data.wear_date, null)
  const none = await call('POST', '/outfits', { name: '老实留空', item_ids: [itemId] })
  assert.equal(none.status, 200)
  const row = memDb
    .prepare('SELECT wear_date, feels_like_c, weather_level FROM wardrobe_outfits WHERE id = ?')
    .get(none.body.data.id)
  for (const k of ['wear_date', 'feels_like_c', 'weather_level']) {
    assert.strictEqual(row[k], null, `${k} 必须是 NULL：⛔ 不许拿 created_at/0℃/猜的档顶替`)
  }
  assert.equal(none.body.data.wear_date, null, '出账也要原样是 null，前端才显示"未记"')
  // 0℃ 是一条真记录，⛔ 与"没填"混成一个值
  const zero = await call('POST', '/outfits', {
    name: '真的零度',
    item_ids: [itemId],
    feels_like_c: 0,
    weather_level: '寒冷',
  })
  assert.equal(zero.status, 200)
  assert.strictEqual(zero.body.data.feels_like_c, 0)
})

test('⑫ 真今天这条收得下（东八区口径，⛔ 不许被 UTC 判成未来）', async () => {
  const r = await call('POST', '/outfits', {
    name: '今天这一身',
    item_ids: [itemId],
    wear_date: todayShanghai(),
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.data.wear_date, todayShanghai())
})

test('⑬ GET 出账带 weather_levels 词表，内容与顺序都取自服务层那一份', async () => {
  const list = await call('GET', '/outfits')
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.data.weather_levels, WEATHER_LEVELS)
  assert.equal(WEATHER_LEVELS.length, 5, '五个档：⛔ 前端抄第二份词表＝改了那边忘了这边')
})

test('⑭ PUT 三态：没提＝不动／null 与空串＝清空／只改一格时闸门按合并后的行判', async () => {
  const r = await call('POST', '/outfits', {
    name: '要被半改的那套',
    item_ids: [itemId],
    wear_date: '2026-10-17',
    feels_like_c: 1,
    weather_level: '寒冷',
  })
  const id = r.body.data.id
  const touch = await call('PUT', `/outfits/${id}`, { notes: '只加了一句备注' })
  assert.equal(touch.status, 200)
  assert.equal(touch.body.data.wear_date, '2026-10-17', '没提这三格就一律不动')
  assert.equal(touch.body.data.weather_level, '寒冷')
  // 只把档位改成炎热、体感留着 1℃ ⇒ 合并后不自洽 ⇒ 400，且库里一个字没动
  const half = await call('PUT', `/outfits/${id}`, { weather_level: '炎热' })
  assert.equal(half.status, 400)
  assert.match(half.body.error.message, /应该算/)
  const afterHalf = memDb
    .prepare('SELECT feels_like_c, weather_level FROM wardrobe_outfits WHERE id = ?')
    .get(id)
  assert.equal(afterHalf.feels_like_c, 1)
  assert.equal(afterHalf.weather_level, '寒冷', '被拒的 PUT 不能只把一半写进去')
  const both = await call('PUT', `/outfits/${id}`, {
    feels_like_c: 31,
    weather_level: '炎热',
  })
  assert.equal(both.status, 200)
  assert.equal(both.body.data.feels_like_c, 31)
  assert.equal(both.body.data.weather_level, '炎热')
  const cleared = await call('PUT', `/outfits/${id}`, {
    wear_date: null,
    feels_like_c: '',
    weather_level: null,
  })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.data.wear_date, null)
  assert.equal(cleared.body.data.feels_like_c, null)
  assert.equal(cleared.body.data.weather_level, null)
})

test('⑮ 载荷形状畸形（对象／数组）400，被拒时那一格连 NULL 都不许被换掉', async () => {
  const r = await call('POST', '/outfits', { name: '形状不对', item_ids: [itemId] })
  const id = r.body.data.id
  const objDate = await call('PUT', `/outfits/${id}`, { wear_date: {} })
  assert.equal(objDate.status, 400)
  const row = memDb.prepare('SELECT wear_date FROM wardrobe_outfits WHERE id = ?').get(id)
  assert.strictEqual(row.wear_date, null, '⛔ `{"wear_date":{}}` 不许原样进 TEXT 列')
  const arrLevel = await call('PUT', `/outfits/${id}`, { weather_level: ['寒冷'] })
  assert.equal(arrLevel.status, 400)
})
