/**
 * 2026-10-13 深夜轮（第二批审计里落在安静文件上的逻辑缺陷）行为测试
 * ============================================================
 * 覆盖十处改动。每处都先复现"改之前会错成什么样"再断言改后的行为，
 * 只有第 5 处是例外（它改前不红，见那一条的注释）：
 *   1. services/fitSize.js   —— gender 是自由 TEXT 列，'constructor' 顺原型链拿到
 *                              Object 构造器 ⇒ `sc.chest[bt.code]` 在 undefined 上取属性 ⇒ 500
 *   2. services/topFitBody.js —— 条纹闸门读原始 bmi、打分侧读 r1 后的 measure.bmi，
 *                              原始值落在 24.95≤bmi<25.00 时两边判据相反
 *   3. services/horoscopeService.js —— parseInt(32 位十六进制,16) 超出 2^53 静默丢低位，
 *                              取模结果不是那份 md5 的余数
 *   4. routes/photos.js      —— PRAGMA foreign_keys=ON 下 photo_id 有三张子表引用，
 *                              不清子行就删 ⇒ FOREIGN KEY constraint failed ⇒ 永远 500
 *   5. routes/admin.js       —— 数据浏览翻页没有 ORDER BY：SQLite 不保证 LIMIT/OFFSET 的
 *                              返回顺序，本路由的 SELECT * 实测按 rowid 升序出来了，
 *                              但那是没写进 SQL 的约定（同库 SELECT id 实测乱序）
 *   6. services/baziWuxing.js —— 忌神日先被"生你的喜用"那条命中，判成"顺"，自相矛盾
 *   7. routes/rules.js       —— 删规则组时 feedback_events 的引用没处理 ⇒ 500，且没给出路
 *   8. routes/models.js      —— {"name":null} 撞 NOT NULL 变 500；sort_order/exposure
 *                              收不成整数也照存，存成 TEXT 后排序位置悄悄变
 *   9. routes/wardrobe.js    —— 删衣服不管 wardrobe_outfits.item_ids，搭配里留下野 id
 *  10. routes/cosmetic.js    —— remaining 没有第二道校验，'半瓶'/150 直接进库喂 CSS 宽度
 *
 * 这些断言不是"写了就绿"：把这 10 个后端文件换成 HEAD 的改前版本、在仓库外的副本里
 * 跑这同一份测试，16 红 9 绿（25 条）。绿的 9 条全是"照旧/仍"型守卫——
 * 它们钉的是别把已有行为改坏，本来就不该在改前红。
 * 本轮另两处在前端（RuleBrowser 的「姿势」选项、TopSpecCard 的 drop_cm 为 0 时仍显示），
 * app 侧没有测试运行器，那两处只有 tsc/eslint 门禁＋真浏览器点验，没有自动化断言。
 *
 * 库走 db/init 的内存替身（与 db/schema.sql 同源），不碰 backend/db/styleai.db、不起真端口；
 * 鉴权与限流中间件被绕过（只调路由 stack 里最后一个业务 handler）。
 *
 * 运行: node --test test/logicFixes20261013.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Module = require('node:module')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
// db/init.js:39 在真库上开着外键，替身必须一样开，否则第 4 组断言测的是另一回事
memDb.pragma('foreign_keys = ON')
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const { fitLayer } = require('../services/fitSize')
const { bodyDeviation } = require('../services/topFitBody')
const photosRouter = require('../routes/photos')
const adminRouter = require('../routes/admin')

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

/** 只调最后一个 handler（业务本体），返回 {statusCode, body} */
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

// ------------------------------------------------------------
// 1. fitSize：gender 只能是表自己的键
// ------------------------------------------------------------

const body170 = { height: 170, bust: 90, waist: 74, shoulder: 40, weight: 60 }

