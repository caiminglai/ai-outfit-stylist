/**
 * 规则反馈：记下每个人对某条规则的评价，并把好评/差评计数同步到 rule_groups
 *
 * 计数一律从 feedback_events 重算，不做累加：
 * 一个人从「有用」改成「不准」时，累加会把两个数都留在原位，好评率就永远是错的。
 *
 * 2026-10-19 第三阶段·模块三：这一层从"两个按钮"升级成"两个按钮 + 两把星 + 一份打分快照"。
 * 为什么要快照（`rank_snapshot`）：权重常量与规则库会继续改，**今天的公式配不上昨天的评价**；
 * 回归脚本（`scripts/regress-rank-weights.js`）要的是"当时那三个分 ↔ 后来这个评价"的配对样本，
 * 事后回查现在的分等于把两组不同尺子的数混在一起（docs/依据/08 §9.3 标定协议的第一步）。
 */
const db = require('../db/init')

/**
 * 反馈信号白名单：写错直接拒。
 *
 * 🔴 第八阶段·第一步（10-20）加第三档 `rated`＝"只打了两把星、没点👍/👎"。
 * 为什么加档而不是放开 `signal`：`feedback_events.signal` 是 NOT NULL（schema.sql:303），
 * 而星级原本被这一档锁死——前端 `pickStar` 只在已表态时才提交（RecommendationReport.tsx:207），
 * 只打星的用户等于什么都没留下（本机现量：推荐 37 场、用户行 48 个、反馈 0 行）。
 * ⛔ `rated` 只许进这一档，**不许进好评/差评计数**：下面 `recountRules` 的 SQL 只数
 * useful/inaccurate 两个字面值，回归侧 binary 目标也只认那两个（regress-rank-weights.js:96），
 * 由 `test/ruleFeedbackStars.test.js` 钉住，防止以后有人图省事把 rated 数成好评。
 */
const SIGNALS = ['useful', 'inaccurate', 'rated']

/** 星级范围（1~5 整数）。NULL＝这一把没打，不参与回归，也不视为"1 分" */
const SCORE_MIN = 1
const SCORE_MAX = 5
const SCORE_COLUMNS = ['aesthetic_score', 'fit_score']

/** 快照里带不下的东西一律不存：只留排序三分 + 综合分 + 覆盖率，够回归用就行，不夹带个人信息 */
const SNAPSHOT_DIM_KEYS = ['rule', 'color', 'body']

/**
 * 星级归一：undefined＝这次不动这一格；null/''/越界文字＝清空（NULL）。
 * 非法值（0、6、'五星'、NaN）不在这里悄悄抹成 NULL —— 由 `scoreError` 在进门处拦成 400，
 * 因为"打错了被当成没打"和"尺寸敲飞了被当成没量"是同一类病（见 routes/wardrobe.js 的 measureError）。
 */
function starValue(raw) {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) return null
  return n
}

/** 星级进门校验：返回一句人话或 null（放行） */
function scoreError(data) {
  for (const key of SCORE_COLUMNS) {
    const raw = data[key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
      const label = key === 'aesthetic_score' ? '审美评分' : '合身度评分'
      return `${label}只能是 ${SCORE_MIN}~${SCORE_MAX} 的整数星级，收到的是「${String(raw).slice(0, 12)}」`
    }
  }
  return null
}

/**
 * 把打分那一刻的三维分存成 JSON 快照（回归的自变量就从这里取）。
 * 只认 `{rank:{dims:[{key,score}]}}` 这一种形状 —— 那是 recommendEngine.rankDims 的出账结构，
 * 前端原样带回来；认不出来就存 null（宁可不进回归样本，也不拿一个猜出来的分进模型）。
 *
 * 🔴 10-21 第九阶段·第一步：`dimKeys` 开了一个可选参数，给 `item_feedback` 那条路复用
 * **同一份解析**（`docs/依据/17` §二·2.2 第 4 条：解析只有一把尺子，⛔ 不许在另一张表里重写一遍）。
 * 默认值就是原来的三维，改前调用方一个字不用动；衣橱那条路传 `['color','body']`，
 * 因为衣橱来源的候选结构上没有规则维（`recommendEngine.js` 里那条 `group_id: null`）——
 * 拿三维去要求它＝永远 0 条样本（`17` §一 那四条证据）。"全空就存 NULL"那条守卫跟着参数一起缩：
 * 指定的那一几维全空才算没有自变量。
 */
function snapshotValue(raw, dimKeys = SNAPSHOT_DIM_KEYS) {
  if (raw === undefined || raw === null) return null
  const dims = Array.isArray(raw.dims) ? raw.dims : []
  const out = {}
  for (const key of dimKeys) {
    const d = dims.find((x) => x && x.key === key)
    const n = d && d.score != null ? Number(d.score) : NaN
    out[key] = Number.isFinite(n) ? n : null
  }
  const total = Number(raw.score)
  out.total = Number.isFinite(total) ? total : null
  const cov = Number(raw.coverage)
  out.coverage = Number.isFinite(cov) ? cov : null
  // 指定的维度全空 ⇒ 这份快照没有任何自变量，存进去也只是噪声，直接当没给
  if (dimKeys.every((k) => out[k] === null)) return null
  return JSON.stringify(out)
}

