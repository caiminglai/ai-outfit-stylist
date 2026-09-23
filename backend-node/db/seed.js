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

const DB_PATH = path.join(__dirname, 'styleai.db')
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

/**
 * 导入种子数据
 * @param {Database} db
 */
function seedAll(db) {
  const data = loadSeedData()

  const { rule_groups, rule_conditions, rule_actions, inventory_categories } = data

  // 使用事务批量插入
  const insertGroup = db.prepare(`
    INSERT INTO rule_groups
      (id, name, mode, gender, category, scenario, region, age_range,
       description, priority, enabled, hit_count, created_at)
    VALUES (@id, @name, @mode, @gender, @category, @scenario, @region, @age_range,
       @description, @priority, @enabled, @hit_count, @created_at)
  `)

  const insertCondition = db.prepare(`
    INSERT INTO rule_conditions
      (id, group_id, field, operator, value, weight)
    VALUES (@id, @group_id, @field, @operator, @value, @weight)
  `)

  const insertAction = db.prepare(`
    INSERT INTO rule_actions
      (id, group_id, action_type, content, sort_order)
    VALUES (@id, @group_id, @action_type, @content, @sort_order)
  `)

  const insertCategory = db.prepare(`
    INSERT INTO inventory_categories
      (id, name, code, sort_order)
    VALUES (@id, @name, @code, @sort_order)
  `)

  // 使用事务批量插入(better-sqlite3 支持 db.transaction,但这里保持手动控制兼容)
  db.exec('BEGIN TRANSACTION')
  try {
    // 清空旧数据(如果有)
    db.exec('DELETE FROM rule_actions')
    db.exec('DELETE FROM rule_conditions')
    db.exec('DELETE FROM rule_groups')
    db.exec('DELETE FROM inventory_categories')

    // 插入规则组
    for (const g of rule_groups) {
      insertGroup.run({
        ...g,
        enabled: g.enabled ? 1 : 0,
      })
    }

    // 插入规则条件
    for (const c of rule_conditions) {
      insertCondition.run(c)
    }

    // 插入规则动作
    for (const a of rule_actions) {
      insertAction.run(a)
    }

    // 插入库存分类
    for (const cat of inventory_categories) {
      insertCategory.run(cat)
    }

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