test('fitSize：gender 填成原型链上的键名不再抛 TypeError', () => {
  // 改之前：SIZE_STEPS.scope['constructor'] 是 Object 构造器（truthy ⇒ 过不了 `|| null`），
  // 紧接着 `sc.chest[bt.code]` 在 undefined 上取属性，整份合身层炸掉
  for (const gender of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.doesNotThrow(
      () => fitLayer({ ...body170, gender }),
      `gender=${gender} 不该把合身层炸成 500`,
    )
  }
})

test('fitSize：认不出的 gender 与"没填"走同一条兜底档系', () => {
  const bogus = fitLayer({ ...body170, gender: 'constructor' })
  const empty = fitLayer({ ...body170, gender: '' })
  assert.equal(bogus.present, true)
  assert.deepEqual(bogus.size, empty.size)
  assert.equal(bogus.size_scope, empty.size_scope)
})

test('fitSize：正常性别仍各读各的表（女 145~180／男 155~190）', () => {
  // 150cm 对女册在界内、对男册低于起点 ⇒ 兜底没有把两性并成一张表
  assert.equal(fitLayer({ ...body170, gender: '女', height: 150 }).size_scope, 'standard')
  assert.equal(fitLayer({ ...body170, gender: '男', height: 150 }).size_scope, 'near')
})

// ------------------------------------------------------------
// 2. topFitBody：条纹闸门与打分侧读同一个数
// ------------------------------------------------------------

test('topFitBody：原始 BMI 24.95~25.00 这段不再"闸门放行、打分关掉"', () => {
  // 170cm 配 72.1344kg ⇒ 原始 bmi 24.96，r1 后是 25.0
  const d = bodyDeviation({ height: 170, weight: 72.1344, bust: 90, waist: 74 })
  assert.equal(d.measure.bmi, 25, 'measure.bmi 应已被 r1 抬到 25')
  assert.equal(d.want.pattern, null, '闸门必须跟着关掉，否则 want.pattern 留着却零贡献')
  assert.ok(
    d.notes.some((n) => n.includes('条纹方向这条不采用')),
    '关掉时要在 notes 里说明原因',
  )
})

test('topFitBody：r1 后仍小于 25 时条纹修正照常保留', () => {
  // 72.0477kg ⇒ 原始 24.93、r1 后 24.9 ⇒ 两侧都放行
  const d = bodyDeviation({ height: 170, weight: 72.0477, bust: 90, waist: 74 })
  assert.equal(d.measure.bmi, 24.9)
  assert.notEqual(d.want.pattern, null)
})

test('topFitBody：闸门与打分侧对同一批体重的判定不再分叉', () => {
  // 打分侧 stripeOn = measure.bmi < 25（:529）。逐个体重把两边判据对一遍，
  // 改之前 24.95≤原始<25.00 那段两边相反。
  const stripeMax = 25
  for (let w = 68; w <= 78; w += 0.01) {
    const d = bodyDeviation({ height: 170, weight: Number(w.toFixed(2)), bust: 90, waist: 74 })
    const scored = d.measure.bmi != null && d.measure.bmi < stripeMax
    const gated = d.want.pattern != null
    assert.equal(gated, scored, `weight=${w} bmi=${d.measure.bmi} 闸门与打分不一致`)
  }
})

// ------------------------------------------------------------
// 3. horoscopeService：取模用的是精确值
// ------------------------------------------------------------

/** getBaseHoroscope 与文案表都没导出，抽源码补两个导出再跑（不动仓库文件） */
function loadHoroscopeInternals() {
  const file = path.join(__dirname, '..', 'services', 'horoscopeService.js')
  const src =
    fs.readFileSync(file, 'utf-8') +
    '\nmodule.exports.getBaseHoroscope = getBaseHoroscope\nmodule.exports.HOROSCOPE_DATA = HOROSCOPE_DATA\n'
  const reqFromServices = Module.createRequire(file)
  const mod = { exports: {} }
  // 这里的 disable 注释已撤：eslint.config.js 里根本没开 no-new-func，留着它反而报
  // "Unused eslint-disable directive"（10-13 现量：全仓 warning 因此多算 1 条）。
  new Function('module', 'exports', 'require', src)(mod, mod.exports, reqFromServices)
  return mod.exports
}

