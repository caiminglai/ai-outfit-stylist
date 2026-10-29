/**
 * 协同过滤层（`services/collabFilter.js`）的单测（2026-10-21 第九阶段·第一步建档，同日第十一阶段·第一步加第二路，
 * 2026-10-22 第十三阶段·第一步加第三路）
 *
 * 规范逐字在 `docs/依据/17-协同过滤输入输出规范-20261021.md` §四（星级那一路）
 * ＋ `docs/依据/19-穿搭日记与天气输入输出规范-20261021.md` §六（日记属性档那一路）
 * ＋ `docs/依据/21-算法四轴输入输出规范-20261021.md` §五（色族那一路）。这一层今天上线就是**隐身**的
 * （库里能凑出一个同组的样本一条都没有），所以这里钉的全是"关得住"的方向：
 *  ① 零样本 ⇒ 模型 null、每条乘子恰好 1；
 *  ② 同组不足 3 人 ⇒ 不出话术、乘子恰好 1（隐私与噪声共用那道闸，§4.2/§4.4）；
 *  ③ 满 3 人 ⇒ 高分抬、低分压，且**永远落在 [0.95,1.05]**（与偏好乘子同界，§4.2）；
 *  ④ 自己给这件打的分不算进"同组别人的均值"（§4.1 逐字"其他 actor_key"＋§4.3 反馈回路退出）——
 *     `'s'+session` 与 `'u'+user_id` 两把键各验一次，因为这一层认自己只认 actor_key 这一个字符串；
 *  ④b 同组均值等于全局均值时乘子**恰好是 1**（这一层量的是"这群人评这件比评别的更高还是更低"，
 *     不是绝对星级：全组只评过这一件 ⇒ 无从比较 ⇒ 闭嘴，宁可不说话也不把"只评了一件"读成"很爱"）；
 *  ⑤ 体型太远的人不进组；只有身高一格可比也不进组（不许把缺的格当 0 差白送相似）；
 *  ⑥ 场合凑不到同场合的分 ⇒ 退回不限场合，**话术跟着改口**（不许硬说"在这个场合"）；
 *  ⑦ `COLLAB_FILTER_ENABLED=0` ⇒ 整层关掉，同一份候选的名次与改前逐条相同（§4.3 那条一键关）；
 *  ⑧ 这一层不进三维出账：`dims` 与不带模型时**逐字段相同**，只有总分与 `collab_*` 那四个出账字段变。
 *
 * 🔴 2026-10-21 第十一阶段·第一步加的第二路信号（`19` §六），钉的是这几件事：
 *  ⑪ 星级 0 行、只有别人的日记 ⇒ 模型不再 null，那一档厚薄吃到乘子（三档各算各的份额，
 *     组内份额＝全局份额时仍然恰好 1，"没人穿过中"读成 1 不读成"别穿"）；
 *  ⑫ 本次没带温度档（或带的是表外词）⇒ 第二路整块缺席，⛔ 系统绝不替用户猜一档；
 *  ⑬ ⛔ 跨人永远不比单品：别人日记里的 item id 与我这件同号，星级那一路也不许因此认识它；
 *  ⑭ 那道"不足 3 人"的隐私闸是**两路共用一个数**，分母是人不是套；游客日记进不了组；
 *  ⑮ 两个 factor 相乘后**只夹紧一次**，两路都满格也只剩 [0.95,1.05] 这一道界（上限不变宽）、
 *     话术各说各的（⛔ 不折成中间值）；
 *  ⑯ 自己的日记不进同组（反馈回路两路同断，n 与全局分母同时被钉住）；
 *  ⑰ 只存体感温度也算得出档（退回同一把 `levelFromFeelsLike`，⛔ 不重切阈值）；
 *  ⑱ 引擎现场：带档时 `_computed.ranking.collab.diary_signal` 出账、那一档真的动衣橱候选的乘子；
 *     不带档时 `diary_signal` 恰好 `null`（"上线即隐身"要读得出来）。
 *
 * 🔴 2026-10-22 第十三阶段·第一步加的第三路信号（`docs/依据/21` §五：同组人的**色族**分布）：
 *  ⑲ 第三路**不看温度档**（`21` §五 点名的闸门只有那四个数）⇒ 没带天气也能建得起来；组内份额与
 *     全局份额分叉时抬/压，取不到色的候选对它逐条隐身（⛔ 不按"组里最多的那族"抬、也不按"没人穿的族"压）；
 *  ⑳ 人数闸与反馈回路**三路共用同一个数**：2 个人 3 套 ⇒ 闭嘴；我自己那套既不进 n 也不进全局分母；
 *     游客日记（查不到体型）算进分母但进不了组；
 *  ㉑ 零样本形状（§八·13 前一半）：`factor` **恰好 1**、三路 basis 全 `null`、三个新键退回缺席值；
 *     模型在场但这一条三路都吃不到 ⇒ 同样回到缺席形状；
 *  ㉒ 引擎现场（§八·13 后一半）：不带天气只靠色族就动了衣橱两条候选的乘子（1.009／0.991）、
 *     `color_signal` 出账只给聚合数；**不传身份时 Top 8 与库里 0 行那份逐条相同**（默认关得住）。
 *
 * ⚠️ ⑫⑰ 这两条第十一阶段的老断言在第十三阶段要改 fixture：它们钉的是"没带档 ⇒ 整层回到 null 形状"，
 * 而第三路不看档，所以那两格的衣橱行显式把色留空（`ensureShelfBand(id, band, null)`）。
 * 老断言的**意图**一个字没动；第三路自己的在场／隐身由 ⑲~㉒ 钉，⛔ 不借它们的地盘。
 *
 * 活库隔离：`db/init` 用内存库替身顶掉（与 test/itemFeedback.test.js 同一套路），全程不碰
 * backend/db/styleai.db。运行: node --test test/collabFilter.test.js
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

const CF = require('../services/collabFilter')
const { buildRecommendation, rankDims } = require('../services/recommendEngine')

const SELF = { sessionId: 'sess-cf-self' }
// 这一层的身份键只认 actorKeyOf 那一个字符串：没有 user_id 的会话走 's'+session 那把（services/itemFeedback.js:37）
const SELF_KEY = `s${SELF.sessionId}`

/**
 * 内存库的外键是真开着的：`item_feedback.user_id → users(id)`、
 * `item_feedback.wardrobe_item_id → user_wardrobe(id)`、`body_metrics.user_id → users(id)`
 * 三条只要引用了不存在的行就当场 SQLITE_CONSTRAINT_FOREIGNKEY。所以造样本前先把被引用的两张表补齐。
 */
