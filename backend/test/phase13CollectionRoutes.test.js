/**
 * 采集轴两处断点的行为测试（2026-10-22 第十三阶段·第一步 一d）
 *
 * 规范出处：`docs/依据/21-算法四轴输入输出规范-20261021.md` §八 第 9~11 格
 * （天气进推荐＝只当这一屏的输入、星可以撤＝只删自己那一行）。
 *
 * 为什么单独开一个文件：`/engine` 挂的 `recommendLimiter` 是 20 次/分钟、
 * `/feedback/*` 挂的是 60 次/分钟，两把桶都按 IP 计。本文件要打 6 次引擎 + ~10 次反馈，
 * 塞进 `itemFeedback.test.js` 会把两边的额度叠到同一窗里、从某一条起整片变 429，
 * 断言会从"闸门挡住了畸形值"悄悄换成"闸门挡住了我自己"。`node --test` 每文件一个进程
 * ⇒ 新文件有自己一整窗额度。
 *
 * 钉十二件事（全是**行为**证据：内存库替身＋临时实例真发 HTTP，⛔ 源码级钉桩）：
 *  ① 带 `city` 且取到了 ⇒ 200＋`weather_source:'live'`＋注入给引擎的那一格落在五档词表内；
 *  ② 名单外的城市 ⇒ 200＋`weather_source:'failed'`＋原话回显 10 城名单，⛔ 400、⛔ 500，
 *     名单本身照常出（fail-open）；
 *  ③ 上游炸了／回了量不出档的体感温度 ⇒ 同样是 200＋'failed'，引擎那一格一个天气字段都不带；
 *  ④ 不带 `city` ⇒ 响应里 `weather_source`／`weather_notice` **两个键都不存在**
 *     （§八·9 那条"逐字节相同"的结构形态；真·字节对照在 5001 实例那一轮做）；
 *  ⑤ 只当这一屏：带 `city` 打完这一次推荐，`recommendation_logs.input_snapshot` 里
 *     ⛔ 查不到 `weather_level`／`feels_like_c`（`loadPrefill` 会把整份快照回吐成下次的预填），
 *     登录态那份长期档案（`saveArchive` 的两份白名单）也收不到它；
 *  ⑥~⑪ 删星六档：自己的行 ⇒ `deleted:1` 且复读那把星回未评／重复点 ⇒ 200＋`deleted:0`（幂等）／
 *     别人的衣服 ⇒ **404**（⛔ 403，越权口径与 POST 同源）／没身份 ⇒ 401／id 形状不对 ⇒ 400／
 *     ⛔ 不碰 `feedback_events`、⛔ 不回滚 `rule_groups` 的好评差评数。
 *
 * 天气不打外网：`getWeather` 在 require 路由**之前**换成可控替身
 * （`routes/recommend.js:35` 是解构导入，晚一步就换不掉）。城市名单与五档折算
 * 仍用 `weatherService` 那一份真相源，替身只顶掉"上网取数"这一步。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 test/itemFeedback.test.js 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/phase13CollectionRoutes.test.js
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

// 场合词表：与规则库同源（`itemFeedback.occasionValues()` 每次现取，这里造出同样的五行）
for (const occ of ['上班通勤', '约会聚会', '婚礼宴会', '运动健身', '居家休闲']) {
  const gid = memDb
    .prepare(`INSERT INTO rule_groups (name, category, priority) VALUES (?, 'occasion', 1)`)
    .run(`采集轴词表-${occ}`).lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO rule_conditions (group_id, field, operator, value)
       VALUES (?, 'occasion', 'eq', ?)`,
    )
    .run(gid, JSON.stringify(occ))
}

const weatherService = require('../services/weatherService')
const engine = require('../services/recommendEngine')

// ---------- 天气替身：只顶掉"上网取数"，⛔ 不改城市名单与档位折算那两份真相源 ----------
let weatherStub = null
const realGetWeather = weatherService.getWeather
weatherService.getWeather = async (city) => weatherStub(city)
void realGetWeather

/** 引擎收到的那份 merged profile 从这里取证（同样是 require 路由之前包好） */
const captured = { profile: null, calls: 0 }
const realBuild = engine.buildRecommendation
engine.buildRecommendation = (...args) => {
  captured.profile = args[0]
  captured.calls += 1
  return realBuild(...args)
}