test('horoscope：分桶下标＝前 8 位十六进制的精确取模', () => {
  const { getBaseHoroscope, HOROSCOPE_DATA } = loadHoroscopeInternals()
  const signs = Object.keys(HOROSCOPE_DATA)
  assert.equal(signs.length, 12)
  for (const sign of signs) {
    const list = HOROSCOPE_DATA[sign]
    for (let day = 0; day < 10; day++) {
      const date = new Date(Date.UTC(2026, 9, 1) + day * 86400000).toISOString().slice(0, 10)
      const hex = crypto.createHash('md5').update(`${sign}_${date}`).digest('hex')
      const exact = Number(BigInt(`0x${hex.slice(0, 8)}`) % BigInt(list.length))
      assert.equal(getBaseHoroscope(sign, date), list[exact], `${sign}/${date} 选错了文案`)
    }
  }
})

test('horoscope：同一 sign+日期稳定复现，且与旧的整串 parseInt 确有差别', () => {
  const { getBaseHoroscope, HOROSCOPE_DATA } = loadHoroscopeInternals()
  const sign = 'aries'
  const list = HOROSCOPE_DATA[sign]
  const date = '2026-10-13'
  assert.equal(getBaseHoroscope(sign, date), getBaseHoroscope(sign, date))
  // 整串 32 位十六进制 ≈ 1e38，parseInt 早越过 2^53 ⇒ 低位被静默丢掉。
  // 12 星座 × 400 天实测 4116/4800（85.75%）与精确取模不同，这里只锁"确有不同"。
  const hex = crypto.createHash('md5').update(`${sign}_${date}`).digest('hex')
  const legacy = parseInt(hex, 16) % list.length
  const fixed = parseInt(hex.slice(0, 8), 16) % list.length
  assert.notEqual(legacy, fixed, '换成整串取模时这条断言必须红，否则它没在锁任何东西')
})

// ------------------------------------------------------------
// 4. photos：删照片先处理三张引用表，全程一个事务
// ------------------------------------------------------------

let photoCase = 0

function mkUserWithPhoto(url = '/uploads/no-such-file.jpg') {
  photoCase += 1
  const u = memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run('测试用户', `sid-logic-photos-${photoCase}`)
  const userId = u.lastInsertRowid
  const p = memDb
    .prepare('INSERT INTO photos (user_id, url, type) VALUES (?, ?, ?)')
    .run(userId, url, 'face')
  const photoId = p.lastInsertRowid
  memDb
    .prepare('INSERT INTO face_features (user_id, photo_id, skin_tone, status) VALUES (?, ?, ?, ?)')
    .run(userId, photoId, 'deep', 'done')
  memDb
    .prepare('INSERT INTO recommendations (user_id, photo_id, scenario) VALUES (?, ?, ?)')
    .run(userId, photoId, 'daily')
  memDb
    .prepare('INSERT INTO tryon_results (user_id, photo_id, status) VALUES (?, ?, ?)')
    .run(userId, photoId, 'done')
  return { userId, photoId }
}

const deletePhoto = findRoute(photosRouter, 'delete', '/:id')

test('photos：分析过/推荐过/试穿过的照片能删掉，不再卡在外键上回 500', () => {
  const { userId, photoId } = mkUserWithPhoto()
  const res = call(deletePhoto, { params: { id: String(photoId) }, user: { id: userId } })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(res.body.success, true)
  assert.equal(memDb.prepare('SELECT COUNT(*) c FROM photos WHERE id = ?').get(photoId).c, 0)
  assert.equal(
    memDb.prepare('SELECT COUNT(*) c FROM face_features WHERE photo_id = ?').get(photoId).c,
    0,
  )
})