function ensureUser(userId) {
  memDb
    .prepare('INSERT OR IGNORE INTO users (id, session_id) VALUES (?, ?)')
    .run(userId, `sess-cf-u${userId}`)
}
function ensureItem(itemId) {
  memDb
    .prepare(
      `INSERT OR IGNORE INTO user_wardrobe (id, session_id, name, category, color, fit_type)
       VALUES (?, 'sess-cf-shelf', ?, '上衣', '雾霾蓝', '合身')`,
    )
    .run(itemId, `cf-item-${itemId}`)
}

/** 造一条"人×衣服"的打分（同组那几个人的星级来源） */
function seedRating(actorKey, userId, itemId, aesthetic, occasion = null) {
  if (userId != null) ensureUser(userId)
  ensureItem(itemId)
  memDb
    .prepare(
      `INSERT INTO item_feedback (actor_key, user_id, wardrobe_item_id, occasion, aesthetic_score, fit_score)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(actorKey, userId, itemId, occasion, aesthetic, aesthetic)
}

/** 造一条体型档案（cohort 的距离就算这三格，两路信号共用） */
function seedBody(userId, height, bust, shoulder) {
  ensureUser(userId)
  memDb
    .prepare(
      `INSERT INTO body_metrics (user_id, height_cm, bust_cm, shoulder_width_cm) VALUES (?, ?, ?, ?)`,
    )
    .run(userId, height, bust, shoulder)
}

/**
 * 🔴 第十一阶段第二路信号的工装：给货架上那件标一个厚薄档。
 * 第二路比的是**属性档**（`19` §六 第 1 条：跨人不能比 item id），所以这套造的是"谁的哪一套日记里
 * 有哪一档"，不是"谁穿了第 7 号那件"。
 *
 * 🔴 第十三阶段第三路上线后多一个参数：`color`＝那一件的色（货架行默认 '雾霾蓝'＝蓝这一族）。
 * 需要"厚薄有、色族没有"的 fixture（⑫⑰ 那两条钉的是"没带档就整层隐身"，它们要第三路也闭嘴）
 * 就显式传 `null`；⛔ 不许为了让老断言变绿而把第三路的闸门改掉。
 */
function ensureShelfBand(itemId, band, color = '雾霾蓝') {
  ensureItem(itemId)
  memDb
    .prepare('UPDATE user_wardrobe SET fabric_weight = ?, color = ? WHERE id = ?')
    .run(band, color, itemId)
  return itemId
}

/** 造一套日记（样本单位＝套，⛔ 不是件）；`level` 给 null 时靠 `extra.feelsLike` 折算 */
function seedDiary(userId, itemIds, level, occasion = null, extra = {}) {
  ensureUser(userId)
  const r = memDb
    .prepare(
      `INSERT INTO wardrobe_outfits
         (user_id, session_id, name, item_ids, occasion, weather_level, feels_like_c, wear_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      `sess-cf-u${userId}`,
      extra.name || `cf-diary-${userId}`,
      JSON.stringify(itemIds),
      occasion,
      level,
      extra.feelsLike === undefined ? null : extra.feelsLike,
      extra.wearDate || null,
    )
  return r.lastInsertRowid
}

function clearAll() {
  memDb.prepare('DELETE FROM item_feedback').run()
  memDb.prepare('DELETE FROM body_metrics').run()
  // 第二路上线后日记也是样本源 ⇒ 每格的起点必须是空表，否则上一条用例的日记会渗进下一条
  memDb.prepare('DELETE FROM wardrobe_outfits').run()
}

const TALL = { height: 168, bust: 88, shoulder: 39 }

test('① 库里一行都没有 ⇒ 模型直接 null（上线即隐身，⛔ 不拿日记或规则命中数冒充 likes）', () => {
  clearAll()
  assert.strictEqual(CF.buildCohortModel(SELF, TALL, null), null)
})

test('①b 没身份 / 连身高都没有 ⇒ 同样 null（§4.1：身高都没有就不组 cohort）', () => {
  clearAll()
  seedRating('u11', 11, 1, 5)
  seedBody(11, 168, 88, 39)
  assert.strictEqual(CF.buildCohortModel(null, TALL, null), null)
  assert.strictEqual(CF.buildCohortModel({}, TALL, null), null, '两样身份都没有 ⇒ 不读任何人的分')
  assert.strictEqual(
    CF.buildCohortModel(SELF, { height: null, bust: 88, shoulder: 39 }, null),
    null,
    '身高缺席 ⇒ 整层隐身（不是按 0 参与距离）',
  )
})

test('② 同组不足 3 人 ⇒ byItem 空、乘子恰好 1、话术不出现在出账里', () => {
  clearAll()
  for (const [i, uid] of [11, 12].entries()) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedBody(uid, 168 + i, 88, 39)
  }
  const m = CF.buildCohortModel(SELF, TALL, null)
  assert.ok(m, '有样本就该出模型（出模型≠生效）')
  assert.strictEqual(m.cohort_size, 2)
  assert.strictEqual(m.byItem.size, 0, '不足 3 人 ⇒ 一件都不出话术')
  assert.match(m.provenance, /不足 3 人/)
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 7 }, m).factor, 1)
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 7 }, m).basis, null)
})

test('③ 满 3 人：这件比同组人的平均手高分 ⇒ 抬，低 ⇒ 压；两边都在 ±5% 界内且没打满', () => {
  clearAll()
  // 每人评两件：7 号是被测的那件，8 号恒打"另一头"的星（6−score）⇒ 全局均值钉在 3 星，
  // 7 号才有偏离可乘。⛔ 只评一件时组内均值＝全局均值，这一层恰好不动（那是 ④b 的断言）。
  const seed = (score) => {
    for (let uid = 11; uid <= 13; uid++) {
      seedRating(`u${uid}`, uid, 7, score)
      seedRating(`u${uid}`, uid, 8, 6 - score)
      seedBody(uid, 168, 88, 39)
    }
  }
  seed(5)
  const up = CF.buildCohortModel(SELF, TALL, null)
  assert.strictEqual(up.cohort_size, 3)
  assert.strictEqual(up.global_mean, 3, '六条分里三件 5 星三件 1 星 ⇒ 全局均值 3')
  const hi = CF.collabFactor({ wardrobe_item_id: 7 }, up)
  assert.strictEqual(hi.n, 3)
  // 期望值逐字算：shrunk=(3·5+5·3)/8=3.75 ⇒ factor=1+0.06·((3.75−3)/4)=1.01125 ⇒ 出账 1.011
  assert.strictEqual(hi.factor, 1.011, `高分该抬且不越界: ${hi.factor}`)
  assert.match(hi.basis, /同组 3 人/, `出账要带人数: ${hi.basis}`)

  clearAll()
  seed(1)
  const down = CF.buildCohortModel(SELF, TALL, null)
  const lo = CF.collabFactor({ wardrobe_item_id: 7 }, down)
  assert.strictEqual(lo.factor, 0.989, `低分该压且不越界: ${lo.factor}`)
  assert.ok(lo.factor > CF.COLLAB_CONFIG.FACTOR_MIN, '压到底也不许出界')
  // 收缩（K_PRIOR=5）在这里必须看得见：组内均值 5 星、全局均值 3 星，
  // 不收缩的话 3 条样本就能顶满 ±4.5%，收缩后必须明显更小——这一条不钉住，
  // 以后有人把 K 调成 0 就等于把"3 个人"读成"整个人群"，那是本项目那类注水病灶。
  assert.ok(
    hi.factor < 1 + CF.COLLAB_CONFIG.AMP,
    `n=3 时不许打满幅度（经验贝叶斯必须真的在收缩）: ${hi.factor}`,
  )
})

