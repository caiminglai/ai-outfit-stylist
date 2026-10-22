/**
 * 人 × 衣服 的评分层（2026-10-21 第九阶段·第一步）
 * ============================================================
 * 规范出处：`docs/依据/17-协同过滤输入输出规范-20261021.md` §二。本文件是它的实现，两边同轮改。
 *
 * 为什么要这一层（现量，不是设想）：权重回归那道门要的是"三维快照齐"的样本，
 * 而**三维全齐的候选在现在的代码里一条都造不出来**（`docs/依据/17` §一 四条证据逐字写着）：
 * 规则命中的那一路从不写 `body_fit`（那是 10-19 第二阶段废除中文猜测时故意留的），
 * 衣橱那一路 `group_id` 是 null ⇒ `feedback_events`（`group_id NOT NULL`＋`UNIQUE(user_id, group_id)`）
 * 根本收不下它，前端 `RecommendationReport.tsx` 那句 `item.group_id > 0` 连评分控件都不渲染。
 * ⇒ 能打分的那条路上没有身体维，有身体维的那条路不能打分。这一层把第二条路接通。
 *
 * 与 `ruleFeedback.js` 的分工（两张表语义不同，⛔ 不许混用）：
 *   `feedback_events`＝**这条规则准不准**（人×规则，回写 rule_groups 好评差评数）
 *   `item_feedback`   ＝**这件衣服你穿得怎么样**（人×衣服，⛔ 绝不回写规则计数）
 *
 * ⛔ 措辞红线：这一层采到的分今天还是 0 行。对外只许说"可以给衣柜里的这件打个分"，
 * 不许说"系统在参考和你相似的人"——那句要等 `services/collabFilter.js` 真的 ready 才许讲。
 */
const db = require('../db/init')
const { SIGNALS, SCORE_MIN, SCORE_MAX, scoreError, snapshotValue } = require('./ruleFeedback')
const { occasionValues } = require('../utils/occasionVocab')
const { asText } = require('../utils/common')

/** 这张表的快照只认这两维（`17` §二·2.2 第 4 条）：衣橱来源的候选结构上没有规则维 */
const ITEM_SNAPSHOT_DIM_KEYS = ['color', 'body']

/**
 * 唯一身份键：有登录态用 `'u'+user_id`，游客退 `'s'+session_id`，两者都没有 ⇒ null。
 *
 * ⚠️ 为什么不用 `user_id` 直接建唯一索引（现量 10-21 盘外副本 `user_wardrobe` 10 行里
 * `user_id` 只有 **1 行**非空、`session_id` 10 行全有）：SQLite 的 UNIQUE 不认为两个 NULL 相等，
 * 拿它当键会让每个游客的打分各插一行、彼此又"不算冲突"，一人一衣只留最新那条这个语义直接失效。
 * 🔴 代价如实登记在 `17` §八 第 2 条：同一个人登录**之前**游客期的打分用的是 `'s'` 键，
 *    登录之后不会自动并进来（两把键）。要不要做一次性归并是产品决定，本轮没做。
 */
function actorKeyOf(actor = {}) {
  const userId = actor.userId
  if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) return `u${userId}`
  const sid = asText(actor.sessionId)
  if (sid) return `s${sid}`
  return null
}

/**
 * 这一件是不是这个人的（`17` §二·2.2 第 1 条）。
 * 归属口径与日记同源（session∪user 并集，见 `routes/wardrobe.js` 的 `outfitOwnershipFilter` 注释），
 * ⛔ 但认不到只回 false，由调用方回 **404**（不是 403——那等于承认这一行存在）。
 * @param {{userId?:number|null, sessionId?:string|null}} actor
 * @param {number} itemId
 */
function ownsWardrobeItem(actor, itemId) {
  const key = actorKeyOf(actor)
  if (!key) return false
  const userId = typeof actor.userId === 'number' ? actor.userId : null
  const sid = asText(actor.sessionId) || null
  // ⚠️ 这里不能用一条带 `:name` 的 SQL 再混 `?`：better-sqlite3 明确不允许同一条语句里
  //    位置参数与命名参数并存（`RangeError: named parameters cannot be mixed with unnamed`），
  //    拼 WHERE 片段是这个仓既有的写法（见 `routes/wardrobe.js` 的列表筛选）。
  const arms = []
  const args = [itemId]
  if (userId !== null) {
    arms.push('user_id = ?')
    args.push(userId)
  }
  if (sid) {
    arms.push('session_id = ?')
    args.push(sid)
  }
  if (arms.length === 0) return false
  const row = db
    .prepare(`SELECT id FROM user_wardrobe WHERE id = ? AND (${arms.join(' OR ')}) LIMIT 1`)
    .get(...args)
  return !!row
}