const express = require('express')
const recommendRoutes = require('../routes/recommend')
const { saveArchive, loadArchive } = require('../services/profileArchive')
const { actorKeyOf } = require('../services/itemFeedback')

const app = express()
app.use(express.json())
app.use('/api/recommend', recommendRoutes)

const SESS_A = 'sess-phase13-a'
const SESS_B = 'sess-phase13-b'

function seedWardrobe() {
  const ins = memDb.prepare(
    `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type)
     VALUES (?, ?, 'top', ?, ?)`,
  )
  return {
    a1: ins.run(SESS_A, '雾霾蓝衬衫', '雾霾蓝', '合身').lastInsertRowid,
    b1: ins.run(SESS_B, '别人的白衬衫', '白色', '合身').lastInsertRowid,
  }
}
const ITEMS = seedWardrobe()

let server
let base = ''

async function call(method, route, body, session = SESS_A) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'X-Session-Id': session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json || {} }
}

/** 引擎那一格里跟天气有关的键（用来钉"一个都没带进去"） */
const WEATHER_KEYS = ['weather_level', 'feels_like_c']
function weatherKeysOn(p) {
  if (!p) return []
  return WEATHER_KEYS.filter((k) => p[k] !== undefined)
}

const PROFILE = { gender: 'female', age_range: '18-25', skin_tone: 'warm' }

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${server.address().port}/api/recommend`
})

test.after(() => {
  server.close()
  memDb.close()
})

// ============================================================
// §八·9 天气断点（四档：live / 名单外 / 取不到 / 没带）
// ============================================================

test('§八·9 带 city 且取到 ⇒ 200＋live＋注入给引擎的那一格在五档词表内', async () => {
  weatherStub = async () => ({ city: '北京', feelsLike: 3 })
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: '北京' })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body).slice(0, 300))
  assert.strictEqual(r.body.data.weather_source, 'live')
  const lvl = captured.profile.weather_level
  assert.ok(
    weatherService.WEATHER_LEVELS.includes(lvl),
    `注入的天气档必须在 ${weatherService.WEATHER_LEVELS.join('/')} 里，收到 ${JSON.stringify(lvl)}`,
  )
  assert.strictEqual(lvl, '寒冷', '体感 3°C 落在第一刀（≤5°C）那档——档位由那一份尺子折算')
  assert.strictEqual(captured.profile.feels_like_c, 3, '体感原值要带给偏好层那道一致性闸门用')
  assert.ok(r.body.data.recommendation, '名单照常出')
})

test('§八·9 名单外的城市 ⇒ 200＋failed＋名单逐字回显，⛔ 不进引擎', async () => {
  let touched = false
  weatherStub = async () => {
    touched = true
    return { feelsLike: 20 }
  }
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: '燕城' })
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.data.weather_source, 'failed')
  assert.strictEqual(touched, false, '名单外连一次网都不许出——闸门在取数之前')
  const notice = r.body.data.weather_notice
  assert.ok(notice.includes('「燕城」'), `要把他写的城市名原样回显：${notice}`)
  assert.ok(
    notice.includes(weatherService.WEATHER_CITIES.join('、')),
    `必须逐字回显那 10 城（真相源只有一份）：${notice}`,
  )
  assert.strictEqual(
    weatherKeysOn(captured.profile).length,
    0,
    'failed 时一个天气字段都不许带进引擎',
  )
})

test('§八·9 上游炸了 ⇒ fail-open：200＋failed，推荐照出', async () => {
  weatherStub = async () => {
    throw new Error('天气服务暂时连不上')
  }
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: '上海' })
  assert.strictEqual(r.status, 200, '⛔ 天气取不到不该把推荐打挂，也不该把 502/503 透给顾客')
  assert.strictEqual(r.body.data.weather_source, 'failed')
  assert.match(r.body.data.weather_notice, /天气服务暂时连不上/)
  assert.match(r.body.data.weather_notice, /本次不带天气档，名单不受影响/)
  assert.strictEqual(weatherKeysOn(captured.profile).length, 0)
})

test('§八·9 体感温度量不出档 ⇒ failed＋一句人话，⛔ 不兜底成 22°C', async () => {
  weatherStub = async () => ({ city: '广州', feelsLike: null })
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: '广州' })
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.data.weather_source, 'failed')
  assert.match(r.body.data.weather_notice, /没回可用的体感温度/)
  assert.strictEqual(weatherKeysOn(captured.profile).length, 0)
})

test('§八·9 不带 city ⇒ 那两个键整个不存在（响应形状与改前一致）', async () => {
  weatherStub = async () => {
    throw new Error('没带 city 不该走到这一步')
  }
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal' })
  assert.strictEqual(r.status, 200)
  assert.ok(!('weather_source' in r.body.data), '⛔ 没带 city 也不写键＝凭空多两个字段')
  assert.ok(!('weather_notice' in r.body.data))
  assert.strictEqual(weatherKeysOn(captured.profile).length, 0)
})

test('§八·9 city 传空串／空格＝没带：⛔ 不许当成名单外去多回两个键', async () => {
  weatherStub = async () => ({ feelsLike: 8 })
  for (const bad of ['', '   ', null, undefined]) {
    const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: bad })
    assert.strictEqual(r.status, 200, JSON.stringify(bad))
    assert.ok(
      !('weather_source' in r.body.data),
      `city＝${JSON.stringify(bad)} 按"没带"处理，实际回了 ${JSON.stringify(r.body.data.weather_source)}`,
    )
  }
})

// ============================================================
// §八·10 天气只当这一屏的输入（⛔ 不进快照、⛔ 不进长期档案）
// ============================================================

test('§八·10 带 city 打完一次推荐 ⇒ input_snapshot 里查不到那两格', async () => {
  weatherStub = async () => ({ city: '北京', feelsLike: -2 })
  const before = memDb.prepare('SELECT COUNT(*) AS n FROM recommendation_logs').get().n
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal', city: '北京' })
  assert.strictEqual(r.body.data.weather_source, 'live')
  const after = memDb.prepare('SELECT COUNT(*) AS n FROM recommendation_logs').get().n
  // X-Session-Id 形状合法 ⇒ optionalUser 补游客档 ⇒ 这一条是有身份的，本来就该落一行样本
  assert.strictEqual(after, before + 1, '本用例要靠这一行快照取证，没落库就等于什么都没验')
  const snap = memDb
    .prepare('SELECT input_snapshot FROM recommendation_logs ORDER BY id DESC LIMIT 1')
    .get().input_snapshot
  const parsed = JSON.parse(snap)
  for (const k of WEATHER_KEYS) {
    assert.ok(
      !(k in parsed),
      `⛔ 天气是我们这拍替他取的，不许留在快照里被 loadPrefill 当成他填的档：${k}`,
    )
  }
  assert.strictEqual(parsed.gender, 'female', '其余字段照旧进快照（只剥那两格）')
  // 衣橱与日记那些表一行都不该因为带 city 而变
  assert.strictEqual(
    memDb.prepare('SELECT COUNT(*) AS n FROM user_wardrobe').get().n,
    Object.keys(ITEMS).length,
  )
})

test('§八·10 长期档案那份白名单收不到天气（saveArchive 存进去＝口径破了）', () => {
  // schema.sql:9 有 `PRAGMA foreign_keys=ON` ⇒ 得先有一条真用户，不能随手指一个不存在的 id
  const uid = memDb
    .prepare(
      `INSERT INTO users (session_id, nickname) VALUES ('sess-phase13-archive', '采集轴档案测试')`,
    )
    .run().lastInsertRowid
  saveArchive(uid, { weather_level: '寒冷', feels_like_c: -2, height: 165, gender: 'female' })
  const back = loadArchive(uid)
  for (const k of WEATHER_KEYS) {
    assert.ok(!(k in back), `⛔ ${k} 不该从长期档案里读回来`)
  }
  assert.strictEqual(back.height, 165, '身高那一格照常存（证明不是整个函数没跑）')
})

// ============================================================
// §四·2 / §八·11 衣橱的星可以撤
// ============================================================

async function star(itemId, session = SESS_A) {
  return call(
    'POST',
    '/feedback/item',
    { wardrobe_item_id: itemId, aesthetic_score: 4, fit_score: 5 },
    session,
  )
}

function feedbackRow(itemId, session) {
  // 星落在哪个 actor_key 下**不是**测试想当然：路由用 `optionalUser`，它对形状合法的会话 id
  // 会 `INSERT OR IGNORE INTO users` 补一条游客档（middleware/auth.js:56），于是访客落 `'u'+id`；
  // 只有过不了 /^[A-Za-z0-9_-]{8,64}$/ 的会话才退到 's'+session（与 itemFeedback.test.js 同一把尺子）。
  const u = memDb.prepare('SELECT id FROM users WHERE session_id = ?').get(session)
  const key = actorKeyOf(u ? { userId: u.id } : { sessionId: session })
  return memDb
    .prepare('SELECT * FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?')
    .get(key, itemId)
}

test('§八·11 打自己的行 ⇒ deleted:1，复读那把星回未评', async () => {
  const w = await star(ITEMS.a1)
  assert.strictEqual(w.status, 200, JSON.stringify(w.body).slice(0, 200))
  assert.ok(feedbackRow(ITEMS.a1, SESS_A), '打完星库里要有行，否则下面那条删除什么都没验')
  const g1 = await call('GET', `/feedback/items?ids=${ITEMS.a1}`)
  assert.strictEqual(g1.body.data.items.length, 1)

  const d = await call('DELETE', `/feedback/item?wardrobe_item_id=${ITEMS.a1}`)
  assert.strictEqual(d.status, 200)
  assert.strictEqual(d.body.data.deleted, 1)
  assert.strictEqual(d.body.data.wardrobe_item_id, ITEMS.a1)
  assert.strictEqual(feedbackRow(ITEMS.a1, SESS_A), undefined)
  const g2 = await call('GET', `/feedback/items?ids=${ITEMS.a1}`)
  assert.strictEqual(
    g2.body.data.items.length,
    0,
    '前端回填读的是这个口 ⇒ 点完清除两把星必须回未评态',
  )
})

test('§八·11 重复点"清除" ⇒ 200＋deleted:0（幂等，⛔ 第二遍报错）', async () => {
  const again = await call('DELETE', `/feedback/item?wardrobe_item_id=${ITEMS.a1}`)
  assert.strictEqual(again.status, 200)
  assert.strictEqual(again.body.data.deleted, 0)
  assert.match(again.body.message, /本来就没有/)
})

test('§八·11 别人的衣服 ⇒ 404（⛔ 403：那等于承认这一行存在）', async () => {
  const r = await call('DELETE', `/feedback/item?wardrobe_item_id=${ITEMS.b1}`)
  assert.strictEqual(r.status, 404)
  assert.strictEqual(r.body.success, false)
  assert.strictEqual(r.body.error.code, 'NOT_FOUND')
  assert.ok(feedbackRow(ITEMS.b1, SESS_B) === undefined)
  // B 那一件本身不许被动到
  assert.ok(memDb.prepare('SELECT id FROM user_wardrobe WHERE id = ?').get(ITEMS.b1))
})

test('§八·11 认不出身份 ⇒ 401（⛔ 不许匿名删）', async () => {
  const r = await call('DELETE', `/feedback/item?wardrobe_item_id=${ITEMS.a1}`, undefined, null)
  assert.strictEqual(r.status, 401)
  assert.match(r.body.error.message, /识别不出你是谁/)
})

test('§八·11 id 形状不对 ⇒ 400，⛔ 不拿它去拼一条 SQL', async () => {
  for (const bad of ['abc', '0', '-3', '1.5', '', '99999999999999999999']) {
    const r = await call('DELETE', `/feedback/item?wardrobe_item_id=${bad}`)
    assert.strictEqual(r.status, 400, `id＝${JSON.stringify(bad)} 该 400，实际 ${r.status}`)
  }
  // 库里没这个 id（但形状对）⇒ 与"不是你的"同一口径：404
  const gone = await call('DELETE', '/feedback/item?wardrobe_item_id=424242')
  assert.strictEqual(gone.status, 404)
})

test('§八·11 删星不碰 feedback_events、不回滚 rule_groups 的好评差评数', async () => {
  const gid = memDb
    .prepare(
      `INSERT INTO rule_groups (name, category, priority, feedback_up, feedback_down)
       VALUES ('采集轴-计数组', 'occasion', 1, 7, 3)`,
    )
    .run().lastInsertRowid
  // feedback_events.user_id 是 NOT NULL（db/schema.sql:300）⇒ 先要有一条真实归属
  const uid = memDb.prepare('SELECT id FROM users WHERE session_id = ?').get(SESS_A).id
  memDb
    .prepare(`INSERT INTO feedback_events (user_id, group_id, signal) VALUES (?, ?, 'useful')`)
    .run(uid, gid)

  await star(ITEMS.a1)
  const evBefore = memDb.prepare('SELECT COUNT(*) AS n FROM feedback_events').get().n
  const grpBefore = memDb
    .prepare('SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?')
    .get(gid)

  const d = await call('DELETE', `/feedback/item?wardrobe_item_id=${ITEMS.a1}`)
  assert.strictEqual(d.body.data.deleted, 1)
  assert.strictEqual(memDb.prepare('SELECT COUNT(*) AS n FROM feedback_events').get().n, evBefore)
  const grpAfter = memDb
    .prepare('SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?')
    .get(gid)
  assert.deepStrictEqual(grpAfter, grpBefore, '⛔ 两层语义：撤一件衣服的星不等于改那条规则准不准')
})

// ============================================================
// §四·2 前置：衣橱注入本身要多于两行才挨得到（10-22 真浏览器那一下抓出来的）
// ============================================================

test('§四·2 名下两件以上衣服 ⇒ 引擎照样收得到整批 wardrobe_items（⛔ 静默变空）', async () => {
  const ins = memDb.prepare(
    `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type)
     VALUES (?, ?, 'top', ?, '合身')`,
  )
  ins.run(SESS_A, '第二件-雾霾蓝针织衫', '雾霾蓝')
  ins.run(SESS_A, '第三件-藏蓝衬衫', '藏蓝')
  const mine = memDb
    .prepare('SELECT id FROM user_wardrobe WHERE session_id = ?')
    .all(SESS_A)
    .map((r) => r.id)
  assert.ok(mine.length >= 3, `本会话名下该有 3 件，现量 ${mine.length} 件`)

  weatherStub = async () => ({ feelsLike: 20 })
  captured.profile = null
  const r = await call('POST', '/engine', { profile: PROFILE, mode: 'personal' })
  assert.strictEqual(r.status, 200)
  const got = captured.profile && captured.profile.wardrobe_items
  assert.ok(Array.isArray(got), '路由没把这一名下的衣橱喂给引擎（改前这里整批静默消失）')
  assert.ok(
    got.length >= 3,
    `3 件都该进去，实际 ${got.length} 件——只 1 件时不报错、≥2 件才炸，正是 map 递下标那个形状`,
  )
  assert.ok(
    got.every((i) => i && typeof i === 'object' && !Array.isArray(i) && i.id != null),
    '每一格都得是带 id 的对象',
  )
  // 别人的那一件⛔ 混进来
  assert.ok(
    got.every((i) => mine.includes(i.id)),
    '只准读自己名下的行：身份闸门在这一层也得验一次',
  )
})