test('④b 全组只评过这一件 ⇒ 组内均值＝全局均值 ⇒ 乘子恰好 1（不把"只评了一件"读成"很爱"）', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedBody(uid, 168, 88, 39)
  }
  const m = CF.buildCohortModel(SELF, TALL, null)
  assert.strictEqual(m.global_mean, 5)
  const hit = CF.collabFactor({ wardrobe_item_id: 7 }, m)
  assert.strictEqual(hit.n, 3, '同组确实有 3 条（模型是建起来的）')
  assert.strictEqual(hit.factor, 1, '但没有可比对象 ⇒ 一个名次都不许动')
})

test('④ 自己给这件打的分不进同组均值（反馈回路从源头断掉，两把键各验一次）', () => {
  clearAll()
  for (const [uid, score] of [
    [11, 1],
    [12, 1],
    [13, 1],
    [14, 5],
  ]) {
    seedRating(`u${uid}`, uid, 7, score)
    seedBody(uid, 168, 88, 39)
  }
  // 我自己（游客那把 's' 键）也给 7 号打 5 星：一旦混进同组，均值从 2.0 抬到 2.6，当场看得见。
  // ⚠️ 这里必须给它带上 user_id＋体型档案——体型只按 user_id 查 `body_metrics`，
  //    一行既无 user_id 又只有 's' 键的打分在这层是**谁都进不了组**的（⑦钉的就是这半边）。
  seedRating(SELF_KEY, 900, 7, 5)
  seedBody(900, 168, 88, 39)
  const guest = CF.buildCohortModel(SELF, TALL, null)
  assert.strictEqual(guest.self_key, SELF_KEY, '游客身份在这一层用的是 s+session 那把键')
  assert.strictEqual(guest.byItem.get(7).n, 4, '同组只该看到别人那四条')
  assert.strictEqual(guest.byItem.get(7).mean, 2, '(1+1+1+5)/4=2.0，我自己那条 5 星没掺进去')

  // 对照：u900 这个身份看同一件 ⇒ 满五条。⛔ 认自己只认 actor_key 这一个字符串，
  //    同一具身体挂着另一把键写的那行照样算"别人"——这就是 17 §八 第 2 条那笔两把键的代价。
  const stranger = CF.buildCohortModel({ userId: 900 }, TALL, null)
  assert.strictEqual(stranger.byItem.get(7).n, 5)
  assert.strictEqual(stranger.byItem.get(7).mean, 2.6)

  // 登录那把 'u' 键同样把自己排除在外：换成 u11 的身份，它那 1 星掉出去 ⇒ (1+1+5+5)/4=3.0
  const asMember = CF.buildCohortModel({ userId: 11 }, TALL, null)
  assert.strictEqual(asMember.self_key, 'u11')
  assert.strictEqual(asMember.byItem.get(7).n, 4)
  assert.strictEqual(asMember.byItem.get(7).mean, 3)
})

test('⑤ 体型差过阈值不进组；只有身高一格可比也不算相似', () => {
  clearAll()
  const near = { height: 168, bust: 88, shoulder: 39 }
  assert.ok(CF.bodyDistance(near, { height: 170, bust: 90, shoulder: 40 }) < 0.35)
  assert.strictEqual(
    CF.bodyDistance(
      { height: 168, bust: null, shoulder: null },
      { height: 168, bust: 96, shoulder: 45 },
    ),
    null,
    '只有身高一格可比 ⇒ 判不可比（⛔ 不许把缺的格当 0 差白送相似）',
  )
  assert.ok(
    CF.bodyDistance(near, { height: 185, bust: 110, shoulder: 45 }) > CF.COLLAB_CONFIG.DIST_MAX,
    '差三个码子的人不该进组',
  )

  // 库里的现场：远处那两个人给 7 号打 5 星，近处只有一个人 ⇒ 不足 3 人 ⇒ 不生效
  for (const [uid, h] of [
    [11, 186],
    [12, 187],
  ]) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedBody(uid, h, 110, 45)
  }
  seedRating('u13', 13, 7, 5)
  seedBody(13, 168, 88, 39)
  const m = CF.buildCohortModel(SELF, TALL, null)
  assert.strictEqual(m.cohort_size, 1, '距离阈值外的两个人不该进组')
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 7 }, m).factor, 1)
})

test('⑥ 场合：凑得到同场合的分就按场合说话，凑不到就退回不限场合且话术跟着改口', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedRating(`u${uid}`, uid, 7, 5, '居家休闲')
    seedBody(uid, 168, 88, 39)
  }
  const withOcc = CF.buildCohortModel(SELF, TALL, '居家休闲')
  assert.strictEqual(withOcc.occasion_used, '居家休闲')
  assert.match(CF.collabFactor({ wardrobe_item_id: 7 }, withOcc).basis, /·居家休闲/)

  const fallback = CF.buildCohortModel(SELF, TALL, '婚礼宴会')
  assert.strictEqual(fallback.occasion_used, null, '同场合凑不到一条 ⇒ 退回不限场合')
  assert.match(
    CF.collabFactor({ wardrobe_item_id: 7 }, fallback).basis,
    /不分场合/,
    '退回不限场合时话术必须跟着改口，⛔ 不许继续说"在这个场合"',
  )
})

test('⑦ 没体型档案的人不进组（⛔ 不许当成距离 0 白送相似）', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) seedRating(`u${uid}`, uid, 7, 5)
  seedBody(11, 168, 88, 39)
  const m = CF.buildCohortModel(SELF, TALL, null)
  assert.strictEqual(m.cohort_size, 1)
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 7 }, m).factor, 1)
})

