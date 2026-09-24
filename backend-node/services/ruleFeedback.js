/**
 * 规则反馈：记下每个人对某条规则的评价，并把好评/差评计数同步到 rule_groups
 *
 * 计数一律从 feedback_events 重算，不做累加：
 * 一个人从「有用」改成「不准」时，累加会把两个数都留在原位，好评率就永远是错的。
 */
const db = require('../db/init')

/** 反馈信号白名单：只有这两种，写错直接拒 */
const SIGNALS = ['useful', 'inaccurate']

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
 * 记一条反馈（同一人同一规则只留最新一次），返回该规则当前的好评/差评数
 * @returns {{group_id:number, signal:string, feedback_up:number, feedback_down:number}|null} 规则不存在返回 null
 */
function recordFeedback(userId, groupId, category, signal) {
  const rule = db.prepare('SELECT id FROM rule_groups WHERE id = ?').get(groupId)
  if (!rule) return null
  const upsert = db.prepare(
    `INSERT INTO feedback_events (user_id, group_id, category, signal) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, group_id) DO UPDATE SET
       signal = excluded.signal, category = excluded.category, updated_at = datetime('now')`,
  )
  db.transaction(() => {
    upsert.run(userId, groupId, category, signal)
    recountRules([groupId])
  })()
  const stat = db.prepare('SELECT feedback_up, feedback_down FROM rule_groups WHERE id = ?').get(groupId)
  return { group_id: groupId, signal, feedback_up: stat.feedback_up, feedback_down: stat.feedback_down }
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

module.exports = { SIGNALS, recordFeedback, clearFeedback }