test('photos：只断引用不删历史，推荐与试穿行仍在', () => {
  const { userId, photoId } = mkUserWithPhoto()
  call(deletePhoto, { params: { id: String(photoId) }, user: { id: userId } })
  const rec = memDb.prepare('SELECT photo_id FROM recommendations WHERE user_id = ?').get(userId)
  const tryon = memDb.prepare('SELECT photo_id FROM tryon_results WHERE user_id = ?').get(userId)
  assert.ok(rec, '推荐历史行不该被连带删掉')
  assert.ok(tryon, '试穿历史行不该被连带删掉')
  assert.equal(rec.photo_id, null)
  assert.equal(tryon.photo_id, null)
})

test('photos：url 为 NULL 时删除仍回 200（basename(null) 不该把成功报成失败）', () => {
  const { userId, photoId } = mkUserWithPhoto(null)
  const res = call(deletePhoto, { params: { id: String(photoId) }, user: { id: userId } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.success, true)
  assert.equal(memDb.prepare('SELECT COUNT(*) c FROM photos WHERE id = ?').get(photoId).c, 0)
})

test('photos：别人的照片删不动，仍回 404', () => {
  const { photoId } = mkUserWithPhoto()
  const other = memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run('别人', 'sid-logic-other')
  const res = call(deletePhoto, {
    params: { id: String(photoId) },
    user: { id: other.lastInsertRowid },
  })
  assert.equal(res.statusCode, 404)
  assert.equal(memDb.prepare('SELECT COUNT(*) c FROM photos WHERE id = ?').get(photoId).c, 1)
})

// ------------------------------------------------------------
// 5. admin：数据浏览有稳定顺序
// ------------------------------------------------------------

const dataList = findRoute(adminRouter, 'get', '/api/data/:tableName')

test('admin：数据浏览翻页有稳定顺序（页内升序、页间接得上）', () => {
  // 这一条是**约定守卫**，不是改前红：拿 HEAD 的改前代码跑同一份测试，它是绿的
  // （10-13 实测：改前 25 条里 16 条红、9 条绿，这条在绿的 9 条里）。
  // 原因是本路由写的是 SELECT *，取整行必须回表，本机 SQLite 就按 rowid 升序出来。
  // 但"1,2,3…"这个顺序没写在 SQL 里 ⇒ 换个 SQLite 版本、WHERE 命中别的索引、
  // 或以后把 SELECT * 改成投影列都会翻：同库同数据的 `SELECT id FROM users LIMIT 10 OFFSET 0`
  // 实测出的是 1,10,11,12,13,14,15,16,17,18 ／ 第 2 页 19,2,20,21,22,23,24,25,3,4。
  // 加了 ORDER BY rowid 之后，这个顺序才是这条 SQL 保证的，本测试钉的就是它。
  for (let i = 1; i <= 25; i++) {
    memDb
      .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
      .run(`翻页用户${i}`, `sid-page-${i}`)
  }
  const p1 = call(dataList, {
    params: { tableName: 'users' },
    query: { page: '1', per_page: '10' },
  })
  const p2 = call(dataList, {
    params: { tableName: 'users' },
    query: { page: '2', per_page: '10' },
  })
  assert.equal(p1.statusCode, 200)
  const ids1 = p1.body.data.rows.map((r) => r.id)
  const ids2 = p2.body.data.rows.map((r) => r.id)
  assert.equal(ids1.length, 10)
  assert.equal(ids2.length, 10)
  assert.deepEqual(
    [...ids1].sort((a, b) => a - b),
    ids1,
    '第 1 页不是升序',
  )
  assert.deepEqual(
    [...ids2].sort((a, b) => a - b),
    ids2,
    '第 2 页不是升序',
  )
  assert.equal(ids1[9] < ids2[0], true, '页与页之间必须接着排')
  assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, '两页有重复行')
  assert.ok(p1.body.data.total >= 25, `total=${p1.body.data.total} 该把插进去的 25 条都数上`)
  assert.equal(p2.body.data.page, 2)
})