/**
 * 进门校验：一次把这行的每个字段都判掉，返回错误话术（null＝可以写）。
 * 尺子全部复用既有那一把，⛔ 不在这里另起一套：
 * 星级＝`ruleFeedback.scoreError`（越界说破、不静默抹成"没打"），
 * signal＝`ruleFeedback.SIGNALS` 三档，occasion＝`utils/occasionVocab` 那五个受控词。
 * @param {object} data 请求体
 * @returns {string|null}
 */
function itemFeedbackError(data = {}) {
  const itemId = data.wardrobe_item_id
  if (itemId === undefined || itemId === null || asText(itemId) === '') {
    return 'wardrobe_item_id 不能为空（这一条评的是衣柜里的哪一件）'
  }
  const n = Number(itemId)
  if (!Number.isSafeInteger(n) || n <= 0) {
    return `wardrobe_item_id 只能是正整数，收到的是「${String(itemId).slice(0, 12)}」`
  }
  const starErr = scoreError(data)
  if (starErr) return starErr
  const signal = data.signal
  if (signal !== undefined && signal !== null && signal !== '') {
    if (!SIGNALS.includes(signal)) {
      return `signal 只能是 ${SIGNALS.join(' / ')}，收到的是「${String(signal).slice(0, 12)}」`
    }
  }
  const occasions = occasionValues()
  const occ = data.occasion
  if (occ !== undefined && occ !== null && asText(occ) !== '') {
    if (occasions.length === 0) return '场合词表当前取不到（规则库occasion为空），这条先不收场合'
    if (!occasions.includes(asText(occ))) {
      return `occasion 只能是 ${occasions.join(' / ')}，收到的是「${String(occ).slice(0, 12)}」`
    }
  }
  // 一行都不许是"什么都没给"的空壳：既没星也没表态 ⇒ 写进去只是一条噪声行。
  // ⚠️ 只把 1~5 的整数算"给了星"：`null` 的语义是"把这格抹成没打"（前端只在已存在的行上才发它），
  //    新行只发两个 null 等于什么都没给，放行就造出一行 signal=NULL、两把星全 NULL 的噪声。
  const isStar = (v) => Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX
  const hasStar = isStar(data.aesthetic_score) || isStar(data.fit_score)
  const hasSignal = signal !== undefined && signal !== null && signal !== ''
  if (!hasStar && !hasSignal) {
    return '至少要给一把星或表一次态，这条评分才有内容'
  }
  return null
}

/**
 * 记一条"人×衣服"的评分（同一人对同一件只留最新一次，覆盖不叠加）。
 *
 * `undefined＝这格不动／null＝明确清空` 的契约原样继承 `ruleFeedback.recordFeedback`
 * （否则"只补一颗星"会把另一颗已存的星抹成没打，那是本项目反复扫的静默清空病灶）。
 * @param {{userId?:number|null, sessionId?:string|null}} actor
 * @param {object} data 已过 `itemFeedbackError` 的请求体
 * @returns {null|{wardrobe_item_id:number, actor_key:string, aesthetic_score:number|null,
 *                  fit_score:number|null, occasion:string|null, signal:string|null,
 *                  has_snapshot:boolean}} 归属认不到返回 null（调用方回 404）
 */