test('⑧ 这一层不进三维出账：dims 逐字段相同，只有总分与 collab_* 四个字段变', () => {
  clearAll()
  const cand = {
    wardrobe_item_id: 7,
    color_fit: { score: 60 },
    body_fit: { score: 70, coverage: 1 },
  }
  const plain = rankDims(cand, { isRule: false })
  for (let uid = 11; uid <= 13; uid++) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedRating(`u${uid}`, uid, 8, 1)
    seedBody(uid, 168, 88, 39)
  }
  const m = CF.buildCohortModel(SELF, TALL, null)
  const hit = rankDims(cand, { isRule: false }, null, m)
  assert.deepStrictEqual(hit.dims, plain.dims, '三维的分数与权重一个字都不许动')
  assert.strictEqual(plain.collab_factor, 1)
  assert.strictEqual(plain.collab_basis, null)
  assert.ok(hit.score > plain.score && hit.score - plain.score <= plain.score * 0.05 + 0.1)
  assert.strictEqual(hit.collab_cohort_size, 3)
  assert.strictEqual(hit.collab_n, 3)

  // 规则那一路没有"这一件" ⇒ 结构上进不了这张表 ⇒ 恰好 ×1
  const ruleCand = { priority: 3, score: 80, color_fit: { score: 60 } }
  assert.strictEqual(
    rankDims(ruleCand, { isRule: true }, null, m).collab_factor,
    1,
    '规则命中的条目没有 wardrobe_item_id ⇒ 这一层不许碰它',
  )
})

test('⑨ 引擎现场：库里 0 行时带身份与不带身份，Top 8 名单与每条总分逐条相同', () => {
  clearAll()
  ensureItem(7)
  const profile = {
    gender: '女',
    scenario: '通勤',
    skin_tone: '白皙',
    height: 165,
    weight: 55,
    wardrobe_items: [
      {
        id: 7,
        name: '雾霾蓝衬衫',
        category: '上衣',
        color: '雾霾蓝',
        fit_type: '合身',
        shoulder_cm: 42,
        bust_cm: 100,
        length_cm: 68,
      },
      {
        id: 8,
        name: '焦糖色针织衫',
        category: '上衣',
        color: '焦糖色',
        fit_type: '宽松',
        shoulder_cm: 40,
        bust_cm: 96,
        length_cm: 62,
      },
    ],
  }
  /** 名单指纹：位次 + 身份字段 + 综合分 + 这一层的乘子，逐条相同才算零影响 */
  const fingerprint = (r) =>
    (r['穿搭'] || []).map((e) => [
      e.source,
      e.wardrobe_item_id ?? e.group_id,
      e.group_name,
      e.rank ? e.rank.score : null,
      e.rank ? e.rank.collab_factor : null,
    ])
  const a = buildRecommendation(profile, 'personal', false, { sessionId: 'sess-cf-x' })
  const b = buildRecommendation(profile, 'personal', false, null)
  assert.ok(
    (b['穿搭'] || []).length > 0,
    '这条断言的前提是名单不许是空的——空名单上的"逐条相同"没有意义',
  )
  assert.deepStrictEqual(fingerprint(a), fingerprint(b), '零样本 ⇒ 名单与每条总分逐条相同')
  assert.ok(a._computed.ranking.collab, '出账块必须在（隐身也要能被读出来）')
  assert.strictEqual(a._computed.ranking.collab.cohort, null)
  assert.strictEqual(a._computed.ranking.collab.signals_in_db, 0)
  assert.strictEqual(a._computed.ranking.collab.touched_in_top, 0)
  assert.ok(
    a['穿搭'].every((e) => !e.rank || e.rank.collab_factor === 1),
    '每条乘子都必须恰好是 1',
  )
})

test('⑩ 一键关：COLLAB_FILTER_ENABLED=0 ⇒ 模型 null、rankDims 与改前逐字节相同', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedRating(`u${uid}`, uid, 8, 1)
    seedBody(uid, 168, 88, 39)
  }
  // 🔴 第十一阶段：开关必须让**两路**一起死。这里同时把日记喂进去（同组 3 人全是"厚"），
  // 若关掉后模型还不是 null，就说明有人把第二路写在了开关外面。
  for (let uid = 11; uid <= 13; uid++) {
    seedDiary(uid, [ensureShelfBand(200 + uid, '厚')], '寒冷')
  }
  const cand = {
    wardrobe_item_id: 7,
    color_fit: { score: 60 },
    body_fit: { score: 70, coverage: 1 },
    fabric_weight: '厚',
  }
  // 改前那份出账：不传模型就是这一层存在之前的样子（乘子 1、四个字段全是缺席值）
  const plainJson = JSON.stringify(rankDims(cand, { isRule: false }))
  const openModel = CF.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.ok(openModel.byItem.size > 0, '开关没关时星级这一路是生效的（对照用）')
  assert.ok(openModel.diary, '开关没关时日记这一路也是生效的（对照用）')
  const before = JSON.stringify(rankDims(cand, { isRule: false }, null, openModel))
  assert.notStrictEqual(before, plainJson, '开着时这一层确实动了总分（不然下面的对照没意义）')

  process.env.COLLAB_FILTER_ENABLED = '0'
  delete require.cache[require.resolve('../services/collabFilter')]
  const off = require('../services/collabFilter')
  assert.strictEqual(off.COLLAB_CONFIG.enabled, false)
  const offModel = off.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.strictEqual(offModel, null, '关掉后连模型都不组（星级与日记两路一起退出）')
  assert.strictEqual(
    JSON.stringify(rankDims(cand, { isRule: false }, null, offModel)),
    plainJson,
    '关掉之后必须逐字节回到改前那份出账（模型为 null ⇒ 连那四个出账字段都退回缺席值）',
  )
  assert.strictEqual(off.collabFactor(cand, null).factor, 1)
  delete process.env.COLLAB_FILTER_ENABLED
  delete require.cache[require.resolve('../services/collabFilter')]
  require('../services/collabFilter')
})

test('⑪ 第二路上线：库里 0 条打分、只有别人的日记 ⇒ 模型不再 null，那一档真的吃到乘子', () => {
  clearAll()
  // 近处三人：寒冷档各记一套，穿的都是"厚"
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(300 + uid, '厚')], '寒冷')
  }
  // 远处两人：同样是寒冷档，穿的是"薄"（他们进不了组，但他们是**全局份额**的分母）
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(320 + uid, '薄')], '寒冷')
  }
  const m = CF.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.ok(m, '星级 0 行但日记有货 ⇒ 这一路不看第一路的脸色，模型必须建起来')
  assert.strictEqual(m.global_mean, null, '库里没有别人的打分 ⇒ 星级那一路的均值就是没有')
  assert.strictEqual(m.cohort_size, 0, '星级那一路的同组人数是 0（两路的分母各算各的，⛔ 不混）')
  assert.strictEqual(m.byItem.size, 0, '一件都没有打分 ⇒ 星级这一路不出话术')
  assert.ok(m.diary, '日记这一路必须出账')
  assert.strictEqual(m.diary.cohort_people, 3)
  assert.strictEqual(m.diary.cohort_diary_sets, 3, 'n＝组内在这个温度档记过几**套**（`19` §六.2）')
  assert.strictEqual(m.diary.pool_diary_sets, 5, '全局分母＝这一档下别人的全部日记套数')
  // 逐字算：厚 组内份额 3/3=1、全局 3/5=0.6 ⇒ shrunk=(3·1+5·0.6)/8=0.75 ⇒ 1+0.06·0.15=1.009
  assert.strictEqual(
    m.diary.byBand.get('厚').factor,
    1.009,
    `厚该抬: ${m.diary.byBand.get('厚').factor}`,
  )
  // 薄 组内 0/3、全局 2/5=0.4 ⇒ shrunk=(0+2)/8=0.25 ⇒ 1−0.009=0.991（这一路是**双向**的）
  assert.strictEqual(m.diary.byBand.get('薄').factor, 0.991)
  // 中：组内 0、全局也 0 ⇒ 没有偏离 ⇒ 恰好 1（⛔ 不许把"没人穿过"读成"别穿"）
  assert.strictEqual(m.diary.byBand.get('中').factor, 1)
  assert.match(m.provenance, /日记这一路：/)

  const hit = CF.collabFactor({ wardrobe_item_id: 900, fabric_weight: '厚' }, m)
  assert.strictEqual(hit.star_factor, 1, '这件没人打过分 ⇒ 星级那一路恰好 1')
  assert.strictEqual(hit.diary_factor, 1.009)
  assert.strictEqual(hit.factor, 1.009)
  assert.match(hit.basis, /其中 3 套穿了厚/)
  // 候选没填厚薄 ⇒ 这一路对它逐条隐身（缺测不出分），⛔ 不是按"薄"那一档压它
  const blank = CF.collabFactor({ wardrobe_item_id: 901 }, m)
  assert.strictEqual(blank.factor, 1)
  assert.strictEqual(blank.diary_band, null)
})