test('admin：表名白名单仍拦住 constructor（顺原型链会拼出语法错）', () => {
  const res = call(dataList, { params: { tableName: 'constructor' }, query: {} })
  assert.equal(res.statusCode, 404)
})

// ------------------------------------------------------------
// 第二批：落在"另一路会话刚写完、现已安静 1 小时以上"的五个文件上的逻辑错误
// ------------------------------------------------------------

const { analyzeDay } = require('../services/baziWuxing')
const rulesRouter = require('../routes/rules')
const modelsRouter = require('../routes/models')
const wardrobeRouter = require('../routes/wardrobe')
const cosmeticRouter = require('../routes/cosmetic')

/**
 * 6. baziWuxing：忌神这条必须排在"生喜用"前面
 * 喜木火 ⇒ 忌水，而水生木：原来 `fav.some(isGenerate(水, 木))` 先命中，
 * 同一天档案写"忌水"、当日建议却判"顺"。300 个生日 × 60 天 = 18000 组实测撞了 1488 组（8.27%）。
 */
test('bazi：当日五行正是忌神时判"忌"，不再被"生喜用"抢成"顺"', () => {
  const a = { favorable: ['木', '火'], unfavorable: '水', favorable_colors: '绿、红' }
  let hits = 0
  for (let j = 0; j < 60; j++) {
    const t = analyzeDay(a, new Date(Date.UTC(2026, 0, 1) + j * 86400000))
    if (t.element !== '水') continue
    hits += 1
    assert.equal(t.tone, '忌', `${t.date} 是水日，档案写着忌水却判了${t.tone}`)
    assert.equal(t.reason, '正是你的忌神')
  }
  assert.ok(hits > 0, '60 天里一个水日都没命中 ⇒ 样本失效，这条等于没验')
})

/** 7. rules：删有人评价过的规则从裸 500 改成 409＋出口 */
const deleteGroup = findRoute(rulesRouter, 'delete', '/groups/:id')

function mkRatedGroup(tag) {
  const g = memDb
    .prepare('INSERT INTO rule_groups (name, mode, category) VALUES (?, ?, ?)')
    .run(`测试规则·${tag}`, 'store', '穿搭')
  const u = memDb
    .prepare('INSERT INTO users (nickname, session_id) VALUES (?, ?)')
    .run('评价人', `sid-rated-${tag}`)
  memDb
    .prepare('INSERT INTO feedback_events (user_id, group_id, signal) VALUES (?, ?, ?)')
    .run(u.lastInsertRowid, g.lastInsertRowid, 'up')
  return g.lastInsertRowid
}

test('rules：有人评价过的规则删不掉时回 409 并指出"禁用"这条出口', () => {
  const id = mkRatedGroup('rated')
  const res = call(deleteGroup, { params: { id: String(id) } })
  assert.equal(res.statusCode, 409, JSON.stringify(res.body))
  assert.equal(res.body.error.code, 'CONFLICT')
  assert.match(res.body.error.message, /禁用/)
  assert.equal(memDb.prepare('SELECT COUNT(*) c FROM rule_groups WHERE id = ?').get(id).c, 1)
})

test('rules：没人评价过的规则照旧删得掉，连子表一起', () => {
  const g = memDb
    .prepare('INSERT INTO rule_groups (name, mode, category) VALUES (?, ?, ?)')
    .run('测试规则·clean', 'store', '穿搭')
  memDb
    .prepare('INSERT INTO rule_conditions (group_id, field, operator, value) VALUES (?, ?, ?, ?)')
    .run(g.lastInsertRowid, 'skin_tone', 'eq', '冷皮')
  const res = call(deleteGroup, { params: { id: String(g.lastInsertRowid) } })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(
    memDb.prepare('SELECT COUNT(*) c FROM rule_groups WHERE id = ?').get(g.lastInsertRowid).c,
    0,
  )
  assert.equal(
    memDb
      .prepare('SELECT COUNT(*) c FROM rule_conditions WHERE group_id = ?')
      .get(g.lastInsertRowid).c,
    0,
  )
})

