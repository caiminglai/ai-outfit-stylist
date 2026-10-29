/**
 * 种子数据导入脚本
 *
 * 从 db/seed/ 目录的分模块 JSON 导入到 SQLite:
 *   - rules.json: 规则三表(rule_groups / rule_conditions / rule_actions)
 *   - inventory.json: 库存分类
 * 用法: node db/seed.js  或  npm run seed
 */

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

// 库路径只从 ./paths 取,避免各脚本各拼一份(拼错＝静默打开空库)
const { DB_PATH } = require('./paths')
const SEED_DIR = path.join(__dirname, 'seed')

/**
 * 加载分模块种子数据,合并为原结构(向后兼容)
 * @returns {{rule_groups: array, rule_conditions: array, rule_actions: array, inventory_categories: array}}
 */
function loadSeedData() {
  const rules = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'rules.json'), 'utf-8'))
  const inventory = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'inventory.json'), 'utf-8'))
  return {
    rule_groups: rules.rule_groups || [],
    rule_conditions: rules.rule_conditions || [],
    rule_actions: rules.rule_actions || [],
    inventory_categories: inventory.inventory_categories || [],
  }
}

/** 取表行数,表还不存在(空库首次建)时按 0 算 */
function countRows(db, table) {
  const exists = db
    .prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', table)
  if (!exists) return 0
  return db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get().cnt
}

/**
 * 导入种子数据
 * @param {import('better-sqlite3').Database} db
 */
function seedAll(db) {
  const data = loadSeedData()

  const { rule_groups, rule_conditions, rule_actions, inventory_categories } = data

  // 这个脚本是"全删再全建",只适合空库首次灌数据:
  // - 会连门店后台手工加过/关掉的规则一起删掉
  // - 顾客点过一次"有用/不准"之后 feedback_events 有外键引用,删除会当场报约束失败
  // 新增规则请放 db/seed/rules-*.json,由 db/applyRuleSeeds.js 在启动时只补缺的
  const existingGroups = countRows(db, 'rule_groups')
  const existingFeedback = countRows(db, 'feedback_events')
  if ((existingGroups > 0 || existingFeedback > 0) && process.env.SEED_FORCE !== '1') {
    throw new Error(
      `库里已有 ${existingGroups} 条规则、${existingFeedback} 条反馈,全删重建会一起清掉。` +
        `确认要重建请加 SEED_FORCE=1(先备份 styleai.db)。新增规则请写进 db/seed/rules-*.json,启动时会自动只补缺的。`,
    )
  }

  // 使用事务批量插入
  // ★ 列表不再手写：按"表实际列 ∩ JSON 里有的键"生成 INSERT。
  //   原来 rule_groups 的 INSERT 写死 13 列，而表有 18 列，export-rules.js 又用 SELECT * 导出 18 列
  //   ⇒ 全删重建时 source_key / evidence_level / feedback_up / feedback_down / last_hit_at 五列被丢掉。
  //   后果不是"少个字段"：db/applyRuleSeeds.js 判断"这条种子库里有没有"靠的就是 source_key，
  //   列一空，97 条种子规则在下次启动时被当成缺失重新插一遍（实测 361 → 458 条），
  //   依据分档和累计的反馈计数也一起归零。
  const insertFromJson = (table, rows, coerce) => {
    if (!Array.isArray(rows) || rows.length === 0) return 0
    const realCols = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => r.name)
    const jsonKeys = new Set(rows.flatMap((row) => Object.keys(row || {})))
    const cols = realCols.filter((c) => jsonKeys.has(c))
    if (cols.length === 0) return 0
    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`,
    )
    for (const row of rows) {
      const bound = {}
      for (const c of cols) bound[c] = row[c] === undefined ? null : row[c]
      if (coerce) coerce(bound)
      stmt.run(bound)
    }
    return rows.length
  }

  // 使用事务批量插入(better-sqlite3 支持 db.transaction,但这里保持手动控制兼容)
  db.exec('BEGIN TRANSACTION')
  try {
    // 清空旧数据(如果有)
    db.exec('DELETE FROM rule_actions')
    db.exec('DELETE FROM rule_conditions')
    db.exec('DELETE FROM rule_groups')
    db.exec('DELETE FROM inventory_categories')

    // 插入规则组（enabled 统一转 0/1，SQLite 里没有布尔列）
    insertFromJson('rule_groups', rule_groups, (bound) => {
      bound.enabled = bound.enabled ? 1 : 0
    })

    insertFromJson('rule_conditions', rule_conditions)
    insertFromJson('rule_actions', rule_actions)
    insertFromJson('inventory_categories', inventory_categories)

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  console.log(
    `[种子数据] 导入完成: ${rule_groups.length} 规则组, ${rule_conditions.length} 条件, ${rule_actions.length} 动作, ${inventory_categories.length} 分类`,
  )
}

// 直接运行时执行导入
if (require.main === module) {
  const db = new Database(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  // 确保表已创建
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  seedAll(db)
  db.close()
  console.log('[种子数据] 数据库已关闭')
}

module.exports = { seedAll }