test('⑫ 本次没带温度档 ⇒ 第二路整块缺席（null、乘子恰好 1），⛔ 系统绝不替用户猜一档', () => {
  clearAll()
  // 🔴 这一格传 `null`＝衣橱行的色也留空：第十三阶段上线后，色族那一路**不看温度档**（`21` §五），
  // 若这里还给默认 '雾霾蓝'，第三路会替这几套日记说话、模型就不再是 null 了——那会把这条断言
  // 的**原意**（没带档 ⇒ 整层回到改前的 null 形状）冲掉。第三路自己的现场由 ⑲ 钉，不在这里蹭。
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(340 + uid, '厚', null)], '寒冷')
  }
  const m = CF.buildCohortModel(SELF, TALL, null, null)
  assert.strictEqual(
    m,
    null,
    '星级 0 行 + 没带档 + 色族也取不到 ⇒ 三路都没话要说，整层回到改前的 null 形状',
  )
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 341, fabric_weight: '厚' }, m).factor, 1)
  // 表外词同样当没带（与偏好层、写入口那把 `normalizeWeatherLevel` 同一个口径）
  assert.strictEqual(CF.buildCohortModel(SELF, TALL, null, '很冷'), null)

  // 对照：星级那一路**活着**时，模型建得起来、只有另两路是 null（三路各管各的缺席）
  for (let uid = 11; uid <= 13; uid++) {
    seedRating(`u${uid}`, uid, 7, 5)
    seedRating(`u${uid}`, uid, 8, 1)
    // 体型档案上面那个循环已经种过（`body_metrics.user_id` 是唯一行，⛔ 这里不再种第二份）
  }
  const alive = CF.buildCohortModel(SELF, TALL, null, null)
  assert.ok(alive && alive.byItem.size > 0, '星级这一路照常在（对照用）')
  assert.strictEqual(alive.diary, null)
  assert.strictEqual(alive.temperature_level, null, '出账要能读出"这一屏没带温度档"')
  assert.strictEqual(
    CF.collabFactor({ wardrobe_item_id: 7, fabric_weight: '厚' }, alive).factor,
    1.011,
  )
})

test('⑬ ⛔ 跨人只比属性档，永远不比单品：别人日记里的 id 与我这件同号也不许走星级那一路', () => {
  clearAll()
  // 三个近处的人把 7 号记进了自己的日记（7 号是货架上的公共行，⛔ 这在语义上不是"同一件衣服"）
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(7, '厚')], '寒冷')
  }
  const m = CF.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.strictEqual(
    m.byItem.size,
    0,
    'item_feedback 0 行 ⇒ 星级这一路一件都不认识（不许拿日记行冒充）',
  )
  assert.strictEqual(m.diary.pool_diary_sets, 3)
  // 全局份额＝组内份额（组就是全部）⇒ 无从比较 ⇒ 恰好 1（④b 那条同一把尺子）
  assert.strictEqual(m.diary.byBand.get('厚').factor, 1)
  const hit = CF.collabFactor({ wardrobe_item_id: 7, fabric_weight: '厚' }, m)
  assert.strictEqual(hit.star_factor, 1)
  assert.strictEqual(hit.diary_factor, 1)
  assert.strictEqual(hit.factor, 1)
})

test('⑭ 同组凑不满 3 人 ⇒ 第二路同样闭嘴（那道隐私闸是两路共用的一个数）', () => {
  clearAll()
  for (const uid of [11, 12]) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(360 + uid, '厚')], '寒冷')
  }
  // 第三个"人"是同一个人的第二套日记 ⇒ 人数还是 2（闸的门禁是**人**，不是套数）
  seedDiary(12, [ensureShelfBand(362, '薄')], '寒冷')
  const m = CF.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.strictEqual(m, null, '3 套日记但只有 2 个人 ⇒ 闭嘴（数套数就会骗过这道闸，这条钉的是它）')
  assert.strictEqual(CF.collabFactor({ wardrobe_item_id: 361, fabric_weight: '厚' }, m).factor, 1)
  // 游客日记（只有 's' 键、查不到 body_metrics）进不了组：⛔ 不许当距离 0 白送
  clearAll()
  memDb
    .prepare(
      `INSERT INTO wardrobe_outfits (session_id, name, item_ids, weather_level)
       VALUES ('sess-cf-guest', 'guest-diary', ?, '寒冷')`,
    )
    .run(JSON.stringify([ensureShelfBand(370, '厚')]))
  assert.strictEqual(CF.buildCohortModel(SELF, TALL, null, '寒冷'), null, '⑦ 那半边同一口径')
})