/** 8. models：NOT NULL 列与数值列的写口 */
const putModel = findRoute(modelsRouter, 'put', '/admin/:id')

function mkModel(tag) {
  return memDb
    .prepare('INSERT INTO model_configs (name, folder, file) VALUES (?, ?, ?)')
    .run(`测试模型·${tag}`, `tf-${tag}`, `tf-${tag}.glb`).lastInsertRowid
}

test('models：{"name":null} 回 400，不再撞 NOT NULL 变成假故障 500', () => {
  const id = mkModel('name')
  const res = call(putModel, { params: { id: String(id) }, body: { name: null } })
  assert.equal(res.statusCode, 400)
  assert.equal(
    memDb.prepare('SELECT name FROM model_configs WHERE id = ?').get(id).name,
    '测试模型·name',
  )
})

test('models：sort_order 收得成整数就落成整数，收不成回 400 且原值不动', () => {
  const id = mkModel('sort')
  assert.equal(
    call(putModel, { params: { id: String(id) }, body: { sort_order: '7' } }).statusCode,
    200,
  )
  const row = memDb
    .prepare('SELECT sort_order, typeof(sort_order) ty FROM model_configs WHERE id = ?')
    .get(id)
  assert.equal(row.sort_order, 7)
  assert.equal(row.ty, 'integer', 'TEXT 混进 INTEGER 列会排到全表最后')
  const bad = call(putModel, { params: { id: String(id) }, body: { sort_order: 'abc' } })
  assert.equal(bad.statusCode, 400)
  assert.equal(
    memDb.prepare('SELECT sort_order FROM model_configs WHERE id = ?').get(id).sort_order,
    7,
  )
})

test('models：exposure 同一把尺子（脏文本进库 ⇒ 展厅光照算成 NaN）', () => {
  const id = mkModel('expo')
  assert.equal(
    call(putModel, { params: { id: String(id) }, body: { exposure: '0.5' } }).statusCode,
    200,
  )
  assert.equal(
    memDb.prepare('SELECT exposure FROM model_configs WHERE id = ?').get(id).exposure,
    0.5,
  )
  assert.equal(
    call(putModel, { params: { id: String(id) }, body: { exposure: '0.3x' } }).statusCode,
    400,
  )
})

/** 9. wardrobe：删衣服要顺手清掉搭配里的空引用 */
const deleteWardrobeItem = findRoute(wardrobeRouter, 'delete', '/items/:itemId')

function mkItem(sid, name) {
  return memDb
    .prepare('INSERT INTO user_wardrobe (session_id, name, category) VALUES (?, ?, ?)')
    .run(sid, name, '上衣').lastInsertRowid
}

test('wardrobe：删掉衣服后搭配里的空引用一起清，剔空的搭配连行删', () => {
  const sid = 'sid-scrub-20261013'
  const top = mkItem(sid, '上衣A')
  const bottom = mkItem(sid, '下装B')
  const keep = memDb
    .prepare('INSERT INTO wardrobe_outfits (session_id, name, item_ids) VALUES (?, ?, ?)')
    .run(sid, '两件的那套', JSON.stringify([top, bottom]))
  const solo = memDb
    .prepare('INSERT INTO wardrobe_outfits (session_id, name, item_ids) VALUES (?, ?, ?)')
    .run(sid, '只剩一件的那套', JSON.stringify([top]))

  const res = call(deleteWardrobeItem, {
    params: { itemId: String(top) },
    headers: { 'x-session-id': sid },
  })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(res.body.data.scrubbed, 1)
  assert.equal(res.body.data.emptied, 1)
  assert.equal(
    JSON.parse(
      memDb.prepare('SELECT item_ids FROM wardrobe_outfits WHERE id = ?').get(keep.lastInsertRowid)
        .item_ids,
    ).join(),
    String(bottom),
  )
  assert.equal(
    memDb.prepare('SELECT COUNT(*) c FROM wardrobe_outfits WHERE id = ?').get(solo.lastInsertRowid)
      .c,
    0,
  )
})