function recordItemFeedback(actor, data = {}) {
  const key = actorKeyOf(actor)
  if (!key) return null
  const itemId = Number(data.wardrobe_item_id)
  if (!ownsWardrobeItem(actor, itemId)) return null

  const cols = ['actor_key', 'wardrobe_item_id']
  const vals = [key, itemId]
  const sets = []
  const add = (col, value) => {
    cols.push(col)
    vals.push(value)
    sets.push(`${col} = excluded.${col}`)
  }
  // 身份两格每次都写（登录态变了这一行的归属也跟着更新），但 actor_key 不动——
  // 它才是唯一键，动它等于把历史挪到别人名下。
  // ⛔ 请求体里的 user_id/session_id 一律不认：身份只准从鉴权中间件来，不开放覆盖。
  const userId = typeof actor.userId === 'number' ? actor.userId : null
  const sessionId = asText(actor.sessionId) || null
  cols.push('user_id')
  vals.push(userId)
  sets.push('user_id = excluded.user_id')
  cols.push('session_id')
  vals.push(sessionId)
  sets.push('session_id = excluded.session_id')

  for (const col of ['aesthetic_score', 'fit_score']) {
    if (data[col] === undefined) continue
    add(col, data[col] === null ? null : Number(data[col]))
  }
  if (data.signal !== undefined && data.signal !== null && data.signal !== '') {
    add('signal', data.signal)
  }
  if (data.occasion !== undefined) {
    add('occasion', data.occasion === null ? null : asText(data.occasion) || null)
  }
  // 快照：⛔ 只在请求真带了 rank 时才写这一格。没带＝这次不动它，
  // 不能把上一次打分存的快照抹掉（那是回归样本的自变量，抹了就少一条样本）。
  if (data.rank !== undefined) {
    add('rank_snapshot', snapshotValue(data.rank, ITEM_SNAPSHOT_DIM_KEYS))
  }

  db.prepare(
    `INSERT INTO item_feedback (${cols.join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(actor_key, wardrobe_item_id) DO UPDATE SET
       ${sets.join(', ')}, updated_at = datetime('now')`,
  ).run(...vals)

  const row = db
    .prepare(
      `SELECT wardrobe_item_id, actor_key, aesthetic_score, fit_score, occasion, signal,
              rank_snapshot
         FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?`,
    )
    .get(key, itemId)
  return { ...row, has_snapshot: !!row.rank_snapshot }
}

/**
 * 读回这个人在这些件上已有的分（前端回填那两把星用，⛔ 不给跨人的读数）。
 * @param {{userId?:number|null, sessionId?:string|null}} actor
 * @param {number[]} itemIds
 */
function listItemFeedback(actor, itemIds = []) {
  const key = actorKeyOf(actor)
  if (!key || !Array.isArray(itemIds) || itemIds.length === 0) return []
  const ids = itemIds.map((v) => Number(v)).filter((v) => Number.isSafeInteger(v) && v > 0)
  if (ids.length === 0) return []
  const marks = ids.map(() => '?').join(', ')
  return db
    .prepare(
      `SELECT wardrobe_item_id, aesthetic_score, fit_score, occasion, signal, updated_at
         FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id IN (${marks})`,
    )
    .all(key, ...ids)
}

/** 库里现有条数（给 provenance 与"这条通路有没有人用"的台账用，⛔ 不做任何决策依据） */
function countItemFeedback() {
  return db.prepare('SELECT COUNT(*) AS n FROM item_feedback').get().n
}

/**
 * 撤掉这个人对某一件衣服的评分（10-21 第十三阶段·第一步 §四·2）。
 * 三条口径都在规范里写死了，逐条对应：
 *  1. 只准删自己的：删的键是 `actor_key`（与 `recordItemFeedback` 同一个身份函数），
 *     ⛔ 不许按 `wardrobe_item_id` 裸删——那会把别人的星一起删掉；
 *  2. 这一件不是你的／库里没这件 ⇒ 回 `null`，由路由回 **404**（⛔ 403，
 *     那等于承认这一行存在，与 `ownsWardrobeItem` 那条越权口径同源）；
 *  3. 是你的、但本来就没评过 ⇒ 回 `{deleted:0}`（幂等：前端"清除评分"重复点不报错）。
 * ⛔ 不动 `feedback_events`、⛔ 不回滚 `rule_groups` 的好评差评数——那是"这条规则准不准"，
 *    与"这件衣服你穿得怎么样"是两层语义（`routes/recommend.js` §三 那条禁令）。
 * @param {{userId?:number|null, sessionId?:string|null}} actor
 * @param {number} itemId
 * @returns {null|{wardrobe_item_id:number, deleted:number}}
 */
function deleteItemFeedback(actor, itemId) {
  const key = actorKeyOf(actor)
  const id = Number(itemId)
  if (!key || !Number.isSafeInteger(id) || id <= 0) return null
  if (!ownsWardrobeItem(actor, id)) return null
  const info = db
    .prepare('DELETE FROM item_feedback WHERE actor_key = ? AND wardrobe_item_id = ?')
    .run(key, id)
  return { wardrobe_item_id: id, deleted: info.changes }
}

module.exports = {
  ITEM_SNAPSHOT_DIM_KEYS,
  SCORE_MIN,
  SCORE_MAX,
  actorKeyOf,
  ownsWardrobeItem,
  itemFeedbackError,
  recordItemFeedback,
  listItemFeedback,
  deleteItemFeedback,
  countItemFeedback,
}