test('⑮ 三个 factor 相乘后**只夹紧一次**；上下界不会因为多了一路就变宽', () => {
  const fake = {
    cohort_size: 3,
    byItem: new Map([[7, { factor: CF.COLLAB_CONFIG.FACTOR_MAX, basis: '星级那一路', n: 3 }]]),
    diary: {
      cohort_diary_sets: 9,
      byBand: new Map([['厚', { factor: CF.COLLAB_CONFIG.FACTOR_MAX, basis: '日记那一路' }]]),
    },
    // 🔴 第十三阶段第三路：形状与前两路同形（`byFamily` 也是 Map<档, {factor, basis}>）
    color: {
      cohort_diary_sets: 9,
      byFamily: new Map([['蓝', { factor: CF.COLLAB_CONFIG.FACTOR_MAX, basis: '色族那一路' }]]),
    },
  }
  const hit = CF.collabFactor(
    { wardrobe_item_id: 7, fabric_weight: '厚', color_text: '雾霾蓝' },
    fake,
  )
  assert.strictEqual(hit.star_factor, 1.05)
  assert.strictEqual(hit.diary_factor, 1.05)
  assert.strictEqual(hit.color_family_factor, 1.05)
  assert.strictEqual(hit.color_family_band, '蓝')
  assert.strictEqual(hit.color_family_sets, 9)
  assert.strictEqual(
    hit.factor,
    CF.COLLAB_CONFIG.FACTOR_MAX,
    '三路都满格也只剩这一道界（1.05³=1.157625 必须被夹回 1.05，⛔ 界不许变宽、也⛔ 不许每路各夹一次）',
  )
  assert.strictEqual(
    hit.basis,
    '星级那一路；日记那一路；色族那一路',
    '三句话各说各的，⛔ 不折成一个中间值',
  )

  // 互相反对时相乘不平均：星级满格、另两路各压 0.991 ⇒ 1.05×0.991×0.991=1.0311…⇒ 1.031
  const opposed = CF.collabFactor(
    { wardrobe_item_id: 7, fabric_weight: '厚', color_text: '雾霾蓝' },
    {
      ...fake,
      diary: {
        cohort_diary_sets: 9,
        byBand: new Map([['厚', { factor: 0.991, basis: '日记那一路' }]]),
      },
      color: {
        cohort_diary_sets: 9,
        byFamily: new Map([['蓝', { factor: 0.991, basis: '色族那一路' }]]),
      },
    },
  )
  assert.strictEqual(opposed.factor, 1.031, `相乘不是取平均: ${opposed.factor}`)

  // 一路满格、另两路恰好 1 ⇒ 结果就是那一路的数（合成不该互相吃掉）
  const one = CF.collabFactor(
    { wardrobe_item_id: 7, fabric_weight: '薄' },
    {
      ...fake,
      diary: { cohort_diary_sets: 9, byBand: new Map([['薄', { factor: 1, basis: null }]]) },
    },
  )
  assert.strictEqual(one.factor, 1.05)
  // ⚠️ 这一条候选没带色（`color_text`／`outfit_top`／`top_style` 三格全空）⇒ 第三路对它逐条隐身，
  // 那句"日记那一路"的 basis 因为 factor=1、basis=null 也不出现 ⇒ 只剩星级那一句。
  assert.strictEqual(one.basis, '星级那一路')
  assert.strictEqual(one.color_family_band, null)
})

test('⑯ 自己的日记不进同组（第二路同样从源头断掉反馈回路）', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(380 + uid, '厚')], '寒冷')
  }
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(400 + uid, '薄')], '寒冷')
  }
  // 我自己（u900，体型也近）也记了一套"薄"：一旦掺进同组，n 从 3 变 4、全局从 5 套变 6 套，
  // 组内份额与全局份额同时漂移 ⇒ 期望值对不上，当场看得见（对照 ⑪ 那个 1.009）。
  seedBody(900, 168, 88, 39)
  seedDiary(900, [ensureShelfBand(420, '薄')], '寒冷')
  const m = CF.buildCohortModel({ userId: 900 }, TALL, null, '寒冷')
  assert.strictEqual(m.diary.cohort_people, 3, '同组只该看到别人那三个')
  assert.strictEqual(m.diary.cohort_diary_sets, 3)
  assert.strictEqual(m.diary.pool_diary_sets, 5, '全局分母里也不许有我这一套')
  assert.strictEqual(m.diary.byBand.get('厚').factor, 1.009)
})

test('⑰ 只存体感温度也算得出档（同一把 levelFromFeelsLike 尺子，⛔ 不在这一层重切阈值）', () => {
  clearAll()
  assert.strictEqual(CF.diaryLevelOf({ weather_level: '寒冷' }), '寒冷')
  assert.strictEqual(
    CF.diaryLevelOf({ weather_level: '很冷', feels_like_c: 2 }),
    '寒冷',
    '表外词退回体感折算',
  )
  assert.strictEqual(CF.diaryLevelOf({ feels_like_c: 26 }), '偏热')
  assert.strictEqual(CF.diaryLevelOf({}), null, '两格都没有 ⇒ 缺测不出档')
  assert.strictEqual(CF.diaryLevelOf({ feels_like_c: 'abc' }), null)

  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    // 🔴 第十三阶段：这一格留 `null` 的理由与 ⑫ 同一句——这一条钉的是"同一本日记换个档 ⇒ 另一档
    // 一套都没有 ⇒ 整层 null"，色族那一路不看档，给它上色就把这条断言冲掉了（第三路见 ⑲）。
    seedDiary(uid, [ensureShelfBand(440 + uid, '厚', null)], null, null, { feelsLike: 1 })
  }
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(460 + uid, '薄', null)], null, null, { feelsLike: 2 })
  }
  const m = CF.buildCohortModel(SELF, TALL, null, '寒冷')
  assert.strictEqual(m.diary.temperature_level, '寒冷')
  assert.strictEqual(m.diary.cohort_diary_sets, 3)
  assert.strictEqual(m.diary.byBand.get('厚').factor, 1.009)
  // 同一本日记换个档 ⇒ 吃的是另一档的分布：这里"炎热"这一档一套都没有 ⇒ 三路全哑、整层 null
  assert.strictEqual(CF.buildCohortModel(SELF, TALL, null, '炎热'), null)
})

test('⑱ 引擎现场：请求带「寒冷」时 diary_signal 出账、那一档真的动了衣橱候选的乘子；不带时为 null', () => {
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 165, 84.5, 34.7) // 与引擎给这份档案算出来的人体向量同一格 ⇒ 距离 0（现量：person_cm）
    seedDiary(uid, [ensureShelfBand(480 + uid, '厚')], '寒冷')
  }
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(500 + uid, '薄')], '寒冷')
  }
  const profile = {
    gender: '女',
    scenario: '通勤',
    skin_tone: '白皙',
    height: 165,
    weight: 55,
    wardrobe_items: [
      {
        id: 7,
        name: '雾霾蓝衬衫',
        category: '上衣',
        color: '雾霾蓝',
        fit_type: '合身',
        fabric_weight: '厚',
        shoulder_cm: 42,
        bust_cm: 100,
        length_cm: 68,
      },
      {
        id: 8,
        name: '焦糖色针织衫',
        category: '上衣',
        color: '焦糖色',
        fit_type: '宽松',
        shoulder_cm: 40,
        bust_cm: 96,
        length_cm: 62,
      },
    ],
  }
  const on = buildRecommendation({ ...profile, weather_level: '寒冷' }, 'personal', false, SELF)
  const off = buildRecommendation(profile, 'personal', false, SELF)
  assert.strictEqual(on._computed.ranking.collab.diary_signal.temperature_level, '寒冷')
  assert.strictEqual(
    on._computed.ranking.collab.diary_signal.attribute,
    CF.COLLAB_CONFIG.DIARY_ATTRIBUTE,
  )
  assert.strictEqual(on._computed.ranking.collab.diary_signal.cohort_diary_sets, 3)
  assert.strictEqual(on._computed.ranking.collab.diary_signal.pool_diary_sets, 5)
  assert.strictEqual(
    on._computed.ranking.collab.diary_signal.bands_with_signal,
    2,
    '厚抬、薄压，中不说话',
  )
  assert.strictEqual(
    off._computed.ranking.collab.diary_signal,
    null,
    '不带档 ⇒ 出账读得出"这一路隐身"',
  )

  const rank7 = (r) => r['穿搭'].find((e) => e.wardrobe_item_id === 7).rank
  assert.strictEqual(rank7(on).collab_factor, 1.009)
  assert.strictEqual(rank7(off).collab_factor, 1)
  assert.match(rank7(on).collab_basis, /和你体型相近的人在这个温度档记了 3 套/)
  // 没填厚薄那件（8 号）：这一路对它逐条隐身 ⇒ 带不带档两次乘子逐字相同
  const rank8 = (r) => r['穿搭'].find((e) => e.wardrobe_item_id === 8).rank
  assert.strictEqual(rank8(on).collab_factor, rank8(off).collab_factor)
})