test('wardrobe：别人会话的衣服删不动，搭配一个字节都不改', () => {
  const owner = 'sid-scrub-owner'
  const thief = 'sid-scrub-thief'
  const item = mkItem(owner, '别人的上衣')
  const outfit = memDb
    .prepare('INSERT INTO wardrobe_outfits (session_id, name, item_ids) VALUES (?, ?, ?)')
    .run(owner, '别人那套', JSON.stringify([item]))
  const res = call(deleteWardrobeItem, {
    params: { itemId: String(item) },
    headers: { 'x-session-id': thief },
  })
  assert.equal(res.statusCode, 404)
  assert.equal(memDb.prepare('SELECT COUNT(*) c FROM user_wardrobe WHERE id = ?').get(item).c, 1)
  assert.equal(
    memDb.prepare('SELECT item_ids FROM wardrobe_outfits WHERE id = ?').get(outfit.lastInsertRowid)
      .item_ids,
    JSON.stringify([item]),
  )
})

/** 10. cosmetic：余量 remaining 是 INTEGER，前端拿它拼 width:${remaining}% */
const postCosmetic = findRoute(cosmeticRouter, 'post', '/items')
const putCosmetic = findRoute(cosmeticRouter, 'put', '/items/:itemId')
const COS_SID = 'sid-remaining-20261013'

test('cosmetic：POST 余量写成"半瓶"回 400，不再把 CSS 算成 width: 半瓶%', () => {
  const res = call(postCosmetic, {
    body: { name: '测试口红', category: '口红', remaining: '半瓶' },
    headers: { 'x-session-id': COS_SID },
  })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error.message, /remaining/)
})

test('cosmetic：POST 省略余量仍按 100，字符串数字收成整数', () => {
  const ok = call(postCosmetic, {
    body: { name: '测试气垫', category: '底妆', remaining: '70' },
    headers: { 'x-session-id': COS_SID },
  })
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body))
  const row = memDb
    .prepare('SELECT remaining, typeof(remaining) ty FROM user_cosmetics WHERE name = ?')
    .get('测试气垫')
  assert.equal(row.remaining, 70)
  assert.equal(row.ty, 'integer')
  const dflt = call(postCosmetic, {
    body: { name: '测试眉笔', category: '眉笔' },
    headers: { 'x-session-id': COS_SID },
  })
  assert.equal(dflt.statusCode, 200)
  assert.equal(
    memDb.prepare('SELECT remaining FROM user_cosmetics WHERE name = ?').get('测试眉笔').remaining,
    100,
  )
})

test('cosmetic：PUT 是第二条写口，越界与脏值同样拦（150 会撑破进度条）', () => {
  const created = call(postCosmetic, {
    body: { name: '测试腮红', category: '腮红', remaining: 60 },
    headers: { 'x-session-id': COS_SID },
  })
  const id = created.body.data.item.id
  assert.equal(
    call(putCosmetic, {
      params: { itemId: String(id) },
      body: { remaining: 150 },
      headers: { 'x-session-id': COS_SID },
    }).statusCode,
    400,
  )
  assert.equal(
    memDb.prepare('SELECT remaining FROM user_cosmetics WHERE id = ?').get(id).remaining,
    60,
    '被拒的 PUT 不能已经把值写进去',
  )
  const cleared = call(putCosmetic, {
    params: { itemId: String(id) },
    body: { remaining: null },
    headers: { 'x-session-id': COS_SID },
  })
  assert.equal(cleared.statusCode, 200, JSON.stringify(cleared.body))
  assert.equal(
    memDb.prepare('SELECT remaining FROM user_cosmetics WHERE id = ?').get(id).remaining,
    null,
  )
})
