/**
 * 隐性偏好画像层（`services/wearPreference.js`）＋它在排序层的接线（2026-10-20 第八阶段·第一步 一e）
 *
 * 规范出处：`docs/依据/16-数据采集输入输出规范-20261020.md` §五。这一层是本轮唯一新增的算分层，
 * 它的全部权利只有一条：把这个person自己记下的穿搭日记，折成一个 **±5% 以内的乘性顺位微调**。
 *
 * 九件事必须用行为证据钉住（§五 逐条对应）：
 *  ① **零样本零影响**——没有日记、没有星 ⇒ 每条乘子**恰好等于 1**，且实测「不传身份」与
 *     「传一个查不到任何行的身份」两次跑出来的 Top 8 **逐条相同**（名字、位次、综合分全同）。
 *     这条是本轮唯一能自证安全的断言，也是这一层敢接进热路径的全部理由。
 *  ② 某轴样本 < `MIN_SAMPLES` ⇒ 整轴**缺席**（不是按 0 计；按 0 计等于把"没记过"说成"最不喜欢"）；
 *  ③ 三档幅度：命中最常记的那一档 +2%、穿过的其他档 0、从没记过的档 −1%；
 *  ④ 乘子必须落在 `[FACTOR_MIN, FACTOR_MAX]` 里（护栏；两轴满打满算是 1.04/0.98，咬不到边界，
 *     写出来是为了将来加轴时边界还在）；
 *  ⑤ 一套里同族只记一票（上下都蓝 ≠ 两票蓝）；
 *  ⑥ 日记里引用的衣物后来被删了 ⇒ **这一票不补**（缺测不出分）；
 *  ⑦ `season`/`rating` 两轴只出账、**不进乘子**（季节那一格在 `rule_conditions` 里词形没归一，
 *     现量 10-21：`{"season": "春"}` 与 `"夏"` 两种写法混存；星级量的是打分的手松手紧）。
 *     🔴 10-21 第十一阶段·第一步：`occasion` **已从"只出账"升为进乘子**——依据是
 *     `docs/依据/19` §〇 第 4 条（投影 `utils/common.js:401`（🔴 10-30 按内容重指：原写 374 落在投影函数 `:385-402` 的 JSDoc 里） 一直带着 `occasion_tags`，
 *     当年那句"候选身上压根没有 occasion 这一格"没撑住；同一条尺子量 `grep -n occasion
 *     services/recommendEngine.js` 也从 0 处变成 3 处）。
 *  ⑧ 没身份 ⇒ 一条 SELECT 都不发；
 *  ⑨ 排序层的出账：`rank` 里带 `preference_factor` + `preference_basis`，
 *     `_computed.ranking.preference` 里带参数、样本数与「前 N 条被动了几条」。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 test/wardrobeDiaryRoutes.test.js 同一套路），
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/wearPreference.test.js
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

const wp = require('../services/wearPreference')
const { buildPreference, preferenceFactor } = wp
const { buildRecommendation, rankDims } = require('../services/recommendEngine')

const SESS = 'sess-pref-owner'
const SESS_EMPTY = 'sess-pref-no-diary-at-all'

// ============================================================
// 造数据的三个小工装
// ============================================================

/**
 * 往这个人的衣柜里塞一件上衣，返回它的 id。
 * 色名/版型是第八阶段就读的两格；`fabric_weight`（薄/中/厚）与 `occasion_tags`
 * 是 10-21 第十一阶段·第一步新读的两格（`19` §五 第 1、3 条），所以这个工装也跟着开两个口子，
 * ⛔ 不另起第二个"塞衣服"的函数。
 */
function addItem(name, color, fitType, session = SESS, extra = {}) {
  return memDb
    .prepare(
      `INSERT INTO user_wardrobe (session_id, name, category, color, fit_type, fabric_weight, occasion_tags)
       VALUES (?, ?, '上衣', ?, ?, ?, ?)`,
    )
    .run(
      session,
      name,
      color,
      fitType,
      extra.fabric_weight ?? null,
      extra.occasion_tags ? JSON.stringify(extra.occasion_tags) : null,
    ).lastInsertRowid
}

/**
 * 记一套搭配（item_ids 存 JSON 串，与 routes/wardrobe.js 写入口同形状）。
 * 本轮多了三格：`wear_date`／`feels_like_c`／`weather_level`（`19` §二 那三列）。
 */