test('⑲ 第三路上线（`21` §五）：同组人的色族分布——这一路⛔ 不等温度档，没带天气也能说话', () => {
  clearAll()
  // 近处三人：日记**一个温度档都没填**（`weather_level` 与 `feels_like_c` 都空），穿的都是蓝这一族
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(600 + uid, '厚', '雾霾蓝')], null)
  }
  // 远处两人：同样没填档，穿的是棕这一族（他们进不了组，但他们是**全局份额**的分母）
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(620 + uid, '薄', '焦糖色')], null)
  }
  const m = CF.buildCohortModel(SELF, TALL, null, null)
  assert.ok(
    m,
    '没带温度档 ⇒ 第二路 null，但第三路照旧建得起来（这一条就是 ⑫ 与 ⑰ 要留空色族的原因）',
  )
  assert.strictEqual(m.diary, null, '厚薄那一路仍然要等温度档，⛔ 第三路不许替它开门')
  assert.strictEqual(m.temperature_level, null)
  assert.ok(m.color, '色族这一路必须出账')
  assert.strictEqual(
    m.color.attribute,
    CF.COLLAB_CONFIG.COLOR_ATTRIBUTE,
    '轴名只许有 `COLOR_ATTRIBUTE` 一处',
  )
  assert.strictEqual(m.color.cohort_people, 3)
  assert.strictEqual(m.color.cohort_diary_sets, 3, 'n＝组内记过几**套**（与第二路同一个分母口径）')
  assert.strictEqual(m.color.pool_diary_sets, 5)
  // 逐字算（与 ⑪ 那个 1.009 同一把尺子，⛔ 第三路没有第二套收缩式）：
  // 蓝 组内 3/3=1、全局 3/5=0.6 ⇒ shrunk=(3+5·0.6)/8=0.75 ⇒ 1+0.06·0.15=1.009
  assert.strictEqual(m.color.byFamily.get('蓝').factor, 1.009)
  // 棕 组内 0/3、全局 2/5=0.4 ⇒ shrunk=2/8=0.25 ⇒ 0.991（这一路也是**双向**的）
  assert.strictEqual(m.color.byFamily.get('棕').factor, 0.991)
  assert.strictEqual(
    m.color.byFamily.size,
    2,
    '只给这一池里真出现过的族建账（⛔ 不抄第二份族表凑满十档）',
  )
  assert.match(m.provenance, /色族这一路：/)

  const blue = CF.collabFactor({ wardrobe_item_id: 900, color_text: '雾霾蓝' }, m)
  assert.strictEqual(blue.star_factor, 1, '这件没人打过分 ⇒ 星级那一路恰好 1')
  assert.strictEqual(blue.diary_factor, 1, '这次没带天气档 ⇒ 厚薄那一路恰好 1')
  assert.strictEqual(blue.color_family_factor, 1.009)
  assert.strictEqual(blue.color_family_band, '蓝')
  assert.strictEqual(blue.color_family_sets, 3)
  assert.strictEqual(blue.factor, 1.009)
  assert.match(blue.basis, /其中 3 套穿蓝这一族（同组 3 人·不分场合）/)

  // 候选身上取不到色（`color_text`／`outfit_top`／`top_style` 三格都空）⇒ 第三路对它逐条隐身，
  // ⛔ 不是按"组里最多的那一族"抬它，也不是按"没人穿的族"压它（硬规矩 2：缺测不出分）
  const blank = CF.collabFactor({ wardrobe_item_id: 901 }, m)
  assert.strictEqual(blank.factor, 1)
  assert.strictEqual(blank.color_family_band, null)
  assert.strictEqual(blank.basis, null)
})

test('⑳ 第三路共用那一道人数闸：数的是**人**不是套；⛔ 自己的日记不进同组', () => {
  clearAll()
  // 只有 2 个人、3 套日记 ⇒ 与 ⑭ 同一把闸（`MIN_COHORT` 是三路共用的一个数，⛔ 第三路不许放宽）
  for (const uid of [11, 12]) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(640 + uid, '厚', '雾霾蓝')], null)
  }
  seedDiary(12, [ensureShelfBand(642, '薄', '焦糖色')], null)
  assert.strictEqual(
    CF.buildCohortModel(SELF, TALL, null, null),
    null,
    '3 套日记但只有 2 个人 ⇒ 闭嘴',
  )

  // 满 3 人后再把我自己（u900，体型也近、也记了一套蓝）塞进去：n 与全局分母同时被钉住（⑯ 同一口径）
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(660 + uid, '厚', '雾霾蓝')], null)
  }
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(680 + uid, '薄', '焦糖色')], null)
  }
  seedBody(900, 168, 88, 39)
  seedDiary(900, [ensureShelfBand(699, '厚', '雾霾蓝')], null)
  const m = CF.buildCohortModel({ userId: 900 }, TALL, null, null)
  assert.strictEqual(m.color.cohort_people, 3, '同组只该看到别人那三个')
  assert.strictEqual(m.color.cohort_diary_sets, 3, '我这一套不许进组内的 n')
  assert.strictEqual(m.color.pool_diary_sets, 5, '全局分母里也不许有我这一套')
  assert.strictEqual(m.color.byFamily.get('蓝').factor, 1.009, '一旦掺进自己，这个数就对不上了')

  // 游客日记（只有 's' 键、查不到 body_metrics）进不了组：与 ⑦⑭ 同一口径
  clearAll()
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(700 + uid, '厚', '雾霾蓝')], null)
  }
  memDb
    .prepare(
      `INSERT INTO wardrobe_outfits (session_id, name, item_ids)
       VALUES ('sess-cf-guest2', 'guest-no-level', ?)`,
    )
    .run(JSON.stringify([ensureShelfBand(730, '厚', '焦糖色')]))
  const withGuest = CF.buildCohortModel(SELF, TALL, null, null)
  assert.strictEqual(
    withGuest.color.pool_diary_sets,
    4,
    '游客那套算进**全局分母**、但进不了组（体型查不到）——与第二路 `pool_diary_sets` 同一口径',
  )
  assert.strictEqual(withGuest.color.cohort_diary_sets, 3, '组内的 n 里不许有查不到体型的那套')
  assert.strictEqual(withGuest.color.cohort_people, 3)
})