/** 重算指定规则的好评数与差评数 */
function recountRules(groupIds) {
  if (groupIds.length === 0) return
  const recount = db.prepare(
    `UPDATE rule_groups SET
       feedback_up = (SELECT COUNT(*) FROM feedback_events WHERE group_id = ? AND signal = 'useful'),
       feedback_down = (SELECT COUNT(*) FROM feedback_events WHERE group_id = ? AND signal = 'inaccurate')
     WHERE id = ?`,
  )
  for (const id of groupIds) recount.run(id, id, id)
}

/**
 * 记一条反馈（同一人同一规则只留最新一次），返回该规则当前的好评/差评数与这一行的星级。
 *
 * 新那四列走"undefined＝这次不动、null＝明确清空"，与衣橱 PUT 同一套契约
 * （`extra` 里没给键就不进 SQL，给了 null 才写 NULL）——否则用户只点一下「有用」，
 * 前一天打的五星就被这次提交抹成没打，那正好是本项目反复扫的那类"改了没生效/静默清空"病灶。
 *
 * @param {object} [extra] {aesthetic_score, fit_score, wardrobe_item_id, rank}
 *        rank 是那条穿搭的 rankDims 出账结果（{score, dims, coverage}），存成 JSON 快照
 * @returns {{group_id:number, signal:string, feedback_up:number, feedback_down:number,
 *            aesthetic_score:number|null, fit_score:number|null}|null} 规则不存在返回 null
 */
function recordFeedback(userId, groupId, category, signal, extra = {}) {
  const rule = db.prepare('SELECT id FROM rule_groups WHERE id = ?').get(groupId)
  if (!rule) return null

  const cols = ['user_id', 'group_id', 'category', 'signal']
  const vals = [userId, groupId, category, signal]
  const sets = ['signal = excluded.signal', 'category = excluded.category']
  for (const key of SCORE_COLUMNS) {
    const v = starValue(extra[key])
    if (v === undefined) continue
    cols.push(key)
    vals.push(v)
    sets.push(`${key} = excluded.${key}`)
  }
  if (extra.wardrobe_item_id !== undefined) {
    const id = extra.wardrobe_item_id === null ? null : Number(extra.wardrobe_item_id)
    cols.push('wardrobe_item_id')
    vals.push(Number.isInteger(id) && id > 0 ? id : null)
    sets.push('wardrobe_item_id = excluded.wardrobe_item_id')
  }
  if (extra.rank !== undefined) {
    cols.push('rank_snapshot')
    vals.push(snapshotValue(extra.rank))
    sets.push('rank_snapshot = excluded.rank_snapshot')
  }

  const upsert = db.prepare(
    `INSERT INTO feedback_events (${cols.join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(user_id, group_id) DO UPDATE SET
       ${sets.join(', ')}, updated_at = datetime('now')`,
  )
  db.transaction(() => {
    upsert.run(...vals)
    recountRules([groupId])
  })()
  const stat = db
    .prepare(`SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?`)
    .get(groupId)
  const row = db
    .prepare(
      'SELECT aesthetic_score, fit_score FROM feedback_events WHERE user_id = ? AND group_id = ?',
    )
    .get(userId, groupId)
  return {
    group_id: groupId,
    signal,
    feedback_up: stat.feedback_up,
    feedback_down: stat.feedback_down,
    aesthetic_score: row.aesthetic_score,
    fit_score: row.fit_score,
  }
}

/**
 * 删掉某人的全部反馈，并把被影响的规则计数改回来
 * @returns {number} 删除行数
 */
function clearFeedback(userId) {
  const groupIds = db
    .prepare('SELECT DISTINCT group_id FROM feedback_events WHERE user_id = ?')
    .all(userId)
    .map((r) => r.group_id)
  const removed = db.prepare('DELETE FROM feedback_events WHERE user_id = ?').run(userId).changes
  recountRules(groupIds)
  return removed
}

/**
 * 删掉某人在**某一条规则**上的反馈（第十四阶段·第一步 X4）。
 *
 * 为什么需要这一条：把最后一颗星抹掉＝整条撤销，而 POST 那一路"两把星全空又没表态"是 400
 * （`routes/recommend.js:303-305`，防的是空壳行）。原来前端遇到这种情况只能"改成别的星"、
 * 撤不回"没评过"，顾客点了半天没反应。撤销与写入是两种语义，⛔ 不许用 POST 硬凑。
 * 计数跟着重算（与 `clearFeedback` 同一条尺子：从 `feedback_events` 现数，⛔ 做减法）。
 *
 * 「规则在不在」这条判据放在服务层，与 `recordFeedback` 同一把尺子（那边认不到就回 `null`
 * ⇒ 路由回 404），⛔ 让路由再自己去 `rule_groups` 查第二遍。
 * @returns {number|null} 删除行数（0＝这人这条规则本来就没有反馈，幂等）；规则不存在回 **null**
 */
function clearFeedbackForGroup(userId, groupId) {
  const rule = db.prepare('SELECT id FROM rule_groups WHERE id = ?').get(groupId)
  if (!rule) return null
  const info = db
    .prepare('DELETE FROM feedback_events WHERE user_id = ? AND group_id = ?')
    .run(userId, groupId)
  recountRules([groupId])
  return info.changes
}

module.exports = {
  SIGNALS,
  SCORE_MIN,
  SCORE_MAX,
  scoreError,
  snapshotValue,
  recordFeedback,
  clearFeedback,
  clearFeedbackForGroup,
}