function addOutfit(ids, extra = {}, session = SESS) {
  const row = {
    occasion: null,
    season: null,
    rating: null,
    wear_date: null,
    feels_like_c: null,
    weather_level: null,
    ...extra,
  }
  return memDb
    .prepare(
      `INSERT INTO wardrobe_outfits
         (session_id, name, item_ids, occasion, season, rating, wear_date, feels_like_c, weather_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session,
      row.name || '测试的一套',
      JSON.stringify(ids),
      row.occasion,
      row.season,
      row.rating,
      row.wear_date,
      row.feels_like_c,
      row.weather_level,
    ).lastInsertRowid
}

/**
 * 手工造一份画像，专测乘子那三档（不查库，免得把"画像怎么算的"和"乘子怎么用"两件事搅一起）。
 * 形状与 buildPreference 出的完全一致：dims 里每条带 value/counts/samples/in_multiplier。
 */
function craftPref(color, fit) {
  const dim = (key, name_cn, spec) =>
    spec
      ? {
          key,
          name_cn,
          value: spec.value,
          share: spec.share ?? null,
          counts: spec.counts,
          samples: spec.samples,
          in_multiplier: true,
          basis: '测试造的画像',
        }
      : null
  return {
    dims: [dim('color_family', '色族偏爱', color), dim('fit_type', '版型档', fit)].filter(Boolean),
    factor_ready: true,
    samples: 3,
    provenance: '测试造的画像',
  }
}

/**
 * 手工造一份**七轴形状**的画像（10-21 第十一阶段·第一步新增的工装）。
 * 为什么不用 `craftPref` 硬扩：`preferenceFactor` 现在要认逐轴口径
 * （`lift_unseen`／`share_label`）与那张 `item_reps` 表，形状必须与 `buildPreference` 出的一致，
 * 否则测的是"测试自己的假设"而不是代码。没传的轴一律当缺席（value null、samples 0）。
 * @param {object} specs 轴 key → {value, counts, samples, share?}
 * @param {{item_reps?:Map<number,number>, reps?:object, level?:string|null}} extra
 */
function craftAxes(specs, extra = {}) {
  const dim = (a) => {
    const spec = specs[a.key]
    return {
      key: a.key,
      name_cn: a.name_cn,
      value: spec ? spec.value : null,
      share: spec ? (spec.share ?? null) : null,
      counts: spec ? spec.counts : {},
      samples: spec ? spec.samples : 0,
      in_multiplier: a.multiplier,
      lift_unseen: a.lift_unseen,
      share_label: a.share_label || '占日记',
      basis: '测试造的画像',
    }
  }
  return {
    dims: wp.AXES.map(dim),
    factor_ready: true,
    samples: 3,
    weather_level_used: extra.level ?? null,
    item_reps: extra.item_reps || new Map(),
    reps: extra.reps || { counted_items: 0, max_reps: 0 },
    provenance: '测试造的画像',
  }
}

// ============================================================
// ①⑧ 零影响与"没身份不查库"
// ============================================================

test('⑧ 没有身份 ⇒ 一条 SELECT 都不发，画像整块为空', () => {
  const realPrepare = memDb.prepare.bind(memDb)
  let touched = 0
  memDb.prepare = (sql) => {
    touched++
    throw new Error(`不该查库却发了 SQL: ${sql}`)
  }
  let pref
  try {
    pref = buildPreference({})
    assert.strictEqual(buildPreference(null).factor_ready, false, 'null 身份同样不许发 SQL')
  } finally {
    memDb.prepare = realPrepare
  }
  assert.strictEqual(touched, 0, '没身份时一条 SQL 都不许发（含 sessionId/userId 都为空的情况）')
  assert.strictEqual(pref.factor_ready, false)
  assert.strictEqual(pref.samples, 0)
  assert.strictEqual(pref.dims.length, wp.AXES.length)
  assert.ok(
    pref.dims.every((d) => d.value === null),
    '无身份时七轴一律没值',
  )
  assert.match(pref.provenance, /没有身份/)
  assert.strictEqual(pref.weather_level_used, null, '没身份时连"吃了哪一档天气"都不许记（它没吃）')
  assert.strictEqual(pref.item_reps.size, 0)
  assert.deepStrictEqual(pref.reps, { counted_items: 0, max_reps: 0 })
  // 传 null / 传空对象都走同一条隐身路径（null 那条在上面的 try 里已断过）
  assert.strictEqual(preferenceFactor({ color_text: '蓝' }, pref).factor, 1)
})

test('① 日记 0 行 ⇒ 各轴样本 0、画像未就绪、每条乘子恰好等于 1', () => {
  const pref = buildPreference({ sessionId: SESS_EMPTY })
  assert.strictEqual(pref.samples, 0)
  assert.strictEqual(pref.factor_ready, false, '日记 0 行绝不许把自己标成就绪')
  for (const cand of [
    { color_text: '雾霾蓝', fit_type: '宽松' },
    { color_text: '随便一件没记过的绿', fit_type: '修身' },
    { outfit_top: '规则里的一条文字结论', color_text: null },
  ]) {
    const r = preferenceFactor(cand, pref)
    assert.strictEqual(r.factor, 1, '未就绪时必须是**恰好** 1，不是约等于')
    assert.strictEqual(r.basis, null, '没动过分就不许编一句依据出来')
  }
  // 🔴 本轮新增：请求带了天气档、但日记一行都没有 ⇒ 仍然恰好 1。
  // 这一格断的是"天气不许单独把这一层叫醒"：它只是 `warmth` 那一轴的输入，不是新的样本来源。
  const withLevel = buildPreference({ sessionId: SESS_EMPTY }, '寒冷')
  assert.strictEqual(withLevel.weather_level_used, '寒冷', '吃了哪一档要能自证')
  assert.strictEqual(withLevel.factor_ready, false)
  assert.strictEqual(
    preferenceFactor({ source: 'wardrobe', wardrobe_item_id: 1, fabric_weight: '厚' }, withLevel)
      .factor,
    1,
  )
})

// ============================================================
// ②⑤⑥⑦ 画像那侧的口径
// ============================================================

test('② 某轴样本不够 MIN_SAMPLES ⇒ 整轴缺席，不许按 0 计', () => {
  const s = 'sess-pref-few'
  const blue = addItem('蓝衬衫', '雾霾蓝', '宽松', s)
  addOutfit([blue], { name: '第一套' }, s)
  addOutfit([blue], { name: '第二套' }, s)
  const pref = buildPreference({ sessionId: s })
  const color = pref.dims.find((d) => d.key === 'color_family')
  assert.strictEqual(color.samples, 2, '样本数按日记条数计（两套就是 2）')
  assert.strictEqual(color.value, '蓝', '轴内取值照样出账（报告要能看出这人记过什么）')
  assert.strictEqual(pref.factor_ready, false, `2 < MIN_SAMPLES=${wp.MIN_SAMPLES} ⇒ 整层不许生效`)
  assert.strictEqual(preferenceFactor({ color_text: '雾霾蓝' }, pref).factor, 1)
})

test('⑤ 一套里同族只记一票（上下都蓝 ≠ 两票蓝）', () => {
  const s = 'sess-pref-dedup'
  const a = addItem('蓝衬衫A', '雾霾蓝', '宽松', s)
  const b = addItem('蓝裤子B', '深蓝', '合身', s)
  const c = addItem('红上衣C', '酒红', '宽松', s)
  addOutfit([a, b], { name: '两套都是蓝的一套' }, s)
  addOutfit([a, c], { name: '蓝加红的一套' }, s)
  addOutfit([b, c], { name: '蓝加红的另一套' }, s)
  const pref = buildPreference({ sessionId: s })
  const color = pref.dims.find((d) => d.key === 'color_family')
  assert.deepStrictEqual(color.counts, { 蓝: 3, 红: 2 }, '一套一票：3 套里有蓝的是 3 套，不是 4 件')
  assert.strictEqual(color.value, '蓝')
  assert.strictEqual(color.share, 0.6)
  assert.ok(pref.factor_ready, '3 条日记刚好够开这一层')
})

test('⑥ 日记里引用的衣物被删了 ⇒ 这一票不补', () => {
  const s = 'sess-pref-deleted'
  const keep = addItem('留下的蓝衬衫', '雾霾蓝', '宽松', s)
  const gone = addItem('会被删掉的红上衣', '酒红', '合身', s)
  addOutfit([keep, gone], { name: '第一套' }, s)
  addOutfit([keep], { name: '第二套' }, s)
  addOutfit([gone], { name: '第三套：那件已经删了' }, s)
  memDb.prepare('DELETE FROM user_wardrobe WHERE id = ?').run(gone)
  const pref = buildPreference({ sessionId: s })
  const color = pref.dims.find((d) => d.key === 'color_family')
  assert.deepStrictEqual(color.counts, { 蓝: 2 }, '删掉的那件不能靠日记文本把票补回来')
  assert.strictEqual(color.samples, 3, '样本数仍是日记条数（缺的是这一票，不是这一行）')
})

test('⑦ 七轴都出账；season/rating 仍只出账，occasion 本轮起进乘子', () => {
  const s = 'sess-pref-axes'
  const blue = addItem('蓝衬衫', '雾霾蓝', '宽松', s)
  for (const occ of ['上班通勤', '上班通勤', '约会聚会']) {
    addOutfit([blue], { occasion: occ, season: '秋', rating: occ === '上班通勤' ? 5 : 4 }, s)
  }
  const pref = buildPreference({ sessionId: s })
  const byKey = Object.fromEntries(pref.dims.map((d) => [d.key, d]))
  assert.deepStrictEqual(
    pref.dims.map((d) => d.key),
    ['color_family', 'fit_type', 'occasion', 'season', 'rating', 'warmth', 'reps'],
    '七轴都在（少一轴就是出账口径没做完；本轮加的是 warmth 与 reps）',
  )
  assert.deepStrictEqual(
    pref.dims.filter((d) => d.in_multiplier).map((d) => d.key),
    [...wp.MULTIPLIER_AXES, 'reps'],
    '通用循环认 MULTIPLIER_AXES 那四根；`reps` 比的是"这一件"，走 `preferenceFactor` 里那条特判，' +
      '它同样进乘子（所以 in_multiplier 为真），但⛔ 不在那份名单里——混进去就是同一件事数两遍',
  )
  assert.strictEqual(byKey.occasion.value, '上班通勤', '两套通勤 vs 一套约会 ⇒ 众数是通勤')
  assert.deepStrictEqual(byKey.occasion.counts, { 上班通勤: 2, 约会聚会: 1 })
  assert.strictEqual(byKey.season.value, '秋')
  assert.strictEqual(byKey.rating.value, 4.67, '日记那一把星的均值：(5+5+4)/3')
  assert.strictEqual(byKey.color_family.in_multiplier, true)
  assert.strictEqual(
    byKey.occasion.in_multiplier,
    true,
    '🔴 本轮升档：候选带 occasion_tags 才有这一格',
  )
  assert.ok(
    [byKey.season, byKey.rating].every((d) => d.in_multiplier === false),
    '季节/星级两轴一律不许进乘子（一个词形没归一，一个量的是一把手松紧）',
  )
  assert.strictEqual(byKey.warmth.value, null, '本次请求没带天气档 ⇒ 厚薄这一轴整块缺席')
  assert.strictEqual(byKey.warmth.samples, 0)
  assert.strictEqual(byKey.reps.value, 3, '三套日记记的都是同一件 ⇒ 那件记了 3 次')
  assert.deepStrictEqual(byKey.reps.counts, { counted_items: 1, max_reps: 3 })
  assert.strictEqual(pref.item_reps.get(blue), 3)

  // 场合这一轴真正吃到候选：命中众数 +2%／标签里没有这一档但穿过 0／表外 −1%／空标签不乘
  const hit = preferenceFactor(
    { color_text: '雾霾蓝', occasion_tags: ['上班通勤', '婚礼宴会'] },
    pref,
  )
  assert.strictEqual(hit.factor, 1.04, '色族命中(蓝)＋场合命中(上班通勤) 两刀各 +2%')
  assert.match(hit.basis, /场合覆盖命中你最常记的「上班通勤」/)
  const other = preferenceFactor({ color_text: '雾霾蓝', occasion_tags: ['约会聚会'] }, pref)
  assert.strictEqual(other.factor, 1.02, '约会是穿过的另一档 ⇒ 场合这一轴不动分，只剩色族那一刀')
  const unseenOcc = preferenceFactor({ color_text: '雾霾蓝', occasion_tags: ['运动健身'] }, pref)
  assert.strictEqual(unseenOcc.factor, 1.01, '从没记过的场合 −1%')
  const noTags = preferenceFactor({ color_text: '雾霾蓝', occasion_tags: [] }, pref)
  assert.strictEqual(
    noTags.factor,
    1.02,
    '规则库那一路的候选没有场合标签 ⇒ 这一轴对它逐条隐身，不是给 0 分',
  )
})

test('星级那一轴把推荐卡上的两把星一起收进来（同一把尺子 1~5）', () => {
  const s = 'sess-pref-stars'
  const u = memDb
    .prepare(`INSERT INTO users (session_id, nickname) VALUES (?, '星星人')`)
    .run(s).lastInsertRowid
  const gid = memDb
    .prepare(`INSERT INTO rule_groups (name, category, priority) VALUES ('星级测试A', '穿搭', 1)`)
    .run().lastInsertRowid
  // feedback_events 上有 UNIQUE(user_id, group_id)（现量 db/schema.sql）：同一个人对同一条规则只留一行，
  // 所以第二把星必须挂在另一条规则上，不能拿同一 group_id 连打两次。
  const gid2 = memDb
    .prepare(`INSERT INTO rule_groups (name, category, priority) VALUES ('星级测试B', '穿搭', 1)`)
    .run().lastInsertRowid
  memDb
    .prepare(
      `INSERT INTO feedback_events (user_id, group_id, category, signal, aesthetic_score, fit_score)
       VALUES (?, ?, '穿搭', 'use', ?, ?)`,
    )
    .run(u, gid, 5, 2)
  memDb
    .prepare(
      `INSERT INTO feedback_events (user_id, group_id, category, signal, aesthetic_score, fit_score)
       VALUES (?, ?, '穿搭', 'use', ?, ?)`,
    )
    .run(u, gid2, 3, null)
  const pref = buildPreference({ sessionId: s, userId: u })
  const rating = pref.dims.find((d) => d.key === 'rating')
  assert.strictEqual(rating.counts.aesthetic, 4, '两把审美星 (5+3)/2＝4，跨日记一起收')
  assert.strictEqual(rating.counts.fit, 2, '合身星只有 1 条打了，NULL 那条不许当 0')
  assert.strictEqual(rating.in_multiplier, false, '星级量的是一把手松紧，不进乘子')
})

// ============================================================
// ③④ 乘子三档与上下界
// ============================================================

test('③ 三档幅度：最常记 +2%／穿过的其他档 0／从没记过 −1%', () => {
  const pref = craftPref({ value: '蓝', share: 0.75, counts: { 蓝: 3, 红: 1 }, samples: 3 })
  const hit = preferenceFactor({ color_text: '雾霾蓝卫衣' }, pref)
  assert.strictEqual(hit.factor, 1.02)
  assert.match(hit.basis, /色族偏爱命中你最常记的「蓝」/)
  assert.match(hit.basis, /占日记 75%/, '依据要能回指"三套里几套是这一族"，只给个百分比数没交代')
  assert.match(hit.basis, /×1\.02/, '幅度也写进依据串，报告里能直接拆账')

  const seen = preferenceFactor({ color_text: '酒红西装' }, pref)
  assert.strictEqual(seen.factor, 1, '穿过但不是最常记 ⇒ 一分不动')
  assert.match(seen.basis, /是你穿过的「红」，不动/)

  const unseen = preferenceFactor({ color_text: '草绿风衣' }, pref)
  assert.strictEqual(unseen.factor, 0.99)
  assert.match(unseen.basis, /你的日记里没记过/)

  // 候选这一轴压根没值 ⇒ 不加也不减（不是"不偏好"）
  const noValue = preferenceFactor({ color_text: '', outfit_top: null }, pref)
  assert.strictEqual(noValue.factor, 1)
  assert.strictEqual(noValue.basis, null)
})

test('③ 版型档读的是 body_fit.top.fit_type（衣橱行没有顶层 fit_type 也要能取到）', () => {
  const pref = craftPref(null, { value: '宽松', share: 1, counts: { 宽松: 3 }, samples: 3 })
  assert.strictEqual(
    preferenceFactor({ color_text: null, body_fit: { top: { fit_type: '宽松' } } }, pref).factor,
    1.02,
  )
  assert.strictEqual(
    preferenceFactor({ color_text: null, fit_type: '修身' }, pref).factor,
    0.99,
    '顶层 fit_type 与 body_fit 里那一格任一取得到都算（取不到才是缺席）',
  )
  assert.strictEqual(
    preferenceFactor({ color_text: null, fit_type: '不对的词' }, pref).factor,
    1,
    '词表外的版型当没值，不许当成"没穿过"扣分',
  )
})

test('④ 两轴满打满算：1.04 / 0.98，永远落在界内；画像未就绪时恰好 1', () => {
  const both = craftPref(
    { value: '蓝', share: 1, counts: { 蓝: 3 }, samples: 3 },
    { value: '宽松', share: 1, counts: { 宽松: 3 }, samples: 3 },
  )
  const up = preferenceFactor({ color_text: '雾霾蓝', fit_type: '宽松' }, both)
  assert.strictEqual(up.factor, 1.04)
  const down = preferenceFactor({ color_text: '草绿', fit_type: '修身' }, both)
  assert.strictEqual(down.factor, 0.98)
  for (const f of [up.factor, down.factor]) {
    assert.ok(f >= wp.FACTOR_MIN && f <= wp.FACTOR_MAX, `${f} 越界`)
  }
  // 一轴样本不够 ⇒ 那一轴整块缺席，只剩另一轴（不是把两轴平均）
  const oneShort = craftPref(
    { value: '蓝', share: 1, counts: { 蓝: 3 }, samples: 3 },
    { value: '宽松', share: 1, counts: { 宽松: 2 }, samples: 2 },
  )
  assert.strictEqual(
    preferenceFactor({ color_text: '雾霾蓝', fit_type: '修身' }, oneShort).factor,
    1.02,
  )
  assert.strictEqual(
    preferenceFactor({ color_text: '草绿', fit_type: '修身' }, oneShort).factor,
    0.99,
    '版型轴缺席时只按色族那一轴的 −1%，不许再叠一次',
  )
})

// ============================================================
// ⑩ 10-21 第十一阶段·第一步：温度档厚薄 ＋ 复穿次数（`docs/依据/19` §五 第 1、2 条）
// ============================================================

test('⑩ 画像侧：寒冷档记的都是厚 ⇒ 带「寒冷」的才出这一轴，只存体感温度也算得出档', () => {
  const s = 'p11-warmth-db'
  const heavy = addItem('厚卫衣', '黑', '宽松', s, { fabric_weight: '厚' })
  const heavy2 = addItem('厚外套', '棕', '廓形', s, { fabric_weight: '厚' })
  const thin = addItem('薄衬衫', '白', '合身', s, { fabric_weight: '薄' })
  addOutfit([heavy], { weather_level: '寒冷', wear_date: '2026-01-01' }, s)
  addOutfit([heavy2], { feels_like_c: 2.4, wear_date: '2026-01-02' }, s) // 只存温度 ⇒ 现推寒冷
  addOutfit([heavy, thin], { weather_level: '舒适', wear_date: '2026-01-03' }, s)

  const cold = buildPreference({ sessionId: s }, '寒冷')
  const w = cold.dims.find((d) => d.key === 'warmth')
  assert.strictEqual(cold.weather_level_used, '寒冷')
  assert.deepStrictEqual(w.counts, { 厚: 2 }, '三套日记里只有寒冷那两套进这一轴')
  assert.strictEqual(w.value, '厚')
  assert.strictEqual(
    w.samples,
    2,
    '样本数＝这一档的票数（不是日记套数），闸门原话量的是"这一档计数"',
  )
  assert.strictEqual(
    w.in_multiplier,
    true,
    '厚薄这一轴本轮起进乘子（`19` §五 第 1 条），但下面那条 < MIN_SAMPLES 的断言才是它的护栏',
  )
  assert.match(w.basis, /寒冷：厚×2/, 'basis 出的是全部档（报告要能看出这人在别的档穿什么）')
  assert.match(w.basis, /舒适：薄×1、厚×1/)

  // 同一本日记、换一档请求 ⇒ 吃的是另一档的分布
  const comfy = buildPreference({ sessionId: s }, '舒适')
  const wc = comfy.dims.find((d) => d.key === 'warmth')
  assert.deepStrictEqual(wc.counts, { 厚: 1, 薄: 1 })
  // 并列取哪一档由 `dimFromCounts` 的词面定序决定（它不带显式 locale，随 ICU 默认序走），
  // 这一层要钉的是**确定性**而不是具体那一档：⛔ 断言写死「厚」会让下一个换 Node 版本的人莫名红一次。
  assert.ok(['厚', '薄'].includes(wc.value), '并列时也必须取到一档')
  assert.strictEqual(
    wc.value,
    buildPreference({ sessionId: s }, '舒适').dims.find((d) => d.key === 'warmth').value,
    '同一本日记连跑两次必须取同一档，否则差分与回归没法比',
  )

  // 表外词与没带 ⇒ 一律当"没带"，⛔ 不许拿脏词去乘分
  const none = buildPreference({ sessionId: s }, '很冷')
  assert.strictEqual(none.weather_level_used, null)
  assert.strictEqual(none.dims.find((d) => d.key === 'warmth').samples, 0)

  // 该档票数 < MIN_SAMPLES ⇒ 这一轴整块缺席（不乘，不是按 0 计）
  const one = buildPreference({ sessionId: s }, '炎热')
  assert.strictEqual(one.dims.find((d) => d.key === 'warmth').samples, 0, '炎热档一票都没有')
  assert.strictEqual(one.dims.find((d) => d.key === 'warmth').value, null)
  assert.strictEqual(preferenceFactor({ source: 'wardrobe', fabric_weight: '厚' }, one).factor, 1)
})

test('⑩ 乘子侧：warmth 命中 +2%／不同档 0（⛔ 不是 −1%）／候选没填厚薄不乘', () => {
  const pref = craftAxes(
    { warmth: { value: '厚', counts: { 厚: 3 }, samples: 3, share: 1 } },
    { level: '寒冷' },
  )
  const hit = preferenceFactor({ source: 'wardrobe', fabric_weight: '厚' }, pref)
  assert.strictEqual(hit.factor, 1.02)
  assert.match(hit.basis, /温度档厚薄命中你最常记的「厚」/)
  assert.match(hit.basis, /占本档 100%/, '这一轴的分母是"这一档"，出账话术不许写成"占日记"')

  const otherBand = preferenceFactor({ source: 'wardrobe', fabric_weight: '薄' }, pref)
  assert.strictEqual(otherBand.factor, 1, '取到值但不是这一档 ⇒ 0 分不扣（`19` §五 第 1 条）')
  assert.match(otherBand.basis, /没记过，不动/)

  const noValue = preferenceFactor({ source: 'wardrobe', fabric_weight: null }, pref)
  assert.strictEqual(noValue.factor, 1)
  assert.strictEqual(noValue.basis, null, '候选没填厚薄＝这一轴对它隐身，不许当"不厚"扣分')

  const junk = preferenceFactor({ source: 'wardrobe', fabric_weight: '很厚' }, pref)
  assert.strictEqual(junk.factor, 1, '词表外的厚薄当没值（与版型那一轴同一口径）')

  // 画像没吃天气档时，厚薄这一轴对一条候选说了也不算
  const noLevel = craftAxes(
    { warmth: { value: '厚', counts: { 厚: 3 }, samples: 0, share: 1 } },
    { level: null },
  )
  assert.strictEqual(
    preferenceFactor({ source: 'wardrobe', fabric_weight: '厚' }, noLevel).factor,
    1,
  )
})

test('⑩ 复穿：同一件记 4 套给 ln 那一刀、封顶 REPS_MAX、⛔ 只加不减、只对衣橱候选生效', () => {
  const s = 'p11-reps-db'
  const a = addItem('常穿的蓝衬衫', '雾霾蓝', '宽松', s)
  const b = addItem('只穿过一次的灰T', '灰', '修身', s)
  addOutfit([a, b], { name: '一套里同一件只记一次' }, s)
  addOutfit([a], { name: '第二套' }, s)
  addOutfit([a], { name: '第三套' }, s)
  addOutfit([a, a], { name: '第四套：item_ids 里重复也不算两票' }, s)
  const pref = buildPreference({ sessionId: s })
  assert.strictEqual(pref.item_reps.get(a), 4)
  assert.strictEqual(pref.item_reps.get(b), 1)
  assert.deepStrictEqual(pref.reps, { counted_items: 2, max_reps: 4 })
  assert.strictEqual(pref.dims.find((d) => d.key === 'reps').samples, 4, '闸门仍按日记套数')

  // 幅度公式逐条复算（C 档手拍值，测试钉住的是"改了常数就会被发现"，不是它有多科学）
  const at = (n) =>
    preferenceFactor(
      { source: 'wardrobe', wardrobe_item_id: 7 },
      craftAxes({}, { item_reps: new Map([[7, n]]) }),
    )
  const expected = (n) => Math.min(wp.REPS_MAX, wp.REPS_STEP * Math.log(1 + n))
  for (const n of [1, 4, 20]) {
    assert.ok(Math.abs(at(n).factor - (1 + expected(n))) < 0.001, `n=${n} 的乘子对不上 ln 那条公式`)
  }
  assert.strictEqual(at(1000).factor, 1 + wp.REPS_MAX, '记 40 次以上一律封顶，不许把总分掀翻')
  assert.match(at(4).basis, /这件你自己记了 4 套/)

  const absent = preferenceFactor(
    { source: 'wardrobe', wardrobe_item_id: 99 },
    craftAxes({}, { item_reps: new Map([[7, 4]]) }),
  )
  assert.strictEqual(
    absent.factor,
    1,
    '没记进日记＝不加分也不扣分（`19` §五 第 2 条：⛔ 只加不减）',
  )
  assert.strictEqual(absent.basis, null)

  const asRule = preferenceFactor(
    { source: 'rule', wardrobe_item_id: 7 },
    craftAxes({}, { item_reps: new Map([[7, 4]]) }),
  )
  assert.strictEqual(asRule.factor, 1, '规则库的商品与这个人自己的衬衫不是同一件东西，⛔ 不吃复穿')
})

test('⑩ 四根轴叠满仍被同一道界夹住：轴变多不许让上限变宽（`19` §五 第 4 条）', () => {
  const all = craftAxes({
    color_family: { value: '蓝', counts: { 蓝: 3 }, samples: 3, share: 1 },
    fit_type: { value: '宽松', counts: { 宽松: 3 }, samples: 3, share: 1 },
    occasion: { value: '上班通勤', counts: { 上班通勤: 3 }, samples: 3, share: 1 },
    warmth: { value: '厚', counts: { 厚: 3 }, samples: 3, share: 1 },
  })
  const up = preferenceFactor(
    {
      color_text: '雾霾蓝',
      fit_type: '宽松',
      occasion_tags: ['上班通勤'],
      fabric_weight: '厚',
      source: 'wardrobe',
      wardrobe_item_id: 7,
    },
    craftAxes(
      {
        color_family: { value: '蓝', counts: { 蓝: 3 }, samples: 3, share: 1 },
        fit_type: { value: '宽松', counts: { 宽松: 3 }, samples: 3, share: 1 },
        occasion: { value: '上班通勤', counts: { 上班通勤: 3 }, samples: 3, share: 1 },
        warmth: { value: '厚', counts: { 厚: 3 }, samples: 3, share: 1 },
      },
      { item_reps: new Map([[7, 1000]]) },
    ),
  )
  assert.strictEqual(up.basis.split('；').length, 5, '四根轴＋复穿那一刀都要在依据串里数得出来')
  assert.strictEqual(up.factor, wp.FACTOR_MAX, '满打满算 1.11，但界还是 1.05')

  const down = preferenceFactor(
    {
      color_text: '草绿',
      fit_type: '修身',
      occasion_tags: ['运动健身'],
      fabric_weight: '薄',
      source: 'wardrobe',
      wardrobe_item_id: 7,
    },
    all,
  )
  // 厚薄那一轴的"没记过"是 0，所以下界只有三刀 −1%
  assert.strictEqual(down.factor, 0.97)
  assert.ok(down.factor >= wp.FACTOR_MIN && up.factor <= wp.FACTOR_MAX)
})

// ============================================================
// ⑨ 排序层接线
// ============================================================

const PERSON = {
  gender: '女',
  ageGroup: '26-35',
  region: 'north',
  scene: 'daily',
  skin_tone: '白皙',
  scenario: '通勤',
  height: 165,
  weight: 55,
  waist: 62,
  hip: 92,
  leg_length: 90,
  shoulder: 39,
}

// 两件都量过四格的上衣：一件蓝（日记里最常记的那族）、一件灰（日记里没记过）
const TOPS = [
  {
    id: 901,
    name: '量过的蓝衬衫',
    category: '上衣',
    color: '雾霾蓝',
    fit_type: '宽松',
    shoulder_cm: 40,
    bust_cm: 96,
    length_cm: 64,
    waistband_cm: 0,
  },
  {
    id: 902,
    name: '量过的灰T',
    category: '上衣',
    color: '灰',
    fit_type: '修身',
    shoulder_cm: 38,
    bust_cm: 90,
    length_cm: 62,
    waistband_cm: 0,
  },
]

const profile = () => ({ ...PERSON, wardrobe_items: TOPS.map((t) => ({ ...t })) })
/** 名单指纹：位次 + 身份字段 + 综合分，逐条相同才算零影响 */
const fingerprint = (r) =>
  (r['穿搭'] || []).map((e) => [
    e.source,
    e.wardrobe_item_id ?? e.group_id,
    e.group_name,
    e.rank ? e.rank.score : null,
  ])

test('① 接进引擎后仍然零影响：不传身份 vs 传一个查不到行的身份 ⇒ Top 8 逐条相同', () => {
  const off = buildRecommendation(profile(), 'personal', false)
  const noDiary = buildRecommendation(profile(), 'personal', false, { sessionId: SESS_EMPTY })
  assert.ok(
    (off['穿搭'] || []).length > 0,
    '这条断言的前提是名单不许是空的——空名单上的"逐条相同"没有意义',
  )
  assert.deepStrictEqual(
    fingerprint(noDiary),
    fingerprint(off),
    '日记 0 行时名次与分数一条都不许变',
  )
  assert.strictEqual(off._computed.ranking.preference.enabled, false)
  assert.strictEqual(noDiary._computed.ranking.preference.enabled, true)
  assert.strictEqual(noDiary._computed.ranking.preference.ready, false)
  assert.strictEqual(noDiary._computed.ranking.preference.touched_in_top, 0)
  assert.ok(
    (noDiary['穿搭'] || []).every((e) => !e.rank || e.rank.preference_factor === 1),
    '每条乘子都必须恰好是 1',
  )
})

test('⑨ 日记满 3 条后这一层真的生效，且动幅不超过 ±5%、出账带 basis', () => {
  const s = 'sess-pref-live'
  const blue = addItem('日记里的蓝衬衫', '雾霾蓝', '宽松', s)
  const blue2 = addItem('日记里的蓝外套', '深蓝', '宽松', s)
  addOutfit([blue], { name: '第一套' }, s)
  addOutfit([blue2], { name: '第二套' }, s)
  addOutfit([blue, blue2], { name: '第三套' }, s)
  const pref = buildPreference({ sessionId: s })
  assert.strictEqual(pref.factor_ready, true)
  assert.strictEqual(pref.dims.find((d) => d.key === 'color_family').value, '蓝')

  const off = buildRecommendation(profile(), 'personal', false)
  const on = buildRecommendation(profile(), 'personal', false, { sessionId: s })
  const rankOf = (r, id) => r['穿搭'].find((e) => e.wardrobe_item_id === id).rank
  const blueRank = rankOf(on, 901)
  const greyRank = rankOf(on, 902)
  assert.strictEqual(blueRank.preference_factor, 1.04, '蓝＋宽松双命中')
  assert.strictEqual(greyRank.preference_factor, 0.98, '灰与修身都没记过 ⇒ 双 −1%')
  assert.match(blueRank.preference_basis, /色族偏爱命中你最常记的「蓝」/)
  assert.match(greyRank.preference_basis, /你的日记里没记过/)
  for (const [id, f] of [
    [901, 1.04],
    [902, 0.98],
  ]) {
    const before = rankOf(off, id).score
    const after = rankOf(on, id).score
    assert.ok(
      Math.abs(after - Math.round(before * f * 10) / 10) <= 0.1,
      `第 ${id} 号的变化对不上乘子：${before} → ${after}（×${f}）`,
    )
    assert.ok(Math.abs(after - before) <= Math.max(1, before * 0.05), '动幅不得超过 ±5%')
  }
  const p = on._computed.ranking.preference
  assert.strictEqual(p.ready, true)
  assert.strictEqual(p.samples, 3)
  // 前 N 条里被动了几条：与名单里 `preference_factor !== 1` 的条数必须自洽（现量 10-20：3 条＝
  // 两件衣橱行 + 一条兜底「白色衬衫」，规则那条也是按它自己的色名算的，不是漏网）
  assert.strictEqual(
    p.touched_in_top,
    on['穿搭'].filter((e) => e.rank && e.rank.preference_factor !== 1).length,
  )
  assert.ok(p.touched_in_top >= 2, `两件衣橱行都该被动到，实际 ${p.touched_in_top}`)
  assert.ok(
    on['穿搭'].every(
      (e) => !e.rank || (e.rank.preference_factor >= 0.95 && e.rank.preference_factor <= 1.05),
    ),
    '名单里每一条的乘子都必须落在界内',
  )
  assert.deepStrictEqual(p.axes, wp.MULTIPLIER_AXES)
  assert.deepStrictEqual(p.range, [wp.FACTOR_MIN, wp.FACTOR_MAX])
  assert.strictEqual(p.min_samples, wp.MIN_SAMPLES)
  assert.match(
    on._computed.ranking.note,
    /偏好乘子/,
    '人话说明里必须交代这一层（报告与后台读的是同一段）',
  )
  // 蓝的那件本来若就在灰的前面，乘子只许让它更靠前，不许把它从后面抬到榜外
  assert.ok(
    on['穿搭'].findIndex((e) => e.wardrobe_item_id === 901) <=
      off['穿搭'].findIndex((e) => e.wardrobe_item_id === 901),
    '命中偏爱的那条名次只许持平或上升',
  )
})

test('⑩ 接进引擎：请求带「寒冷」时厚薄那一刀真的落到衣橱候选上，不带时一分不动', () => {
  const s = 'p11-engine-warmth'
  const heavy = addItem('日记里的厚卫衣', '黑', '宽松', s, { fabric_weight: '厚' })
  addOutfit([heavy], { weather_level: '寒冷', wear_date: '2026-01-01' }, s)
  addOutfit([heavy], { weather_level: '寒冷', wear_date: '2026-01-02' }, s)
  addOutfit([heavy], { weather_level: '寒冷', wear_date: '2026-01-03' }, s)

  // 一件"厚"的实测上衣进候选池（903），另外两件（901/902）没有厚薄格 ⇒ 对它俩这一轴隐身
  const withHeavy = () => ({
    ...PERSON,
    wardrobe_items: [
      ...TOPS.map((t) => ({ ...t })),
      {
        id: 903,
        name: '量过的厚外套',
        category: '上衣',
        // 色名故意选日记里没有的（日记那件是「黑」）⇒ 色族那一轴固定 −1%，
        // 这样"带档 / 不带档"两次的差值才只可能是厚薄那一刀，不会被 ±5% 那道夹紧吃掉。
        color: '酒红',
        fit_type: '宽松',
        fabric_weight: '厚',
        shoulder_cm: 42,
        bust_cm: 100,
        length_cm: 70,
        waistband_cm: 0,
      },
    ],
  })
  const rankOf = (r, id) => r['穿搭'].find((e) => e.wardrobe_item_id === id).rank
  const off = buildRecommendation(withHeavy(), 'personal', false, { sessionId: s })
  const on = buildRecommendation({ ...withHeavy(), weather_level: '寒冷' }, 'personal', false, {
    sessionId: s,
  })
  assert.strictEqual(off._computed.ranking.preference.weather_level_used, null)
  assert.strictEqual(on._computed.ranking.preference.weather_level_used, '寒冷')
  assert.deepStrictEqual(on._computed.ranking.preference.reps, { counted_items: 1, max_reps: 3 })
  const f0 = rankOf(off, 903).preference_factor
  const f1 = rankOf(on, 903).preference_factor
  assert.ok(
    Math.abs(f1 - (f0 + wp.LIFT_TOP)) < 0.0005,
    `带档那一次只该多出厚薄这一刀：${f0} → ${f1}`,
  )
  assert.match(rankOf(on, 903).preference_basis, /温度档厚薄命中你最常记的「厚」/)
  // 没填厚薄的那两件：这一轴对它们逐条隐身 ⇒ 两次跑出来的乘子逐字相同
  for (const id of [901, 902]) {
    assert.strictEqual(
      rankOf(on, id).preference_factor,
      rankOf(off, id).preference_factor,
      `第 ${id} 号没填厚薄，天气档不许动它一分`,
    )
  }
  // 四轴进账（出账里的 axes 就是 MULTIPLIER_AXES 那份名单，前端与报告读同一个数组）
  assert.deepStrictEqual(on._computed.ranking.preference.axes, [
    'color_family',
    'fit_type',
    'occasion',
    'warmth',
  ])
  assert.deepStrictEqual(on._computed.ranking.preference.lifts.reps, {
    step: wp.REPS_STEP,
    max: wp.REPS_MAX,
  })
})

test('⑨ rankDims 的出账：偏好乘子与 factor／algo_penalty 同层，且不改那三个权重', () => {
  const pref = craftPref({ value: '蓝', share: 1, counts: { 蓝: 3 }, samples: 3 })
  const cand = { priority: 8, score: 60, color_fit: { score: 50 } }
  const plain = rankDims(cand, { isRule: true })
  const lifted = rankDims({ ...cand, color_text: '雾霾蓝' }, { isRule: true }, pref)
  assert.strictEqual(plain.preference_factor, 1)
  assert.strictEqual(plain.preference_basis, null)
  assert.strictEqual(lifted.preference_factor, 1.02)
  assert.ok(
    Math.abs(lifted.score - Math.round(plain.score * 1.02 * 10) / 10) <= 0.1,
    `总分对不上：${plain.score} → ${lifted.score}`,
  )
  assert.deepStrictEqual(
    Object.keys(lifted).sort(),
    Object.keys(plain).sort(),
    '出账字段两边必须同一套（新字段要一路带到报告，不许只在一侧出现）',
  )
  assert.deepStrictEqual(
    lifted.dims.map((d) => `${d.key}:${d.weight}`),
    plain.dims.map((d) => `${d.key}:${d.weight}`),
    '偏好这一层绝不许改动那三个权重的账',
  )
})