test('㉑ 零样本形状（§八·13 前一半）：三路 basis 全 null、三个乘子键恰好 1、合成后 factor 恰好 1', () => {
  clearAll()
  const cand = {
    wardrobe_item_id: 7,
    fabric_weight: '厚',
    color_text: '雾霾蓝',
    occasion_tags: ['通勤'],
  }
  const none = CF.collabFactor(cand, null)
  assert.strictEqual(none.factor, 1, '没有模型 ⇒ 恰好 1（不是 0.999 之类的近似）')
  assert.strictEqual(none.basis, null, '三路一句都不许说（§一·3 零样本不对外）')
  for (const k of ['star_factor', 'diary_factor', 'color_family_factor']) {
    assert.strictEqual(none[k], 1, `${k} 必须恰好 1`)
  }
  for (const k of ['diary_band', 'color_family_band']) {
    assert.strictEqual(none[k], null, `${k} 必须没有值`)
  }
  assert.strictEqual(
    CF.buildCohortModel(SELF, TALL, null, '寒冷'),
    null,
    '库里 0 行 ⇒ 连模型都不组',
  )
  assert.strictEqual(CF.loadOutfitSamples().length, 0)
  assert.strictEqual(CF.loadDiarySamples().length, 0)

  // 模型建得起来、但三路对**这一条**都没话要说 ⇒ 回到缺席形状（不是 1.0000001 那种近似）
  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 168, 88, 39)
    seedDiary(uid, [ensureShelfBand(740 + uid, '厚', '雾霾蓝')], null)
  }
  const m = CF.buildCohortModel(SELF, TALL, null, null)
  assert.ok(m && m.color, '同组 3 人的蓝 ⇒ 模型与第三路都在场（对照用）')
  const silent = CF.collabFactor({ wardrobe_item_id: 999 }, m)
  assert.strictEqual(silent.factor, 1)
  assert.strictEqual(silent.basis, null)
  assert.strictEqual(silent.color_family_sets, 0, '这一条没吃到第三路 ⇒ 套数出账也退回 0')
})

test('㉒ 引擎现场（§八·13 后一半）：不带天气也能只靠色族动衣橱候选的乘子；不传身份时 Top 8 与库里 0 行那份逐条相同', () => {
  clearAll()
  const profile = {
    gender: '女',
    scenario: '通勤',
    skin_tone: '白皙',
    height: 165,
    weight: 55,
    wardrobe_items: [
      {
        id: 7,
        name: '雾霾蓝衬衫',
        category: '上衣',
        color: '雾霾蓝',
        fit_type: '合身',
        shoulder_cm: 42,
        bust_cm: 100,
        length_cm: 68,
      },
      {
        id: 8,
        name: '焦糖色针织衫',
        category: '上衣',
        color: '焦糖色',
        fit_type: '宽松',
        shoulder_cm: 40,
        bust_cm: 96,
        length_cm: 62,
      },
    ],
  }
  const fingerprint = (r) =>
    (r['穿搭'] || []).map((e) => [
      e.source,
      e.wardrobe_item_id ?? e.group_id,
      e.group_name,
      e.rank ? e.rank.score : null,
      e.rank ? e.rank.collab_factor : null,
    ])
  // 改前那份（库里 0 行）先取下来当对照
  const base = buildRecommendation(profile, 'personal', false, SELF)
  const baseJson = JSON.stringify(fingerprint(base))
  assert.strictEqual(
    base._computed.ranking.collab.color_signal,
    null,
    '库里 0 行 ⇒ 这一路读得出"隐身"',
  )

  for (let uid = 11; uid <= 13; uid++) {
    seedBody(uid, 165, 84.5, 34.7) // 与引擎给这份档案算出来的人体向量同一格 ⇒ 距离 0
    seedDiary(uid, [ensureShelfBand(760 + uid, '厚', '雾霾蓝')], null) // ⛔ 不带温度档
  }
  for (const uid of [21, 22]) {
    seedBody(uid, 186, 110, 45)
    seedDiary(uid, [ensureShelfBand(780 + uid, '薄', '焦糖色')], null)
  }
  const on = buildRecommendation(profile, 'personal', false, SELF)
  assert.strictEqual(on._computed.ranking.collab.diary_signal, null, '没带档 ⇒ 厚薄那一路照旧 null')
  const cs = on._computed.ranking.collab.color_signal
  assert.ok(cs, '第三路不看温度档，必须出账')
  assert.strictEqual(cs.attribute, CF.COLLAB_CONFIG.COLOR_ATTRIBUTE)
  assert.strictEqual(cs.cohort_people, 3)
  assert.strictEqual(cs.cohort_diary_sets, 3)
  assert.strictEqual(cs.pool_diary_sets, 5)
  assert.strictEqual(cs.occasion_used, null)
  assert.strictEqual(cs.families_with_signal, 2, '蓝抬、棕压，两族都动了乘子')

  const rank = (r, id) => r['穿搭'].find((e) => e.wardrobe_item_id === id).rank
  assert.strictEqual(rank(on, 7).collab_factor, 1.009)
  assert.strictEqual(rank(on, 8).collab_factor, 0.991)
  assert.match(
    rank(on, 7).collab_basis,
    /其中 3 套穿蓝这一族/,
    '第三路那句人话要能进逐条出账（与星级、厚薄那两句用；拼在一起，⛔ 不折成中间值）',
  )
  assert.match(rank(on, 8).collab_basis, /其中 0 套穿棕这一族/)
  assert.notStrictEqual(
    JSON.stringify(fingerprint(on)),
    baseJson,
    '数据在场时这一路确实动了名单（不然下面的对照没意义）',
  )

  // 不传身份 ⇒ 与库里 0 行那份**逐条相同**（§八·13 后半句：这一层默认关得住）
  const anon = buildRecommendation(profile, 'personal', false, null)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fingerprint(anon))), JSON.parse(baseJson))
  assert.strictEqual(anon._computed.ranking.collab.color_signal, null)
  assert.ok(anon['穿搭'].every((e) => !e.rank || e.rank.collab_factor === 1))
})

test.after(() => memDb.close())
